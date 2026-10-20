# -*- coding: utf-8 -*-
"""Le verrou de CONNEXION est porté par le compte, pas par l'adresse IP.

POURQUOI CE FICHIER

La seule limite qui existait sur `/auth/login` était le rate-limiter par IP
(bucket `auth-session`, 20 requêtes / 5 min). En Afrique de l'Ouest, Orange,
Sonatel et Wave partagent une poignée d'IP publiques entre des milliers
d'abonnés : cette limite est INJUSTE (elle 429 des voisins qui n'ont rien fait)
et POREUSE (un credential stuffing réparti sur mille IP ne la touche jamais).
Le seul objet qui décrit l'attaque, c'est le COMPTE visé.

Ces cas mesurent les quatre propriétés qui rendent le verrou utile plutôt que
décoratif, et chacun échoue sur le code d'avant :

  1. au seuil, un compte est VERROUILLÉ — même le BON mot de passe est refusé
     (429 + `Retry-After`), sinon le verrou ne protégerait rien ;
  2. un échec est COMPTÉ sur le compte, et un succès libère immédiatement ;
  3. un email INCONNU n'est jamais verrouillé : il reste un 401, donc le verrou
     ne devient pas un annuaire des comptes existants ;
  4. le verrou suit le COMPTE, pas l'IP : le même poste peut verrouiller A et
     se connecter à B (c'est toute la différence avec la limite par IP).

Ce que ces cas ne jugent pas : le choix des bornes (8 échecs, 15/30/60 min), qui
est un réglage de produit, ni le coût assumé (un tiers peut verrouiller le
compte d'autrui huit tentatives durant — borné par la durée courte).
"""
import pytest
from httpx import AsyncClient

from kojo_login_guard import (
    SEUIL_ECHECS,
    VERROU_BASE_SECONDS,
    VERROU_MAX_SECONDS,
    _duree_du_verrou,
)
from tests.conftest import BASE_USER, db_find_one, register_and_login

AUTRE_COMPTE = {
    **BASE_USER,
    "email": "autre@kojo.sn",
    "phone": "+221770000002",
}


async def _tentative(client: AsyncClient, email: str, mot_de_passe: str = "mauvais-mot-de-passe"):
    return await client.post(
        "/api/auth/login", json={"email": email, "password": mot_de_passe}
    )


async def _echouer(client: AsyncClient, email: str, fois: int):
    reponses = [await _tentative(client, email) for _ in range(fois)]
    return reponses


def test_le_verrou_double_par_palier_sans_depasser_le_plafond():
    """La durée est une ESCALADE bornée : jamais un compte bloqué à vie."""
    assert _duree_du_verrou(SEUIL_ECHECS) == VERROU_BASE_SECONDS
    assert _duree_du_verrou(SEUIL_ECHECS * 2) == VERROU_BASE_SECONDS * 2
    assert _duree_du_verrou(SEUIL_ECHECS * 10) == VERROU_MAX_SECONDS, (
        "une attaque longue ne doit pas pouvoir rendre un compte inaccessible "
        "indéfiniment : le verrou est plafonné"
    )


@pytest.mark.asyncio
async def test_au_seuil_le_compte_est_verrouille_meme_avec_le_bon_mot_de_passe(
    client: AsyncClient,
):
    await register_and_login(client, BASE_USER)

    reponses = await _echouer(client, BASE_USER["email"], SEUIL_ECHECS)
    assert all(r.status_code == 401 for r in reponses), (
        "les échecs sous le seuil restent des 401 : "
        f"{[r.status_code for r in reponses]}"
    )

    apres = await _tentative(client, BASE_USER["email"], BASE_USER["password"])

    assert apres.status_code == 429, (
        "au seuil, la connexion doit être REFUSÉE par le verrou de compte — le "
        f"bon mot de passe compris (relevé : {apres.status_code} {apres.text})"
    )
    assert int(apres.headers.get("Retry-After", "0")) > 0, (
        "le refus doit dire QUAND réessayer (`Retry-After`)"
    )


@pytest.mark.asyncio
async def test_un_succes_libere_le_compte_et_efface_les_compteurs(client: AsyncClient):
    """Trois échecs puis le bon mot de passe : plus aucune trace du verrou."""
    user = await register_and_login(client, BASE_USER)

    await _echouer(client, BASE_USER["email"], 3)
    avant = await db_find_one("users", {"id": user["user"]["id"]})
    assert avant.get("login_failed_count") == 3, "chaque échec est compté"

    ok = await _tentative(client, BASE_USER["email"], BASE_USER["password"])
    assert ok.status_code == 200, ok.text

    apres = await db_find_one("users", {"id": user["user"]["id"]})
    assert "login_failed_count" not in apres, (
        "une connexion réussie doit remettre le compteur à zéro, sinon huit "
        "fautes étalées sur des mois finiraient par verrouiller un compte"
    )
    assert "login_locked_until" not in apres


@pytest.mark.asyncio
async def test_un_email_inconnu_reste_un_401_jamais_un_verrou(client: AsyncClient):
    """Le verrou ne doit pas répondre 429 sur un compte qui n'existe pas.

    Un 429 là où le compte est inconnu serait un annuaire : il suffirait de
    sonder des adresses pour savoir lesquelles existent.
    """
    reponses = await _echouer(client, "inconnu@kojo.sn", SEUIL_ECHECS + 2)

    assert all(r.status_code == 401 for r in reponses), (
        "un email inconnu doit rester un 401 : "
        f"{[r.status_code for r in reponses]}"
    )


@pytest.mark.asyncio
async def test_le_verrou_suit_le_compte_et_pas_l_adresse_ip(client: AsyncClient):
    """Le MÊME poste verrouille A puis se connecte à B — la différence avec l'IP."""
    await register_and_login(client, BASE_USER)
    autre = await register_and_login(client, AUTRE_COMPTE)
    assert autre["user"]["email"] == AUTRE_COMPTE["email"]

    await _echouer(client, BASE_USER["email"], SEUIL_ECHECS)
    verrouille = await _tentative(client, BASE_USER["email"], BASE_USER["password"])
    assert verrouille.status_code == 429

    # Même IP (le client de test), autre compte : la connexion doit passer.
    voisin = await _tentative(client, AUTRE_COMPTE["email"], AUTRE_COMPTE["password"])
    assert voisin.status_code == 200, (
        "un compte verrouillé ne doit pas bloquer les autres comptes de la même "
        f"IP (relevé : {voisin.status_code} {voisin.text})"
    )


@pytest.mark.asyncio
async def test_un_verrou_expire_laisse_repasser_la_connexion(client: AsyncClient):
    """Un horodatage de verrou DANS LE PASSÉ ne bloque pas : le délai décide."""
    user = await register_and_login(client, BASE_USER)
    from kojo_db import db

    await db.users.update_one(
        {"id": user["user"]["id"]},
        {"$set": {"login_locked_until": "2020-01-01T00:00:00+00:00"}},
    )

    apres = await _tentative(client, BASE_USER["email"], BASE_USER["password"])

    assert apres.status_code == 200, (
        "un verrou expiré doit être ignoré (et non lu comme un verrou actif), "
        f"sinon un compte reste bloqué par une donnée périmée : {apres.text}"
    )
