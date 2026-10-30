"""Les langues qui ont une URL PROPRE, et les alternatives `hreflang` d'une page.

── Pourquoi ce module existe (30/10/2026) ─────────────────────────────────────
Le frontend publie depuis ce jour un document par langue indexée (`/jobs` en
français, `/en/jobs` en anglais, cf. `frontend/src/config/langues-indexees.js`)
et chaque document porte ses `<link rel="alternate" hreflang>`. Le SITEMAP doit
annoncer les mêmes URL : un `hreflang` qui désigne une page que le sitemap
n'énumère pas reste une déclaration que seul le crawl découvrira, et un sitemap
qui n'annonce que le français dit au moteur que l'anglais n'existe pas.

── Une seule déclaration, deux applications ──────────────────────────────────
La liste n'est PAS recopiée d'un dépôt à l'autre en espérance : les deux
applications se déploient séparément, donc un import partagé est impossible, et
c'est un TEST qui les tient ensemble (`backend/tests/test_hreflang_sitemap.py`
lit `frontend/src/config/langues-indexees.js` et compare cette liste). Ajouter
une langue d'un côté et pas de l'autre fait donc rougir le test, au lieu de
publier un sitemap qui ignore la moitié des documents.

── Ce que ce module ne fait pas ──────────────────────────────────────────────
Il ne traduit rien : les pages ville, métier et guides sont écrites en français
(`kojo_pages_metier`, `kojo_pages_guides`) et n'ont donc AUCUNE alternative — une
page monolingue ne déclare pas de `hreflang`, c'est le fait qui la décrit.
"""

from __future__ import annotations

# La MÊME liste que `LANGUES_INDEXEES` du frontend : code + préfixe d'URL.
# `prefixe` vide = langue par défaut, celle dont l'URL n'a pas bougé.
LANGUES_INDEXEES: tuple[dict[str, str], ...] = (
    {"code": "fr", "prefixe": "", "html_lang": "fr"},
    {"code": "en", "prefixe": "en", "html_lang": "en"},
)

LANGUE_PAR_DEFAUT = "fr"
LANGUE_DE_SECOURS = "x-default"


def codes() -> tuple[str, ...]:
    """Les codes des langues indexées, dans l'ordre déclaré."""
    return tuple(langue["code"] for langue in LANGUES_INDEXEES)


def _prefixe(code: str) -> str:
    for langue in LANGUES_INDEXEES:
        if langue["code"] == code:
            return langue["prefixe"]
    return ""


def chemin_dans_la_langue(chemin: str, code: str) -> str:
    """Le chemin d'une page dans une langue — même règle que le frontend.

    `('/jobs', 'en')` → `/en/jobs` ; `('/', 'en')` → `/en` (sans barre finale,
    c'est la forme que le rewrite Vercel et le sitemap publient) ; une langue
    sans préfixe rend le chemin tel quel.
    """
    base = chemin or "/"
    prefixe = _prefixe(code)
    if not prefixe:
        return base
    return f"/{prefixe}" if base == "/" else f"/{prefixe}{base}"


def alternatives(chemin: str) -> list[tuple[str, str]]:
    """Les `(hreflang, chemin)` d'une page : une par langue, puis `x-default`.

    La liste est la MÊME pour chaque langue de la famille (le `x-default` désigne
    la langue par défaut) : un `hreflang` réciproque est ce que Google demande,
    et deux listes à tenir d'accord finiraient par diverger.
    """
    liens = [(langue["html_lang"], chemin_dans_la_langue(chemin, langue["code"]))
             for langue in LANGUES_INDEXEES]
    liens.append((LANGUE_DE_SECOURS, chemin_dans_la_langue(chemin, LANGUE_PAR_DEFAUT)))
    return liens
