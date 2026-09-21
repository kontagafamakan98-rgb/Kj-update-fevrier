# -*- coding: utf-8 -*-
"""Machinerie du contrat de surface des routeurs DÉCOUPÉS.

Un routeur qui tient dans un fichier peut être lu ; un routeur découpé en
modules ne peut plus l'être, et c'est précisément ce qu'un découpage fait
perdre. Ce que ce module protège : le découpage ne doit pas toucher la surface
PUBLIQUE. Pas seulement les chemins : pour chaque route, la méthode, le nom de
l'endpoint, le `response_model`, le code de statut, ET les dépendances
atteignables (donc l'authentification — c'est `Depends(get_current_user)` qui
décide qui peut appeler quoi), dans l'ORDRE d'enregistrement.

La surface est lue sur l'APPLICATION réellement montée (`server.app`), pas sur
le module : une route définie mais non incluse reste donc invisible, et c'est un
écart qui rougit au lieu de passer — le mode d'échec exact d'un découpage.

Ce module est un OUTIL, pas une preuve : il ne porte aucun verdict. Les verdicts
sont portés par les tests de contrat (`test_job_route_surface.py`,
`test_user_route_surface.py`), qui n'ont plus chacun leur copie de la
mécanique — deux copies d'une même règle divergent toujours, et la seconde finit
par être celle qu'on oublie de corriger.

La référence est un JSON pris sur l'arbre d'AVANT le découpage. Pour la
regénérer volontairement (un changement de contrat ASSUMÉ) :

    KOJO_FREEZE_ROUTE_SURFACE=1 python -m pytest tests/test_<famille>_route_surface.py

puis relire le diff du JSON et le committer — le fichier EST la revue.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi.routing import APIRoute

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Le seul chemin d'écriture d'une référence : une variable d'environnement
# explicite, pour qu'aucune exécution ordinaire ne puisse réécrire en silence
# l'arbre contre lequel le contrat est vérifié.
FREEZE = "KOJO_FREEZE_ROUTE_SURFACE"


def nom(callable_) -> str:
    """Nom STABLE d'une dépendance (« kojo_core.get_current_user »).

    Une dépendance peut être une fonction (`get_current_user`) ou une INSTANCE
    (le `HTTPBearer()` que FastAPI pose en sous-dépendance). Pour l'instance, le
    repli évident — `repr()` — porte une ADRESSE MÉMOIRE : le nom changerait à
    chaque exécution et la référence figée ne vaudrait plus rien. On nomme donc
    sa CLASSE, qui est ce qui décide du comportement.
    """
    nom_ = getattr(callable_, "__qualname__", None)
    if not nom_:
        nom_ = type(callable_).__qualname__
        module = getattr(type(callable_), "__module__", "") or ""
    else:
        module = getattr(callable_, "__module__", "") or ""
    return "%s.%s" % (module, nom_) if module else nom_


def dependances(dependant) -> list:
    """Dépendances ATTEIGNABLES, en profondeur, dans l'ordre de résolution.

    Récursif : une dépendance d'authentification qui dépend elle-même d'autre
    chose (par exemple un lecteur de jeton) fait partie du contrat — la suivre
    est ce qui distingue « la route est protégée » de « la route appelle une
    fonction qui s'appelle pareil ».
    """
    noms = []
    for sous in getattr(dependant, "dependencies", []) or []:
        noms.append(nom(sous.call))
        noms.extend(dependances(sous))
    return noms


def routeur(composer: str):
    """Le routeur du COMPOSEUR — celui qui monte les modules d'endpoints."""
    import importlib

    return importlib.import_module(composer).router


def famille(composer: str) -> set:
    """(chemin monté, méthode) de chaque route possédée par ce composeur.

    Le périmètre est DÉRIVÉ du routeur du composeur — pas d'une liste de chemins
    recopiée : une route ajoutée à la famille entre dans la comparaison sans
    qu'on touche à ce fichier, et l'oublier serait un écart invisible.
    """
    from server import api_router

    prefixe = api_router.prefix
    return {
        (prefixe + route.path, methode)
        for route in routeur(composer).routes
        for methode in route.methods
    }


def surface(composer: str) -> list:
    """La surface montée, dans l'ordre d'enregistrement (méthode par méthode)."""
    from server import app

    famille_ = famille(composer)
    routes = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for methode in sorted(route.methods):
            if (route.path, methode) not in famille_:
                continue
            modele = getattr(route, "response_model", None)
            routes.append(
                {
                    "methode": methode,
                    "chemin": route.path,
                    "nom": route.name,
                    "code": route.status_code,
                    "response_model": nom(modele) if modele is not None else None,
                    "dependances": dependances(route.dependant),
                }
            )
    return routes


def ecarts(actuelle: list, figee: list) -> str:
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


def reference(composer: str, snapshot: str) -> Path:
    return BACKEND_DIR / "tests" / snapshot


def verifier_contrat(composer: str, snapshot: str, nom_du_routeur: str) -> None:
    """Le verdict : la surface montée == la référence, ou un écart NOMMÉ.

    Sous `KOJO_FREEZE_ROUTE_SURFACE=1`, la référence est réécrite (et le test
    est sauté) : c'est la seule façon de la faire évoluer, et elle exige de
    relire le diff.
    """
    import pytest

    chemin = reference(composer, snapshot)
    actuelle = surface(composer)
    if os.environ.get(FREEZE) == "1":
        # `newline="\n"` fige la représentation quel que soit l'OS : sans lui,
        # un gel fait sous Windows écrit des CRLF que git normalise ensuite en
        # silence — la référence changerait d'octets sans qu'aucun test ne le dise.
        chemin.write_text(
            json.dumps(actuelle, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        pytest.skip(
            "surface de %s regénérée dans %s (%d routes) — relire le diff et le committer"
            % (nom_du_routeur, chemin.name, len(actuelle))
        )

    figee = json.loads(chemin.read_text(encoding="utf-8"))
    assert actuelle == figee, "surface des routes modifiée : %s" % ecarts(actuelle, figee)


def modules_du_decoupage() -> list:
    """Modules d'endpoints d'une famille découpée : `kojo_routers_<famille>_<sujet>.py`.

    Dérivé du DOSSIER, et c'est tout l'intérêt : une famille dont un module
    porterait des routes sans être monté par son composeur n'apparaîtrait ni
    dans la famille dérivée du composeur ni dans l'application — les deux
    dérivent du même montage, donc le trou est invisible aux deux. Le seul
    périmètre qui puisse le voir est le dossier.
    """
    return sorted(
        path for path in BACKEND_DIR.glob("kojo_routers_*_*.py") if path.is_file()
    )


def routes_du_module(chemin: Path) -> set:
    """(chemin, méthode) des routes DÉCLARÉES par un module de la famille, sans
    préfixe : le préfixe est celui du montage, que l'on cherche justement à
    vérifier.

    Le module est importé par son NOM (pas par chemin) : un module orphelin —
    celui que personne ne monte — est exactement celui qu'on doit pouvoir
    interroger, et il doit s'importer comme les autres.
    """
    import importlib

    module = importlib.import_module(chemin.stem)
    routeur_ = getattr(module, "router", None)
    if routeur_ is None:
        return set()
    return {
        (route.path, methode)
        for route in routeur_.routes
        for methode in route.methods
    }
