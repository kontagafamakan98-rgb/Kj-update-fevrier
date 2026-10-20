# -*- coding: utf-8 -*-
"""Plafond de connexion par RÉSEAU : il plafonne l'attaque, pas les voisins.

POURQUOI CE FICHIER

Le verrou de compte (`kojo_login_guard`) ne voit pas une attaque qui change de
compte à chaque essai ; le rate-limiter ne voit que des adresses IP, or un
opérateur ouest-africain (Orange, Sonatel, Wave) fait sortir des milliers
d'abonnés derrière une poignée d'IP. Le plafond par réseau comble ce trou, et
ces cas mesurent ce qui le rend acceptable :

  1. LE SEUIL EST ATTEINT PAR DES ÉCHECS (pas des requêtes), sur un /24 : une
     attaque qui répartit ses essais sur des comptes différents est enfin vue ;
  2. AU SEUIL, LE RÉSEAU PASSE AU GOUTTE-À-GOUTTE : une tentative toutes les
     `SONDAGE_SECONDS`, et `Retry-After` ne promet jamais plus — c'est la borne
     qui interdit de punir des voisins pendant quinze minutes ;
  3. UN EMAIL INCONNU COMPTE AUSSI, sinon le « spraying » qui teste des
     adresses au hasard échapperait au plafond (et un compteur limité aux
     comptes existants ferait du 429 un annuaire) ;
  4. UNE CONNEXION RÉUSSIE NE REMET PAS LE COMPTEUR À ZÉRO : un attaquant qui
     possède un identifiant valide ne doit pas repartir de zéro ;
  5. UNE PANNE DU COMPTEUR N'EMPÊCHE PAS DE SE CONNECTER (le verrou de compte
     reste appliqué) ;
  6. LA RÈGLE EST ATTEIGNABLE : le bucket par IP de la connexion laisse passer
     au moins `SEUIL_ECHECS` requêtes dans sa fenêtre, sinon le plafond réseau
     serait décoratif (le middleware refuserait avant lui) — et l'INSCRIPTION,
     elle, garde sa borne serrée.

Ce que ces cas ne jugent pas : le choix des bornes (120 échecs / 15 min, sonde
de 5 s), qui est une décision de produit argumentée dans le module.
"""
import pytest
from httpx import AsyncClient

import kojo_login_reseau
from kojo_login_reseau import (
    FENETRE_MINUTES,
    SEUIL_ECHECS,
    SONDAGE_SECONDS,
    echecs,
    enregistrer_echec,
    oublier_tout,
    prendre_sondage,
    reseau_de,
)
from kojo_rate_limit import get_rate_limit_bucket
from tests.conftest import BASE_USER, register_and_login

INCONNU = "personne@kojo.sn"


async def _login(client: AsyncClient, email: str, mot_de_passe: str, ip: str = ""):
    entetes = {"X-Forwarded-For": ip} if ip else None
    return await client.post(
        "/api/auth/login", json={"email": email, "password": mot_de_passe}, headers=entetes
    )


async def _saturer(reseau: str):
    for _ in range(SEUIL_ECHECS):
        await enregistrer_echec(reseau)


class TestReseauDe:
    """Le réseau est un AGRÉGAT : c'est ce qui rend la règle applicable en CGNAT."""

    @pytest.mark.parametrize(
        "adresse, attendu",
        [
            ("197.234.221.10", "197.234.221.0/24"),
            ("197.234.221.200", "197.234.221.0/24"),
            ("197.234.222.10", "197.234.222.0/24"),
            ("2a01:e0a:1:2::5", "2a01:e0a:1:2::/64"),
            ("2a01:e0a:1:2:ffff::9", "2a01:e0a:1:2::/64"),
            ("[2a01:e0a:1:3::1]", "2a01:e0a:1:3::/64"),
            ("197.234.221.10:52714", "197.234.221.0/24"),
            ("::ffff:197.234.221.10", "197.234.221.0/24"),
        ],
    )
    def test_les_voisins_partagent_un_reseau(self, adresse, attendu):
        assert reseau_de(adresse) == attendu

    def test_une_adresse_illisible_ne_contamine_pas_les_autres(self):
        """Un en-tête mal formé ne doit pas faire porter les fautes de tous."""
        assert reseau_de("pas-une-ip") == "reseau:pas-une-ip"
        assert reseau_de("") == "reseau:inconnu"
        assert reseau_de(None) == "reseau:inconnu"
        assert reseau_de("x" * 500).startswith("reseau:x")
        assert len(reseau_de("x" * 500)) <= len("reseau:") + 64, (
            "une clé de repli non bornée ferait grossir le dictionnaire mémoire"
        )


class TestGoutteAgoutte:
    """Au seuil : une tentative par `SONDAGE_SECONDS`, jamais un blocage."""

    @pytest.mark.asyncio
    async def test_le_seuil_est_atteint_par_les_echecs(self, client: AsyncClient):
        """120 échecs comptés sur le RÉSEAU, sans 120 requêtes HTTP."""
        reseau = reseau_de("198.51.100.7")
        await _saturer(reseau)
        assert await echecs(reseau) >= SEUIL_ECHECS
        assert await echecs(reseau_de("198.51.101.7")) == 0, (
            "un autre /24 ne doit rien voir — le compteur suit le réseau, pas l'IP"
        )

    @pytest.mark.asyncio
    async def test_reseau_sature_le_voisin_avec_le_bon_mot_de_passe_passe(
        self, client: AsyncClient
    ):
        """LA propriété : les fautes des autres ne bloquent pas un voisin."""
        await register_and_login(client, BASE_USER)
        reseau = reseau_de("203.0.113.9")
        await _saturer(reseau)

        # Première tentative après saturation : c'est la sonde, elle est admise.
        ok = await _login(client, BASE_USER["email"], BASE_USER["password"], "203.0.113.9")
        assert ok.status_code == 200, (
            "un voisin du même réseau doit pouvoir se connecter malgré l'attaque "
            f"(relevé : {ok.status_code} {ok.text})"
        )
        assert await echecs(reseau) >= SEUIL_ECHECS, (
            "un succès ne remet PAS le compteur réseau à zéro : un attaquant qui "
            "possède un identifiant valide ne doit pas pouvoir repartir de zéro"
        )

    @pytest.mark.asyncio
    async def test_sonde_deja_prise_le_refus_est_borne_par_Retry_After(self, client: AsyncClient):
        await register_and_login(client, BASE_USER)
        reseau = reseau_de("203.0.113.10")
        await _saturer(reseau)
        assert await prendre_sondage(reseau) is True

        refus = await _login(client, BASE_USER["email"], BASE_USER["password"], "203.0.113.10")

        assert refus.status_code == 429, (
            "sonde déjà consommée : la tentative suivante doit être refusée "
            f"(relevé : {refus.status_code} {refus.text})"
        )
        attente = int(refus.headers.get("Retry-After", "0"))
        assert 0 < attente <= SONDAGE_SECONDS, (
            f"l'attente annoncée ({attente} s) doit tenir dans la cadence de sonde "
            f"({SONDAGE_SECONDS} s) : promettre plus punirait le voisin"
        )
        assert reseau in refus.text or "réseau" in refus.text, (
            "le refus doit dire qu'il vient du RÉSEAU, pas du compte"
        )

    @pytest.mark.asyncio
    async def test_le_refus_n_a_pas_juge_le_mot_de_passe(self, client: AsyncClient):
        """Refuser AVANT la vérification : aucun échec n'est imputé au compte."""
        user = await register_and_login(client, BASE_USER)
        reseau = reseau_de("203.0.113.11")
        await _saturer(reseau)
        await prendre_sondage(reseau)

        refus = await _login(client, BASE_USER["email"], BASE_USER["password"], "203.0.113.11")
        assert refus.status_code == 429

        from tests.conftest import db_find_one

        apres = await db_find_one("users", {"id": user["user"]["id"]})
        assert "login_failed_count" not in apres, (
            "aucun échec ne doit être compté : le mot de passe n'a pas été évalué"
        )
        assert "login_locked_until" not in apres

    @pytest.mark.asyncio
    async def test_la_sonde_consommee_par_un_echec_compte_puis_ferme(self, client: AsyncClient):
        """La sonde est une TENTATIVE : si elle échoue, elle compte et referme."""
        await register_and_login(client, BASE_USER)
        reseau = reseau_de("203.0.113.12")
        await _saturer(reseau)

        premier = await _login(client, BASE_USER["email"], "mauvais-mot-de-passe", "203.0.113.12")
        assert premier.status_code == 401, "la sonde admet la tentative, qui échoue normalement"
        assert await echecs(reseau) > SEUIL_ECHECS, "l'échec de la sonde est compté"

        second = await _login(client, BASE_USER["email"], "mauvais-mot-de-passe", "203.0.113.12")
        assert second.status_code == 429, (
            "immédiatement après la sonde, le réseau repasse en goutte-à-goutte"
        )

    @pytest.mark.asyncio
    async def test_un_email_inconnu_compte_pour_le_reseau(self, client: AsyncClient):
        """Le spraying teste des adresses au hasard : il doit être plafonné aussi."""
        reseau = reseau_de("203.0.113.13")
        assert await echecs(reseau) == 0

        echec = await _login(client, INCONNU, "mauvais-mot-de-passe", "203.0.113.13")
        assert echec.status_code == 401, "un email inconnu reste un 401 (pas un annuaire)"
        assert await echecs(reseau) == 1, (
            "l'échec sur un email INCONNU doit compter pour le réseau, sinon le "
            "spraying sur des adresses au hasard échapperait au plafond"
        )

    @pytest.mark.asyncio
    async def test_reseau_sature_un_email_inconnu_recoit_le_meme_refus_que_les_autres(
        self, client: AsyncClient
    ):
        """Le refus est celui du RÉSEAU : il ne dit rien de l'existence du compte."""
        await register_and_login(client, BASE_USER)
        reseau = reseau_de("203.0.113.14")
        await _saturer(reseau)
        await prendre_sondage(reseau)

        connu = await _login(client, BASE_USER["email"], BASE_USER["password"], "203.0.113.14")
        inconnu = await _login(client, INCONNU, "mauvais-mot-de-passe", "203.0.113.14")

        assert connu.status_code == inconnu.status_code == 429, (
            "le 429 ne doit pas distinguer un compte existant d'un inconnu : "
            f"connu {connu.status_code}, inconnu {inconnu.status_code}"
        )


class TestPanne:
    """Une panne du compteur ne devient jamais une panne de connexion."""

    @pytest.mark.asyncio
    async def test_un_compteur_en_panne_laisse_passer(self, client: AsyncClient, monkeypatch):
        import kojo_routers_auth as routeur

        await register_and_login(client, BASE_USER)

        async def _hs(*args, **kwargs):
            raise RuntimeError("compteur indisponible")

        monkeypatch.setattr(routeur, "echecs_du_reseau", _hs)

        ok = await _login(client, BASE_USER["email"], BASE_USER["password"], "203.0.113.15")
        assert ok.status_code == 200, (
            "un incident de compteur ne doit pas empêcher tout un opérateur de se "
            f"connecter (relevé : {ok.status_code} {ok.text})"
        )

    @pytest.mark.asyncio
    async def test_un_echec_non_compte_reste_un_401(self, client: AsyncClient, monkeypatch):
        import kojo_routers_auth as routeur

        await register_and_login(client, BASE_USER)

        async def _hs(*args, **kwargs):
            raise RuntimeError("compteur indisponible")

        monkeypatch.setattr(routeur, "enregistrer_echec_reseau", _hs)

        echec = await _login(client, BASE_USER["email"], "mauvais-mot-de-passe", "203.0.113.16")
        assert echec.status_code == 401, "l'échec reste un refus ordinaire, jamais un 500"


class TestCoherenceAvecLeBucketParIp:
    """Le plafond réseau doit être ATTEIGNABLE, sinon il est décoratif."""

    def test_le_bucket_de_connexion_laisse_passer_au_moins_le_seuil_reseau(self):
        nom, maximum, fenetre = get_rate_limit_bucket("/api/auth/login")
        assert maximum >= SEUIL_ECHECS, (
            f"bucket « {nom} » : {maximum} requêtes par {fenetre} min, alors que le "
            f"plafond réseau demande {SEUIL_ECHECS} échecs — le middleware refuserait "
            "avant que la règle par réseau ne voie quoi que ce soit"
        )
        assert fenetre <= FENETRE_MINUTES, (
            "une fenêtre IP plus longue que la fenêtre réseau rendrait le seuil "
            "\"atteignable\" sur le papier seulement"
        )

    def test_l_inscription_garde_sa_borne_serree(self):
        """Créer des comptes n'est pas deviner un mot de passe : ça reste borné."""
        _, maximum, _ = get_rate_limit_bucket("/api/auth/register")
        assert maximum < SEUIL_ECHECS, (
            "la limite d'inscription ne doit pas hériter de la générosité de la "
            "connexion : un abus y crée des comptes, il ne se mesure pas en échecs"
        )

    def test_les_buckets_ne_sont_pas_confondus(self):
        assert get_rate_limit_bucket("/api/auth/login")[0] != get_rate_limit_bucket(
            "/api/auth/register"
        )[0], "les deux routes ont des profils d'abus différents : deux buckets"


class TestEtatMemoire:
    """L'état est JETABLE : le vider ne casse rien, et il reste borné."""

    @pytest.mark.asyncio
    async def test_oublier_tout_vide_les_compteurs(self):
        # PAS de `asyncio.run` ici : il ferme la boucle d'événements de la
        # session et les tests asynchrones suivants échouent alors sur
        # « There is no current event loop » — un test ne juge pas au prix de
        # la suite qui vient après lui.
        reseau = reseau_de("198.51.100.40")
        await enregistrer_echec(reseau)
        await prendre_sondage(reseau)
        oublier_tout()
        assert await echecs(reseau) == 0
        assert await prendre_sondage(reseau) is True

    def test_le_module_declare_ses_bornes(self):
        assert SEUIL_ECHECS > 0 and FENETRE_MINUTES > 0 and SONDAGE_SECONDS > 0
        assert kojo_login_reseau.stats()["replis"] >= 0
