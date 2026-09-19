"""Contrats du script audit_none_signatures.py."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "audit_none_signatures.py"


def run_audit(tmp_path: Path, source: str) -> subprocess.CompletedProcess[str]:
    fixture = tmp_path / "routes.py"
    fixture.write_text(source, encoding="utf-8")
    # Le script rend son verdict en français accentué : l'encodage du tube est
    # donc figé des DEUX côtés. Un `PYTHONIOENCODING=utf-8` seulement hérité de
    # l'environnement faisait écrire l'enfant en UTF-8 pendant que le parent
    # décodait en cp1252 (`auditées` → `auditÃ©es`) : un faux rouge local sous
    # Windows, invisible en CI où tout est en UTF-8.
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(fixture)],
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def route(decorator: str, body: str = '"""Route.\n\nReturns:\n    dict: payload.\n"""\n    return {"ok": True}') -> str:
    return f"from fastapi import APIRouter\nrouter = APIRouter()\n\n@{decorator}\ndef endpoint():\n    {body}\n"


def test_get_none_with_returns_passes(tmp_path: Path):
    result = run_audit(tmp_path, route('router.get("/ok", response_model=None)'))
    assert result.returncode == 0
    assert "[OK]" in result.stdout


def test_post_none_with_returns_passes(tmp_path: Path):
    result = run_audit(tmp_path, route('router.post("/ok", response_model=None)'))
    assert result.returncode == 0


def test_api_route_none_with_returns_passes(tmp_path: Path):
    result = run_audit(tmp_path, route('router.api_route("/ok", methods=["GET"], response_model=None)'))
    assert result.returncode == 0


def test_missing_docstring_fails(tmp_path: Path):
    result = run_audit(tmp_path, route('router.get("/broken", response_model=None)', 'return {"ok": True}'))
    assert result.returncode == 1
    assert "docstring manquante" in result.stdout


def test_missing_returns_section_fails(tmp_path: Path):
    body = '"""Route sans contrat."""\nreturn {"ok": True}'
    result = run_audit(tmp_path, route('router.get("/broken", response_model=None)', body))
    assert result.returncode == 1
    assert "section Returns manquante" in result.stdout


def test_non_none_response_model_is_ignored(tmp_path: Path):
    body = 'return {"ok": True}'
    result = run_audit(tmp_path, route('router.get("/typed", response_model=dict)', body))
    assert result.returncode == 0
    assert "auditées : 0" in result.stdout


def test_mixed_file_reports_only_undocumented_none_route(tmp_path: Path):
    source = '''
from fastapi import APIRouter
router = APIRouter()

@router.get("/good", response_model=None)
def good():
    """Route.\n\n    Returns:\n        dict: payload.\n    """
    return {"ok": True}

@router.get("/bad", response_model=None)
def bad():
    return {"ok": False}
'''
    result = run_audit(tmp_path, source)
    assert result.returncode == 1
    assert "Signatures response_model=None auditées : 2" in result.stdout
    assert "bad" in result.stdout
    assert "good" not in result.stdout
