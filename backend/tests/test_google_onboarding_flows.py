"""Flux de complétion de profil pour les comptes créés via Google (SSO).

Un compte Google n'a NI téléphone NI mot de passe au départ :
- phone = "" (Google ne fournit pas de numéro)
- password_hash = None (identification par google_sub)

Ce fichier vérifie qu'un tel compte peut compléter son profil et utiliser
chaque fonctionnalité sans blocage :
1. Ajout des comptes de paiement (onboarding) → is_verified=True
2. Checkout : le phone du customer PayDunya retombe sur le numéro mobile
   money du client quand le champ phone du User est vide
3. Mise à jour du profil (ajout du téléphone)
4. Notifications push (enregistrement du token, sans phone requis)
"""
import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import db_find_one


def _google_claims(email=None):
    return {
        "sub": f"google-sub-{uuid.uuid4().hex[:12]}",
        "email": email or f"g-{uuid.uuid4().hex[:8]}@gmail.com",
        "email_verified": True,
        "given_name": "Alpha",
        "family_name": "Beta",
        "name": "Alpha Beta",
        "picture": "https://lh3.googleusercontent.com/photo",
        "locale": "fr",
    }


async def _google_login(client, email=None):
    """Crée/connecte un compte Google et retourne headers + user."""
    from unittest.mock import patch
    claims = _google_claims(email=email)
    with patch("kojo_routers_auth._exchange_google_code", return_value=claims):
        resp = await client.post("/api/auth/google", json={
            "code": f"google-auth-code-{uuid.uuid4().hex[:10]}",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
        })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    return headers, data["user"]


@pytest.mark.asyncio
class TestGoogleOnboardingPayment:
    async def test_google_account_can_add_payment_accounts_and_get_verified(self, client: AsyncClient):
        """Un compte Google (sans phone) ajoute ses comptes de paiement →
        is_verified devient True (onboarding complet)."""
        headers, user = await _google_login(client)
        assert user["phone"] in (None, "")
        assert user["is_verified"] is False

        resp = await client.get("/api/users/payment-accounts", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["payment_accounts_count"] == 0

        resp = await client.put("/api/users/payment-accounts", headers=headers, json={
            "orange_money": "+221771234567",
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["payment_verification"]["is_verified"] is True

        user_after = await db_find_one("users", {"id": user["id"]})
        assert user_after["is_verified"] is True
        assert user_after["payment_accounts_count"] == 1

    async def test_checkout_falls_back_to_mobile_money_phone(self, client: AsyncClient):
        """Le checkout PayDunya utilise le numéro mobile money du client comme
        phone du customer quand le champ phone du User est vide (compte Google).
        Sans ce fallback, PayDunya recevrait un phone vide et la facture
        échouerait."""
        from unittest.mock import AsyncMock, patch

        headers, user = await _google_login(client)
        # Onboarding : ajout d'un compte Orange Money (le numéro servira de phone)
        resp = await client.put("/api/users/payment-accounts", headers=headers, json={
            "orange_money": "+221771234567",
        })
        assert resp.status_code == 200, resp.text

        captured_payload = {}

        def _fake_create_invoice(payload):
            captured_payload["payload"] = payload
            return {"token": "invoice-token-google", "response_code": "00", "response_text": "https://paydunya.test/checkout"}

        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_routers_payments.create_paydunya_invoice", side_effect=_fake_create_invoice), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "amount": 1000,
                "payment_method": "orange_money",
                "country": "senegal",
            })
        assert resp.status_code == 200, resp.text

        customer = captured_payload["payload"]["invoice"]["customer"]
        assert customer["phone"] == "+221771234567", (
            "Le phone du customer PayDunya doit retomber sur le numéro mobile "
            "money du client quand le User n'a pas de phone (compte Google)."
        )

    async def test_profile_update_adds_phone(self, client: AsyncClient):
        """Un compte Google peut compléter son profil en ajoutant son téléphone."""
        headers, user = await _google_login(client)

        resp = await client.put("/api/users/profile", headers=headers, json={
            "phone": "+22170123456",
            "bio": "Disponible pour des missions.",
        })
        assert resp.status_code == 200, resp.text

        user_after = await db_find_one("users", {"id": user["id"]})
        assert user_after["phone"] == "+22170123456"
        assert user_after["bio"] == "Disponible pour des missions."


@pytest.mark.asyncio
class TestGoogleNotifications:
    async def test_google_account_can_register_push_token(self, client: AsyncClient):
        """L'enregistrement du jeton de notification push ne requiert pas de
        téléphone : un compte Google peut le faire."""
        headers, user = await _google_login(client)

        resp = await client.post("/api/users/push-token", headers=headers, json={
            "user_id": user["id"],
            "push_token": "push-token-google-12345",
            "device_type": "web",
            "device_id": "device-google-1",
        })
        assert resp.status_code == 200, resp.text

        resp = await client.get("/api/users/push-tokens", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["count"] == 1
        assert data["tokens"][0]["device_type"] == "web"


@pytest.mark.asyncio
class TestGoogleJobs:
    async def test_google_client_can_create_job(self, client: AsyncClient):
        """Un client Google (sans phone) peut créer un job : la création ne
        requiert pas le champ phone du User."""
        headers, user = await _google_login(client)

        resp = await client.post("/api/jobs", headers=headers, json={
            "title": "Plomberie urgente Dakar",
            "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent.",
            "category": "plomberie",
            "budget_min": 10000,
            "budget_max": 30000,
            "location": {"address": "Dakar Plateau, Sénégal", "lat": 14.69, "lng": -17.44},
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "open"
