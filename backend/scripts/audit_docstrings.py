#!/usr/bin/env python3
"""Audit des docstrings des endpoints FastAPI — garde-fou CI.

Vérifie, pour CHAQUE route décorée (router.<method>, app.<method>,
app.api_route) des modules kojo_routers_*.py et server.py :

1. PRÉSENCE : la route a une docstring (pas de handler muet).
2. FORME DE RETOUR : la docstring contient une section « Returns: » qui
   documente explicitement la forme de retour (dict, Response, modèle...).
3. EXACTITUDE : toute clé backtickée (`cle`) citée dans la section Returns
   apparaît réellement dans au moins un `return {…}` du handler (aucune
   clé fantôme documentée — la docstring et le code ne peuvent pas
   diverger silencieusement).

Usage :
    python scripts/audit_docstrings.py                        # fichiers par défaut
    python scripts/audit_docstrings.py server.py              # fichiers explicites
    python scripts/audit_docstrings.py --fail-on-warning      # mode strict

ROUTES HORS PÉRIMÈTRE : les endpoints d'infrastructure (moniteurs
/monitor/* et /favicon.ico) sont des sondes 200/503/204 — leur forme de
retour est un statut HTTP, pas un contrat métier. Un manque de
documentation y est signalé comme WARNING (non bloquant), sauf en mode
strict --fail-on-warning où il fait échouer la CI comme une erreur.

Sortie : exit 0 si conforme (ou warnings sans --fail-on-warning),
exit 1 sinon (message détaillé pour la CI). Les fichiers ciblés sont
déduits du répertoire courant (scripts/ est appelé depuis backend/).
"""

from __future__ import annotations

import ast
import os
import re
import sys
from typing import Iterable, List, Optional, Set, Tuple

# Décorateurs de routes FastAPI reconnus (router.<methode> ou app.<methode>).
ROUTE_DECORATOR = re.compile(r"^(router|app)\.(get|post|put|patch|delete|api_route)$")

# Marqueurs de section Returns (français + anglais).
RETURN_SECTION_RE = re.compile(r"Returns?:|Retourne\s*:|retourne\s*:", re.IGNORECASE)

# Clé backtickée « plausible » (snake_case, minuscules) : on ignore les
# valeurs techniques citées entre backticks (ex: `text/plain`, `204`,
# `open`... un mot simple peut être une clé OU une valeur — on ne signale
# que les clés multi-caractères snake_case pour éviter les faux positifs).
BACKTICKED_KEY = re.compile(r"`([a-z_][a-z0-9_]{2,})`")

# Routes HORS PÉRIMÈTRE : endpoints d'infra dont la « forme de retour » est
# un statut HTTP (sondes 200/503, 204 no-content, health check) plutôt qu'un
# contrat métier JSON. Leur documentation défaillante est un WARNING
# (bloquant seulement en mode strict --fail-on-warning).
# Cohérent avec audit_api_returns.cjs (frontend) : mêmes préfixes infra.
OUT_OF_SCOPE_PATH = re.compile(r"^(/monitor|/health|/favicon\.ico)")

# Drapeau CLI : rend les warnings bloquants (mode strict pour la CI).
FAIL_ON_WARNING = "--fail-on-warning"

DEFAULT_FILES: List[str] = [
    "kojo_routers_auth.py",
    "kojo_routers_users.py",
    "kojo_routers_jobs.py",
    "kojo_routers_messages.py",
    "kojo_routers_geo.py",
    "kojo_routers_payments.py",
    "kojo_routers_reviews.py",
    "kojo_routers_owner.py",
    "kojo_routers_support.py",
    "kojo_routers_notifications.py",
    "kojo_routers_public.py",
    "server.py",
]


def _route_path(node: ast.AST) -> Optional[str]:
    """Chemin de la route (premier argument string du décorateur), sinon None."""
    for decorator in node.decorator_list:
        if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
            dotted = f"{decorator.func.value.id}.{decorator.func.attr}"
            if ROUTE_DECORATOR.match(dotted) and decorator.args:
                first = decorator.args[0]
                if isinstance(first, ast.Constant) and isinstance(first.value, str):
                    return first.value
    return None


def _is_route_handler(node: ast.AST) -> bool:
    """True si le nœud est un handler décoré par une route FastAPI."""
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return False
    return _route_path(node) is not None


def _docstring(node: ast.AST) -> Optional[str]:
    """Premier statement si c'est une chaîne (docstring), sinon None."""
    body = node.body
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        return body[0].value.value
    return None


def _return_section(docstring: str) -> str:
    """Texte de la docstring APRÈS le marqueur Returns: (vide si absent)."""
    match = RETURN_SECTION_RE.search(docstring)
    if not match:
        return ""
    return docstring[match.end() :]


def _returned_dict_keys(handler: ast.AST) -> Set[str]:
    """Toutes les clés littérales des `return {…}` du handler."""
    keys: Set[str] = set()
    for node in ast.walk(handler):
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    keys.add(key.value)
    return keys


def _route_name(handler: ast.AST) -> str:
    return f"{handler.name} (l.{handler.lineno})"


def _audit_file(path: str) -> Tuple[int, List[str], List[str]]:
    """Audite un fichier. Retourne (nb routes, erreurs, warnings).

    Les routes HORS PÉRIMÈTRE (moniteurs /monitor/*, favicon) produisent des
    WARNINGS au lieu d'erreurs : leur « forme de retour » est un statut HTTP,
    pas un contrat métier — la doc est souhaitable mais non bloquante hors
    mode strict.
    """
    try:
        tree = ast.parse(open(path, encoding="utf-8").read())
    except SyntaxError as exc:
        return 0, [f"  {path}: ERREUR DE SYNTAXE: {exc}"], []

    errors: List[str] = []
    warnings: List[str] = []
    route_count = 0

    for node in ast.walk(tree):
        if not _is_route_handler(node):
            continue
        route_count += 1
        rpath = _route_path(node)
        out_of_scope = bool(rpath and OUT_OF_SCOPE_PATH.match(rpath))

        def _report(message: str) -> None:
            entry = f"  {path}:{node.lineno}  {node.name}  {message}"
            (warnings if out_of_scope else errors).append(entry)

        docstring = _docstring(node)
        if docstring is None:
            _report("MANQUE DE DOCSTRING — aucune forme de retour documentée")
            continue

        section = _return_section(docstring)
        if not section.strip():
            _report("docstring SANS section « Returns: » — la forme de retour n'est pas documentée")
            continue

        claimed = set(BACKTICKED_KEY.findall(section))
        if not claimed:
            continue  # forme non-dict documentée (Response, modèle...) : rien à croiser

        actual = _returned_dict_keys(node)
        phantom = sorted(claimed - actual)
        if phantom:
            _report(f"CLÉS DOCUMENTÉES JAMAIS RETOURNÉES: {', '.join(phantom)}")

    return route_count, errors, warnings


def main(argv: Iterable[str]) -> int:
    args = list(argv)
    fail_on_warning = FAIL_ON_WARNING in args
    files = [a for a in args if a != FAIL_ON_WARNING] or DEFAULT_FILES

    total_routes = 0
    all_errors: List[str] = []
    all_warnings: List[str] = []
    for path in files:
        if not os.path.exists(path):
            print(f"[ERREUR] Fichier introuvable : {path}", file=sys.stderr)
            return 2
        route_count, errors, warnings = _audit_file(path)
        total_routes += route_count
        all_errors.extend(errors)
        all_warnings.extend(warnings)

    # Sortie ASCII uniquement (les emojis cassent l'encodage cp1252 de
    # Windows ; la CI Linux est UTF-8 mais on reste portable partout).
    print(f"Routes auditées : {total_routes} ({len(files)} fichiers)")
    if all_warnings:
        print(f"[AVERTISSEMENT] {len(all_warnings)} route(s) hors périmètre "
              f"(moniteurs/favicon) non documentée(s) :")
        for warning in all_warnings:
            print(warning)
        print("  (non bloquant — utilisez --fail-on-warning en CI pour les rendre bloquantes)")
    if all_errors:
        print(f"[ECHEC] {len(all_errors)} problème(s) de documentation :")
        for error in all_errors:
            print(error)
        return 1
    if fail_on_warning and all_warnings:
        print(f"[ECHEC] Mode strict --fail-on-warning : {len(all_warnings)} warning(s)")
        return 1

    print("[OK] Toutes les routes ont une docstring avec section Returns, "
          "et chaque clé documentée est réellement retournée.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
