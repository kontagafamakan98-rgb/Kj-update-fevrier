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

from kojo_core import db
# La liste des coordonnées à effacer APPARTIENT au routeur : le test la lit au
# lieu de la recopier, sinon un champ GPS ajouté demain laisserait ce test vert.
from kojo_routers_users import JOB_LOCATION_FIELDS

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


def _path_value(doc, path):
    """Valeur d'un chemin pointé (« location.latitude ») dans un document, ou
    None si la clé est absente — c'est l'absence qui est exigée après
    effacement (`$unset` retire la clé, il ne la met pas à None)."""
    current = doc or {}
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _numbers_in(value):
    """Tous les nombres présents dans une valeur imbriquée.

    Sert à balayer un document par VALEURS plutôt que par noms de champs : la
    liste des champs à effacer appartient au routeur, et si un champ GPS y
    disparaissait demain, les vérifications par nom cesseraient de regarder au
    bon endroit sans rien dire. Les coordonnées de la fixture sont distinctives,
    donc leur présence résiduelle trahit n'importe quel champ qui les porte.
    """
    if isinstance(value, bool):
        return set()
    if isinstance(value, (int, float)):
        return {float(value)}
    if isinstance(value, dict):
        return set().union(*[_numbers_in(v) for v in value.values()]) if value else set()
    if isinstance(value, (list, tuple, set)):
        return set().union(*[_numbers_in(v) for v in value]) if value else set()
    return set()


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


# Contrat RGPD, ÉCRIT ici et non lu sur l'implémentation : ces trois états
# signifient que PayDunya n'a exécuté AUCUN décaissement, donc que l'argent est
# encore dû au payeur qui supprime son compte. Une liste dérivée de
# `kojo_routers_users.REFUNDABLE_PAYOUT_STATES` ne pourrait pas signaler la
# régression : retirer un état du code retirerait aussi le cas qui le vérifie.
REFUNDABLE_ESCROW_STATES = ("held", "release_failed", "refund_failed")


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

    @pytest.mark.parametrize("payout_status", REFUNDABLE_ESCROW_STATES)
    async def test_delete_account_refunds_escrow_before_anonymization(
        self, client: AsyncClient, payout_status: str
    ):
        """Point 1 RGPD : les fonds séquestrés sont remboursés AVANT la purge de
        payment_accounts, dans les TROIS états où PayDunya n'a rien exécuté. La
        preuve de l'ordre est implicite : si l'anonymisation précédait le
        refund, execute_paydunya_refund ne trouverait plus de compte mobile
        money → refund_failed → 409. Ici on exige 200 + refunded, donc le refund
        a tourné avec les comptes encore en base."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id, "title": "Mission payée", "client_id": user["user"]["id"],
            "status": "in_progress", "deleted": False,
        })
        await self._insert_payment(
            user["user"]["id"], job_id=job_id, payout_status=payout_status
        )

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

    async def test_delete_account_cascades_profile_proposals_and_reviews(self, client: AsyncClient):
        """Cascade RGPD : le profil travailleur, les propositions envoyées et
        les avis laissés disparaissent — et les missions POSTÉES par ce compte
        sont closes et retirées du public (un compte supprimé ne doit plus
        signer de contenu ni laisser une mission ouverte)."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        uid = user["user"]["id"]
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id, "title": "Mission postée", "client_id": uid,
            "status": "open", "deleted": False,
        })
        await db_insert("worker_profiles", {
            "id": str(uuid.uuid4()), "user_id": uid, "skills": ["plumbing"],
        })
        await db_insert("job_proposals", {
            "id": str(uuid.uuid4()), "worker_id": uid, "job_id": job_id,
            "status": "pending",
        })
        await db_insert("reviews", {
            "id": str(uuid.uuid4()), "reviewer_id": uid, "job_id": job_id,
            "rating": 5,
        })

        resp = await client.delete("/api/users/account", headers=headers)
        assert resp.status_code == 200, resp.text

        for collection, query in (
            ("worker_profiles", {"user_id": uid}),
            ("job_proposals", {"worker_id": uid}),
            ("reviews", {"reviewer_id": uid}),
        ):
            assert await db_find_one(collection, query) is None, (
                f"{collection} : contenu du compte supprimé encore présent"
            )

        job = await db_find_one("jobs", {"id": job_id})
        assert job["deleted"] is True
        assert job["status"] == "cancelled"
        assert job["deleted_at"] is not None

    async def test_delete_account_erases_identity_and_referral_pii(self, client: AsyncClient):
        """Anonymisation RGPD du document CONSERVÉ (obligation comptable) :
        plus aucun identifiant d'identité ni de quoi recréditer du parrainage —
        y compris les permissions élevées, qu'un compte supprimé ne peut pas
        garder."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        uid = user["user"]["id"]
        await db.users.update_one({"id": uid}, {"$set": {
            "google_sub": "google-oauth-sub-123",
            "profile_photo": "https://res.cloudinary.com/kojo/photo.jpg",
            "referral_code": "KOJO-123456",
            "referred_by": "KOJO-000001",
            "referral_reward_balance": 5000.0,
            "referral_rewards": [{"id": "r-1", "amount": 5000}],
            "permissions": ["admin_access"],
            "bio": "Je suis Kofi, joignable au +221771234567",
            "skills": ["plomberie", "soudure"],
        }})

        # Le nom, la bio et le profil sont en base AVANT la suppression : sans
        # cette garde, les assertions d'effacement plus bas seraient vraies sur
        # un compte qui n'en a jamais porté.
        before = await db_find_one("users", {"id": uid})
        assert before["first_name"] == "Kojo"
        assert before["last_name"] == "Test"
        assert before["bio"].startswith("Je suis Kofi")
        assert before["skills"] == ["plomberie", "soudure"]

        resp = await client.delete("/api/users/account", headers=headers)
        assert resp.status_code == 200, resp.text

        stored = await db_find_one("users", {"id": uid})
        assert stored["deleted"] is True
        assert stored["deleted_at"] is not None
        assert stored["email"].endswith("@kojo.deleted")
        assert stored["password_hash"] is None
        # Les PII NOMINATIVES : le document conservé est présenté comme anonymisé,
        # donc aucune des deux ne peut survivre à la suppression.
        assert stored["first_name"] is None
        assert stored["last_name"] is None
        # La bio est du TEXTE LIBRE : le nom effacé juste au-dessus y revenait
        # en clair, avec le téléphone de surcroît.
        assert stored["bio"] is None
        assert stored["skills"] == []
        assert stored["phone"] is None
        assert stored["payment_accounts"] is None
        assert stored["payment_accounts_count"] == 0
        assert stored["google_sub"] is None
        assert stored["profile_photo"] is None
        assert stored["referral_code"] is None
        assert stored["referred_by"] is None
        assert stored["referral_reward_balance"] == 0.0
        assert stored["referral_rewards"] == []
        assert stored["permissions"] == []

    async def test_delete_account_erases_support_tickets_and_job_locations(
        self, client: AsyncClient
    ):
        """Les deux autres survivants relevés par l'audit RGPD : le ticket
        support du compte (texte libre qui peut nommer l'utilisateur) est
        SUPPRIMÉ, et les missions postées par ce client perdent TOUTE coordonnée
        — une seule restante suffirait à re-situer un compte supprimé."""
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        uid = user["user"]["id"]
        ticket_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())

        await db_insert("support_tickets", {
            "id": ticket_id, "user_id": uid, "full_name": "Kojo Test",
            "phone": "+221771234567", "email": "test@kojo.sn", "reason": "autre",
            "message": "Je suis Kofi, joignable au +221771234567",
            "channel": "robot", "status": "new",
        })
        # Les trois formes de coordonnées qu'une mission peut porter : celle
        # partagée au travailleur, celle du lieu, et le point GeoJSON de la
        # recherche par rayon (voir JOB_LOCATION_FIELDS).
        coordinates = {14.7, -17.4}
        await db_insert("jobs", {
            "id": job_id, "title": "Mission postée", "client_id": uid,
            "status": "open", "deleted": False,
            "location": {"address": "Sacré-Cœur 3, Dakar", "latitude": 14.7,
                         "longitude": -17.4, "coordinates": [14.7, -17.4]},
            "shared_location": {"latitude": 14.7, "longitude": -17.4,
                                "maps_url": "https://maps.google.com/?q=14.7,-17.4"},
            "geo": {"type": "Point", "coordinates": [-17.4, 14.7]},
        })

        # Non-vacuité AVANT suppression, et périmètre tenu par la source : si un
        # champ GPS est ajouté au routeur sans que cette fixture le porte, le
        # test le dit ici au lieu de passer pour une preuve.
        before_job = await db_find_one("jobs", {"id": job_id})
        assert (await db_find_one("support_tickets", {"id": ticket_id}))["full_name"]
        uncovered = [
            field for field in JOB_LOCATION_FIELDS if _path_value(before_job, field) is None
        ]
        assert not uncovered, (
            f"la fixture ne porte aucune coordonnée pour {uncovered} : l'effacement "
            f"de ces champs ne serait pas prouvé"
        )

        resp = await client.delete("/api/users/account", headers=headers)
        assert resp.status_code == 200, resp.text

        assert await db_find_one("support_tickets", {"id": ticket_id}) is None, (
            "ticket support du compte supprimé encore présent"
        )

        job = await db_find_one("jobs", {"id": job_id})
        assert job["deleted"] is True
        survivors = [
            field for field in JOB_LOCATION_FIELDS if _path_value(job, field) is not None
        ]
        assert not survivors, (
            f"coordonnée(s) du compte supprimé encore présente(s) sur la mission : {survivors}"
        )
        # Balayage par VALEURS : aucune des coordonnées du client ne doit rester,
        # même dans un champ que JOB_LOCATION_FIELDS ne nomme pas.
        leftovers = _numbers_in(job) & coordinates
        assert not leftovers, (
            f"coordonnée(s) {sorted(leftovers)} du compte supprimé encore en base, "
            f"dans un champ que l'effacement ne couvre pas"
        )

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