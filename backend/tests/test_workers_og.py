# -*- coding: utf-8 -*-
"""Le profil public d'un travailleur est INDEXABLE — et ne fuit rien.

POURQUOI CE FICHIER

`/workers/:id` était servi par le gabarit nu de la SPA et portait
`X-Robots-Tag: noindex` : un crawler sans JavaScript n'y voyait qu'un document
sans titre, et la page n'avait aucune chance d'être indexée. Elle est désormais
pré-rendue par le backend (rewrite Vercel /workers/(.*) → /api/og/workers/$1),
comme la fiche mission — ce qui pose DEUX questions que la lecture du code ne
tranche pas :

  1. ce que le document SERVI annonce (titre, description, canonical, cartes) —
     c'est ce qu'un moteur et un crawler de partage lisent, sans exécuter quoi
     que ce soit ; et l'absence de `noindex`, sinon la page reste hors index
     tout en ayant l'air prête ;
  2. ce qu'il ne peut PAS annoncer. Une carte de partage est un document
     PUBLIC, mis en cache chez Facebook et consigné par les moteurs : un email,
     un téléphone, un compte de paiement ou une position qui y entrerait
     resterait dehors pour toujours. La vue publique est une allowlist
     (`kojo_routers_workers_public`) ; ces cas la cherchent dans le document
     SÉRIALISÉ, pas seulement dans ses clés de premier niveau.

Ce qui n'est PAS mesuré ici : la carte image elle-même (elle est un PNG : sa
composition se regarde, et `check-worker-og-contract.js` vérifie la paire
titre/description avec l'application) ni l'indexation réelle par un moteur, qui
n'appartient à personne dans ce dépôt.
"""
import pytest
from httpx import AsyncClient

from tests.conftest import db_insert

IDENTIFIANT = "worker-og-1"
EMAIL_FIXTURE = "awa.og@kojo.sn"
TELEPHONE_FIXTURE = "+221771234567"
COMPTE_PAIEMENT_FIXTURE = "+221770001122"


async def _travailleur(**remplacements):
    """Un travailleur publiable, avec TOUTES les PII que la fixture porte."""
    doc = {
        "id": IDENTIFIANT,
        "email": EMAIL_FIXTURE,
        "phone": TELEPHONE_FIXTURE,
        "first_name": "Awa",
        "last_name": "Diop",
        "user_type": "worker",
        "country": "senegal",
        "city": "Dakar",
        "created_at": "2024-05-17T10:00:00+00:00",
        "skills": ["plomberie", "soudure"],
        "bio": "Artisan plombier depuis dix ans.",
        "is_verified": True,
        "rating": 4.7,
        "payment_accounts": {"orange_money": COMPTE_PAIEMENT_FIXTURE},
        "geo": {"type": "Point", "coordinates": [-17.44, 14.69]},
    }
    doc.update(remplacements)
    await db_insert("users", doc)
    return doc


async def _reputation():
    """Deux avis et deux missions terminées : la réputation que la page publie.

    Les compteurs de la vue publique sont des COUNT sur `reviews` et `jobs` —
    pas les champs `rating`/`total_reviews` du document utilisateur. Un profil
    qui n'a AUCUN avis publié s'affiche donc « Nouveau profil », même si son
    document porte une moyenne : c'est la règle de la vue publique, et ce
    fichier la mesure au lieu de la contourner.
    """
    await db_insert("users", {
        "id": "client-og-1", "first_name": "Moussa", "last_name": "Ba",
        "user_type": "client",
    })
    for rang, note in enumerate((5, 4), start=1):
        await db_insert("reviews", {
            "id": f"avis-og-{rang}",
            "reviewee_id": IDENTIFIANT,
            "reviewer_id": "client-og-1",
            "job_id": f"mission-og-{rang}",
            "rating": note,
            "comment": "Travail soigné.",
            "created_at": f"2025-0{rang}-02T09:00:00+00:00",
        })
        await db_insert("jobs", {
            "id": f"mission-og-{rang}",
            "assigned_worker_id": IDENTIFIANT,
            "status": "completed",
        })


class TestPagePreRendue:
    async def test_la_page_annonce_le_titre_la_description_et_les_cartes(
        self, client: AsyncClient
    ):
        await _travailleur()
        await _reputation()

        reponse = await client.get(f"/api/og/workers/{IDENTIFIANT}")

        assert reponse.status_code == 200
        assert reponse.headers["content-type"].startswith("text/html")
        corps = reponse.text
        # Le titre : nom, métier (première compétence), marque.
        assert "<title>Awa Diop — plomberie — Kojo</title>" in corps
        # La description porte les faits qui font choisir, et la ville.
        assert 'name="description"' in corps
        assert "Artisan plombier depuis dix ans." in corps
        assert "4.7/5 sur 2 avis" in corps
        assert "Dakar" in corps
        # Les DEUX cartes (wide + carrée), comme la fiche mission : les réseaux
        # qui recadrent en 1:1 liraient sinon une image absente.
        assert f"/api/og/workers/{IDENTIFIANT}.png" in corps
        assert f"/api/og/workers/{IDENTIFIANT}-square.png" in corps
        assert corps.count('property="og:image"') == 2
        assert 'name="twitter:image"' in corps
        # Canonical et og:url : la page demande à être indexée sous SON adresse.
        assert f'<link rel="canonical" href="https://kojoforafrica.cc.cd/workers/{IDENTIFIANT}" />' in corps
        assert f'<meta property="og:url" content="https://kojoforafrica.cc.cd/workers/{IDENTIFIANT}" />' in corps
        # Shell h1 statique (contenu avant tout boot React).
        assert "<h1" in corps and "Awa Diop" in corps
        # Et surtout : PAS de noindex — sinon la page est prête et invisible.
        assert "noindex" not in corps
        assert "noindex" not in reponse.headers.get("x-robots-tag", "")

    async def test_un_profil_inconnu_repond_404_noindex(self, client: AsyncClient):
        reponse = await client.get("/api/og/workers/inconnu-og")

        assert reponse.status_code == 404
        assert reponse.headers["content-type"].startswith("text/html")
        assert "noindex" in reponse.headers.get("x-robots-tag", "")
        assert "noindex" in reponse.text
        # L'identifiant demandé n'est pas ré-échoé dans le document.
        assert "inconnu-og" not in reponse.text

    async def test_un_client_et_un_compte_supprime_n_ont_pas_de_page(
        self, client: AsyncClient
    ):
        await db_insert("users", {
            "id": "client-og", "first_name": "Moussa", "last_name": "Ba",
            "user_type": "client",
        })
        await _travailleur(deleted=True)

        assert (await client.get("/api/og/workers/client-og")).status_code == 404
        assert (await client.get(f"/api/og/workers/{IDENTIFIANT}")).status_code == 404

    async def test_les_donnees_hostiles_sont_echappees(self, client: AsyncClient):
        """Le pré-rendu est lu par des crawlers : il ne publie pas de balisage."""
        await _travailleur(
            first_name="Awa <script>alert(1)</script>",
            bio="Bio & <b>gras</b> 'guillemets'",
        )

        corps = (await client.get(f"/api/og/workers/{IDENTIFIANT}")).text

        assert "<script>alert(1)</script>" not in corps
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in corps
        assert "&amp;" in corps

    async def test_la_page_est_mise_en_cache_une_heure(self, client: AsyncClient):
        """Un profil vit (avis, missions) : cache court, jamais celui d'un état
        terminal."""
        await _travailleur()

        reponse = await client.get(f"/api/og/workers/{IDENTIFIANT}")

        cache = reponse.headers.get("cache-control", "")
        assert "max-age=3600" in cache
        assert "86400" not in cache


class TestAucuneFuite:
    async def test_le_document_servi_ne_porte_aucune_donnee_personnelle(
        self, client: AsyncClient
    ):
        """Ce que la carte de partage graverait resterait public pour toujours."""
        await _travailleur()

        corps = (await client.get(f"/api/og/workers/{IDENTIFIANT}")).text

        for interdit in (
            EMAIL_FIXTURE,
            TELEPHONE_FIXTURE,
            COMPTE_PAIEMENT_FIXTURE,
            "-17.44",
            "14.69",
            "password",
        ):
            assert interdit not in corps, (
                f"« {interdit} » apparaît dans la page pré-rendue : une donnée "
                f"d'identité, de paiement ou de position serait publiée en clair "
                f"dans un document que les crawlers conservent"
            )

    async def test_la_description_ne_public_pas_la_cle_machine_du_pays(
        self, client: AsyncClient
    ):
        """`country` stocke une clé (« senegal »), pas un libellé : la description
        publique dit la VILLE, jamais le code brut."""
        await _travailleur()

        corps = (await client.get(f"/api/og/workers/{IDENTIFIANT}")).text

        assert "senegal" not in corps


class TestCartesOpenGraph:
    async def test_la_carte_wide_est_un_png_1200x630(self, client: AsyncClient):
        await _travailleur()

        reponse = await client.get(f"/api/og/workers/{IDENTIFIANT}.png")

        assert reponse.status_code == 200
        assert reponse.headers["content-type"].startswith("image/png")
        assert reponse.content[:8] == b"\x89PNG\r\n\x1a\n"
        width = int.from_bytes(reponse.content[16:20], "big")
        height = int.from_bytes(reponse.content[20:24], "big")
        assert (width, height) == (1200, 630)
        assert "max-age=3600" in reponse.headers.get("cache-control", "")

    async def test_la_carte_carree_est_un_png_1200x1200(self, client: AsyncClient):
        await _travailleur()

        reponse = await client.get(f"/api/og/workers/{IDENTIFIANT}-square.png")

        assert reponse.status_code == 200
        width = int.from_bytes(reponse.content[16:20], "big")
        height = int.from_bytes(reponse.content[20:24], "big")
        assert (width, height) == (1200, 1200)

    async def test_une_carte_demandee_pour_un_profil_absent_repond_404(
        self, client: AsyncClient
    ):
        assert (await client.get("/api/og/workers/absent.png")).status_code == 404
        assert (await client.get("/api/og/workers/absent-square.png")).status_code == 404


class TestSitemap:
    async def test_le_sitemap_enumere_les_profils_publics(self, client: AsyncClient):
        """Sans entrée au sitemap, une page pré-rendue ne serait découverte que
        par un lien entrant — en pratique jamais."""
        await _travailleur()
        await db_insert("users", {
            "id": "worker-supprime", "first_name": "Parti", "last_name": "Diop",
            "user_type": "worker", "deleted": True,
        })
        await db_insert("users", {
            "id": "worker-sans-nom", "user_type": "worker",
            "last_name": "Anonyme",
        })
        await db_insert("users", {
            "id": "client-sitemap", "first_name": "Moussa", "user_type": "client",
        })

        corps = (await client.get("/api/sitemap.xml")).text

        assert f"<loc>https://kojoforafrica.cc.cd/workers/{IDENTIFIANT}</loc>" in corps
        # Ni un compte supprimé, ni un profil sans nom (rien à indexer), ni un
        # client (pas de profil travailleur du tout).
        assert "worker-supprime" not in corps
        assert "worker-sans-nom" not in corps
        assert "client-sitemap" not in corps
