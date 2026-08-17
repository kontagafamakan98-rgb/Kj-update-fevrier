"""
Fixtures partagées pour la suite de tests Kojo.

DEUX MODES DE BASE DE DONNÉES :

1. Par défaut (local, sans Docker) : une fausse base en mémoire (FakeDB) qui
   reproduit un sous-ensemble de l'API Motor. Rapide et hermétic.

2. Vrai MongoDB : définir la variable d'environnement TEST_MONGO_URL
   (ex: mongodb://localhost:27017) pour exécuter la SUITE COMPLÈTE contre une
   vraie instance Mongo (mode utilisé en CI via un service container, et
   recommandé localement avec Docker : `docker run -d -p 27017:27017 mongo`).

Le but du mode réel : éviter les faux positifs de la FakeDB (atomicité,
indexes, opérateurs $inc/$push, tri, agrégations réels). Les helpers
`db_insert` / `db_find` abstraient la différence pour les tests qui
manipulent des documents directement.
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# ---------------------------------------------------------------------------
# Variables d'env AVANT tout import de server.py
# ---------------------------------------------------------------------------
TEST_MONGO_URL = os.environ.get("TEST_MONGO_URL", "").strip()
USE_REAL_MONGO = bool(TEST_MONGO_URL)

os.environ["JWT_SECRET"] = "test-secret-kojo-pytest-only-32chars!!"
os.environ["EMAIL_OTP_SECRET"] = "test-otp-secret-kojo-pytest-32chars!!"
if USE_REAL_MONGO:
    os.environ["MONGO_URL"] = TEST_MONGO_URL
else:
    os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "kojo_test"
os.environ["APP_ENV"] = "test"
os.environ["REDIS_URL"] = ""
os.environ["DISABLE_TRUSTED_HOST_MIDDLEWARE"] = "true"
# Aucun envoi d'email réel pendant les tests (code OTP généré mais non envoyé).
os.environ["EMAIL_PROVIDER"] = "none"

# Code OTP déterministe utilisé par les tests (le backend estime que le code
# a été envoyé par email ; ici on le connaît d'avance).
TEST_OTP_CODE = "123456"


# ---------------------------------------------------------------------------
# FakeCollection et FakeDB (mode local sans MongoDB)
# ---------------------------------------------------------------------------

class FakeCollection:
    def __init__(self):
        self._docs: List[Dict] = []

    def _match(self, query: Dict, doc: Dict) -> bool:
        for key, value in query.items():
            if key == "$or":
                if not any(self._match(sub, doc) for sub in value):
                    return False
            elif key == "$and":
                if not all(self._match(sub, doc) for sub in value):
                    return False
            elif isinstance(value, dict):
                doc_val = doc.get(key)
                for op, op_val in value.items():
                    if op == "$ne" and doc_val == op_val:
                        return False
                    elif op == "$in" and doc_val not in op_val:
                        return False
                    elif op == "$nin" and doc_val in op_val:
                        return False
                    elif op == "$exists":
                        if op_val and key not in doc:
                            return False
                        if not op_val and key in doc:
                            return False
                    elif op == "$geoWithin":
                        # Implémentation haversine de $centerSphere pour la
                        # FakeDB (le vrai Mongo utilise l'index 2dsphere).
                        center_sphere = op_val.get("$centerSphere") if isinstance(op_val, dict) else None
                        if not center_sphere or len(center_sphere) != 2:
                            return False
                        center, radius_radians = center_sphere
                        doc_geo = doc.get(key) if isinstance(doc.get(key), dict) else None
                        doc_coords = doc_geo.get("coordinates") if isinstance(doc_geo, dict) else None
                        if not doc_coords or len(doc_coords) != 2:
                            return False
                        import math
                        lat1, lng1 = float(center[1]), float(center[0])
                        lat2, lng2 = float(doc_coords[1]), float(doc_coords[0])
                        def _hav(lat_a, lng_a, lat_b, lng_b):
                            to_rad = lambda d: d * math.pi / 180.0
                            d_lat = to_rad(lat_b - lat_a)
                            d_lng = to_rad(lng_b - lng_a)
                            a = math.sin(d_lat / 2) ** 2 + math.cos(to_rad(lat_a)) * math.cos(to_rad(lat_b)) * math.sin(d_lng / 2) ** 2
                            return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                        if _hav(lat1, lng1, lat2, lng2) > radius_radians * 6371.0:
                            return False
            else:
                if doc.get(key) != value:
                    return False
        return True

    def _project(self, doc: Dict, projection: Optional[Dict]) -> Dict:
        if not projection:
            return {k: v for k, v in doc.items() if k != "_id"}
        include = {k for k, v in projection.items() if v and k != "_id"}
        exclude = {k for k, v in projection.items() if not v}
        if include:
            return {k: v for k, v in doc.items() if k in include}
        return {k: v for k, v in doc.items() if k not in exclude and k != "_id"}

    async def find_one(self, query=None, projection=None, sort=None):
        """find_one avec tri optionnel (utilisé par ex. par la clôture de
        mission pour retrouver le paiement le plus récent).
        Accepte sort="field" ou sort=[("field", -1)] comme le vrai Mongo."""
        query = query or {}
        matches = [d for d in self._docs if self._match(query, d)]
        if sort and len(matches) > 1:
            if isinstance(sort, list):
                sort_key, sort_dir = sort[0]
            else:
                sort_key, sort_dir = sort, 1
            matches = sorted(
                matches,
                key=lambda d: str(d.get(sort_key, "")),
                reverse=sort_dir == -1,
            )
        if not matches:
            return None
        return self._project(matches[0], projection)

    def find(self, query=None, projection=None):
        query = query or {}
        results = [self._project(d, projection) for d in self._docs if self._match(query, d)]
        return FakeCursor(results)

    async def insert_one(self, doc: Dict):
        self._docs.append(dict(doc))
        result = MagicMock()
        result.inserted_id = doc.get("_id", str(uuid.uuid4()))
        return result

    async def update_one(self, query: Dict, update: Dict, upsert: bool = False):
        for doc in self._docs:
            if self._match(query, doc):
                if "$set" in update:
                    doc.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        doc[k] = float(doc.get(k, 0)) + float(v)
                if "$push" in update:
                    for k, v in update["$push"].items():
                        doc.setdefault(k, []).append(v)
                result = MagicMock()
                result.matched_count = 1
                result.modified_count = 1
                return result
        if upsert:
            new_doc = {}
            new_doc.update(query)
            if "$set" in update:
                new_doc.update(update["$set"])
            if "$inc" in update:
                for k, v in update["$inc"].items():
                    new_doc[k] = float(v)
            self._docs.append(new_doc)
        result = MagicMock()
        result.matched_count = 0
        result.modified_count = 0
        return result

    async def delete_one(self, query: Dict):
        for i, doc in enumerate(self._docs):
            if self._match(query, doc):
                self._docs.pop(i)
                result = MagicMock()
                result.deleted_count = 1
                return result
        result = MagicMock()
        result.deleted_count = 0
        return result

    async def update_many(self, query: Dict, update: Dict):
        """Met à jour tous les documents correspondants (utilisé par
        l'acceptation de proposition pour rejeter les autres)."""
        matched = 0
        for doc in self._docs:
            if not self._match(query, doc):
                continue
            matched += 1
            if "$set" in update:
                doc.update(update["$set"])
            if "$inc" in update:
                for k, v in update["$inc"].items():
                    doc[k] = float(doc.get(k, 0)) + float(v)
            if "$push" in update:
                for k, v in update["$push"].items():
                    doc.setdefault(k, []).append(v)
        result = MagicMock()
        result.matched_count = matched
        result.modified_count = matched
        return result

    async def delete_many(self, query: Dict):
        before = len(self._docs)
        self._docs = [d for d in self._docs if not self._match(query, d)]
        result = MagicMock()
        result.deleted_count = before - len(self._docs)
        return result

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for d in self._docs if self._match(query, d))

    async def create_index(self, *args, **kwargs):
        pass

    def reset(self):
        self._docs.clear()


class FakeCursor:
    def __init__(self, docs: List[Dict]):
        self._docs = list(docs)
        self._sort_key = None
        self._sort_dir = 1

    def sort(self, key_or_list, direction=1):
        # Accepte sort("field", 1) ou sort([("field", 1)])
        if isinstance(key_or_list, list):
            if key_or_list:
                self._sort_key, self._sort_dir = key_or_list[0]
        else:
            self._sort_key = key_or_list
            self._sort_dir = direction
        return self

    def skip(self, n):
        self._docs = self._docs[n:]
        return self

    def limit(self, n):
        if n:
            self._docs = self._docs[:n]
        return self

    def _sorted_docs(self):
        if not self._sort_key:
            return self._docs
        reverse = self._sort_dir == -1
        return sorted(
            self._docs,
            key=lambda d: str(d.get(self._sort_key, "")),
            reverse=reverse
        )

    async def to_list(self, length=None):
        docs = self._sorted_docs()
        return docs[:length] if length else docs

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for doc in self._sorted_docs():
            yield doc


class FakeDB:
    def __init__(self):
        self._collections: Dict[str, FakeCollection] = {}

    def __getattr__(self, name: str) -> FakeCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = FakeCollection()
        return self._collections[name]

    async def command(self, cmd):
        return {"ok": 1}

    def reset_all(self):
        for col in self._collections.values():
            col.reset()


fake_db = FakeDB()

# ---------------------------------------------------------------------------
# Import de server.py (après les env vars)
# ---------------------------------------------------------------------------
if USE_REAL_MONGO:
    # Vrai MongoDB : aucun patch Motor, la connexion pointe sur la vraie base.
    import server as _srv
else:
    # Mode FakeDB : on importe kojo_core AVANT server et on remplace db par la
    # fake avant que les routers ne fassent `from kojo_core import db` (sinon
    # ils garderaient la vraie référence au client Motor patché).
    with patch("motor.motor_asyncio.AsyncIOMotorClient"):
        import kojo_core as _core
        _core.db = fake_db
        import server as _srv

# ---------------------------------------------------------------------------
# Helpers d'accès DB (compatibles FakeDB / vrai MongoDB)
# ---------------------------------------------------------------------------

async def db_insert(collection: str, doc: Dict):
    """Insère un document dans la collection donnée (mode indifférent)."""
    if USE_REAL_MONGO:
        await _srv.db[collection].insert_one(dict(doc))
    else:
        getattr(fake_db, collection)._docs.append(dict(doc))


async def db_find_one(collection: str, query: Dict) -> Optional[Dict]:
    """find_one dans la collection donnée (mode indifférent)."""
    if USE_REAL_MONGO:
        return await _srv.db[collection].find_one(query)
    return await getattr(fake_db, collection).find_one(query)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def reset_state():
    # Le rate-limiter (mémoire, REDIS_URL vide) est partagé sur toute la
    # session ; on vide ses compteurs à chaque test pour éviter des 429
    # fantômes (buckets auth-otp 12/5min et auth-session 20/5min) en mode
    # réel comme en mode FakeDB.
    _srv.request_counts.clear()
    if USE_REAL_MONGO:
        await _srv.db.client.drop_database(_srv.db.name)
    else:
        fake_db.reset_all()
    yield
    _srv.request_counts.clear()
    if USE_REAL_MONGO:
        await _srv.db.client.drop_database(_srv.db.name)


@pytest_asyncio.fixture
async def client():
    """Client HTTP branché directement sur l'app ASGI.
    La validation de response_model est désactivée pour que les données
    retournées par la FakeDB (potentiellement incomplètes vs. le vrai Mongo)
    ne déclenchent pas des 422 lors de la sérialisation FastAPI.
    """
    for route in getattr(_srv.api_router, "routes", []):
        if hasattr(route, "response_model") and route.response_model is not None:
            route.response_model = None
    async with AsyncClient(
        transport=ASGITransport(app=_srv.app),
        base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_USER = {
    "email": "test@kojo.sn",
    "password": "password123",
    "first_name": "Kojo",
    "last_name": "Test",
    "phone": "+221771234567",
    "user_type": "client",
    "country": "senegal",
    "preferred_language": "fr",
    "legal_documents_accepted": True,
    "legal_documents_version": "v1.0.0-2024",
    # L'inscription exige désormais la vérification email ET au moins un
    # moyen de paiement pour un client.
    "payment_accounts": {
        "orange_money": "+221771234567",
    },
}

WORKER_USER = {
    **BASE_USER,
    "email": "worker@kojo.sn",
    "user_type": "worker",
    # Un travailleur doit lier au moins 2 moyens de paiement.
    "payment_accounts": {
        "orange_money": "+221771234567",
        "wave": "+221771234568",
    },
}

BASE_JOB = {
    "title": "Plomberie urgente Dakar",
    "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent.",
    "category": "plomberie",
    "budget_min": 10000,
    "budget_max": 30000,
    # Le endpoint create_job requiert location.address ou location.fullAddress
    # (pas location.text) - c'est ce que le frontend envoie réellement.
    "location": {"address": "Dakar Plateau, Sénégal", "lat": 14.69, "lng": -17.44},
}

# Code retourné par FastAPI/HTTPBearer quand l'Authorization header est absent :
# selon la version, 401 ou 403 - les deux signifient "non authentifié".
AUTH_REQUIRED_STATUS = (401, 403)


async def issue_email_verification_token(client: AsyncClient, email: str) -> str:
    """Crée un OTP vérifié pour `email` (sans envoi réel) et retourne le
    jeton de vérification à passer à /auth/register-verified.

    Reproduit le flux produit : send-otp → verify-otp → jeton. Ici l'OTP est
    inséré directement en base avec un code connu pour rester déterministe.
    """
    otp_hash = _srv.hash_email_otp(email, "signup", TEST_OTP_CODE)
    await _srv.db.email_otps.update_one(
        {"email": email.lower().strip(), "purpose": "signup"},
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
    resp = await client.post("/api/auth/email/verify-otp", json={
        "email": email,
        "otp": TEST_OTP_CODE,
        "purpose": "signup",
    })
    assert resp.status_code == 200, f"verify-otp failed: {resp.text}"
    return resp.json()["verification_token"]


async def register_and_login(client: AsyncClient, user_data: dict = None) -> dict:
    """Inscription via le flux vérifié (OTP + comptes de paiement), puis
    retourne la réponse (access_token + user)."""
    data = dict(user_data or BASE_USER)
    token = await issue_email_verification_token(client, data["email"])
    payload = {**data, "email_verification_token": token}
    resp = await client.post("/api/auth/register-verified", json=payload)
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    return resp.json()


async def auth_headers(client: AsyncClient, user_data: dict = None) -> dict:
    result = await register_and_login(client, user_data)
    return {"Authorization": f"Bearer {result['access_token']}"}
