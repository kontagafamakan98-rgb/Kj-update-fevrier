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
class TestJobOgImage:
    """Carte Open Graph dynamique des fiches mission (/api/og/jobs/:id.png).

    Le frontend pointe og:image de JobDetails vers cet endpoint : le crawler
    doit recevoir un vrai PNG 1200x630 (signature vérifiée) avec le titre de
    la mission, et un 404 propre pour une fiche inconnue.
    """

    async def test_og_image_is_valid_png_with_job_title(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        job = (await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Mission avec carte OG dynamique", "category": "general",
        })).json()
        assert job["id"]

        resp = await client.get(f"/api/og/jobs/{job['id']}.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/png")
        # Signature PNG + en-tête IHDR 1200x630 (premières 24 octets).
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
        width = int.from_bytes(resp.content[16:20], "big")
        height = int.from_bytes(resp.content[20:24], "big")
        assert (width, height) == (1200, 630)
        # Cache court (les fiches peuvent être clôturées).
        assert "max-age=3600" in resp.headers.get("cache-control", "")

    async def test_og_image_404_for_missing_job(self, client: AsyncClient):
        resp = await client.get("/api/og/jobs/unknown-job-xyz.png")
        assert resp.status_code == 404

    async def test_og_square_image_is_1200x1200(self, client: AsyncClient):
        """La variante carrée (-square.png) est un PNG 1200x1200 valide."""
        headers = await auth_headers(client, BASE_USER)
        job = (await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB, "title": "Carte carrée pour vignette", "category": "general",
        })).json()
        assert job["id"]

        resp = await client.get(f"/api/og/jobs/{job['id']}-square.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/png")
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
        width = int.from_bytes(resp.content[16:20], "big")
        height = int.from_bytes(resp.content[20:24], "big")
        assert (width, height) == (1200, 1200)
        assert "max-age=3600" in resp.headers.get("cache-control", "")

    async def test_og_square_404_for_missing_job(self, client: AsyncClient):
        resp = await client.get("/api/og/jobs/unknown-job-xyz-square.png")
        assert resp.status_code == 404

    # Cache LONG (24 h + revalidation) pour les missions CLÔTURÉES : leurs
    # états terminaux (completed/cancelled) rendent la carte OG immuable, on
    # évite les re-fetchs des crawlers. Les missions ouvertes gardent 1 h.
    async def test_og_image_cache_is_long_for_completed_job(self, client: AsyncClient):
        """Une mission COMPLÉTÉE sert sa carte en cache 24 h + revalidation."""
        await db_insert("jobs", {
            "id": "og-closed-wide-001",
            "title": "Mission terminée — mise en cache longue",
            "description": "Mission achevée, carte immuable.",
            "category": "general",
            "budget_min": 5000,
            "budget_max": 12000,
            "location_text": "Dakar, Sénégal",
            "status": "completed",
            "deleted": False,
        })
        resp = await client.get("/api/og/jobs/og-closed-wide-001.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/png")
        cc = resp.headers.get("cache-control", "")
        assert "max-age=86400" in cc
        assert "s-maxage=86400" in cc
        assert "must-revalidate" in cc

    async def test_og_square_image_cache_is_long_for_cancelled_job(self, client: AsyncClient):
        """La variante carrée d'une mission ANNULÉE est aussi en cache 24 h."""
        await db_insert("jobs", {
            "id": "og-closed-square-002",
            "title": "Mission annulée — cache carré long",
            "description": "Mission annulée.",
            "category": "plomb" ,
            "budget_min": 8000,
            "budget_max": 20000,
            "location_text": "Bamako, Mali",
            "status": "cancelled",
            "deleted": False,
        })
        resp = await client.get("/api/og/jobs/og-closed-square-002-square.png")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/png")
        cc = resp.headers.get("cache-control", "")
        assert "max-age=86400" in cc


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


@pytest.mark.asyncio
class TestJobOgHtml:
    """Pré-rendu HTML des fiches mission (/api/og/jobs/:id) — servi aux
    crawlers via le rewrite Vercel /jobs/(.*) (remplace la fonction
    serverless api/og-jobs/[id].js jamais déployée par Vercel).
    """

    async def test_og_html_serves_job_meta(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)
        job = (await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB,
            "title": "Fiche avec HTML pré-rendu",
            "category": "general",
            "description": "Description courte pour la carte de partage.",
        })).json()
        assert job["id"]

        resp = await client.get(f"/api/og/jobs/{job['id']}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert "Fiche avec HTML pré-rendu" in resp.text
        # Cartes wide + carrée pointées vers les endpoints Pillow du backend.
        assert f"/api/og/jobs/{job['id']}.png" in resp.text
        assert f"/api/og/jobs/{job['id']}-square.png" in resp.text
        assert resp.text.count('property="og:image"') == 2
        assert 'name="twitter:image"' in resp.text
        # Shell h1 statique (LCP avant boot React) présent.
        assert "<h1" in resp.text
        assert "text-3xl font-bold text-gray-900" in resp.text
        # Pas de noindex sur une mission existante.
        assert "noindex" not in resp.headers.get("x-robots-tag", "")

    async def test_og_html_404_noindex_for_missing_job(self, client: AsyncClient):
        resp = await client.get("/api/og/jobs/unknown-job-xyz")
        assert resp.status_code == 404
        assert resp.headers["content-type"].startswith("text/html")
        assert "noindex" in resp.headers.get("x-robots-tag", "")
        assert "unknown-job-xyz" not in resp.text

    async def test_og_html_escapes_job_data(self, client: AsyncClient):
        """Les données utilisateur (titre/description) sont échappées dans le
        HTML servi — jamais injectées brutes (XSS via crawler/bot)."""
        headers = await auth_headers(client, BASE_USER)
        job = (await client.post("/api/jobs", headers=headers, json={
            **BASE_JOB,
            "title": "Mission & Co <script>alert(1)</script>",
            "category": "general",
        })).json()

        resp = await client.get(f"/api/og/jobs/{job['id']}")
        assert resp.status_code == 200
        assert "<script>alert(1)</script>" not in resp.text
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in resp.text
        assert "&amp;" in resp.text

    async def test_og_html_cache_long_for_closed_job(self, client: AsyncClient):
        """Même politique de cache que les cartes : 24 h + revalidation pour
        une mission clôturée (immuable), 1 h sinon."""
        await db_insert("jobs", {
            "id": "og-html-closed-001",
            "title": "Mission HTML terminée",
            "description": "Achevée.",
            "category": "general",
            "budget_min": 5000,
            "budget_max": 12000,
            "location_text": "Dakar, Sénégal",
            "status": "completed",
            "deleted": False,
        })
        resp = await client.get("/api/og/jobs/og-html-closed-001")
        assert resp.status_code == 200
        cc = resp.headers.get("cache-control", "")
        assert "max-age=86400" in cc
        assert "s-maxage=86400" in cc