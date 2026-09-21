# -*- coding: utf-8 -*-
"""Le contrat de surface des routes de `kojo_routers_jobs` est FIGÉ, puis asserté.

Ce que ce fichier protège : le découpage de `kojo_routers_jobs.py` en modules
d'endpoints ne doit pas toucher la surface PUBLIQUE. Pas seulement les chemins :
pour chaque route, la méthode, le nom de l'endpoint, le `response_model`, le code
de statut, ET les dépendances atteignables (donc l'authentification — c'est
`Depends(get_current_user)` qui décide qui peut appeler quoi).

La surface est lue sur l'APPLICATION réellement montée (`server.app`), pas sur le
module : une route définie mais non incluse reste donc invisible, et c'est un
écart qui rougit au lieu de passer — le mode d'échec exact d'un découpage.

La référence est `job_route_surface.json`, pris sur l'arbre d'AVANT le
découpage. Pour la regénérer volontairement (un changement de contrat ASSUMÉ) :

    KOJO_FREEZE_ROUTE_SURFACE=1 python -m pytest tests/test_job_route_surface.py

puis relire le diff du JSON et le committer — le fichier EST la revue.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi.routing import APIRoute

SNAPSHOT = Path(__file__).with_name("job_route_surface.json")

# Le seul chemin d'écriture du fichier : une variable d'environnement explicite,
# pour qu'aucune exécution ordinaire ne puisse réécrire la référence en silence.
FREEZE = "KOJO_FREEZE_ROUTE_SURFACE"


def _nom(callable_) -> str:
    """Nom STABLE d'une dépendance (« kojo_core.get_current_user »).

    Une dépendance peut être une fonction (`get_current_user`) ou une INSTANCE
    (le `HTTPBearer()` que FastAPI pose en sous-dépendance). Pour l'instance, le
    repli évident — `repr()` — porte une ADRESSE MÉMOIRE : le nom changerait à
    chaque exécution et la référence figée ne vaudrait plus rien. On nomme donc
    sa CLASSE, qui est ce qui décide du comportement.
    """
    nom = getattr(callable_, "__qualname__", None)
    if not nom:
        nom = type(callable_).__qualname__
        module = getattr(type(callable_), "__module__", "") or ""
    else:
        module = getattr(callable_, "__module__", "") or ""
    return "%s.%s" % (module, nom) if module else nom


def _dependances(dependant) -> list:
    """Dépendances ATTEIGNABLES, en profondeur, dans l'ordre de résolution.

    Récursif : une dépendance d'authentification qui dépend elle-même d'autre
    chose (par exemple un lecteur de jeton) fait partie du contrat — la suivre
    est ce qui distingue « la route est protégée » de « la route appelle une
    fonction qui s'appelle pareil ».
    """
    noms = []
    for sous in getattr(dependant, "dependencies", []) or []:
        noms.append(_nom(sous.call))
        noms.extend(_dependances(sous))
    return noms


def _famille() -> tuple:
    """(chemin monté, méthode) de chaque route possédée par `kojo_routers_jobs`.

    Le périmètre est DÉRIVÉ du routeur du module — pas d'une liste de chemins
    recopiée ici : une route ajoutée au module entre dans la comparaison sans
    qu'on touche à ce fichier, et l'oublier serait un écart invisible.
    """
    from server import api_router
    from kojo_routers_jobs import router as jobs_router

    prefixe = api_router.prefix
    return {
        (prefixe + route.path, methode)
        for route in jobs_router.routes
        for methode in route.methods
    }


def surface() -> list:
    """La surface montée, dans l'ordre d'enregistrement (méthode par méthode)."""
    from server import app

    famille = _famille()
    routes = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for methode in sorted(route.methods):
            if (route.path, methode) not in famille:
                continue
            modele = getattr(route, "response_model", None)
            routes.append(
                {
                    "methode": methode,
                    "chemin": route.path,
                    "nom": route.name,
                    "code": route.status_code,
                    "response_model": _nom(modele) if modele is not None else None,
                    "dependances": _dependances(route.dependant),
                }
            )
    return routes


def _ecarts(actuelle: list, figee: list) -> str:
    """Ce qui a bougé, route par route — nommé, jamais « listes différentes »."""
    par_cle = lambda routes: {(r["methode"], r["chemin"]): r for r in routes}
    maintenant, reference = par_cle(actuelle), par_cle(figee)
    lignes = []
    for cle in sorted(set(reference) - set(maintenant)):
        lignes.append("DISPARUE : %s %s (était %s)" % (cle[0], cle[1], reference[cle]["nom"]))
    for cle in sorted(set(maintenant) - set(reference)):
        lignes.append("APPARUE : %s %s (%s)" % (cle[0], cle[1], maintenant[cle]["nom"]))
    for cle in sorted(set(maintenant) & set(reference)):
        for champ in sorted(set(maintenant[cle]) | set(reference[cle])):
            avant, apres = reference[cle].get(champ), maintenant[cle].get(champ)
            if avant != apres:
                lignes.append(
                    "%s %s : %s — figé %r, actuel %r" % (cle[0], cle[1], champ, avant, apres)
                )
    if not lignes:
        # Même contenu, mais dans un autre ORDRE : c'est le seul cas que la
        # comparaison par clé ne voit pas, et l'ordre d'enregistrement décide
        # quelle route gagne quand deux motifs se recouvrent.
        lignes.append("même routes, mais l'ORDRE d'enregistrement a changé")
    return " | ".join(lignes)


class TestSurfaceDesRoutes:
    def test_la_surface_des_routes_est_inchangee(self):
        actuelle = surface()
        if os.environ.get(FREEZE) == "1":
            # `newline="\n"` fige la représentation quel que soit l'OS : sans lui,
            # un gel fait sous Windows écrit des CRLF que git normalise ensuite en
            # silence — la référence changerait d'octets sans qu'aucun test ne le dise.
            SNAPSHOT.write_text(
                json.dumps(actuelle, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            import pytest

            pytest.skip(
                "surface regénérée dans %s (%d routes) — relire le diff et le committer"
                % (SNAPSHOT.name, len(actuelle))
            )

        figee = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        assert actuelle == figee, "surface des routes modifiée : %s" % _ecarts(actuelle, figee)

    def test_la_famille_est_non_vide_et_entierement_montee(self):
        """Non-vacuité, et « définie mais non montée » rougit.

        Un découpage dont on oublie d'inclure un sous-routeur laisserait passer
        ses routes dans le module et les ferait sortir de l'application : la
        comparaison ci-dessus ne le verrait que si les deux listes sont lues au
        même endroit, donc on vérifie ici que TOUTE route possédée est servie.
        """
        from fastapi.routing import APIRoute

        from server import app

        montees = {(r.path, m) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
        possedees = _famille()
        assert len(possedees) >= 13, "famille suspicieusement petite : %s" % sorted(possedees)
        assert possedees - montees == set(), (
            "route(s) définie(s) mais NON montée(s) : %s" % sorted(possedees - montees)
        )
        assert len(surface()) == len(possedees)
