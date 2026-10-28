# -*- coding: utf-8 -*-
"""Le maillage des pages ville, métier et guides : une seule liste, quatre rendus.

POURQUOI CE GARDE EXISTE (27/10/2026)

Les 32 pages servies par le backend (`/emplois/{ville}`, `/metiers/{metier}`,
`/guides/{guide}`) n'étaient citées par AUCUNE page du site : le sitemap était
leur seul chemin de découverte, donc il n'existait aucun texte de lien entrant
disant de quoi chaque page parle (« Abidjan », « Plomberie », « Prix :
plomberie »). L'accueil et le pied de page — rendus, eux, sur toutes les routes
— les citent désormais.

Ce qui peut diverger, et que ce fichier refuse :

  * le catalogue des pages vit dans `backend/kojo_pages_metier.py` (villes
    DÉRIVÉES de `kojo_geo_data.GEOGRAPHIC_DATABASE`) et
    `backend/kojo_pages_guides.py` ; le frontend, lui, ne peut pas importer du
    Python. La liste publiée est donc `frontend/src/config/pages-seo.json`, et
    ce garde la compare à la déclaration serveur : une ville ajoutée au
    référentiel, un métier ajouté au catalogue ou un guide ajouté au plan
    rougit ici au lieu de rester sans lien interne ;
  * une URL du sitemap absente de cette liste serait une page que le sitemap
    seul annonce — exactement ce que le maillage supprime ;
  * un libellé RECOPIÉ À LA MAIN (« Prix : plomberie » écrit deux fois) finit
    par désigner un guide qui n'existe pas : les noms sont comparés à
    l'identique, pas seulement les slugs ;
  * les quatre rendus (accueil React, coquille de l'accueil, pied de page
    React, pied de page des coquilles) doivent lire CETTE déclaration : un
    cinquième domicile serait une seconde liste, et rien ne le dirait ;
  * les trois titres de groupe sont des clés i18n : si l'une manque à un
    dictionnaire, la coquille publie « undefined » à la place du titre.
"""
import json
from pathlib import Path

import kojo_pages_guides as guides
import kojo_pages_metier as metiers

RACINE = Path(__file__).resolve().parents[2]
FRONTEND = RACINE / "frontend"
LISTE = FRONTEND / "src" / "config" / "pages-seo.json"

# Les quatre rendus qui publient le bloc, et le fichier où chacun le fait.
RENDUS = {
    "accueil React": FRONTEND / "src" / "pages" / "Home.js",
    "pied de page React": FRONTEND / "src" / "App.js",
    "coquille du pied de page": FRONTEND / "vite-plugins" / "prerender" / "app-chrome.js",
    "coquille de l'accueil": FRONTEND / "vite-plugins" / "prerender" / "shells-home.js",
}

LANGUES = ("fr", "en", "wo", "bm", "mos")
CLES_TITRES = ("footerCities", "footerTrades", "footerGuides")


def _liste():
    return json.loads(LISTE.read_text(encoding="utf-8"))


def _couples(entrees, cle_slug="slug", cle_nom="nom"):
    return [(entree[cle_slug], entree[cle_nom]) for entree in entrees]


# ── La liste publiée EST la déclaration serveur ────────────────────────────

def test_les_villes_publiees_sont_celles_du_referentiel_geographique():
    """Une ville du référentiel obtient son lien — sans être recopiée.

    `PAGES_VILLES` est dérivé de `kojo_geo_data.GEOGRAPHIC_DATABASE` : ajouter
    une ville là-bas doit rougir ICI, pas produire une page que personne ne
    cite. L'ordre est comparé aussi : c'est celui du sitemap.
    """
    attendu = _couples(metiers.PAGES_VILLES)
    assert _couples(_liste()["villes"]) == attendu


def test_les_metiers_publies_sont_ceux_du_catalogue():
    """Un métier ajouté au catalogue obtient son lien, et son libellé est le nom publié."""
    assert _couples(_liste()["metiers"]) == _couples(metiers.PAGES_METIERS)


def test_les_guides_publies_sont_ceux_du_plan_editorial():
    """Guide de prix d'un métier, transversale : la liste suit `PAGES_GUIDES`."""
    assert _couples(_liste()["guides"]) == _couples(guides.PAGES_GUIDES)


def test_chaque_url_du_sitemap_a_son_lien():
    """La liste couvre EXACTEMENT les URL que le sitemap annonce.

    Deux sources muettes valent moins qu'une : une URL de sitemap sans lien
    interne est la page que le maillage devait sortir de l'ombre. Et un lien
    vers une URL que le sitemap n'annonce pas pointerait une page que le
    routeur ne sert peut-être pas — les deux sont comparés.
    """
    liste = _liste()
    publiees = (
        [f"/emplois/{slug}" for slug, _ in _couples(liste["villes"])]
        + [f"/metiers/{slug}" for slug, _ in _couples(liste["metiers"])]
        + [f"/guides/{slug}" for slug, _ in _couples(liste["guides"])]
    )
    annoncees = [chemin for chemin, _, _ in metiers.urls_sitemap()]
    annoncees += [chemin for chemin, _, _ in guides.urls_sitemap()]
    assert sorted(publiees) == sorted(annoncees)
    assert len(publiees) == len(set(publiees)), "une page est publiée deux fois"


def test_aucun_libelle_n_est_vide_ni_double():
    """Un libellé vide publierait un lien sans texte — donc invisible à un crawler.

    Un libellé en double dans un même groupe ferait deux liens de même texte
    vers deux pages différentes : le nom ne désigne plus rien.
    (Le nom d'une ville EST son slug sans accent — « Bamako » — : l'égalité
    n'est donc pas un défaut, ce fichier ne la juge pas.)
    """
    for groupe in ("villes", "metiers", "guides"):
        noms = []
        for slug, nom in _couples(_liste()[groupe]):
            assert slug and nom, (groupe, slug, nom)
            assert nom.strip() == nom, (groupe, slug)
            noms.append(nom)
        assert len(noms) == len(set(noms)), f"{groupe} : deux pages de même libellé"


# ── Les quatre rendus lisent CETTE déclaration ─────────────────────────────

def test_les_quatre_rendus_lisent_la_meme_declaration():
    """Un rendu qui tiendrait sa propre liste serait le défaut d'origine.

    Le module partagé (`src/config/liens-seo.js`) est le seul propriétaire du
    balisage ; la coquille de l'accueil réutilise même la fonction du pied de
    page (`liensSeoHtml`) au lieu de réécrire la chaîne.
    """
    for nom, chemin in RENDUS.items():
        source = chemin.read_text(encoding="utf-8")
        if nom == "coquille de l'accueil":
            assert "liensSeoHtml" in source, (
                f"{nom} ne réutilise pas le bloc du pied de page — deux balisages divergeraient"
            )
            continue
        assert "config/liens-seo" in source, (
            f"{nom} ne lit pas src/config/liens-seo.js : il tient sa propre liste"
        )


def test_les_liens_sont_de_vrais_liens_et_pas_des_routes_react():
    """Ces pages ne sont pas des routes React : un `Link` peindrait la 404.

    Le contrat est écrit dans le module partagé (les href sont des `<a href>`),
    et la page d'accueil ne doit pas les envelopper dans son `Link` de
    transition : le clic doit demander le document au serveur.
    """
    module = (FRONTEND / "src" / "config" / "liens-seo.js").read_text(encoding="utf-8")
    assert "/emplois/" in module and "/metiers/" in module and "/guides/" in module
    accueil = (FRONTEND / "src" / "pages" / "Home.js").read_text(encoding="utf-8")
    bloc = accueil.split("GROUPES_LIENS_SEO.map", 1)[1].split("</section>", 1)[0]
    assert "href={lien.href}" in bloc
    assert "<Link" not in bloc


# ── Les titres de groupe sont publiés dans les cinq langues ───────────────

def test_les_titres_de_groupe_existent_dans_les_cinq_dictionnaires():
    """Un titre manquant ferait publier « undefined » par la coquille.

    Les libellés de villes et de métiers sont des NOMS publiés par le backend
    (ils ne se traduisent pas) ; les trois titres de groupe, eux, sont du
    chrome : ils appartiennent aux dictionnaires, comme le reste du pied de
    page.
    """
    for langue in LANGUES:
        dictionnaire = json.loads(
            (FRONTEND / "src" / "i18n" / f"{langue}.json").read_text(encoding="utf-8")
        )
        for cle in CLES_TITRES:
            assert dictionnaire.get(cle), f"{langue}.json : « {cle} » manque ou est vide"
