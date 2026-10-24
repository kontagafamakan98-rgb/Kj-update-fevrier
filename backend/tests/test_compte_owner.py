# -*- coding: utf-8 -*-
"""Le compte PROPRIÉTAIRE n'est ni un client ni un travailleur.

Ce que ces tests verrouillent (23/10/2026)
------------------------------------------
1. `ensure_owner_exists` RÉPARE un compte propriétaire existant auquel il manque
   `email_verified` : mesuré en production, le compte owner arrivait sur
   `/payment-verification` — « en tant que CLIENT, liez au moins 1 moyen de
   paiement » — parce que la porte des routes protégées juge l'email vérifié.
   Le propriétaire n'a pas d'inscription à terminer, et l'argent de la
   plateforme part directement sur son compte PayDunya : il n'a aucun moyen de
   paiement à déclarer.
2. La CRÉATION pose ces marqueurs dès le départ, pour que le défaut ne
   revienne pas avec le prochain compte recréé.
3. La réparation ne touche QUE le compte dont l'email est `OWNER_EMAIL` : un
   client ordinaire sans email vérifié le reste.
4. Le propriétaire peut LIRE les candidatures d'une mission : il peut déjà en
   accepter une (`POST …/proposals/{id}/accept`), donc lui refuser la liste le
   laissait devant « aucune proposition pour le moment » — un vide qui n'avait
   rien mesuré. Un tiers, lui, reçoit toujours 403.
"""
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from kojo_owner import ensure_owner_exists
from tests.conftest import (
    BASE_JOB,
    BASE_USER,
    WORKER_USER,
    auth_headers,
    db_find_one,
    db_insert,
)

OWNER_EMAIL_TEST = "proprietaire-test@kojo.sn"


def _owner_incomplet(email: str = OWNER_EMAIL_TEST) -> dict:
    """Le compte tel qu'il existe en production : créé par le serveur, sans
    `email_verified`, et sans moyen de paiement."""
    return {
        "id": "owner-id-test",
        "email": email,
        "password_hash": "hash-factice",
        "first_name": "Famakan",
        "last_name": "Kontaga Master",
        "user_type": "owner",
        "phone": "+223701234567",
        "country": "mali",
        "preferred_language": "fr",
        "profile_photo": None,
        "is_verified": True,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": "2026-10-01T00:00:00+00:00",
        "updated_at": "2026-10-01T00:00:00+00:00",
        "is_owner": True,
    }


def _patch_bootstrap(email: str = OWNER_EMAIL_TEST, mot_de_passe: str = "MotDePasseOwner123"):
    return (
        patch("kojo_owner.OWNER_EMAIL", email),
        patch("kojo_owner.OWNER_USER_ID", "owner-id-test"),
        patch("kojo_owner.OWNER_INITIAL_PASSWORD", mot_de_passe),
        patch("kojo_owner.is_database_available", return_value=True),
    )


@pytest.mark.asyncio
class TestBootstrapDuProprietaire:
    async def test_un_owner_existant_est_repare_sans_devenir_un_client(self):
        await db_insert("users", _owner_incomplet())

        patch_email, patch_id, patch_mdp, patch_db = _patch_bootstrap()
        with patch_email, patch_id, patch_mdp, patch_db:
            await ensure_owner_exists()

        owner = await db_find_one("users", {"email": OWNER_EMAIL_TEST})
        assert owner is not None
        assert owner["email_verified"] is True, (
            "sans email vérifié, le propriétaire est renvoyé sur "
            "/payment-verification à chaque connexion"
        )
        assert owner["is_verified"] is True
        assert owner["user_type"] == "owner"
        assert owner["is_owner"] is True
        # La réparation n'accorde AUCUN moyen de paiement : ce n'est pas son rôle.
        assert owner.get("payment_accounts") in (None, {})
        # Et elle ne réécrit pas l'identité du compte.
        assert owner["password_hash"] == "hash-factice"
        assert owner["last_name"] == "Kontaga Master"

    async def test_la_creation_pose_email_verifie_des_le_depart(self):
        patch_email, patch_id, patch_mdp, patch_db = _patch_bootstrap()
        with patch_email, patch_id, patch_mdp, patch_db:
            await ensure_owner_exists()

        owner = await db_find_one("users", {"email": OWNER_EMAIL_TEST})
        assert owner is not None
        assert owner["email_verified"] is True
        assert owner["user_type"] == "owner"
        assert owner["is_verified"] is True

    async def test_un_client_sans_email_verifie_nest_pas_touche(self):
        client_sans_verification = {
            **BASE_USER,
            "id": "client-ordinaire-test",
            "email": "client-ordinaire@kojo.sn",
        }
        client_sans_verification.pop("email_verified", None)
        await db_insert("users", client_sans_verification)

        patch_email, patch_id, patch_mdp, patch_db = _patch_bootstrap()
        with patch_email, patch_id, patch_mdp, patch_db:
            await ensure_owner_exists()

        client = await db_find_one("users", {"email": "client-ordinaire@kojo.sn"})
        assert client is not None
        assert client.get("email_verified") is not True, (
            "la réparation est bornée à l'email du propriétaire"
        )
        assert client["user_type"] == "client"


@pytest.mark.asyncio
class TestCandidaturesLuesParLeProprietaire:
    async def _mission_avec_candidature(self, client: AsyncClient):
        client_headers = await auth_headers(client, {**BASE_USER, "email": "client-mission@kojo.sn"})
        worker_headers = await auth_headers(client, {**WORKER_USER, "email": "worker-mission@kojo.sn"})
        tiers_headers = await auth_headers(client, {**BASE_USER, "email": "tiers-mission@kojo.sn"})

        reponse = await client.post("/api/jobs", headers=client_headers, json=BASE_JOB)
        assert reponse.status_code == 200, reponse.text
        job_id = reponse.json()["id"]

        reponse = await client.post(
            f"/api/jobs/{job_id}/proposals",
            headers=worker_headers,
            json={
                "proposed_amount": 25000,
                "estimated_completion_time": "2 jours",
                "message": "Je peux intervenir dès demain matin sur place.",
            },
        )
        assert reponse.status_code == 200, reponse.text
        return job_id, client_headers, tiers_headers

    async def test_le_proprietaire_lit_les_candidatures_dune_mission(self, client: AsyncClient):
        job_id, client_headers, _ = await self._mission_avec_candidature(client)
        # Le compte propriétaire se connecte normalement : c'est l'EMAIL du
        # secret qui le désigne, pas un champ choisi par le client.
        owner_headers = await auth_headers(
            client, {**BASE_USER, "email": OWNER_EMAIL_TEST, "first_name": "Famakan", "last_name": "Master"}
        )

        with patch("kojo_routers_jobs_tracking.OWNER_EMAIL", OWNER_EMAIL_TEST):
            reponse_owner = await client.get(f"/api/jobs/{job_id}/proposals", headers=owner_headers)
        assert reponse_owner.status_code == 200, reponse_owner.text
        candidatures = reponse_owner.json()
        assert len(candidatures) == 1
        assert candidatures[0]["worker_name"] == "Kojo Test", (
            "le propriétaire doit voir les mêmes candidatures enrichies que le client"
        )

        # Le CLIENT garde son accès.
        reponse_client = await client.get(f"/api/jobs/{job_id}/proposals", headers=client_headers)
        assert reponse_client.status_code == 200, reponse_client.text
        assert len(reponse_client.json()) == 1

    async def test_un_tiers_reste_refuse(self, client: AsyncClient):
        job_id, _, tiers_headers = await self._mission_avec_candidature(client)

        with patch("kojo_routers_jobs_tracking.OWNER_EMAIL", OWNER_EMAIL_TEST):
            reponse = await client.get(f"/api/jobs/{job_id}/proposals", headers=tiers_headers)
        assert reponse.status_code == 403, reponse.text
        assert reponse.json()["detail"] == "Access denied"
