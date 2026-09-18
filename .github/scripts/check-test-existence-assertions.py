#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refuse une assertion de test qui ne vérifie qu'une EXISTENCE sur un export.

Pourquoi ce garde
-----------------
Un test qui affirme qu'un export existe — qu'il est `callable`, non `None`, ou
`defined` — reste vert même si cet export devient un faux ami qui ne fait plus
rien : il ne décrit aucun comportement. C'est la forme la plus faible de test, et
elle revient toute seule au prochain ajout (le 18/09/2026, les assertions
d'existence dispersées ont été remplacées par un test d'import-santé, cf.
backend/tests/test_import_health.py) — d'où ce garde, qui empêche le nettoyage
de se reperdre.

Ce qui est refusé — le sujet doit être un nom IMPORTÉ par le fichier de test
--------------------------------------------------------------------------
Python :
  - `assert callable(<chemin>)` (import en tête de module ou dans le test) ;
  - `assert <chemin> is not None` comme condition ENTIÈRE ;
  - `assert <chemin>` comme condition ENTIÈRE (vérité d'un export).
JS :
  - `expect(<chemin>).toBeDefined()` (un deuxième argument, le message, est
    accepté).

Ce qui est ACCEPTÉ, et pourquoi la règle est étroite
----------------------------------------------------
`assert payload["job_id"] is not None` et
`expect(country.nameFrench).toBeDefined()` ne sont pas visés : le sujet n'est pas
un export, c'est une VALEUR produite par le test (le doc inséré, le pays
renvoyé). Vérifier un comportement À TRAVERS un export reste permis :
`assert module_helper(x) == y`, `assert module.CONSTANTE.startswith("https://")`.

Utilisation : python3 .github/scripts/check-test-existence-assertions.py [--root .]
Sortie : 0 si aucun constat, 1 sinon (annotations `::error` pour GitHub Actions).
"""
import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

PY_TEST_GLOBS = ("backend/tests/test_*.py",)
JS_TEST_GLOBS = (
    "frontend/scripts/__tests__/*.js",
    "frontend/src/**/__tests__/*.js",
    "frontend/src/**/__tests__/*.jsx",
)

# ── Lecture des imports ──────────────────────────────────────────────────────
PY_FROM_IMPORT = re.compile(
    r"^[ \t]*from[ \t]+[\w.]+[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)", re.MULTILINE
)
PY_PLAIN_IMPORT = re.compile(r"^[ \t]*import[ \t]+([^\n]+)", re.MULTILINE)

JS_NAMED_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from", re.DOTALL)
JS_NAMESPACE_IMPORT = re.compile(r"import\s*\*\s*as\s+([\w$]+)")
JS_DEFAULT_IMPORT = re.compile(r"import\s+([\w$]+)\s*(?:,|from)")

# ── Formes refusées ─────────────────────────────────────────────────────────
# Le `(?P<path>…)` est évalué comme un CHEMIN dont la RACINE doit être importée.
PY_CALLABLE = re.compile(
    r"^[ \t]*assert[ \t]+callable\((?P<path>[^()]+)\)[ \t]*(?:,.*)?$", re.MULTILINE
)
PY_IS_NOT_NONE = re.compile(
    r"^[ \t]*assert[ \t]+(?P<path>[A-Za-z_][\w.]*)[ \t]+is[ \t]+not[ \t]+None[ \t]*(?:,.*)?$",
    re.MULTILINE,
)
PY_BARE_PATH = re.compile(
    r"^[ \t]*assert[ \t]+(?P<path>[A-Za-z_][\w.]*)[ \t]*(?:,.*)?$", re.MULTILINE
)
JS_TO_BE_DEFINED = re.compile(
    r"expect\([ \t]*(?P<path>[A-Za-z_$][\w$]*(?:\.[\w$]+)*)[ \t]*(?:,.*)?\)[ \t]*\.toBeDefined\([ \t]*\)"
)

REFUSAL_HINT = (
    "une assertion d'EXISTENCE sur un export ne décrit aucun comportement : "
    "l'import du module suffit à prouver qu'il existe (cf. le test d'import-santé), "
    "donc vérifie ce que l'export FAIT, ou supprime l'assertion"
)


def _strip_comment(text):
    return text.split("#", 1)[0].strip()


def python_imported_names(source):
    """Noms liés par un `import` / `from … import …` du fichier de test."""
    names = set()
    for match in PY_FROM_IMPORT.finditer(source):
        imported = _strip_comment(match.group(1)).strip().strip("()")
        for part in imported.split(","):
            part = part.strip()
            if not part or part == "*":
                continue
            if " as " in part:
                names.add(part.split(" as ")[-1].strip())
            else:
                names.add(part.split(".")[0].strip())
    for match in PY_PLAIN_IMPORT.finditer(source):
        for part in _strip_comment(match.group(1)).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                names.add(part.split(" as ")[-1].strip())
            else:
                names.add(part.split(".")[0].strip())
    return {name for name in names if name}


def javascript_imported_names(source):
    """Noms liés par un `import` du fichier de test."""
    names = set()
    for match in JS_NAMED_IMPORT.finditer(source):
        for part in match.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                names.add(part.split(" as ")[-1].strip())
            else:
                names.add(part.split(":")[0].strip())
    for pattern in (JS_NAMESPACE_IMPORT, JS_DEFAULT_IMPORT):
        for match in pattern.finditer(source):
            names.add(match.group(1))
    return {name for name in names if name}


def _root(path):
    return re.split(r"[.\[]", path.strip())[0]


def findings_for_python(source, imported):
    """[(numéro de ligne, chemin)] refusés dans un fichier de test Python."""
    found = []
    for pattern in (PY_CALLABLE, PY_IS_NOT_NONE, PY_BARE_PATH):
        for match in pattern.finditer(source):
            path = match.group("path").strip()
            if _root(path) in imported:
                line = source.count("\n", 0, match.start()) + 1
                found.append((line, path))
    return found


def findings_for_javascript(source, imported):
    """[(numéro de ligne, chemin)] refusés dans un fichier de test JS."""
    found = []
    for match in JS_TO_BE_DEFINED.finditer(source):
        path = match.group("path").strip()
        if _root(path) in imported:
            line = source.count("\n", 0, match.start()) + 1
            found.append((line, path))
    return found


def test_files(root):
    """Fichiers de test du périmètre, triés (chemins relatifs affichés)."""
    files = []
    for pattern in PY_TEST_GLOBS:
        files += sorted(root.glob(pattern))
    for pattern in JS_TEST_GLOBS:
        files += sorted(root.glob(pattern))
    return sorted(set(files))


def check_file(path, relative):
    """Constats d'un fichier : [(numéro de ligne, message)]."""
    source = path.read_text(encoding="utf-8")
    if path.suffix == ".py":
        imported = python_imported_names(source)
        found = findings_for_python(source, imported)
    else:
        imported = javascript_imported_names(source)
        found = findings_for_javascript(source, imported)
    return [
        (line, f"{relative}:{line} : assertion d'existence sur « {_root(path_)} » — {REFUSAL_HINT}")
        for line, path_ in found
    ]


def run(root):
    """[(fichier, ligne, message)] — liste vide si le dépôt est propre."""
    errors = []
    files = test_files(root)
    if not files:
        # Un garde qui n'a rien lu ne prouve rien : le périmètre cassé est une
        # erreur, pas un succès silencieux.
        errors.append(
            (
                str(root),
                0,
                "aucun fichier de test trouvé : le périmètre du garde est cassé "
                "(mauvaise racine, globbing vide), donc il ne vérifie rien",
            )
        )
        return errors
    for path in files:
        relative = path.relative_to(root).as_posix()
        for line, message in check_file(path, relative):
            errors.append((relative, line, message))
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=str(REPO_ROOT), help="racine du dépôt")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    errors = run(root)

    scanned = len(test_files(root))
    if not errors:
        print(f"[OK] {scanned} fichier(s) de test : aucune assertion d'existence sur un export.")
        return 0

    print(f"[ECHEC] {len(errors)} assertion(s) d'existence sur un export ({scanned} fichier(s) de test) :")
    for relative, line, message in errors:
        print(f"  {message}")
        print(f"::error file={relative},line={line}::{message}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
