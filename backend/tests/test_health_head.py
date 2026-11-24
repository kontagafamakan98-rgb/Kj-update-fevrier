# -*- coding: utf-8 -*-
"""HEAD sur les DEUX routes de santé : un moniteur d'infra lit la même chose.

── Ce que ce cas ferme (18/11/2026) ─────────────────────────────────────────
Mesuré sur la production ce jour-là : `HEAD /health` rendait **200** et
`HEAD /api/health` rendait **405 Method Not Allowed** (`allow: GET`). Les deux
routes publient pourtant le MÊME payload — elles appellent toutes les deux
`_health_payload()` — et la racine déclare `GET` **et** `HEAD` avec le motif
écrit dans le code : « routes racine hors /api (moniteurs d'infra : Render,
UptimeRobot…) ». Seule celle montée sur `api_router` n'avait qu'un `@get`.

FastAPI n'ajoute pas HEAD aux routes GET (Starlette le fait, FastAPI non), donc
un moniteur qui envoie HEAD — c'est le défaut d'UptimeRobot, « we don't need the
content of a website, just its response headers » — lisait un 405 sur l'URL de
l'API et un 200 sur l'autre : deux verdicts opposés pour un service en bonne
santé, et la CI verte (elle interroge en GET) ne pouvait pas le voir.

── Ce que le cas exige, et ce qu'il n'exige pas ────────────────────────────
Il exige que les DEUX routes rendent 200 à un HEAD, qu'elles annoncent le même
média et le même encodage, qu'elles publient un `content-length` toutes les
deux, et qu'un HEAD ne porte pas de corps — un moniteur en HEAD ne lit que les
en-têtes. Les VALEURS se comparent en GET : le corps d'un HEAD est vide par
construction (Starlette le supprime avant l'envoi). `content-length` n'est
exigé qu'en PRÉSENCE, jamais en égalité : il compte le corps COMPRESSÉ, qui
contient l'heure de la réponse, et deux appels au même instant mesurent 1172 et
1171 octets — une égalité serait un test qui échoue au hasard. Le payload est
donc comparé clé par clé, `timestamp` excepté — l'heure de la réponse n'est pas
une propriété de la route.

── La mutation qui prouve le verdict ───────────────────────────────────────
Retirer `"HEAD"` de `methods` sur `/api/health` rend le premier cas rouge en
nommant le 405 — c'est exactement l'état mesuré en production le 18/11/2026.
"""
from __future__ import annotations

from httpx import AsyncClient

ROUTES = ("/api/health", "/health")
# L'heure de la réponse, jamais une propriété de la route.
VARIABLE = "timestamp"


def _differents(a: dict, b: dict) -> dict:
    """Les clés dont les deux payloads ne disent pas la même chose."""
    return {cle: (a[cle], b[cle]) for cle in a if cle != VARIABLE and a[cle] != b[cle]}


async def test_les_deux_routes_de_sante_repondent_200_a_un_head(client: AsyncClient):
    """Le défaut mesuré : 405 sur l'une, 200 sur l'autre — pour le même payload."""
    for route in ROUTES:
        reponse = await client.head(route)
        assert reponse.status_code == 200, (
            "HEAD %s rend %d (allow: %r) : un moniteur d'infra qui envoie HEAD "
            "lirait une panne là où la route répond"
            % (route, reponse.status_code, reponse.headers.get("allow"))
        )


async def test_le_head_des_deux_routes_rend_les_memes_entetes(client: AsyncClient):
    """Ce qu'un moniteur en HEAD peut lire : statut, média, encodage, longueur."""
    api = await client.head("/api/health")
    racine = await client.head("/health")

    assert api.status_code == racine.status_code == 200
    entetes = {}
    for reponse, route in ((api, "/api/health"), (racine, "/health")):
        entetes[route] = {
            "media": reponse.headers.get("content-type", "").split(";")[0],
            "encodage": reponse.headers.get("content-encoding"),
            "longueur": reponse.headers.get("content-length"),
        }
    # Ce qu'un moniteur juge : le média et l'encodage, identiques sur les deux
    # routes. La LONGUEUR, elle, compte le corps compressé de CETTE réponse :
    # elle se compare en présence, pas en égalité (1172 contre 1171 octets pour
    # deux appels au même instant — l'heure de la réponse est dans le corps).
    for route, lu in entetes.items():
        assert lu["media"] == "application/json", (
            "HEAD %s rend %r : un moniteur qui lit l'en-tête ne voit pas du JSON"
            % (route, lu["media"])
        )
        assert lu["longueur"] is not None, (
            "HEAD %s ne publie aucun content-length : un moniteur en HEAD "
            "n'aurait rien à mesurer" % route
        )
        assert lu["encodage"] is not None, (
            "HEAD %s ne publie aucun content-encoding" % route
        )
    assert entetes["/api/health"]["encodage"] == entetes["/health"]["encodage"], (
        "les deux routes n'annoncent pas le même encodage : %s" % entetes
    )
    for reponse, route in ((api, "/api/health"), (racine, "/health")):
        assert reponse.content == b"", (
            "HEAD %s a renvoyé %d octet(s) de corps : un HEAD ne transporte pas "
            "de contenu" % (route, len(reponse.content))
        )


async def test_les_deux_routes_publient_le_meme_payload(client: AsyncClient):
    """Les valeurs se lisent en GET : mêmes clés, mêmes valeurs, `timestamp` près."""
    api = (await client.get("/api/health")).json()
    racine = (await client.get("/health")).json()

    assert set(api) == set(racine), (
        "les deux routes ne publient pas les mêmes blocs : %s"
        % sorted(set(api) ^ set(racine))
    )
    differents = _differents(api, racine)
    assert differents == {}, (
        "les deux routes divergent sur %s : le payload n'a qu'une source "
        "(`_health_payload()`), ces clés ne devraient pas bouger"
        % sorted(differents)
    )


async def test_le_head_ne_devie_pas_du_get(client: AsyncClient):
    """Un moniteur en HEAD et un client en GET jugent le même service."""
    for route in ROUTES:
        head = await client.head(route)
        get = await client.get(route)
        assert head.status_code == get.status_code == 200, (
            "%s : HEAD rend %d, GET rend %d — le moniteur et le client ne "
            "verraient pas le même service" % (route, head.status_code, get.status_code)
        )
