"""
Fixtures partagées pour la suite de tests Kojo.
"""
import asyncio
import os
import uuid
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# ---------------------------------------------------------------------------
# Variables d'env AVANT tout import de server.py
# ---------------------------------------------------------------------------
os.environ["JWT_SECRET"] = "test-secret-kojo-pytest-only-32chars!!"
os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "kojo_test"
os.environ["APP_ENV"] = "test"
os.environ["REDIS_URL"] = ""
os.environ["DISABLE_TRUSTED_HOST_MIDDLEWARE"] = "true"

# ---------------------------------------------------------------------------
# FakeCollection et FakeDB
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

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for doc in self._docs:
            if self._match(query, doc):
                return self._project(doc, projection)
        return None

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
with patch("motor.motor_asyncio.AsyncIOMotorClient"):
    import server as _srv

_srv.db = fake_db

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def reset_state():
    fake_db.reset_all()
    _srv.request_counts.clear()
    yield


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
}

WORKER_USER = {
    **BASE_USER,
    "email": "worker@kojo.sn",
    "user_type": "worker",
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


async def register_and_login(client: AsyncClient, user_data: dict = None) -> dict:
    data = user_data or BASE_USER
    resp = await client.post("/api/auth/register", json=data)
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    return resp.json()


async def auth_headers(client: AsyncClient, user_data: dict = None) -> dict:
    result = await register_and_login(client, user_data)
    return {"Authorization": f"Bearer {result['access_token']}"}
