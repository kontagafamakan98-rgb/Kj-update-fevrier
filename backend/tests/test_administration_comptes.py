# -*- coding: utf-8 -*-
"""MODÉRATION DES COMPTES : le propriétaire voit, restreint, bannit, et lit.

Ce que ces tests verrouillent (24/10/2026)
------------------------------------------
1. Le répertoire est FERMÉ à tout autre compte, et il rend ce qu'il faut pour
   décider : nom, email, rôle, pays, date, état, activité — jamais le condensé
   du mot de passe.
2. Un BANNISSEMENT vaut immédiatement : la connexion refuse (403 qui nomme le
   motif), le jeton DÉJÀ émis ne vaut plus rien, et la réactivation rouvre sans
   redémarrage.
3. Une RESTRICTION ferme les écritures (publier, postuler, écrire) et laisse la
   lecture ouverte — c'est sa définition, pas un effet de bord.
4. Les refus sont NOMMÉS : 400 sans motif, 409 sur le compte propriétaire, 409
   sur un compte supprimé, 404 sur un identifiant inconnu.
5. La décision laisse une TRACE sur le compte (historique borné), rendue par le
   détail — une sanction sans trace ne se relit pas six mois plus tard.
6. La lecture des conversations est en LECTURE SEULE : le propriétaire qui
   ouvre un fil ne marque rien comme lu chez des gens qui n'ont rien demandé.
"""
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_JOB,
    BASE_USER,
    db_find_one,
    db_insert,
    register_and_login,
)

OWNER_EMAIL_TEST = "proprietaire-admin@kojo.sn"


@contextmanager
def _proprietaire(email: str = OWNER_EMAIL_TEST):
    """Le propriétaire se désigne par l'EMAIL, en production comme ici.

    Deux noms à patcher, et c'est voulu : `verify_owner_access` (la porte) lit
    `kojo_owner.OWNER_EMAIL`, tandis que `kojo_comptes_admin` relit
    `kojo_settings.OWNER_EMAIL` À L'APPEL pour refuser de modérer ce compte.
    Patcher un seul des deux ferait diverger la porte et la garde.
    """
    with patch("kojo_owner.OWNER_EMAIL", email), patch("kojo_settings.OWNER_EMAIL", email):
        yield


async def _proprietaire_connecte(client: AsyncClient) -> dict:
    with _proprietaire():
        return await register_and_login(
            client,
            {
                **BASE_USER,
                "email": OWNER_EMAIL_TEST,
                "first_name": "Famakan",
                "last_name": "Master",
            },
        )


def _entetes(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['access_token']}"}


async def _client_connecte(client: AsyncClient, email: str = "client-admin@kojo.sn") -> dict:
    return await register_and_login(
        client,
        {**BASE_USER, "email": email, "first_name": "Awa", "last_name": "Diallo"},
    )


async def _travailleur_connecte(client: AsyncClient, email: str = "ouvrier-admin@kojo.sn") -> dict:
    return await register_and_login(
        client,
        {
            **BASE_USER,
            "email": email,
            "first_name": "Moussa",
            "last_name": "Traore",
            "user_type": "worker",
            # Un travailleur lie deux moyens de paiement à l'inscription.
            "payment_accounts": {
                "orange_money": "+221771234567",
                "wave": "+221771234568",
            },
        },
    )


async def _etat_en_base(user_id: str) -> dict:
    compte = await db_find_one("users", {"id": user_id})
    assert compte is not None
    return compte


@pytest.mark.asyncio
class TestRepertoire:
    async def test_le_repertoire_est_ferme_a_un_compte_ordinaire(self, client: AsyncClient):
        """Le répertoire contient TOUS les comptes : c'est la donnée la plus
        sensible du site, donc la porte ne se contente pas d'un jeton."""
        client_session = await _client_connecte(client)

        resp = await client.get("/api/owner/accounts", headers=_entetes(client_session))
        assert resp.status_code == 403, resp.text

    async def test_le_repertoire_lit_tous_les_comptes_et_leurs_mesures(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        await _client_connecte(client)
        await _travailleur_connecte(client)

        with _proprietaire():
            resp = await client.get("/api/owner/accounts", headers=_entetes(owner))
        assert resp.status_code == 200, resp.text
        charge = resp.json()

        emails = {compte["email"] for compte in charge["comptes"]}
        assert {"client-admin@kojo.sn", "ouvrier-admin@kojo.sn"} <= emails, (
            "le propriétaire doit voir les comptes réellement inscrits"
        )
        assert charge["mesures"]["clients"] >= 1
        assert charge["mesures"]["travailleurs"] >= 1
        assert charge["mesures"]["bannis"] == 0
        assert charge["tronque"] is False, "trois comptes ne sont pas une lecture tronquée"

        for compte in charge["comptes"]:
            assert "password_hash" not in compte, (
                "le condensé du mot de passe n'a aucune raison d'être rendu au propriétaire"
            )
            assert compte["account_state"] in {"actif", "restreint", "banni"}

    async def test_la_recherche_et_les_filtres_ne_mentent_pas(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        await _client_connecte(client, "awa@kojo.sn")
        await _travailleur_connecte(client, "moussa@kojo.sn")

        with _proprietaire():
            par_nom = await client.get(
                "/api/owner/accounts", params={"recherche": "moussa"}, headers=_entetes(owner)
            )
            par_role = await client.get(
                "/api/owner/accounts", params={"role": "worker"}, headers=_entetes(owner)
            )
            par_etat = await client.get(
                "/api/owner/accounts", params={"etat": "banni"}, headers=_entetes(owner)
            )

        assert [c["email"] for c in par_nom.json()["comptes"]] == ["moussa@kojo.sn"]
        assert {c["user_type"] for c in par_role.json()["comptes"]} == {"worker"}
        assert par_etat.json()["comptes"] == [], (
            "aucun compte n'est banni : la liste doit être VIDE, pas remplie d'actifs"
        )
        assert par_etat.json()["mesures"]["bannis"] == 0


@pytest.mark.asyncio
class TestBannissement:
    async def test_bannir_ferme_la_connexion_et_le_jeton_deja_emis(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _client_connecte(client)
        cible_id = cible["user"]["id"]

        with _proprietaire():
            decision = await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "banni", "motif": "Faux comptes et arnaques répétées"},
                headers=_entetes(owner),
            )
        assert decision.status_code == 200, decision.text
        assert decision.json()["compte"]["account_state"] == "banni"

        # 1. Le jeton DÉJÀ émis ne vaut plus rien (get_current_user relit le compte).
        deja_connecte = await client.get("/api/auth/me", headers=_entetes(cible))
        assert deja_connecte.status_code == 403, deja_connecte.text
        assert "suspendu" in deja_connecte.json()["detail"]
        assert "arnaques" in deja_connecte.json()["detail"], (
            "le refus doit porter le MOTIF : un refus muet se relit comme une panne"
        )

        # 2. La connexion refuse aussi, et dit pourquoi.
        connexion = await client.post(
            "/api/auth/login",
            json={"email": "client-admin@kojo.sn", "password": BASE_USER["password"]},
        )
        assert connexion.status_code == 403, connexion.text
        assert "suspendu" in connexion.json()["detail"]

    async def test_reactiver_rouvre_immediatement(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _client_connecte(client)
        cible_id = cible["user"]["id"]

        with _proprietaire():
            await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "banni", "motif": "Vérification en cours"},
                headers=_entetes(owner),
            )
            assert (await client.get("/api/auth/me", headers=_entetes(cible))).status_code == 403

            reactivation = await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "actif"},
                headers=_entetes(owner),
            )
            assert reactivation.status_code == 200, reactivation.text
            assert (await client.get("/api/auth/me", headers=_entetes(cible))).status_code == 200

        compte = await _etat_en_base(cible_id)
        assert compte["account_state"] == "actif"
        assert compte["account_state_reason"] is None

    async def test_la_decision_laisse_une_trace_sur_le_compte(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _client_connecte(client)
        cible_id = cible["user"]["id"]

        with _proprietaire():
            await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "restreint", "motif": "Propos injurieux dans les messages"},
                headers=_entetes(owner),
            )
            await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "banni", "motif": "Récidive après restriction"},
                headers=_entetes(owner),
            )
            detail = await client.get(f"/api/owner/accounts/{cible_id}", headers=_entetes(owner))

        assert detail.status_code == 200, detail.text
        charge = detail.json()
        assert [entree["etat"] for entree in charge["historique"]] == ["restreint", "banni"]
        assert charge["historique"][-1]["motif"] == "Récidive après restriction"
        assert charge["historique"][-1]["by"] == owner["user"]["id"], (
            "une décision doit nommer son auteur"
        )
        assert "activite" in charge and charge["activite"]["missions_publiees"] == 0


@pytest.mark.asyncio
class TestRestriction:
    async def test_restreindre_ferme_les_ecritures_et_laisse_la_lecture(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _client_connecte(client)
        voisin = await _client_connecte(client, "voisin@kojo.sn")
        cible_id = cible["user"]["id"]

        with _proprietaire():
            refus = await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "restreint", "motif": "Publications hors sujet répétées"},
                headers=_entetes(owner),
            )
        assert refus.status_code == 200, refus.text

        # LECTURE : la session fonctionne toujours.
        assert (await client.get("/api/auth/me", headers=_entetes(cible))).status_code == 200
        assert (await client.get("/api/jobs", headers=_entetes(cible))).status_code == 200

        # ÉCRITURE : publier est fermé, avec le motif.
        publication = await client.post("/api/jobs", json=BASE_JOB, headers=_entetes(cible))
        assert publication.status_code == 403, publication.text
        assert "restreint" in publication.json()["detail"]
        assert "hors sujet" in publication.json()["detail"]

        # ÉCRITURE : écrire à quelqu'un est fermé aussi.
        message = await client.post(
            "/api/messages",
            json={"receiver_id": voisin["user"]["id"], "content": "Bonjour, une mission ?"},
            headers=_entetes(cible),
        )
        assert message.status_code == 403, message.text
        assert "restreint" in message.json()["detail"]

    async def test_postuler_est_ferme_a_un_travailleur_restreint(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        client_session = await _client_connecte(client)
        travailleur = await _travailleur_connecte(client)
        travailleur_id = travailleur["user"]["id"]

        job = await client.post("/api/jobs", json=BASE_JOB, headers=_entetes(client_session))
        assert job.status_code == 200, job.text
        job_id = job.json()["id"]

        with _proprietaire():
            await client.post(
                f"/api/owner/accounts/{travailleur_id}/state",
                json={"etat": "restreint", "motif": "Candidatures frauduleuses"},
                headers=_entetes(owner),
            )

        proposition = await client.post(
            f"/api/jobs/{job_id}/proposals",
            json={"price": 15000, "message": "Je peux intervenir aujourd'hui même.", "estimated_duration": "2 heures"},
            headers=_entetes(travailleur),
        )
        assert proposition.status_code == 403, proposition.text
        assert "restreint" in proposition.json()["detail"]


@pytest.mark.asyncio
class TestRefusNommes:
    async def test_un_motif_est_exige_pour_sanctionner(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _client_connecte(client)
        cible_id = cible["user"]["id"]

        with _proprietaire():
            sans_motif = await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "banni"},
                headers=_entetes(owner),
            )
            trop_court = await client.post(
                f"/api/owner/accounts/{cible_id}/state",
                json={"etat": "restreint", "motif": "ok"},
                headers=_entetes(owner),
            )

        assert sans_motif.status_code == 400
        assert "motif" in sans_motif.json()["detail"].lower()
        assert trop_court.status_code == 400
        # Rien n'a été appliqué : un refus ne laisse pas un demi-état derrière lui.
        compte = await _etat_en_base(cible_id)
        assert compte.get("account_state") in (None, "actif")

    async def test_le_proprietaire_ne_se_modere_pas_lui_meme(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        owner_id = owner["user"]["id"]

        with _proprietaire():
            resp = await client.post(
                f"/api/owner/accounts/{owner_id}/state",
                json={"etat": "banni", "motif": "Test de garde"},
                headers=_entetes(owner),
            )
        assert resp.status_code == 409, resp.text
        assert "propriétaire" in resp.json()["detail"].lower()

    async def test_un_compte_supprime_est_refuse_et_un_inconnu_est_404(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        await db_insert("users", {
            "id": "compte-supprime-admin",
            "email": "parti@kojo.deleted",
            "first_name": "",
            "last_name": "",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "deleted": True,
        })

        with _proprietaire():
            supprime = await client.post(
                "/api/owner/accounts/compte-supprime-admin/state",
                json={"etat": "banni", "motif": "Compte déjà supprimé"},
                headers=_entetes(owner),
            )
            inconnu = await client.post(
                "/api/owner/accounts/identifiant-qui-nexiste-pas/state",
                json={"etat": "banni", "motif": "Compte introuvable ici"},
                headers=_entetes(owner),
            )

        assert supprime.status_code == 409
        assert "supprimé" in supprime.json()["detail"]
        assert inconnu.status_code == 404


@pytest.mark.asyncio
class TestLectureDesConversations:
    async def _echange(self, client: AsyncClient, client_session: dict, travailleur: dict):
        envoi = await client.post(
            "/api/messages",
            json={
                "receiver_id": travailleur["user"]["id"],
                "content": "Bonjour Moussa, la fuite est toujours là.",
            },
            headers=_entetes(client_session),
        )
        assert envoi.status_code == 200, envoi.text
        return envoi.json()

    async def test_le_proprietaire_voit_les_fils_et_ne_marque_rien_comme_lu(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        client_session = await _client_connecte(client)
        travailleur = await _travailleur_connecte(client)
        message = await self._echange(client, client_session, travailleur)

        with _proprietaire():
            liste = await client.get("/api/owner/conversations", headers=_entetes(owner))
            assert liste.status_code == 200, liste.text
            conversations = liste.json()["conversations"]
            assert len(conversations) == 1
            noms = {participant["email"] for participant in conversations[0]["participants"]}
            assert {"client-admin@kojo.sn", "ouvrier-admin@kojo.sn"} == noms, (
                "une conversation sans les DEUX participants ne se modère pas"
            )

            fil = await client.get(
                f"/api/owner/conversations/{message['conversation_id']}",
                headers=_entetes(owner),
            )

        assert fil.status_code == 200, fil.text
        charge = fil.json()
        assert charge["count"] == 1
        assert charge["messages"][0]["content"] == "Bonjour Moussa, la fuite est toujours là."
        assert charge["lu_marque"] is False, (
            "la modération lit, elle ne fait pas disparaître l'indicateur de non-lus"
        )

        # Le message reçu par le travailleur est TOUJOURS non lu en base.
        stocke = await db_find_one("messages", {"id": message["id"]})
        assert stocke.get("read") in (None, False)

    async def test_la_recherche_porte_sur_le_nom_l_email_et_le_dernier_message(self, client: AsyncClient):
        """Filtrer les fils ne casse pas le filtre.

        Le filtre lisait une variable `participant` restée hors de sa portée :
        le répertoire des fils répondait 500 dès qu'une recherche était
        saisie, et aucune lecture SANS filtre ne pouvait le voir. Les trois
        colonnes jugées sont éprouvées une par une.
        """
        owner = await _proprietaire_connecte(client)
        client_session = await _client_connecte(client)
        travailleur = await _travailleur_connecte(client)
        await self._echange(client, client_session, travailleur)

        with _proprietaire():
            par_message = await client.get(
                "/api/owner/conversations", params={"recherche": "fuite"}, headers=_entetes(owner)
            )
            par_email = await client.get(
                "/api/owner/conversations", params={"recherche": "ouvrier-admin"}, headers=_entetes(owner)
            )
            sans_echo = await client.get(
                "/api/owner/conversations", params={"recherche": "zebre-introuvable"}, headers=_entetes(owner)
            )

        assert par_message.status_code == 200, par_message.text
        assert par_message.json()["count"] == 1, "le dernier message est une colonne du filtre"
        assert par_email.status_code == 200, par_email.text
        assert par_email.json()["count"] == 1, "l'email d'un participant est une colonne du filtre"
        assert sans_echo.status_code == 200, sans_echo.text
        assert sans_echo.json()["count"] == 0, "un filtre qui ne trouve rien ne rend pas tout"

    async def test_un_fil_inconnu_est_un_404_nomme(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)

        with _proprietaire():
            resp = await client.get("/api/owner/conversations/inconnue_123", headers=_entetes(owner))
        assert resp.status_code == 404
        assert "introuvable" in resp.json()["detail"].lower()

    async def test_les_fils_sont_fermes_a_un_compte_ordinaire(self, client: AsyncClient):
        client_session = await _client_connecte(client)
        travailleur = await _travailleur_connecte(client)
        message = await self._echange(client, client_session, travailleur)

        resp = await client.get(
            f"/api/owner/conversations/{message['conversation_id']}",
            headers=_entetes(client_session),
        )
        assert resp.status_code == 403, resp.text
