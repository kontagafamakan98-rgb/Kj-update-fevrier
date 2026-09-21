# -*- coding: utf-8 -*-
"""La surface publique de `kojo_core` reste celle d'AVANT son découpage.

POURQUOI CE FICHIER

`kojo_core` est le module que tout le dépôt importe : `db`, les dépendances
d'authentification, les middlewares, les validateurs, les helpers d'origines.
Le découper en modules par concern ne doit RIEN changer pour ses importeurs —
ni un nom disparu, ni une signature modifiée, ni un `patch("kojo_core.X")` qui
ne remplace plus rien (un patch qui ne prend plus est un test qui ne mesure
plus, et c'est le pire des deux mondes).

COMMENT LA SURFACE EST DÉRIVÉE (jamais recopiée)

Deux dérivations, chacune sur son fait :

  * les noms IMPORTÉS et les cibles de `patch`/`setattr` viennent de l'ARBRE
    SYNTAXIQUE des fichiers du dépôt — une prose qui cite `kojo_core.py` ou
    `kojo_core.X` n'entre donc pas dans le contrat ;
  * les noms MENTIONNÉS (`kojo_core.<nom>`) sont lus au texte, puis filtrés :
    seuls ceux que `kojo_core` sert réellement sont figés (le reste est de la
    documentation).

Ajouter un nom au contrat ne se fait donc pas en éditant une liste ici : c'est
un importeur, un patch ou le module lui-même qui l'exige.

CE QUI EST FIGÉ

  * la présence du nom ;
  * sa NATURE (fonction, coroutine, classe, module, valeur) ;
  * sa SIGNATURE exacte, pour les appelables.

Ce qui n'est PAS figé ici, volontairement : la valeur d'une constante. Elle
dépend de l'environnement (`OWNER_USER_ID`, `JWT_SECRET`, …) et la figer
rendrait le contrat rouge sur une configuration légitime. Le comportement, lui,
est figé par la suite complète, et `tests/test_core_db_seam.py` interdit qu'un
module lie `db` à une autre source que celle que les tests remplacent.
"""
from __future__ import annotations

import ast
import inspect
import json
import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
BACKEND = RACINE / "backend"
INSTANTANE = Path(__file__).with_name("core_surface.json")

# Les mentions par attribut : lues au texte, parce qu'un `patch` reçoit une
# chaîne et qu'un accès conditionnel peut être dynamique. Filtrées ensuite sur
# ce que le module sert réellement.
MOTIF_MENTION = re.compile(r"\bkojo_core\.([A-Za-z_][A-Za-z0-9_]*)")

# Sous ce seuil, la dérivation est cassée, pas le contrat : on refuse de
# conclure plutôt que de passer au vert sur une surface vide.
MINIMUM_DE_NOMS = 15


def _fichiers_du_depot() -> list[Path]:
    """Tous les fichiers Python qui peuvent citer `kojo_core`, dérivés du DOSSIER.

    Un fichier ajouté demain (routeur, script, test, garde) entre tout seul dans
    le périmètre : rien à tenir à jour.
    """
    racines = [BACKEND, RACINE / ".github" / "scripts", RACINE / "frontend" / "scripts"]
    trouves: list[Path] = []
    for racine in racines:
        if not racine.exists():
            continue
        for chemin in sorted(racine.rglob("*.py")):
            if "__pycache__" in chemin.parts or chemin.name == "kojo_core.py":
                continue
            trouves.append(chemin)
    return trouves


def _arbre(chemin: Path):
    try:
        return ast.parse(chemin.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        return None


def noms_importes() -> set[str]:
    """Les noms que le dépôt IMPORTE de `kojo_core` (`from kojo_core import …`)."""
    noms: set[str] = set()
    for chemin in _fichiers_du_depot():
        arbre = _arbre(chemin)
        if arbre is None:
            continue
        for noeud in ast.walk(arbre):
            if isinstance(noeud, ast.ImportFrom) and noeud.module == "kojo_core":
                noms |= {alias.name for alias in noeud.names if alias.name != "*"}
    return noms


MOTIF_CIBLE = re.compile(r"^(kojo_[a-z_]+)\.([A-Za-z_][A-Za-z0-9_.]*)$")


def cibles_de_patch() -> set[tuple[str, str]]:
    """Les (module, attribut) que la suite REMPLACE, lus sur les APPELS.

    Lues sur l'arbre et non au texte : une prose qui parle de `kojo_core.py`
    n'est pas une cible de patch. Ces cibles sont les plus fragiles d'un
    découpage — un nom qui change de module existe encore, mais le patch ne
    remplace plus ce que le code LIT.

    Le périmètre est celui des modules `kojo_*` : après le découpage,
    `patch("kojo_core.db")` a dû devenir `patch("kojo_db.db")`, et une cible qui
    pointerait vers un module inexistant passerait en silence jusqu'à
    l'exécution. Le chemin de l'attribut est rendu ENTIER
    (`kojo_cloudinary.cloudinary.api.ping`).
    """
    cibles: set[tuple[str, str]] = set()
    for chemin in sorted((BACKEND / "tests").rglob("*.py")):
        arbre = _arbre(chemin)
        if arbre is None:
            continue
        for noeud in ast.walk(arbre):
            if not isinstance(noeud, ast.Call) or not noeud.args:
                continue
            fonction = noeud.func
            nom_appele = getattr(fonction, "attr", None) or getattr(fonction, "id", None)
            if nom_appele not in {"patch", "setattr"}:
                continue
            premier = noeud.args[0]
            if isinstance(premier, ast.Constant) and isinstance(premier.value, str):
                trouve = MOTIF_CIBLE.match(premier.value)
                if trouve:
                    cibles.add((trouve.group(1), trouve.group(2)))
    return cibles


def noms_mentionnes() -> set[str]:
    """Les noms cités `kojo_core.<nom>` au texte, prose comprise (filtrée après)."""
    mentions: set[str] = set()
    for chemin in _fichiers_du_depot():
        source = chemin.read_text(encoding="utf-8", errors="replace")
        mentions |= set(MOTIF_MENTION.findall(source))
    return mentions


def nature(valeur) -> dict:
    """Nature + signature d'un nom, telles qu'un importeur les voit."""
    if inspect.iscoroutinefunction(valeur):
        return {"nature": "coroutine", "signature": str(inspect.signature(valeur))}
    if inspect.isfunction(valeur):
        return {"nature": "fonction", "signature": str(inspect.signature(valeur))}
    if inspect.isclass(valeur):
        try:
            return {"nature": "classe", "signature": str(inspect.signature(valeur))}
        except (TypeError, ValueError):
            return {"nature": "classe", "signature": "(classe sans signature lisible)"}
    if inspect.ismodule(valeur):
        return {"nature": "module", "signature": ""}
    return {"nature": "valeur", "signature": ""}


def surface() -> dict:
    """La surface réellement servie : mentions filtrées sur ce que le module sert."""
    import kojo_core

    candidats = noms_importes() | noms_mentionnes()
    # Les cibles de patch visant `kojo_core` comptent aussi : c'est ce que les
    # tests remplacent, donc ce que la façade doit continuer de servir.
    candidats |= {
        attribut.split(".", 1)[0]
        for module, attribut in cibles_de_patch()
        if module == "kojo_core"
    }
    figes: dict[str, dict] = {}
    for nom in sorted(candidats):
        if hasattr(kojo_core, nom):
            figes[nom] = nature(getattr(kojo_core, nom))
    return figes


@pytest.fixture(scope="module")
def figee() -> dict:
    return json.loads(INSTANTANE.read_text(encoding="utf-8"))


class TestSurfacePubliqueDeKojoCore:
    """Ce que le découpage n'a pas le droit de changer."""

    def test_la_derivation_trouve_bien_des_noms(self):
        """Un contrat vide passerait toujours : on refuse de conclure."""
        assert len(surface()) >= MINIMUM_DE_NOMS, (
            "la dérivation a trouvé %d nom(s) : le contrat ne mesurerait rien "
            "(fichiers introuvables ? motif cassé ?)" % len(surface())
        )

    def test_a_chaque_importeur_son_nom_est_toujours_servi(self):
        """Un nom importé qui disparaît est LE mode d'échec d'un découpage."""
        import kojo_core

        manquants = sorted(nom for nom in noms_importes() if not hasattr(kojo_core, nom))
        assert manquants == [], (
            "ces noms sont IMPORTÉS du dépôt et ne sont plus servis par "
            "kojo_core : %s" % manquants
        )

    def test_chaque_cible_de_patch_des_tests_existe_encore(self):
        """Toute cible `patch("kojo_*.X")` doit viser un module et un nom réels."""
        import importlib

        cibles = cibles_de_patch()
        assert len(cibles) >= 10, (
            "seules %d cible(s) de patch dérivée(s) : le contrôle ne mesurerait "
            "rien (%s)" % (len(cibles), sorted(cibles))
        )
        irresolues = []
        for module, attribut in sorted(cibles):
            try:
                objet = importlib.import_module(module)
            except ImportError:
                irresolues.append("%s : module introuvable" % module)
                continue
            tete = attribut.split(".", 1)[0]
            if not hasattr(objet, tete):
                irresolues.append("%s.%s : %s ne sert plus" % (module, attribut, tete))
        assert irresolues == [], (
            "des tests remplacent des noms qui n'existent plus : %s" % irresolues
        )

    def test_aucun_nom_du_contrat_n_a_change_de_nature_ni_de_signature(self, figee):
        """La surface SERVIE == la surface figée AVANT le découpage, nommée.

        Le contrôle lit la valeur réellement servie (`getattr`), et non la
        dérivation : un nom figé que plus personne ne cite (une cible de patch
        déplacée, par exemple) doit continuer d'être servi par la façade.
        """
        import kojo_core

        ecarts = []
        for nom, attendu in sorted(figee.items()):
            if not hasattr(kojo_core, nom):
                ecarts.append("%s : %s ne le sert plus" % (nom, "kojo_core"))
                continue
            obtenu = nature(getattr(kojo_core, nom))
            if obtenu["nature"] != attendu["nature"]:
                ecarts.append(
                    "%s : nature %s -> %s" % (nom, attendu["nature"], obtenu["nature"])
                )
            elif obtenu["signature"] != attendu["signature"]:
                ecarts.append(
                    "%s : signature %s -> %s"
                    % (nom, attendu["signature"], obtenu["signature"])
                )
        assert ecarts == [], "la surface publique de kojo_core a changé :\n  - " + "\n  - ".join(ecarts)
