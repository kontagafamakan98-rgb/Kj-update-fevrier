# -*- coding: utf-8 -*-
"""Gardes des GUIDES ÉDITORIAUX (27/10/2026).

Ce que ces tests tiennent, et pourquoi chacun existe :

  1. les guides de prix sont DÉRIVÉS du catalogue de métiers — une seconde
     liste aurait divergé, et un guide orphelin pointerait une page morte ;
  2. l'URL du sitemap et celle de la route sortent de la MÊME déclaration ;
  3. le PRIX publié est une MESURE : budgets annoncés sur des missions
     ouvertes, nombre / fourchette / médiane. Un budget absent, nul, négatif ou
     non numérique est HORS mesure — il ne devient pas un zéro qui abaisserait
     la fourchette, et aucune ville ne reçoit un montant inventé ;
  4. la médiane ne se publie pas sur deux missions (elle n'y est qu'une borne) ;
  5. le document porte ce qu'un moteur lit (title, description, robots,
     canonical, og:url, h1, JSON-LD Article) et n'annonce pas de date de
     publication qu'il ne connaît pas ;
  6. les guides sont LIÉS depuis les pages ville et métier — sans quoi ils ne
     seraient découverts que par le sitemap, donc moins souvent ;
  7. le contenu écrit par un utilisateur est échappé, et aucune coordonnée ne
     sort.

Les mutations qui doivent rougir (rejouées à la main le 27/10/2026) :
recopier la liste des métiers au lieu de la dériver, compter un budget nul,
publier une médiane à deux valeurs, et retirer le bloc « Guides » du maillage.
"""
import re

import pytest
from httpx import AsyncClient

from tests.conftest import db_insert
import kojo_pages_guides as guides
import kojo_pages_metier as metier
from kojo_job_categories import _CATEGORY_GROUPS

ORIGINE = "https://kojoforafrica.cc.cd"


def mission(identifiant: str, budget, **champs) -> dict:
    """Une mission telle que la page la reçoit (vue publique, budget lisible)."""
    return {
        "id": identifiant,
        "title": champs.pop("title", "Réparation"),
        "budget": budget,
        "currency": "FCFA",
        "location": {"city": "Abidjan"},
        **champs,
    }


class TestLaDerivation:
    def test_un_metier_ajoute_au_catalogue_obtient_son_guide(self):
        """La preuve que la liste est DÉRIVÉE : on ajoute un métier, il a un guide."""
        avant = [p["slug"] for p in guides._guides_prix()]
        metier.PAGES_METIERS.append(
            {"slug": "carrelage", "categorie": "construction", "nom": "Carrelage"}
        )
        try:
            apres = [p["slug"] for p in guides._guides_prix()]
        finally:
            metier.PAGES_METIERS.pop()
        assert "prix-carrelage" not in avant
        assert "prix-carrelage" in apres

    def test_chaque_guide_de_prix_porte_un_metier_du_catalogue(self):
        for page in guides.PAGES_GUIDES:
            if page["type"] != "prix":
                continue
            assert page["metier"] in metier.PAGES_METIERS, page
            assert page["metier"]["categorie"] in _CATEGORY_GROUPS, page

    def test_les_slugs_sont_ascii_et_uniques(self):
        slugs = [p["slug"] for p in guides.PAGES_GUIDES]
        assert len(slugs) == len(set(slugs))
        for slug in slugs:
            assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug), slug

    def test_le_sitemap_et_les_routes_sortent_de_la_meme_declaration(self):
        for chemin, _, _ in guides.urls_sitemap():
            slug = chemin.strip("/").split("/")[1]
            assert guides.trouver_guide(slug), chemin

    def test_le_sitemap_couvre_tous_les_guides(self):
        chemins = [c for c, _, _ in guides.urls_sitemap()]
        assert len(chemins) == len(guides.PAGES_GUIDES)
        assert "/guides/prix-plomberie" in chemins
        assert "/guides/choisir-un-artisan" in chemins


class TestLaMesureDesPrix:
    def test_la_fourchette_et_la_mediane_sont_celles_des_budgets(self):
        stats = guides.stats_par_ville(
            [
                mission("a", 15000),
                mission("b", 25000),
                mission("c", 45000),
            ]
        )
        assert stats["Abidjan"]["nombre"] == 3
        assert stats["Abidjan"]["minimum"] == 15000
        assert stats["Abidjan"]["maximum"] == 45000
        assert stats["Abidjan"]["mediane"] == 25000

    def test_la_mediane_ne_se_publie_pas_sur_deux_missions(self):
        stats = guides.stats_par_ville([mission("a", 10000), mission("b", 50000)])
        assert stats["Abidjan"]["mediane"] is None, (
            "à deux valeurs la médiane n'est qu'une des deux bornes : la publier "
            "ferait passer une borne pour un prix courant"
        )

    def test_un_budget_absent_ou_nul_est_hors_mesure(self):
        stats = guides.stats_par_ville(
            [
                mission("a", 20000),
                mission("b", None),
                mission("c", 0),
                mission("d", -5000),
                mission("e", "beaucoup"),
                mission("f", ""),
            ]
        )
        assert stats["Abidjan"]["nombre"] == 1, stats
        assert stats["Abidjan"]["minimum"] == 20000
        assert stats["Abidjan"]["maximum"] == 20000

    def test_une_mission_sans_ville_est_hors_mesure(self):
        stats = guides.stats_par_ville([mission("a", 20000, location={})])
        assert stats == {}

    def test_les_villes_sont_separees(self):
        stats = guides.stats_par_ville(
            [
                mission("a", 10000),
                mission("b", 30000, location={"city": "Dakar"}),
                mission("c", 60000, location={"city": "Dakar"}),
            ]
        )
        assert stats["Abidjan"]["nombre"] == 1
        assert stats["Dakar"]["nombre"] == 2
        assert stats["Dakar"]["minimum"] == 30000


class TestLeDocument:
    def test_il_publie_ce_qu_un_moteur_lit(self):
        page = guides.trouver_guide("prix-plomberie")
        doc = guides.document(page, ORIGINE, [mission("j1", 25000)])
        titre = re.search(r"<title>(.*?)</title>", doc).group(1)
        assert "Plomberie" in titre
        assert '<meta name="robots" content="index, follow" />' in doc
        assert f'<link rel="canonical" href="{ORIGINE}/guides/prix-plomberie" />' in doc
        assert f'<meta property="og:url" content="{ORIGINE}/guides/prix-plomberie" />' in doc
        assert '<meta name="description" content="' in doc
        assert "<h1>Plomberie : combien ça coûte ?</h1>" in doc
        assert '"@type":"Article"' in doc

    def test_il_n_invente_pas_de_date_de_publication(self):
        doc = guides.document(guides.trouver_guide("choisir-un-artisan"), ORIGINE, [])
        assert "datePublished" not in doc, (
            "aucune date de publication n'est stockée : une date inventée serait "
            "une fraîcheur annoncée sans mesure"
        )

    def test_une_ville_sans_budget_ne_recoit_aucun_montant(self):
        doc = guides.document(
            guides.trouver_guide("prix-plomberie"), ORIGINE, [mission("j1", 25000)]
        )
        assert "Abidjan" in doc and "25 000 FCFA" in doc
        # Aucune autre ville n'apparaît avec un chiffre : le tableau ne publie
        # que ce qui a été mesuré, il n'étend pas une ville à ses voisines.
        assert "Dakar" not in doc

    def test_sans_aucune_mesure_le_guide_le_dit(self):
        doc = guides.document(guides.trouver_guide("prix-maconnerie"), ORIGINE, [])
        assert "Aucun budget annoncé" in doc
        assert "FCFA" not in doc, "aucun montant ne doit apparaître sur une page sans mesure"

    def test_la_mediane_illisible_est_dite(self):
        doc = guides.document(
            guides.trouver_guide("prix-plomberie"), ORIGINE, [mission("a", 12000)]
        )
        assert "trop peu de missions" in doc

    def test_un_titre_de_mission_ne_cree_pas_de_balisage(self):
        piege = '<script>alert("x")</script> & <img src=x onerror=alert(1)>'
        doc = guides.document(
            guides.trouver_guide("prix-plomberie"),
            ORIGINE,
            [mission("j2", 30000, title=piege)],
        )
        assert "<script>alert" not in doc
        assert "&lt;script&gt;alert" in doc

    def test_aucune_coordonnee_ne_sort(self):
        precise = mission(
            "j3",
            30000,
            location={"city": "Abidjan", "coordinates": {"lat": 5.3599, "lng": -4.0083}},
        )
        doc = guides.document(guides.trouver_guide("prix-plomberie"), ORIGINE, [precise])
        assert "5.3599" not in doc and "-4.0083" not in doc

    def test_la_404_est_noindex_et_ne_pretend_rien(self):
        doc = guides.document_introuvable(ORIGINE)
        assert '<meta name="robots" content="noindex, follow" />' in doc
        assert "Article" not in doc


class TestLeMaillage:
    def test_la_page_metier_lie_son_guide_et_le_transversal(self):
        doc = metier.document(metier.trouver_metier("plomberie"), "metier", ORIGINE, [])
        assert 'href="/guides/prix-plomberie"' in doc
        assert f'href="/guides/{guides.SLUG_CHOISIR}"' in doc

    def test_la_page_ville_lie_tous_les_guides(self):
        doc = metier.document(metier.trouver_ville("abidjan"), "ville", ORIGINE, [])
        for page in guides.PAGES_GUIDES:
            assert f'href="/guides/{page["slug"]}"' in doc, page

    def test_chaque_guide_lie_les_metiers_et_les_autres_guides(self):
        doc = guides.document(guides.trouver_guide("prix-electricite"), ORIGINE, [])
        for m in metier.PAGES_METIERS:
            assert f'href="/metiers/{m["slug"]}"' in doc, m
        assert 'href="/guides/prix-plomberie"' in doc


@pytest.mark.asyncio
class TestLesRoutes:
    async def test_le_guide_sert_le_html_et_ne_compte_que_ses_budgets(
        self, client: AsyncClient
    ):
        await db_insert("jobs", {
            "id": "job-guide-plomberie", "title": "Fuite a reparer",
            "status": "open", "category": "plumbing", "deleted": False,
            "budget": 30000, "currency": "FCFA",
            "location": {"city": "Abidjan"}, "created_at": "2026-10-25T09:00:00",
        })
        # Même ville, autre métier : ne doit pas entrer dans la mesure.
        await db_insert("jobs", {
            "id": "job-guide-menage", "title": "Menage complet",
            "status": "open", "category": "cleaning", "deleted": False,
            "budget": 900000, "currency": "FCFA",
            "location": {"city": "Abidjan"}, "created_at": "2026-10-25T09:00:00",
        })
        # Métier juste, mais mission fermée : hors mesure.
        await db_insert("jobs", {
            "id": "job-guide-clos", "title": "Ancienne plomberie",
            "status": "completed", "category": "plumbing", "deleted": False,
            "budget": 700000, "currency": "FCFA",
            "location": {"city": "Abidjan"}, "created_at": "2026-10-25T09:00:00",
        })

        resp = await client.get("/api/pages/guides/prix-plomberie")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert "public" in resp.headers.get("cache-control", "")
        assert "30 000 FCFA" in resp.text
        assert "900 000 FCFA" not in resp.text, "un autre métier ne compte pas"
        assert "700 000 FCFA" not in resp.text, "une mission fermée ne compte pas"

    async def test_un_guide_inconnu_rend_un_404_noindex(self, client: AsyncClient):
        resp = await client.get("/api/pages/guides/guide-inexistant")
        assert resp.status_code == 404
        assert "noindex" in resp.text

    async def test_le_sitemap_publie_les_guides(self, client: AsyncClient):
        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200
        for chemin, _, _ in guides.urls_sitemap():
            assert f"<loc>{ORIGINE}{chemin}</loc>" in resp.text, chemin
