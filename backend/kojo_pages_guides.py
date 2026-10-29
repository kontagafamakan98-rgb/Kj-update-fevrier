# -*- coding: utf-8 -*-
"""Guides ÉDITORIAUX indexables — stdlib uniquement.

POURQUOI CETTE FAMILLE

Les pages ville et métier (`kojo_pages_metier`) répondent à « plombier Bamako »
et « emploi Abidjan ». Elles ne répondent pas aux deux questions qui les
précèdent dans une recherche : « combien ça coûte ? » et « comment choisir
quelqu'un ? ». Ce sont des requêtes d'INFORMATION, pas de mise en relation : un
moteur les classe sur un guide, jamais sur une liste d'offres.

  /guides/prix-{metier}    — un guide par métier du catalogue, avec les budgets
                             réellement annoncés par les clients, ville par ville
  /guides/prix-{ville}     — le MÊME mesure, retournée : les budgets annoncés
                             dans UNE ville, métier par métier (27/10/2026)
  /guides/choisir-un-artisan — un guide transversal, sans chiffre de marché

POURQUOI LA VILLE AUSSI

« prix plombier Abidjan » n'est pas « prix plombier » : la première demande un
chiffre LOCAL, la seconde un ordre de grandeur. Le guide par métier publie les
budgets ville par ville ; il ne peut pas être la page d'arrivée d'une recherche
qui nomme une ville, et il n'y en a qu'une par métier. Le guide de ville est donc
la vue INVERSE de la même mesure — un tableau métier par métier pour cette
ville — et il est DÉRIVÉ de `kojo_pages_metier.PAGES_VILLES`, comme les guides
de prix le sont du catalogue : une ville ajoutée au référentiel obtient sa page.

Ce qu'il n'est pas : une matrice villes × métiers de 117 pages. Une page par
couple serait, aujourd'hui, 117 fois le même texte avec deux mots changés — le
contenu à l'échelle qu'un moteur traite comme du remplissage. La ville est le
niveau où le chiffre EST local sans être vide.

L'ARGENT N'EST PAS INVENTÉ

Un guide de prix qui publie « un plombier coûte entre 15 000 et 40 000 FCFA »
sans mesure est une donnée fausse servie à un moteur — exactement ce que ce
dépôt refuse ailleurs (la description d'une page ville COMPTE les offres, elle
ne les décore pas). Ici, le seul chiffre de prix publié est celui des BUDGETS
annoncés par des clients sur des missions OUVERTES : nombre de missions, plus
petit budget, plus grand, médiane (à partir de trois missions, en dessous la
médiane n'est qu'une des deux bornes). Une ville sans budget publié l'écrit —
elle ne disparaît pas du tableau, et aucun montant n'est inventé pour la
remplir.

Ce que ce chiffre n'est PAS, et le guide le dit : un budget annoncé par un
client n'est pas un prix de marché. C'est ce qu'un client a proposé, avant les
propositions chiffrées des professionnels. Un guide qui confondrait les deux
apprendrait au visiteur à négocier contre une donnée qui n'existe pas.

LES GUIDES SONT DÉRIVÉS DU CATALOGUE

`GUIDES_PRIX` se calcule depuis `kojo_pages_metier.PAGES_METIERS` : un métier
ajouté au catalogue obtient son guide sans toucher à ce module. Une seconde
liste de métiers aurait divergé au premier ajout, et un guide orphelin
pointerait une page qui n'existe plus.

CE QUE CE MODULE NE FAIT PAS

Il ne lit pas la base (le routeur lui passe les missions) et ne fixe pas les
URLs seul : `chemin_guide` les déclare, le sitemap ET les liens des pages ville
et métier les lisent d'ici.
"""

from typing import Iterable, Optional

import kojo_pages_metier as pages_metier
from kojo_job_og import seed_json
from kojo_pages_metier import MARQUE, STYLE, _carte, _esc, chemin_metier

# Borne de lecture des budgets. Au-delà, la page cesserait d'être une page pour
# devenir un export : la mesure porte sur les missions les plus récentes, et le
# guide dit sur combien de missions elle porte.
MAX_MISSIONS_LUES = 200

# Nombre de missions citées en exemple sous le tableau. Les budgets mesurés
# portent sur MAX_MISSIONS_LUES ; la liste, elle, reste lisible.
MAX_EXEMPLES = 6

# Une médiane à deux valeurs n'en est pas une : sous ce plancher, la page publie
# les bornes et dit que la médiane n'est pas calculable.
MIN_POUR_MEDIANE = 3

# Guide transversal : il ne dépend d'aucun métier, donc son slug ne se dérive de
# rien et s'écrit ici, une fois.
SLUG_CHOISIR = "choisir-un-artisan"


def chemin_guide(slug: str) -> str:
    """L'URL d'un guide — lue par le sitemap, les liens et les routes."""
    return f"/guides/{slug}"


def chemin_guide_prix(slug_metier: str) -> str:
    """L'URL du guide de prix d'un métier, dérivée de SON slug.

    C'est ce que lit la page métier pour se lier : la règle du nom vit ici, et
    nulle part ailleurs dans un `f"/guides/prix-…"` recopié.
    """
    return chemin_guide(f"prix-{slug_metier}")


def chemin_guide_prix_ville(slug_ville: str) -> str:
    """L'URL du guide de prix d'une ville — même règle, même propriétaire.

    Lue par la page ville (`/emplois/{ville}`) pour se lier à son guide, par le
    maillage des guides entre eux, et par le sitemap. Aucun `f"prix-{…}"` n'est
    recopié ailleurs : c'est ici que le nom se décide.
    """
    return chemin_guide(f"prix-{slug_ville}")


def _guides_prix() -> list:
    """Un guide de prix par métier du catalogue — DÉRIVÉ, jamais recopié."""
    return [
        {
            "slug": f"prix-{metier['slug']}",
            "type": "prix",
            "metier": metier,
            "nom": f"Prix : {metier['nom'].lower()}",
        }
        for metier in pages_metier.PAGES_METIERS
    ]


def _guides_prix_villes() -> list:
    """Un guide de prix par ville du référentiel — DÉRIVÉ, jamais recopié.

    La ville porte le slug de sa page (`/emplois/{ville}` → `prix-{ville}`) : le
    guide et la page d'offres de la même ville se reconnaissent sans table de
    correspondance, et un renommage de ville ne peut pas laisser un guide
    orphelin pointant une page qui n'existe plus.
    """
    return [
        {
            "slug": f"prix-{ville['slug']}",
            "type": "prix_ville",
            "ville": ville,
            "nom": f"Prix à {ville['nom']}",
        }
        for ville in pages_metier.PAGES_VILLES
    ]


GUIDE_CHOISIR = {
    "slug": SLUG_CHOISIR,
    "type": "choisir",
    "nom": "Choisir un artisan",
}

PAGES_GUIDES = _guides_prix() + _guides_prix_villes() + [GUIDE_CHOISIR]

# (slug du métier, nom publié) : ce qu'une page VILLE lit pour lister les guides
# de prix. Dérivé du catalogue comme le reste — une troisième liste de métiers
# aurait fini par désigner un guide qui n'existe pas.
GUIDES_PRIX_SLUGS = [(metier["slug"], metier["nom"]) for metier in pages_metier.PAGES_METIERS]


def urls_sitemap() -> list:
    """[(chemin, changefreq, priority)] — la MÊME déclaration que les routes.

    Une URL publiée dans le sitemap et une URL servie par le routeur sortent
    d'ici : renommer un slug ne peut pas laisser derrière soi une entrée morte.
    """
    return [(chemin_guide(page["slug"]), "weekly", "0.6") for page in PAGES_GUIDES]


def trouver_guide(slug: str) -> Optional[dict]:
    """Le guide déclaré pour ce slug, ou `None` (la route rend alors un 404)."""
    for page in PAGES_GUIDES:
        if page["slug"] == slug:
            return page
    return None


def guides_de_metier(slug_metier: str) -> list:
    """Les guides à lier depuis une page métier : son prix, puis le transversal."""
    prix = trouver_guide(f"prix-{slug_metier}")
    return [page for page in (prix, GUIDE_CHOISIR) if page]


# ── La mesure : les budgets ANNONCÉS, pas un prix de marché ─────────────────


def _nombre(valeur) -> Optional[int]:
    """Un budget lisible en entier, ou `None`.

    Un budget absent, vide, non numérique ou négatif n'est pas zéro : il n'entre
    pas dans la mesure. Compter un zéro ferait baisser la fourchette publiée
    avec une donnée qui n'existe pas.
    """
    if isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float)):
        montant = int(valeur)
    elif isinstance(valeur, str) and valeur.strip().isdigit():
        montant = int(valeur.strip())
    else:
        return None
    return montant if montant > 0 else None


def _ville_de(mission: dict) -> str:
    lieu = mission.get("location")
    ville = lieu.get("city") if isinstance(lieu, dict) else mission.get("city")
    return str(ville).strip() if ville else ""


def _mediane(valeurs: list) -> Optional[int]:
    if len(valeurs) < MIN_POUR_MEDIANE:
        return None
    ordonnees = sorted(valeurs)
    milieu = len(ordonnees) // 2
    if len(ordonnees) % 2:
        return ordonnees[milieu]
    return (ordonnees[milieu - 1] + ordonnees[milieu]) // 2


def stats_par_ville(missions: Iterable[dict]) -> dict:
    """{ville: {nombre, minimum, maximum, mediane, devise}} — mesuré, borné.

    Seules les missions qui portent un budget lisible ET une ville comptent. Une
    mission sans budget n'est pas une mission à zéro : elle est hors mesure, et
    le guide publie le nombre de missions MESURÉES, pas le nombre d'offres.
    """
    par_ville = {}
    for mission in missions:
        montant = _nombre(mission.get("budget"))
        ville = _ville_de(mission)
        if montant is None or not ville:
            continue
        entree = par_ville.setdefault(
            ville, {"budgets": [], "devise": mission.get("currency") or "FCFA"}
        )
        entree["budgets"].append(montant)
        if not mission.get("currency"):
            continue
        entree["devise"] = mission["currency"]

    resultat = {}
    for ville, entree in par_ville.items():
        budgets = entree["budgets"]
        resultat[ville] = {
            "nombre": len(budgets),
            "minimum": min(budgets),
            "maximum": max(budgets),
            "mediane": _mediane(budgets),
            "devise": entree["devise"],
        }
    return resultat


# Une écriture de catégorie qui ne correspond à AUCUN métier du catalogue a
# quand même un budget annoncé : elle ne disparaît pas silencieusement du total
# affiché, elle sort sous cette ligne. Un tableau dont la somme ne ferait pas le
# total annoncé serait le pire des deux mondes.
AUTRES = "autres"


def _variantes_par_metier() -> dict:
    """{slug métier: écritures de catégorie admises} — la règle de la LISTE.

    `_category_search_variants` est celle que la page métier interroge en base
    (un job ancien peut porter « plomberie » là où l'UI écrit « plumbing ») : le
    tableau par métier juge donc les MÊMES écritures, sinon une mission comptée
    par la page métier manquerait à la page ville.
    """
    from kojo_job_categories import _category_search_variants

    return {
        metier["slug"]: {
            str(v).strip().lower()
            for v in _category_search_variants(metier["categorie"])
        }
        for metier in pages_metier.PAGES_METIERS
    }


def stats_par_metier(missions: Iterable[dict]) -> dict:
    """{slug métier ou AUTRES: {nombre, minimum, maximum, mediane, devise}}

    Même règle de mesure que `stats_par_ville` — un budget illisible est HORS
    mesure et ne devient pas un zéro — mais le regroupement est le métier, pas
    la ville : c'est la vue d'une seule ville, renvoyée métier par métier.

    Une mission sans catégorie connue compte dans `AUTRES`, jamais dans un
    métier deviné : attribuer un budget à la mauvaise colonne publierait un prix
    qui n'a pas été proposé là.
    """
    variantes = _variantes_par_metier()
    par_metier = {}
    for mission in missions:
        montant = _nombre(mission.get("budget"))
        if montant is None:
            continue
        categorie = str(mission.get("category") or "").strip().lower()
        cle = next(
            (slug for slug, admises in variantes.items() if categorie in admises),
            AUTRES,
        )
        entree = par_metier.setdefault(
            cle, {"budgets": [], "devise": mission.get("currency") or "FCFA"}
        )
        entree["budgets"].append(montant)
        if mission.get("currency"):
            entree["devise"] = mission["currency"]

    resultat = {}
    for cle, entree in par_metier.items():
        budgets = entree["budgets"]
        resultat[cle] = {
            "nombre": len(budgets),
            "minimum": min(budgets),
            "maximum": max(budgets),
            "mediane": _mediane(budgets),
            "devise": entree["devise"],
        }
    return resultat


def total_mesure(stats: dict) -> int:
    """Le nombre de budgets mesurés — le total publié, toutes lignes comprises."""
    return sum(entree["nombre"] for entree in stats.values())

# ── Le texte ────────────────────────────────────────────────────────────────


def titre_de(page: dict) -> str:
    if page["type"] == "prix":
        # Pas d'article devant le métier : « plomberie » est féminin, « ménage »
        # masculin, « cours particuliers » pluriel — « prix d'un/une … » serait
        # faux pour la moitié du catalogue. La forme sans article est juste pour
        # les trois, et c'est le métier qui porte le sens.
        return f"{page['metier']['nom']} : prix et budgets annoncés — {MARQUE}"
    if page["type"] == "prix_ville":
        # La ville d'abord : c'est ce que la recherche nomme, et c'est ce qui
        # distingue cette page de son guide par métier.
        return f"Prix à {page['ville']['nom']} : budgets annoncés — {MARQUE}"
    return f"Comment choisir un artisan — {MARQUE}"


def description_de(page: dict, stats: dict) -> str:
    """La description PUBLIÉE, avec le nombre RÉEL de budgets mesurés.

    Le compte porte sur les budgets lisibles, pas sur les offres : annoncer
    « 120 budgets » sur une page qui n'en a mesuré aucun serait la donnée fausse
    que cette famille de pages existe pour éviter.
    """
    if page["type"] == "choisir":
        return (
            "Ce qu'il faut vérifier avant de payer un artisan : avis publiés "
            "après une mission terminée, proposition chiffrée, paiement retenu "
            "par séquestre, et ce qui se passe en cas de désaccord."
        )
    if page["type"] == "prix_ville":
        ville = page["ville"]["nom"]
        total = total_mesure(stats)
        if not total:
            return (
                f"Aucun budget annoncé à {ville} aujourd'hui. Ce qui fait "
                "varier le prix, métier par métier, et comment comparer deux "
                "propositions, sans montant inventé."
            )
        pluriel = "s" if total > 1 else ""
        return (
            f"{total} budget{pluriel} annoncé{pluriel} par des clients à "
            f"{ville}, métier par métier : fourchette et médiane mesurées sur "
            "les missions ouvertes dans la ville."
        )
    total = sum(entree["nombre"] for entree in stats.values())
    metier = page["metier"]["nom"].lower()
    if not total:
        return (
            f"Aucun budget annoncé en {metier} sur les missions ouvertes "
            "aujourd'hui. Ce qui fait varier le prix, et comment comparer deux "
            "propositions, sans montant inventé."
        )
    pluriel = "s" if total > 1 else ""
    return (
        f"{total} budget{pluriel} annoncé{pluriel} par des clients en {metier}, "
        f"dans {len(stats)} ville{'s' if len(stats) > 1 else ''} : fourchette et "
        "médiane mesurées sur les missions ouvertes, et ce qui fait varier le prix."
    )


def _intro(page: dict, stats: dict) -> str:
    if page["type"] == "prix_ville":
        ville = page["ville"]["nom"]
        total = total_mesure(stats)
        if not total:
            return (
                f"Aucun budget n'est annoncé aujourd'hui à {ville} sur une "
                "mission ouverte. Le guide reste utile : il dit ce qui fait "
                "varier le prix, métier par métier, et pourquoi un montant "
                f"retenu par séquestre change la discussion. Les montants "
                f"publiés ici viendront des missions réelles de {ville}, jamais "
                "d'une estimation — ni de ceux d'une ville voisine."
            )
        return (
            f"Les montants ci-dessous sont les budgets que des clients ont "
            f"ANNONCÉS à {ville} sur des missions ouvertes, au moment où cette "
            "page est servie. Ce n'est pas un prix de marché : c'est ce qu'un "
            "client a proposé avant de recevoir les propositions chiffrées des "
            "professionnels. Une ligne sans budget le dit, plutôt que d'hériter "
            "d'un chiffre venu d'une autre ville."
        )
    if page["type"] == "choisir":
        return (
            "Choisir un artisan sans le connaître repose sur trois choses "
            "vérifiables : ce qu'il a réellement fait, ce qu'il propose par écrit, "
            "et qui garde l'argent en attendant que le travail soit fait. Sur Kojo "
            "les avis ne sont publiés qu'après une mission terminée, la proposition "
            "porte un prix et une date, et le montant reste retenu par séquestre "
            "jusqu'à la validation — c'est ce qui permet de travailler avec "
            "quelqu'un qu'on ne connaît pas encore."
        )
    metier = page["metier"]["nom"].lower()
    total = sum(entree["nombre"] for entree in stats.values())
    if not total:
        return (
            f"Aucun budget n'est annoncé aujourd'hui sur une mission ouverte en "
            f"{metier}. Le guide reste utile : il dit ce qui fait varier le prix, "
            f"comment lire une proposition chiffrée, et pourquoi un montant "
            f"retenu par séquestre change la discussion. Les montants publiés ici "
            f"viendront des missions réelles, jamais d'une estimation."
        )
    return (
        f"Les montants ci-dessous sont les budgets que des clients ont ANNONCÉS "
        f"sur des missions ouvertes en {metier}, au moment où cette page est "
        "servie. Ce n'est pas un prix de marché : c'est ce qu'un client a proposé "
        "avant de recevoir les propositions chiffrées des professionnels. La "
        "fourchette dit l'ordre de grandeur, la médiane dit ce qui revient le plus "
        "souvent — et une ville sans budget publié le dit, plutôt que d'hériter "
        "d'un chiffre voisin."
    )


def _table_prix(page: dict, stats: dict) -> str:
    """Le tableau des budgets mesurés, ville par ville.

    Une ville sans budget n'est pas retirée : elle apparaît avec « aucun budget
    publié ». Un tableau qui ne montrerait que les villes mesurées ferait croire
    que le métier n'existe pas ailleurs.
    """
    if page["type"] != "prix" or not stats:
        return (
            '<p class="vide">Aucun budget annoncé pour le moment sur une mission '
            'ouverte. Les <a href="/jobs">offres en cours</a> sont ici.</p>'
        )
    lignes = [_ligne_prix(_esc(ville), stats[ville]) for ville in sorted(stats)]
    return (
        '<table class="prix"><caption>Budgets annoncés par des clients sur des '
        "missions ouvertes, par ville</caption>"
        "<thead><tr><th scope=\"col\">Ville</th><th scope=\"col\">Missions</th>"
        "<th scope=\"col\">Fourchette</th><th scope=\"col\">Médiane</th></tr></thead>"
        f"<tbody>{''.join(lignes)}</tbody></table>"
    )


def _montant(valeur: int, devise: str) -> str:
    """Un montant tel qu'on le lit en FCFA : « 25 000 FCFA ».

    `f"{valeur:,}"` produirait « 25,000 », qui se lit comme deux nombres
    décimaux séparés par une virgule. Les milliers sont groupés par une espace,
    et la devise suit parce qu'un montant sans unité n'engage rien.
    """
    return f"{int(valeur):,}".replace(",", " ") + f" {devise}"


def _ligne_prix(entete: str, entree: dict) -> str:
    """Une ligne du tableau — la MÊME forme pour la vue par ville et par métier.

    Deux formats écrits deux fois finiraient par divergeraient sur le cas
    limite : une seule valeur mesurée, où fourchette et médiane n'ont pas la
    même phrase.
    """
    devise = entree["devise"]
    fourchette = (
        _montant(entree["minimum"], devise)
        if entree["minimum"] == entree["maximum"]
        else f"{_montant(entree['minimum'], devise)} – "
        f"{_montant(entree['maximum'], devise)}"
    )
    mediane = (
        _montant(entree["mediane"], devise)
        if entree["mediane"] is not None
        else "trop peu de missions"
    )
    return (
        f'<tr><th scope="row">{entete}</th>'
        f'<td>{entree["nombre"]}</td>'
        f"<td>{_esc(fourchette)}</td>"
        f"<td>{_esc(mediane)}</td>"
        "</tr>"
    )


def _table_prix_ville(page: dict, stats: dict) -> str:
    """Le tableau d'une VILLE : une ligne par métier du catalogue.

    Toutes les lignes sortent, même sans budget : un tableau qui ne montrerait
    que les métiers mesurés ferait croire que la ville n'en compte que deux, et
    c'est exactement ce qu'une page locale doit éviter. La ligne vide DIT
    l'absence — elle ne la masque pas, et elle ne lui prête pas le chiffre d'un
    autre métier.
    """
    lignes = []
    for metier in pages_metier.PAGES_METIERS:
        entete = (
            f'<a href="{chemin_guide_prix(metier["slug"])}">'
            f'{_esc(metier["nom"])}</a>'
        )
        entree = stats.get(metier["slug"])
        if not entree:
            lignes.append(
                f'<tr><th scope="row">{entete}</th><td>—</td>'
                "<td>Aucun budget annoncé</td><td>—</td></tr>"
            )
            continue
        lignes.append(_ligne_prix(entete, entree))
    if stats.get(AUTRES):
        lignes.append(_ligne_prix("<strong>Autres métiers</strong>", stats[AUTRES]))
    ville = page["ville"]["nom"]
    return (
        '<table class="prix"><caption>Budgets annoncés par des clients à '
        f"{_esc(ville)}, sur des missions ouvertes dans la ville</caption>"
        "<thead><tr><th scope=\"col\">Métier</th><th scope=\"col\">Missions</th>"
        "<th scope=\"col\">Fourchette</th><th scope=\"col\">Médiane</th></tr></thead>"
        f"<tbody>{''.join(lignes)}</tbody></table>"
    )


def _sujet(page: dict) -> str:
    """Le complément qui porte la phrase : « en plomberie », « à Abidjan ».

    Un seul lieu décide de la formulation : recopier « en {métier} » dans le
    guide de ville produirait « en Abidjan », qui ne se lit pas.
    """
    if page["type"] == "prix":
        return f"en {page['metier']['nom'].lower()}"
    if page["type"] == "prix_ville":
        return f"à {page['ville']['nom']}"
    return "quand on choisit un artisan"


def _variations(page: dict) -> list:
    """Ce qui fait varier le prix — vrai d'un métier à l'autre, sans montant."""
    sujet = _sujet(page)
    return [
        (
            "La quantité de travail",
            f"Un dépannage ponctuel et une installation complète ne se comparent "
            f"pas. Décrivez la surface, le nombre de pièces ou d'éléments à traiter : "
            f"c'est ce qui fait la différence entre deux propositions {sujet}.",
        ),
        (
            "L'urgence et le déplacement",
            "Une intervention le jour même, ou en dehors des heures habituelles, "
            "coûte plus qu'une date choisie. Le déplacement compte aussi : un "
            "professionnel qui vient de loin l'intègre dans son prix.",
        ),
        (
            "Les matériaux et l'accès",
            "Fournir le matériel ou le faire fournir change le montant, et un "
            "chantier difficile d'accès (étage, cour étroite, coupure d'eau à "
            "organiser) demande plus de temps.",
        ),
    ]


def _verifications() -> list:
    return [
        (
            "Ce qu'il a réellement fait",
            "Les avis de Kojo ne sont publiés qu'après une mission terminée : un "
            "profil se juge sur du travail accompli, pas sur une promesse. Lisez "
            "le nombre de missions et les avis, pas seulement la note.",
        ),
        (
            "Ce qu'il propose par écrit",
            "Une proposition chiffrée porte un prix et une date. Une fourchette "
            "orale n'engage personne : demandez ce qui est inclus, ce qui ne l'est "
            "pas, et ce qui arrive en cas d'imprévu.",
        ),
        (
            "Qui garde l'argent",
            "Sur Kojo le montant est retenu par séquestre et versé après validation "
            "de la mission. Un artisan qui demande un paiement direct hors "
            "plateforme vous fait perdre cette protection, et le recours avec.",
        ),
        (
            "Ce qui se passe en cas de désaccord",
            "Un litige s'ouvre depuis la mission, avec un motif, et gèle le "
            "paiement ; une décision tombe sous 5 jours. Un accord amiable reste "
            "possible : celui qui a ouvert le litige peut le retirer.",
        ),
    ]


def _liens_internes(page: dict) -> str:
    """Le maillage : guide → métier, guide → villes, guide → guides, et l'offre.

    Les 13 guides de ville sont liés DEPUIS chaque guide : sans ce bloc, ils ne
    seraient atteignables que par le sitemap, et une page que seul un sitemap
    connaît est une page que le crawl visite rarement.
    """
    metiers = "".join(
        f'<li><a href="{chemin_metier(m["slug"])}">{_esc(m["nom"])}</a></li>'
        for m in pages_metier.PAGES_METIERS
    )
    # Les guides de VILLE ne sont pas répétés ici : ils ont leur bloc
    # (« Prix par ville »), et deux fois la même liste sur une page se lit comme
    # deux listes différentes à parcourir.
    autres = "".join(
        f'<li><a href="{chemin_guide(autre["slug"])}">{_esc(autre["nom"])}</a></li>'
        for autre in PAGES_GUIDES
        if autre["slug"] != page["slug"] and autre["type"] != "prix_ville"
    )
    sienne = (page.get("ville") or {}).get("slug")
    villes = "".join(
        f'<li><a href="{chemin_guide_prix_ville(v["slug"])}">{_esc(v["nom"])}</a></li>'
        for v in pages_metier.PAGES_VILLES
        if v["slug"] != sienne
    )
    # Pas de bloc « offres de la ville » sur un guide de ville : le bouton
    # d'action mène déjà à la même page, et deux liens identiques se lisent comme
    # deux endroits différents.
    return (
        '<div class="maillage">'
        f'<section><h2>Métiers</h2><ul>{metiers}</ul></section>'
        f"<section><h2>Prix par ville</h2><ul>{villes}</ul></section>"
        f'<section><h2>Autres guides</h2><ul>{autres}</ul></section>'
        "</div>"
    )


def _json_ld(page: dict, url: str) -> str:
    """`Article` : ce qu'un guide EST, pour un moteur de recherche.

    Pas de `datePublished` : aucune date de publication n'est stockée, et une
    date inventée serait une fraîcheur annoncée sans mesure.
    """
    donnees = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": titre_de(page),
        "name": page["nom"],
        "url": url,
        "inLanguage": "fr",
        "author": {"@type": "Organization", "name": MARQUE},
        "publisher": {"@type": "Organization", "name": MARQUE},
        "isPartOf": {"@type": "WebSite", "name": MARQUE, "url": url.split("/guides/")[0]},
        "about": _sujet_jsonld(page),
    }
    return seed_json(donnees)


def _sujet_jsonld(page: dict) -> dict:
    """Ce dont le guide PARLE, dans le vocabulaire d'un moteur.

    Un guide de ville porte une `Place` (nommée, dans son pays) ; un guide de
    métier un `Service`. Déclarer un `Service` sur une page de ville ferait
    décrire une offre qui n'y est pas.
    """
    if page["type"] == "prix":
        return {"@type": "Service", "name": page["metier"]["nom"]}
    if page["type"] == "prix_ville":
        ville = page["ville"]
        return {
            "@type": "Place",
            "name": ville["nom"],
            "address": {
                "@type": "PostalAddress",
                "addressCountry": ville.get("pays_nom") or ville.get("pays") or "",
            },
        }
    return {"@type": "Thing", "name": "Choisir un artisan"}


GUIDES_STYLE = """
.prix{width:100%;border-collapse:collapse;margin:.5rem 0 1.5rem;background:#fff;
border:1px solid var(--trait);border-radius:.5rem;overflow:hidden;font-size:.95rem}
.prix caption{text-align:left;padding:.75rem 1rem;color:#57534e;font-size:.9rem;
border-bottom:1px solid var(--trait)}
.prix th,.prix td{padding:.6rem .8rem;text-align:left;border-bottom:1px solid var(--trait)}
.prix thead th{background:var(--sable);font-weight:600;font-size:.85rem;
text-transform:uppercase;letter-spacing:.02em;color:#57534e}
.prix tbody th{font-weight:600}
.prix tbody tr:last-child th,.prix tbody tr:last-child td{border-bottom:0}
.bloc{background:#fff;border:1px solid var(--trait);border-radius:.5rem;
padding:1rem 1.15rem;margin:0 0 1rem}
.bloc h3{margin:0 0 .35rem;font-size:1.2rem}
.bloc p{margin:0;font-size:.95rem;color:#44403c}
"""


def document(page: dict, origine: str, missions: list) -> str:
    """Le document HTML complet d'un guide.

    `origine` est l'origine publique du SITE (sans barre finale) : canonical,
    og:url et JSON-LD en sortent, donc une URL relative ne peut pas se résoudre
    contre l'hôte de l'API.
    """
    base = origine.rstrip("/")
    url = f"{base}{chemin_guide(page['slug'])}"
    genus = page["type"]
    if genus == "prix":
        stats = stats_par_ville(missions)
    elif genus == "prix_ville":
        stats = stats_par_metier(missions)
    else:
        stats = {}
    titre = titre_de(page)
    description = description_de(page, stats)
    if genus == "prix":
        h1 = f"{page['metier']['nom']} : combien ça coûte ?"
    elif genus == "prix_ville":
        h1 = f"Combien coûtent les travaux à {page['ville']['nom']} ?"
    else:
        h1 = "Comment choisir un artisan"

    blocs_variations = "".join(
        f'<div class="bloc"><h3>{_esc(t)}</h3><p>{_esc(p)}</p></div>'
        for t, p in _variations(page)
    )
    blocs_verifications = "".join(
        f'<div class="bloc"><h3>{_esc(t)}</h3><p>{_esc(p)}</p></div>'
        for t, p in _verifications()
    )

    if genus == "prix":
        section_mesure = (
            f"<h2>Budgets annoncés, ville par ville</h2>{_table_prix(page, stats)}"
        )
        cta = '<a class="cta" href="/jobs">Voir les missions ouvertes</a>'
        suite = f'<h2>Ce qui fait varier le prix</h2>{blocs_variations}'
    elif genus == "prix_ville":
        ville = page["ville"]
        section_mesure = (
            "<h2>Budgets annoncés, métier par métier</h2>"
            f"{_table_prix_ville(page, stats)}"
        )
        cta = (
            f'<a class="cta" href="{pages_metier.chemin_ville(ville["slug"])}">'
            f"Voir les missions ouvertes à {_esc(ville['nom'])}</a>"
        )
        suite = (
            f'<h2>Ce qui fait varier le prix</h2>{blocs_variations}'
            f"<h2>Ce qui se vérifie avant de payer</h2>{blocs_verifications}"
        )
    else:
        section_mesure = ""
        cta = '<a class="cta" href="/jobs">Chercher un professionnel</a>'
        suite = f"<h2>Ce qui se vérifie avant de payer</h2>{blocs_verifications}"

    exemples = ""
    if genus == "prix":
        cartes = "".join(_carte(m) for m in missions[:MAX_EXEMPLES])
        if cartes:
            exemples = (
                f'<h2>Missions ouvertes en {_esc(page["metier"]["nom"].lower())}</h2>'
                f'<ul class="offres">{cartes}</ul>'
            )
    elif genus == "prix_ville":
        cartes = "".join(_carte(m) for m in missions[:MAX_EXEMPLES])
        if cartes:
            exemples = (
                f'<h2>Missions ouvertes à {_esc(page["ville"]["nom"])}</h2>'
                f'<ul class="offres">{cartes}</ul>'
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
        '<meta property="og:type" content="article" />\n'
        f'<meta property="og:site_name" content="{MARQUE}" />\n'
        f'<meta property="og:title" content="{_esc(titre)}" />\n'
        f'<meta property="og:description" content="{_esc(description)}" />\n'
        f'<meta property="og:url" content="{_esc(url)}" />\n'
        f'<meta property="og:image" content="{_esc(base)}/og-image.png" />\n'
        '<meta name="twitter:card" content="summary_large_image" />\n'
        f'<meta name="twitter:title" content="{_esc(titre)}" />\n'
        f'<meta name="twitter:description" content="{_esc(description)}" />\n'
        f"{pages_metier.balise_csp()}{pages_metier.ENTETES_POLICES}"
        f"<style>{STYLE}{GUIDES_STYLE}</style>\n"
        f'<script type="application/ld+json">{_json_ld(page, url)}</script>\n'
        "</head>\n<body>\n"
        # L'en-tête vient de `kojo_pages_metier` : la marque et les langues du
        # site sont écrites UNE fois pour les 45 pages servies par le backend
        # (villes, métiers, guides), sinon la moitié aurait un logo et l'autre
        # pas — c'est exactement le défaut que ce module a déjà fermé pour les
        # classes et les libellés.
        f"{pages_metier._en_tete()}"
        "<main>\n"
        f"<h1>{_esc(h1)}</h1>\n"
        f'<p class="intro">{_esc(_intro(page, stats))}</p>\n'
        f"{cta}\n"
        f"{section_mesure}\n"
        f"{suite}\n"
        f"{exemples}\n"
        f"{_liens_internes(page)}\n"
        "</main>\n"
        f'<footer>Kojo — missions et emplois de proximité en Afrique de '
        f"l'Ouest. <a href=\"/jobs\">Toutes les offres</a> · "
        f'<a href="/about">À propos</a> · <a href="/contact">Contact</a></footer>\n'
        "</body>\n</html>\n"
    )


def document_introuvable(origine: str) -> str:
    """404 d'un guide inconnu : `noindex`, aucun contenu inventé."""
    base = origine.rstrip("/")
    return (
        '<!DOCTYPE html>\n<html lang="fr">\n<head>\n'
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        "<title>Page introuvable — Kojo</title>\n"
        '<meta name="robots" content="noindex, follow" />\n'
        f'<link rel="canonical" href="{_esc(base)}/jobs" />\n'
        f"{pages_metier.balise_csp()}{pages_metier.ENTETES_POLICES}<style>{STYLE}</style>\n"
        "</head>\n<body>\n"
        f"{pages_metier._en_tete()}<main>\n"
        "<h1>Ce guide n'existe pas</h1>\n"
        '<p class="intro">Aucun guide ne porte ce nom sur Kojo. Les offres '
        'ouvertes sont <a href="/jobs">ici</a>.</p>\n'
        "</main>\n</body>\n</html>\n"
    )
