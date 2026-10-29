# -*- coding: utf-8 -*-
"""Le maillage des pages ville, métier et guides : une seule liste, deux rendus.

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
  * les deux rendus du pied de page (React et coquille) doivent lire CETTE
    déclaration : un troisième domicile serait une seconde liste, et rien ne le
    dirait ;
  * et le bloc ne doit apparaître QU'UNE fois par document. Mesuré le
    29/10/2026 : l'accueil et sa coquille peignaient EN PLUS leur propre
    section de maillage, juste au-dessus du pied de page qui publie la même,
    donc « / » portait les trois groupes DEUX fois dans le même écran (/jobs et
    /login une seule fois). Chacun de ces rendus lisait pourtant la bonne
    déclaration — c'est le DOMAINE qui était en double, pas la liste ;
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

# Les DEUX rendus qui publient le bloc, et le fichier où chacun le fait.
# Le pied de page est rendu sur toutes les routes : c'est pourquoi la section de
# maillage que l'accueil peignait en plus a été retirée (29/10/2026).
RENDUS = {
    "pied de page React": FRONTEND / "src" / "App.js",
    "coquille du pied de page": FRONTEND / "vite-plugins" / "prerender" / "app-chrome.js",
}

# Les fichiers autorisés à porter le bloc : la déclaration et ses deux rendus.
DOMAINES_DU_MAILLAGE = set(RENDUS.values()) | {FRONTEND / "src" / "config" / "liens-seo.js"}

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


# ── Les deux rendus lisent CETTE déclaration ───────────────────────────────

def test_les_deux_rendus_lisent_la_meme_declaration():
    """Un rendu qui tiendrait sa propre liste serait le défaut d'origine.

    Le module partagé (`src/config/liens-seo.js`) est le seul propriétaire du
    balisage ; la coquille réutilise même la fonction du pied de page React
    (`liensSeoHtml`, écrite une fois pour les deux) au lieu de réécrire la
    chaîne.
    """
    for nom, chemin in RENDUS.items():
        source = chemin.read_text(encoding="utf-8")
        assert "config/liens-seo" in source, (
            f"{nom} ne lit pas src/config/liens-seo.js : il tient sa propre liste"
        )


def test_le_maillage_n_est_peint_qu_une_fois_par_document():
    """Un second domicile publierait le bloc DEUX fois dans le même écran.

    C'est le doublon mesuré le 29/10/2026 : l'accueil peignait sa propre section
    de maillage, puis le pied de page — qui la suit immédiatement — publiait la
    même. Les deux lisaient pourtant la bonne déclaration : c'est le nombre de
    DOMAINES que ce cas juge, pas la liste.

    Le balayage couvre tout le front (composants, pages, coquilles) : un
    troisième rendu réapparaîtrait ici, et pas ailleurs.
    """
    trouvees = set()
    for racine in (FRONTEND / "src", FRONTEND / "vite-plugins"):
        for chemin in racine.rglob("*"):
            if not chemin.is_file() or chemin.suffix not in {".js", ".jsx"}:
                continue
            if "__tests__" in chemin.parts or chemin.name.endswith(".test.js"):
                continue
            source = chemin.read_text(encoding="utf-8", errors="ignore")
            if "GROUPES_LIENS_SEO" in source or "liensSeoHtml(" in source:
                trouvees.add(chemin)
    en_trop = sorted(
        str(chemin.relative_to(FRONTEND)) for chemin in trouvees - DOMAINES_DU_MAILLAGE
    )
    assert not en_trop, (
        f"le maillage est peint par {en_trop} : le pied de page le publie déjà sur "
        "toutes les routes, donc ce rendu-là afficherait les mêmes « Villes / "
        "Métiers / Guides » deux fois dans le même document"
    )
    assert trouvees == DOMAINES_DU_MAILLAGE, (
        "un des deux rendus du pied de page ne publie plus le bloc : "
        f"{sorted(str(c.relative_to(FRONTEND)) for c in DOMAINES_DU_MAILLAGE - trouvees)}"
    )


def test_les_liens_sont_de_vrais_liens_et_pas_des_routes_react():
    """Ces pages ne sont pas des routes React : un `Link` peindrait la 404.

    Le contrat est écrit dans le module partagé (les href sont des `<a href>`),
    et la page d'accueil ne doit pas les envelopper dans son `Link` de
    transition : le clic doit demander le document au serveur.
    """
    module = (FRONTEND / "src" / "config" / "liens-seo.js").read_text(encoding="utf-8")
    assert "/emplois/" in module and "/metiers/" in module and "/guides/" in module
    pied = (FRONTEND / "src" / "App.js").read_text(encoding="utf-8")
    bloc = pied.split("GROUPES_LIENS_SEO.map", 1)[1].split("</div>", 1)[0]
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


# ── Les trois familles sont des DÉPLIANTS, et les liens restent publiés ─────

def test_les_trois_familles_sont_des_depliants_et_les_liens_restent_publies():
    """Un dépliant fermé MASQUE les liens, il ne les RETIRE pas (29/10/2026).

    Le bloc dépliait 45 liens sur quatre lignes en desktop et dix-huit en
    mobile : une muraille en bas de chaque page. Chaque famille est devenue un
    dépliant NATIF (un élément du HTML, pas un composant à état) : fermé par
    défaut, ouvert au clic ou au clavier, sans une ligne de JavaScript, donc
    identique dans les deux canaux — la coquille n'a rien à simuler et React n'a
    rien à hydrater.

    Ce que ce cas refuse, et qui est LE risque de ce raccourcissement : un
    dépliant dont les liens seraient montés à l'OUVERTURE. Le document servi
    porterait alors trois titres et zéro lien, le maillage disparaîtrait pour un
    moteur qui lit le HTML sans exécuter de script — et rien ne rougirait,
    puisque la page AFFICHÉE serait juste.
    """
    coquille = (FRONTEND / "vite-plugins" / "prerender" / "app-chrome.js").read_text(
        encoding="utf-8"
    )
    bloc = coquille.split("export function liensSeoHtml", 1)[1].split(
        "export function piedDePage", 1
    )[0]
    assert "<details>" in bloc and "<summary class=" in bloc
    assert "<details open" not in bloc, "un dépliant ouvert par défaut rend la muraille"
    # L'ORDRE du document : le déclencheur, PUIS les liens, PUIS la fermeture.
    assert bloc.index("</summary>") < bloc.index("groupe.liens") < bloc.index("</details>")

    # Le rendu React publie le MÊME élément, sans état ni condition.
    rendu = RENDUS["pied de page React"].read_text(encoding="utf-8")
    assert "<details key=" in rendu, "pied de page React : plus de dépliant"
    assert "<summary className=" in rendu, "pied de page React : pas de déclencheur"
    assert "groupe.liens.map" in rendu, "pied de page React : plus de liens publiés"
