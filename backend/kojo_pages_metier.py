# -*- coding: utf-8 -*-
"""Pages indexables par VILLE et par MÉTIER — stdlib uniquement.

LE TROU QUE CE MODULE FERME

Mesuré le 27/10/2026 sur le sitemap de production : 13 URL pour quatre pays —
neuf pages statiques (dont /login et /register, deux formulaires), une fiche de
mission, trois profils. Aucune page ne répondait à la requête qu'un habitant
d'Abidjan ou de Dakar tape réellement (« emploi Abidjan », « plombier Bamako »),
et aucune ne couvrait un métier. Un moteur n'avait donc que des pages
génériques à classer, sur un marché où la recherche est LOCALE et MÉTIER.

CE QUI EXISTE MAINTENANT

  /emplois/{ville}   — une page par ville déclarée dans la base géographique
  /metiers/{metier}  — une page par métier du catalogue

Chaque page porte un titre, une description, un `h1`, une introduction écrite,
la liste des missions réellement ouvertes (liens vers /jobs/:id), le nombre de
missions, les liens internes vers les autres villes et métiers, et un JSON-LD
`CollectionPage` + `ItemList`. Ce sont des PAGES, pas des coquilles de
l'application : elles ne démarrent pas React (voir « ce qui n'est pas fait »).

LES VILLES NE SONT PAS RECOPIÉES

`PAGES_VILLES` est DÉRIVÉ de `kojo_geo_data.GEOGRAPHIC_DATABASE` — la source de
vérité du référentiel géographique, celle que sert déjà /api/geolocation/cities.
Une ville ajoutée là apparaît ici, et son slug se calcule (nom → minuscules, sans
accent, espaces en tirets). Deux listes de villes auraient divergé au premier
ajout. Les pays viennent du même endroit (`nameFrench`), donc une page ne peut
pas annoncer un pays que la base ne connaît pas.

CE QUI N'EST PAS FAIT, ET POURQUOI

- Le document ne démarre PAS l'application. Une page de l'application suppose une
  route React pour cette URL : sans elle, le boot afficherait la page 404 par
  dessus un contenu correct. La page est donc autonome (chapeau, liste, liens,
  pied de page) et son bouton mène à `/jobs`, où l'application prend le relais
  avec le filtre déjà posé.
- Aucun chiffre n'est inventé : le nombre de missions et la liste viennent de la
  requête de la base, au moment de la réponse. Un zéro est AFFICHÉ comme zéro
  (« aucune offre ouverte aujourd'hui » + les autres villes), jamais masqué —
  une page qui prétendrait le contraire serait une donnée fausse servie à un
  moteur.
- Aucune coordonnée, aucun identifiant de client : la page ne publie que ce que
  la vue publique d'une mission publie déjà (titre, budget, métier, ville).

CE QUE CE MODULE NE FAIT PAS

Il ne lit pas la base : le routeur lui passe les missions trouvées. Il ne décide
pas des URLs : `chemin_ville`/`chemin_metier` les fixent, et le sitemap les lit
d'ici — une URL publiée dans le sitemap et une URL servie ne peuvent pas
diverger.
"""

import re
import unicodedata
from datetime import date, datetime
from typing import Iterable, Optional
from urllib.parse import quote

from kojo_csp import balise_csp
from kojo_geo_data import GEOGRAPHIC_DATABASE
# Le même échappement que le bloc de données d'une fiche mission : un titre de
# mission peut contenir « </script> », et un JSON-LD écrit brut refermerait la
# balise puis deviendrait du BALISAGE — la faille classique d'un bloc JSON.
from kojo_job_og import seed_json

# Le nom du site, pour les titres. Lu nulle part ailleurs dans ce module : la
# marque n'est pas un réglage qui change d'un déploiement à l'autre.
MARQUE = "Kojo"

# La marque DESSINÉE, servie par le site : les icônes PWA descendent de
# `src/config/marque-kojo.json` (le même dessin que la barre de l'application),
# donc l'en-tête de ces pages porte la marque du site et pas un second logo.
# 72 px pour 28 px affichés : deux fois et demie la densité, 6,6 Ko — la 192
# pesait dix fois plus pour la même tache à l'écran.
ICONE_MARQUE = "/icons/icon-72x72.png"

# ── Les LANGUES du site, publiées par l'en-tête de chaque page ──────────────
# Ces pages sont servies par le BACKEND : elles n'ont ni barre de navigation ni
# sélecteur de langue, alors que l'application en propose cinq. Un visiteur
# arrivé d'un moteur de recherche sans comprendre le français n'avait donc
# aucune porte. Les libellés sont les noms NATIFS (celui que lit le visiteur),
# et la liste est la MÊME que `frontend/src/config/languages.js` — un garde
# compare les deux, donc une langue ajoutée à l'application rougit ici au lieu
# de rester absente de la moitié des pages du site.
#
# Le lien mène à `/?lang=<code>` : l'application lit ce paramètre au démarrage
# (LanguageContext) et parle cette langue. Il ne prétend PAS traduire CETTE
# page, qui n'existe qu'en français — c'est pourquoi la navigation s'appelle
# « Langues du site » et non « cette page en… ».
LANGUES_SITE = [
    {"code": "fr", "nom": "Français"},
    {"code": "en", "nom": "English"},
    {"code": "wo", "nom": "Wolof"},
    {"code": "bm", "nom": "Bamanankan"},
    {"code": "mos", "nom": "Mòoré"},
]

# Borne de la liste publiée. Au-delà, la page renvoie vers /jobs : une page de
# ville qui énumérerait 3 000 missions pèserait plus lourd que le bénéfice, et
# le sitemap de fiches les couvre déjà une par une.
MAX_MISSIONS = 40

# Longueur visée de la description publiée (l'extrait d'un résultat de
# recherche est coupé au-delà). La valeur est UNE par page, pas par mission.
LIMITE_DESCRIPTION = 158

# ── Métiers : slug français d'URL → (catégorie canonique, nom publié) ────────
# La catégorie est celle de `kojo_job_categories._CATEGORY_GROUPS` (la même que
# filtre la liste des missions) ; le slug est l'URL que lit un humain. Les deux
# sont écrits ICI et nulle part ailleurs : une seconde table de métiers ferait
# publier une page dont le filtre ne correspondrait pas au titre.
#
# `general` n'a pas de page : « missions diverses à Abidjan » n'est pas une
# requête, c'est le reste du catalogue.
PAGES_METIERS = [
    {"slug": "plomberie", "categorie": "plumbing", "nom": "Plomberie"},
    {"slug": "electricite", "categorie": "electrical", "nom": "Électricité"},
    {"slug": "maconnerie", "categorie": "construction", "nom": "Maçonnerie et bâtiment"},
    {"slug": "menage", "categorie": "cleaning", "nom": "Ménage et nettoyage"},
    {"slug": "jardinage", "categorie": "gardening", "nom": "Jardinage"},
    {"slug": "cours-particuliers", "categorie": "tutoring", "nom": "Cours particuliers"},
    {"slug": "mecanique", "categorie": "mechanics", "nom": "Mécanique automobile"},
    {"slug": "menuiserie", "categorie": "carpentry", "nom": "Menuiserie"},
    {"slug": "informatique", "categorie": "computing", "nom": "Informatique et dépannage"},
]


def slugifier(nom: str) -> str:
    """« Bobo-Dioulasso » → « bobo-dioulasso » ; « Ségou » → « segou ».

    Le slug d'une URL est de l'ASCII : un nom accentué envoyé tel quel serait
    encodé en pour-cent par le navigateur, et deux écritures d'une même ville
    existeraient dans l'index d'un moteur. Les traits d'union sont conservés
    (ils sont déjà séparateurs), tout le reste tombe.
    """
    sans_accent = unicodedata.normalize("NFKD", nom)
    sans_accent = "".join(c for c in sans_accent if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", sans_accent.lower()).strip("-")


def _villes() -> list:
    """Les villes des pays couverts, dans l'ordre du référentiel géographique.

    `fournisseur` est le code pays de `GEOGRAPHIC_DATABASE` (« cote_divoire »),
    PAS celui de `frontend/src/config/countries.js` (« ivory_coast ») : c'est
    cette base-là qui porte les villes, et c'est elle que filtre le routeur.
    """
    pages = []
    for code, pays in GEOGRAPHIC_DATABASE.items():
        for ville in pays.get("majorCities") or []:
            nom = (ville.get("name") or "").strip()
            if not nom:
                continue
            pages.append(
                {
                    "slug": slugifier(nom),
                    "nom": nom,
                    "pays": code,
                    "pays_nom": pays.get("nameFrench") or pays.get("country") or "",
                    "pays_drapeau": pays.get("flag") or "",
                }
            )
    return pages


PAGES_VILLES = _villes()


def trouver_ville(slug: str) -> Optional[dict]:
    cible = slugifier(slug or "")
    for page in PAGES_VILLES:
        if page["slug"] == cible:
            return page
    return None


def trouver_metier(slug: str) -> Optional[dict]:
    cible = (slug or "").strip().lower()
    for page in PAGES_METIERS:
        if page["slug"] == cible:
            return page
    return None


def requete_ville(page: dict) -> dict:
    """Le filtre Mongo d'une page ville — la ville écrite, pas une région.

    `location.city` est l'endroit où la création écrit la ville ; `city` est la
    forme plate de documents plus anciens. Les deux sont interrogés, sinon une
    mission visible dans la liste générale manquerait sur la page de SA ville —
    un vide qui n'aurait rien mesuré.
    """
    motif = {"$regex": f"^{re.escape(page['nom'])}$", "$options": "i"}
    return {
        "$and": [
            {"$or": [{"location.city": motif}, {"city": motif}]},
            {"status": "open"},
            {"deleted": {"$ne": True}},
        ]
    }


def requete_metier(page: dict) -> dict:
    """Le filtre Mongo d'une page métier : tout le GROUPE d'écritures.

    Un job legacy peut porter « plomberie » là où le filtre de l'UI demande
    « plumbing » : `_category_search_variants` rend les deux, comme la liste.
    """
    from kojo_job_categories import _category_search_variants

    return {
        "category": {"$in": _category_search_variants(page["categorie"])},
        "status": "open",
        "deleted": {"$ne": True},
    }


def chemin_ville(slug: str) -> str:
    return f"/emplois/{slug}"


def chemin_metier(slug: str) -> str:
    return f"/metiers/{slug}"


# ── Sitemap : les URL de ce module, lues ICI par le sitemap ─────────────────
# Une URL publiée dans le sitemap et une URL servie par le routeur sortent donc
# de la même déclaration : renommer un slug ne peut pas laisser derrière une
# entrée morte (une URL de sitemap qui répond 404 fait perdre la confiance du
# crawler sur tout le fichier).
def urls_sitemap() -> list:
    """[(chemin, changefreq, priority)] — villes puis métiers."""
    entrees = [(chemin_ville(p["slug"]), "daily", "0.7") for p in PAGES_VILLES]
    entrees += [(chemin_metier(p["slug"]), "weekly", "0.6") for p in PAGES_METIERS]
    return entrees


def _esc(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _en_tete() -> str:
    """L'en-tête commun à TOUTES les pages servies par le backend.

    Deux choses seulement, et les deux manquaient : LA MARQUE (le texte « Kojo »
    nu de l'ancien en-tête ne disait pas de quel site on parlait, et un visiteur
    venu d'un moteur n'avait aucun chemin de retour lisible) et LES LANGUES du
    site (l'application en propose cinq, ces pages n'en disaient rien).

    Le dessin est décoratif (`alt` vide) : le nom accessible du lien est le mot
    « Kojo » qui l'accompagne, comme dans la barre de l'application où le tracé
    est `aria-hidden`. Un `aria-label` doublerait ce nom.

    Les `width`/`height` sont écrits : une image sans dimensions connues fait
    danser la mise en page pendant son chargement, et c'est exactement le défaut
    que le reste de ce dépôt paie déjà cher.
    """
    def lien(langue):
        code = langue["code"]
        courant = ' aria-current="true"' if code == "fr" else ""
        return f'<a href="/?lang={code}" lang="{code}"{courant}>{_esc(langue["nom"])}</a>'

    langues = "".join(lien(langue) for langue in LANGUES_SITE)
    return (
        "<header>"
        '<a href="/" class="marque">'
        f'<img src="{ICONE_MARQUE}" alt="" width="28" height="28" />'
        f"<span>{MARQUE}</span>"
        "</a>"
        f'<nav class="langues" aria-label="Langues du site">{langues}</nav>'
        "</header>\n"
    )


def _heure(valeur) -> str:
    """Date de publication lisible, ou chaîne vide si elle est illisible.

    Une date pourrie ne devient pas « aujourd'hui » : la page n'annonce pas une
    fraîcheur qu'elle n'a pas mesurée.
    """
    if not valeur:
        return ""
    texte = valeur.isoformat() if isinstance(valeur, (datetime, date)) else str(valeur)
    return texte[:10]


def titre_de(page: dict, genre: str) -> str:
    if genre == "ville":
        return f"Emplois et missions à {page['nom']} — {MARQUE}"
    return f"Missions de {page['nom'].lower()} — {MARQUE}"


def description_de(page: dict, genre: str, nombre: int) -> str:
    """La description PUBLIÉE, avec le nombre RÉEL de missions ouvertes.

    Le nombre est calculé sur la réponse, pas décoré : une description qui
    annoncerait « 120 missions » sur une page qui en liste zéro serait une
    donnée fausse, et c'est exactement ce qu'un moteur affiche.

    La coupe tombe sur le DERNIER espace avant la limite (la même règle que
    `kojo_job_og.couper_description`) : une phrase tronquée au milieu d'un mot
    est citée telle quelle par un résultat de recherche.
    """
    pluriel = "s" if nombre > 1 else ""
    if genre == "ville":
        ouverture = (
            f"{nombre} offre{pluriel} ouverte{pluriel} à {page['nom']} aujourd'hui"
            if nombre
            else f"Aucune offre ouverte à {page['nom']} pour le moment"
        )
        suite = (
            f" — plomberie, ménage, maçonnerie, informatique et plus, publiées "
            f"par des clients de {page['pays_nom']}. Paiement sécurisé par "
            f"séquestre, mobile money, avis vérifiés."
        )
    else:
        ouverture = (
            f"{nombre} offre{pluriel} ouverte{pluriel} en {page['nom'].lower()} aujourd'hui"
            if nombre
            else f"Aucune offre ouverte en {page['nom'].lower()} pour le moment"
        )
        suite = (
            " à Abidjan, Dakar, Bamako, Ouagadougou et dans tout l'Ouest africain : "
            "publiez une mission ou proposez vos services. Paiement sécurisé par "
            "séquestre, mobile money."
        )
    texte = ouverture + suite
    if len(texte) <= LIMITE_DESCRIPTION:
        return texte
    tranche = texte[:LIMITE_DESCRIPTION]
    espace = tranche.rfind(" ")
    coupe = (tranche[:espace] if espace > 0 else tranche).rstrip(" .,;:—-")
    return coupe + "…"


def introduction_de(page: dict, genre: str) -> str:
    """Le texte de la page — du contenu RÉEL, pas un gabarit vide.

    C'est ce que « page de contenu » veut dire : une page qui n'existerait que
    par sa liste de résultats n'aurait rien à indexer les jours où la liste est
    vide, et c'est précisément le cas d'un marché qui démarre.
    """
    if genre == "ville":
        return (
            f"Kojo met en relation les habitants de {page['nom']} "
            f"({page['pays_nom']}) avec des professionnels vérifiés, et les "
            f"professionnels avec des clients qui publient une mission. Un client "
            f"décrit son besoin, reçoit des propositions chiffrées, choisit, puis "
            f"paie : le montant est retenu par séquestre et n'est versé au "
            f"travailleur qu'une fois la mission validée. Un désaccord se déclare "
            f"et s'arbitre, au lieu de se régler dans l'ignorance. Le paiement "
            f"passe par le mobile money déjà utilisé sur place, et un litige non "
            f"traité bloque le versement : c'est la raison pour laquelle les deux "
            f"côtés acceptent de travailler avec quelqu'un qu'ils ne connaissent "
            f"pas encore."
        )
    return (
        f"Les missions de {page['nom'].lower()} publiées sur Kojo vont de la "
        f"réparation urgente au chantier planifié. Un client publie sa demande "
        f"avec son budget et sa ville ; les professionnels de la région "
        f"proposent un prix et une date ; le client choisit. Le montant est "
        f"retenu par séquestre jusqu'à validation de la mission, ce qui protège "
        f"le client d'un travail non fait et le professionnel d'un client qui "
        f"disparaît. Le paiement se fait en mobile money, et les avis ne sont "
        f"publiés qu'après une mission réellement terminée : un profil se juge "
        f"sur du travail accompli, pas sur une déclaration."
    )


def _etapes(genre: str, page: dict) -> list:
    if genre == "ville":
        return [
            ("Décrivez votre besoin", f"Titre, description, budget et quartier à {page['nom']} : "
             "la mission est publiée en une minute, sans frais."),
            ("Recevez des propositions", "Les professionnels de la zone proposent un prix et une "
             "date. Vous comparez les profils et les avis vérifiés."),
            ("Payez après validation", "Le montant part en séquestre puis au travailleur une fois "
             "la mission validée. Un désaccord se déclare et s'arbitre."),
        ]
    return [
        ("Trouvez la mission", f"Les offres de {page['nom'].lower()} de votre ville sont listées "
         "avec le budget annoncé par le client, pas une fourchette."),
        ("Proposez votre prix", "Une proposition chiffrée et une date. Le client compare les "
         "profils, les avis et le prix avant de choisir."),
        ("Soyez payé", "Le budget est déjà retenu : à la validation de la mission, il est versé "
         "sur votre compte mobile money."),
    ]


def _carte(mission: dict) -> str:
    """Une mission dans la liste : un LIEN vers sa fiche, jamais du texte mort."""
    identifiant = mission.get("id") or mission.get("job_id") or ""
    if not identifiant:
        return ""
    titre = mission.get("title") or "Mission"
    budget = mission.get("budget")
    devise = mission.get("currency") or "FCFA"
    lieu = (
        (mission.get("location") or {}).get("city")
        if isinstance(mission.get("location"), dict)
        else mission.get("city")
    )
    quand = _heure(mission.get("created_at") or mission.get("posted_at"))
    # La catégorie n'est PAS publiée : elle est stockée en slug anglais
    # (« plumbing ») et cette page est en français. Le titre et la ville disent
    # déjà de quoi il s'agit.
    details = " · ".join(
        part
        for part in (
            f"{budget} {devise}" if budget not in (None, "") else "",
            _esc(lieu) if lieu else "",
            _esc(quand) if quand else "",
        )
        if part
    )
    return (
        f'<li class="offre"><a href="/jobs/{_esc(identifiant)}">{_esc(titre)}</a>'
        f'<span class="meta">{details}</span></li>'
    )


def _liens_internes(genre: str, page: dict) -> str:
    """Le maillage : chaque page ville pointe les métiers et réciproquement.

    Sans lui, une page de métier n'aurait aucun lien entrant depuis une page de
    ville et ne serait découverte que par le sitemap — c'est-à-dire, en pratique,
    plus tard et moins souvent.

    Les GUIDES y entrent aussi (27/10/2026) : un guide n'a sinon aucun lien
    entrant hors sitemap, et une page de métier est exactement l'endroit où un
    visiteur se demande « combien ça coûte » — c'est la requête d'à côté. Un
    métier pointe SON guide de prix ; une ville pointe les guides de prix (elle
    ne les cite pas un par un dans son texte) et le guide transversal.

    L'import est LOCAL : `kojo_pages_guides` importe ce module (il dérive ses
    pages du catalogue), donc l'importer ici, au chargement, créerait un cycle.
    Les URLs restent déclarées là-bas — aucun `f"/guides/…"` recopié ici.
    """
    from kojo_pages_guides import (
        GUIDES_PRIX_SLUGS,
        SLUG_CHOISIR,
        chemin_guide,
        chemin_guide_prix_ville,
    )

    if genre == "metier":
        guides = [(chemin_guide(f"prix-{page['slug']}"), f"Prix : {page['nom'].lower()}")]
        guides.append((chemin_guide(SLUG_CHOISIR), "Comment choisir un artisan"))
    else:
        # SON guide de prix d'abord : c'est le lien le plus proche de la
        # question qui suit « emploi Abidjan » (« combien ça coûte ici ? »), et
        # sans lui la page de la ville ne mènerait à son propre guide que par
        # le hasard d'un maillage général.
        guides = [(chemin_guide_prix_ville(page["slug"]), f"Prix à {page['nom']}")]
        guides += [
            (chemin_guide(f"prix-{slug}"), f"Prix : {nom.lower()}")
            for slug, nom in GUIDES_PRIX_SLUGS
        ]
        guides.append((chemin_guide(SLUG_CHOISIR), "Comment choisir un artisan"))
    liens_guides = "".join(
        f'<li><a href="{chemin}">{_esc(titre)}</a></li>' for chemin, titre in guides
    )
    metiers = "".join(
        f'<li><a href="{chemin_metier(p["slug"])}">{_esc(p["nom"])}</a></li>'
        for p in PAGES_METIERS
    )
    villes = "".join(
        f'<li><a href="{chemin_ville(p["slug"])}">{_esc(p["nom"])}</a></li>'
        for p in PAGES_VILLES
    )
    titre = "Autres villes" if genre == "metier" else "Autres villes couvertes"
    return (
        f'<div class="maillage">'
        f'<section><h2>Métiers</h2><ul>{metiers}</ul></section>'
        f'<section><h2>{titre}</h2><ul>{villes}</ul></section>'
        f'<section><h2>Guides</h2><ul>{liens_guides}</ul></section>'
        f'</div>'
    )


def titre_alerte(genre: str, page: dict) -> str:
    """Le titre du bloc d'alerte — il nomme le MÉTIER ou la VILLE de la page.

    « Recevoir les missions de plomberie par email » plutôt que « Créer une
    alerte » : le lien dit ce qu'il ramène, et la page reste la même requête du
    début à la fin.
    """
    if genre == "metier":
        return f"Recevoir les missions de {page['nom'].lower()} par email"
    return f"Recevoir les missions à {page['nom']} par email"


def lien_alerte(genre: str, page: dict) -> str:
    """L'URL d'alerte de CETTE page, critères compris.

    `alerte=1` demande l'ouverture de la carte ; `category` est le slug que
    filtre déjà `/jobs`, `ville` la ville TELLE QU'ELLE EST ÉCRITE dans la
    page — la veille garde ce texte et le compare au nom de la mission, donc
    envoyer le slug (« segou ») ferait une alerte qui ne correspondrait à
    rien. Le `&` est écrit `&amp;` : c'est un attribut `href`.
    """
    if genre == "metier":
        parametres = f"alerte=1&amp;category={quote(page['categorie'])}"
    else:
        parametres = f"alerte=1&amp;ville={quote(page['nom'])}"
    return f"/jobs?{parametres}"


def _bloc_alerte(genre: str, page: dict) -> str:
    """Le bloc d'alerte emploi : un vrai lien, et ce qu'il ne promet PAS.

    Les pages ville et métier disent honnêtement « aucune offre ouverte » les
    jours creux — et s'arrêtaient là. Un visiteur venu chercher un plombier à
    Bamako n'avait aucun moyen de laisser son intention, alors que l'alerte
    emploi existe depuis le 24/10 (`/job-alerts`, une par compte travailleur)
    et n'était montée que sur `/jobs`, connecté.

    Le bloc ne prétend rien sur l'offre : il dit qu'une alerte ÉCRIT quand une
    mission CORRESPOND, que l'adresse est celle du compte et qu'il en faut un.
    La liste au-dessus reste la seule mesure de ce qui est ouvert.
    """
    return (
        '<section class="alerte" aria-labelledby="alerte-titre">'
        f'<h2 id="alerte-titre">{_esc(titre_alerte(genre, page))}</h2>'
        "<p>Une alerte par compte travailleur : Kojo écrit à l’adresse du compte "
        "dès qu’une mission correspond, et rien n’est promis sur le nombre "
        "d’offres à venir — la liste ci-dessus est la seule mesure de l’offre."
        "</p>"
        f'<a class="cta alerte-cta" href="{lien_alerte(genre, page)}">'
        "Créer mon alerte emploi</a>"
        "</section>"
    )


def _json_ld(page: dict, genre: str, url: str, missions: Iterable[dict]) -> str:
    """`CollectionPage` + `ItemList` : ce que la page EST, et ce qu'elle liste.

    L'URL d'une mission est celle du SITE (`/jobs/:id`), pas celle de cette page :
    elle se construit depuis l'origine, jamais depuis le chemin courant.
    """
    origine = url.split("/emplois/")[0].split("/metiers/")[0]
    elements = []
    for mission in missions:
        identifiant = mission.get("id") or mission.get("job_id")
        if not identifiant:
            continue
        elements.append(
            {
                "@type": "ListItem",
                "position": len(elements) + 1,
                "url": f"{origine}/jobs/{identifiant}",
                "name": mission.get("title") or "Mission",
            }
        )
    donnees = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": page["nom"],
        "url": url,
        "inLanguage": "fr",
        "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": len(elements),
            "itemListElement": elements,
        },
    }
    return seed_json(donnees)


STYLE = """
:root{--sable:#fcf8f2;--encre:#1c1917;--brun:#7c2d12;--orange:#c2410c;--trait:#e7e2d8}
*{box-sizing:border-box}
body{margin:0;background:var(--sable);color:var(--encre);
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6}
header{border-bottom:1px solid var(--trait);padding:1rem 1.25rem;display:flex;
align-items:center;justify-content:space-between;gap:.6rem 1rem;flex-wrap:wrap}
header .marque{display:inline-flex;align-items:center;gap:.55rem;font-weight:700;
color:var(--brun);text-decoration:none;font-size:1.15rem}
header .marque img{display:block}
nav.langues{display:flex;flex-wrap:wrap;gap:.35rem 1rem;font-size:.85rem}
nav.langues a{color:var(--brun);text-decoration:none}
nav.langues a:hover{text-decoration:underline}
nav.langues a[aria-current]{color:var(--encre);font-weight:700;text-decoration:underline}
main{max-width:52rem;margin:0 auto;padding:2rem 1.25rem 3rem}
h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.2;margin:.2rem 0 1rem}
.intro{font-size:1.05rem;margin:0 0 1.75rem}
.cta{display:inline-block;background:var(--orange);color:#fff;text-decoration:none;
padding:.7rem 1.15rem;border-radius:.5rem;font-weight:600;margin-bottom:2rem}
.cta:hover{background:var(--brun)}
h2{font-size:1.2rem;margin:2rem 0 .75rem}
ul.offres{list-style:none;padding:0;margin:0}
.offre{padding:.85rem 0;border-bottom:1px solid var(--trait)}
.offre a{color:var(--brun);font-weight:600;text-decoration:none}
.offre a:hover{text-decoration:underline}
.meta{display:block;color:#57534e;font-size:.9rem;margin-top:.2rem}
.etapes{display:grid;gap:1rem;grid-template-columns:1fr}
@media(min-width:44rem){.etapes{grid-template-columns:repeat(3,1fr)}}
.etape h3{margin:0 0 .35rem;font-size:1rem}
.etape p{margin:0;font-size:.95rem;color:#44403c}
.maillage{display:grid;gap:1rem;grid-template-columns:1fr;margin-top:2.5rem}
@media(min-width:44rem){.maillage{grid-template-columns:1fr 1fr}}
.maillage ul{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.4rem 1rem}
.maillage a{color:var(--orange)}
footer{border-top:1px solid var(--trait);padding:1.5rem 1.25rem;font-size:.9rem;color:#57534e}
footer a{color:var(--brun)}
.vide{background:#fff;border:1px solid var(--trait);border-radius:.5rem;padding:1rem}
.alerte{background:#fff;border:1px solid var(--trait);border-radius:.6rem;
padding:1.25rem;margin:1.5rem 0}
.alerte h2{margin:0 0 .5rem}
.alerte p{margin:0 0 1rem;font-size:.95rem;color:#44403c}
.alerte-cta{margin-bottom:0}
"""


def document(page: dict, genre: str, origine: str, missions: list) -> str:
    """Le document HTML complet d'une page ville ou métier.

    `origine` est l'origine publique du site (sans barre finale) : canonical,
    og:url et JSON-LD en sortent, donc aucune URL relative ne peut se résoudre
    contre l'hôte de l'API (`api.kojoforafrica.cc.cd`), ce qui aurait publié une
    adresse qui ne répond pas pour un visiteur.
    """
    base = origine.rstrip("/")
    chemin = chemin_ville(page["slug"]) if genre == "ville" else chemin_metier(page["slug"])
    url = f"{base}{chemin}"
    nombre = len(missions)
    titre = titre_de(page, genre)
    description = description_de(page, genre, nombre)
    h1 = (
        f"Emplois et missions à {page['nom']}"
        if genre == "ville"
        else f"Missions de {page['nom'].lower()}"
    )
    cartes = "".join(_carte(m) for m in missions)
    liste = (
        f'<ul class="offres">{cartes}</ul>'
        if cartes
        else (
            '<p class="vide">Aucune offre ouverte pour le moment. Publiez la '
            'première mission, ou consultez les <a href="/jobs">offres de toutes '
            "les villes</a>.</p>"
        )
    )
    etapes = "".join(
        f'<div class="etape"><h3>{_esc(t)}</h3><p>{_esc(p)}</p></div>'
        for t, p in _etapes(genre, page)
    )
    compteur = (
        f"{nombre} offre{'s' if nombre > 1 else ''} ouverte{'s' if nombre > 1 else ''}"
        if nombre
        else "Aucune offre ouverte"
    )

    return (
        "<!DOCTYPE html>\n"
        '<html lang="fr">\n<head>\n'
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        f"<title>{_esc(titre)}</title>\n"
        f'<meta name="description" content="{_esc(description)}" />\n'
        '<meta name="robots" content="index, follow" />\n'
        f'<link rel="canonical" href="{_esc(url)}" />\n'
        f'<meta property="og:type" content="website" />\n'
        f'<meta property="og:site_name" content="{MARQUE}" />\n'
        f'<meta property="og:title" content="{_esc(titre)}" />\n'
        f'<meta property="og:description" content="{_esc(description)}" />\n'
        f'<meta property="og:url" content="{_esc(url)}" />\n'
        f'<meta property="og:image" content="{_esc(base)}/og-image.png" />\n'
        f'<meta name="twitter:card" content="summary_large_image" />\n'
        f'<meta name="twitter:title" content="{_esc(titre)}" />\n'
        f'<meta name="twitter:description" content="{_esc(description)}" />\n'
        f"{balise_csp()}"
        f"<style>{STYLE}</style>\n"
        f'<script type="application/ld+json">{_json_ld(page, genre, url, missions)}</script>\n'
        "</head>\n<body>\n"
        f"{_en_tete()}"
        "<main>\n"
        f"<h1>{_esc(h1)}</h1>\n"
        f'<p class="intro">{_esc(introduction_de(page, genre))}</p>\n'
        f'<a class="cta" href="/jobs">{_esc(compteur)} — voir les offres</a>\n'
        f"<h2>Offres ouvertes</h2>\n{liste}\n"
        f"{_bloc_alerte(genre, page)}\n"
        f'<h2>Comment ça marche</h2>\n<div class="etapes">{etapes}</div>\n'
        f"{_liens_internes(genre, page)}\n"
        "</main>\n"
        f'<footer>Kojo — missions et emplois de proximité en Afrique de '
        f"l'Ouest. <a href=\"/jobs\">Toutes les offres</a> · "
        f'<a href="/about">À propos</a> · <a href="/contact">Contact</a></footer>\n'
        "</body>\n</html>\n"
    )


def document_introuvable(origine: str) -> str:
    """404 d'une page ville/métier inconnue : `noindex`, aucun contenu inventé."""
    base = origine.rstrip("/")
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        "<title>Page introuvable — Kojo</title>\n"
        '<meta name="robots" content="noindex, follow" />\n'
        f'<link rel="canonical" href="{_esc(base)}/jobs" />\n'
        f"{balise_csp()}<style>{STYLE}</style>\n"
        "</head>\n<body>\n"
        f"{_en_tete()}<main>\n"
        "<h1>Cette page n'existe pas</h1>\n"
        '<p class="intro">Aucune ville ni métier ne porte ce nom sur Kojo. '
        'Les offres ouvertes sont <a href="/jobs">ici</a>.</p>\n'
        "</main>\n</body>\n</html>\n"
    )
