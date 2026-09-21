# -*- coding: utf-8 -*-
"""Contrat de surface de TOUTE l'application, famille par famille.

CE QUI EST PROTÉGÉ

`server.app` expose une surface : pour chaque route, sa méthode, son chemin, son
nom d'endpoint, son `response_model`, son code de statut, ET ses dépendances
atteignables (donc l'authentification — c'est `Depends(get_current_user)` qui
décide qui peut appeler quoi), dans l'ORDRE d'enregistrement. Ce fichier la
découpe en FAMILLES et fige chaque famille dans son propre instantané.

POURQUOI PAR FAMILLE ET PAS EN UN BLOC

Un découpage — l'opération qui fait bouger ce dépôt — ne doit rien changer à la
surface. Avec un instantané unique, un découpage produirait un diff de 103
lignes où la revue ne verrait plus rien ; avec un instantané par famille, un
découpage bien fait ne touche AUCUN fichier, et le diff d'une vraie régression
tient dans la famille concernée. Les instantanés des deux familles déjà
découpées sont d'ailleurs ceux pris sur l'arbre d'AVANT leur découpage : la
preuve d'alors est devenue le contrat de maintenant, sans être refaite.

COMMENT LA FAMILLE EST DÉRIVÉE (jamais recopiée)

Du DOSSIER, et de la règle de nommage que le dépôt applique déjà
(`kojo_routers_<famille>_<sujet>.py` monté par `kojo_routers_<famille>.py`) :

  * un module porte des routes s'il assigne un `APIRouter` au niveau module ;
  * sa famille est le plus long préfixe de son nom qui soit un AUTRE module du
    dossier (`kojo_routers_users_referral` → `users`, `kojo_routers_auth` →
    `auth`) ;
  * les routes que `server.py` monte lui-même forment la famille `server`.

Le reste de la surface est FRAMEWORK (`/docs`, `/openapi.json`, `/redoc`) : sa
forme appartient à la dépendance, pas au produit — elle est contrôlée comme
telle (tout ce qui existe hors des familles doit venir de `fastapi`/`starlette`,
nommément sinon), et non figée, pour qu'une montée de version ne fasse pas
rougir un contrat qui n'a rien à voir.

CE QUI EST VÉRIFIÉ

  * chaque famille a son instantané, et la surface montée == la référence ;
  * aucune famille n'est vide, et la dérivation n'est pas vide non plus (une
    dérivation cassée passerait sinon en ne vérifiant rien) ;
  * tout module du dossier qui DÉCLARE des routes les voit SERVIES : c'est le
    mode d'échec qu'aucun contrat dérivé du montage ne peut voir — un module
    oublié par son composeur n'apparaît ni dans la famille ni dans
    l'application, puisque les deux viennent du même montage ;
  * hors des familles, la surface est celle du framework, nommée si ce n'est pas
    le cas.

COÛT DE MAINTENANCE, MESURÉ

Ajouter, renommer ou retirer une route : un instantané change (celui de sa
famille), et c'est le seul fichier à relire. Découper une famille : AUCUN
instantané ne change — c'est le but. Ajouter une famille : son instantané
manque, le test le dit en la nommant, et la commande ci-dessous le crée.

    KOJO_FREEZE_ROUTE_SURFACE=1 python -m pytest tests/test_route_surface.py

puis relire le diff des JSON ajoutés/modifiés et les committer — le fichier EST
la revue. Aucune liste n'est tenue à la main ici : ni les familles, ni les
fichiers d'instantanés, ni les modules.
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path

from fastapi.routing import APIRoute

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Les instantanés vivent dans leur propre dossier : une famille = un fichier,
# donc le diff d'une régression est le diff d'un fichier.
INSTANTANES = Path(__file__).resolve().parent / "surface"

# Le seul chemin d'écriture d'une référence : une variable d'environnement
# explicite, pour qu'aucune exécution ordinaire ne puisse réécrire en silence
# l'arbre contre lequel le contrat est vérifié.
FREEZE = "KOJO_FREEZE_ROUTE_SURFACE"

# Modules du framework : leur surface appartient à la dépendance. Le préfixe est
# testé, pas une liste de chemins — une route d'un tiers ajoutée demain entre
# dans le même seau sans qu'on touche à ce fichier.
MODULES_FRAMEWORK = ("fastapi", "starlette", "pydantic")

# Sous ces seuils, la dérivation est cassée, pas le contrat : on refuse de
# conclure plutôt que de passer au vert sur une surface vide.
MINIMUM_DE_FAMILLES = 8
MINIMUM_DE_ROUTES = 80

# La FAÇADE par laquelle les consommateurs importent ces noms.
#
# Un appelable a un `__module__` qui dit où il est ÉCRIT — un rangement de
# fichiers, pas la surface publique. Le figer rendrait le contrat rouge sur un
# déplacement de code qui ne change RIEN pour un appelant, et un contrat qu'on
# régénère à chaque déplacement ne mesure plus rien. On nomme donc l'appelable
# par la façade quand elle le sert : le contrat dit « la route est protégée par
# `kojo_core.get_current_user` », ce qui est vrai tant que la façade le sert, et
# devient faux — donc rouge — le jour où elle cesse de le servir.
FACADE = "kojo_core"


def nom(callable_) -> str:
    """Nom STABLE d'une dépendance (« kojo_core.get_current_user »).

    Une dépendance peut être une fonction (`get_current_user`) ou une INSTANCE
    (le `HTTPBearer()` que FastAPI pose en sous-dépendance). Pour l'instance, le
    repli évident — `repr()` — porte une ADRESSE MÉMOIRE : le nom changerait à
    chaque exécution et la référence figée ne vaudrait plus rien. On nomme donc
    sa CLASSE, qui est ce qui décide du comportement.
    """
    nom_ = getattr(callable_, "__qualname__", None)
    if nom_ and "." not in nom_:
        # Fonction de premier niveau : la façade prime sur le rangement.
        import kojo_core

        if getattr(kojo_core, nom_, None) is callable_:
            return "%s.%s" % (FACADE, nom_)
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


# ── La famille d'un module ────────────────────────────────────────────────────


def famille_du_module(module: str) -> str:
    """La famille d'un nom de module, dérivée du DOSSIER.

    Un module `kojo_routers_users_referral` appartient à `users` si — et
    seulement si — `kojo_routers_users.py` existe dans le dossier : c'est la
    règle de nommage du dépôt (le composeur porte la famille), pas une
    heuristique sur les underscores. Un module sans composeur est sa propre
    famille, et `server` est la famille des routes que `server.py` monte.
    """
    if module == "server":
        return "server"
    base = module
    for prefixe in ("kojo_routers_", "kojo_"):
        if base.startswith(prefixe):
            base = base[len(prefixe):]
            break
    morceaux = base.split("_")
    # Du plus long au plus court, en EXCLUANT le module lui-même : le plus long
    # préfixe dont le fichier existe est le composeur de la famille.
    for taille in range(len(morceaux) - 1, 0, -1):
        candidat = "_".join(morceaux[:taille])
        if (BACKEND_DIR / ("kojo_routers_%s.py" % candidat)).is_file():
            return candidat
    return base


def famille_du_endpoint(route) -> str:
    return famille_du_module(getattr(route.endpoint, "__module__", "") or "?")


# ── Les porteurs de routes, dérivés du dossier ────────────────────────────────


def _arbres_du_dossier() -> dict[str, ast.Module]:
    """L'AST de chaque module `kojo_*.py` du dossier, lu depuis le DISQUE."""
    arbres = {}
    for chemin in sorted(BACKEND_DIR.glob("kojo_*.py")):
        try:
            arbres[chemin.stem] = ast.parse(chemin.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
    return arbres


def _routeurs_declares(arbre: ast.Module) -> list[str]:
    """Les variables de niveau module qui reçoivent un `APIRouter(...)`."""
    noms = []
    for noeud in arbre.body:
        if not isinstance(noeud, ast.Assign):
            continue
        if not isinstance(noeud.value, ast.Call):
            continue
        appele = noeud.value.func
        if getattr(appele, "id", None) != "APIRouter" and getattr(appele, "attr", None) != "APIRouter":
            continue
        noms.extend(t.id for t in noeud.targets if isinstance(t, ast.Name))
    return noms


def porteurs() -> dict[str, list[str]]:
    """{module : [variables de routeur]} pour tout module qui DÉCLARE des routes.

    Dérivé du dossier : un module ajouté demain entre tout seul dans le
    contrôle, sans qu'aucune liste ici ne change.
    """
    trouves = {}
    for nom_module, arbre in _arbres_du_dossier().items():
        variables = _routeurs_declares(arbre)
        if variables:
            trouves[nom_module] = variables
    return trouves


def routes_declarees(nom_module: str) -> set:
    """(méthode, chemin RELATIF au montage) que ce module déclare LUI-MÊME.

    `include_router` recopie les routes incluses dans le routeur du parent : un
    composeur porterait donc les routes de ses modules, et le contrôle
    d'orphelin l'accuserait à leur place. On ne garde que les routes dont
    l'endpoint est ÉCRIT ici — celles des autres appartiennent aux autres, et
    c'est par leur propre module qu'elles sont vérifiées.
    """
    import importlib

    module = importlib.import_module(nom_module)
    routes = set()
    for variable in porteurs().get(nom_module, []):
        routeur_ = getattr(module, variable, None)
        for route in getattr(routeur_, "routes", []) or []:
            if (getattr(route.endpoint, "__module__", "") or "") != nom_module:
                continue
            for methode in getattr(route, "methods", None) or []:
                routes.add((methode, route.path))
    return routes


# ── La surface réellement montée, découpée en familles ────────────────────────


def _routes_de_l_application() -> list:
    """Les APIRoute de `server.app`, dans l'ordre d'enregistrement."""
    from server import app

    return [route for route in app.routes if isinstance(route, APIRoute)]


def _decrire(route) -> dict:
    modele = getattr(route, "response_model", None)
    return {
        "methode": None,  # rempli par l'appelant, une entrée par méthode
        "chemin": route.path,
        "nom": route.name,
        "code": route.status_code,
        "response_model": nom(modele) if modele is not None else None,
        "dependances": dependances(route.dependant),
    }


def surface() -> dict[str, list]:
    """{famille : [routes montées]} — une entrée par (route, méthode)."""
    familles: dict[str, list] = {}
    for route in _routes_de_l_application():
        famille = famille_du_endpoint(route)
        for methode in sorted(route.methods):
            entree = _decrire(route)
            entree["methode"] = methode
            familles.setdefault(famille, []).append(entree)
    return familles


def familles() -> list[str]:
    """Les familles de l'application, triées."""
    return sorted(surface())


def routes_servies(nom_module: str) -> set:
    """(méthode, chemin monté) servies par l'application pour ce module."""
    return {
        (methode, route.path)
        for route in _routes_de_l_application()
        if (getattr(route.endpoint, "__module__", "") or "") == nom_module
        for methode in route.methods
    }


def routes_hors_famille() -> list[str]:
    """Toute route de l'application qui n'appartient pas au produit.

    Seuls les modules du framework sont admis (`/docs`, `/openapi.json`,
    `/redoc`, et ce que Starlette monte pour eux). Une route d'un module
    inconnu, ou un montage d'une application tierce, est nommée : c'est le seul
    angle par lequel une surface pourrait échapper aux familles.
    """
    from server import app

    inconnues = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            continue
        endpoint = getattr(route, "endpoint", None)
        module = (getattr(endpoint, "__module__", "") or "") or type(route).__module__
        if module.split(".")[0] in MODULES_FRAMEWORK:
            continue
        inconnues.append("%s (%s) vient de %s" % (getattr(route, "path", "?"), type(route).__name__, module))
    return inconnues


# ── Les instantanés et le verdict ─────────────────────────────────────────────


def instantane_de(famille: str) -> Path:
    return INSTANTANES / ("route_surface_%s.json" % famille)


def familles_gelees() -> list[str]:
    """Les familles qui ont un instantané, dérivées du DOSSIER des instantanés.

    Sert au contrôle inverse de l'orphelin : une famille qui disparaît de
    l'application laisserait son fichier derrière elle, et plus rien ne le
    lirait — le contrat resterait vert sur du vide.
    """
    if not INSTANTANES.is_dir():
        return []
    prefixe = "route_surface_"
    return sorted(
        chemin.stem[len(prefixe):]
        for chemin in INSTANTANES.glob("%s*.json" % prefixe)
    )


def ecrire(chemin: Path, contenu) -> None:
    """Écrit une référence de façon DÉTERMINISTE.

    `newline="\\n"` fige la représentation quel que soit l'OS : sans lui, un gel
    fait sous Windows écrit des CRLF que git normalise ensuite en silence — la
    référence changerait d'octets sans qu'aucun test ne le dise.
    """
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(
        json.dumps(contenu, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def geler(familles_: dict[str, list]) -> list[str]:
    """Réécrit les instantanés des familles données. Rend les fichiers touchés."""
    touches = []
    for famille, routes in sorted(familles_.items()):
        chemin = instantane_de(famille)
        avant = chemin.read_text(encoding="utf-8") if chemin.exists() else None
        ecrire(chemin, routes)
        if avant != chemin.read_text(encoding="utf-8"):
            touches.append(chemin.name)
    return touches


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


def verifier_famille(famille: str) -> None:
    """Le verdict d'UNE famille : sa surface montée == sa référence, ou un écart NOMMÉ.

    Sous `KOJO_FREEZE_ROUTE_SURFACE=1`, la référence est réécrite (et le test est
    sauté) : c'est la seule façon de la faire évoluer, et elle exige de relire le
    diff.
    """
    import pytest

    actuelle = surface().get(famille, [])
    chemin = instantane_de(famille)
    if os.environ.get(FREEZE) == "1":
        touches = geler(surface())
        pytest.skip(
            "instantanés regénérés (%s) — relire le diff et le committer" % (", ".join(touches) or "aucun changement")
        )
    assert chemin.is_file(), (
        "la famille « %s » n'a pas d'instantané (%s) : une famille neuve — donc un "
        "module neuf ou un déplacement de routes — doit être gelée explicitement"
        % (famille, chemin.name)
    )
    figee = json.loads(chemin.read_text(encoding="utf-8"))
    assert actuelle == figee, "surface de la famille « %s » modifiée : %s" % (
        famille,
        ecarts(actuelle, figee),
    )
