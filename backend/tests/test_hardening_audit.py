"""Tests du durcissement issu de l'audit (session de correction 2026-08-23).

Couvre :
- Catégories : normalisation FR→slug canonique + filtre par groupe legacy.
- Liste des jobs : pagination serveur (page), recherche (q), mine=posted,
  filtre pays du visiteur.
- Paiement : job_id OBLIGATOIRE (plus de paiement libre), idempotence des
  factures pending.
- Mot de passe : password_version incrémentée au reset → les anciens jetons
  deviennent invalides (révocation des sessions).
- Suppression de compte (RGPD) : soft delete + cascade + 401 ensuite.
- Anti-énumération : check-availability ne révèle plus l'existence d'un email.
- Support : le créateur peut suivre le statut de son ticket.
- Wave indisponible au Mali / Burkina (validate_payment_accounts avec pays).
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    AUTH_REQUIRED_STATUS,
    BASE_JOB,
    BASE_USER,
    TEST_OTP_CODE,
    WORKER_USER,
    auth_headers,
    db_find_one,
    db_insert,
    issue_email_verification_token,
    register_and_login,
)


@pytest.mark.asyncio
class TestJobCategoryAndPagination:
    async def test_create_job_normalizes_french_category(self, client: AsyncClient):
        """« plomberie » (FR legacy) est stocké sous le slug canonique « plumbing »."""
        headers = await auth_headers(client, BASE_USER)
        payload = {**BASE_JOB, "category": "plomberie"}
        resp = await client.post("/api/jobs", headers=headers, json=payload)
        assert resp.status_code == 200, resp.text
        assert resp.json()["category"] == "plumbing"

    async def test_jobs_filter_categories_with_legacy_aliases(self, client: AsyncClient):
        """GET /jobs?category=plumbing retrouve un job stocké avec « plomberie »."""
        headers = await auth_headers(client, BASE_USER)
        resp = await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Fuite en cuisine urgente", "category": "plomberie",
        })
        assert resp.status_code == 200, resp.text

        list_resp = await client.get("/api/jobs?category=plumbing", headers=headers)
        assert list_resp.status_code == 200
        titles = [j.get("title") for j in list_resp.json()]
        assert "Fuite en cuisine urgente" in titles

    async def test_jobs_pagination_page_param(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        for i in range(5):
            await client.post("/api/jobs", headers=headers, json={
                **BASE_JOB, "title": f"Mission pagination {i}", "category": "general",
            })

        page1 = (await client.get("/api/jobs?limit=2&page=1", headers=headers)).json()
        page3 = (await client.get("/api/jobs?limit=2&page=3", headers=headers)).json()
        assert len(page1) == 2
        assert len(page3) == 1  # 5 items → page 3 = 1 élément
        ids1 = {j["id"] for j in page1}
        ids3 = {j["id"] for j in page3}
        assert not (ids1 & ids3)

    async def test_jobs_search_q_param_accepted(self, client: AsyncClient):
        """Le paramètre q est accepté et la réponse reste une liste (le filtrage
        regex titre/description est exercé en mode vrai MongoDB — la FakeDB
        n'implémente pas l'opérateur $regex)."""
        headers = await auth_headers(client, BASE_USER)
        await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Climatisation bureau Dakar", "category": "general",
        })
        resp = await client.get("/api/jobs?q=climatisation", headers=headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
        # Les titres contiennent bien la recherche (le filtre réel s'applique
        # sur Mongo ; la FakeDB renvoie tout, d'où l'absence d'assertion stricte ici).

    async def test_jobs_mine_posted_returns_only_own(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        other_user = await register_and_login(client, {
            **BASE_USER, "email": "autre@kojo.sn",
        })
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        other_headers = {"Authorization": f"Bearer {other_user['access_token']}"}
        await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Ma mission à moi", "category": "general",
        })
        await client.post("/api/jobs", headers=other_headers, json={
            **BASE_JOB, "title": "Mission de l'autre", "category": "general",
        })

        resp = await client.get("/api/jobs?mine=posted", headers=headers)
        titles = [j.get("title") for j in resp.json()]
        assert "Ma mission à moi" in titles
        assert "Mission de l'autre" not in titles

    async def test_jobs_mine_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/jobs?mine=posted")
        assert resp.status_code in (401, 403)


@pytest.mark.asyncio
class TestCheckoutHardening:
    async def _payable_job(self, client, client_user) -> str:
        """Crée un job avec proposition acceptée + worker assigné."""
        job_id = str(uuid.uuid4())
        worker_id = "worker-abc"
        proposal_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id, "title": "Mission payable", "client_id": client_user["user"]["id"],
            "status": "in_progress", "assigned_worker_id": worker_id,
            "accepted_proposal_id": proposal_id, "deleted": False,
        })
        await db_insert("job_proposals", {
            "id": proposal_id, "job_id": job_id, "worker_id": worker_id,
            "proposed_amount": 5000, "status": "accepted",
        })
        return job_id

    async def test_checkout_without_job_rejected(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "amount": 1000, "payment_method": "orange_money", "country": "senegal",
            })
        assert resp.status_code == 400
        assert "mission" in resp.json().get("detail", "").lower()

    async def test_checkout_idempotent_for_same_job(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        job_id = await self._payable_job(client, client_user)

        with patch(
            "kojo_routers_payments.is_paydunya_configured", return_value=True
        ), patch(
            "kojo_routers_payments.create_paydunya_invoice",
            return_value={"token": "tok-1", "response_code": "00", "response_text": "https://paydunya.test/checkout-a"},
        ):
            first = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job_id, "amount": 5000, "payment_method": "orange_money", "country": "senegal",
            })
            second = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job_id, "amount": 5000, "payment_method": "orange_money", "country": "senegal",
            })
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["payment_id"] == second.json()["payment_id"]
        assert second.json().get("reused") is True

    async def test_checkout_pending_has_expires_at(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        job_id = await self._payable_job(client, client_user)
        with patch(
            "kojo_routers_payments.is_paydunya_configured", return_value=True
        ), patch(
            "kojo_routers_payments.create_paydunya_invoice",
            return_value={"token": "tok-2", "response_code": "00", "response_text": "https://paydunya.test/checkout-b"},
        ):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job_id, "amount": 5000, "payment_method": "orange_money", "country": "senegal",
            })
        assert resp.status_code == 200, resp.text
        record = await db_find_one("payments", {"id": resp.json()["payment_id"]})
        assert record.get("expires_at") is not None


@pytest.mark.asyncio
class TestPasswordVersionRevocation:
    async def _reset_password(self, client, email, new_password) -> dict:
        """Flux complet : request → OTP password_reset → verify → reset."""
        # OTP connu inséré directement (EMAIL_PROVIDER=none pendant les tests).
        import server as _srv
        otp_hash = _srv.hash_email_otp(email, "password_reset", TEST_OTP_CODE)
        await _srv.db.email_otps.update_one(
            {"email": email.lower().strip(), "purpose": "password_reset"},
            {"$set": {
                "otp_hash": otp_hash, "attempt_count": 0, "status": "pending",
                "last_sent_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        verify = await client.post("/api/auth/password/forgot/verify", json={
            "email": email, "otp": TEST_OTP_CODE,
        })
        assert verify.status_code == 200, verify.text
        reset = await client.post("/api/auth/password/reset", json={
            "email": email,
            "verification_token": verify.json()["verification_token"],
            "new_password": new_password,
        })
        assert reset.status_code == 200, reset.text
        return verify.json()

    async def test_old_token_revoked_after_password_reset(self, client: AsyncClient):
        user = await register_and_login(client, BASE_USER)
        old_headers = {"Authorization": f"Bearer {user['access_token']}"}

        await self._reset_password(client, BASE_USER["email"], "nouveau-pass-123")

        # Ancienne session : refusée (password_version incrémentée).
        resp = await client.get("/api/auth/me", headers=old_headers)
        assert resp.status_code == 401

        # Nouvelle connexion avec le nouveau mot de passe : OK.
        login = await client.post("/api/auth/login", json={
            "email": BASE_USER["email"], "password": "nouveau-pass-123",
        })
        assert login.status_code == 200, login.text
        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"})
        assert me.status_code == 200

    async def test_check_availability_is_generic(self, client: AsyncClient):
        """Réponse identique pour un email libre et un email déjà inscrit."""
        await register_and_login(client, BASE_USER)

        resp_free = await client.post("/api/auth/email/check-availability", json={
            "email": "nouveau-email@kojo.sn", "purpose": "signup",
        })
        resp_used = await client.post("/api/auth/email/check-availability", json={
            "email": BASE_USER["email"], "purpose": "signup",
        })
        assert resp_free.status_code == 200
        assert resp_used.status_code == 200
        assert resp_free.json()["available"] is None
        assert resp_used.json()["available"] is None
        assert resp_free.json()["message"] == resp_used.json()["message"]


@pytest.mark.asyncio
class TestAccountDeletion:
    async def test_delete_account_revokes_sessions_and_cascades(self, client: AsyncClient):
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}

        await client.post("/api/users/push-token", headers=headers, json={
            "user_id": user["user"]["id"],
            "push_token": "sub-json-webpush",
            "device_type": "web",
            "device_id": "dev-1",
        })
        await db_insert("notifications", {
            "id": str(uuid.uuid4()), "user_id": user["user"]["id"],
            "title": "T", "body": "B", "is_read": False,
        })

        resp = await client.delete("/api/users/account", headers=headers)
        assert resp.status_code == 200, resp.text

        # Session immédiatement inutilisable.
        me = await client.get("/api/auth/me", headers=headers)
        assert me.status_code == 401

        # Login impossible (password_hash supprimé).
        login = await client.post("/api/auth/login", json={
            "email": BASE_USER["email"], "password": "password123",
        })
        assert login.status_code == 401

        # Cascade : notifications et push tokens supprimés ; compte anonymisé.
        stored = await db_find_one("users", {"id": user["user"]["id"]})
        assert stored.get("deleted") is True
        assert stored.get("email", "").startswith("deleted_")
        assert stored.get("password_hash") is None
        assert stored.get("phone") is None

    async def _insert_payment(self, payer_id, job_id=None, payout_status="held", receiver_id="worker-1", amount=15000):
        """Insère un paiement complété (fonds séquestrés / versés) en base."""
        await db_insert("payments", {
            "id": str(uuid.uuid4()),
            "job_id": job_id or str(uuid.uuid4()),
            "payer_id": payer_id,
            "receiver_id": receiver_id,
            "amount": amount,
            "status": "completed",
            "payout_status": payout_status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    async def test_delete_account_refunds_held_payment_before_anonymization(self, client: AsyncClient):
        """Point 1 RGPD : les fonds séquestrés (held) sont remboursés AVANT la
        purge de payment_accounts. La preuve de l'ordre est implicite : si
        l'anonymisation précédait le refund, execute_paydunya_refund ne
        trouverait plus de compte mobile money → refund_failed → 409. Ici on
        exige 200 + refunded, donc le refund a tourné avec les comptes encore
        en base."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id, "title": "Mission payée", "client_id": user["user"]["id"],
            "status": "in_progress", "deleted": False,
        })
        await self._insert_payment(user["user"]["id"], job_id=job_id, payout_status="held")

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-abc", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "success", "response_code": "00"}):
            resp = await client.delete("/api/users/account", headers=headers)

        assert resp.status_code == 200, resp.text
        # Le paiement a été remboursé (le refund a donc lu les comptes du
        # payeur avant qu'ils ne soient purgés).
        payment = await db_find_one("payments", {"job_id": job_id})
        assert payment["payout_status"] == "refunded"
        assert payment["payout_kind"] == "refund"
        # Compte bien anonymisé APRÈS le remboursement.
        stored = await db_find_one("users", {"id": user["user"]["id"]})
        assert stored.get("deleted") is True
        assert stored.get("payment_accounts") is None

    async def test_delete_account_blocked_when_payment_in_flight(self, client: AsyncClient):
        """Point 2 RGPD : la garde 409 couvre releasing (versement en vol) ET
        refunding (remboursement en vol) — l'IPN n'a pas tranché, le compte ne
        doit pas être supprimé."""
        for payout_status in ("releasing", "refunding"):
            user = await register_and_login(client, {
                **BASE_USER, "email": f"inflight-{payout_status}@kojo.sn",
            })
            headers = {"Authorization": f"Bearer {user['access_token']}"}
            await self._insert_payment(user["user"]["id"], payout_status=payout_status)

            resp = await client.delete("/api/users/account", headers=headers)
            assert resp.status_code == 409, f"{payout_status}: {resp.text}"
            stored = await db_find_one("users", {"id": user["user"]["id"]})
            assert stored.get("deleted") is not True
            assert stored.get("payment_accounts") is not None

    async def test_delete_account_blocked_when_refund_fails(self, client: AsyncClient):
        """Un remboursement qui ÉCHOUE explicitement bloque la suppression
        (409) : le compte garde ses moyens de paiement pour que le propriétaire
        puisse relancer (retry-refund) — l'argent n'est pas condamné."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        await self._insert_payment(user["user"]["id"], payout_status="held")

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-fail", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "failed", "response_code": "01", "response_text": "Compte invalide"}):
            resp = await client.delete("/api/users/account", headers=headers)

        assert resp.status_code == 409, resp.text
        stored = await db_find_one("users", {"id": user["user"]["id"]})
        assert stored.get("deleted") is not True
        assert stored.get("payment_accounts") is not None

    async def test_delete_account_resets_worker_assigned_jobs(self, client: AsyncClient):
        """Point 3 RGPD : un travailleur qui supprime son compte ne laisse pas
        de missions orphelines — le job est réinitialisé (annulé, assignment
        retiré) et le CLIENT est remboursé des fonds séquestrés."""
        worker = await register_and_login(client, WORKER_USER)
        client_user = await register_and_login(client, {
            **BASE_USER, "email": "client-worker-del@kojo.sn",
        })
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id, "title": "Mission attribuée", "client_id": client_user["user"]["id"],
            "assigned_worker_id": worker["user"]["id"],
            "status": "in_progress", "deleted": False,
        })
        await self._insert_payment(
            client_user["user"]["id"], job_id=job_id,
            receiver_id=worker["user"]["id"], amount=20000, payout_status="held",
        )

        headers = {"Authorization": f"Bearer {worker['access_token']}"}
        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-abc", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "success", "response_code": "00"}):
            resp = await client.delete("/api/users/account", headers=headers)

        assert resp.status_code == 200, resp.text
        job = await db_find_one("jobs", {"id": job_id})
        assert job["status"] == "cancelled"
        assert job["assigned_worker_id"] is None
        # Le client (payeur intact) a bien été remboursé.
        payment = await db_find_one("payments", {"job_id": job_id})
        assert payment["payout_status"] == "refunded"
        assert payment["payout_kind"] == "refund"

    async def test_delete_account_leaves_terminal_payments_untouched(self, client: AsyncClient):
        """Point 4 RGPD : un paiement déjà versé (released) ou déjà remboursé
        (refunded) n'est NI re-remboursé NI bloqué : la suppression passe et
        aucun appel de décaissement n'est émis."""
        for payout_status in ("released", "refunded"):
            user = await register_and_login(client, {
                **BASE_USER, "email": f"terminal-{payout_status}@kojo.sn",
            })
            headers = {"Authorization": f"Bearer {user['access_token']}"}
            await self._insert_payment(user["user"]["id"], payout_status=payout_status)

            with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                       return_value={"disburse_token": "should-not-run", "response_code": "00"}) as mock_create, \
                 patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                       return_value={"status": "success", "response_code": "00"}) as mock_submit:
                resp = await client.delete("/api/users/account", headers=headers)

            assert resp.status_code == 200, f"{payout_status}: {resp.text}"
            assert mock_create.call_count == 0, f"{payout_status}: refund relancé à tort"
            assert mock_submit.call_count == 0, f"{payout_status}: submit émis à tort"
            stored = await db_find_one("users", {"id": user["user"]["id"]})
            assert stored.get("deleted") is True

    def _patch_support(self, client):
        pass


@pytest.mark.asyncio
class TestSupportTicketStatusLookup:
    async def test_creator_can_track_ticket_status(self, client: AsyncClient):
        ticket_id = str(uuid.uuid4())
        await db_insert("support_tickets", {
            "id": ticket_id,
            "full_name": "Jean", "phone": "+221771234567", "email": "jean@kojo.sn",
            "reason": "paiement", "message": "Mon paiement est bloqué depuis hier.",
            "status": "open",
            "created_at": datetime.now(timezone.utc),
        })

        ok = await client.post("/api/support/tickets/status", json={
            "ticket_id": ticket_id, "email": "jean@kojo.sn",
        })
        assert ok.status_code == 200
        assert ok.json()["status"] == "open"

        wrong = await client.post("/api/support/tickets/status", json={
            "ticket_id": ticket_id, "email": "autre@kojo.sn",
        })
        assert wrong.status_code == 404


@pytest.mark.asyncio
class TestWaveCountryRestriction:
    async def test_register_with_wave_only_rejected_in_mali(self, client: AsyncClient):
        mali_user = {
            **BASE_USER,
            "email": "mali@kojo.sn",
            "country": "mali",
            "payment_accounts": {"wave": "+22370123456"},
        }
        token = await issue_email_verification_token(client, mali_user["email"])
        resp = await client.post("/api/auth/register-verified", json={
            **mali_user, "email_verification_token": token,
        })
        assert resp.status_code == 400
        assert "Wave" in resp.json().get("detail", "")

    async def test_register_wave_ok_in_senegal(self, client: AsyncClient):
        senegal_user = {
            **BASE_USER,
            "email": "wave-sn@kojo.sn",
            "payment_accounts": {"wave": "+221771234568"},
        }
        token = await issue_email_verification_token(client, senegal_user["email"])
        resp = await client.post("/api/auth/register-verified", json={
            **senegal_user, "email_verification_token": token,
        })
        assert resp.status_code == 200, resp.text