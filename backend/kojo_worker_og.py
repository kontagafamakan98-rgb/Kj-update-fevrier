# -*- coding: utf-8 -*-
"""Page HTML PRÉ-RENDUE d'un profil public de travailleur (/workers/:id).

POURQUOI CE MODULE EXISTE SÉPARÉMENT — la même raison que `kojo_job_og.py`, et
la même frontière :

  • ce que lit un crawler de partage ou un moteur (Facebook, LinkedIn, WhatsApp,
    Google) ne dépend d'aucun JavaScript : le document servi doit porter
    lui-même le titre, la description, le canonical et les cartes ;
  • le contrat app ↔ pré-rendu doit être vérifiable SANS serveur et SANS base,
    donc ce module n'importe ni FastAPI, ni MongoDB, ni `kojo_settings`. Il est
    importé par `frontend/scripts/check-worker-og-contract.js` avec un
    interpréteur Python quelconque, dans un job où seules les dépendances npm
    sont installées.

Ce que ce fichier publie, et ce qu'il ne peut PAS publier : il ne reçoit QUE la
vue publique déjà construite par `kojo_routers_workers_public` (allowlist champ
par champ). Il n'a donc aucun accès au document utilisateur, et ne peut pas
laisser fuir un email, un téléphone ou une position : il n'en a pas.

LES DEUX LANGAGES FORMENT UNE PAIRE. Le titre et la description sont calculés
ici (Python) et dans `frontend/src/utils/workerSeo.js` (JavaScript) : c'est
exactement cette paire que `scripts/check-worker-og-contract.js` compare sur des
profils de référence — dont des textes à caractères astraux à la frontière de la
coupe. Aucune des deux copies ne peut donc bouger seule, et la coupe se compte en
POINTS DE CODE des deux côtés (voir `DESCRIPTION_LIMIT` dans `kojo_job_og.py`).

LE DOCUMENT DÉMARRE AUSSI L'APPLICATION (21/10/2026). Jusqu'ici un visiteur à
froid sur `/workers/:id` recevait le document statique et RIEN d'autre : ni
châssis, ni navigation, ni bouton, ni avis cliquables — le prix, assumé, d'un
contenu lisible sans JavaScript. Le prix était trop cher, parce que c'était le
seul chemin d'arrivée d'un lien partagé. Le document publie donc désormais deux
chemins STABLES du build — `/boot/worker-boot.js` (qui importe l'entrée hachée
des pages) et `/boot/worker-app.css` (copie de la feuille servie) — produits par
`frontend/vite-plugins/worker-boot.js`, ainsi qu'un bloc de DONNÉES (la vue
publique déjà rendue) que React reprend comme état initial : le profil s'affiche
sans squelette, puis la page relit l'API. Les trois noms sont confrontés au
déclaratif du frontend (`POINT_ENTREE_TRAVAILLEUR` dans `scripts/site-meta.js`)
par le contrat hors ligne, jamais recopiés en silence.

Ce que ce fichier ne fait PAS : il n'ajoute aucune donnée. Le bloc de données
est la vue que `kojo_routers_workers_public.profil_public` a déjà construite
(allowlist champ par champ) — le pré-rendu ne reçoit rien d'autre, donc il ne
peut pas publier un email, un téléphone ou une position qu'il n'a pas.

LA CSP DU SITE Y EST PUBLIÉE DEPUIS LE 22/10/2026. Les pages du build la
reçoivent de `vite-plugins/inject-production-csp.js` ; ce document-ci n'est pas
une page du build, et il n'en portait donc aucune — un lien partagé ouvrait un
profil qui démarre l'application sans la politique du site. La déclaration
unique vit dans `frontend/src/config/csp.js` ; `kojo_csp` en est la copie
Python (stdlib, sans `kojo_settings`, comme ce module), confrontée octet pour
`octet par `frontend/scripts/check-csp-contract.js`, et la sonde de production
compare la politique SERVIE ici à celle que le site sert.
"""

# Les chemins STABLES que le document cite viennent de `kojo_job_og` : c'est
# l'APPLICATION (une entrée, une feuille), pas une page, et la fiche mission
# cite donc les mêmes fichiers. Les DUPLIQUER ici ferait deux déclarations à
# garder d'accord — et le contrat hors ligne n'en compare qu'une par document.
# Seul l'identifiant du bloc de données est propre à ce document : il doit être
# IDENTIQUE à `POINT_ENTREE_TRAVAILLEUR` (scripts/site-meta.js), sinon le
# renommage d'un seul côté ferait lire un bloc absent (profil qui démarre par un
# squelette, alors que la vue était déjà rendue).
from kojo_csp import balise_csp
from kojo_job_og import (
    BOOT_SCRIPT,
    BOOT_STYLE,
    DESCRIPTION_LIMIT,
    balise_seed,
    escape_xml,
    point_entree_balises,
    seed_json,
)

SEED_ID = "kojo-worker-data"

# Replis : le MÊME texte des deux côtés (workerSeo.js). Un profil sans nom, sans
# bio, sans compétence, sans avis et sans ville n'a rien à dire — mais une balise
# vide se lit comme une page cassée par un crawler comme par un visiteur.
FALLBACK_TITLE = "Travailleur — Kojo"
# Apostrophe TYPOGRAPHIQUE (U+2019) : la copie publiée du site n'en admet pas
# d'autre (`frontend/scripts/published-copy.js`), et la chaîne doit être
# IDENTIQUE à celle de `frontend/src/utils/workerSeo.js` — le contrat hors ligne
# compare les deux octet pour octet.
FALLBACK_DESCRIPTION = (
    "Profil d’un travailleur sur Kojo : missions terminées, avis et compétences."
)

# Trois compétences suffisent dans une description : au-delà, la phrase devient
# une liste de mots-clés et la coupe à 150 points de code la tronque de toute
# façon.
MAX_COMPETENCES_DESCRIPTION = 3


def _texte(valeur, maximum=None):
    """Chaîne nettoyée, ou '' — jamais un type inattendu rendu tel quel."""
    if valeur is None or isinstance(valeur, bool):
        return ""
    texte = str(valeur).strip()
    if maximum is not None:
        return texte[:maximum]
    return texte


def _competences(worker, maximum):
    """Les compétences publiables, bornées — une valeur non-liste rend []."""
    brut = worker.get("skills")
    if not isinstance(brut, list):
        return []
    sortie = []
    for element in brut:
        texte = _texte(element)
        if texte:
            sortie.append(texte)
        if len(sortie) >= maximum:
            break
    return sortie


def _note(valeur):
    """Note à une décimale, sans « .0 » — le MÊME rendu qu'en JavaScript.

    `4.7` → « 4.7 », `5.0` → « 5 ». La valeur est déjà arrondie à une décimale
    par le routeur ; ce formatage ne fait que retirer la décimale nulle, ce qui
    garde les deux langages comparables (le contrat hors ligne les confronte).
    """
    try:
        nombre = round(float(valeur), 1)
    except (TypeError, ValueError):
        return ""
    texte = f"{nombre:.1f}"
    return texte[:-2] if texte.endswith(".0") else texte


def nom_complet(worker):
    """Prénom et nom publiés, joints — '' si le profil n'en publie aucun."""
    morceaux = [_texte(worker.get("first_name")), _texte(worker.get("last_name"))]
    return " ".join(morceau for morceau in morceaux if morceau).strip()


def worker_seo_title(worker):
    """Titre du document : nom, métier (première compétence), puis « Kojo »."""
    nom = nom_complet(worker)
    if not nom:
        return FALLBACK_TITLE
    competences = _competences(worker, 1)
    metier = competences[0] if competences else "Travailleur"
    return f"{nom} — {metier} — Kojo"


def worker_seo_description(worker):
    """Description publiée : bio, compétences, réputation, lieu — dans cet ordre.

    Coupe à `DESCRIPTION_LIMIT` POINTS DE CODE suivie de « … », exactement comme
    la fiche mission : un crawler tronque sinon au milieu d'une phrase. Le
    compte est celui de Python (`len`, des points de code) et celui de
    `Array.from` côté JavaScript — jamais `slice`/`length`, qui comptent des
    unités UTF-16 et publieraient un demi-caractère dans la balise.
    """
    morceaux = []

    bio = _texte(worker.get("bio"))
    if bio:
        morceaux.append(bio)

    competences = _competences(worker, MAX_COMPETENCES_DESCRIPTION)
    if competences:
        morceaux.append("Compétences : " + ", ".join(competences))

    stats = worker.get("stats") if isinstance(worker.get("stats"), dict) else {}
    note = stats.get("rating_average")
    nombre_avis = stats.get("rating_count")
    try:
        nombre_avis = int(nombre_avis or 0)
    except (TypeError, ValueError):
        nombre_avis = 0
    if isinstance(note, (int, float)) and not isinstance(note, bool) and nombre_avis > 0:
        morceaux.append(f"{_note(note)}/5 sur {nombre_avis} avis")

    try:
        missions = int(stats.get("missions_completed") or 0)
    except (TypeError, ValueError):
        missions = 0
    if missions > 0:
        pluriel = "s" if missions > 1 else ""
        morceaux.append(f"{missions} mission{pluriel} terminée{pluriel}")

    # La VILLE seulement, jamais le pays : `country` stocke une CLÉ machine
    # (« senegal », normalisée par le formulaire), et une carte de partage qui
    # imprime « Dakar, senegal » se lit comme un brouillon. Le libellé du pays
    # demanderait une table de correspondance tenue dans les deux langages —
    # donc une paire de plus à faire diverger, pour un mot que la ville dit
    # déjà.
    ville = _texte(worker.get("city"))
    if ville:
        morceaux.append(ville)

    texte = " · ".join(morceaux).strip()
    if not texte:
        return FALLBACK_DESCRIPTION
    if len(texte) > DESCRIPTION_LIMIT:
        return texte[:DESCRIPTION_LIMIT] + "…"
    return texte


def worker_meta_lines(worker):
    """Les deux lignes d'appui (carte OG et page) : réputation, puis lieu/métier.

    Elles ne sont PAS le titre ni la description : ce sont les chiffres qu'un
    client cherche d'un coup d'œil (note, missions, ville, compétences). La
    carte Open Graph les grave, donc la page pré-rendue les publie aussi — un
    crawler qui lit le document doit trouver ce que la carte annonce.
    """
    stats = worker.get("stats") if isinstance(worker.get("stats"), dict) else {}
    note = stats.get("rating_average")
    try:
        nombre_avis = int(stats.get("rating_count") or 0)
    except (TypeError, ValueError):
        nombre_avis = 0

    if isinstance(note, (int, float)) and not isinstance(note, bool) and nombre_avis > 0:
        principale = f"{_note(note)}/5 · {nombre_avis} avis"
    else:
        try:
            missions = int(stats.get("missions_completed") or 0)
        except (TypeError, ValueError):
            missions = 0
        if missions > 0:
            pluriel = "s" if missions > 1 else ""
            principale = f"{missions} mission{pluriel} terminée{pluriel}"
        else:
            principale = "Nouveau profil"

    secondaire = " · ".join(
        morceau
        for morceau in (
            _texte(worker.get("city")),
            ", ".join(_competences(worker, MAX_COMPETENCES_DESCRIPTION)),
        )
        if morceau
    )
    return principale, secondaire


def worker_og_html(worker: dict, base: str) -> str:
    """HTML pré-rendu d'un profil /workers/:id — lisible sans JS, exécutable avec.

    Même forme que la fiche mission pour la tête : méta (titre, description,
    canonical, cartes wide + carrée) et un `<h1>` statique dans `#root`, ce qu'un
    crawler lit. Depuis le 21/10/2026, la page porte EN PLUS le point d'entrée du
    build et le bloc de données de la vue publique : un visiteur à froid obtient
    aussi l'application (châssis, navigation, avis), React reprenant le profil
    déjà rendu au lieu de le remplacer par un squelette.
    """
    worker_id = str(worker.get("id") or "")
    nom = nom_complet(worker) or "Travailleur"
    title = worker_seo_title(worker)
    desc = worker_seo_description(worker)
    principale, secondaire = worker_meta_lines(worker)
    url = f"{base}/workers/{escape_xml(worker_id)}"
    wide = f"{base}/api/og/workers/{escape_xml(worker_id)}.png"
    square = f"{base}/api/og/workers/{escape_xml(worker_id)}-square.png"
    t = escape_xml(title)
    d = escape_xml(desc)
    corps = (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        # La politique AVANT toute ressource : elle s'applique au premier script
        # que le document cite, pas après coup.
        + balise_csp()
        + f"<title>{t}</title>\n"
        f"<meta name=\"description\" content=\"{d}\" />\n"
        "<meta name=\"robots\" content=\"index, follow\" />\n"
        f"<link rel=\"canonical\" href=\"{url}\" />\n"
        "<meta property=\"og:type\" content=\"profile\" />\n"
        f"<meta property=\"og:url\" content=\"{url}\" />\n"
        f"<meta property=\"og:title\" content=\"{t}\" />\n"
        f"<meta property=\"og:description\" content=\"{d}\" />\n"
        f"<meta property=\"og:image\" content=\"{wide}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"630\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        f"<meta property=\"og:image\" content=\"{square}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"1200\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        "<meta property=\"og:locale\" content=\"fr_FR\" />\n"
        "<meta property=\"og:site_name\" content=\"Kojo\" />\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\" />\n"
        f"<meta name=\"twitter:url\" content=\"{url}\" />\n"
        f"<meta name=\"twitter:title\" content=\"{t}\" />\n"
        f"<meta name=\"twitter:description\" content=\"{d}\" />\n"
        f"<meta name=\"twitter:image\" content=\"{wide}\" />\n"
        # Le CSS d'abord : il bloque le premier rendu, donc le profil n'est
        # jamais peint ni nu ni « habillé après coup ». Le module est différé.
        + point_entree_balises()
        + "</head>\n<body>\n"
        "<div id=\"root\">\n"
        "<div class=\"h-16 bg-white border-b border-gray-200\"></div>\n"
        "<div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8\">\n"
        f"<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">{escape_xml(nom)}</h1>\n"
        f"<p class=\"text-lg text-gray-700\">{escape_xml(principale)}</p>\n"
        + (
            f"<p class=\"text-base text-gray-600\">{escape_xml(secondaire)}</p>\n"
            if secondaire
            else ""
        )
        # `</div>` ferme le conteneur max-w-7xl, le second ferme `#root` : le
        # bloc de données doit venir APRÈS les deux (voir juste en dessous).
        + "</div>\n</div>\n"
        # HORS de `#root` : React efface le contenu de ce conteneur au montage,
        # donc un bloc placé dedans disparaîtrait avant d'être lu par la page.
        + balise_seed(SEED_ID, worker)
        + "</body>\n</html>\n"
    )
    return corps


def worker_og_html_404() -> str:
    """HTML neutre pour un profil inconnu — explicite noindex, comme la fiche.

    Il porte le MÊME point d'entrée que la fiche : un lien partagé devenu mort
    ouvre alors l'application (châssis, navigation, page « introuvable » de
    l'app) au lieu d'un texte nu sans issue. `noindex` reste, évidemment : c'est
    l'INDEXATION qui est refusée, pas la navigation.
    """
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        # La 404 démarre AUSSI l'application : elle porte donc la même politique.
        + balise_csp()
        + "<title>Travailleur introuvable — Kojo</title>\n"
        "<meta name=\"robots\" content=\"noindex, nofollow\" />\n"
        + point_entree_balises()
        + "</head>\n<body>\n<div id=\"root\"></div>\n</body>\n</html>\n"
    )
