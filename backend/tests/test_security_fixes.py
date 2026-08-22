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

    async def test_update_profile_rejects_external_photo_url(self, client: AsyncClient):
        """La photo de profil ne peut être qu'une URL Cloudinary (la source de
        vérité des photos) : une URL externe (pisteur/tracking) est refusée."""
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "profile_photo": "https://evil.example/tracker.png",
        })
        assert resp.status_code == 400

    async def test_update_profile_accepts_cloudinary_photo(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "profile_photo": "https://res.cloudinary.com/kojo/image/upload/v1/profile_x.png",
        })
        assert resp.status_code == 200
        me = (await client.get("/api/auth/me", headers=headers)).json()
        assert me["profile_photo"] == "https://res.cloudinary.com/kojo/image/upload/v1/profile_x.png"

    async def test_update_profile_empty_photo_is_noop(self, client: AsyncClient):
        """Une chaîne vide (formulaire sans photo) ne doit pas être stockée ni
        déclencher un 400 (bug latent : '' ne commençait pas par http/https)."""
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={
            "profile_photo": "",
            "first_name": "SansPhoto",
        })
        assert resp.status_code == 200
        me = (await client.get("/api/auth/me", headers=headers)).json()
        assert me["first_name"] == "SansPhoto"
        # La photo existante (aucune ici) n'a pas été corrompue en chaîne vide
        assert me.get("profile_photo") is None


@pytest.mark.asyncio
class TestLegacyUserTolerance:
    """Un document utilisateur legacy qui ne valide plus le modèle User (ex.
    téléphone sans +) ne doit plus faire planter le serveur en 500 sur les
    endpoints authentifiés : il renvoie un 401 clair (intervention support)."""

    async def test_invalid_legacy_user_returns_401_not_500(self, client: AsyncClient):
        import uuid as _uuid
        from kojo_core import create_access_token
        from tests.conftest import db_insert

        user_id = str(_uuid.uuid4())
        email = f"legacy-{_uuid.uuid4().hex[:8]}@example.com"
        # Téléphone legacy invalide (sans '+') → ValidationError sur User(**doc)
        await db_insert("users", {
            "id": user_id,
            "email": email,
            "password_hash": "x" * 60,
            "first_name": "Legacy",
            "last_name": "User",
            "phone": "771234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
        })
        token = create_access_token({"sub": user_id, "email": email})
        headers = {"Authorization": f"Bearer {token}"}

        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 401
        assert "support" in resp.json()["detail"].lower()


@pytest.mark.asyncio
class TestHttpOnlyCookieAuth:
    """Authentification par cookie httpOnly (protection XSS) + CSRF double-submit.
    Le JWT vit dans un cookie non lisible par JS ; les mutations authentifiées
    par cookie exigent un en-tête X-CSRFToken correspondant au cookie CSRF."""

    async def test_login_sets_http_only_session_cookie(self, client: AsyncClient):
        # Inscription puis login pour récupérer le cookie de session posé.
        from tests.conftest import BASE_USER, issue_email_verification_token
        data = dict(BASE_USER)
        token = await issue_email_verification_token(client, data["email"])
        reg = await client.post("/api/auth/register-verified", json={**data, "email_verification_token": token})
        assert reg.status_code == 200

        login = await client.post("/api/auth/login", json={
            "email": data["email"], "password": data["password"]
        })
        assert login.status_code == 200
        # httpx Cookies : l'itération rend les noms directement.
        cookie_names = set(client.cookies.keys())
        assert "kojo_session" in cookie_names
        assert "kojo_csrf" in cookie_names

    async def test_auth_me_via_cookie_without_header(self, client: AsyncClient):
        # /auth/me doit fonctionner en n'envoyant QUE le cookie (pas de header).
        result = await register_and_login(client)
        # Re-login pour s'assurer que le cookie de session est posé sur le client.
        login = await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        assert login.status_code == 200
        # Le TestClient (httpx) persiste les cookies via client.cookies.
        me = await client.get("/api/auth/me")  # pas d'en-tête Authorization
        assert me.status_code == 200
        assert me.json()["email"] == result["user"]["email"]

    async def test_cookie_auth_post_requires_csrf_header(self, client: AsyncClient):
        # Une mutation authentifiée par cookie SANS X-CSRFToken doit être rejetée (403).
        result = await register_and_login(client)
        await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        # On retire explicitement tout header Authorization pour forcer le chemin cookie.
        resp = await client.put("/api/users/profile", json={"first_name": "Cookie"})
        assert resp.status_code == 403
        assert "csrf" in resp.json()["detail"].lower()

    async def test_cookie_auth_post_with_csrf_header_succeeds(self, client: AsyncClient):
        # Avec le X-CSRFToken correspondant au cookie CSRF, la mutation passe.
        result = await register_and_login(client)
        await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        csrf = client.cookies.get("kojo_csrf")
        assert csrf, "le cookie CSRF devrait être posé au login"
        resp = await client.put(
            "/api/users/profile",
            json={"first_name": "CookieOK"},
            headers={"X-CSRFToken": csrf},
        )
        assert resp.status_code == 200
        me = await client.get("/api/auth/me")
        assert me.json()["first_name"] == "CookieOK"

    async def test_header_auth_post_not_subject_to_csrf(self, client: AsyncClient):
        # L'auth par header Bearer (mobile/legacy) ne doit PAS exiger CSRF.
        headers = await auth_headers(client)
        resp = await client.put("/api/users/profile", headers=headers, json={"first_name": "HeaderOK"})
        assert resp.status_code == 200

    async def test_stale_header_token_falls_back_to_valid_cookie(self, client: AsyncClient):
        """Régression du bug réel : un token STALE en localStorage (vestige
        d'une ancienne version du frontend) envoyé en Authorization: Bearer ne
        doit PAS faire échouer une session cookie valide (401 « Invalid token »
        sur GET /users/payment-accounts alors que l'utilisateur est connecté).
        Le backend retombe sur le cookie httpOnly quand le header ne décode pas."""
        result = await register_and_login(client)
        await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        # Header avec un token périmé/illisible + cookie de session valide.
        headers = {"Authorization": "Bearer token.stale.invalide"}
        me = await client.get("/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["email"] == result["user"]["email"]

    async def test_stale_header_fallback_mutation_still_requires_csrf(self, client: AsyncClient):
        """Le fallback vers le cookie n'ouvre PAS une brèche CSRF : une
        mutation authentifiée via le cookie (header stale ignoré) doit toujours
        présenter un X-CSRFToken valide, sinon 403."""
        result = await register_and_login(client)
        await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        resp = await client.put(
            "/api/users/profile",
            json={"first_name": "FallbackSansCSRF"},
            headers={"Authorization": "Bearer token.stale.invalide"},
        )
        assert resp.status_code == 403
        assert "csrf" in resp.json()["detail"].lower()

    async def test_logout_clears_session_cookie(self, client: AsyncClient):
        result = await register_and_login(client)
        await client.post("/api/auth/login", json={
            "email": result["user"]["email"], "password": dict(BASE_USER)["password"]
        })
        csrf = client.cookies.get("kojo_csrf")
        logout = await client.post("/api/auth/logout", headers={"X-CSRFToken": csrf})
        assert logout.status_code == 200
        # Le cookie de session doit être invalidé (max-age<=0 / supprimé).
        assert not client.cookies.get("kojo_session")


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
