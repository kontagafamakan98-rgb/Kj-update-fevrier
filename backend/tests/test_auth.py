"""Tests des endpoints d'authentification."""
import pytest
from httpx import AsyncClient
from tests.conftest import (
    BASE_USER, WORKER_USER, AUTH_REQUIRED_STATUS,
    auth_headers, register_and_login, issue_email_verification_token,
)


@pytest.mark.asyncio
class TestRegister:
    async def _register(self, client: AsyncClient, user_data: dict = None) -> "tuple[int, dict]":
        """Inscription via le flux vérifié (email OTP + comptes de paiement)."""
        data = dict(user_data or BASE_USER)
        token = await issue_email_verification_token(client, data["email"])
        resp = await client.post("/api/auth/register-verified", json={**data, "email_verification_token": token})
        return resp.status_code, resp.json()

    async def test_register_client_success(self, client: AsyncClient):
        status, data = await self._register(client, BASE_USER)
        assert status == 200
        assert "access_token" in data
        assert data["user"]["email"] == BASE_USER["email"]
        assert "password_hash" not in data["user"]

    async def test_register_worker_success(self, client: AsyncClient):
        status, data = await self._register(client, WORKER_USER)
        assert status == 200
        assert data["user"]["user_type"] == "worker"

    async def test_register_duplicate_email(self, client: AsyncClient):
        await self._register(client, BASE_USER)
        status, _ = await self._register(client, BASE_USER)
        assert status == 400

    async def test_register_without_email_verification_rejected(self, client: AsyncClient):
        """SECURITE : l'inscription SANS jeton de vérification email doit être rejetée."""
        resp = await client.post("/api/auth/register-verified", json=BASE_USER)
        assert resp.status_code == 400
        assert "email" in resp.json()["detail"].lower()

    async def test_register_unverified_endpoint_removed(self, client: AsyncClient):
        """SECURITE : l'ancien endpoint /auth/register (sans vérification) a été supprimé."""
        resp = await client.post("/api/auth/register", json=BASE_USER)
        assert resp.status_code == 404

    async def test_register_missing_required_fields(self, client: AsyncClient):
        resp = await client.post("/api/auth/register-verified", json={"email": "x@x.com"})
        assert resp.status_code in (400, 422)

    async def test_register_weak_password(self, client: AsyncClient):
        user = {**BASE_USER, "password": "abc"}
        status, _ = await self._register(client, user)
        assert status in (400, 422)

    async def test_register_invalid_email(self, client: AsyncClient):
        """Un email invalide doit être rejeté (avant même la vérification)."""
        user = {**BASE_USER, "email": "not-an-email"}
        resp = await client.post("/api/auth/register-verified", json=user)
        assert resp.status_code in (400, 422)

    async def test_register_terms_not_accepted(self, client: AsyncClient):
        user = {**BASE_USER, "legal_documents_accepted": False}
        status, _ = await self._register(client, user)
        assert status in (400, 422)

    async def test_password_not_returned(self, client: AsyncClient):
        """Garantit qu'aucun champ mot de passe ne fuite dans la réponse."""
        status, data = await self._register(client, BASE_USER)
        assert status == 200
        assert "password_hash" not in data["user"]
        assert BASE_USER["password"] not in str(data)


@pytest.mark.asyncio
class TestLogin:
    async def _login(self, client: AsyncClient, email: str, password: str):
        return await client.post("/api/auth/login", json={"email": email, "password": password})

    async def test_login_success(self, client: AsyncClient):
        await register_and_login(client, BASE_USER)
        resp = await self._login(client, BASE_USER["email"], BASE_USER["password"])
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_login_wrong_password(self, client: AsyncClient):
        await register_and_login(client, BASE_USER)
        resp = await self._login(client, BASE_USER["email"], "wrongpassword")
        assert resp.status_code == 401

    async def test_login_unknown_email(self, client: AsyncClient):
        resp = await self._login(client, "nobody@kojo.sn", "anypassword")
        assert resp.status_code == 401

    async def test_login_invalid_email_format(self, client: AsyncClient):
        resp = await self._login(client, "'; DROP TABLE users; --", "doesntmatter")
        assert resp.status_code in (400, 401, 422)

    async def test_token_has_jti(self, client: AsyncClient):
        """Chaque token doit contenir un jti pour la révocation."""
        import jwt as pyjwt
        await register_and_login(client, BASE_USER)
        resp = await self._login(client, BASE_USER["email"], BASE_USER["password"])
        assert resp.status_code == 200
        token = resp.json()["access_token"]
        payload = pyjwt.decode(token, options={"verify_signature": False})
        assert "jti" in payload


@pytest.mark.asyncio
class TestLogout:
    async def test_logout_revokes_token(self, client: AsyncClient):
        """Après logout, le token ne doit plus être accepté."""
        headers = await auth_headers(client)
        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200

        resp = await client.post("/api/auth/logout", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "success"

        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 401

    async def test_logout_without_token(self, client: AsyncClient):
        resp = await client.post("/api/auth/logout")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_double_logout_rejected(self, client: AsyncClient):
        headers = await auth_headers(client)
        await client.post("/api/auth/logout", headers=headers)
        resp = await client.post("/api/auth/logout", headers=headers)
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestProtectedRoutes:
    async def test_me_requires_auth(self, client: AsyncClient):
        resp = await client.get("/api/auth/me")
        assert resp.status_code in AUTH_REQUIRED_STATUS

    async def test_me_returns_user(self, client: AsyncClient):
        headers = await auth_headers(client)
        resp = await client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == BASE_USER["email"]

    async def test_invalid_token_rejected(self, client: AsyncClient):
        resp = await client.get("/api/auth/me", headers={
            "Authorization": "Bearer invalid.token.here"
        })
        assert resp.status_code == 401

    async def test_expired_token_rejected(self, client: AsyncClient):
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        expired_token = pyjwt.encode(
            {
                "sub": "fake-id",
                "email": "x@x.com",
                "exp": datetime.now(timezone.utc) - timedelta(hours=1),
                "jti": "x"
            },
            "test-secret-kojo-pytest-only-32chars!!",
            algorithm="HS256"
        )
        resp = await client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {expired_token}"
        })
        assert resp.status_code == 401
