"""Tests du flux de décaissement / remboursement PayDunya.

Couvre les correctifs de l'audit du flux de remboursement :
- IPN disburse : mapping refund-aware (payout_kind == "refund") — un
  remboursement en attente confirmé par le callback PayDunya doit passer en
  refunded/refund_failed, pas en released/release_failed (statuts du
  versement travailleur).
- Remboursement (annulation d'une mission payée) : disburse_token persisté
  AVANT le submit ; une exception pendant le submit → "refunding" (réponse
  incertaine, à confirmer par l'IPN ou un check-status) au lieu de
  "refund_failed" définitif relançable (anti double-remboursement).
- Versement travailleur : même traitement (exception de submit → "releasing").
- GET /payments/status : re-vérification du décaissement en attente (l'IPN
  peut ne jamais arriver).
- Endpoint owner de relance des remboursements refund_failed.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, WORKER_USER,
    db_find_one, db_insert, register_and_login,
)


def _payment_doc(payment_id, job_id, payer_id, receiver_id, **overrides):
    doc = {
        "id": payment_id,
        "job_id": job_id,
        "payer_id": payer_id,
        "receiver_id": receiver_id,
        "amount": 25000,
        "worker_amount": 21000,
        "status": "completed",
        "payout_status": "held",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    doc.update(overrides)
    return doc


async def _create_paid_job(client, payout_status="held", payout_kind=None, disburse_token=None):
    """Client + travailleur + job in_progress + paiement completed séquestré."""
    client_user = await register_and_login(client, BASE_USER)
    worker_user = await register_and_login(client, WORKER_USER)
    job_id = str(uuid.uuid4())
    await db_insert("jobs", {
        "id": job_id,
        "title": "Réparation urgente",
        "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent à faire cette semaine.",
        "category": "plomberie",
        "client_id": client_user["user"]["id"],
        "assigned_worker_id": worker_user["user"]["id"],
        "budget_min": 15000,
        "budget_max": 25000,
        "location": {"address": "Dakar Plateau, Sénégal"},
        "status": "in_progress",
        "deleted": False,
    })
    payment_id = str(uuid.uuid4())
    overrides = {"payout_status": payout_status}
    if payout_kind is not None:
        overrides["payout_kind"] = payout_kind
    if disburse_token:
        overrides["disburse_token"] = disburse_token
    await db_insert("payments", _payment_doc(
        payment_id, job_id,
        client_user["user"]["id"], worker_user["user"]["id"],
        **overrides,
    ))
    return client_user, worker_user, job_id, payment_id


# ---------------------------------------------------------------------------
# 🔔 IPN disburse : mapping refund-aware (remboursement vs versement travailleur)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestDisburseIpnRefundAware:
    async def _send_ipn(self, client, token="tok-ipn", check_result=None):
        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value=check_result or {"status": "success", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            return await client.post("/api/payments/disburse-ipn", json={"token": token})

    async def test_refund_pending_confirmed_becomes_refunded(self, client: AsyncClient):
        """Un remboursement en attente confirmé par PayDunya → refunded
        (avant le correctif : 'released', le statut du versement travailleur)."""
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), "payer-1", "worker-1",
            payout_status="refunding", payout_kind="refund",
            disburse_token="tok-ipn",
        ))
        resp = await self._send_ipn(client, token="tok-ipn",
                                    check_result={"status": "success", "response_code": "00"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunded"

    async def test_refund_pending_failed_becomes_refund_failed(self, client: AsyncClient):
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), "payer-1", "worker-1",
            payout_status="refunding", payout_kind="refund",
            disburse_token="tok-ipn-fail",
        ))
        resp = await self._send_ipn(client, token="tok-ipn-fail",
                                    check_result={"status": "failed", "response_code": "01"})
        assert resp.status_code == 200
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refund_failed"

    async def test_worker_payout_ipn_still_maps_to_released(self, client: AsyncClient):
        """Sans payout_kind (versement travailleur), le mapping historique
        released/releasing/release_failed est conservé."""
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), "payer-1", "worker-1",
            payout_status="releasing", disburse_token="tok-worker",
        ))
        resp = await self._send_ipn(client, token="tok-worker",
                                    check_result={"status": "success", "response_code": "00"})
        assert resp.status_code == 200
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "released"

    async def test_refund_ipn_does_not_notify_deleted_payer(self, client: AsyncClient):
        """Audit IPN disburse + RGPD : un remboursement initié pendant
        delete_my_account peut rester en vol (refunding) et être tranché par
        l'IPN APRÈS la suppression du compte du payeur. Le paiement passe bien
        à refunded, mais AUCUNE notification orpheline n'est créée pour
        l'utilisateur supprimé (garde-fou dans kojo_shared.notify_user).
        Le chemin RÉEL de notification est exercé (pas de mock sur
        notify_user_localized)."""
        from kojo_core import db as core_db

        payer = await register_and_login(client, BASE_USER)
        payer_id = payer["user"]["id"]
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), payer_id, "worker-1",
            payout_status="refunding", payout_kind="refund",
            disburse_token="tok-ipn-deleted",
        ))

        # Le payeur supprime son compte pendant que le refund est en vol
        # (soft delete + anonymisation, exactement comme delete_my_account
        # le laisse faire quand l'IPN n'a pas encore tranché).
        await core_db.users.update_one(
            {"id": payer_id},
            {"$set": {"deleted": True, "email": "deleted_x@kojo.deleted"}},
        )

        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "success", "response_code": "00"}):
            resp = await client.post("/api/payments/disburse-ipn", json={"token": "tok-ipn-deleted"})

        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        # Le paiement est bien mis à jour (le refund a abouti côté PayDunya)…
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunded"
        # … mais aucune notification orpheline pour le compte supprimé.
        orphan = await db_find_one("notifications", {"user_id": payer_id})
        assert orphan is None


# ---------------------------------------------------------------------------
# 🤔 Submit incertain : une exception pendant submit-invoice ne doit PAS
# marquer un échec définitif relançable (double remboursement / double versement)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestRefundAmbiguousSubmit:
    async def test_delete_job_submit_exception_keeps_refunding(self, client: AsyncClient):
        client_user, _, job_id, payment_id = await _create_paid_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-ambig", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   side_effect=HTTPException(status_code=502, detail="timeout réseau")), \
             patch("kojo_routers_jobs.notify_user_localized", AsyncMock()):
            resp = await client.delete(f"/api/jobs/{job_id}", headers=headers)

        assert resp.status_code == 200, resp.text
        assert resp.json()["refund_status"] == "refunding"
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunding"
        # Le token est persisté AVANT le submit : le remboursement reste
        # confirmable via l'IPN ou un check-status ultérieur.
        assert payment["disburse_token"] == "refund-token-ambig"
        job = await db_find_one("jobs", {"id": job_id})
        assert job["status"] == "cancelled"
        assert job["deleted"] is True


@pytest.mark.asyncio
class TestWorkerPayoutAmbiguousSubmit:
    async def test_complete_job_submit_exception_keeps_releasing(self, client: AsyncClient):
        client_user, _, job_id, payment_id = await _create_paid_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "worker-token-ambig", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   side_effect=HTTPException(status_code=502, detail="timeout réseau")), \
             patch("kojo_routers_jobs.notify_user_localized", AsyncMock()):
            resp = await client.post(f"/api/jobs/{job_id}/complete", headers=headers)

        assert resp.status_code == 200, resp.text
        assert resp.json()["payout_status"] == "releasing"
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "releasing"
        assert payment["disburse_token"] == "worker-token-ambig"
        job = await db_find_one("jobs", {"id": job_id})
        assert job["status"] == "completed"


# ---------------------------------------------------------------------------
# 🔄 GET /payments/status : re-vérification du décaissement en attente
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestPaymentStatusRecheck:
    async def test_status_rechecks_pending_refund(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), client_user["user"]["id"], "worker-x",
            payout_status="refunding", payout_kind="refund",
            disburse_token="tok-recheck",
        ))
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            resp = await client.get(f"/api/payments/status/{payment_id}", headers=headers)

        assert resp.status_code == 200
        assert resp.json()["payout_status"] == "refunded"
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunded"

    async def test_status_does_not_call_paydunya_when_held(self, client: AsyncClient):
        """Aucun appel sortant pour un paiement non en attente de décaissement."""
        client_user = await register_and_login(client, BASE_USER)
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), client_user["user"]["id"], "worker-x",
        ))
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_payments.check_paydunya_disburse_status") as mock_check:
            resp = await client.get(f"/api/payments/status/{payment_id}", headers=headers)

        assert resp.status_code == 200
        mock_check.assert_not_called()


# ---------------------------------------------------------------------------
# 🎛️ Endpoint owner : relance des remboursements refund_failed
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestOwnerRetryRefund:
    async def _owner_payment(self, client, payout_status="refund_failed", payout_kind="refund"):
        owner_user = await register_and_login(client, BASE_USER)
        payment_id = str(uuid.uuid4())
        await db_insert("payments", _payment_doc(
            payment_id, str(uuid.uuid4()), owner_user["user"]["id"], "worker-x",
            payout_status=payout_status, payout_kind=payout_kind,
        ))
        return owner_user, payment_id

    async def test_owner_retries_failed_refund(self, client: AsyncClient):
        owner_user, payment_id = await self._owner_payment(client)
        headers = {"Authorization": f"Bearer {owner_user['access_token']}"}

        with patch("kojo_core.OWNER_EMAIL", owner_user["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", owner_user["user"]["id"]), \
             patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "retry-token", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_jobs.notify_user_localized", AsyncMock()):
            resp = await client.post(f"/api/owner/payments/{payment_id}/retry-refund", headers=headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["refund_status"] == "refunded"
        assert data["refunded_amount"] == 25000
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunded"

    async def test_owner_retry_rejected_when_not_refund_failed(self, client: AsyncClient):
        owner_user, payment_id = await self._owner_payment(client, payout_status="refunded")
        headers = {"Authorization": f"Bearer {owner_user['access_token']}"}

        with patch("kojo_core.OWNER_EMAIL", owner_user["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", owner_user["user"]["id"]):
            resp = await client.post(f"/api/owner/payments/{payment_id}/retry-refund", headers=headers)

        assert resp.status_code == 409

    async def test_owner_retry_rejected_for_worker_payout(self, client: AsyncClient):
        owner_user, payment_id = await self._owner_payment(client, payout_kind=None)
        headers = {"Authorization": f"Bearer {owner_user['access_token']}"}

        with patch("kojo_core.OWNER_EMAIL", owner_user["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", owner_user["user"]["id"]):
            resp = await client.post(f"/api/owner/payments/{payment_id}/retry-refund", headers=headers)

        assert resp.status_code == 400
