"""Test d'intégration du flux complet de bout en bout.

Client crée un job → un travailleur propose → le client accepte → devis
(quote) puis paiement (checkout + IPN PayDunya simulés) → clôture de la
mission avec décaissement simulé vers le travailleur.

Tous les appels sortants PayDunya (création de facture, confirmation IPN,
décaissement) sont mockés : le test traverse les vrais endpoints HTTP et
vérifie les transitions d'état réelles en base, sans toucher au réseau.
"""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, WORKER_USER, BASE_JOB,
    register_and_login, db_find_one,
)

# Montant convenu entre le client et le travailleur (proposition acceptée).
PROPOSAL_AMOUNT = 25000


@pytest.mark.asyncio
class TestFullJobFlow:
    async def test_complete_flow_job_to_disbursement(self, client: AsyncClient):
        # ------------------------------------------------------------------
        # 1. Inscription du client et du travailleur
        # ------------------------------------------------------------------
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        client_headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        worker_headers = {"Authorization": f"Bearer {worker_user['access_token']}"}

        # ------------------------------------------------------------------
        # 2. Le client crée un job
        # ------------------------------------------------------------------
        resp = await client.post("/api/jobs", headers=client_headers, json=BASE_JOB)
        assert resp.status_code == 200, f"create job failed: {resp.text}"
        job = resp.json()
        job_id = job["id"]
        assert job["status"] == "open"

        # ------------------------------------------------------------------
        # 3. Le travailleur soumet une proposition
        # ------------------------------------------------------------------
        resp = await client.post(
            f"/api/jobs/{job_id}/proposals",
            headers=worker_headers,
            json={
                "proposed_amount": PROPOSAL_AMOUNT,
                "estimated_completion_time": "2 jours",
                "message": "Je suis disponible immédiatement pour cette mission.",
            },
        )
        assert resp.status_code == 200, f"proposal failed: {resp.text}"

        # ------------------------------------------------------------------
        # 4. Le client récupère les propositions et accepte
        # ------------------------------------------------------------------
        resp = await client.get(f"/api/jobs/{job_id}/proposals", headers=client_headers)
        assert resp.status_code == 200
        proposals = resp.json()
        assert len(proposals) == 1
        proposal = proposals[0]
        assert proposal["proposed_amount"] == PROPOSAL_AMOUNT

        resp = await client.post(
            f"/api/jobs/{job_id}/proposals/{proposal['id']}/accept",
            headers=client_headers,
            json={"location": {"latitude": 14.69, "longitude": -17.44}},
        )
        assert resp.status_code == 200, f"accept failed: {resp.text}"
        accepted_job = resp.json()["job"]
        assert accepted_job["status"] == "in_progress"
        assert accepted_job["assigned_worker_id"] == worker_user["user"]["id"]
        assert accepted_job["accepted_proposal_id"] == proposal["id"]

        # ------------------------------------------------------------------
        # 5. Devis (quote) : montant, commission Kojo et part travailleur
        # ------------------------------------------------------------------
        resp = await client.post("/api/payments/quote", json={
            "amount": PROPOSAL_AMOUNT,
            "payment_method": "orange_money",
            "country": "senegal",
        })
        assert resp.status_code == 200, f"quote failed: {resp.text}"
        quote = resp.json()
        # Taux effectif lu depuis la réponse (env ou base) → pas de valeur codée en dur.
        rate = quote["commission_rate"] / 100
        expected_commission = round(PROPOSAL_AMOUNT * rate)
        expected_worker_amount = PROPOSAL_AMOUNT - expected_commission
        assert quote["total_amount"] == PROPOSAL_AMOUNT
        assert quote["commission_amount"] == expected_commission
        assert quote["worker_amount"] == expected_worker_amount

        # ------------------------------------------------------------------
        # 6. Checkout : création de la facture PayDunya (mockée)
        # ------------------------------------------------------------------
        mock_invoice = {
            "token": "invoice-token-integration",
            "response_code": "00",
            "response_text": "https://paydunya.com/checkout-integration",
        }
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_routers_payments.create_paydunya_invoice", return_value=mock_invoice), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            resp = await client.post("/api/payments/checkout", headers=client_headers, json={
                "job_id": job_id,
                # Montant volontairement faux : le serveur doit utiliser celui
                # de la proposition acceptée, jamais l'input client.
                "amount": 1,
                "payment_method": "orange_money",
                "country": "senegal",
            })
        assert resp.status_code == 200, f"checkout failed: {resp.text}"
        checkout = resp.json()
        payment_id = checkout["payment_id"]
        assert checkout["total_amount"] == PROPOSAL_AMOUNT
        assert checkout["invoice_token"] == mock_invoice["token"]

        payment = await db_find_one("payments", {"id": payment_id})
        assert payment is not None
        assert payment["amount"] == PROPOSAL_AMOUNT
        assert payment["status"] == "pending"
        assert payment["payer_id"] == client_user["user"]["id"]
        assert payment["receiver_id"] == worker_user["user"]["id"]
        assert payment["commission_amount"] == expected_commission
        assert payment["worker_amount"] == expected_worker_amount
        assert payment.get("payout_status") is None  # rien de séquestré avant confirmation

        # ------------------------------------------------------------------
        # 7. IPN PayDunya : confirmation de la collecte (re-vérifiée serveur)
        # ------------------------------------------------------------------
        with patch("kojo_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_payments.confirm_paydunya_invoice",
                   return_value={"invoice": {"status": "completed"}}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            resp = await client.post("/api/payments/ipn/paydunya", json={
                "invoice": {"token": mock_invoice["token"], "status": "completed"},
                "custom_data": {"payment_id": payment_id},
            })
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["status"] == "completed"
        assert payment["payout_status"] == "held"  # escrow : fonds séquestrés
        assert payment.get("completed_at")

        # Statut visible par le client (source de vérité du job)
        resp = await client.get(f"/api/jobs/{job_id}/payment-status", headers=client_headers)
        assert resp.status_code == 200
        assert resp.json()["has_payment"] is True
        assert resp.json()["payment_status"] == "completed"
        assert resp.json()["payout_status"] == "held"
        assert resp.json()["worker_amount"] == expected_worker_amount

        # L'adresse du chantier est envoyée au travailleur dès confirmation
        # du paiement (shared_address_sent n'est posé qu'après insertion OK).
        job_after_payment = await db_find_one("jobs", {"id": job_id})
        assert job_after_payment.get("shared_address_sent") is True

        # ------------------------------------------------------------------
        # 8. Clôture de la mission : déclenche le décaissement simulé
        # ------------------------------------------------------------------
        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "disburse-token-integration"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_jobs.notify_user_localized", AsyncMock()):
            resp = await client.post(f"/api/jobs/{job_id}/complete", headers=client_headers)
        assert resp.status_code == 200, f"complete failed: {resp.text}"
        data = resp.json()
        assert data["payout_status"] == "released"
        assert data["job"]["status"] == "completed"

        # ------------------------------------------------------------------
        # 9. Vérifications finales en base
        # ------------------------------------------------------------------
        job_db = await db_find_one("jobs", {"id": job_id})
        assert job_db["status"] == "completed"
        assert job_db["assigned_worker_id"] == worker_user["user"]["id"]

        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "released"
        assert payment["disburse_token"] == "disburse-token-integration"
        assert payment["disburse_provider_response"]["status"] == "success"
        # Le travailleur est crédité de la part nette, après commission Kojo.
        assert payment["worker_amount"] == expected_worker_amount

        # Le travailleur voit aussi le décaissement via le statut du job
        resp = await client.get(f"/api/jobs/{job_id}/payment-status", headers=worker_headers)
        assert resp.status_code == 200
        assert resp.json()["payout_status"] == "released"

        # Mission déjà clôturée → une seconde clôture est refusée (409)
        resp = await client.post(f"/api/jobs/{job_id}/complete", headers=client_headers)
        assert resp.status_code == 409
