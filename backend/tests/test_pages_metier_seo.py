# -*- coding: utf-8 -*-
"""Gardes des pages indexables par VILLE et par MÉTIER (27/10/2026).

Ce que ces tests tiennent, et pourquoi chacun existe :

  1. les villes sont DÉRIVÉES du référentiel géographique — pas de seconde
     liste, sinon une ville ajoutée là-bas n'aurait jamais sa page ;
  2. chaque métier déclaré porte une catégorie qui existe vraiment dans
     `kojo_job_categories` — un slug qui ne filtre rien publierait une page
     vide en prétendant lister des missions ;
  3. l'URL publiée dans le sitemap et l'URL servie sortent de la MÊME
     déclaration : une entrée de sitemap qui répond 404 fait perdre la
     confiance du crawler sur tout le fichier ;
  4. le document porte ce qu'un moteur lit (title, description, robots,
     canonical, og:url, h1, JSON-LD CollectionPage/ItemList, liens) et
     n'invente aucun chiffre quand la liste est vide ;
  5. le contenu écrit par un utilisateur est ÉCHAPPÉ : un titre de mission
     n'écrit jamais de balisage ;
  6. la page d'une ville ne publie que SES missions ouvertes — les pages
     vivent d'un filtre, pas d'une liste recopiée ;
  7. chaque page porte le LIEN D'ALERTE de son métier ou de sa ville
     (28/10/2026) : c'étaient les pages qui disaient honnêtement « aucune
     offre ouverte » et ne laissaient rien à faire au visiteur, alors que
     l'alerte emploi existait déjà — et le bloc ne promet aucune offre.

Les mutations qui doivent rougir (rejouées à la main le 27/10/2026) :
retirer la dérivation des villes, retirer l'échappement d'un titre, laisser
`numberOfItems` figé à 0, et supprimer `status: open` du filtre de ville.
"""
import re
from urllib.parse import quote

import pytest
from httpx import AsyncClient

from tests.conftest import db_insert
import kojo_pages_metier as pages
from kojo_geo_data import GEOGRAPHIC_DATABASE
from kojo_job_categories import _CATEGORY_GROUPS

ORIGINE = "https://kojoforafrica.cc.cd"


def mission(identifiant: str, titre: str, **champs) -> dict:
    """Un document de mission minimal, tel que la page le liste."""
    return {
        "id": identifiant,
        "title": titre,
        "budget": 25000,
        "currency": "FCFA",
        "location": {"city": "Abidjan"},
        "created_at": "2026-10-20T10:00:00",
        **champs,
    }


class TestLaDeclarationDesVilles:
    def test_les_villes_viennent_du_referentiel_geographique(self):
        attendu = []
        for code, pays in GEOGRAPHIC_DATABASE.items():
            for ville in pays.get("majorCities") or []:
                attendu.append((pages.slugifier(ville["name"]), ville["name"], code))
        assert [(p["slug"], p["nom"], p["pays"]) for p in pages.PAGES_VILLES] == attendu

    def test_une_ville_ajoutee_au_referentiel_obtient_sa_page(self, monkeypatch):
        """La preuve que la liste est DÉRIVÉE, et non recopiée.

        Un pays ajouté à `GEOGRAPHIC_DATABASE` doit produire sa page sans
        qu'on touche à ce module : c'est exactement ce qu'une seconde liste
        écrite à la main empêcherait.
        """
        monkeypatch.setitem(GEOGRAPHIC_DATABASE, "pays_de_test", {
            "country": "Pays de test",
            "nameFrench": "Pays de test",
            "flag": "",
            "majorCities": [{"name": "Ville Neuve"}],
        })
        slugs = [p["slug"] for p in pages._villes()]
        assert "ville-neuve" in slugs

    def test_les_slugs_sont_ascii_et_uniques(self):
        slugs = [p["slug"] for p in pages.PAGES_VILLES]
        assert len(slugs) == len(set(slugs))
        for slug in slugs + [p["slug"] for p in pages.PAGES_METIERS]:
            assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug), slug

    def test_chaque_metier_porte_une_categorie_qui_existe(self):
        for metier in pages.PAGES_METIERS:
            assert metier["categorie"] in _CATEGORY_GROUPS, metier
            assert metier["categorie"] != "general", "« diverse » n'est pas une requête"

    def test_le_sitemap_et_les_routes_sortent_de_la_meme_declaration(self):
        """Chaque URL du sitemap RÉSOUT : aucune entrée morte possible."""
        for chemin, _, _ in pages.urls_sitemap():
            prefixe, slug = chemin.strip("/").split("/")
            if prefixe == "emplois":
                assert pages.trouver_ville(slug), chemin
            else:
                assert prefixe == "metiers", chemin
                assert pages.trouver_metier(slug), chemin

    def test_le_sitemap_couvre_toutes_les_pages(self):
        chemins = [c for c, _, _ in pages.urls_sitemap()]
        assert len(chemins) == len(pages.PAGES_VILLES) + len(pages.PAGES_METIERS)
        assert "/emplois/abidjan" in chemins and "/metiers/plomberie" in chemins


class TestLeDocument:
    def test_il_publie_ce_qu_un_moteur_lit(self):
        page = pages.trouver_ville("abidjan")
        doc = pages.document(page, "ville", ORIGINE, [mission("j1", "Réparer une fuite")])
        titre = re.search(r"<title>(.*?)</title>", doc).group(1)
        assert "Abidjan" in titre
        assert '<meta name="robots" content="index, follow" />' in doc
        assert f'<link rel="canonical" href="{ORIGINE}/emplois/abidjan" />' in doc
        assert f'<meta property="og:url" content="{ORIGINE}/emplois/abidjan" />' in doc
        assert '<meta name="description" content="' in doc
        assert "<h1>Emplois et missions à Abidjan</h1>" in doc
        assert '<a href="/jobs/j1">Réparer une fuite</a>' in doc
        assert '"@type":"CollectionPage"' in doc
        assert '"numberOfItems":1' in doc
        assert f'"url":"{ORIGINE}/jobs/j1"' in doc

    def test_il_maillle_les_autres_villes_et_tous_les_metiers(self):
        doc = pages.document(pages.trouver_ville("dakar"), "ville", ORIGINE, [])
        for metier in pages.PAGES_METIERS:
            assert f'href="/metiers/{metier["slug"]}"' in doc, metier
        for ville in pages.PAGES_VILLES:
            assert f'href="/emplois/{ville["slug"]}"' in doc, ville

    def test_une_page_sans_offre_le_dit_sans_inventer_un_chiffre(self):
        doc = pages.document(pages.trouver_metier("plomberie"), "metier", ORIGINE, [])
        assert "Aucune offre ouverte" in doc
        assert '"numberOfItems":0' in doc
        # Aucun compteur « 0 offre » déguisé en preuve de volume.
        assert "<ul class=\"offres\">" not in doc

    def test_un_titre_de_mission_ne_cree_pas_de_balisage(self):
        piege = '<script>alert("x")</script> & <img src=x onerror=alert(1)>'
        doc = pages.document(
            pages.trouver_ville("bamako"), "ville", ORIGINE, [mission("j2", piege)]
        )
        assert "<script>alert" not in doc
        assert "&lt;script&gt;alert" in doc
        assert "<img src=x" not in doc
        # Le JSON-LD porte le même titre : il est ÉCHAPPÉ lui aussi, sinon un
        # « </script> » refermerait la balise et le titre deviendrait du HTML.
        assert "\\u003cscript\\u003e" in doc

    def test_aucune_coordonnee_ne_sort(self):
        precise = mission(
            "j3",
            "Mission géolocalisée",
            location={"city": "Bamako", "coordinates": {"lat": 12.6392, "lng": -8.0029}},
        )
        doc = pages.document(pages.trouver_ville("bamako"), "ville", ORIGINE, [precise])
        assert "12.6392" not in doc and "-8.0029" not in doc

    def test_la_description_ne_coupe_pas_un_mot(self):
        for page in pages.PAGES_VILLES + pages.PAGES_METIERS:
            genre = "ville" if "pays" in page else "metier"
            for nombre in (0, 1, 3, 240):
                description = pages.description_de(page, genre, nombre)
                assert description, page
                assert not description.endswith(" …"), page
                if description.endswith("…"):
                    avant = description[:-1]
                    assert avant[-1].isalnum() and (
                        len(avant.split()) >= 5
                    ), "coupe trop courte : %r" % description

    def test_le_nombre_de_la_description_est_celui_de_la_liste(self):
        page = pages.trouver_ville("thies")
        deux = pages.description_de(page, "ville", 2)
        assert deux.startswith("2 offres ouvertes à Thiès")
        une = pages.description_de(page, "ville", 1)
        assert une.startswith("1 offre ouverte à Thiès")

    def test_la_404_est_noindex_et_ne_pretend_rien(self):
        doc = pages.document_introuvable(ORIGINE)
        assert '<meta name="robots" content="noindex, follow" />' in doc
        assert "<h1>Cette page n'existe pas</h1>" in doc
        assert "CollectionPage" not in doc


class TestLeLienDalerteEmploi:
    """Le lien d'alerte : le seul chemin de RETOUR de ces pages (28/10/2026).

    Les 22 pages disaient honnêtement « aucune offre ouverte » et s'arrêtaient
    là : un visiteur venu chercher un plombier à Bamako n'avait aucun moyen de
    laisser son intention, alors que l'alerte emploi existe (`/job-alerts`,
    une par compte travailleur) et n'était montée que sur `/jobs`, connecté.

    Ce qui est jugé ici : le lien porte les critères de SA page, il traverse
    une route qui existe, et le bloc ne prétend jamais qu'une offre est
    disponible.
    """

    def test_la_page_metier_vise_sa_categorie(self):
        doc = pages.document(pages.trouver_metier("plomberie"), "metier", ORIGINE, [])
        assert 'href="/jobs?alerte=1&amp;category=plumbing"' in doc
        assert "Recevoir les missions de plomberie par email" in doc

    def test_la_page_ville_transmet_le_nom_de_la_ville(self):
        # Le NOM, pas le slug : la veille garde un texte libre comparé au nom de
        # la mission — « segou » ne correspondrait à aucune mission de Ségou.
        doc = pages.document(pages.trouver_ville("bamako"), "ville", ORIGINE, [])
        assert 'href="/jobs?alerte=1&amp;ville=Bamako"' in doc
        assert "Recevoir les missions à Bamako par email" in doc

    def test_une_ville_accentuee_est_encodee_dans_le_lien(self):
        doc = pages.document(pages.trouver_ville("segou"), "ville", ORIGINE, [])
        assert "ville=S%C3%A9gou" in doc

    def test_le_bloc_ne_promet_aucune_offre(self):
        doc = pages.document(pages.trouver_ville("bamako"), "ville", ORIGINE, [])
        bloc = doc.split('<section class="alerte"', 1)[1].split("</section>", 1)[0]
        assert "Créer mon alerte emploi" in bloc
        assert "rien n’est promis" in bloc
        # Aucun chiffre : le nombre d'offres appartient à la liste au-dessus.
        assert not re.search(r"\d+\s+offre", bloc)

    def test_chaque_page_declare_l_alerte_de_son_sujet(self):
        for page in pages.PAGES_VILLES:
            assert pages.lien_alerte("ville", page) == (
                f"/jobs?alerte=1&amp;ville={quote(page['nom'])}"
            ), page
        for page in pages.PAGES_METIERS:
            assert pages.lien_alerte("metier", page) == (
                f"/jobs?alerte=1&amp;category={quote(page['categorie'])}"
            ), page

    def test_le_lien_mene_a_une_route_servie(self):
        """`/jobs` est une route de l'application, pas une page inventée."""
        for genre, page in (("ville", pages.PAGES_VILLES[0]), ("metier", pages.PAGES_METIERS[0])):
            chemin = pages.lien_alerte(genre, page).split("?", 1)[0]
            assert chemin == "/jobs", chemin


@pytest.mark.asyncio
class TestLesRoutes:
    async def test_la_page_ville_ne_liste_que_ses_missions_ouvertes(
        self, client: AsyncClient
    ):
        await db_insert("jobs", {
            "id": "job-abidjan-ouvert", "title": "Poser un carrelage à Abidjan",
            "status": "open", "category": "construction", "deleted": False,
            "location": {"city": "Abidjan"}, "created_at": "2026-10-21T09:00:00",
        })
        # Pas d'apostrophe dans les titres de ce test : l'échappement (`&apos;`)
        # rendrait l'assertion vraie pour la mauvaise raison — c'est ainsi qu'une
        # première version cherchait `&#x27;` et ne mordait sur RIEN.
        await db_insert("jobs", {
            "id": "job-abidjan-clos", "title": "Mission Abidjan terminee",
            "status": "completed", "category": "construction", "deleted": False,
            "location": {"city": "Abidjan"}, "created_at": "2026-10-21T09:00:00",
        })
        await db_insert("jobs", {
            "id": "job-dakar-ouvert", "title": "Mission de Dakar",
            "status": "open", "category": "construction", "deleted": False,
            "location": {"city": "Dakar"}, "created_at": "2026-10-21T09:00:00",
        })

        resp = await client.get("/api/pages/villes/abidjan")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert "public" in resp.headers.get("cache-control", "")
        assert "Poser un carrelage à Abidjan" in resp.text
        assert "Mission Abidjan terminee" not in resp.text
        assert "Mission de Dakar" not in resp.text

    async def test_la_page_metier_retrouve_les_ecritures_legacy(self, client: AsyncClient):
        await db_insert("jobs", {
            "id": "job-plomberie-legacy", "title": "Réparer un chauffe-eau",
            "status": "open", "category": "plomberie", "deleted": False,
            "location": {"city": "Bamako"}, "created_at": "2026-10-21T09:00:00",
        })
        await db_insert("jobs", {
            "id": "job-plomberie-anglais", "title": "Fix a leaking pipe",
            "status": "open", "category": "plumbing", "deleted": False,
            "location": {"city": "Dakar"}, "created_at": "2026-10-21T09:00:00",
        })

        resp = await client.get("/api/pages/metiers/plomberie")
        assert resp.status_code == 200
        assert "Réparer un chauffe-eau" in resp.text
        assert "Fix a leaking pipe" in resp.text

    async def test_une_ville_inconnue_rend_404_noindex(self, client: AsyncClient):
        resp = await client.get("/api/pages/villes/atlantide")
        assert resp.status_code == 404
        assert resp.headers.get("x-robots-tag") == "noindex"
        assert "noindex" in resp.text

    async def test_le_sitemap_liste_les_pages_et_plus_les_formulaires(
        self, client: AsyncClient
    ):
        resp = await client.get("/api/sitemap.xml")
        assert resp.status_code == 200
        body = resp.text
        for chemin, _, _ in pages.urls_sitemap():
            assert f"<loc>{ORIGINE}{chemin}</loc>" in body, chemin
        assert f"<loc>{ORIGINE}/login</loc>" not in body
        assert f"<loc>{ORIGINE}/register</loc>" not in body
        assert f"<loc>{ORIGINE}/terms</loc>" in body
