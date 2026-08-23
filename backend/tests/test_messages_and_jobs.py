"""Tests messages et jobs."""
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, WORKER_USER, BASE_JOB, AUTH_REQUIRED_STATUS,
    auth_headers, register_and_login, db_insert, db_find_one
)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestMessageAccess:
    async def test_get_messages_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/messages")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_get_conversation_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/messages/user1_user2")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_user_cannot_access_other_conversation(self, client: AsyncClient):
        """Un utilisateur ne peut pas lire la conversation de deux autres."""
        user_a = await register_and_login(client, BASE_USER)
        other1 = await register_and_login(client, {**BASE_USER, "email": "other1@kojo.sn"})
        other2 = await register_and_login(client, {**BASE_USER, "email": "other2@kojo.sn"})

        id1, id2 = sorted([other1["user"]["id"], other2["user"]["id"]])
        conversation_id = f"{id1}_{id2}"

        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.get(f"/api/messages/{conversation_id}", headers=headers_a)
        assert resp.status_code == 403

    async def test_user_can_access_own_conversation(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)

        id1, id2 = sorted([user_a["user"]["id"], user_b["user"]["id"]])
        conversation_id = f"{id1}_{id2}"

        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.get(f"/api/messages/{conversation_id}", headers=headers_a)
        assert resp.status_code == 200

    async def test_conversation_access_exact_id_check(self, client: AsyncClient):
        """La sous-chaîne ne doit pas suffire à passer le contrôle d'accès."""
        user_a = await register_and_login(client, BASE_USER)
        fake_id = f"x{user_a['user']['id']}x_otherid"

        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.get(f"/api/messages/{fake_id}", headers=headers_a)
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestSendMessage:
    async def test_send_message_requires_auth(self, client: AsyncClient):
        resp = await client.post("/api/messages", json={"receiver_id": "x", "content": "Bonjour"})
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_send_message_success(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}

        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Bonjour, je suis disponible.",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["sender_id"] == user_a["user"]["id"]
        assert data["content"] == "Bonjour, je suis disponible."

    async def test_send_message_persists_job_id(self, client: AsyncClient):
        """Le job_id doit être stocké sur le message."""
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}
        job_id = str(uuid.uuid4())

        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Concernant la mission.",
            "job_id": job_id,
        })
        assert resp.status_code == 200
        msg = await db_find_one("messages", {"job_id": job_id})
        assert msg is not None
        assert msg["job_id"] == job_id

    async def test_send_message_returns_full_message(self, client: AsyncClient):
        """Vérifie que la réponse contient le message créé (pas un texte générique)."""
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}

        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Test",
        })
        data = resp.json()
        assert "id" in data or "sender_id" in data

    async def test_send_empty_message_rejected(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"], "content": "",
        })
        assert resp.status_code == 422

    async def test_send_too_long_message_rejected(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"], "content": "x" * 5001,
        })
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestConversationOrdering:
    async def test_messages_ordered_chronologically(self, client: AsyncClient):
        """Les messages d'une conversation doivent être triés par timestamp ASC."""
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)

        id1, id2 = sorted([user_a["user"]["id"], user_b["user"]["id"]])
        conversation_id = f"{id1}_{id2}"
        now = datetime.now(timezone.utc)

        # Insère 3 messages dans le désordre (offsets 2, 0, 1 minutes) :
        # l'ordre d'insertion ne correspond PAS à l'ordre chronologique, ce qui
        # force le tri côté endpoint (Mongo sans tri renverrait l'ordre naturel).
        for content, offset in reversed([("Premier", 0), ("Deuxième", 1), ("Troisième", 2)]):
            await db_insert("messages", {
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "sender_id": user_a["user"]["id"],
                "receiver_id": user_b["user"]["id"],
                "content": content,
                "timestamp": (now + timedelta(minutes=offset)).isoformat(),
                "read": False,
            })

        headers = {"Authorization": f"Bearer {user_a['access_token']}"}
        resp = await client.get(f"/api/messages/{conversation_id}", headers=headers)
        assert resp.status_code == 200
        messages = resp.json()
        timestamps = [m["timestamp"] for m in messages]
        assert timestamps == sorted(timestamps), \
            "Les messages doivent être triés chronologiquement (timestamp ASC)"


@pytest.mark.asyncio
class TestMyProposals:
    async def test_my_proposals_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/proposals/mine")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_client_gets_empty_proposals(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.get("/api/proposals/mine", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_worker_gets_own_proposals(self, client: AsyncClient):
        worker = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        await db_insert("job_proposals", {
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "worker_id": worker["user"]["id"],
            "proposed_amount": 20000,
            "status": "pending",
        })
        # Proposition d'un autre worker - ne doit pas apparaître
        await db_insert("job_proposals", {
            "id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "worker_id": "other-worker-id",
            "proposed_amount": 15000,
            "status": "pending",
        })
        headers = {"Authorization": f"Bearer {worker['access_token']}"}
        resp = await client.get("/api/proposals/mine", headers=headers)
        assert resp.status_code == 200
        proposals = resp.json()
        assert len(proposals) == 1
        assert proposals[0]["job_id"] == job_id


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestJobs:
    async def test_get_jobs_public_for_anonymous(self, client: AsyncClient):
        """La liste des jobs est en LECTURE PUBLIQUE (découverte sans compte) :
        un visiteur anonyme reçoit les offres sans champs sensibles."""
        resp = await client.get("/api/jobs")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_get_job_public_strips_sensitive_fields(self, client: AsyncClient):
        """La vue publique est une ALLOWLIST (JobPublic) : identités, point geo,
        coordonnées GPS de localisation et champs internes/inconnus ne sortent
        JAMAIS, même s'ils sont présents dans le document MongoDB."""
        client_user = await register_and_login(client, BASE_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "title": "Mission publique test",
            "description": "Description suffisamment longue pour un job public de test.",
            "category": "plomberie",
            "budget_min": 10000,
            "budget_max": 30000,
            "location": {
                "address": "Dakar Plateau, Sénégal",
                "fullAddress": "Dakar Plateau, Sénégal",
                "city": "Dakar",
                "latitude": 14.6937,
                "longitude": -17.4441,
            },
            "client_id": client_user["user"]["id"],
            "assigned_worker_id": "worker-xyz",
            "accepted_proposal_id": "proposal-xyz",
            "shared_location": {"maps_url": "https://maps.google.com/?q=1,2"},
            "geo": {"type": "Point", "coordinates": [-17.4441, 14.6937]},
            "status": "open",
            "deleted": False,
            "created_at": "2026-08-22T10:00:00Z",
            "internal_note": "champ inconnu legacy à ne jamais exposer",
        })

        # Vue publique (anonyme) : rien de sensible ne sort, la fiche reste lisible.
        # On vide le jar de cookies du client (le login précédent y a laissé
        # kojo_session) pour simuler un vrai visiteur sans session.
        client.cookies.clear()
        resp = await client.get(f"/api/jobs/{job_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Mission publique test"
        assert data["location"]["address"] == "Dakar Plateau, Sénégal"
        # Identités + position partagée
        assert "client_id" not in data
        assert "assigned_worker_id" not in data
        assert "accepted_proposal_id" not in data
        assert "shared_location" not in data
        # Coordonnées brutes (point geo + location) jamais exposées
        assert "geo" not in data
        assert "latitude" not in data["location"]
        assert "longitude" not in data["location"]
        # Champs internes et champs inconnus du modèle : exclus par l'allowlist
        assert "deleted" not in data
        assert "created_at" not in data
        assert "_id" not in data
        assert "internal_note" not in data

        # Vue authentifiée : le document complet est renvoyé (comportement
        # historique — le frontend lit created_at en fallback d'affichage)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp_auth = await client.get(f"/api/jobs/{job_id}", headers=headers)
        assert resp_auth.status_code == 200
        data_auth = resp_auth.json()
        assert data_auth["client_id"] == client_user["user"]["id"]
        assert data_auth["shared_location"]["maps_url"] == "https://maps.google.com/?q=1,2"
        assert data_auth["location"]["latitude"] == 14.6937

    async def test_get_jobs_list_anonymous_is_allowlist(self, client: AsyncClient):
        """La LISTE publique applique la même allowlist que le détail : un job
        contenant des champs sensibles/inconnus ne les divulgue pas, et une
        fiche legacy invalide est écartée sans faire tomber la liste."""
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "title": "Mission liste publique",
            "description": "Description suffisamment longue pour un job public de test.",
            "category": "menuiserie",
            "budget_min": 5000,
            "budget_max": 15000,
            "location": {
                "address": "Bamako, Mali",
                "latitude": 12.6392,
                "longitude": -8.0029,
            },
            "client_id": "client-secret",
            "geo": {"type": "Point", "coordinates": [-8.0029, 12.6392]},
            "deleted": False,
            "status": "open",
            "secret_legacy_field": "à ne jamais exposer",
        })
        # Fiche legacy cassée (pas de title) : écartée du flux public, pas de 500
        await db_insert("jobs", {
            "id": str(uuid.uuid4()),
            "client_id": "client-b",
            "deleted": False,
            "status": "open",
        })

        resp = await client.get("/api/jobs")
        assert resp.status_code == 200
        items = resp.json()
        assert isinstance(items, list)
        item = next((j for j in items if j.get("id") == job_id), None)
        assert item is not None, "le job valide doit apparaître dans le flux public"
        assert item["title"] == "Mission liste publique"
        assert "client_id" not in item
        assert "geo" not in item
        assert "deleted" not in item
        assert "created_at" not in item
        assert "secret_legacy_field" not in item
        assert "latitude" not in item["location"]
        assert "longitude" not in item["location"]
        assert not any("client_id" in j for j in items), "aucune fiche ne divulgue client_id"

    async def test_create_job_requires_auth(self, client: AsyncClient):
        resp = await client.post("/api/jobs", json={"title": "Test"})
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_worker_cannot_create_job(self, client: AsyncClient):
        headers = await auth_headers(client, WORKER_USER)
        resp = await client.post("/api/jobs", headers=headers, json=BASE_JOB)
        assert resp.status_code in (400, 403)

    async def test_client_can_create_job(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.post("/api/jobs", headers=headers, json=BASE_JOB)
        assert resp.status_code == 200
        assert resp.json()["title"] == BASE_JOB["title"]

    async def test_get_jobs_returns_list(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.get("/api/jobs", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    async def test_worker_cannot_apply_twice(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)

        client_headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        job_resp = await client.post("/api/jobs", headers=client_headers, json=BASE_JOB)
        assert job_resp.status_code == 200
        job_id = job_resp.json()["id"]

        worker_headers = {"Authorization": f"Bearer {worker_user['access_token']}"}
        payload = {
            "proposed_amount": 10000,
            "estimated_completion_time": "2 jours",
            "message": "Je suis disponible et expérimenté pour ce travail.",
        }

        resp1 = await client.post(f"/api/jobs/{job_id}/proposals",
                                  headers=worker_headers, json=payload)
        assert resp1.status_code == 200

        resp2 = await client.post(f"/api/jobs/{job_id}/proposals",
                                  headers=worker_headers, json=payload)
        assert resp2.status_code in (400, 409)

    async def test_client_cannot_apply_to_own_job(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        job_resp = await client.post("/api/jobs", headers=headers, json=BASE_JOB)
        job_id = job_resp.json()["id"]

        resp = await client.post(f"/api/jobs/{job_id}/proposals", headers=headers,
                                 json={
                                     "proposed_amount": 7500,
                                     "estimated_completion_time": "1 jour",
                                     "message": "Je peux faire ce travail moi-même facilement.",
                                 })
        assert resp.status_code in (400, 403)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestHealth:
    async def test_health_endpoint(self, client: AsyncClient):
        with patch("server.is_database_available", AsyncMock(return_value=True)):
            resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] in ("healthy", "degraded")

    async def test_root_endpoint(self, client: AsyncClient):
        resp = await client.get("/")
        assert resp.status_code == 200

    async def test_favicon_returns_204(self, client: AsyncClient):
        resp = await client.get("/favicon.ico")
        assert resp.status_code == 204
