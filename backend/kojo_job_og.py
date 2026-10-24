# -*- coding: utf-8 -*-
"""Page HTML PRÉ-RENDUE d'une fiche mission (/jobs/:id) — stdlib uniquement.

POURQUOI CE MODULE EXISTE SÉPARÉMENT : cette page est ce que lit un crawler de
partage (Facebook, LinkedIn, WhatsApp), qui n'exécute pas JavaScript. Elle doit
donc annoncer EXACTEMENT ce que l'application annonce pour la même mission —
titre, description, carte — et ce contrat n'était vérifié qu'en HTTP, contre un
serveur en marche et une mission réellement créée en base.

Le contrat est maintenant vérifiable SANS serveur :
frontend/scripts/check-job-og-contract.js importe ce module avec un interpréteur
Python quelconque et confronte son HTML à ce que l'application déclare pour la
même mission (frontend/src/utils/jobSeo.js). C'est ce qui fixe la frontière de ce
fichier — il n'importe ni FastAPI, ni MongoDB, ni kojo_settings, sinon il ne
s'IMPORTERAIT pas dans le job frontend, où seules les dépendances npm sont
installées. Ce n'est pas un goût pour les petits fichiers.

L'échappement XML vit ici pour la même raison : la page l'utilise, le sitemap
l'utilise aussi, et deux copies divergeraient en silence.

LE DOCUMENT DÉMARRE AUSSI L'APPLICATION (21/10/2026). Il était lisible et
inerte : un lien partagé — qui est le SEUL chemin d'arrivée d'un visiteur à
froid — ouvrait une page sans châssis, sans navigation et sans bouton. Le
document publie donc désormais les deux chemins STABLES du build (`BOOT_SCRIPT`,
`BOOT_STYLE` — produits par `frontend/vite-plugins/worker-boot.js`) et un bloc
de DONNÉES (`SEED_ID`) que `JobDetails` reprend comme état initial : la fiche
s'affiche sans squelette, puis la page relit l'API.

CE QUE LE BLOC PEUT PORTER, ET RIEN DE PLUS : il reçoit la vue PUBLIQUE que
`GET /jobs/:id` rend déjà à un visiteur anonyme (`JobPublic`, allowlist de
`kojo_models`) — le routeur la lui passe, ce module ne la construit pas. Il ne
peut donc pas publier des coordonnées GPS, un `client_id` ou un `disburse_token`
qu'il n'a jamais reçus, et la carte de partage ne grave pas ce que l'API cache.
"""

import json
from datetime import date, datetime, timedelta, timezone

# LA CSP DU SITE, pour les documents que ce module écrit (22/10/2026).
#
# Les pages du build la reçoivent de `frontend/vite-plugins/inject-production-csp.js` ;
# ce document-ci n'est pas une page du build, et il n'en portait donc aucune :
# un lien partagé — le SEUL chemin d'arrivée d'un visiteur à froid — ouvrait une
# page qui démarre l'application SANS la politique que le reste du site
# applique. La déclaration unique vit dans `frontend/src/config/csp.js` ;
# `kojo_csp` en est la copie Python, confrontée octet pour octet par
# `frontend/scripts/check-csp-contract.js`, et la sonde de production refuse une
# divergence entre ce que le site sert et ce que ce document sert.
from kojo_csp import balise_csp


# La coupe de la description, en POINTS DE CODE — et c'est le SEUL endroit qui la
# fixe côté Python : la fiche travailleur (`kojo_worker_og.py`) importe cette
# valeur, sinon deux pages couperaient à deux longueurs. La copie JavaScript vit
# dans `frontend/src/utils/jobSeo.js` (`DESCRIPTION_LIMIT`) et les deux sont
# confrontées par les gardes de contrat hors ligne.
DESCRIPTION_LIMIT = 150


def couper_description(texte: str) -> str:
    """La description PUBLIÉE d'une fiche : coupée sur le dernier ESPACE.

    MESURÉ le 24/10/2026 sur /jobs/c7b740c2-1be5-40c8-a1f3-f2fec7c807aa : la
    balise annonçait « … Il faut localiser la fuite, remplacer le. » — les 150
    premiers points de code, donc un mot tranché en deux et une phrase qui finit
    sur un article. Un moteur qui affiche cette phrase la cite telle quelle.

    La règle, écrite à l'IDENTIQUE dans `frontend/src/utils/jobSeo.js` : prendre
    les `DESCRIPTION_LIMIT` premiers POINTS DE CODE (pas des unités UTF-16 : un
    emoji hors BMP en vaut deux en JavaScript), puis RECULER jusqu'au dernier
    espace de cette tranche — coupe dure seulement s'il n'y en a aucun, et sur
    le PREMIER caractère l'espace ne compte pas (reculer à zéro publierait le
    seul « … »). Un texte plus court que la limite est rendu tel quel, sans « … ».
    """
    points = list(texte)
    if len(points) <= DESCRIPTION_LIMIT:
        return texte
    tranche = "".join(points[:DESCRIPTION_LIMIT])
    espace = tranche.rfind(" ")
    if espace > 0:
        tranche = tranche[:espace]
    return tranche + "…"


# ── Le bloc `JobPosting`, pour Google Jobs (24/10/2026) ──────────────────────
# MESURÉ le 24/10/2026 sur la fiche ci-dessus : `JobPosting` → 0 occurrence,
# `application/ld+json` → 0. La fiche était donc invisible pour Google Jobs —
# le canal d'acquisition gratuit le plus direct d'une place de marché —, alors
# que tout ce qu'il demande est déjà dans le document.
#
# ICI ET NULLE PART AILLEURS : ce document est le seul qu'un crawler lit SANS
# exécuter JavaScript. Un JSON-LD injecté par React n'existerait que pour un
# moteur qui exécute le JS — c'est-à-dire pas celui qui décide de l'indexation.
#
# CE QUI N'Y ENTRE PAS, ET POURQUOI : `baseSalary` (un budget de mission n'est
# pas un salaire — l'inventer serait publier une donnée fausse), `directApply`
# (la candidature exige un compte, donc l'affirmer serait faux), et aucun champ
# qui ne soit pas déjà dans la vue publique `JobPublic`.
IDENTIFIANT_ORGANISATION = "Kojo"
LOGO_ORGANISATION = "/icons/icon-512x512.png"
# Durée de validité par DÉFAUT quand la mission n'a pas d'échéance : la même
# pour toutes, pour qu'un moteur ne voie pas deux annonces identiques expirer à
# deux dates. Une échéance déclarée par le client l'emporte toujours.
VALIDITE_JOURS = 30


# ── Le point d'entrée STABLE du document, et son bloc de données ────────────
# Les deux chemins sont ceux de l'APPLICATION, pas d'une page : le fichier de
# boot n'est qu'une importation de l'entrée hachée que chargent déjà toutes les
# pages, et la feuille est une copie de celle que le build sert
# (`frontend/vite-plugins/worker-boot.js`). Le document du PROFIL
# (`kojo_worker_og.py`) cite donc les MÊMES deux fichiers, et c'est importé de
# là-bas : une seconde copie de la feuille dans l'artefact ne servirait qu'à
# vieillir séparément. Seul le BLOC DE DONNÉES est propre à chaque document.
#
# Ces valeurs doivent être IDENTIQUES à `POINT_ENTREE_MISSION`
# (`frontend/scripts/site-meta.js`, qui réexpose `src/config/apercu-mission.js`) :
# le contrat hors ligne compare les deux déclarations sur chaque mission de
# référence, sinon un renommage d'un seul côté publierait un document qui pointe
# vers un 404 — une fiche statique, application jamais démarrée.
BOOT_SCRIPT = "/boot/worker-boot.js"
BOOT_STYLE = "/boot/worker-app.css"
SEED_ID = "kojo-job-data"


def escape_xml(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _json_defaut(valeur):
    """Date → ISO 8601 ; tout le reste en texte, jamais une exception au rendu.

    La vue publique porte des `posted_at`/`deadline` qui peuvent être un
    datetime (écrit par l'application) ou une chaîne (document importé). Une
    sérialisation qui lèverait sur l'un des deux viderait le bloc de données
    d'une fiche, et la page retomberait sur son squelette — exactement ce que ce
    bloc existe pour éviter.
    """
    if isinstance(valeur, (datetime, date)):
        return valeur.isoformat()
    return str(valeur)


def seed_json(donnees) -> str:
    """Le bloc de données du document — JSON sûr DANS une balise `<script>`.

    `<`, `>` et `&` sont écrits en échappements Unicode : sans eux, une
    description contenant la chaîne de fermeture d'un script refermerait la
    balise et le reste de la fiche deviendrait du BALISAGE — la faille la plus
    classique d'un bloc de données JSON, et le texte est écrit par des
    utilisateurs. U+2028/U+2029 sont échappés pour la même raison qu'en
    JavaScript classique : ce sont des séparateurs de ligne pour un analyseur
    qui ne connaît pas `JSON.parse`.

    L'échappement ne produit QUE de l'ASCII dans ce qu'il touche : les
    caractères accentués et astraux restent tels quels (document UTF-8).
    """
    texte = json.dumps(
        donnees, ensure_ascii=False, separators=(",", ":"), default=_json_defaut
    )
    return (
        texte.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def point_entree_balises() -> str:
    """Feuille (bloquante) puis point d'entrée (module, différé) — dans cet ordre.

    La feuille est liée dans la TÊTE et bloque le premier rendu : c'est ce qui
    évite qu'un visiteur voie la fiche en texte brut puis « habillée » (et
    qu'une application démarrée sans style se lise comme une page cassée). Le
    module est dans la tête aussi, pour que le navigateur découvre l'entrée en
    même temps que le document ; un module est différé par nature, il ne bloque
    donc pas l'analyse.
    """
    return (
        f'<link rel="stylesheet" href="{BOOT_STYLE}" />\n'
        f'<script type="module" src="{BOOT_SCRIPT}"></script>\n'
    )


def balise_seed(seed_id: str, donnees) -> str:
    """Le bloc de données, HORS de `#root` (React efface son contenu au montage)."""
    return (
        f'<script type="application/json" id="{seed_id}">'
        f"{seed_json(donnees)}"
        "</script>\n"
    )


def _localisation_texte(job: dict) -> str:
    """Le texte d'adresse d'une mission — la même source que la carte de partage.

    Le document porte `location_text` à plat (écrit par l'application) et
    `location` en objet (adresse, et éventuellement une position, que la vue
    publique retire). Un document importé peut n'avoir que le second : on lit
    l'un puis l'autre, jamais un champ construit pour l'occasion.
    """
    texte = str(job.get("location_text") or "").strip()
    if texte:
        return texte
    lieu = job.get("location")
    if isinstance(lieu, dict):
        for cle in ("fullAddress", "address", "text", "city"):
            valeur = str(lieu.get(cle) or "").strip()
            if valeur:
                return valeur
    return ""


def _date_objet(valeur):
    """Une date du document en `datetime`, ou None si elle n'est pas LISIBLE.

    Trois formes existent en base : `datetime` (écrit par l'application), `date`,
    et chaîne ISO (document importé). Une date illisible rend None, et le champ
    correspondant n'est alors PAS publié : une date inventée ferait dater ou
    expirer l'annonce au mauvais moment, ce qui est pire qu'un champ absent.
    """
    if isinstance(valeur, datetime):
        return valeur
    if isinstance(valeur, date):
        return datetime(valeur.year, valeur.month, valeur.day, tzinfo=timezone.utc)
    texte = str(valeur or "").strip()
    if not texte:
        return None
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00"))
    except ValueError:
        return None


def job_posting(job: dict, *, base: str, url: str, description: str, job_id: str):
    """Le bloc `JobPosting` d'une mission OUVERTE — ou `None`.

    Une mission `in_progress`, `completed` ou annulée n'est PAS une offre, et un
    document sans statut n'affirme pas être ouvert : aucun des deux ne publie le
    bloc (annoncer à Google Jobs un emploi déjà pourvu ferait indexer une offre
    morte).

    `description` est le TEXTE de la mission (déjà coupé), jamais sa version
    échappée pour le HTML : le bloc est du JSON, et y recopier les entités
    publierait « &amp; » au lieu de « & » — le moteur citerait l'entité. Le
    `</script>` ne peut pas refermer la balise pour autant : `seed_json` échappe
    `<`, `>` et `&` en échappements Unicode.

    Chaque champ vient de la DONNÉE (`JobPublic` ou le document lui-même) : rien
    n'est déduit, aucun prix n'est présenté comme un salaire.
    """
    if str(job.get("status") or "").strip().lower() != "open":
        return None

    adresse = {"@type": "PostalAddress"}
    localite = _localisation_texte(job)
    if localite:
        adresse["addressLocality"] = localite
    pays = str(job.get("country") or "").strip()
    if pays:
        adresse["addressCountry"] = pays

    bloc = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": str(job.get("title") or ""),
        "description": description,
        "employmentType": "CONTRACTOR",
        "identifier": {
            "@type": "PropertyValue",
            "name": IDENTIFIANT_ORGANISATION,
            "value": job_id,
        },
        "url": url,
        "hiringOrganization": {
            "@type": "Organization",
            "name": IDENTIFIANT_ORGANISATION,
            "url": base,
            "logo": f"{base}{LOGO_ORGANISATION}",
        },
        "jobLocation": {"@type": "Place", "address": adresse},
    }

    publiee = _date_objet(job.get("posted_at"))
    if publiee is not None:
        bloc["datePosted"] = publiee.isoformat()
    echeance = _date_objet(job.get("deadline"))
    if echeance is None and publiee is not None:
        echeance = publiee + timedelta(days=VALIDITE_JOURS)
    if echeance is not None:
        bloc["validThrough"] = echeance.isoformat()
    return bloc


def job_og_html(job: dict, base: str, vue_publique=None) -> str:
    """HTML pré-rendu (crawlers sans JS) d'une fiche mission /jobs/:id.

    Les crawlers de partage (Facebook, LinkedIn, WhatsApp) ne lisent QUE le
    HTML servi, sans exécuter JavaScript : ce document porte les méta OG de
    la mission (titre, description, cartes wide + carrée pointées vers les
    endpoints Pillow du backend) + le shell h1 statique. Le rewrite Vercel
    /jobs/(.*) → /api/og/jobs/$1 achemine les fiches ici — plus de fonction
    serverless Vercel à déployer (Vercel ne collecte pas api/ en mode
    outputDirectory statique).

    Args:
        job: le document de la mission (titre, description, identifiant) — ce
            que la TÊTE publie, et rien de plus.
        base: origine du site, préfixe du canonical et des cartes.
        vue_publique: la vue `JobPublic` que l'API rend à un visiteur anonyme,
            embarquée telle quelle dans le bloc de données. `None` = pas de
            bloc (document legacy qui ne valide pas l'allowlist) : la fiche
            garde sa tête et son application, mais démarre par un chargement.
            Ce module ne la CONSTRUIT jamais — elle vient du routeur, donc il
            ne peut pas publier un champ que l'API publique cache.
    """
    job_id = str(job.get("id") or "")
    raw_title = str(job.get("title") or "")
    title = f"{raw_title} — Kojo" if raw_title else "Mission — Kojo"
    desc = couper_description(str(job.get("description") or ""))
    url = f"{base}/jobs/{escape_xml(job_id)}"
    wide = f"{base}/api/og/jobs/{escape_xml(job_id)}.png"
    square = f"{base}/api/og/jobs/{escape_xml(job_id)}-square.png"
    t = escape_xml(title)
    # Le TITRE de la page porte « — Kojo », le TITRE PRINCIPAL non : React rend
    # `<h1>{job.title}</h1>` (`JobDetails`), et le H1 statique diffusait donc le
    # suffixe du `<title>` dans le titre principal du document — mesuré le
    # 24/10/2026 : statique « Fuite sous l'évier … — Kojo » contre React
    # « Fuite sous l'évier … ». Deux H1 pour une même mission selon qu'on lit
    # avec ou sans JavaScript.
    h1 = escape_xml(raw_title) if raw_title else escape_xml("Mission")
    d = escape_xml(desc)
    # Le JSON-LD ne part que pour une VRAIE offre. Une mission `in_progress`,
    # `completed` ou annulée n'est pas une offre : l'annoncer à Google Jobs
    # ferait indexer un emploi qui n'existe plus. Un document SANS statut
    # n'affirme pas être ouvert, donc n'en porte pas non plus.
    json_ld = job_posting(job, base=base, url=url, description=desc, job_id=job_id)
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        # La politique AVANT toute ressource : elle doit s'appliquer au premier
        # octet de script que le document cite, pas après coup.
        + balise_csp()
        + f"<title>{t}</title>\n"
        f"<meta name=\"description\" content=\"{d}\" />\n"
        "<meta name=\"robots\" content=\"index, follow\" />\n"
        f"<link rel=\"canonical\" href=\"{url}\" />\n"
        "<meta property=\"og:type\" content=\"article\" />\n"
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
        # Le bloc `JobPosting` prend sa place dans la TÊTE, avant le point d'entrée :
        # il décrit la page, il ne la fait pas démarrer. Absent pour une mission
        # qui n'est pas une offre (`json_ld` vaut alors None).
        + (
            f'<script type="application/ld+json">{seed_json(json_ld)}</script>\n'
            if json_ld
            else ""
        )
        # Le CSS d'abord : il bloque le premier rendu, donc la fiche n'est
        # jamais peinte ni nue ni « habillée après coup ». Le module est différé.
        + point_entree_balises()
        + "</head>\n<body>\n"
        "<div id=\"root\">\n"
        "<div class=\"h-16 bg-white border-b border-gray-200\"></div>\n"
        "<div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8\">\n"
        f"<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">{h1}</h1>\n"
        # `</div>` ferme le conteneur, le second ferme `#root` : le bloc de
        # données vient APRÈS les deux, sinon React l'effacerait au montage
        # avant que la page ne l'ait lu.
        + "</div>\n</div>\n"
        + (balise_seed(SEED_ID, vue_publique) if vue_publique is not None else "")
        + "</body>\n</html>\n"
    )


def job_og_html_404() -> str:
    """HTML neutre pour une fiche inconnue — explicite noindex, mais NAVIGABLE.

    Il porte le MÊME point d'entrée que la fiche : un lien partagé devenu mort
    ouvre alors l'application (châssis, navigation, page « introuvable » de
    l'app) au lieu d'un texte nu sans issue. `noindex` reste, évidemment :
    c'est l'INDEXATION qui est refusée, pas la navigation.
    """
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        # La 404 démarre AUSSI l'application : elle porte donc la même politique.
        + balise_csp()
        + "<title>Mission introuvable — Kojo</title>\n"
        "<meta name=\"robots\" content=\"noindex, nofollow\" />\n"
        + point_entree_balises()
        + "</head>\n<body>\n<div id=\"root\"></div>\n</body>\n</html>\n"
    )
