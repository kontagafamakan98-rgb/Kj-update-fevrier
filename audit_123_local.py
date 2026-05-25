#!/usr/bin/env python3
"""Audit local ciblé pour les catégories 1, 2 et 3 (authentification, profil, emplois/messages)."""

import sys
import uuid

import requests

BASE_URL = "http://127.0.0.1:8090/api"


class Audit123Local:
    def __init__(self):
        self.tests = []
        self.client_token = None
        self.worker_token = None
        self.client_user_id = None
        self.worker_user_id = None
        self.job_id = None

    def record(self, name, ok, detail):
        self.tests.append((name, ok, detail))
        icon = "✅" if ok else "❌"
        print(f"{icon} {name}: {detail}")

    def request(self, method, endpoint, payload=None, token=None):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if payload is not None:
            headers["Content-Type"] = "application/json"
        url = f"{BASE_URL}/{endpoint.lstrip('/')}"
        response = requests.request(method, url, json=payload, headers=headers, timeout=30)
        return response

    def require(self, method, endpoint, expected, payload=None, token=None):
        response = self.request(method, endpoint, payload=payload, token=token)
        ok = response.status_code == expected
        detail = f"status={response.status_code}"
        if not ok:
            detail += f" body={response.text[:300]}"
        return ok, response

    def run(self):
        print("🚀 AUDIT LOCAL CIBLÉ 1,2,3")
        print("=" * 60)

        ok, response = self.require("GET", "health", 200)
        self.record("Health check", ok, f"status={response.status_code}")
        if not ok:
            return False

        unique = uuid.uuid4().hex[:8]
        client_email = f"client_{unique}@example.com"
        worker_email = f"worker_{unique}@example.com"

        client_payload = {
            "email": client_email,
            "password": "KojoTest2024!",
            "first_name": "Aminata",
            "last_name": "Diallo",
            "phone": "+221701234567",
            "user_type": "client",
            "country": "senegal",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
            "legal_documents_accepted_at": "2026-01-01T00:00:00Z",
            "legal_documents_version": "v1.0.0",
        }

        worker_payload = {
            "email": worker_email,
            "password": "KojoTest2024!",
            "first_name": "Mamadou",
            "last_name": "Traoré",
            "phone": "+223701234567",
            "user_type": "worker",
            "country": "mali",
            "preferred_language": "fr",
            "legal_documents_accepted": True,
            "legal_documents_accepted_at": "2026-01-01T00:00:00Z",
            "legal_documents_version": "v1.0.0",
        }

        ok, response = self.require("POST", "auth/register", 200, payload=client_payload)
        self.record("Inscription client", ok, f"status={response.status_code}")
        if not ok:
            return False
        client_data = response.json()
        self.client_token = client_data["access_token"]

        ok, response = self.require("POST", "auth/register", 200, payload=worker_payload)
        self.record("Inscription worker", ok, f"status={response.status_code}")
        if not ok:
            return False
        worker_data = response.json()
        self.worker_token = worker_data["access_token"]
        self.client_user_id = client_data["user"]["id"]
        self.worker_user_id = worker_data["user"]["id"]

        ok, response = self.require(
            "POST",
            "auth/login",
            200,
            payload={"email": client_email, "password": "KojoTest2024!"},
        )
        self.record("Connexion client", ok, f"status={response.status_code}")
        if not ok:
            return False

        ok, response = self.require("GET", "users/profile", 200, token=self.client_token)
        self.record("GET profil", ok, f"status={response.status_code}")
        if not ok:
            return False

        ok, response = self.require(
            "PUT",
            "users/profile",
            200,
            payload={"first_name": "Aminata Updated", "preferred_language": "wo"},
            token=self.client_token,
        )
        self.record("PUT profil", ok, f"status={response.status_code}")
        if not ok:
            return False

        job_payload = {
            "title": "Réparation Moto - Yamaha 125cc",
            "description": "Ma moto Yamaha 125cc a des problèmes de démarrage. Besoin d'un mécanicien expérimenté.",
            "category": "mécanique",
            "budget_min": 25000.0,
            "budget_max": 50000.0,
            "location": {
                "address": "Médina, Dakar, Sénégal",
                "latitude": 14.6937,
                "longitude": -17.4441,
            },
            "required_skills": ["mécanique moto", "diagnostic moteur"],
            "estimated_duration": "2-3 heures",
            "mechanic_must_bring_parts": True,
            "mechanic_must_bring_tools": True,
            "parts_and_tools_notes": "Apporter outils de diagnostic et pièces Yamaha 125cc",
        }

        ok, response = self.require("POST", "jobs", 200, payload=job_payload, token=self.client_token)
        self.job_id = response.json().get("id") if ok else None
        self.record("Création job", ok, f"status={response.status_code} job_id={self.job_id or 'n/a'}")
        if not ok:
            return False

        ok, response = self.require("GET", "jobs", 200, token=self.client_token)
        self.record("Liste jobs", ok, f"status={response.status_code} items={len(response.json()) if ok and isinstance(response.json(), list) else 'n/a'}")
        if not ok:
            return False

        message_payload = {
            "receiver_id": self.worker_user_id,
            "content": "Bonjour, j'ai vu votre proposition pour la réparation de ma moto.",
        }

        ok, response = self.require("POST", "messages", 200, payload=message_payload, token=self.client_token)
        self.record("Envoi message", ok, f"status={response.status_code}")
        if not ok:
            return False

        ok, response = self.require("GET", "messages/conversations", 200, token=self.client_token)
        self.record("Conversations", ok, f"status={response.status_code} conversations={len(response.json()) if ok and isinstance(response.json(), list) else 'n/a'}")
        return ok


if __name__ == "__main__":
    audit = Audit123Local()
    passed = audit.run()
    total = len(audit.tests)
    success = sum(1 for _, ok, _ in audit.tests if ok)
    print("=" * 60)
    print(f"Tests: {success}/{total}")
    print(f"Taux de réussite: {success / total * 100:.1f}%")
    if passed:
        print("✅ Audit 1,2,3 OK")
        sys.exit(0)
    print("❌ Audit 1,2,3 KO")
    sys.exit(1)
