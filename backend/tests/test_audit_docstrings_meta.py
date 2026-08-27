"""Méta-tests du contrat documenté par ``scripts/audit_docstrings.py``.

Le test exécute le script réel en sous-processus : il protège donc aussi le
comportement CLI et les codes de sortie, pas seulement les helpers internes.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "audit_docstrings.py"


def run_audit(tmp_path: Path, source: str, *, strict: bool = False) -> subprocess.CompletedProcess[str]:
    fixture = tmp_path / "fixture_routes.py"
    fixture.write_text(source, encoding="utf-8")
    args = [sys.executable, str(SCRIPT), str(fixture)]
    if strict:
        args.append("--fail-on-warning")
    return subprocess.run(args, capture_output=True, text=True, check=False)


VALID_BUSINESS = '''
from fastapi import APIRouter
router = APIRouter()

@router.get("/jobs")
def list_jobs():
    """Liste les jobs.

    Returns:
        `jobs`: liste des jobs disponibles.
    """
    return {"jobs": []}
'''


INVALID_BUSINESS = '''
from fastapi import APIRouter
router = APIRouter()

@router.get("/jobs")
def list_jobs():
    return {"jobs": []}
'''


INVALID_INFRA = '''
from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
def health():
    return {"status": "ok"}
'''


class TestAuditDocstringsMeta:
    def test_valid_fixture_passes(self, tmp_path: Path):
        result = run_audit(tmp_path, VALID_BUSINESS)

        assert result.returncode == 0
        assert "[OK]" in result.stdout
        assert "[ECHEC]" not in result.stdout

    def test_business_regression_is_an_error(self, tmp_path: Path):
        result = run_audit(tmp_path, INVALID_BUSINESS)

        assert result.returncode == 1
        assert "[ECHEC]" in result.stdout
        assert "MANQUE DE DOCSTRING" in result.stdout

    def test_infra_regression_is_a_non_blocking_warning_by_default(self, tmp_path: Path):
        result = run_audit(tmp_path, INVALID_INFRA)

        assert result.returncode == 0
        assert "[AVERTISSEMENT]" in result.stdout
        assert "[OK]" in result.stdout

    def test_strict_mode_blocks_infra_warning(self, tmp_path: Path):
        result = run_audit(tmp_path, INVALID_INFRA, strict=True)

        assert result.returncode == 1
        assert "[AVERTISSEMENT]" in result.stdout
        assert "Mode strict --fail-on-warning" in result.stdout
