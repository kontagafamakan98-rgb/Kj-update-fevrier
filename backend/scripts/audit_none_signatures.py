#!/usr/bin/env python3
"""Audit des endpoints FastAPI dont ``response_model`` vaut ``None``.

Ces routes désactivent la validation automatique de FastAPI. Elles doivent
alors documenter explicitement leur forme de retour dans leur docstring.

Usage:
    python scripts/audit_none_signatures.py [fichier.py ...]
    python scripts/audit_none_signatures.py --strict [fichier.py ...]
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

DEFAULT_FILES = ["server.py", "kojo_routers_*.py"]


def _is_none(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value is None


def _route_path(node: ast.FunctionDef | ast.AsyncFunctionDef) -> Optional[str]:
    for decorator in node.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        func = decorator.func
        if not isinstance(func, ast.Attribute):
            continue
        if func.attr not in {"get", "post", "put", "patch", "delete", "options", "head", "api_route"}:
            continue
        if decorator.args and isinstance(decorator.args[0], ast.Constant):
            if isinstance(decorator.args[0].value, str):
                return decorator.args[0].value
    return None


def _has_none_response_model(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    for decorator in node.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        keywords = {keyword.arg: keyword.value for keyword in decorator.keywords}
        if "response_model" in keywords and _is_none(keywords["response_model"]):
            return True
    return False


def _audit_file(path: Path) -> Tuple[int, List[str]]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError) as exc:
        return 0, [f"{path}: erreur de lecture/syntaxe: {exc}"]

    routes = 0
    errors: List[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not _has_none_response_model(node):
            continue
        routes += 1
        path_value = _route_path(node) or "<chemin inconnu>"
        docstring = ast.get_docstring(node, clean=False) or ""
        if not docstring.strip():
            errors.append(f"{path}:{node.lineno} {node.name} [{path_value}] : docstring manquante")
            continue
        if not any(marker in docstring.lower() for marker in ("returns:", "return:", "retourne:")):
            errors.append(f"{path}:{node.lineno} {node.name} [{path_value}] : section Returns manquante")
    return routes, errors


def _expand_files(args: Iterable[str]) -> List[Path]:
    paths: List[Path] = []
    for arg in args:
        candidate = Path(arg)
        if any(char in arg for char in "*?["):
            paths.extend(sorted(Path().glob(arg)))
        elif candidate.exists():
            paths.append(candidate)
        else:
            raise FileNotFoundError(arg)
    return paths


def main(argv: Iterable[str]) -> int:
    args = list(argv)
    strict = "--strict" in args
    files = [arg for arg in args if arg != "--strict"]
    if not files:
        files = ["server.py"] + sorted(str(path) for path in Path().glob("kojo_routers_*.py"))
    try:
        paths = _expand_files(files)
    except FileNotFoundError as exc:
        print(f"[ERREUR] fichier introuvable : {exc}", file=sys.stderr)
        return 2

    total = 0
    errors: List[str] = []
    for path in paths:
        count, file_errors = _audit_file(path)
        total += count
        errors.extend(file_errors)

    print(f"Signatures response_model=None auditées : {total} ({len(paths)} fichiers)")
    if errors:
        print(f"[ECHEC] {len(errors)} endpoint(s) non documenté(s) :")
        print("\n".join(f"  {error}" for error in errors))
        return 1
    print("[OK] Toutes les signatures response_model=None documentent explicitement leur retour.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
