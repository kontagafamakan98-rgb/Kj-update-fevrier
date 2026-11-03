# -*- coding: utf-8 -*-
"""LES 45 PAGES VILLE/MÉTIER/GUIDE, RENDUES UNE FOIS PAR MINUTE (02/11/2026).

MESURÉ LE 02/11/2026, AVANT. `curl` sur la production :

    /emplois/bamako        Vercel : X-Vercel-Cache: MISS, TTFB 0,67–0,94 s
    /guides/prix-bamako    Vercel : X-Vercel-Cache: MISS, TTFB 0,65 s
    /                      Vercel : X-Vercel-Cache: HIT,  Age 4800, TTFB 0,33 s
    /api/pages/villes/bamako (Fly, direct)              TTFB 0,52 s (1,19 s à froid)

Le backend envoyait DÉJÀ `public, max-age=300, s-maxage=1800,
stale-while-revalidate=86400` : le cache du NAVIGATEUR est donc réglé, et c'est
pourquoi la mesure est faite en `curl` neuf à chaque fois — mais Vercel ne met
PAS en cache une réécriture vers une origine externe (`/emplois/(.*)` →
`https://api…/api/pages/villes/$1`), d'où le `MISS` à chaque passage. La page
coûtait donc 0,5 s de rendu Python + lecture Mongo à CHAQUE visite, pour un
document identique d'une minute à l'autre.

CE QUE CE MODULE FAIT, ET RIEN DE PLUS : il garde en mémoire le document RENDU
(la lecture Mongo comprise) pendant `TTL_SECONDES`, par clé
`(famille, slug, base du site)`. Les 404 n'entrent jamais ici — elles portent
`no-store` et leur coût n'a pas d'intérêt. La base du site est dans la clé
parce que les URL absolues du document (canonical, JSON-LD) en dépendent : une
page rendue pour un domaine ne doit pas être servie sous un autre.

LE SITEMAP PASSE PAR LE MÊME MODULE, LE MÊME SOIR. Mesuré à **0,72 s par
crawl** (`/sitemap.xml`) pour une déclaration qui ne change qu'aux publications,
et Vercel ne cache pas davantage la réécriture vers l'origine Fly que les pages
(depuis le 03/11/2026 le site passe par la fonction d'arête `api/sitemap.js`,
qui apporte la couche de CDN ; ce module reste la couche d'origine). La valeur
mise en cache y est un dictionnaire
`{corps, volumes}` : le corps et ses trois en-têtes `X-Kojo-Urls*` sont rendus
puis cachés ENSEMBLE, donc un en-tête ne peut pas décrire un autre corps après
un rejeu. C'est la raison pour laquelle `obtenir` rend `Any` et non `str`.

TROIS RÈGLES, CHACUNE MESURÉE.

  * TTL de 60 s, plus court que le `max-age=300` que le navigateur applique
    DÉJÀ : une page ne peut donc pas être plus vieille chez nous qu'elle ne
    l'est dans un cache client. Le compteur d'offres qu'elle publie a une minute
    au plus — et c'est écrit dans `TTL_SECONDES`, pas caché.
  * BORNÉ : au-delà de `MAX_ENTREES`, l'entrée la moins récemment servie sort.
    Un cache qui grandit sans plafond finirait par coûter plus de mémoire que
    le rendu qu'il évite ; 45 pages + 23 guides tiennent largement dedans.
  * HONNÊTE : chaque réponse dit d'où elle vient (`X-Kojo-Pages-Cache: frais` /
    `rejoue`), et `stats()` publie les trois compteurs. Une sonde peut donc
    distinguer un cache qui sert d'un cache qui ne touche jamais rien — la
    même règle que le coût des autres sondes : ce qui n'est pas publié dérive.

CE QU'IL NE FAIT PAS : il n'invalide pas à la publication d'une mission. Le
délai d'une minute est le prix payé pour ne pas coupler le cache au module de
missions, et il est plus court que ce que le navigateur garde déjà.
"""
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Optional, Tuple

# Le délai, en secondes. Plus court que le `max-age=300` du navigateur, par
# construction : on ne garde jamais un document plus longtemps que le client.
TTL_SECONDES = 60

# Le plafond d'entrées. 45 pages ville/métier + 23 guides = 68 documents ; un
# document pèse ~35 Ko, donc ~2,4 Mo au pire. La marge couvre les variantes de
# base (préproduction, domaine Fly) sans jamais rendre le cache illimité.
MAX_ENTREES = 96

# (famille, slug, base) -> (instant monotone du rendu, valeur rendue)
_entrees: "OrderedDict[tuple, Tuple[float, str]]" = OrderedDict()

# Ce que le cache a fait depuis le démarrage. `expire` compte les rendus
# refaits : un TTL qui n'expire jamais dirait que les pages ne changent pas.
_stats = {"frais": 0, "rejoue": 0, "expire": 0}


def reinitialiser() -> None:
    """Vide le cache et les compteurs (tests, redémarrage simulé)."""
    _entrees.clear()
    for cle in _stats:
        _stats[cle] = 0


def invalider(famille: str) -> int:
    """Retire les entrées d'une famille (`sitemap`, `ville`, `metier`, `guide`).

    Rend le nombre d'entrées retirées — un `0` est une information : il dit
    qu'aucun document de cette famille n'était caché, donc que l'invalidation
    n'a rien évité.
    """
    cles = [cle for cle in _entrees if cle and cle[0] == famille]
    for cle in cles:
        del _entrees[cle]
    return len(cles)


# Les écritures qui rendent le SITEMAP faux. Mesuré le 02/11/2026 (soir) : la
# purge d'un compte et la suppression d'une mission doivent retirer leur URL du
# sitemap IMMÉDIATEMENT — `tests/test_purge_compte_proprietaire.py` et
# `tests/test_job_og_cycle.py` l'exigent, et c'est la promesse tenue à un
# visiteur dont le profil est purgé. Un TTL de 60 s aurait laissé son nom
# public une minute de trop.
#
# La règle est large à dessein : TOUTE écriture réussie sous /api vide le
# sitemap, pas seulement celles de `jobs` et `users`. Une liste de chemins
# écrite ici serait une seconde déclaration, libre de rater une route ajoutée
# plus tard ; invalider pour un message envoyé ne coûte qu'un rendu au crawl
# suivant, tandis qu'une invalidation manquée publie une URL morte.
METHODES_SANS_ECRITURE = ("GET", "HEAD", "OPTIONS")
PREFIXE_API = "/api"
FAMILLE_INVALIDEE = "sitemap"


def invalider_sur_ecriture(methode: str, chemin: str, statut: int) -> int:
    """Vide le sitemap si la requête était une écriture RÉUSSIE sous /api.

    Un 4xx/5xx n'a rien changé en base : rien à invalider, et vider le cache
    sur un refus ne ferait que payer un rendu pour une tentative rejetée.
    """
    if str(methode or "").upper() in METHODES_SANS_ECRITURE:
        return 0
    if not str(chemin or "").startswith(PREFIXE_API):
        return 0
    if statut >= 400:
        return 0
    return invalider(FAMILLE_INVALIDEE)


def stats() -> dict:
    """`{frais, rejoue, expire, entrees, ttl_secondes, plafond}` — pour /metrics."""
    return {
        **_stats,
        "entrees": len(_entrees),
        "ttl_secondes": TTL_SECONDES,
        "plafond": MAX_ENTREES,
    }


async def obtenir(
    cle: tuple,
    rendre: Callable[[], Awaitable[Any]],
    *,
    ttl: Optional[float] = None,
    maintenant: Optional[Callable[[], float]] = None,
) -> Tuple[Any, bool]:
    """Le document de `cle`, rendu si absent ou expiré.

    `rendre` peut rendre n'importe quoi (`Any`) : une page est une chaîne, le
    sitemap est un dictionnaire `{body, servi, declarees, vivantes}`. Ce qui est
    mis en cache est la VALEUR RENDUE, jamais une reconstruction partielle —
    c'est ce qui garantit que l'en-tête de volume et le corps du sitemap ne
    peuvent pas se contredire après un rejeu.

    Args:
        cle: `(famille, slug, base)` — la base du site en fait partie parce que
            les URL absolues du document en dépendent.
        rendre: rend le document (lecture Mongo comprise). Appelé SEULEMENT si
            le cache ne sert pas : c'est tout l'intérêt.
        ttl: secondes de fraîcheur ; `None` = `TTL_SECONDES`.
        maintenant: horloge injectable (`time.monotonic` par défaut) pour que
            les preuves éprouvent l'expiration sans dormir.

    Returns:
        `(document, rejoue)` — `rejoue` est vrai quand le cache a servi.
    """
    horloge = maintenant or time.monotonic
    duree = TTL_SECONDES if ttl is None else ttl
    instant = horloge()

    entree = _entrees.get(cle)
    if entree is not None:
        rendu_a, document = entree
        if instant - rendu_a < duree:
            # Réordonne : l'entrée qui vient de servir est la plus récente, donc
            # la dernière à sortir quand le plafond est atteint.
            _entrees.move_to_end(cle)
            _stats["rejoue"] += 1
            return document, True
        # Expirée : elle est retirée tout de suite, sinon un rendu en échec
        # laisserait un document périmé à portée de main.
        del _entrees[cle]
        _stats["expire"] += 1

    document = await rendre()
    _entrees[cle] = (horloge(), document)
    _entrees.move_to_end(cle)
    _stats["frais"] += 1
    while len(_entrees) > MAX_ENTREES:
        _entrees.popitem(last=False)
    return document, False


class InvalidationSitemapMiddleware:
    """Vide le cache du sitemap après une écriture réussie (cf. plus haut).

    Posé dans la pile ASGI plutôt que dans chaque route : une invalidation
    rappelée à chaque endroit qui écrit est exactement le genre de règle qu'un
    chemin ajouté plus tard oublie. Le statut est lu sur la réponse déjà
    produite — un refus n'a rien changé en base, donc rien à invalider.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        statut = {"code": 500}

        async def _send(message):
            if message.get("type") == "http.response.start":
                statut["code"] = int(message.get("status") or 500)
            await send(message)

        await self.app(scope, receive, _send)
        try:
            invalider_sur_ecriture(scope.get("method"), scope.get("path"), statut["code"])
        except Exception:  # noqa: BLE001 — invalider ne doit jamais casser une réponse
            pass
