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


_ADRESSE_MEMOIRE = re.compile(r" object at 0x[0-9a-fA-F]+")
# FastAPI rend un même `Depends(HTTPBearer)` tantôt sous sa forme courte, tantôt
# sous sa forme détaillée `Depends(dependency=<fastapi.….HTTPBearer>, use_cache=True,
# scope=None)` : le rendu varie d'un processus à l'autre. On ramène les deux au
# même nom court, sans quoi la référence serait instable.
_DEPENDS = re.compile(r"Depends\((?:dependency=)?<?([\w.]+)[^)]*\)")

# ── Les unions de types : UN rendu, quel que soit l'interpréteur ──────────────
#
# MESURÉ LE 30/10/2026 : `pytest tests` sur Python **3.14.7** rendait ROUGE ce
# contrat sur un arbre sain, avec onze écarts tous de la même forme —
# `() -> Optional[Any]` figé, `() -> Any | None` observé. Depuis Python 3.14,
# `inspect.signature` rend les annotations via `annotationlib`, qui applique PEP
# 604 : `Optional[X]` devient `X | None`. Le dépôt vise 3.11
# (`backend/Dockerfile`, `ci.yml`), donc la CI ne voyait rien — et un
# développeur en 3.14 voyait un check REQUIS rouge sans pouvoir l'expliquer.
#
# La correction ne touche PAS les valeurs figées (elles restent lisibles en
# `Optional[…]`, la forme sous laquelle le code les écrit) : les DEUX côtés
# passent par `_forme_barre`, qui ramène `Optional[X]` / `Union[X, Y]` à
# `X | None` / `X | Y`. Un contrat de surface décrit ce que les importeurs
# lisent, pas la façon dont l'interpréteur du jour réécrit une annotation.
_UNION = re.compile(r"(?<!\w)(?:typing\.)?(Optional|Union)\[")
_FERMETURES = {"[": "]", "(": ")"}


def _fermeture(texte: str, ouverture: int):
    """L'indice qui équilibre l'ouverture située en `ouverture`, ou None."""
    pile = []
    for indice in range(ouverture, len(texte)):
        caractere = texte[indice]
        if caractere in _FERMETURES:
            pile.append(_FERMETURES[caractere])
        elif pile and caractere == pile[-1]:
            pile.pop()
            if not pile:
                return indice
    return None


def _morceaux(texte: str) -> list[str]:
    """Les arguments de PREMIER niveau d'une union (les virgules internes restent)."""
    morceaux, profondeur, debut = [], 0, 0
    for indice, caractere in enumerate(texte):
        if caractere in "[(":
            profondeur += 1
        elif caractere in "])":
            profondeur -= 1
        elif caractere == "," and profondeur == 0:
            morceaux.append(texte[debut:indice])
            debut = indice + 1
    morceaux.append(texte[debut:])
    return [morceau.strip() for morceau in morceaux if morceau.strip()]


def _forme_barre(texte: str) -> str:
    """`Optional[X]` → `X | None`, `Union[X, Y]` → `X | Y` (PEP 604), partout.

    Récursif : une union imbriquée (`Optional[Union[str, int]]`) est ramenée
    aussi, et un texte déjà rendu en `|` (Python ≥ 3.14) est laissé tel quel —
    c'est ce qui rend les deux côtés comparables sans figer d'interpréteur.
    """
    sortie, indice = [], 0
    while indice < len(texte):
        trouve = _UNION.search(texte, indice)
        if not trouve:
            sortie.append(texte[indice:])
            break
        ouverture = trouve.end() - 1
        fermeture = _fermeture(texte, ouverture)
        if fermeture is None:
            # Union non fermée (signature illisible) : on ne bricole pas.
            sortie.append(texte[indice:])
            break
        sortie.append(texte[indice:trouve.start()])
        membres = [_forme_barre(membre) for membre in _morceaux(texte[ouverture + 1:fermeture])]
        if trouve.group(1) == "Optional":
            membres.append("None")
        sortie.append(" | ".join(membres))
        indice = fermeture + 1
    return "".join(sortie)


def _signature(valeur) -> str:
    """La signature telle qu'un importeur la lit, SANS ce qui varie d'un
    processus ou d'une version de Python à l'autre.

    Trois instabilités connues sont ramenées à une seule forme : l'adresse
    mémoire (change à chaque processus), le rendu détaillé de `Depends` (change
    d'une version de FastAPI à l'autre), et l'écriture des unions (change avec
    PEP 604, donc avec l'interpréteur). Noms, annotations et défauts restent
    comparés tels quels.
    """
    brut = _ADRESSE_MEMOIRE.sub("", str(inspect.signature(valeur)))
    brut = _DEPENDS.sub(lambda m: "Depends(%s)" % m.group(1).split(".")[-1], brut)
    return _forme_barre(brut)


def nature(valeur) -> dict:
    """Nature + signature d'un nom, telles qu'un importeur les voit."""
    if inspect.iscoroutinefunction(valeur):
        return {"nature": "coroutine", "signature": _signature(valeur)}
    if inspect.isfunction(valeur):
        return {"nature": "fonction", "signature": _signature(valeur)}
    if inspect.isclass(valeur):
        try:
            return {"nature": "classe", "signature": _signature(valeur)}
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
            # La référence est écrite en `Optional[…]` (la forme du code) et
            # l'observation peut venir d'un interpréteur qui rend `X | None` :
            # les deux passent par la MÊME forme avant d'être comparées (cf.
            # `_forme_barre`, et le cas qui le prouve dans `TestLeRenduDesUnions`).
            elif obtenu["signature"] != _forme_barre(attendu["signature"]):
                ecarts.append(
                    "%s : signature %s -> %s"
                    % (nom, attendu["signature"], obtenu["signature"])
                )
        assert ecarts == [], "la surface publique de kojo_core a changé :\n  - " + "\n  - ".join(ecarts)


class TestLeRenduDesUnions:
    """Le contrat ne dépend PAS de l'interpréteur qui le lit (30/10/2026).

    Le 30/10/2026, `pytest tests` sur Python 3.14.7 rendait ce fichier ROUGE sur
    un arbre sain : `inspect.signature` y rend les annotations via
    `annotationlib`, qui applique PEP 604 — `() -> Optional[Any]` figé,
    `() -> Any | None` observé, onze fois. La CI (3.11) ne voyait rien, et un
    développement en 3.14 voyait un check requis rouge sans explication.

    Ces cas prouvent que les deux écritures sont ramenées à une seule, y compris
    imbriquées, et que la comparaison du contrat RÉEL passe par ce rendu.
    """

    def test_les_deux_ecritures_d_une_union_donnent_le_meme_texte(self):
        paires = [
            # Le cas exact du 30/10, onze fois dans la référence.
            ("() -> Optional[Any]", "() -> Any | None"),
            # Une union à deux membres, et un défaut qui suit l'annotation.
            ("(jti: Optional[str]) -> bool", "(jti: str | None) -> bool"),
            ("(hashed: Optional[str] = None)", "(hashed: str | None = None)"),
            # La virgule INTERNE ne doit pas être prise pour un séparateur
            # d'union : `Dict[str, str]` est UN argument, pas deux.
            (
                "(env: Optional[Dict[str, str]] = None)",
                "(env: Dict[str, str] | None = None)",
            ),
            # `Union` explicite, et une union imbriquée dans une autre.
            ("(v: Union[str, int])", "(v: str | int)"),
            ("(v: Optional[Union[str, int]])", "(v: str | int | None)"),
            # Une qualification complète, telle que FastAPI la rend.
            (
                "(credentials: Optional[fastapi.security.http.HTTPAuthorizationCredentials])",
                "(credentials: fastapi.security.http.HTTPAuthorizationCredentials | None)",
            ),
        ]

        for reference, observee in paires:
            assert _forme_barre(reference) == _forme_barre(observee), (
                "« %s » et « %s » devraient décrire la MÊME signature"
                % (reference, observee)
            )

    def test_une_signature_sans_union_traverse_le_rendu_intacte(self):
        # Non-vacuité : le rendu ne réécrit pas ce qui n'est pas une union (et
        # notamment pas une barre qui appartiendrait à un défaut).
        for texte in (
            "(password: str, hashed: str) -> bool",
            "(request: starlette.requests.Request) -> kojo_models.User",
            "(a: int = 1, b: str = 'x, y') -> None",
        ):
            assert _forme_barre(texte) == texte

    def test_l_observation_est_rendue_en_forme_barre(self):
        """`_signature` rend TOUJOURS `X | None`, quel que soit l'interpréteur.

        MESURÉ le 30/10/2026 sur trois interpréteurs, même code :
        `3.11.17` et `3.13.14` rendent `(jti: Optional[str]) -> bool`,
        `3.14.7` rend `(jti: str | None) -> bool`. La citation est donc écrite
        en forme BARRE — sur ≤ 3.13, retirer `_forme_barre` de `_signature`
        rougit ICI ; sur 3.14, le cas serait vert de toute façon, et c'est
        écrit plutôt que caché : la normalisation sert aux interpréteurs qui
        rendent encore `Optional[…]`, donc à ceux que la CI exécute (3.11).
        """
        import kojo_core

        observee = nature(kojo_core.is_token_revoked)["signature"]
        assert observee == "(jti: str | None) -> bool", (
            "l'observation n'est pas ramenée en forme barre : %r — sur un "
            "interpréteur qui rend `Optional[jti]`, la référence figée (elle "
            "aussi ramenée en forme barre) ne lui serait plus comparable" % observee
        )

    def test_le_contrat_reel_se_compare_dans_les_deux_ecritures(self, figee):
        """Le nom porteur d'un `Optional` figé passe, quel que soit le Python.

        C'est le cas qui ROUGIT si `_signature` cesse de ramener les unions :
        la référence serait rendue en `X | None`, l'observation resterait en
        `Optional[X]` (ou l'inverse), et le nom serait déclaré « changé ».
        """
        import kojo_core

        nom = "is_token_revoked"
        assert nom in figee, (
            "« %s » a quitté la référence figée : ce cas ne prouverait plus rien"
            % nom
        )
        attendu = figee[nom]["signature"]
        assert "Optional[" in attendu, (
            "la référence de « %s » ne porte plus d'union (%r) : relire la "
            "référence avant de conclure" % (nom, attendu)
        )
        observee = nature(getattr(kojo_core, nom))["signature"]
        assert observee == _forme_barre(attendu), (
            "« %s » : observé %r, référence %r — le rendu des unions ne les "
            "ramène plus à la même forme" % (nom, observee, attendu)
        )
