"""Tests des endpoints d'authentification."""
import pytest
from httpx import AsyncClient
from tests.conftest import BASE_USER, WORKER_USER, AUTH_REQUIRED_STATUS, auth_headers, register_and_login


@pytest.mark.asyncio
class TestRegister:
    async def test_register_client_success(self, client: AsyncClient):
        resp = await client.post("/api/auth/register", json=BASE_USER)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == BASE_USER["email"]
        assert "password_hash" not in data["user"]

    async def test_register_worker_success(self, client: AsyncClient):
        resp = await client.post("/api/auth/register", json=WORKER_USER)
        assert resp.status_code == 200
        assert resp.json()["user"]["user_type"] == "worker"

    async def test_register_duplicate_email(self, client: AsyncClient):
        await client.post("/api/auth/register", json=BASE_USER)
        resp = await client.post("/api/auth/register", json=BASE_USER)
        assert resp.status_code == 400

    async def test_register_missing_required_fields(self, client: AsyncClient):
        resp = await client.post("/api/auth/register", json={"email": "x@x.com"})
        assert resp.status_code in (400, 422)

    async def test_register_weak_password(self, client: AsyncClient):
        user = {**BASE_USER, "password": "abc"}
        resp = await client.post("/api/auth/register", json=user)
        assert resp.status_code in (400, 422)

    async def test_register_invalid_email(self, client: AsyncClient):
        user = {**BASE_USER, "email": "not-an-email"}
        resp = await client.post("/api/auth/register", json=user)
        assert resp.status_code in (400, 422)

    async def test_register_terms_not_accepted(self, client: AsyncClient):
        user = {**BASE_USER, "legal_documents_accepted": False}
        resp = await client.post("/api/auth/register", json=user)
        assert resp.status_code in (400, 422)

    async def test_password_not_returned(self, client: AsyncClient):
        """Garantit qu'aucun champ mot de passe ne fuite dans la réponse."""
        resp = await client.post("/api/auth/register", json=BASE_USER)
        body = resp.text
        assert "password_hash" not in body
        assert BASE_USER["password"] not in body


@pytest.mark.asyncio
class TestLogin:
    async def test_login_success(self, client: AsyncClient):
        await client.post("/api/auth/register", json=BASE_USER)
        resp = await client.post("/api/auth/login", json={
            "email": BASE_USER["email"],
            "password": BASE_USER["password"],
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    async def test_login_wrong_password(self, client: AsyncClient):
        await client.post("/api/auth/register", json=BASE_USER)
        resp = await client.post("/api/auth/login", json={
            "email": BASE_USER["email"],
            "password": "wrongpassword",
        })
        assert resp.status_code == 401

    async def test_login_unknown_email(self, client: AsyncClient):
        resp = await client.post("/api/auth/login", json={
            "email": "nobody@kojo.sn",
            "password": "anypassword",
        })
        assert resp.status_code == 401

    async def test_login_invalid_email_format(self, client: AsyncClient):
        resp = await client.post("/api/auth/login", json={
            "email": "'; DROP TABLE users; --",
            "password": "doesntmatter",
        })
        assert resp.status_code in (400, 401, 422)

    async def test_token_has_jti(self, client: AsyncClient):
        """Chaque token doit contenir un jti pour la révocation."""
        import jwt as pyjwt
        await client.post("/api/auth/register", json=BASE_USER)
        resp = await client.post("/api/auth/login", json={
            "email": BASE_USER["email"],
            "password": BASE_USER["password"],
        })
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
