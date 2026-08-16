"""Tests des corrections issues de l'audit pré-lancement.

Couvre : fuite PII conversations, validation PUT /users/profile, marquage
des messages lus + compteurs, remboursement à l'annulation d'une mission
payée, gate de statut à l'acceptation, anti-replay des jetons de reset,
format téléphone Côte d'Ivoire, retrait des filtres SQL cargo-cult,
plafonds de mot de passe (bcrypt 72), magic bytes des images, et
payment_id dans les return_url PayDunya.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, WORKER_USER, AUTH_REQUIRED_STATUS,
    auth_headers, register_and_login, db_insert, db_find_one,
    issue_email_verification_token,
)


# ---------------------------------------------------------------------------
# 🔴 PII : les conversations ne doivent pas exposer les comptes de paiement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestConversationPii:
    async def test_conversations_do_not_leak_sensitive_fields(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)

        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        await client.post("/api/messages", headers=headers_a, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Bonjour, votre proposition m'intéresse.",
        })

        headers_b = {"Authorization": f"Bearer {user_b['access_token']}"}
        resp = await client.get("/api/messages/conversations", headers=headers_b)
        assert resp.status_code == 200
        convs = resp.json()
        assert len(convs) == 1

        other_user = convs[0].get("other_user") or {}
        # Champs sensibles JAMAIS exposés (numéros mobile money, banque, email, téléphone)
        assert "payment_accounts" not in other_user
        assert "password_hash" not in other_user
        assert "email" not in other_user
        assert "phone" not in other_user
        # Les données utiles restent disponibles
        assert "first_name" in other_user
        assert "profile_photo" in other_user
        # Le nom affiché reste correct
        assert convs[0]["other_user_name"] == f"{BASE_USER['first_name']} {BASE_USER['last_name']}"

    async def test_conversation_messages_do_not_contain_pii(self, client: AsyncClient):
        """Les messages bruts ne contiennent que les champs du modèle Message."""
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers = {"Authorization": f"Bearer {user_a['access_token']}"}
        await client.post("/api/messages", headers=headers, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Message de test.",
        })
        id1, id2 = sorted([user_a["user"]["id"], user_b["user"]["id"]])
        conv_id = f"{id1}_{id2}"
        resp = await client.get(f"/api/messages/{conv_id}", headers=headers)
        assert resp.status_code == 200
        for message in resp.json():
            assert "payment_accounts" not in message
            assert "password_hash" not in message


# ---------------------------------------------------------------------------
# 🟠 PUT /users/profile : re-validation des champs modifiables
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestProfileUpdateValidation:
    async def test_invalid_country_rejected(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "country": "hacker-land",
        })
        assert resp.status_code == 400

    async def test_invalid_phone_rejected(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "phone": "+99912345678",
        })
        assert resp.status_code == 400

    async def test_valid_update_still_works(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "first_name": "NouveauNom",
            "country": "mali",
            "phone": "+22377123456",
            "bio": "Artisan disponible.",
            "skills": ["plomberie", "électricité"],
        })
        assert resp.status_code == 200
        me = await client.get("/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["country"] == "mali"
        assert me.json()["phone"] == "+22377123456"
        # bio/skills sont stockés en base (le modèle User ne les expose pas via /auth/me)
        stored = await db_find_one("users", {"id": me.json()["id"]})
        assert stored["bio"] == "Artisan disponible."
        assert stored["skills"] == ["plomberie", "électricité"]

    async def test_bio_too_long_rejected(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "bio": "x" * 1001,
        })
        assert resp.status_code == 400

    async def test_sensitive_fields_still_ignored(self, client: AsyncClient):
        """La whitelist continue de bloquer les champs sensibles."""
        headers = await auth_headers(client, BASE_USER)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "user_type": "owner",
            "payment_accounts": {"orange_money": "+22199999999"},
            "country": "senegal",
        })
        assert resp.status_code == 200
        me = await client.get("/api/auth/me", headers=headers)
        assert me.json()["user_type"] == "client"
        assert me.json().get("payment_accounts", {}).get("orange_money") != "+22199999999"


# ---------------------------------------------------------------------------
# 🟠 Messages : marquage lu + compteur de non-lus
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestMessageReadState:
    async def _two_users_with_message(self, client: AsyncClient):
        user_a = await register_and_login(client, BASE_USER)
        user_b = await register_and_login(client, WORKER_USER)
        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        await client.post("/api/messages", headers=headers_a, json={
            "receiver_id": user_b["user"]["id"],
            "content": "Un message important.",
        })
        id1, id2 = sorted([user_a["user"]["id"], user_b["user"]["id"]])
        return user_a, user_b, f"{id1}_{id2}"

    async def test_conversations_expose_unread_count(self, client: AsyncClient):
        user_a, user_b, _ = await self._two_users_with_message(client)
        headers_b = {"Authorization": f"Bearer {user_b['access_token']}"}
        resp = await client.get("/api/messages/conversations", headers=headers_b)
        assert resp.status_code == 200
        convs = resp.json()
        assert len(convs) == 1
        assert convs[0]["unread_count"] == 1
        assert convs[0]["last_message"] == "Un message important."

    async def test_opening_conversation_marks_received_messages_read(self, client: AsyncClient):
        user_a, user_b, conv_id = await self._two_users_with_message(client)
        headers_b = {"Authorization": f"Bearer {user_b['access_token']}"}
        resp = await client.get(f"/api/messages/{conv_id}", headers=headers_b)
        assert resp.status_code == 200

        msg = await db_find_one("messages", {"conversation_id": conv_id})
        assert msg is not None
        assert msg["read"] is True

        # Le compteur retombe à zéro après lecture
        resp = await client.get("/api/messages/conversations", headers=headers_b)
        assert resp.json()[0]["unread_count"] == 0

    async def test_sender_messages_not_marked_read_by_self(self, client: AsyncClient):
        """Ouvrir sa propre conversation ne marque PAS ses propres messages comme lus."""
        user_a, user_b, conv_id = await self._two_users_with_message(client)
        headers_a = {"Authorization": f"Bearer {user_a['access_token']}"}
        await client.get(f"/api/messages/{conv_id}", headers=headers_a)
        msg = await db_find_one("messages", {"conversation_id": conv_id})
        # Le message a été ENVOYÉ par A : la lecture par A ne le marque pas lu
        assert msg["read"] is False


# ---------------------------------------------------------------------------
# 🔴 Annulation d'une mission payée : remboursement automatique
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestCancellationRefund:
    async def _paid_job(self, client: AsyncClient, payout_status="held"):
        """Client + travailleur + job in_progress + paiement completed séquestré."""
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "title": "Réparation urgente",
            "client_id": client_user["user"]["id"],
            "assigned_worker_id": worker_user["user"]["id"],
            "status": "in_progress",
            "deleted": False,
        })
        payment_id = str(uuid.uuid4())
        await db_insert("payments", {
            "id": payment_id,
            "job_id": job_id,
            "payer_id": client_user["user"]["id"],
            "receiver_id": worker_user["user"]["id"],
            "amount": 25000,
            "status": "completed",
            "payout_status": payout_status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return client_user, worker_user, job_id, payment_id

    async def test_delete_paid_job_refunds_client(self, client: AsyncClient):
        client_user, _, job_id, payment_id = await self._paid_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-abc", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_jobs.notify_user", AsyncMock()):
            resp = await client.delete(f"/api/jobs/{job_id}", headers=headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["refund_status"] == "refunded"
        assert data["refunded_amount"] == 25000

        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refunded"
        assert payment["payout_kind"] == "refund"
        assert payment["disburse_token"] == "refund-token-abc"

        job = await db_find_one("jobs", {"id": job_id})
        assert job["status"] == "cancelled"
        assert job["deleted"] is True

    async def test_delete_paid_job_with_released_payout_rejected(self, client: AsyncClient):
        client_user, _, job_id, _ = await self._paid_job(client, payout_status="released")
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp = await client.delete(f"/api/jobs/{job_id}", headers=headers)
        assert resp.status_code == 409

    async def test_delete_paid_job_refund_failure_still_cancels(self, client: AsyncClient):
        """Échec du décaissement PayDunya → mission annulée + refund_failed (à traiter manuellement)."""
        client_user, _, job_id, payment_id = await self._paid_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}

        with patch("kojo_routers_jobs.create_paydunya_disburse_invoice",
                   return_value={"disburse_token": "refund-token-fail", "response_code": "00"}), \
             patch("kojo_routers_jobs.submit_paydunya_disburse_invoice",
                   return_value={"status": "failed", "response_code": "01", "response_text": "Compte invalide"}), \
             patch("kojo_routers_jobs.notify_user", AsyncMock()):
            resp = await client.delete(f"/api/jobs/{job_id}", headers=headers)

        assert resp.status_code == 200
        assert resp.json()["refund_status"] == "refund_failed"
        payment = await db_find_one("payments", {"id": payment_id})
        assert payment["payout_status"] == "refund_failed"
        job = await db_find_one("jobs", {"id": job_id})
        assert job["status"] == "cancelled"

    async def test_delete_unpaid_job_has_no_refund(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "title": "Mission simple",
            "client_id": client_user["user"]["id"],
            "status": "open",
            "deleted": False,
        })
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp = await client.delete(f"/api/jobs/{job_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["refund_status"] is None


# ---------------------------------------------------------------------------
# 🟡 Acceptation de proposition : gate de statut + attribution atomique
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestProposalAcceptGuards:
    async def test_accept_on_completed_job_rejected(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        proposal_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "client_id": client_user["user"]["id"],
            "status": "completed",
            "deleted": False,
        })
        await db_insert("job_proposals", {
            "id": proposal_id,
            "job_id": job_id,
            "worker_id": worker_user["user"]["id"],
            "proposed_amount": 15000,
            "status": "pending",
        })
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp = await client.post(
            f"/api/jobs/{job_id}/proposals/{proposal_id}/accept",
            headers=headers,
            json={},
        )
        assert resp.status_code == 409

    async def test_accept_still_works_on_open_job(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        proposal_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "client_id": client_user["user"]["id"],
            "title": "Plomberie urgente Dakar",
            "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent.",
            "category": "plomberie",
            "budget_min": 10000,
            "budget_max": 30000,
            "location": {"address": "Dakar Plateau, Sénégal"},
            "status": "open",
            "deleted": False,
        })
        await db_insert("job_proposals", {
            "id": proposal_id,
            "job_id": job_id,
            "worker_id": worker_user["user"]["id"],
            "proposed_amount": 15000,
            "status": "pending",
        })
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_jobs.notify_user", AsyncMock()), \
             patch("kojo_routers_jobs._send_payment_pending_to_worker", AsyncMock()):
            resp = await client.post(
                f"/api/jobs/{job_id}/proposals/{proposal_id}/accept",
                headers=headers,
                json={},
            )
        assert resp.status_code == 200
        job = await db_find_one("jobs", {"id": job_id})
        assert job["assigned_worker_id"] == worker_user["user"]["id"]
        assert job["status"] == "in_progress"


# ---------------------------------------------------------------------------
# 🟠 Anti-replay : jeton de réinitialisation de mot de passe à usage unique
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestPasswordResetTokenReplay:
    async def _get_reset_token(self, client: AsyncClient, email: str) -> str:
        import server as srv
        from tests.conftest import TEST_OTP_CODE
        otp_hash = srv.hash_email_otp(email, "password_reset", TEST_OTP_CODE)
        await srv.db.email_otps.update_one(
            {"email": email.lower().strip(), "purpose": "password_reset"},
            {"$set": {
                "otp_hash": otp_hash,
                "attempt_count": 0,
                "status": "pending",
                "last_sent_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                "updated_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        resp = await client.post("/api/auth/password/forgot/verify", json={
            "email": email, "otp": TEST_OTP_CODE,
        })
        assert resp.status_code == 200
        return resp.json()["verification_token"]

    async def test_reset_token_cannot_be_reused(self, client: AsyncClient):
        await register_and_login(client, BASE_USER)
        email = BASE_USER["email"]
        token = await self._get_reset_token(client, email)

        payload = {
            "email": email,
            "verification_token": token,
            "new_password": "nouveau-mot-de-passe",
        }
        resp1 = await client.post("/api/auth/password/reset", json=payload)
        assert resp1.status_code == 200

        # Relecture du même jeton : refusée (anti-replay)
        resp2 = await client.post("/api/auth/password/reset", json=payload)
        assert resp2.status_code == 401

        # Le nouveau mot de passe fonctionne
        resp = await client.post("/api/auth/login", json={
            "email": email, "password": "nouveau-mot-de-passe",
        })
        assert resp.status_code == 200

    async def test_signup_token_revoked_after_registration(self, client: AsyncClient):
        """Le jeton d'inscription est révoqué en base après usage (replay impossible)."""
        import jwt as pyjwt
        import server as srv
        from kojo_settings import EMAIL_OTP_SECRET

        data = dict(BASE_USER)
        token = await issue_email_verification_token(client, data["email"])
        payload = {**data, "email_verification_token": token}
        resp1 = await client.post("/api/auth/register-verified", json=payload)
        assert resp1.status_code == 200

        decoded = pyjwt.decode(token, EMAIL_OTP_SECRET, algorithms=["HS256"])
        jti = decoded.get("jti")
        assert jti, "Le jeton doit porter un jti"
        revoked = await srv.db.revoked_tokens.find_one({"jti": jti})
        assert revoked is not None, "Le jeton d'inscription doit être révoqué après usage"

        # Deuxième inscription avec le même jeton : email déjà utilisé
        resp2 = await client.post("/api/auth/register-verified", json=payload)
        assert resp2.status_code == 400


# ---------------------------------------------------------------------------
# 🟡 Téléphone Côte d'Ivoire : nouveau format à 10 chiffres
# ---------------------------------------------------------------------------

class TestPhoneCiFormat:
    def test_ci_10_digit_number_accepted(self):
        from kojo_models import validate_west_africa_phone
        assert validate_west_africa_phone("+2250123456789") == "+2250123456789"
        assert validate_west_africa_phone("+2250712345678") == "+2250712345678"

    def test_ci_8_digit_number_still_accepted(self):
        from kojo_models import validate_west_africa_phone
        assert validate_west_africa_phone("+22507123456") == "+22507123456"

    def test_senegal_10_digit_local_rejected(self):
        from kojo_models import validate_west_africa_phone
        with pytest.raises(ValueError):
            validate_west_africa_phone("+2217712345678")

    def test_orange_money_validator_accepts_ci_10_digits(self):
        from kojo_core import validate_orange_money_number
        assert validate_orange_money_number("+2250123456789") is True
        assert validate_orange_money_number("+2250712345678") is True

    def test_wave_validator_accepts_ci_10_digits(self):
        from kojo_core import validate_wave_number
        assert validate_wave_number("+2250123456789") is True


# ---------------------------------------------------------------------------
# 🟠 Retrait des filtres SQL cargo-cult (faux positifs emails/noms)
# ---------------------------------------------------------------------------

class TestSqlCargoCultRemoved:
    def test_sanitize_email_accepts_keyword_emails(self):
        from kojo_core import sanitize_email
        assert sanitize_email("union@example.com") == "union@example.com"
        assert sanitize_email("select@mail.com") == "select@mail.com"
        assert sanitize_email("or@x.com") == "or@x.com"

    def test_sanitize_email_still_cleans(self):
        from kojo_core import sanitize_email
        assert sanitize_email("  TEST@Kojo.Sn  ") == "test@kojo.sn"
        with pytest.raises(ValueError):
            sanitize_email("")

    def test_name_with_apostrophe_accepted(self):
        """« O'Brien » était rejeté par le filtre SQL (apostrophe interdite)."""
        from kojo_models import UserWithPayment
        data = {
            "email": "obrien@kojo.sn",
            "password": "password123",
            "first_name": "O'Brien",
            "last_name": "Test",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
            "legal_documents_version": "v1.0.0-2024",
            "payment_accounts": {"orange_money": "+221771234567"},
        }
        user = UserWithPayment(**data)
        assert user.first_name == "O'Brien"


# ---------------------------------------------------------------------------
# 🟡 Plafonds de mot de passe (bcrypt 72 octets)
# ---------------------------------------------------------------------------

class TestPasswordLimits:
    def test_registration_rejects_password_over_72_chars(self):
        from kojo_models import UserWithPayment
        data = {
            "email": "long@kojo.sn",
            "password": "x" * 73,
            "first_name": "Kojo",
            "last_name": "Test",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
            "legal_documents_version": "v1.0.0-2024",
            "payment_accounts": {"orange_money": "+221771234567"},
        }
        with pytest.raises(Exception):
            UserWithPayment(**data)

    def test_password_exactly_72_accepted(self):
        from kojo_models import UserWithPayment
        data = {
            "email": "long72@kojo.sn",
            "password": "x" * 72,
            "first_name": "Kojo",
            "last_name": "Test",
            "phone": "+221771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
            "legal_documents_version": "v1.0.0-2024",
            "payment_accounts": {"orange_money": "+221771234567"},
        }
        user = UserWithPayment(**data)
        assert len(user.password) == 72

    def test_login_rejects_absurdly_long_password(self):
        from kojo_models import UserLogin
        with pytest.raises(Exception):
            UserLogin(email="x@kojo.sn", password="x" * 10000)


# ---------------------------------------------------------------------------
# 🟡 Magic bytes : upload photo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestImageMagicBytes:
    async def test_upload_non_image_rejected(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.post(
            "/api/users/profile-photo",
            headers=headers,
            files={"file": ("faux.png", b"ceci n'est pas une image", "image/png")},
        )
        assert resp.status_code == 400
        assert "image" in resp.json()["detail"].lower()

    async def test_upload_real_png_accepted_until_cloudinary(self, client: AsyncClient):
        """Un vrai PNG passe la validation, puis échoue proprement côté Cloudinary (non configuré)."""
        headers = await auth_headers(client, BASE_USER)
        png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
        with patch("kojo_routers_users.upload_profile_photo_to_cloudinary",
                   return_value={"photo_url": "https://res.cloudinary.com/test.png", "public_id": "x"}):
            resp = await client.post(
                "/api/users/profile-photo",
                headers=headers,
                files={"file": ("photo.png", png, "image/png")},
            )
        assert resp.status_code == 200
        assert resp.json()["photo_url"] == "https://res.cloudinary.com/test.png"


# ---------------------------------------------------------------------------
# ⭐ Système de reviews / notes (missions terminées)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestReviews:
    async def _completed_job(self, client: AsyncClient):
        """Client + travailleur + job terminé avec paiement (les deux participants)."""
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "title": "Mission terminée",
            "client_id": client_user["user"]["id"],
            "assigned_worker_id": worker_user["user"]["id"],
            "status": "completed",
            "deleted": False,
        })
        return client_user, worker_user, job_id

    async def test_client_reviews_worker_updates_rating(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={
                "rating": 5,
                "comment": "Excellent travail, ponctuel et soigné.",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["review"]["reviewee_id"] == worker_user["user"]["id"]
        assert data["reviewee_rating"] == 5.0
        assert data["reviewee_total_reviews"] == 1

        worker = await db_find_one("users", {"id": worker_user["user"]["id"]})
        assert worker["rating"] == 5.0
        assert worker["total_reviews"] == 1

    async def test_review_on_open_job_rejected(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "client_id": client_user["user"]["id"],
            "assigned_worker_id": worker_user["user"]["id"],
            "status": "open",
            "deleted": False,
        })
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 4})
        assert resp.status_code == 400

    async def test_non_participant_cannot_review(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        outsider = await register_and_login(client, {**BASE_USER, "email": "intrus@kojo.sn"})
        headers = {"Authorization": f"Bearer {outsider['access_token']}"}
        resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 4})
        assert resp.status_code == 403

    async def test_duplicate_review_rejected(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            resp1 = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 5})
            assert resp1.status_code == 200
            resp2 = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 1})
        assert resp2.status_code == 409

    async def test_worker_reviews_client(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {worker_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={
                "rating": 4,
                "comment": "Client sérieux, paiement rapide.",
            })
        assert resp.status_code == 200
        assert resp.json()["review"]["reviewee_id"] == client_user["user"]["id"]
        client_doc = await db_find_one("users", {"id": client_user["user"]["id"]})
        assert client_doc["rating"] == 4.0
        assert client_doc["total_reviews"] == 1

    async def test_get_job_reviews_participants_only(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={
                "rating": 4, "comment": "Très bien.",
            })

        # Le travailleur (participant) voit les avis
        headers_w = {"Authorization": f"Bearer {worker_user['access_token']}"}
        resp = await client.get(f"/api/jobs/{job_id}/reviews", headers=headers_w)
        assert resp.status_code == 200
        reviews = resp.json()
        assert len(reviews) == 1
        assert reviews[0]["rating"] == 4
        assert reviews[0]["reviewer_name"] == f"{BASE_USER['first_name']} {BASE_USER['last_name']}"
        assert "email" not in reviews[0]

        # Un étranger ne voit pas les avis
        outsider = await register_and_login(client, {**BASE_USER, "email": "intrus2@kojo.sn"})
        headers_o = {"Authorization": f"Bearer {outsider['access_token']}"}
        resp = await client.get(f"/api/jobs/{job_id}/reviews", headers=headers_o)
        assert resp.status_code == 403

    async def test_get_user_reviews(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 5})

        resp = await client.get(f"/api/users/{worker_user['user']['id']}/reviews", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_reviews"] == 1
        assert data["rating"] == 5.0
        assert len(data["reviews"]) == 1
        assert data["reviews"][0]["job_id"] == job_id

    async def test_delete_review_recomputes_rating(self, client: AsyncClient):
        client_user, worker_user, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_reviews.notify_user", AsyncMock()):
            resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 4})
        review_id = resp.json()["review"]["id"]

        # Un tiers ne peut pas supprimer l'avis
        outsider = await register_and_login(client, {**BASE_USER, "email": "intrus3@kojo.sn"})
        headers_o = {"Authorization": f"Bearer {outsider['access_token']}"}
        resp = await client.delete(f"/api/reviews/{review_id}", headers=headers_o)
        assert resp.status_code == 403

        # L'auteur peut le supprimer → rating recalculé à 0
        resp = await client.delete(f"/api/reviews/{review_id}", headers=headers)
        assert resp.status_code == 200
        worker = await db_find_one("users", {"id": worker_user["user"]["id"]})
        assert worker["total_reviews"] == 0
        assert worker["rating"] == 0.0

    async def test_rating_range_validated(self, client: AsyncClient):
        client_user, _, job_id = await self._completed_job(client)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        resp = await client.post(f"/api/jobs/{job_id}/reviews", headers=headers, json={"rating": 6})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# 🟠 return_url : payment_id ajouté même quand le frontend fournit une URL
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestCheckoutReturnUrl:
    async def test_return_url_gets_payment_id_appended(self, client: AsyncClient):
        client_user = await register_and_login(client, BASE_USER)
        worker_user = await register_and_login(client, WORKER_USER)
        proposal_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())
        await db_insert("jobs", {
            "id": job_id,
            "client_id": client_user["user"]["id"],
            "status": "in_progress",
            "assigned_worker_id": worker_user["user"]["id"],
            "accepted_proposal_id": proposal_id,
            "deleted": False,
        })
        await db_insert("job_proposals", {
            "id": proposal_id,
            "job_id": job_id,
            "worker_id": worker_user["user"]["id"],
            "proposed_amount": 25000,
            "status": "accepted",
        })

        captured = {}

        def fake_create_invoice(payload):
            captured["payload"] = payload
            return {
                "token": "inv-xyz",
                "checkout_url": "https://paydunya.com/checkout",
                "response_code": "00",
                "response_text": "OK",
            }

        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_routers_payments.create_paydunya_invoice", side_effect=fake_create_invoice):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": job_id,
                "amount": 25000,
                "payment_method": "orange_money",
                "country": "senegal",
                "return_url": "https://app.kojo.com/payment",
                "cancel_url": "https://app.kojo.com/payment",
            })

        assert resp.status_code == 200
        actions = captured["payload"]["actions"]
        payment_id = resp.json()["payment_id"]
        assert f"payment_id={payment_id}" in actions["return_url"]
        assert f"payment_id={payment_id}" in actions["cancel_url"]
        assert "cancelled=1" in actions["cancel_url"]
