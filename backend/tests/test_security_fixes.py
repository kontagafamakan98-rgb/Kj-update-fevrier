"""Tests de régression des corrections de sécurité (audit backend).

Couverture : mass-assignment sur PUT /users/profile, validation du
destinataire sur POST /messages, taux de commission effectif (DB+env),
anti-énumération OTP, redirection ouverte du checkout.
"""
import pytest
from httpx import AsyncClient
from unittest.mock import patch

from tests.conftest import (
    BASE_USER, auth_headers, register_and_login, db_insert
)


@pytest.mark.asyncio
class TestProfileMassAssignment:
    """PUT /users/profile ne doit JAMAIS accepter les champs sensibles."""

    async def test_update_profile_rejects_sensitive_fields(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "first_name": "Nouveau",
            "user_type": "worker",
            "is_verified": False,  # tenté de se DÉ-vérifier : doit être ignoré
            "rating": 5.0,
            "total_reviews": 9999,
            "payment_accounts": {"orange_money": "+221771111111"},
            "payment_accounts_count": 5,
        })
        assert resp.status_code == 200

        me = (await client.get("/api/auth/me", headers=headers)).json()
        # Champ whitelisté appliqué
        assert me["first_name"] == "Nouveau"
        # Champs sensibles ignorés (l'inscription valide a posé is_verified=True)
        assert me["user_type"] == "client"
        assert me["is_verified"] is True
        assert me["rating"] == 0.0
        assert me["total_reviews"] == 0
        assert me["payment_accounts_count"] == 1
        assert me["payment_accounts"] == {"orange_money": "+221771234567"}

    async def test_update_profile_ignores_id_and_email(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "id": "fake-id",
            "email": "pirate@evil.sn",
            "phone": "+221771111111",
        })
        assert resp.status_code == 200
        me = (await client.get("/api/auth/me", headers=headers)).json()
        assert me["id"] != "fake-id"
        assert me["email"] == BASE_USER["email"]
        # Champ whitelisté (phone) bien appliqué
        assert me["phone"] == "+221771111111"


@pytest.mark.asyncio
class TestMessagesReceiverValidation:
    """POST /messages exige un destinataire existant et différent de soi."""

    async def test_send_message_to_unknown_receiver_404(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": "inexistant-user-id",
            "content": "Bonjour",
        })
        assert resp.status_code == 404

    async def test_send_message_to_self_400(self, client: AsyncClient):
        result = await register_and_login(client)
        headers = {"Authorization": f"Bearer {result['access_token']}"}
        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": result["user"]["id"],
            "content": "Bonjour moi-même",
        })
        assert resp.status_code == 400

    async def test_send_message_to_existing_user_ok(self, client: AsyncClient):
        receiver = await register_and_login(client, {**BASE_USER, "email": "receiver@kojo.sn"})
        sender = await register_and_login(client, {**BASE_USER, "email": "sender@kojo.sn"})
        headers = {"Authorization": f"Bearer {sender['access_token']}"}
        resp = await client.post("/api/messages", headers=headers, json={
            "receiver_id": receiver["user"]["id"],
            "content": "Bonjour, disponible demain !",
        })
        assert resp.status_code == 200
        assert resp.json().get("receiver_id") == receiver["user"]["id"]


@pytest.mark.asyncio
class TestCommissionRate:
    """Le taux effectif se lit en base (si présent), sinon dans l'env."""

    @pytest.fixture(autouse=True)
    def _neutralize_env_commission_rate(self):
        """Neutralise PAYMENT_COMMISSION_RATE pour rendre le test hermétique :
        kojo_settings charge un éventuel backend/.env local (load_dotenv, ex:
        PAYMENT_COMMISSION_RATE=0.10) qui ferait échouer le test selon la
        machine. On fige la constante utilisée par get_effective_commission_rate
        sur le DÉFAUT du code (0.14) — ce que le test vérifie réellement."""
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            yield

    async def test_falls_back_to_env_when_no_db_setting(self, client: AsyncClient):
        from kojo_payments import get_effective_commission_rate
        rate = await get_effective_commission_rate()
        # Aucun doc settings "commission" → repli env (défaut 0.14)
        assert rate == 0.14

    async def test_uses_db_setting_when_present(self, client: AsyncClient):
        from kojo_payments import get_effective_commission_rate
        await db_insert("settings", {"type": "commission", "commission_rate": 20})
        rate = await get_effective_commission_rate()
        assert rate == 0.20


@pytest.mark.asyncio
class TestOtpEnumeration:
    """send-otp/resend-otp ne révèlent pas si un email est déjà inscrit."""

    async def test_send_otp_existing_email_returns_generic(self, client: AsyncClient):
        await register_and_login(client)  # enregistre BASE_USER["email"]
        resp = await client.post("/api/auth/email/send-otp", json={
            "email": BASE_USER["email"],
            "purpose": "signup",
        })
        assert resp.status_code == 200
        message = resp.json().get("message", "").lower()
        assert "déjà utilisée" not in message
        assert "envoyé" in message


class TestCheckoutRedirectUrl:
    """Les URLs de retour du checkout sont restreintes à l'app."""

    def test_external_domain_falls_back(self):
        from kojo_payments import build_checkout_redirect_url
        fallback = build_checkout_redirect_url("/payment?payment_id=abc", "https://evil.example/phish")
        assert fallback == "/payment?payment_id=abc"

    def test_relative_url_kept(self):
        from kojo_payments import build_checkout_redirect_url
        url = build_checkout_redirect_url("/payment?payment_id=abc", "/payment?payment_id=abc&ok=1")
        assert url == "/payment?payment_id=abc&ok=1"

    def test_same_origin_accepted(self, monkeypatch):
        import kojo_payments
        monkeypatch.setattr(kojo_payments, "FRONTEND_APP_URL", "https://kj-update-fevrier.vercel.app")
        url = kojo_payments.build_checkout_redirect_url(
            "/payment", "https://kj-update-fevrier.vercel.app/payment-ok")
        assert url == "https://kj-update-fevrier.vercel.app/payment-ok"

    def test_javascript_protocol_rejected(self, monkeypatch):
        import kojo_payments
        monkeypatch.setattr(kojo_payments, "FRONTEND_APP_URL", "https://kj-update-fevrier.vercel.app")
        url = kojo_payments.build_checkout_redirect_url("/payment", "javascript:alert(1)")
        assert url == "https://kj-update-fevrier.vercel.app/payment"
