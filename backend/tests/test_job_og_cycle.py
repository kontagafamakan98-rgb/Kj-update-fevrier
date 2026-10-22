# -*- coding: utf-8 -*-
"""Cycle complet de la fiche /jobs/:id, exécuté EN PROCESSUS (donc sur les PR).

── La lacune que ce test comble ─────────────────────────────────────────────
Le cycle « créer → 200 → supprimer → 404 + noindex + sitemap » était vérifié
par `frontend/scripts/check-og-job-200.js`, contre un déploiement Vercel réel.
Or sur une pull request, la preview est **protégée** (Deployment Protection) :
`resolve-vercel-url.sh` retombe sur le build local, et le script s'arrête alors
avec un `::notice` — la fiche n'existe que sur le déploiement (rewrite
`/jobs/(.*)`). Résultat mesuré : sur les PR, ce cycle ne tournait **jamais**, et
il ne tournait sur `main` qu'après fusion, quand la régression est déjà dedans.

Ce test rejoue le MÊME fil, mais contre le code de la PR, dans le processus de
test (ASGI) : il tourne sur chaque PR via le job `backend-tests`, un check
requis. Les deux gardes sont donc complémentaires et non redondants : le test
prouve le comportement du code, le script Node prouve le déploiement réel
(rewrite Vercel + CDN + cache) une fois sur `main`.

── Ce que le fil verrouille, dans l'ordre ───────────────────────────────────
1. la cliente crée une mission (`POST /api/jobs`) ;
2. **contrepartie indispensable** : la fiche APPARAÎT dans le sitemap — sans
   elle, « absente du sitemap » après suppression serait vrai à vide ;
3. la fiche pré-rendue répond 200 avec les métadonnées OG de LA mission
   (og:title, og:image wide ET carrée, twitter:image), sans noindex ;
4. les deux cartes Pillow répondent 200, en PNG, aux dimensions annoncées ;
5. la suppression par la propriétaire passe (`DELETE /api/jobs/:id`) et la
   mission est bien marquée supprimée en base (le 404 qui suit ne doit pas
   venir d'autre chose) ;
6. après suppression : fiche 404 + noindex (en-tête), cartes 404, et la fiche
   a disparu du sitemap — une fiche morte restée en 200 garde sa carte et
   reste indexable, c'est la régression que ce verrou interdit.

L'étape 4 verrouille aussi l'ORDRE des routes du routeur : `/og/jobs/{id}.png`
et `/og/jobs/{id}-square.png` sont déclarées AVANT `/og/jobs/{id}`. Si cet ordre
casse, la route HTML capture « …-square.png » comme identifiant et renvoie du
text/html : le test le voit tout de suite (type MIME + dimensions).
"""
import json
import re

import pytest
from httpx import AsyncClient

from kojo_job_og import BOOT_SCRIPT, BOOT_STYLE, SEED_ID
from tests.conftest import BASE_JOB, BASE_USER, auth_headers, db_find_one

SITE_BASE = "https://kojoforafrica.cc.cd"


def _png_dimensions(content: bytes) -> tuple:
    """Dimensions d'un PNG lues dans son en-tête IHDR (octets 16-24).

    Vérifie au passage la signature : un corps non-PNG lève ici, ce qui rend
    le test explicite plutôt que silencieusement tolérant.
    """
    assert content[:8] == b"\x89PNG\r\n\x1a\n", "réponse non-PNG (signature absente)"
    return int.from_bytes(content[16:20], "big"), int.from_bytes(content[20:24], "big")


@pytest.mark.asyncio
class TestJobFicheLifecycle:
    async def test_create_200_delete_404_noindex_and_sitemap(self, client: AsyncClient):
        headers = await auth_headers(client, BASE_USER)

        # ── 1. Création (compte client : POST /api/jobs exige user_type client)
        title = "Mission cycle OG complet"
        created = await client.post(
            "/api/jobs",
            headers=headers,
            json={**BASE_JOB, "title": title, "category": "general"},
        )
        assert created.status_code in (200, 201), created.text
        job = created.json()
        job_id = job["id"]
        assert job_id

        # ── 2. Contrepartie AVANT suppression : la fiche est dans le sitemap
        sitemap_before = await client.get("/api/sitemap.xml")
        assert sitemap_before.status_code == 200
        assert f"<loc>{SITE_BASE}/jobs/{job_id}</loc>" in sitemap_before.text, (
            "la mission créée doit apparaître dans le sitemap — sinon l'absence "
            "vérifiée après suppression ne prouverait rien"
        )

        # ── 3. Fiche pré-rendue : 200 + OG de CETTE mission, pas de noindex
        fiche = await client.get(f"/api/og/jobs/{job_id}")
        assert fiche.status_code == 200
        assert fiche.headers["content-type"].startswith("text/html")
        assert title in fiche.text
        assert 'property="og:title"' in fiche.text and title in fiche.text
        assert fiche.text.count('property="og:image"') == 2, "carte wide + carrée attendues"
        assert f"{SITE_BASE}/api/og/jobs/{job_id}.png" in fiche.text
        assert f"{SITE_BASE}/api/og/jobs/{job_id}-square.png" in fiche.text
        assert 'name="twitter:image"' in fiche.text
        assert "noindex" not in fiche.headers.get("x-robots-tag", "")
        # Cache court d'une fiche VIVANTE (elle peut être clôturée/supprimée) :
        # c'est cette valeur que le contrôle post-suppression du script Node
        # contourne par un paramètre de cache-busting côté CDN.
        live_cache = fiche.headers.get("cache-control", "")
        assert "max-age=3600" in live_cache, live_cache

        # ── 4. Les deux cartes images (et l'ordre des routes, cf. docstring)
        wide = await client.get(f"/api/og/jobs/{job_id}.png")
        assert wide.status_code == 200
        assert wide.headers["content-type"].startswith("image/png")
        assert _png_dimensions(wide.content) == (1200, 630)

        square = await client.get(f"/api/og/jobs/{job_id}-square.png")
        assert square.status_code == 200
        assert square.headers["content-type"].startswith("image/png")
        assert _png_dimensions(square.content) == (1200, 1200)

        # ── 5. Suppression par la propriétaire, puis état réel en base
        deleted = await client.delete(f"/api/jobs/{job_id}", headers=headers)
        assert deleted.status_code in (200, 204), deleted.text

        stored = await db_find_one("jobs", {"id": job_id})
        assert stored is not None, "la suppression ne doit pas effacer la ligne"
        assert stored.get("deleted") is True, (
            "le 404 qui suit doit venir de la SUPPRESSION : si la mission n'est "
            "pas marquée supprimée, on ne teste pas le bon chemin"
        )

        # ── 6. La fiche morte n'est plus servie en 200, et n'est plus indexable
        fiche_after = await client.get(f"/api/og/jobs/{job_id}")
        assert fiche_after.status_code == 404
        assert "noindex" in fiche_after.headers.get("x-robots-tag", "").lower()
        # Le 404 n'est pas cachable : c'est ce qui rend la vérification
        # post-suppression concluante sans dépendre du CDN.
        assert "no-store" in fiche_after.headers.get("cache-control", "").lower()
        assert job_id not in fiche_after.text, (
            "le corps 404 ne doit pas réexposer l'identifiant supprimé"
        )

        # ── 7. Les cartes de la mission supprimée disparaissent aussi
        assert (await client.get(f"/api/og/jobs/{job_id}.png")).status_code == 404
        assert (await client.get(f"/api/og/jobs/{job_id}-square.png")).status_code == 404

        # ── 8. Et le sitemap ne la liste plus (découverte publique propre)
        sitemap_after = await client.get("/api/sitemap.xml")
        assert sitemap_after.status_code == 200
        assert f"<loc>{SITE_BASE}/jobs/{job_id}</loc>" not in sitemap_after.text

    async def test_noindex_before_suppression_is_absent(self, client: AsyncClient):
        """Symétrie du verrou : tant que la mission vit, AUCUN noindex.

        Sans cette assertion, un endpoint qui servirait noindex en permanence
        ferait passer l'étape 6 pour la mauvaise raison (une fiche qui n'a
        jamais été indexable n'a rien à voir avec une fiche retirée).
        """
        headers = await auth_headers(client, BASE_USER)
        job = (
            await client.post(
                "/api/jobs",
                headers=headers,
                json={**BASE_JOB, "title": "Mission indexable", "category": "general"},
            )
        ).json()

        fiche = await client.get(f"/api/og/jobs/{job['id']}")
        assert fiche.status_code == 200
        assert "noindex" not in fiche.headers.get("x-robots-tag", "").lower()
        # Une balise <meta name="robots"> positive est légitime : ce qui doit
        # être absent, c'est la DIRECTIVE noindex, quel que soit le canal.
        for tag in re.findall(r'<meta[^>]+name="robots"[^>]*>', fiche.text):
            assert "noindex" not in tag.lower(), tag


async def _fiche_de_mission(client: AsyncClient, **champs) -> tuple:
    """Crée une mission (compte client CI) et rend (identifiant, corps de la fiche).

    Le corps est lu sur la route PRÉ-RENDUE (`/api/og/jobs/{id}`), donc sur le
    document qu'un crawler reçoit réellement — pas sur le rendu appelé à la main.
    """
    headers = await auth_headers(client, BASE_USER)
    created = await client.post(
        "/api/jobs",
        headers=headers,
        json={**BASE_JOB, "category": "general", **champs},
    )
    assert created.status_code in (200, 201), created.text
    job_id = created.json()["id"]
    fiche = await client.get(f"/api/og/jobs/{job_id}")
    assert fiche.status_code == 200, fiche.text
    return job_id, fiche.text


def _bloc_donnees(corps: str) -> dict:
    """Le JSON du bloc `kojo-job-data`, tel que la page le lit."""
    debut = corps.index(f'id="{SEED_ID}"') + len(f'id="{SEED_ID}">')
    fin = corps.index("</script>", debut)
    return json.loads(corps[debut:fin])


@pytest.mark.asyncio
class TestPointDEntree:
    """La fiche pré-rendue DÉMARRE l'application — sans perdre ce qu'un crawler lit.

    Le document était lisible et inerte : un lien partagé — le SEUL chemin
    d'arrivée d'un visiteur à froid — ouvrait une page sans châssis, sans
    navigation et sans propositions. Ces cas jugent les trois pièces qui le
    rendent exécutable, et la contrepartie qui rend la passe acceptable : la
    tête du document garde EXACTEMENT son titre, sa description et ses deux
    cartes de partage.
    """

    async def test_le_document_charge_le_point_d_entree_et_la_feuille(
        self, client: AsyncClient
    ):
        job_id, corps = await _fiche_de_mission(client, title="Mission avec application")

        # La feuille BLOQUANTE en premier : sans elle, l'application démarrée
        # serait peinte sans style. Le module vient ensuite (différé par nature).
        assert f'<link rel="stylesheet" href="{BOOT_STYLE}" />' in corps
        assert f'<script type="module" src="{BOOT_SCRIPT}"></script>' in corps
        assert corps.index(BOOT_STYLE) < corps.index(BOOT_SCRIPT)
        # Et la tête garde tout ce que lit un crawler (la passe n'a rien retiré).
        assert "<title>Mission avec application — Kojo</title>" in corps
        assert 'name="description"' in corps
        assert corps.count('property="og:image"') == 2, "carte wide + carrée attendues"
        assert f"https://kojoforafrica.cc.cd/api/og/jobs/{job_id}.png" in corps

    async def test_le_bloc_de_donnees_porte_la_vue_publique_rendue(
        self, client: AsyncClient
    ):
        job_id, corps = await _fiche_de_mission(client, title="Mission reprise sans squelette")

        # Le bloc vient APRÈS la fermeture de `#root` : React efface ce
        # conteneur au montage, donc un bloc placé dedans disparaîtrait avant
        # d'être lu et la fiche repasserait par son squelette.
        assert '</div>\n<script type="application/json"' in corps
        donnees = _bloc_donnees(corps)
        assert donnees["id"] == job_id
        assert donnees["title"] == "Mission reprise sans squelette"
        assert donnees["description"] == BASE_JOB["description"]
        # La vue est celle de `GET /jobs/:id` anonyme : ni identité, ni position.
        assert "client_id" not in donnees
        assert "geo" not in donnees
        assert "lat" not in donnees["location"] and "lng" not in donnees["location"]
        assert donnees["location"]["address"] == BASE_JOB["location"]["address"]

    async def test_une_donnee_hostile_ne_referme_pas_le_bloc(self, client: AsyncClient):
        """Un titre qui contient la fermeture d'un script resterait du TEXTE."""
        titre = "Travaux </script><script>alert(1)</script> & co"
        _job_id, corps = await _fiche_de_mission(client, title=titre)

        assert "</script><script>" not in corps
        assert "\\u003c/script\\u003e" in corps
        # Le bloc reste du JSON lisible malgré l'échappement.
        assert _bloc_donnees(corps)["title"] == titre

    async def test_une_fiche_inconnue_ouvre_aussi_l_application(
        self, client: AsyncClient
    ):
        """Un lien partagé devenu mort garde une issue : la page 404 de l'app."""
        reponse = await client.get("/api/og/jobs/inconnu-og")

        assert reponse.status_code == 404
        assert f'src="{BOOT_SCRIPT}"' in reponse.text
        assert BOOT_STYLE in reponse.text
        assert "noindex" in reponse.text
