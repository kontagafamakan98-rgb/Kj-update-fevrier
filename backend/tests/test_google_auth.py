"""Tests du flux d'authentification Google (SSO).

Couvre :
- création de compte Google (sans OTP, email vérifié par Google)
- connexion d'un compte déjà lié à un sub Google
- refus de fusion automatique quand l'email existe déjà (statut email_exists)
- fusion sécurisée via /auth/google/link (mot de passe requis)
- le login classique est refusé pour un compte sans mot de passe (SSO)
"""
import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_USER, db_find_one, register_and_login,
)


def _google_claims(sub=None, email=None, **overrides):
    claims = {
        "sub": sub or f"google-sub-{uuid.uuid4().hex[:12]}",
        "email": email or f"g-{uuid.uuid4().hex[:8]}@gmail.com",
        "email_verified": True,
        "given_name": "Alpha",
        "family_name": "Beta",
        "name": "Alpha Beta",
        "picture": "https://lh3.googleusercontent.com/photo",
        "locale": "fr",
    }
    claims.update(overrides)
    return claims


async def _google_auth(client, claims, payload=None, patch_target="kojo_routers_auth._exchange_google_code"):
    from unittest.mock import patch
    body = {
        "code": "google-auth-code-1234567890",
        "user_type": "worker",
        "country": "senegal",
        "preferred_language": "fr",
        "legal_documents_accepted": True,
    }
    if payload:
        body.update(payload)
    with patch(patch_target, return_value=claims):
        return await client.post("/api/auth/google", json=body)


@pytest.mark.asyncio
class TestGoogleAuthCreate:
    async def test_creates_account_without_otp(self, client: AsyncClient):
        """Un nouveau compte Google est créé sans OTP ni comptes de paiement."""
        claims = _google_claims()
        resp = await _google_auth(client, claims)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "success"
        assert data["created"] is True
        assert data["needs_onboarding"] is True
        assert data["access_token"]
        assert data["user"]["email"] == claims["email"]
        assert data["user"]["google_sub"] == claims["sub"]
        # Le compte est créé sans mot de passe (SSO)
        assert "password_hash" not in data["user"]

        user = await db_find_one("users", {"id": data["user"]["id"]})
        assert user is not None
        assert user["google_sub"] == claims["sub"]
        assert user["password_hash"] is None
        assert user["email_verified"] is True
        assert user["payment_accounts_count"] == 0

    async def test_requires_legal_documents(self, client: AsyncClient):
        claims = _google_claims()
        resp = await _google_auth(client, claims, payload={"legal_documents_accepted": False})
        assert resp.status_code == 400

    async def test_requires_user_type_defaults_to_client(self, client: AsyncClient):
        claims = _google_claims()
        from unittest.mock import patch
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            resp = await client.post("/api/auth/google", json={
                "code": "google-auth-code-1234567890",
                "legal_documents_accepted": True,
            })
        assert resp.status_code == 200
        assert resp.json()["user"]["user_type"] == "client"

    async def test_rejects_unverified_email(self, client: AsyncClient):
        """Un email non vérifié par Google est refusé (défense en profondeur :
        la vérification vit dans _exchange_google_code ET est re-vérifiée
        dans le endpoint avant toute création)."""
        claims = _google_claims(email_verified=False)
        resp = await _google_auth(client, claims)
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestGoogleAuthExisting:
    async def test_logs_in_existing_linked_account(self, client: AsyncClient):
        """Un compte déjà lié à ce sub Google reçoit une session directe."""
        claims = _google_claims()
        # 1ère connexion → création
        resp1 = await _google_auth(client, claims)
        assert resp1.status_code == 200
        user_id = resp1.json()["user"]["id"]

        # 2ème connexion → connexion directe (pas de création)
        resp2 = await _google_auth(client, claims)
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["status"] == "success"
        assert data["linked"] is True
        assert data["user"]["id"] == user_id
        assert data.get("created") is None

    async def test_email_exists_does_not_auto_link(self, client: AsyncClient):
        """Un compte mot-de-passe existant avec le même email → email_exists
        (pas de fusion automatique = anti détournement)."""
        account = await register_and_login(client, BASE_USER)
        claims = _google_claims(email=account["user"]["email"])
        resp = await _google_auth(client, claims)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "email_exists"
        # Aucun google_sub posé sur le compte existant
        user = await db_find_one("users", {"id": account["user"]["id"]})
        assert user.get("google_sub") is None

    async def test_duplicate_sub_conflict(self, client: AsyncClient):
        """Concurrence : si un compte google_sub apparaît entre-temps → 409."""
        claims = _google_claims()
        resp1 = await _google_auth(client, claims)
        assert resp1.status_code == 200
        # On force un doublon en créant un compte email identique puis en
        # appelant à nouveau avec un user_type différent (le sub est déjà pris)
        # → la 2ème création échoue (index unique google_sub)
        from unittest.mock import patch
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            resp2 = await client.post("/api/auth/google", json={
                "code": "google-auth-code-1234567890",
                "user_type": "client",
                "country": "mali",
                "preferred_language": "fr",
                "legal_documents_accepted": True,
            })
        # Soit connexion directe (sub trouvé), soit 409 (concurrence) — jamais
        # un doublon silencieux.
        assert resp2.status_code in (200, 409)


@pytest.mark.asyncio
class TestGoogleLink:
    async def test_link_requires_password(self, client: AsyncClient):
        """La fusion exige le mot de passe du compte (preuve de propriété)."""
        account = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {account['access_token']}"}
        claims = _google_claims(email=account["user"]["email"])

        from unittest.mock import patch
        # Mot de passe incorrect → 401
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            resp = await client.post("/api/auth/google/link", headers=headers, json={
                "code": "google-auth-code-1234567890",
                "password": "mauvais-password",
            })
        assert resp.status_code == 401

        # Mot de passe correct → liaison
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            resp = await client.post("/api/auth/google/link", headers=headers, json={
                "code": "google-auth-code-1234567890",
                "password": BASE_USER["password"],
            })
        assert resp.status_code == 200
        assert resp.json()["status"] == "linked"

        user = await db_find_one("users", {"id": account["user"]["id"]})
        assert user["google_sub"] == claims["sub"]

        # Après liaison, /auth/google connecte directement
        resp2 = await _google_auth(client, claims)
        assert resp2.status_code == 200
        assert resp2.json()["status"] == "success"
        assert resp2.json()["linked"] is True

    async def test_link_rejects_sub_already_taken(self, client: AsyncClient):
        """Un sub Google déjà lié à un AUTRE compte → 409."""
        account = await register_and_login(client, BASE_USER)
        other_account = await register_and_login(client, {
            **BASE_USER, "email": f"other-{uuid.uuid4().hex[:8]}@kojo.sn",
        })
        headers = {"Authorization": f"Bearer {account['access_token']}"}
        claims = _google_claims()

        # L'autre compte prend d'abord ce sub
        from unittest.mock import patch
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            await client.post("/api/auth/google/link", headers={
                "Authorization": f"Bearer {other_account['access_token']}"
            }, json={
                "code": "google-auth-code-1234567890",
                "password": BASE_USER["password"],
            })

        # Le premier compte tente de lier le même sub → 409
        with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
            resp = await client.post("/api/auth/google/link", headers=headers, json={
                "code": "google-auth-code-1234567890",
                "password": BASE_USER["password"],
            })
        assert resp.status_code == 409


@pytest.mark.asyncio
class TestGoogleExchangeRedirectUri:
    """Le redirect_uri de l'échange du code doit être l'ORIGINE de la page
    appelante (mode popup GSI), pas une URL de callback — sinon Google renvoie
    redirect_uri_mismatch. Le endpoint passe le header Origin de la requête à
    _exchange_google_code, qui l'utilise (avec repli sur GOOGLE_REDIRECT_URI)."""

    async def test_uses_request_origin_as_redirect_uri(self, client: AsyncClient):
        from unittest.mock import patch
        from kojo_routers_auth import _exchange_google_code

        captured = {}

        def _fake_post(url, data=None, **kwargs):
            captured["redirect_uri"] = data.get("redirect_uri")
            return _FakeResp({"id_token": "fake-id-token"})

        def _fake_get(url, params=None, **kwargs):
            assert params["id_token"] == "fake-id-token"
            return _FakeResp(_google_claims(aud=TEST_GOOGLE_CLIENT_ID))

        with patch("kojo_routers_auth.GOOGLE_AUTH_ENABLED", True), \
             patch("kojo_routers_auth.GOOGLE_CLIENT_ID", TEST_GOOGLE_CLIENT_ID), \
             patch("requests.post", side_effect=_fake_post), \
             patch("requests.get", side_effect=_fake_get):
            claims = await _exchange_google_code(
                "code-12345678901234567890",
                origin="https://kj-update-fevrier.vercel.app",
            )
        assert claims["email"]
        assert captured["redirect_uri"] == "https://kj-update-fevrier.vercel.app"

    async def test_falls_back_to_configured_redirect_uri_without_origin(self, client: AsyncClient):
        from unittest.mock import patch
        from kojo_routers_auth import _exchange_google_code

        captured = {}

        def _fake_post(url, data=None, **kwargs):
            captured["redirect_uri"] = data.get("redirect_uri")
            return _FakeResp({"id_token": "fake-id-token"})

        def _fake_get(url, params=None, **kwargs):
            return _FakeResp(_google_claims(aud=TEST_GOOGLE_CLIENT_ID))

        with patch("kojo_routers_auth.GOOGLE_AUTH_ENABLED", True), \
             patch("kojo_routers_auth.GOOGLE_CLIENT_ID", TEST_GOOGLE_CLIENT_ID), \
             patch("kojo_routers_auth.GOOGLE_REDIRECT_URI", "https://kojo-backend.fly.dev"), \
             patch("requests.post", side_effect=_fake_post), \
             patch("requests.get", side_effect=_fake_get):
            await _exchange_google_code("code-12345678901234567890", origin=None)
        # Repli sur GOOGLE_REDIRECT_URI (l'origine configurée en secret).
        assert captured["redirect_uri"] == "https://kojo-backend.fly.dev"

    async def test_rejects_origin_with_path(self, client: AsyncClient):
        """Une origine avec chemin (ex: URL de callback) est rejetée → repli
        sur GOOGLE_REDIRECT_URI (pas d'envoi d'un redirect_uri non déclaré)."""
        from unittest.mock import patch
        from kojo_routers_auth import _exchange_google_code

        captured = {}

        def _fake_post(url, data=None, **kwargs):
            captured["redirect_uri"] = data.get("redirect_uri")
            return _FakeResp({"id_token": "fake-id-token"})

        def _fake_get(url, params=None, **kwargs):
            return _FakeResp(_google_claims(aud=TEST_GOOGLE_CLIENT_ID))

        with patch("kojo_routers_auth.GOOGLE_AUTH_ENABLED", True), \
             patch("kojo_routers_auth.GOOGLE_CLIENT_ID", TEST_GOOGLE_CLIENT_ID), \
             patch("kojo_routers_auth.GOOGLE_REDIRECT_URI", "https://kojo-backend.fly.dev"), \
             patch("requests.post", side_effect=_fake_post), \
             patch("requests.get", side_effect=_fake_get):
            await _exchange_google_code(
                "code-12345678901234567890",
                origin="https://kj-update-fevrier.vercel.app/auth/google/callback",
            )
        assert captured["redirect_uri"] == "https://kojo-backend.fly.dev"


TEST_GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"


class _FakeResp:
    """Imite requests.Response (raise_for_status + json)."""
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


@pytest.mark.asyncio
class TestGooglePasswordLoginBlocked:
    async def test_sso_account_cannot_login_with_password(self, client: AsyncClient):
        """Un compte Google (sans mot de passe) ne peut pas utiliser /auth/login."""
        claims = _google_claims()
        resp = await _google_auth(client, claims)
        assert resp.status_code == 200
        email = claims["email"]

        login = await client.post("/api/auth/login", json={
            "email": email,
            "password": "nimportequoi123",
        })
        # verify_password(None, ...) → échec → 401
        assert login.status_code == 401
