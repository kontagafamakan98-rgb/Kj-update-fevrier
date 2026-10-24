# -*- coding: utf-8 -*-
"""La CSP du site, vue par le BACKEND : documents pré-rendus `/jobs/:id` et
`/workers/:id`.

POURQUOI CE MODULE EXISTE : la politique du site est injectée dans les pages du
build par `frontend/vite-plugins/inject-production-csp.js`. Les deux documents
pré-rendus ne sont pas des pages du build — ils sont écrits ici, en Python — et
n'en portaient donc aucune : un visiteur arrivé par un lien partagé (le SEUL
chemin d'arrivée d'un visiteur à froid) recevait une page qui démarre
l'application sans la politique que le reste du site applique. C'était une
limite déclarée ; elle est fermée ici.

CE QUI EST LA SOURCE, ET COMMENT ELLE NE DIVERGE PAS : la déclaration unique vit
dans `frontend/src/config/csp.js` (`construireCsp`). Ce module en est la copie
Python, et les deux sont confrontées OCTET POUR OCTET par
`frontend/scripts/check-csp-contract.js` sur des jeux d'entrées de référence
(analytique absente, Plausible seul, GA4 seul, les deux, origine personnalisée,
origine avec barre finale). Deux langages, une seule politique : une entrée
ajoutée d'un côté sans l'autre fait rougir le contrat avant la fusion.

Ce que la copie ne peut PAS deviner, et qui est donc un RÉGLAGE : le build Vercel
lit `VITE_API_URL`, `VITE_PLAUSIBLE_DOMAIN` et `VITE_GA_MEASUREMENT_ID` ; le
backend lit `BACKEND_PUBLIC_URL`, `PLAUSIBLE_DOMAIN` et `GA_MEASUREMENT_ID`
(secrets Fly, cf. `DEPLOY_FLYIO.md`). Des valeurs différentes des deux côtés
produisent deux politiques différentes — c'est pourquoi la sonde de production
compare ce que le SITE sert et ce que les DOCUMENTS servent, et refuse la
divergence en nommant le réglage à poser. Un contrat hors ligne ne peut pas voir
cet écart : il ne connaît ni l'un ni l'autre des environnements déployés.

FRONTIÈRE DU MODULE : stdlib uniquement, et aucun import de `kojo_settings`.
`kojo_job_og.py` doit rester importable par le job frontend (où seules les
dépendances npm sont installées), donc ce module non plus — c'est ce qui permet
au contrat hors ligne de l'exécuter avec un interpréteur quelconque.
"""

import json
import os
import re
import sys

# La forme d'un identifiant GA4 utilisable — la même expression que
# `GA_MOTIF` dans `frontend/src/config/csp.js`. Un `UA-…` n'ouvre RIEN : c'est
# un identifiant mort, et l'autoriser élargirait la politique pour rien.
GA_MOTIF = re.compile(r"G-[A-Z0-9]+", re.IGNORECASE)

# Les réglages du backend, lus dans l'environnement. Les noms sont SANS préfixe
# `VITE_` (ce ne sont pas des variables exposées au navigateur) ; les valeurs
# doivent être les mêmes que celles du build Vercel.
ENV_ORIGINE_API = "BACKEND_PUBLIC_URL"
ENV_PLAUSIBLE = "PLAUSIBLE_DOMAIN"
ENV_GA = "GA_MEASUREMENT_ID"

# Ce que la copie refuse de porter : `frame-ancestors` est ignoré dans une
# balise <meta> (avertissement console à chaque chargement). Il reste l'en-tête
# HTTP de `frontend/vercel.json`.
DIRECTIVE_INTERDITE = "frame-ancestors"


def normaliser_origine(valeur) -> str:
    """Origine sans espaces ni barres finales — la même normalisation qu'en JS."""
    return str(valeur or "").strip().rstrip("/")


def construire_csp(api_origin="", plausible_domain="", ga_measurement_id="") -> str:
    """Compose la politique du site.

    L'ORDRE des directives et des sources est SIGNIFICATIF : cette chaîne est
    comparée octet pour octet à celle de `construireCsp`
    (`frontend/src/config/csp.js`). Un tri « plus joli » d'un seul côté ferait
    rougir le contrat — et c'est voulu, parce que la sonde de production
    compare ces mêmes octets sur ce que le site sert.

    Args:
        api_origin: origine du backend, pour `connect-src`.
        plausible_domain: domaine Plausible déclaré, ou ''.
        ga_measurement_id: identifiant GA4 (`G-…`), ou ''.

    Returns:
        La politique, prête pour l'attribut `content` d'une meta CSP.
    """
    origine = normaliser_origine(api_origin)
    plausible = str(plausible_domain or "").strip()
    ga = str(ga_measurement_id or "").strip()
    ga_actif = bool(GA_MOTIF.fullmatch(ga))

    # Le SDK Google Identity Services (bouton SSO) est chargé depuis
    # accounts.google.com/gsi/client : sans cette entrée, le bouton échoue avec
    # « Impossible de charger le SDK Google ».
    script_src = ["'self'", "https://accounts.google.com"]
    if plausible:
        script_src.append("https://plausible.io")
    if ga_actif:
        script_src.append("https://www.googletagmanager.com")

    connect_src = ["'self'"]
    if origine:
        connect_src.append(origine)
    connect_src.append("https://accounts.google.com")
    if ga_actif:
        # `www.google.com` : MESURÉ, pas supposé (24/10/2026, console de
        # production). gtag émet une partie de ses balises vers
        # `https://www.google.com/g/collect`, et NOTRE politique la refusait
        # (« Refused to connect because it violates the document's Content
        # Security Policy »). Le contrat hors ligne ne pouvait pas le voir :
        # les deux copies étaient d'accord pour bloquer la même origine.
        connect_src += [
            "https://www.google-analytics.com",
            "https://region1.google-analytics.com",
            "https://www.google.com",
        ]

    img_src = [
        "'self'",
        "data:",
        "blob:",
        "https://res.cloudinary.com",
        "https://tile.openstreetmap.org",
    ]
    if ga_actif:
        img_src.append("https://www.google-analytics.com")

    directives = [
        "default-src 'self'",
        "script-src " + " ".join(script_src),
        "style-src 'self' 'unsafe-inline'",
        "img-src " + " ".join(img_src),
        "connect-src " + " ".join(connect_src),
        "frame-src 'self' https://www.google.com https://www.openstreetmap.org "
        "https://accounts.google.com",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
    ]
    return "; ".join(directives)


def csp_du_site(environ=None) -> str:
    """La politique telle que la PRODUCTION la sert, lue dans l'environnement.

    Args:
        environ: environnement à lire (`os.environ` par défaut) — injectable
            pour que les tests n'aient pas à muter le process.

    Returns:
        La politique du site, sans `frame-ancestors`.
    """
    source = os.environ if environ is None else environ
    return construire_csp(
        api_origin=source.get(ENV_ORIGINE_API, ""),
        plausible_domain=source.get(ENV_PLAUSIBLE, ""),
        ga_measurement_id=source.get(ENV_GA, ""),
    )


def _echapper_attribut(valeur: str) -> str:
    """Échappe ce qui fermerait l'attribut — et RIEN de plus.

    L'apostrophe n'est PAS échappée, à la différence de `escape_xml` : la
    politique en contient par construction (`'self'`, `'unsafe-inline'`), et un
    `&apos;` rendrait les octets servis différents de ceux de la meta du build
    pour la MÊME politique — donc la comparaison de la sonde de production
    comparerait deux encodages au lieu de deux politiques. Dans un attribut
    entre guillemets doubles, l'apostrophe est un caractère ordinaire.
    """
    return (
        str(valeur)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def balise_csp(csp=None) -> str:
    """La balise `<meta>` de la politique, terminée par un saut de ligne.

    Args:
        csp: politique à publier (`csp_du_site()` par défaut).

    Returns:
        La balise prête à être insérée dans `<head>`.
    """
    politique = csp_du_site() if csp is None else str(csp)
    return (
        '<meta http-equiv="Content-Security-Policy" content="'
        + _echapper_attribut(politique)
        + '" />\n'
    )


def _main(argv) -> int:
    """Interface du contrat hors ligne : des cas JSON en entrée, des politiques
    en sortie.

    Une seule invocation, plusieurs cas : `[{"api_origin": …,
    "plausible_domain": …, "ga_measurement_id": …}, …]` sur stdin, et la liste
    des politiques sur stdout. C'est ce que `check-csp-contract.js` compare à
    `construireCsp` — l'interpréteur n'est donc lancé qu'une fois par passage.
    """
    if "--json" not in argv:
        print(
            "usage : cat cas.json | python backend/kojo_csp.py --json\n"
            "  cas : [{\"api_origin\": …, \"plausible_domain\": …, "
            "\"ga_measurement_id\": …}, …]",
            file=sys.stderr,
        )
        return 2
    try:
        cas = json.load(sys.stdin)
    except (ValueError, OSError) as erreur:
        print("cas illisibles : %s" % erreur, file=sys.stderr)
        return 2
    if not isinstance(cas, list) or not cas:
        print("au moins un cas est exigé", file=sys.stderr)
        return 2
    sortie = [
        construire_csp(
            api_origin=item.get("api_origin", ""),
            plausible_domain=item.get("plausible_domain", ""),
            ga_measurement_id=item.get("ga_measurement_id", ""),
        )
        for item in cas
    ]
    json.dump(sortie, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
