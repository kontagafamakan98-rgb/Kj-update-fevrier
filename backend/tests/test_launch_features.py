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
         patch("kojo_routers_jobs.notify_user_localized", AsyncMock()):
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
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
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
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
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
    """Quand le filleul (travailleur) termine sa première mission, le parrain
    ET le filleul reçoivent leur récompense (referral_reward_balance) et un
    historique est enregistré. Aucun crédit n'est fait à l'inscription (le
    bonus n'est débloqué que par la première mission). Une seconde mission
    ne crédite plus (idempotent)."""
    import uuid as _uuid
    from tests.conftest import BASE_USER

    # 1. Le parrain (TRAVAILLEUR) possède un code de parrainage
    sponsor_email = f"sponsor-{_uuid.uuid4().hex[:8]}@example.com"
    sponsor_headers = await auth_headers(client, dict(WORKER_USER, email=sponsor_email))
    resp = await client.get("/api/users/referral", headers=sponsor_headers)
    assert resp.status_code == 200, resp.text
    sponsor_code = resp.json()["referral_code"]
    sponsor_user = (await db_find_one("users", {"email": sponsor_email}))
    assert sponsor_user["user_type"] == "worker"
    # Aucun crédit à l'inscription : le solde du parrain est à zéro
    assert float(sponsor_user.get("referral_reward_balance") or 0) == 0

    # 2. Le filleul (travailleur) s'inscrit avec le code du parrain
    filleul_data = dict(WORKER_USER)
    filleul_data["email"] = f"filleul-{_uuid.uuid4().hex[:8]}@example.com"
    filleul_data["referral_code"] = sponsor_code.lower()
    filleul_headers = await auth_headers(client, filleul_data)
    filleul_user = (await db_find_one("users", {"email": filleul_data["email"]}))
    assert filleul_user.get("referred_by") == sponsor_code.upper()
    # Le filleul n'a encore rien reçu (récompense débloquée à la 1ère mission)
    assert float(filleul_user.get("referral_reward_balance") or 0) == 0

    # 3. Un client crée un job, le filleul le réalise → 1ère mission terminée
    client_headers = await auth_headers(client)
    await _run_job_to_completion(client, client_headers, filleul_headers)

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
    await _run_job_to_completion(client, client_headers, filleul_headers)
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
    import uuid as _uuid

    # 1. Le parrainage est réservé aux TRAVAILLEURS : un client n'a pas de code
    client_headers = await auth_headers(client)
    resp = await client.get("/api/users/referral", headers=client_headers)
    assert resp.status_code == 403

    # 2. Un travailleur possède un code de parrainage (généré à la demande)
    sponsor_email = f"sponsor-{_uuid.uuid4().hex[:8]}@example.com"
    headers = await auth_headers(client, dict(WORKER_USER, email=sponsor_email))
    resp = await client.get("/api/users/referral", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["referral_code"]
    assert len(body["referral_code"]) == 10
    assert "register?ref=" in body["invite_url"]
    assert body["withdraw_minimum"] == 200

    # Le même code est stable
    resp2 = await client.get("/api/users/referral", headers=headers)
    assert resp2.json()["referral_code"] == body["referral_code"]

    # 3. Un autre travailleur applique le code
    worker_email = f"worker-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": body["referral_code"].lower()},  # insensible à la casse
        headers=worker_headers,
    )
    assert resp.status_code == 200, resp.text

    # 4. Un CLIENT ne peut pas appliquer de code (parrainage réservé aux
    #    travailleurs)
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": body["referral_code"]},
        headers=client_headers,
    )
    assert resp.status_code == 403

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

    # 5. Un travailleur DÉJÀ PARRAINÉ ne peut plus servir de parrain : son
    #    code n'est plus applicable (400).
    resp = await client.get("/api/users/referral", headers=worker_headers)
    referred_code = resp.json()["referral_code"]
    other_email = f"other-{_uuid.uuid4().hex[:8]}@example.com"
    other_headers = await auth_headers(client, dict(WORKER_USER, email=other_email))
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": referred_code},
        headers=other_headers,
    )
    assert resp.status_code == 400
    assert "déjà été parrainé" in resp.json()["detail"]
    # Le code n'a pas été appliqué
    other_user = await db_find_one("users", {"email": other_email})
    assert not other_user.get("referred_by")


@pytest.mark.asyncio
async def test_referral_code_applied_at_registration(client):
    """Le code de parrainage saisi dans le formulaire d'inscription (champ
    referral_code, pré-rempli depuis ?ref=) est appliqué au compte créé via
    register-verified : referred_by est enregistré côté nouveau user.

    Réservé aux travailleurs : un CLIENT qui saisit un code ne l'attache pas.
    Aucun crédit n'est fait à l'inscription (le bonus est débloqué quand le
    filleul termine sa première mission)."""
    import uuid as _uuid
    from tests.conftest import BASE_USER, WORKER_USER, db_find_one, issue_email_verification_token

    # 1. Un travailleur existant possède un code de parrainage
    sponsor_email = f"sponsor-{_uuid.uuid4().hex[:8]}@example.com"
    headers = await auth_headers(client, dict(WORKER_USER, email=sponsor_email))
    resp = await client.get("/api/users/referral", headers=headers)
    sponsor_code = resp.json()["referral_code"]

    # 2. Un nouvel utilisateur TRAVAILLEUR s'inscrit avec ce code
    new_user = dict(WORKER_USER)
    new_user["email"] = "referral-signup@example.com"
    new_user["referral_code"] = sponsor_code.lower()  # insensible à la casse

    token = await issue_email_verification_token(client, new_user["email"])
    payload = {**new_user, "email_verification_token": token}
    resp = await client.post("/api/auth/register-verified", json=payload)
    assert resp.status_code == 200, resp.text

    # 3. La réponse informe le frontend que le code a été appliqué
    assert resp.json().get("referral_applied") is True
    # Plus de bonus de bienvenue à l'inscription
    assert resp.json().get("referral_welcome_bonus") == 0

    # 4. Le nouveau compte est bien rattaché au parrain
    created = await db_find_one("users", {"email": "referral-signup@example.com"})
    assert created, "Nouvel utilisateur introuvable"
    assert created.get("referred_by") == sponsor_code.upper()

    # 5. AUCUN crédit à l'inscription : ni le parrain ni l'invité n'ont reçu
    #    de bonus (récompense débloquée uniquement à la 1ère mission du filleul)
    sponsor = await db_find_one("users", {"email": sponsor_email})
    assert float(sponsor.get("referral_reward_balance") or 0) == 0
    assert float(created.get("referral_reward_balance") or 0) == 0
    assert not any(r.get("type") == "welcome" for r in (sponsor.get("referral_rewards") or []))
    assert not any(r.get("type") == "welcome" for r in (created.get("referral_rewards") or []))

    # 6. Un CLIENT qui saisit un code ne l'attache pas (parrainage réservé
    #    aux travailleurs)
    plain_user = dict(BASE_USER)
    plain_user["email"] = "referral-plain@example.com"
    plain_user["referral_code"] = sponsor_code.lower()
    token2 = await issue_email_verification_token(client, plain_user["email"])
    resp = await client.post(
        "/api/auth/register-verified",
        json={**plain_user, "email_verification_token": token2},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("referral_applied") is False
    plain_created = await db_find_one("users", {"email": "referral-plain@example.com"})
    assert not plain_created.get("referred_by")

    # 7. Un travailleur DÉJÀ PARRAINÉ ne peut pas parrainer à son tour :
    #    son code n'est pas applicable à l'inscription d'un nouvel invité.
    referred_email = f"referred-{_uuid.uuid4().hex[:8]}@example.com"
    referred_headers = await auth_headers(client, dict(WORKER_USER, email=referred_email))
    # Ce travailleur applique le code du sponsor → il devient parrainé
    resp = await client.post(
        "/api/users/referral/apply",
        json={"code": sponsor_code},
        headers=referred_headers,
    )
    assert resp.status_code == 200, resp.text
    resp = await client.get("/api/users/referral", headers=referred_headers)
    referred_code = resp.json()["referral_code"]

    # Un nouvel invité s'inscrit avec le code du travailleur déjà parrainé
    new_invite = dict(WORKER_USER)
    new_invite["email"] = "referral-invite@example.com"
    new_invite["referral_code"] = referred_code.lower()
    token3 = await issue_email_verification_token(client, new_invite["email"])
    resp = await client.post(
        "/api/auth/register-verified",
        json={**new_invite, "email_verification_token": token3},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("referral_applied") is False
    invite_created = await db_find_one("users", {"email": "referral-invite@example.com"})
    assert not invite_created.get("referred_by")


@pytest.mark.asyncio
async def test_referral_filleuls_listed(client):
    """Le parrain voit la liste des comptes créés via son code (les filleuls),
    avec leur statut de première mission et la récompense générée."""
    import uuid as _uuid
    from tests.conftest import BASE_USER, issue_email_verification_token

    # 1. Le parrain (TRAVAILLEUR) possède un code de parrainage
    sponsor_email = f"sponsor-{_uuid.uuid4().hex[:8]}@example.com"
    sponsor_headers = await auth_headers(client, dict(WORKER_USER, email=sponsor_email))
    resp = await client.get("/api/users/referral", headers=sponsor_headers)
    sponsor_code = resp.json()["referral_code"]

    # 2. Deux filleuls (travailleurs) s'inscrivent avec ce code
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
        # Aucune récompense avant la première mission du filleul
        assert f["reward_earned"] == 0

    # 4. Un client ne peut pas lister de filleuls (parrainage réservé aux
    #    travailleurs)
    client_headers = await auth_headers(client)
    resp = await client.get("/api/users/referral/filleuls", headers=client_headers)
    assert resp.status_code == 403

    # 5. Un travailleur sans filleul obtient une liste vide
    other_headers = await auth_headers(client, dict(WORKER_USER, email=f"noref-{_uuid.uuid4().hex[:8]}@example.com"))
    resp = await client.get("/api/users/referral/filleuls", headers=other_headers)
    assert resp.status_code == 200
    assert resp.json()["filleuls"] == []


# ---------------------------------------------------------------------------
# Retrait du solde de récompenses de parrainage (décaissement PayDunya)
# ---------------------------------------------------------------------------

async def _credit_referral_balance(client, user_id, amount):
    import server as srv
    await srv.db.users.update_one(
        {"id": user_id},
        {"$set": {"referral_reward_balance": float(amount)}},
    )


@pytest.mark.asyncio
async def test_referral_withdraw_success(client):
    """Un travailleur retire ses récompenses via PayDunya : le décaissement est
    préparé/soumis, le solde passe à 0 et un historique de retrait est
    enregistré."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-withdraw"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_routers_users.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "released"
    assert body["reward_balance"] == 0

    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert float(worker_after["referral_reward_balance"]) == 0
    assert any(r.get("type") == "withdrawal" and r.get("amount") == -1500
               for r in worker_after["referral_rewards"])

    import server as srv
    payment = await srv.db.payments.find_one({"payout_kind": "referral"})
    assert payment is not None
    assert payment["payout_status"] == "released"
    assert payment["amount"] == 1500


@pytest.mark.asyncio
async def test_referral_withdraw_insufficient_balance(client):
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-low-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 50)

    resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 400
    assert "Solde insuffisant" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_referral_withdraw_client_forbidden(client):
    client_headers = await auth_headers(client)
    resp = await client.post("/api/users/referral/withdraw", headers=client_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_referral_withdraw_no_account(client):
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-noacc-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    # On retire les comptes de paiement directement en base (l'inscription
    # exige 2 moyens de paiement pour un travailleur).
    import server as srv
    await srv.db.users.update_one(
        {"id": worker["id"]}, {"$set": {"payment_accounts": {}}}
    )
    await _credit_referral_balance(client, worker["id"], 1500)

    resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 400
    assert "Aucun compte" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_referral_withdraw_pending_blocks_second(client):
    """Quand le décaissement est en attente (releasing), le solde reste intact
    et un second retrait est bloqué (409) pour éviter un double-décaissement."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-pend-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-pending"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "pending"}), \
         patch("kojo_routers_users.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "releasing"
    # Solde intact tant que le décaissement n'est pas confirmé
    assert float((await db_find_one("users", {"id": worker["id"]}))["referral_reward_balance"]) == 1500

    # Un second retrait est bloqué tant que le premier est en cours
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-2"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success"}):
        resp2 = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_referral_withdraw_ipn_confirms_and_decrements(client):
    """Un décaissement en attente confirmé par l'IPN disburse décrémente le
    solde et trace le retrait (idempotent)."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-ipn-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-ipn"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "pending"}), \
         patch("kojo_routers_users.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "releasing"
    assert float((await db_find_one("users", {"id": worker["id"]}))["referral_reward_balance"]) == 1500

    import server as srv
    payment = await srv.db.payments.find_one({"payout_kind": "referral"})
    disburse_token = payment["disburse_token"]

    # L'IPN disburse confirme le décaissement → solde décrémenté
    notify_mock = AsyncMock()
    with patch("kojo_routers_payments.check_paydunya_disburse_status",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
         patch("kojo_shared.notify_user_localized", notify_mock):
        resp = await client.post("/api/payments/disburse-ipn", json={
            "token": disburse_token,
            "disburse_invoice": disburse_token,
        })
    assert resp.status_code == 200, resp.text

    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert float(worker_after["referral_reward_balance"]) == 0
    withdrawals = [r for r in worker_after["referral_rewards"]
                   if r.get("type") == "withdrawal" and r.get("amount") == -1500]
    assert len(withdrawals) == 1  # une seule trace
    assert any(r.get("payment_id") == payment["id"] for r in withdrawals)
    success_calls = [c for c in notify_mock.call_args_list
                     if c.kwargs.get("key") == "referral_withdraw_success"]
    assert len(success_calls) == 1  # une seule notification de succès

    # DOUBLE-CALLBACK IPN : le même retrait est re-confirmé → idempotent.
    # Le solde ne doit PAS être décrémenté une 2ème fois, la trace ne doit
    # pas être dupliquée et aucune notification de succès redondante.
    with patch("kojo_routers_payments.check_paydunya_disburse_status",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
         patch("kojo_shared.notify_user_localized", notify_mock):
        resp = await client.post("/api/payments/disburse-ipn", json={
            "token": disburse_token,
            "disburse_invoice": disburse_token,
        })
    assert resp.status_code == 200

    worker_double = await db_find_one("users", {"id": worker["id"]})
    # Solde décrémenté UNE seule fois (pas -3000)
    assert float(worker_double["referral_reward_balance"]) == 0
    withdrawals = [r for r in worker_double["referral_rewards"]
                   if r.get("type") == "withdrawal" and r.get("amount") == -1500]
    assert len(withdrawals) == 1  # trace non dupliquée
    # Toujours une seule notification de succès au total
    success_calls = [c for c in notify_mock.call_args_list
                     if c.kwargs.get("key") == "referral_withdraw_success"]
    assert len(success_calls) == 1


@pytest.mark.asyncio
async def test_referral_withdraw_success_releases_lock(client):
    """Après un retrait RÉUSSI, le verrou anti double-retrait est levé : le
    travailleur peut relancer un retrait. Régression du bug où
    referral_withdrawal_in_progress restait posé pour toujours → 409 à vie."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-lock-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-lock-1"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "released"

    # Le verrou est bien levé (flag False, pas True ni absent)
    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert worker_after.get("referral_withdrawal_in_progress") is not True

    # Nouveau crédit puis nouveau retrait : PAS de 409 (verrou libéré)
    await _credit_referral_balance(client, worker["id"], 1500)
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-lock-2"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp2 = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "released"


@pytest.mark.asyncio
async def test_referral_withdraw_explicit_failure_releases_lock(client):
    """Après un retrait en ÉCHEC EXPLICITE (submit refusé par PayDunya), le
    verrou est levé : le solde est intact et le travailleur peut réessayer.
    Régression du bug : le message promettait de pouvoir réessayer, mais le
    flag restait posé → 409 à vie."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-fail-lock-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    notify_mock = AsyncMock()
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-fail"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "failed", "response_code": "01"}), \
         patch("kojo_shared.notify_user_localized", notify_mock):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "release_failed"
    assert resp.json()["reward_balance"] == 1500  # solde intact

    # PAS de double notification : le chemin d'échec synchrone passe par le
    # point unique de vérité (apply_referral_payout_confirmed) qui notifie
    # EXACTEMENT une fois referral_withdraw_failed (plus d'appel direct).
    failed_calls = [
        c for c in notify_mock.call_args_list
        if c.kwargs.get("key") == "referral_withdraw_failed"
    ]
    assert len(failed_calls) == 1, notify_mock.call_args_list

    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert worker_after.get("referral_withdrawal_in_progress") is not True

    # Le chemin d'échec passe par le point unique de vérité (kojo_shared) :
    # le flag d'idempotence referral_lock_released est posé sur le paiement.
    import server as srv
    payment_after = await srv.db.payments.find_one({"id": resp.json()["payment_id"]})
    assert payment_after.get("referral_lock_released") is True

    # Relance possible : le verrou est libéré
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-fail-2"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp2 = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "released"


@pytest.mark.asyncio
async def test_referral_withdraw_ipn_confirmation_releases_lock(client):
    """Un retrait en attente (releasing) confirmé par l'IPN disburse lève le
    verrou anti double-retrait : un nouveau retrait devient possible."""
    import uuid as _uuid
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-ipn-lock-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-ipn-lock"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "pending"}), \
         patch("kojo_routers_users.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "releasing"

    # Pendant l'attente, le verrou est posé (un second retrait est refusé)
    worker_pending = await db_find_one("users", {"id": worker["id"]})
    assert worker_pending.get("referral_withdrawal_in_progress") is True

    import server as srv
    payment = await srv.db.payments.find_one({"payout_kind": "referral"})
    disburse_token = payment["disburse_token"]

    # L'IPN confirme → le verrou est levé
    with patch("kojo_routers_payments.check_paydunya_disburse_status",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/payments/disburse-ipn", json={
            "token": disburse_token,
            "disburse_invoice": disburse_token,
        })
    assert resp.status_code == 200, resp.text

    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert worker_after.get("referral_withdrawal_in_progress") is not True
    assert float(worker_after["referral_reward_balance"]) == 0

    # Nouveau crédit puis nouveau retrait : plus de 409
    await _credit_referral_balance(client, worker["id"], 1500)
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-ipn-lock-2"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp2 = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "released"


@pytest.mark.asyncio
async def test_referral_withdraw_ipn_failure_releases_lock(client):
    """Un retrait en attente (releasing) dont l'ÉCHEC est tranchée par l'IPN
    disburse doit lever le verrou anti double-retrait (le solde est intact).
    Régression du bug : apply_referral_payout_confirmed ne traitait que le
    statut 'released' → un échec asynchrone laissait le verrou posé à vie."""
    import uuid as _uuid
    import server as srv
    from tests.conftest import WORKER_USER

    worker_email = f"withdraw-ipn-fail-{_uuid.uuid4().hex[:8]}@example.com"
    worker_headers = await auth_headers(client, dict(WORKER_USER, email=worker_email))
    worker = await db_find_one("users", {"email": worker_email})
    await _credit_referral_balance(client, worker["id"], 1500)

    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-ipn-fail"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "pending"}), \
         patch("kojo_routers_users.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "releasing"

    # Pendant l'attente, le verrou est posé
    worker_pending = await db_find_one("users", {"id": worker["id"]})
    assert worker_pending.get("referral_withdrawal_in_progress") is True

    payment = await srv.db.payments.find_one({"payout_kind": "referral"})
    disburse_token = payment["disburse_token"]

    # L'IPN tranche en ÉCHEC → le verrou doit être levé (solde intact)
    with patch("kojo_routers_payments.check_paydunya_disburse_status",
               return_value={"status": "failed", "response_code": "01"}), \
         patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp = await client.post("/api/payments/disburse-ipn", json={
            "token": disburse_token,
            "disburse_invoice": disburse_token,
        })
    assert resp.status_code == 200, resp.text

    worker_after = await db_find_one("users", {"id": worker["id"]})
    assert worker_after.get("referral_withdrawal_in_progress") is not True
    assert float(worker_after["referral_reward_balance"]) == 1500  # solde intact

    # Nouveau retrait possible : plus de 409
    with patch("kojo_routers_users.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "disburse-token-ipn-fail-2"}), \
         patch("kojo_routers_users.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_shared.notify_user_localized", AsyncMock()):
        resp2 = await client.post("/api/users/referral/withdraw", headers=worker_headers)
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "released"


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

    with patch("kojo_routers_jobs.notify_user_localized", new=AsyncMock()) as mock_notify:
        await _notify_matching_workers(job)
        mock_notify.assert_awaited()
        # le travailleur plombier reçoit une notification
        called_user_ids = {call.kwargs.get("user_id") for call in mock_notify.await_args_list}
        assert worker_id in called_user_ids
