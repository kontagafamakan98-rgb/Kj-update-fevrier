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
# Récompense de parrainage (première mission du filleul)
# ---------------------------------------------------------------------------

async def _complete_job_with_payout(client, client_headers, job_id):
    """Clôture une mission avec décaissement PayDunya simulé (comme le test
    d'intégration). Retourne la réponse de /complete."""
    with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-referral"}), \
         patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_routers_jobs.notify_user", AsyncMock()):
        return await client.post(f"/api/jobs/{job_id}/complete", headers=client_headers)


async def _run_job_to_completion(client, client_headers, worker_headers):
    """Crée un job, le fait proposer/accepter, paie (checkout+IPN simulés) et
    le clôture. Retourne (job_id, worker_user_id)."""
    resp = await client.post("/api/jobs", headers=client_headers, json=BASE_JOB)
    assert resp.status_code == 200, resp.text
    job = resp.json()
    job_id = job["id"]

    resp = await client.post(
        f"/api/jobs/{job_id}/proposals",
        headers=worker_headers,
        json={
            "proposed_amount": 25000,
            "estimated_completion_time": "2 jours",
            "message": "Je suis disponible immédiatement pour cette mission.",
        },
    )
    assert resp.status_code == 200, resp.text
    proposal = (await client.get(f"/api/jobs/{job_id}/proposals", headers=client_headers)).json()[0]

    resp = await client.post(
        f"/api/jobs/{job_id}/proposals/{proposal['id']}/accept",
        headers=client_headers,
        json={"location": {"latitude": 14.69, "longitude": -17.44}},
    )
    assert resp.status_code == 200, resp.text

    mock_invoice = {"token": "invoice-token-referral", "response_code": "00"}
    with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
         patch("kojo_routers_payments.create_paydunya_invoice", return_value=mock_invoice), \
         patch("kojo_routers_payments.notify_user", AsyncMock()):
        resp = await client.post("/api/payments/checkout", headers=client_headers, json={
            "job_id": job_id,
            "amount": 25000,
            "payment_method": "orange_money",
            "country": "senegal",
        })
    assert resp.status_code == 200, resp.text
    payment_id = resp.json()["payment_id"]

    with patch("kojo_payments.is_paydunya_configured", return_value=True), \
         patch("kojo_payments.confirm_paydunya_invoice",
               return_value={"invoice": {"status": "completed"}}), \
         patch("kojo_routers_payments.notify_user", AsyncMock()):
        resp = await client.post("/api/payments/ipn/paydunya", json={
            "invoice": {"token": mock_invoice["token"], "status": "completed"},
            "custom_data": {"payment_id": payment_id},
        })
    assert resp.status_code == 200

    resp = await _complete_job_with_payout(client, client_headers, job_id)
    assert resp.status_code == 200, resp.text
    return job_id


@pytest.mark.asyncio
async def test_referral_reward_credited_on_filleul_first_job(client):
    """Quand le filleul termine sa première mission, le parrain ET le filleul
    reçoivent leur récompense (referral_reward_balance) et un historique est
    enregistré. Une seconde mission ne crédite plus (idempotent)."""
    import uuid as _uuid
    from tests.conftest import BASE_USER

    # 1. Le parrain (client) possède un code de parrainage
    sponsor_headers = await auth_headers(client)
    resp = await client.get("/api/users/referral", headers=sponsor_headers)
    sponsor_code = resp.json()["referral_code"]
    sponsor_user = (await db_find_one("users", {"email": BASE_USER["email"]}))

    # 2. Le filleul (travailleur) s'inscrit avec le code du parrain
    filleul_data = dict(WORKER_USER)
    filleul_data["email"] = f"filleul-{_uuid.uuid4().hex[:8]}@example.com"
    filleul_data["referral_code"] = sponsor_code.lower()
    filleul_headers = await auth_headers(client, filleul_data)
    filleul_user = (await db_find_one("users", {"email": filleul_data["email"]}))
    assert filleul_user.get("referred_by") == sponsor_code.upper()

    # 3. Le parrain crée un job, le filleul le réalise → 1ère mission terminée
    await _run_job_to_completion(client, sponsor_headers, filleul_headers)

    # 4. Les deux ont reçu leur récompense + historique
    sponsor_after = await db_find_one("users", {"id": sponsor_user["id"]})
    filleul_after = await db_find_one("users", {"id": filleul_user["id"]})
    assert sponsor_after["referral_reward_balance"] > 0
    assert filleul_after["referral_reward_balance"] > 0
    assert any(r["role"] == "parrain" for r in sponsor_after["referral_rewards"])
    assert any(r["role"] == "filleul" for r in filleul_after["referral_rewards"])
    assert filleul_after["referral_first_job_rewarded"] is True

    # 5. Le endpoint /users/referral expose le solde
    resp = await client.get("/api/users/referral", headers=filleul_headers)
    assert resp.json()["reward_balance"] == filleul_after["referral_reward_balance"]

    # 6. Une seconde mission ne crédite plus rien (idempotent)
    balance_before = sponsor_after["referral_reward_balance"]
    await _run_job_to_completion(client, sponsor_headers, filleul_headers)
    sponsor_after2 = await db_find_one("users", {"id": sponsor_user["id"]})
    assert sponsor_after2["referral_reward_balance"] == balance_before


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
    assert resp.json().get("referral_welcome_bonus") > 0

    # 4. Le nouveau compte est bien rattaché au parrain
    created = await db_find_one("users", {"email": "referral-signup@example.com"})
    assert created, "Nouvel utilisateur introuvable"
    assert created.get("referred_by") == sponsor_code.upper()

    # 5. Bonus de BIENVENUE crédité aux deux : le parrain et l'invité ont
    #    reçu leur part dans referral_reward_balance + historique (type welcome)
    sponsor = await db_find_one("users", {"email": BASE_USER["email"]})
    assert sponsor["referral_reward_balance"] > 0
    assert any(r["type"] == "welcome" and r["role"] == "parrain" for r in sponsor["referral_rewards"])
    assert created["referral_reward_balance"] > 0
    assert any(r["type"] == "welcome" and r["role"] == "filleul" for r in created["referral_rewards"])

    # 6. Sans code (ou code invalide), referral_applied est False, aucun
    #    bonus de bienvenue, et le compte reste valide (non bloquant)
    plain_user = dict(BASE_USER)
    plain_user["email"] = "referral-plain@example.com"
    token2 = await issue_email_verification_token(client, plain_user["email"])
    resp = await client.post(
        "/api/auth/register-verified",
        json={**plain_user, "email_verification_token": token2},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("referral_applied") is False
    assert resp.json().get("referral_welcome_bonus") == 0


@pytest.mark.asyncio
async def test_referral_filleuls_listed(client):
    """Le parrain voit la liste des comptes créés via son code (les filleuls),
    avec leur statut de première mission et la récompense générée."""
    import uuid as _uuid
    from tests.conftest import BASE_USER, issue_email_verification_token

    # 1. Le parrain (client) possède un code de parrainage
    sponsor_headers = await auth_headers(client)
    resp = await client.get("/api/users/referral", headers=sponsor_headers)
    sponsor_code = resp.json()["referral_code"]

    # 2. Deux filleuls s'inscrivent avec ce code
    filleul_ids = []
    for i in range(2):
        data = dict(WORKER_USER)
        data["email"] = f"filleul-list-{i}-{_uuid.uuid4().hex[:8]}@example.com"
        data["referral_code"] = sponsor_code.lower()
        token = await issue_email_verification_token(client, data["email"])
        resp = await client.post(
            "/api/auth/register-verified",
            json={**data, "email_verification_token": token},
        )
        assert resp.status_code == 200, resp.text
        filleul_ids.append(resp.json()["user"]["id"])

    # 3. Le parrain liste ses filleuls
    resp = await client.get("/api/users/referral/filleuls", headers=sponsor_headers)
    assert resp.status_code == 200, resp.text
    filleuls = resp.json()["filleuls"]
    assert len(filleuls) == 2
    listed_ids = {f["id"] for f in filleuls}
    assert listed_ids == set(filleul_ids)
    for f in filleuls:
        assert f["first_name"]
        assert f["completed_first_job"] is False
        # Chaque filleul a déjà reçu son bonus de bienvenue à l'inscription
        assert f["reward_earned"] > 0

    # 4. Un utilisateur sans filleul obtient une liste vide
    other_headers = await auth_headers(client, dict(WORKER_USER, email=f"noref-{_uuid.uuid4().hex[:8]}@example.com"))
    resp = await client.get("/api/users/referral/filleuls", headers=other_headers)
    assert resp.status_code == 200
    assert resp.json()["filleuls"] == []


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
