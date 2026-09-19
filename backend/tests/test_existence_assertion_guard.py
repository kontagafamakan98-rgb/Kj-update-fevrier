# -*- coding: utf-8 -*-
"""Régression : le garde des assertions d'existence sur un export.

`.github/scripts/check-test-existence-assertions.py` refuse une assertion qui ne
vérifie qu'une EXISTENCE d'export (`callable(...)`, `is not None`,
`toBeDefined()`), parce qu'elle reste verte même quand l'export ne fait plus
rien. Ce test verrouille les trois choses qui décident de sa valeur :

- la CLASSIFICATION : refusé quand le sujet est un export importé, accepté quand
  c'est une valeur produite par le test (le cas qui aurait rendu le garde
  insupportable, donc celui qu'il faut prouver) ;
- la NON-VACUITÉ : le garde sait échouer (code 1 + annotation `::error`), et il
  refuse un périmètre vide au lieu de passer en silence ;
- le CÂBLAGE : il est exécuté par le job `workflow-lint`, sinon il serait vert
  sans jamais tourner.

Les exemples tournent sur des fichiers écrits dans un dossier temporaire ; le
dépôt réel n'est jamais modifié, et il doit rester propre.
"""
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-test-existence-assertions.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _load_guard():
    """Charge le garde comme module importable (script stdlib)."""
    spec = importlib.util.spec_from_file_location("check_test_existence_assertions", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def guard():
    return _load_guard()


def _write(tmp_path, name, source):
    target = tmp_path / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    return target


def _python_findings(guard, tmp_path, source):
    file = _write(tmp_path, "backend/tests/test_exemple.py", source)
    imported = guard.python_imported_names(source)
    return guard.findings_for_python(source, imported), file


def _javascript_findings(guard, tmp_path, source):
    file = _write(tmp_path, "frontend/scripts/__tests__/exemple.test.js", source)
    imported = guard.javascript_imported_names(source)
    return guard.findings_for_javascript(source, imported), file


class TestRefuses:
    """Ce que le garde doit refuser — le sujet est un nom IMPORTÉ."""

    @pytest.mark.parametrize(
        "import_line, assertion",
        [
            ("from kojo_shared import helper", "assert callable(helper)"),
            ("import kojo_scheduler", "assert callable(kojo_scheduler.loop)"),
            ("import kojo_scheduler", "assert kojo_scheduler.loop is not None"),
            ("from kojo_settings import DEBUG", "assert DEBUG"),
            ("from kojo_x import y as z", "assert callable(z)"),
            ("import kojo_core as core", "assert core.db is not None"),
            ("from kojo_shared import helper", "assert callable(helper), 'message'"),
            ("from kojo_shared import helper, autre", "assert callable(autre)"),
        ],
    )
    def test_python(self, guard, tmp_path, import_line, assertion):
        findings, _ = _python_findings(guard, tmp_path, f"{import_line}\n\n\ndef test_x():\n    {assertion}\n")
        assert len(findings) == 1, findings
        assert findings[0][0] == 5, "le constat doit désigner la ligne de l'assertion"

    @pytest.mark.parametrize(
        "import_line, assertion, sujet",
        [
            ("import { build } from '../build'", "expect(build).toBeDefined();", "build"),
            ("import * as meta from '../site-meta'", "expect(meta.SITE_ORIGIN).toBeDefined();", "meta"),
            ("import siteMeta from '../site-meta'", "expect(siteMeta, 'message').toBeDefined();", "siteMeta"),
            (
                "import { a, b as alias } from '../mod'",
                "expect(alias.helper).toBeDefined();",
                "alias",
            ),
        ],
    )
    def test_javascript(self, guard, tmp_path, import_line, assertion, sujet):
        findings, _ = _javascript_findings(guard, tmp_path, f"{import_line}\n\nit('x', () => {{\n  {assertion}\n}});\n")
        assert len(findings) == 1, findings
        assert findings[0][0] == 4, "le constat doit désigner la ligne de l'assertion"
        assert sujet

    def test_main_retourne_1_et_annote(self, guard, tmp_path, capsys):
        _write(tmp_path, "backend/tests/test_exemple.py", "import kojo_scheduler\n\n\ndef test_x():\n    assert callable(kojo_scheduler.loop)\n")
        assert guard.main(["--root", str(tmp_path)]) == 1
        captured = capsys.readouterr().out
        assert "::error file=backend/tests/test_exemple.py,line=5::" in captured
        assert "assertion d'existence" in captured

    def test_perimetre_vide_est_une_erreur(self, guard, tmp_path, capsys):
        """Un garde qui n'a rien lu ne prouve rien."""
        assert guard.main(["--root", str(tmp_path)]) == 1
        captured = capsys.readouterr().out
        assert "aucun fichier de test" in captured


class TestAccepts:
    """Ce que le garde ne doit PAS refuser — sinon il serait insupportable."""

    @pytest.mark.parametrize(
        "source",
        [
            # Le sujet est une VALEUR produite par le test, pas un export.
            "def test_x():\n    msg = chercher()\n    assert msg is not None\n",
            "def test_x():\n    assert payload['job_id'] is not None\n",
            "def test_x():\n    assert stored.get('expires_at') is not None\n",
            # Comportement À TRAVERS un export : c'est exactement ce qu'on veut.
            "from kojo_settings import BASE\n\n\ndef test_x():\n    assert BASE.startswith('https://')\n",
            "import kojo_core\n\n\ndef test_x():\n    assert kojo_core.build_trusted_hosts() == ['localhost']\n",
            # Une assertion d'existence COMBINÉE n'est plus une existence seule.
            "def test_x():\n    assert entry is not None and entry['status'] == 'ok'\n",
            # callable() sur une fonction définie par le test : pas un export.
            "def helper():\n    return 1\n\n\ndef test_x():\n    assert callable(helper)\n",
            # None comme valeur ATTENDUE, pas comme existence.
            "def test_x():\n    assert result is None\n",
        ],
    )
    def test_python_accepte(self, guard, tmp_path, source):
        findings, _ = _python_findings(guard, tmp_path, source)
        assert findings == [], findings

    @pytest.mark.parametrize(
        "source",
        [
            "it('x', () => {\n  expect(country.nameFrench).toBeDefined();\n});\n",
            "import { build } from '../build'\n\nit('x', () => {\n  expect(build).toBe('ok');\n});\n",
            "import * as meta from '../site-meta'\n\nit('x', () => {\n  expect(meta.SITE_ORIGIN).toBe('https://exemple.test');\n});\n",
            "it('x', () => {\n  expect(detecte).toBeDefined();\n});\n",
        ],
    )
    def test_javascript_accepte(self, guard, tmp_path, source):
        findings, _ = _javascript_findings(guard, tmp_path, source)
        assert findings == [], findings

    def test_main_retourne_0_sur_un_fichier_propre(self, guard, tmp_path, capsys):
        _write(
            tmp_path,
            "frontend/scripts/__tests__/propre.test.js",
            "it('x', () => {\n  expect(1).toBe(1);\n});\n",
        )
        assert guard.main(["--root", str(tmp_path)]) == 0
        assert "[OK]" in capsys.readouterr().out


class TestDepotReel:
    def test_le_perimetre_couvre_reellement_les_deux_langages(self, guard):
        files = guard.test_files(REPO_ROOT)
        relative = [path.relative_to(REPO_ROOT).as_posix() for path in files]
        # Un globbing cassé (racine fausse, extension oubliée) donnerait un
        # garde vert qui ne lit rien : le plancher est donc explicite.
        assert len(files) >= 60, relative[:5]
        assert any(name.endswith(".py") for name in relative)
        assert any(name.endswith(".js") for name in relative)

    def test_le_garde_est_cable_dans_le_job_workflow_lint(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        assert "python3 .github/scripts/check-test-existence-assertions.py" in workflow, (
            "le garde doit être exécuté par la CI — sinon il serait vert sans jamais tourner"
        )

    # Le garde sur le dépôt réel n'est pas rejoué ici : l'étape « Check test
    # assertions describe behaviour » du job `workflow-lint` le fait sur le runner.
