#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérifie que les tests des refus du générateur OG SAVENT échouer.

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
les copies intactes, puis neutralise un refus à la fois — sa ligne `if …:` devient
`if False:` — et exige que la suite ÉCHOUE. Un refus dont la neutralisation ne fait
rien rougir n'est pas verrouillé par ce fichier de test.

CE GARDE est le seul à rejouer ces mutations : la suite de tests, elle, prouve
qu'il sait refuser (mutation sans effet, ligne introuvable, refus hors table) sans
les rejouer — deux propriétaires de la même preuve la paieraient deux fois par push
(4,6 s ici sur le runner, 10,1 s en local ; la suite de `main` a perdu les ~4 s que
lui coûtait la reprise, cf. CI-COVERAGE §3 F17).

Complet par construction
------------------------
La table ci-dessous nomme les refus à neutraliser, mais son PÉRIMÈTRE ne vient pas
d'elle : chaque `raise SystemExit` du générateur est dérivé de sa source, et un
refus que la table ne couvre pas est signalé. Un dixième refus ajouté là-bas ne
peut donc pas passer inaperçu.

Ce qui est refusé
-----------------
  - une suite qui ne passe pas sur les copies intactes : c'est l'état de
    référence, sans lui n'importe quel rouge serait un faux positif ;
  - une ligne de refus introuvable ou ambiguë dans le générateur (le garde est
    périmé : une erreur, jamais un succès silencieux) ;
  - un refus du générateur absent de la table (le périmètre est incomplet) ;
  - une entrée de la table qui ne porte plus de refus ;
  - une mutation qui laisse la suite verte.

Utilisation : python3 .github/scripts/check-og-test-mutations.py [--root .]
Sortie : 0 si chaque refus est verrouillé, 1 sinon (annotations `::error`).
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

TEST_FILE = "backend/tests/test_gen_og_images.py"
GENERATOR_FILE = "frontend/scripts/gen-og-images.py"
DICTIONARY_FILE = "frontend/src/i18n/fr.json"

# Une entrée par refus DU GÉNÉRATEUR : le libellé dit ce qui est refusé, la ligne
# est celle qui porte le refus (comparée à la ligne entière, indentation à part) —
# donc ce garde suit le générateur au lieu de le décrire.
MUTATIONS = (
    ("champ de carte manquant", "if missing:"),
    ("route qui n'est pas un chemin absolu", "if not card['route'].startswith('/'):"),
    ("deux cartes pour une route", "if card['route'] in by_route:"),
    ("dossier sans aucune carte", "if not cards:"),
    ("clé i18n absente ou vide", "if not isinstance(value, str) or not value.strip():"),
    ("mot plus large que la colonne", "if draw.textlength(current, font=font) > max_width:"),
    ("plus de lignes que la place réservée", "if len(lines) > max_lines:"),
    ("bloc plus haut que la carte wide", "if height > H - 80:"),
    ("bloc plus haut que la carte carrée", "if height > available:"),
)


def refusal_lines(source):
    """Les conditions qui portent un refus : chaque `raise SystemExit` du générateur et
    la ligne `if … :` juste au-dessus.

    Dérivées de la source, jamais recopiées : c'est ce qui rend le périmètre de ce
    garde solidaire du générateur au lieu de dépendre d'une liste tenue à la main.
    """
    lines = source.splitlines()
    return [
        lines[index - 1].strip()
        for index, line in enumerate(lines)
        if index and "raise SystemExit" in line and lines[index - 1].lstrip().startswith("if ")
    ]


def neutralized(source, condition):
    """La source dont la ligne `condition` devient `if False:`.

    `None` si cette ligne n'apparaît pas exactement une fois : un motif absent ou
    ambigu veut dire que le générateur a changé sans que ce garde suive.
    """
    lines = source.splitlines(keepends=True)
    found = [index for index, line in enumerate(lines) if line.strip() == condition]
    if len(found) != 1:
        return None
    lines[found[0]] = lines[found[0]].replace(condition, "if False:  # MUTATION", 1)
    return "".join(lines)


def build_tree(root, work):
    """Copie les trois fichiers réels dans `work`, à la MÊME PROFONDEUR : le fichier
    de test remonte à sa racine par `parent.parent.parent`."""
    for relative in (TEST_FILE, GENERATOR_FILE, DICTIONARY_FILE):
        target = work / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / relative, target)


def suite_run(work, python):
    """(code de retour, sortie) de la suite du fichier de test, dans `work`."""
    done = subprocess.run(
        [python, "-m", "pytest", TEST_FILE, "-q", "--no-header", "--tb=no", "-p", "no:cacheprovider"],
        cwd=str(work),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return done.returncode, (done.stdout or "") + (done.stderr or "")


def run(root, python=sys.executable):
    """[(libellé, message)] — liste vide si chaque refus est verrouillé."""
    for relative in (TEST_FILE, GENERATOR_FILE, DICTIONARY_FILE):
        if not (root / relative).is_file():
            return [(relative, "fichier absent : le périmètre de ce garde est cassé")]

    errors = []
    with tempfile.TemporaryDirectory(prefix="og-mutations-") as temporary:
        work = Path(temporary)
        build_tree(root, work)
        generator = work / GENERATOR_FILE
        source = generator.read_text(encoding="utf-8")

        code, output = suite_run(work, python)
        if code != 0:
            return [
                (
                    "état de référence",
                    "la suite ne passe pas sur les copies intactes, donc aucun rouge mesuré "
                    "ici ne serait concluant (pytest est-il installé ?) :\n%s"
                    % output.strip()[-1500:],
                )
            ]

        derived = refusal_lines(source)
        covered = [condition for _, condition in MUTATIONS]
        for line in derived:
            if line not in covered:
                errors.append(
                    (
                        line,
                        "%s refuse aussi sur « %s », que la table ne couvre pas : ajouter son "
                        "entrée à MUTATIONS" % (GENERATOR_FILE, line),
                    )
                )
        for line in covered:
            if line not in derived:
                errors.append(
                    (
                        line,
                        "« %s » ne porte plus de refus dans %s : l'entrée de MUTATIONS est "
                        "périmée" % (line, GENERATOR_FILE),
                    )
                )

        for label, condition in MUTATIONS:
            mutated = neutralized(source, condition)
            if mutated is None:
                errors.append(
                    (
                        label,
                        "« %s » n'apparaît pas exactement une fois dans %s : le générateur a "
                        "changé sans que ce garde suive" % (condition, GENERATOR_FILE),
                    )
                )
                continue
            generator.write_text(mutated, encoding="utf-8")
            code, _ = suite_run(work, python)
            generator.write_text(source, encoding="utf-8")
            if code == 0:
                errors.append(
                    (
                        label,
                        "neutraliser ce refus ne fait rougir AUCUN test : il n'est pas "
                        "verrouillé par %s" % TEST_FILE,
                    )
                )
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=str(REPO_ROOT), help="racine du dépôt")
    parser.add_argument("--python", default=sys.executable, help="interpréteur qui exécute pytest")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    errors = run(root, args.python)

    if not errors:
        print(
            "[OK] %d refus du générateur de cartes OG : neutraliser chacun fait rougir %s."
            % (len(MUTATIONS), TEST_FILE)
        )
        return 0

    print("[ECHEC] %d refus non verrouillé(s) sur %d :" % (len(errors), len(MUTATIONS)))
    for label, message in errors:
        print("  %s — %s" % (label, message))
        print("::error title=Refus non verrouillé (%s)::%s" % (label, message.replace("\n", " ")))
    return 1


if __name__ == "__main__":
    sys.exit(main())
