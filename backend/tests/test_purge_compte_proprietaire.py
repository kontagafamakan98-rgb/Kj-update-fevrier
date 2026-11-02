# -*- coding: utf-8 -*-
"""La purge d'un compte par le propriétaire, et ce qu'elle efface vraiment.

── Pourquoi cette route existe (02/11/2026) ─────────────────────────────────

Mesuré ce jour sur la production : trois profils de test étaient PUBLICS au
sitemap (« CI Worker » et deux doublons « Famakan Kontaga »), donc dans la
preuve sociale de l'accueil et dans ce qu'un visiteur trouve en cherchant un
artisan. Aucune voie ne permettait de les retirer : la suppression existait en
SELF-SERVICE (`DELETE /users/account`, qui exige la session du titulaire), et
l'administration ne savait que restreindre ou bannir — deux décisions qui
laissent la page EN LIGNE. Il ne restait que la base de production elle-même.

`POST /owner/accounts/{id}/purge` comble ce trou. Ce qu'il ne fait PAS, et
c'est la moitié du contrat : il n'écrit pas une seconde cascade. Il appelle
`kojo_routers_users_account.supprimer_compte_utilisateur`, la MÊME fonction que
le self-service, et c'est ce partage que ces tests vérifient — une purge qui
laisserait derrière elle un profil travailleur ou une veille emploi serait une
seconde définition de « supprimé », et la moins tenue des deux.

── Ce que ces cas verrouillent ──────────────────────────────────────────────

1. La porte est FERMÉE : un compte ordinaire reçoit 403, et rien n'est effacé.
2. Le motif est EXIGÉ (400) : une suppression définitive sans motif écrit ne se
   relit pas six mois plus tard.
3. Les refus sont NOMMÉS : 404 inconnu, 409 sur le compte propriétaire, 409 sur
   un compte déjà supprimé.
4. La suppression est RÉELLE et PUBLIQUE : le profil disparaît du sitemap (le
   filtre est `deleted: True`, posé par la cascade) et de la base.
5. Le self-service n'a pas bougé : `DELETE /users/account` supprime toujours le
   compte du titulaire, par la même cascade.
"""
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from tests.conftest import BASE_USER, db_find_one, register_and_login

OWNER_EMAIL_TEST = "proprietaire-purge@kojo.sn"


@contextmanager
def _proprietaire(email: str = OWNER_EMAIL_TEST):
    """Le propriétaire se désigne par l'EMAIL, en production comme ici.

    Deux noms à patcher, et c'est voulu : `verify_owner_access` (la porte) lit
    `kojo_owner.OWNER_EMAIL`, tandis que `kojo_comptes_admin` relit
    `kojo_settings.OWNER_EMAIL` à l'appel pour refuser de purger ce compte.
    Patcher un seul des deux ferait diverger la porte et la garde.
    """
    with patch("kojo_owner.OWNER_EMAIL", email), patch("kojo_settings.OWNER_EMAIL", email):
        yield


def _entetes(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['access_token']}"}


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


async def _travailleur_connecte(client: AsyncClient, email: str = "ouvrier-purge@kojo.sn") -> dict:
    return await register_and_login(
        client,
        {
            **BASE_USER,
            "email": email,
            "first_name": "Moussa",
            "last_name": "Traoré",
            "user_type": "worker",
            "payment_accounts": {
                "orange_money": "+221771234567",
                "wave": "+221771234568",
                "holder_name": "Kojo Test",
            },
        },
    )


def _urls_sitemap(xml: str) -> list:
    """Les `loc>` d'un sitemap, sans regex sur le XML entier (lisibilité)."""
    return [
        bloc.split("<loc>", 1)[1].split("</loc>", 1)[0]
        for bloc in xml.split("<url>")[1:]
        if "<loc>" in bloc
    ]


@pytest.mark.asyncio
class TestLaPorteEstFermee:
    async def test_un_compte_ordinaire_ne_peut_pas_purger(self, client: AsyncClient):
        intrus = await _travailleur_connecte(client, "intrus-purge@kojo.sn")
        cible = await _travailleur_connecte(client, "cible-purge@kojo.sn")
        cible_id = cible["user"]["id"]

        with _proprietaire():
            resp = await client.post(
                f"/api/owner/accounts/{cible_id}/purge",
                json={"motif": "Tentative d'un compte ordinaire"},
                headers=_entetes(intrus),
            )

        assert resp.status_code in (401, 403), resp.text
        # Rien n'a été effacé : un refus ne laisse pas une purge à moitié faite.
        compte = await db_find_one("users", {"id": cible_id})
        assert compte and compte.get("deleted") is not True


@pytest.mark.asyncio
class TestLesRefusSontNommes:
    async def test_le_motif_est_exige(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        cible = await _travailleur_connecte(client, "sans-motif-purge@kojo.sn")
        cible_id = cible["user"]["id"]

        with _proprietaire():
            sans_motif = await client.post(
                f"/api/owner/accounts/{cible_id}/purge",
                json={},
                headers=_entetes(owner),
            )
            trop_court = await client.post(
                f"/api/owner/accounts/{cible_id}/purge",
                json={"motif": "ok"},
                headers=_entetes(owner),
            )

        assert sans_motif.status_code == 400
        assert "motif" in sans_motif.json()["detail"].lower()
        assert trop_court.status_code == 400
        compte = await db_find_one("users", {"id": cible_id})
        assert compte and compte.get("deleted") is not True

    async def test_le_proprietaire_ne_se_purge_pas_lui_meme(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        owner_id = owner["user"]["id"]

        with _proprietaire():
            resp = await client.post(
                f"/api/owner/accounts/{owner_id}/purge",
                json={"motif": "Test de garde sur le propriétaire"},
                headers=_entetes(owner),
            )

        assert resp.status_code == 409, resp.text
        assert "propriétaire" in resp.json()["detail"].lower()
        compte = await db_find_one("users", {"id": owner_id})
        assert compte and compte.get("deleted") is not True

    async def test_un_inconnu_est_404_et_un_supprime_est_409(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        deja = await _travailleur_connecte(client, "deja-purge@kojo.sn")
        deja_id = deja["user"]["id"]

        with _proprietaire():
            premiere = await client.post(
                f"/api/owner/accounts/{deja_id}/purge",
                json={"motif": "Profil de test créé par erreur"},
                headers=_entetes(owner),
            )
            seconde = await client.post(
                f"/api/owner/accounts/{deja_id}/purge",
                json={"motif": "Seconde purge du même compte"},
                headers=_entetes(owner),
            )
            inconnu = await client.post(
                "/api/owner/accounts/identifiant-qui-nexiste-pas/purge",
                json={"motif": "Compte introuvable, donc rien à purger"},
                headers=_entetes(owner),
            )

        assert premiere.status_code == 200, premiere.text
        assert seconde.status_code == 409, seconde.text
        assert "supprimé" in seconde.json()["detail"]
        assert inconnu.status_code == 404


@pytest.mark.asyncio
class TestLaPurgeEffaceEtRetireDuSitemap:
    async def test_le_profil_sort_du_sitemap_et_de_la_base(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        travailleur = await _travailleur_connecte(client, "profil-de-test-purge@kojo.sn")
        travailleur_id = travailleur["user"]["id"]

        # Il publie un profil travailleur : c'est ce qui rend la page publique
        # intéressante à effacer, et ce qu'une purge partielle laisserait.
        profil = await client.post(
            "/api/workers/profile",
            json={
                "user_id": travailleur_id,
                "description": "Profil de test, à retirer",
                "specialties": ["plomberie"],
                "experience_years": 3,
            },
            headers=_entetes(travailleur),
        )
        assert profil.status_code == 200, profil.text

        avant = await client.get("/api/sitemap.xml")
        assert avant.status_code == 200, avant.text
        assert any(u.endswith(f"/workers/{travailleur_id}") for u in _urls_sitemap(avant.text)), (
            "le profil doit être publié AVANT la purge, sinon le cas ne prouve "
            "pas qu'elle le retire"
        )

        with _proprietaire():
            purge = await client.post(
                f"/api/owner/accounts/{travailleur_id}/purge",
                json={"motif": "Profil de test publié par erreur"},
                headers=_entetes(owner),
            )
        assert purge.status_code == 200, purge.text
        assert purge.json().get("deleted") is True

        apres = await client.get("/api/sitemap.xml")
        assert apres.status_code == 200, apres.text
        assert not any(u.endswith(f"/workers/{travailleur_id}") for u in _urls_sitemap(apres.text)), (
            "un compte purgé ne doit plus être découvrable : c'est le fait qui "
            "rendait la production embarrassante"
        )

        compte = await db_find_one("users", {"id": travailleur_id})
        assert compte.get("deleted") is True
        # Anonymisation : ni nom, ni adresse réutilisable. Le profil, lui, part.
        assert not compte.get("first_name")
        assert not compte.get("last_name")
        # L'adresse est MASQUÉE, pas conservée : `deleted_<empreinte>@kojo.deleted`.
        adresse = compte.get("email") or ""
        assert adresse.startswith("deleted_") and adresse.endswith("@kojo.deleted"), adresse
        assert "profil-de-test-purge" not in adresse
        assert await db_find_one("worker_profiles", {"user_id": travailleur_id}) is None

    async def test_les_missions_du_client_purge_sont_annulees(self, client: AsyncClient):
        owner = await _proprietaire_connecte(client)
        client_session = await register_and_login(
            client, {**BASE_USER, "email": "client-purge@kojo.sn"}
        )
        client_id = client_session["user"]["id"]

        creation = await client.post(
            "/api/jobs",
            json={
                "title": "Plomberie à retirer",
                "description": "Mission d'un compte de test, publiée par erreur.",
                "category": "plomberie",
                "budget_min": 10000,
                "budget_max": 30000,
                "location": {"address": "Dakar Plateau, Sénégal", "lat": 14.69, "lng": -17.44},
            },
            headers=_entetes(client_session),
        )
        assert creation.status_code == 200, creation.text
        job_id = creation.json()["id"]

        with _proprietaire():
            purge = await client.post(
                f"/api/owner/accounts/{client_id}/purge",
                json={"motif": "Compte client de test, mission factice"},
                headers=_entetes(owner),
            )
        assert purge.status_code == 200, purge.text

        mission = await db_find_one("jobs", {"id": job_id})
        assert mission.get("deleted") is True
        assert mission.get("status") == "cancelled"
        assert "geo" not in mission, (
            "le point géospatial doit disparaître, pas rester vide : l'index "
            "ignore un document sans `geo`, il ne le situe plus"
        )
        assert not (mission.get("location") or {}).get("latitude"), (
            "une seule coordonnée restante suffirait à re-situer le compte purgé"
        )


@pytest.mark.asyncio
class TestLeSelfServiceNaPasBouge:
    async def test_le_titulaire_supprime_toujours_son_compte(self, client: AsyncClient):
        """La cascade a été extraite en fonction partagée : cette porte aussi."""
        titulaire = await _travailleur_connecte(client, "self-service-purge@kojo.sn")
        titulaire_id = titulaire["user"]["id"]

        resp = await client.delete("/api/users/account", headers=_entetes(titulaire))

        assert resp.status_code == 200, resp.text
        assert resp.json().get("deleted") is True
        compte = await db_find_one("users", {"id": titulaire_id})
        assert compte.get("deleted") is True
        assert not compte.get("first_name")
