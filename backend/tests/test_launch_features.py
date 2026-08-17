"""
Tests des fonctionnalités de lancement : portfolio travailleur, parrainage,
accusés de lecture (read_at) et push matching à la création d'un job.
"""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from tests.conftest import (
    AUTH_REQUIRED_STATUS,
    BASE_JOB,
    WORKER_USER,
    auth_headers,
    db_find_one,
    register_and_login,
)


# ---------------------------------------------------------------------------
# Portfolio travailleur
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_portfolio_upload_get_remove(client):
    headers = await auth_headers(client, WORKER_USER)
    # Créer un profil travailleur
    profile = {
        "user_id": "x",
        "specialties": ["plomberie"],
        "portfolio_images": [],
    }
    resp = await client.put("/api/workers/profile", json=profile, headers=headers)
    assert resp.status_code == 200, resp.text

    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    with patch(
        "kojo_routers_users.upload_image_to_cloudinary",
        return_value={"photo_url": "https://res.cloudinary.com/kojo/portfolio_1.png", "public_id": "p1"},
    ):
        resp = await client.post(
            "/api/users/portfolio",
            files={"file": ("a.png", fake_png, "image/png")},
            headers=headers,
        )
    assert resp.status_code == 200, resp.text
    assert resp.json()["portfolio_images"] == ["https://res.cloudinary.com/kojo/portfolio_1.png"]

    resp = await client.get("/api/users/portfolio", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["portfolio_images"]) == 1

    resp = await client.delete("/api/users/portfolio/0", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["portfolio_images"] == []

    # Un client ne peut pas uploader de portfolio
    client_headers = await auth_headers(client)
    with patch(
        "kojo_routers_users.upload_image_to_cloudinary",
        return_value={"photo_url": "https://res.cloudinary.com/x.png", "public_id": "x"},
    ):
        resp = await client.post(
            "/api/users/portfolio",
            files={"file": ("a.png", fake_png, "image/png")},
            headers=client_headers,
        )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Parrainage
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_referral_code_generated_and_applied(client):
    headers = await auth_headers(client)
    resp = await client.get("/api/users/referral", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["referral_code"]
    assert len(body["referral_code"]) == 10
    assert "register?ref=" in body["invite_url"]

    # Le même code est stable
    resp2 = await client.get("/api/users/referral", headers=headers)
    assert resp2.json()["referral_code"] == body["referral_code"]

    # Un autre utilisateur applique le code
    worker_headers = await auth_headers(client, WORKER_USER)
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": body["referral_code"].lower()},  # insensible à la casse
        headers=worker_headers,
    )
    assert resp.status_code == 200, resp.text

    # Auto-parrainage interdit
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": body["referral_code"]},
        headers=headers,
    )
    assert resp.status_code == 400

    # Code invalide
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": "INVALIDCODE"},
        headers=worker_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_referral_code_applied_at_registration(client):
    """Le code de parrainage saisi dans le formulaire d'inscription (champ
    referral_code, pré-rempli depuis ?ref=) est appliqué au compte créé via
    register-verified : referred_by est enregistré côté nouveau user."""
    from tests.conftest import BASE_USER, db_find_one, issue_email_verification_token

    # 1. Un utilisateur existant possède un code de parrainage
    headers = await auth_headers(client)
    resp = await client.get("/api/users/referral", headers=headers)
    sponsor_code = resp.json()["referral_code"]

    # 2. Un nouvel utilisateur s'inscrit avec ce code dans referral_code
    new_user = dict(BASE_USER)
    new_user["email"] = "referral-signup@example.com"
    new_user["referral_code"] = sponsor_code.lower()  # insensible à la casse

    token = await issue_email_verification_token(client, new_user["email"])
    payload = {**new_user, "email_verification_token": token}
    resp = await client.post("/api/auth/register-verified", json=payload)
    assert resp.status_code == 200, resp.text

    # 3. La réponse informe le frontend que le code a été appliqué
    #    (pour afficher le message de confirmation à l'inscription)
    assert resp.json().get("referral_applied") is True

    # 4. Le nouveau compte est bien rattaché au parrain
    created = await db_find_one("users", {"email": "referral-signup@example.com"})
    assert created, "Nouvel utilisateur introuvable"
    assert created.get("referred_by") == sponsor_code.upper()

    # 5. Sans code (ou code invalide), referral_applied est False et le
    #    compte reste valide (non bloquant)
    plain_user = dict(BASE_USER)
    plain_user["email"] = "referral-plain@example.com"
    token2 = await issue_email_verification_token(client, plain_user["email"])
    resp = await client.post(
        "/api/auth/register-verified",
        json={**plain_user, "email_verification_token": token2},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("referral_applied") is False


# ---------------------------------------------------------------------------
# Accusés de lecture (read_at)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_message_read_at_marked_on_open(client):
    worker_headers = await auth_headers(client, WORKER_USER)
    client_headers = await auth_headers(client)

    # le client envoie un message au worker
    worker_user = (await db_find_one("users", {"email": WORKER_USER["email"]})) or {}
    worker_id = worker_user.get("id")
    resp = await client.post(
        "/api/messages",
        json={"receiver_id": worker_id, "content": "Bonjour, disponible ?"},
        headers=client_headers,
    )
    assert resp.status_code == 200, resp.text
    conversation_id = resp.json()["conversation_id"]

    # le worker ouvre la conversation → read + read_at
    resp = await client.get(f"/api/messages/{conversation_id}", headers=worker_headers)
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 1
    assert messages[0]["read"] is True
    assert messages[0]["read_at"] is not None


# ---------------------------------------------------------------------------
# Push matching à la création d'un job
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_push_matching_notifies_workers_with_matching_specialty(client):
    from kojo_routers_jobs import _notify_matching_workers
    from kojo_models import Job

    # Travailleur avec spécialité plomberie
    worker_headers = await auth_headers(client, WORKER_USER)
    profile = {"user_id": "x", "specialties": ["plomberie"], "portfolio_images": []}
    await client.put("/api/workers/profile", json=profile, headers=worker_headers)
    worker = await db_find_one("users", {"email": WORKER_USER["email"]})
    worker_id = worker["id"]

    job = Job(
        client_id="client-x",
        title="Fuite d'eau urgente",
        description="Réparer une fuite dans la salle de bain, intervention rapide.",
        category="plomberie",
        budget_min=10000,
        budget_max=30000,
        location={"address": "Dakar Plateau"},
    )

    with patch("kojo_routers_jobs.notify_user", new=AsyncMock()) as mock_notify:
        await _notify_matching_workers(job)
        mock_notify.assert_awaited()
        # le travailleur plombier reçoit une notification
        called_user_ids = {call.kwargs.get("user_id") for call in mock_notify.await_args_list}
        assert worker_id in called_user_ids
