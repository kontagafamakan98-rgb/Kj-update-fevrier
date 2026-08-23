"""Tests SEO/perf : sitemap dynamique, robots.txt backend, Cache-Control.

Couvre les 3 garanties de la découverte publique :
- /sitemap.xml énumère les fiches /jobs/:id des missions publiques (open
  + in_progress), en XML valide, avec cache court, et N'inclut pas de job
  supprimé/terminé.
- /robots.txt sert la balise Sitemap sur le bon domaine et n'interdit plus
  /jobs (découverte publique crawlabile).
- GET /api/jobs renvoie Cache-Control public court pour un visiteur anonyme,
  et AUCUN cache pour un utilisateur connecté (données personnelles).
"""
import pytest
from httpx import AsyncClient

from tests.conftest import (
    BASE_JOB, BASE_USER,
    auth_headers, db_insert, register_and_login,
)


@pytest.mark.asyncio
class TestSitemapDynamic:
    async def test_sitemap_includes_open_and_in_progress_jobs(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        open_job = (await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Mission ouverte sitemap", "category": "general",
        })).json()
        assert open_job["status"] == "open"

        # Job "in_progress" inséré directement (simule une mission attribuée).
        in_progress_id = "job-in-progress-sitemap"
        await db_insert("jobs", {
            "id": in_progress_id, "title": "Mission en cours sitemap",
            "client_id": "client-x", "status": "in_progress",
            "category": "general", "deleted": False,
        })

        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/xml")
        body = resp.text

        # Les URLs statiques + les fiches publiques sont présentes.
        assert "<loc>https://kj-update-fevrier.vercel.app/</loc>" in body
        assert f"<loc>https://kj-update-fevrier.vercel.app/jobs/{open_job['id']}</loc>" in body
        assert f"<loc>https://kj-update-fevrier.vercel.app/jobs/{in_progress_id}</loc>" in body

        # Cache court appliqué.
        assert "max-age=3600" in resp.headers.get("cache-control", "")

    async def test_sitemap_excludes_deleted_and_terminated_jobs(self, client: AsyncClient):
        # Job supprimé (soft delete) : ne doit PAS apparaître.
        await db_insert("jobs", {
            "id": "job-deleted-sitemap", "title": "Supprimé",
            "client_id": "client-x", "status": "open", "deleted": True,
        })
        # Job terminé : ne doit PAS apparaître non plus.
        await db_insert("jobs", {
            "id": "job-completed-sitemap", "title": "Terminé",
            "client_id": "client-x", "status": "completed", "deleted": False,
        })

        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200
        assert "deleted-sitemap" not in resp.text
        assert "completed-sitemap" not in resp.text

    async def test_robots_txt_served_and_allows_jobs(self, client: AsyncClient):
        resp = await client.get("/api/robots.txt")
        assert resp.status_code == 200
        body = resp.text
        assert "Sitemap: https://kj-update-fevrier.vercel.app/sitemap.xml" in body
        # La découverte publique ne doit plus être bloquée pour les crawlers.
        assert "Disallow: /jobs" not in body


@pytest.mark.asyncio
class TestJobsCacheControl:
    async def test_anonymous_list_has_public_cache(self, client: AsyncClient):
        resp = await client.get("/api/jobs")
        assert resp.status_code == 200
        cc = resp.headers.get("cache-control", "")
        assert "public" in cc
        assert "max-age=60" in cc

    async def test_authenticated_list_has_no_cache(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        resp = await client.get("/api/jobs", headers=headers)
        assert resp.status_code == 200
        cc = resp.headers.get("cache-control", "")
        assert "public" not in cc
        assert "max-age=60" not in cc