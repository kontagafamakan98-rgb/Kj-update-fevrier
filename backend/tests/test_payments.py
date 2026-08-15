"""Tests des endpoints de paiement."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, WORKER_USER, AUTH_REQUIRED_STATUS,
    auth_headers, register_and_login, db_insert, db_find_one
)


async def _make_job(client_id, worker_id, proposal_id, amount):
    job = {
        "id": str(uuid.uuid4()),
        "title": "Plomberie urgente",
        "client_id": client_id,
        "status": "in_progress",
        "assigned_worker_id": worker_id,
        "accepted_proposal_id": proposal_id,
        "deleted": False,
    }
    proposal = {
        "id": proposal_id,
        "job_id": job["id"],
        "worker_id": worker_id,
        "proposed_amount": amount,
        "status": "accepted",
    }
    await db_insert("jobs", job)
    await db_insert("job_proposals", proposal)
    return job


@pytest.mark.asyncio
class TestIPNSecurity:
    async def test_ipn_ignores_unknown_payment(self, client: AsyncClient):
        resp = await client.post("/api/payments/ipn/paydunya", json={
            "invoice": {"token": "fake-token", "status": "completed"},
            "custom_data": {"payment_id": "nonexistent-id"},
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    async def test_ipn_does_not_trust_payload_status(self, client: AsyncClient):
        """Payload dit completed, PayDunya dit PENDING → statut ne change pas."""
        payment_id = str(uuid.uuid4())
        invoice_token = "legit-token-abc123"
        await db_insert("payments", {
            "id": payment_id,
            "invoice_token": invoice_token,
            "status": "pending",
            "payer_id": "user-1",
            "receiver_id": "worker-1",
            "amount": 50000,
        })

        # is_paydunya_configured est appelé EN INTERNE par kojo_payments
        # (sync_payment_status_with_paydunya), pas par le router — il faut
        # donc le patcher sur kojo_payments.
        with patch("kojo_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_payments.confirm_paydunya_invoice",
                   return_value={"invoice": {"status": "pending"}, "response_code": "01"}):
            resp = await client.post("/api/payments/ipn/paydunya", json={
                "invoice": {"token": invoice_token, "status": "completed"},
                "custom_data": {"payment_id": payment_id},
            })

        assert resp.status_code == 200
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["status"] != "completed"

    async def test_ipn_completes_when_paydunya_confirms(self, client: AsyncClient):
        """PayDunya confirme COMPLETED → statut passe à completed."""
        payment_id = str(uuid.uuid4())
        invoice_token = "confirmed-token-xyz"
        await db_insert("payments", {
            "id": payment_id,
            "invoice_token": invoice_token,
            "status": "pending",
            "payer_id": "user-1",
            "receiver_id": "worker-1",
            "amount": 30000,
        })

        with patch("kojo_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_payments.confirm_paydunya_invoice",
                   return_value={"invoice": {"status": "completed"}, "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user", AsyncMock()):
            resp = await client.post("/api/payments/ipn/paydunya", json={
                "invoice": {"token": invoice_token, "status": "pending"},
                "custom_data": {"payment_id": payment_id},
            })

        assert resp.status_code == 200
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["status"] == "completed"
        assert payment.get("payout_status") == "held"

    async def test_disburse_ipn_ignores_unknown_token(self, client: AsyncClient):
        resp = await client.post("/api/payments/disburse-ipn", json={
            "token": "unknown-token", "status": "success",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "ignored"

    async def test_disburse_ipn_verifies_with_paydunya(self, client: AsyncClient):
        """Payload dit success, PayDunya dit pending → payout_status reste releasing."""
        await db_insert("payments", {
            "id": str(uuid.uuid4()),
            "disburse_token": "real-disburse-token",
            "payout_status": "releasing",
        })
        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "01"}):
            resp = await client.post("/api/payments/disburse-ipn", json={
                "token": "real-disburse-token",
                "status": "success",
            })
        assert resp.status_code == 200
        payment = await db_find_one("payments", {"disburse_token": "real-disburse-token"})
        assert payment["payout_status"] != "released"


@pytest.mark.asyncio
class TestCheckoutAmountSecurity:
    async def test_checkout_requires_auth(self, client: AsyncClient):
        resp = await client.post("/api/payments/checkout", json={
            "job_id": "x", "amount": 1000, "payment_method": "orange_money"
        })
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_checkout_nonexistent_job(self, client: AsyncClient):
        headers = await auth_headers(client)
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": "nonexistent-job-id",
                "amount": 99999,
                "payment_method": "orange_money",
                "country": "senegal",
            })
        assert resp.status_code == 404

    async def test_checkout_rejects_non_owner(self, client: AsyncClient):
        client1 = await register_and_login(client, BASE_USER)
        worker = await register_and_login(client, WORKER_USER)
        proposal_id = str(uuid.uuid4())
        job = await _make_job(client1["user"]["id"], worker["user"]["id"], proposal_id, 25000)

        other = await register_and_login(client, {**BASE_USER, "email": "intrus@kojo.sn"})
        headers = {"Authorization": f"Bearer {other['access_token']}"}

        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job["id"], "amount": 25000,
                "payment_method": "orange_money", "country": "senegal",
            })
        assert resp.status_code == 403

    async def test_checkout_uses_proposal_amount_not_client_input(self, client: AsyncClient):
        """Le montant envoyé par le client (1 FCFA) doit être ignoré → 25000 depuis la proposition."""
        client1 = await register_and_login(client, BASE_USER)
        worker = await register_and_login(client, WORKER_USER)
        proposal_id = str(uuid.uuid4())
        job = await _make_job(client1["user"]["id"], worker["user"]["id"], proposal_id, 25000)

        headers = {"Authorization": f"Bearer {client1['access_token']}"}
        mock_invoice = {
            "token": "inv-token-123",
            "checkout_url": "https://paydunya.com/test",
            "response_code": "00",
        }

        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_routers_payments.create_paydunya_invoice",
                   return_value={"token": "inv-token-123",
                                 "checkout_url": "https://paydunya.com/test",
                                 "response_code": "00", "response_text": "OK"}):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job["id"],
                "amount": 1,  # tentative de fraude
                "payment_method": "orange_money",
                "country": "senegal",
            })

        if resp.status_code == 200:
            payment = await db_find_one("payments", {"job_id": job["id"]})
            assert payment is not None
            assert payment["amount"] == 25000

    async def test_checkout_job_without_worker_rejected(self, client: AsyncClient):
        client1 = await register_and_login(client, BASE_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "client_id": client1["user"]["id"],
            "status": "open",
            "deleted": False,
        })
        headers = {"Authorization": f"Bearer {client1['access_token']}"}
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job_id, "amount": 10000,
                "payment_method": "orange_money", "country": "senegal",
            })
        assert resp.status_code == 400


@pytest.mark.asyncio
class TestPaymentStatus:
    async def test_get_payment_status_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/payments/status/some-id")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_get_payment_status_not_found(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.get("/api/payments/status/nonexistent", headers=headers)
        assert resp.status_code == 404

    async def test_get_payment_status_own_payment(self, client: AsyncClient):
        result = await register_and_login(client, BASE_USER)
        payment_id = str(uuid.uuid4())
        await db_insert("payments", {
            "id": payment_id,
            "payer_id": result["user"]["id"],
            "status": "pending",
            "amount": 15000,
        })
        headers = {"Authorization": f"Bearer {result['access_token']}"}
        with patch("kojo_routers_payments.sync_payment_status_with_paydunya",
                   AsyncMock(side_effect=lambda p: p)):
            resp = await client.get(f"/api/payments/status/{payment_id}", headers=headers)
        assert resp.status_code == 200
