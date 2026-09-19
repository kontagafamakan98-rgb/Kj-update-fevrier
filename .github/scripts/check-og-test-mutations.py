#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérifie que les tests des refus du générateur OG savent échouer, et que chacun a SON test.

Pourquoi ce garde
-----------------
backend/tests/test_gen_og_images.py verrouille les refus de
frontend/scripts/gen-og-images.py — les seuls endroits qui empêchent une carte
d'annoncer autre chose que sa page. Un test qu'on n'a jamais vu échouer ne prouve
rien, et cette preuve avait été faite une fois à la main (huit mutations du
générateur, restaurées à l'empreinte SHA-1) : une preuve qu'on ne peut pas rejouer
depuis un checkout ne protège rien. Ce garde la rend automatique.

Ce qu'il fait — sur des COPIES, jamais sur le dépôt
---------------------------------------------------
Il reconstruit une arborescence temporaire (copies du fichier de test, du
générateur et du dictionnaire, à la même profondeur), exige que la suite PASSE sur
les copies intactes, puis neutralise un refus à la fois — `if <condition>:` devient
`if False:` — et exige que la suite ÉCHOUE.

Complet par construction
------------------------
Il n'y a pas de table de mutations à tenir : elle est LUE dans l'arbre du
générateur, un refus par `raise SystemExit` que porte un `if`. Un refus ajouté
là-bas est donc muté automatiquement, et un `raise SystemExit` qu'aucun `if` ne
porte est signalé au lieu d'être sauté. Un générateur qui perdrait ses refus ne
peut pas non plus rendre ce garde vert : la suite échouerait sur les copies
intactes, ce que l'état de référence vérifie avant la première mutation.

Le test qui possède un refus
----------------------------
Un rouge ne suffit pas : une casse collatérale en produit un n'importe où. Chaque
refus doit donc avoir un test À LUI — un test qui rougit sous ce refus et sous
aucun autre. L'appartenance est mesurée, pas déclarée : les rouges d'un refus sont
confrontés à ceux des autres.

CE GARDE est le seul à rejouer ces mutations : la suite de tests, elle, prouve
qu'il sait refuser sans les rejouer — deux propriétaires de la même preuve la
paieraient deux fois par push (4,6 s ici sur le runner, 10,1 s en local ; la suite
de `main` a perdu les ~4 s que lui coûtait la reprise, cf. CI-COVERAGE §3 F17).

Ce qui est refusé
-----------------
  - une suite qui ne passe pas sur les copies intactes : c'est l'état de
    référence, sans lui n'importe quel rouge serait un faux positif ;
  - un `raise SystemExit` que la dérivation ne voit pas (aucun `if` ne le porte) ;
  - un refus dont la neutralisation ne fait rougir AUCUN test ;
  - un refus qui fait rougir des tests, mais dont aucun ne lui appartient.

Utilisation : python3 .github/scripts/check-og-test-mutations.py [--root .]
Sortie : 0 si chaque refus a son test, 1 sinon (annotations `::error`).
"""
import argparse
import ast
import shutil
import subprocess
import sys
import tempfile
from collections import namedtuple
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

TEST_FILE = "backend/tests/test_gen_og_images.py"
GENERATOR_FILE = "frontend/scripts/gen-og-images.py"
DICTIONARY_FILE = "frontend/src/i18n/fr.json"

# Un refus du générateur, lu dans son arbre : `line` le situe, `condition` est le
# texte du test de l'`if` qui le porte, et `span` la portion de source à remplacer
# pour l'éteindre — des positions, pas un motif à retrouver.
Refusal = namedtuple("Refusal", "line condition span")

# Le verdict : les problèmes trouvés (vide si tout est verrouillé) et
# l'appartenance mesurée, refus → tests qui ne rougissent que sous lui.
Report = namedtuple("Report", "errors owners")


def _is_exit(node):
    """`raise SystemExit(...)`, la seule forme de refus que le générateur emploie."""
    return (
        isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, ast.Name)
        and node.exc.func.id == "SystemExit"
    )


def _offset(source, lineno, column):
    """Position absolue en caractères d'un couple (ligne, colonne) de l'arbre — les
    colonnes de l'AST se comptent en OCTETS UTF-8."""
    lines = source.splitlines(keepends=True)
    before = sum(len(line) for line in lines[: lineno - 1])
    return before + len(lines[lineno - 1].encode("utf-8")[:column].decode("utf-8"))


def parse_refusals(source):
    """(refus, orphelins) lus dans l'arbre du générateur.

    Un refus est un `raise SystemExit` que porte un `if` : sa condition est le texte
    exact du test de cet `if`, et `span` la portion de source à éteindre. Un `raise
    SystemExit` qu'aucun `if` ne porte est un ORPHELIN : signalé plutôt que sauté,
    sinon un refus pourrait sortir du périmètre sans que rien ne le dise.
    """
    parsed = ast.parse(source)
    raised, refusals = set(), {}
    for node in ast.walk(parsed):
        if _is_exit(node):
            raised.add(node.lineno)
        elif isinstance(node, ast.If):
            for statement in node.body:
                if _is_exit(statement):
                    span = (
                        _offset(source, node.test.lineno, node.test.col_offset),
                        _offset(source, node.test.end_lineno, node.test.end_col_offset),
                    )
                    refusals[statement.lineno] = Refusal(
                        statement.lineno,
                        (ast.get_source_segment(source, node.test) or "").strip(),
                        span,
                    )
    return sorted(refusals.values()), sorted(raised - set(refusals))


def neutralized(source, refusal):
    """La source où `if <condition>:` devient `if False:`.

    Le remplacement vise la portion que l'arbre désigne pour cette condition : une
    ligne qui lui ressemble ailleurs dans le générateur ne compte pas, et une
    condition écrite sur plusieurs lignes est remplacée entièrement.
    """
    start, end = refusal.span
    return source[:start] + "False" + source[end:]


def label_of(line):
    """Le refus situé dans le générateur : c'est ce que l'annotation `::error` affiche."""
    return "%s:%d" % (GENERATOR_FILE, line)


def short(node_id):
    """Le test sans le chemin du fichier, qui est le même pour tous."""
    return node_id.split("::", 1)[-1]


def build_tree(root, tree):
    """Copie les trois fichiers réels dans `tree`, à la MÊME PROFONDEUR : le fichier
    de test remonte à sa racine par `parent.parent.parent`."""
    for relative in (TEST_FILE, GENERATOR_FILE, DICTIONARY_FILE):
        target = tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, target)


def suite_run(tree, python):
    """(code de retour, sortie, tests en échec) de la suite du fichier de test, dans `tree`."""
    done = subprocess.run(
        [python, "-m", "pytest", TEST_FILE, "-q", "--no-header", "--tb=no", "-rf", "-p", "no:cacheprovider"],
        cwd=str(tree),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (done.stdout or "") + (done.stderr or "")
    failed = [
        line[len("FAILED ") :].split(" - ")[0].strip()
        for line in output.splitlines()
        if line.startswith("FAILED ")
    ]
    return done.returncode, output, failed


def run(root, python=sys.executable):
    """Le rapport du garde : problèmes trouvés, et appartenance mesurée."""
    for relative in (TEST_FILE, GENERATOR_FILE, DICTIONARY_FILE):
        if not (root / relative).is_file():
            return Report([(relative, "fichier absent : le périmètre de ce garde est cassé")], {})

    errors = []
    owners = {}
    with tempfile.TemporaryDirectory(prefix="og-mutations-") as temporary:
        tree = Path(temporary)
        build_tree(root, tree)
        generator = tree / GENERATOR_FILE
        source = generator.read_text(encoding="utf-8")

        code, output, _ = suite_run(tree, python)
        if code != 0:
            return Report(
                [
                    (
                        "état de référence",
                        "la suite ne passe pas sur les copies intactes, donc aucun rouge mesuré "
                        "ici ne serait concluant (pytest est-il installé ?) :\n%s"
                        % output.strip()[-1500:],
                    )
                ],
                {},
            )

        refusals, orphans = parse_refusals(source)
        for line in orphans:
            errors.append(
                (
                    label_of(line),
                    "ce `raise SystemExit` n'est porté par aucun `if` : la dérivation ne sait "
                    "pas quand il tombe, donc il ne peut pas être muté",
                )
            )

        failures = {}
        for refusal in refusals:
            generator.write_text(neutralized(source, refusal), encoding="utf-8")
            _, _, failed = suite_run(tree, python)
            generator.write_text(source, encoding="utf-8")
            failures[refusal] = failed
            if not failed:
                errors.append(
                    (
                        label_of(refusal.line),
                        "neutraliser ce refus ne fait rougir AUCUN test : il n'est pas verrouillé "
                        "par %s" % TEST_FILE,
                    )
                )

        for refusal in refusals:
            others = set()
            for other, failed in failures.items():
                if other != refusal:
                    others |= set(failed)
            owners[refusal] = sorted(set(failures.get(refusal, [])) - others)
            if failures.get(refusal) and not owners[refusal]:
                also = sorted(
                    "if %s:" % other.condition
                    for other in failures
                    if other != refusal and set(failures[other]) & set(failures[refusal])
                )
                errors.append(
                    (
                        label_of(refusal.line),
                        "ce refus fait rougir %d test(s), mais aucun ne lui appartient : ils "
                        "rougissent aussi sous %s. Un refus n'est verrouillé que par un test qui "
                        "rougit sous lui SEUL."
                        % (len(failures[refusal]), " et ".join(also) or "un autre refus"),
                    )
                )
    return Report(errors, owners)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=str(REPO_ROOT), help="racine du dépôt")
    parser.add_argument("--python", default=sys.executable, help="interpréteur qui exécute pytest")
    args = parser.parse_args(argv)
    report = run(Path(args.root).resolve(), args.python)

    if not report.errors:
        print(
            "[OK] %d refus du générateur de cartes OG : chacun a son test, et ce test ne rougit "
            "que sous lui." % len(report.owners)
        )
        for refusal, owned in report.owners.items():
            names = ", ".join(short(node) for node in owned[:3])
            if len(owned) > 3:
                names += " +%d autre(s)" % (len(owned) - 3)
            print("  %s  if %s:  ← %s" % (label_of(refusal.line), refusal.condition, names))
        return 0

    print("[ECHEC] %d problème(s) sur les refus de %s :" % (len(report.errors), GENERATOR_FILE))
    for label, message in report.errors:
        print("  %s — %s" % (label, message))
        print("::error title=Refus non verrouillé (%s)::%s" % (label, message.replace("\n", " ")))
    return 1


if __name__ == "__main__":
    sys.exit(main())
