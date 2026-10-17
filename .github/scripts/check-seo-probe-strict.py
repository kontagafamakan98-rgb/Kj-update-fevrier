#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refuse une invocation de la sonde SEO de production hors mode `--strict`.

Pourquoi ce garde
-----------------
La sonde SEO (`frontend/scripts/check-seo-production.js`) a DEUX modes, et le
mode informatif est celui qui a laissé F9 ouvert (CI-COVERAGE.md) : quatre
intégrations SEO/analytics absentes de la production, un rapport qui publiait un
`::notice` par fait constaté, aucune fusion bloquée, et **aucun run rouge nulle
part**. L'étape informative de `ci.yml` a été RETIRÉE le 10/10/2026 pour cette
raison exacte : un rapport qui ne peut pas échouer n'est pas une vérification.

Ce qui reste vrai aujourd'hui : la sonde tourne en `--strict` à TROIS endroits
qui bloquent — le cron `seo-production-probe.yml` (06:17), juste après la
vérification de la révision servie dans `frontend-build` (`ci.yml`, push sur
`main`), et dans le trajet de livraison local `npm run livrer`
(`.github/scripts/livrer.py`), juste après sa confirmation de la révision servie.
Rien, jusqu'ici, n'empêchait quelqu'un de reposer une étape informative — un
`::notice` sur chaque PR — et de rendre le silence à nouveau possible sans
qu'aucun garde ne rougisse : le mode par défaut du script EST l'informatif, donc
c'est l'oubli qui est silencieux, pas le rappel.

Ce que ce garde refuse
----------------------
Dans tout workflow de `.github/workflows/`, et dans la surface de livraison
`.github/scripts/livrer.py` :

1. une invocation de la sonde **sans `--strict`** — le mode informatif ne peut
   donc pas revenir, ni sur une PR ni dans un cron ;
2. une étape qui porte la sonde strict mais qui **ne peut pas échouer** :
   `continue-on-error` vrai, ou une commande neutralisée (`|| true`). La
   demande « refuse autre chose que `--strict` » vise ce cas-là aussi : une
   étape qui ne peut pas rougir est une étape informative, quel que soit son
   drapeau ;
3. il REFUSE DE CONCLURE s'il ne lit **aucune** invocation — un garde qui ne voit
   rien ne prouve rien (même règle que `check-workflow-pins.py`, qui échoue sur un
   workflow sans aucune référence `uses:`) —, ni si une surface DÉCLARÉE a
   disparu : réduire son périmètre en silence serait un faux vert de plus.

Ce qu'il lit, et ce qu'il ne lit pas
------------------------------------
Il lit les blocs `run:` des workflows — ligne à ligne, sans PyYAML, comme ses
voisins. Un `run:` est soit une commande en ligne, soit un bloc scalaire (`|`,
`>`), déplié et dé-indenté ; une commande continuée par `\\` est recollée avant
le jugement, sinon un `--strict` sur la ligne suivante serait un faux rouge. Les
COMMENTAIRES (lignes YAML `# …` et commentaires shell dans un bloc) ne sont pas
des commandes et ne sont jamais jugés — un commentaire qui cite la forme
retirée reste donc permis.

Ce qu'il lit, au-delà des workflows
-----------------------------------
`npm run livrer` (`.github/scripts/livrer.py`) lance la MÊME sonde stricte juste
après avoir confirmé la révision servie : c'est une TROISIÈME surface, et elle est
lue ici comme les workflows — en `--strict`, jamais autrement. Sans cela, retirer le
drapeau de ce fichier remettrait un verdict informatif dans le trajet de livraison
sans qu'aucun garde ne rougisse. Les `run:` des workflows sont lus ligne à ligne ;
un fichier PYTHON est lu par son AST : seule une LISTE D'ARGUMENTS passée à
`subprocess` (ou `Popen`) compte comme invocation, une prose qui cite le nom du
script n'en est pas une.

Ce qu'il ne couvre pas, et c'est écrit ici pour ne pas être pris pour couvert :
un appel **en processus** (`runSeoProductionReport`, importé par
`frontend/scripts/setup-seo-env.js`) n'est pas une invocation de CLI ; ce
script-là vérifie les valeurs qu'on lui FOURNIT et publie ses propres refus. Une
invocation dans un autre fichier que ceux lus ici (un outil local ajouté demain)
échapperait au garde : c'est pourquoi une surface DÉCLARÉE mais introuvable le
fait refuser de conclure, au lieu de réduire son périmètre en silence.

Usage :
    python3 .github/scripts/check-seo-probe-strict.py            # workflows + surface de livraison
    python3 .github/scripts/check-seo-probe-strict.py FICHIER…   # fixtures (tests)
    python3 .github/scripts/check-seo-probe-strict.py --root DIR # <DIR>/.github/workflows/*.yml + <DIR>/.github/scripts/livrer.py
Sortie : 0 si toutes les invocations sont strictes et capables d'échouer, 1 sinon
(annotations `::error` pour GitHub Actions).
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

# La sonde, désignée par son fichier : c'est ce que la commande appelle.
SONDE = "check-seo-production.js"
# Le mode qui BLOQUE. Sans lui, la sonde publie et rend 0.
MODE_STRICT = "--strict"
# Les surfaces NON-workflow qui invoquent la sonde. Déclarées, donc exigées : un
# fichier manquant est un refus, jamais un périmètre qui se réduit tout seul.
SURFACES_HORS_WORKFLOW = (".github/scripts/livrer.py",)

RUN = re.compile(r"^(?P<indent> *)run:(?P<reste>.*)$")
ITEM = re.compile(r"^(?P<indent> *)- ")
CONTINUE_ON_ERROR = re.compile(r"^\s*continue-on-error:\s*(true|yes|on|1)\s*$", re.IGNORECASE)
NEUTRALISATION = re.compile(r"\|\|\s*(true|:)\b")


def _indentation(ligne: str) -> int:
    return len(ligne) - len(ligne.lstrip(" "))


def _commandes(bloc: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Regroupe des lignes de script en COMMANDES.

    Une ligne terminée par `\\` continue la précédente : les recoller est ce qui
    évite de déclarer « sans --strict » une commande dont le drapeau est à la
    ligne suivante. La continuation suit la ligne IMMÉDIATEMENT suivante, comme
    dans le shell : une ligne VIDE la termine, et recoller par-dessus la ligne
    vide attribuerait à une invocation le drapeau d'une AUTRE commande (le
    shell, lui, sépare les deux) — un faux vert, donc.

    Les lignes vides et les commentaires shell ne sont pas des commandes, et un
    commentaire reçu EN CONTINUATION ne compte pas pour le drapeau : le shell
    retire le `\\` de fin de ligne avant de lire le commentaire, donc son texte
    n'appartient pas à la commande — le recopier laisserait un `--strict` cité
    dans un commentaire blanchir une invocation informative.
    """
    commandes: list[tuple[int, str]] = []
    continue_sur_la_suivante = False
    for numero, ligne in bloc:
        nue = ligne.strip()
        if not nue:
            # La ligne vide termine la ligne logique : la suivante est jugée
            # pour elle-même.
            continue_sur_la_suivante = False
            continue
        if continue_sur_la_suivante:
            if nue.startswith("#"):
                commandes[-1] = (commandes[-1][0], commandes[-1][1].rstrip()[:-1].strip())
                continue_sur_la_suivante = False
                continue
            commandes[-1] = (
                commandes[-1][0],
                f"{commandes[-1][1].rstrip()[:-1].strip()} {nue}",
            )
            continue_sur_la_suivante = commandes[-1][1].rstrip().endswith("\\")
            continue
        if nue.startswith("#"):
            continue
        commandes.append((numero, nue))
        continue_sur_la_suivante = nue.endswith("\\")
    return commandes


def _bloc_de_run(lignes: list[str], index: int) -> tuple[list[tuple[int, str]], int]:
    """Les lignes de script d'un `run:`, et l'index de reprise.

    Rend la commande en ligne (une seule ligne) ou le bloc scalaire déplié, avec
    le numéro de ligne d'origine de chaque ligne conservé — un refus doit citer
    une ligne qu'on peut ouvrir.
    """
    indent = _indentation(lignes[index])
    reste = RUN.match(lignes[index]).group("reste").strip()
    if reste and not reste.startswith(("|", ">")):
        return [(index + 1, reste)], index + 1

    bloc: list[tuple[int, str]] = []
    j = index + 1
    while j < len(lignes):
        ligne = lignes[j]
        if ligne.strip() and _indentation(ligne) <= indent:
            break
        bloc.append((j + 1, ligne[indent + 1 :] if len(ligne) > indent else ""))
        j += 1
    return bloc, j


def invocations(texte: str) -> list[tuple[int, str]]:
    """Les invocations de la sonde : `(numéro de ligne, commande)`."""
    lignes = texte.splitlines()
    trouvees: list[tuple[int, str]] = []
    index = 0
    while index < len(lignes):
        if RUN.match(lignes[index]):
            bloc, index = _bloc_de_run(lignes, index)
            trouvees.extend(
                (numero, commande) for numero, commande in _commandes(bloc) if SONDE in commande
            )
            continue
        index += 1
    return trouvees


def _indice_etape(lignes: list[str], index_run: int):
    """L'index de l'étape (`- name: …`) qui porte ce `run:`, ou None."""
    indent_run = _indentation(lignes[index_run])
    for i in range(index_run, -1, -1):
        correspondance = ITEM.match(lignes[i])
        if correspondance and _indentation(lignes[i]) < indent_run:
            return i
    return None


def _etape_du_run(lignes: list[str], index_run: int) -> list[str]:
    """Les lignes de l'étape : de son en-tête à l'item suivant de même niveau."""
    debut = _indice_etape(lignes, index_run)
    if debut is None:
        return [lignes[index_run]]
    indent = _indentation(lignes[debut])
    for j in range(debut + 1, len(lignes)):
        if lignes[j].strip() and _indentation(lignes[j]) <= indent:
            return lignes[debut:j]
    return lignes[debut:]


def invocations_python(source: str) -> list[tuple[int, str]]:
    """Les invocations de la sonde dans un fichier PYTHON : `(ligne, commande)`.

    Une invocation est une LISTE D'ARGUMENTS littérale passée à `subprocess` (ou
    `Popen`) qui cite la sonde — c'est l'AST qui le dit, pas une recherche de texte :
    un commentaire, une docstring ou un message qui nomment le script ne sont pas des
    commandes, et les confondre accuserait un fichier qui ne lance rien. Les éléments
    non littéraux (une variable, un `format`) sont ignorés, mais la commande rendue
    garde ce qui est lisible : la règle du drapeau juge ce que la liste DIT.

    Un fichier qui ne s'analyse pas LÈVE : « pas d'invocation » et « je n'ai pas pu
    lire » ne sont pas la même chose, et l'appelant les dit différemment.
    """
    arbre = ast.parse(source)
    trouvees: list[tuple[int, str]] = []
    for noeud in ast.walk(arbre):
        if not isinstance(noeud, ast.Call):
            continue
        fonction = noeud.func
        nom = fonction.attr if isinstance(fonction, ast.Attribute) else getattr(fonction, "id", "")
        if nom not in ("run", "check_output", "check_call", "call", "Popen"):
            continue
        if not noeud.args or not isinstance(noeud.args[0], (ast.List, ast.Tuple)):
            continue
        elements = [
            element.value
            for element in noeud.args[0].elts
            if isinstance(element, ast.Constant) and isinstance(element.value, str)
        ]
        if any(SONDE in element for element in elements):
            trouvees.append((noeud.lineno, " ".join(elements)))
    return trouvees


def manque_le_mode_strict(commande: str) -> bool:
    """La commande invoque-t-elle la sonde sans `--strict` ?"""
    return MODE_STRICT not in commande


def refus_commande(numero: int, commande: str, chemin: str) -> list[str]:
    """Le refus d'UNE commande, indépendamment de l'étape qui la porte.

    C'est la part que les surfaces hors workflow (le script de livraison) partagent
    avec les workflows : les deux règles qui ne dépendent que du TEXTE de la commande
    sont écrites ici, une seule fois.
    """
    if manque_le_mode_strict(commande):
        return [
            f"{chemin}:{numero} — `{commande}` : la sonde SEO s'invoque en `{MODE_STRICT}`. "
            "Le mode informatif publie un `::notice` par fait constaté et rend 0 — c'est ce "
            "silence qui a laissé F9 ouvert, et c'est pour ça que l'étape informative a été "
            "retirée de `ci.yml` le 10/10/2026. Une étape qui doit informer sans bloquer ne "
            "lance pas la sonde : elle lit son rapport à la main."
        ]
    if NEUTRALISATION.search(commande):
        return [
            f"{chemin}:{numero} — `{commande}` neutralise le code de sortie de la sonde stricte : "
            "un rapport qui ne peut pas échouer n'est pas une vérification."
        ]
    return []


def refus(texte: str, chemin: str = "workflow") -> list[str]:
    """Chaque refus d'un WORKFLOW, nommé : fichier, ligne, commande, et ce qu'il faut faire."""
    lignes = texte.splitlines()
    refusals: list[str] = []
    for numero, commande in invocations(texte):
        du_texte = refus_commande(numero, commande, chemin)
        if du_texte:
            refusals.extend(du_texte)
            continue
        # Le drapeau est là et la commande n'est pas neutralisée : reste à vérifier
        # que l'ÉTAPE peut rougir. `numero` est la ligne de la commande, donc de son
        # `run:`.
        etape = _etape_du_run(lignes, numero - 1)
        if any(CONTINUE_ON_ERROR.match(ligne) for ligne in etape):
            refusals.append(
                f"{chemin}:{numero} — l'étape porte `continue-on-error` : la sonde stricte y devient "
                "informative, son rouge ne rougit plus. Retirer la soupape, ou retirer l'étape."
            )
    return refusals


def fichiers_par_defaut() -> list[Path]:
    """Tous les workflows du dépôt — un workflow AJOUTÉ demain est couvert."""
    if not WORKFLOWS.is_dir():
        return []
    return sorted(WORKFLOWS.glob("*.yml"))


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    racine = REPO_ROOT
    if argv and argv[0] == "--root":
        racine = Path(argv[1])
        argv = argv[2:]
    chemins = [Path(a) for a in argv] if argv else (fichiers_par_defaut() if racine == REPO_ROOT else [])
    if not chemins and racine != REPO_ROOT:
        chemins = sorted((racine / ".github" / "workflows").glob("*.yml"))

    if not chemins:
        print(
            f"[ECHEC] aucun workflow lu dans {WORKFLOWS} — le garde ne peut rien vérifier. "
            "Un garde qui ne voit rien ne prouve rien."
        )
        print("::error title=Sonde SEO stricte::aucun workflow lu — le garde ne peut pas conclure")
        return 1

    refusals: list[str] = []
    conformes: list[str] = []
    for chemin in chemins:
        try:
            texte = chemin.read_text(encoding="utf-8")
        except OSError as erreur:
            refusals.append(f"{chemin} illisible ({erreur.strerror}) : le garde ne peut rien vérifier")
            continue
        trouvees = invocations(texte)
        for numero, commande in trouvees:
            conformes.append(f"{chemin}:{numero} {commande}")
        refusals.extend(refus(texte, str(chemin).replace("\\", "/")))

    # Les surfaces NON-workflow déclarées : lues avec le même verdict. Une surface
    # introuvable est un refus — un garde qui perd son sujet en silence prouverait
    # moins qu'il ne le dit.
    for relatif in SURFACES_HORS_WORKFLOW:
        chemin = racine / relatif
        if not chemin.is_file():
            refusals.append(
                f"{relatif} introuvable alors qu'il est déclaré invoquer la sonde : le garde "
                "ne peut pas prouver ce qu'il ne lit plus. Corriger ce garde ou lui rendre son "
                "sujet — jamais réduire le périmètre en silence."
            )
            continue
        try:
            source = chemin.read_text(encoding="utf-8")
        except OSError as erreur:
            refusals.append(f"{relatif} illisible ({erreur.strerror}) : le garde ne peut rien vérifier")
            continue
        try:
            trouvees = invocations_python(source)
        except SyntaxError as erreur:
            refusals.append(
                f"{relatif}:{erreur.lineno} illisible (syntaxe) : le garde ne peut rien vérifier"
            )
            continue
        for numero, commande in trouvees:
            conformes.append(f"{relatif}:{numero} {commande}")
            refusals.extend(refus_commande(numero, commande, relatif))

    if refusals:
        print(f"[ECHEC] {len(refusals)} invocation(s) de la sonde SEO hors règle :")
        for message in refusals:
            print(f"   - {message}")
            print(f"::error title=Sonde SEO stricte::{message}")
        return 1

    if not conformes:
        print(
            "[ECHEC] aucune invocation de la sonde SEO trouvée dans les workflows lus "
            f"({len(chemins)}) ni dans les surfaces déclarées ({', '.join(SURFACES_HORS_WORKFLOW)}) : "
            "soit la sonde n'est plus lancée nulle part — dis-le dans CI-COVERAGE.md au lieu "
            "de laisser ce garde vert à vide —, soit le remplacement "
            f"du nom `{SONDE}` a échappé à ce garde, qui ne prouve alors plus rien."
        )
        print("::error title=Sonde SEO stricte::aucune invocation trouvée — garde aveugle")
        return 1

    print(f"[OK] {len(conformes)} invocation(s) de la sonde SEO, toutes en {MODE_STRICT} :")
    for message in conformes:
        print(f"   - {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
