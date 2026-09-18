# -*- coding: utf-8 -*-
"""Régression : le garde-fou d'épinglage des actions (check-workflow-pins.py).

Le 2026-08-27, le job `workflow-lint` est tombé **avant d'exécuter la moindre
étape** :

    ##[error]Unable to resolve action `rhysd/actionlint@v1`, unable to find version `v1`

Un `uses:` est un contrat avec un dépôt externe : une référence non résoluble
rougit le job sans rapport avec notre code, et le diagnostic ne se trouve dans
aucun de nos logs (nos étapes n'ont jamais tourné). Le même risque restait
ouvert avec `superfly/flyctl-actions/setup-flyctl@master`, une **branche**.

Ce test verrouille :

- le classement des références : tag de version (`@v4`, `@1.6`, `@v1.7.12`) et
  SHA de commit acceptés ; branche (`@master`, `@main`, `@HEAD`, `@latest`) et
  référence absente refusées ; `./` et `docker://` hors périmètre ;
- la **cause** citée dans le message (une branche peut disparaître / suivre
  l'amont sans revue), pas seulement l'effet ;
- un workflow SANS aucune référence n'est pas « vert » : le garde échoue, car
  un garde qui ne voit rien ne prouve rien ;
- le workflow réel du dépôt est conforme, `setup-flyctl` y est épinglé (jamais
  `@master`), et l'étape du garde est bien câblée dans `workflow-lint` — sans
  quoi le garde serait vert sans jamais tourner.

Ce que ce test ne prouve pas : qu'un tag référencé existe encore (c'est
précisément le cas `actionlint@v1`), ni qu'un tag n'a pas été déplacé. Seul un
SHA est immuable.
"""
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-workflow-pins.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _load_check():
    """Charge check-workflow-pins.py comme module importable (script stdlib)."""
    spec = importlib.util.spec_from_file_location("check_workflow_pins", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def check():
    return _load_check()


class TestClassification:
    """La forme d'une référence décide du verdict."""

    @pytest.mark.parametrize(
        "reference, motif",
        [
            ("actions/checkout@v4", "tag"),
            ("actions/setup-node@v4", "tag"),
            ("superfly/flyctl-actions/setup-flyctl@1.6", "tag"),
            ("rhysd/actionlint@v1.7.12", "tag"),
            ("superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1", "SHA"),
            ("actions/checkout@ed8efb3", "SHA"),
            ("./.github/actions/local", "local"),
            ("docker://alpine:3.20", "docker"),
        ],
    )
    def test_references_acceptees(self, check, reference, motif):
        conforme, raison = check.classify_reference(reference)
        assert conforme, f"{reference} devrait être acceptée (motif attendu: {motif}) : {raison}"

    @pytest.mark.parametrize(
        "reference",
        [
            "superfly/flyctl-actions/setup-flyctl@master",
            "actions/checkout@main",
            "actions/checkout@HEAD",
            "actions/checkout@latest",
            "actions/checkout@stable",
            "owner/repo@dependabot/npm/foo",
        ],
    )
    def test_branches_refusees(self, check, reference):
        conforme, raison = check.classify_reference(reference)
        assert not conforme, f"{reference} (branche) ne doit pas passer"
        assert "BRANCHE" in raison, "le motif doit nommer la cause (branche), pas seulement l'effet"

    def test_reference_absente_refusee(self, check):
        conforme, raison = check.classify_reference("actions/checkout")
        assert not conforme
        assert "@" in raison


class TestLectureDuWorkflow:
    """La lecture ligne à ligne doit trouver les `uses:` et rien d'autre."""

    def test_detecte_les_references_et_les_numero_de_ligne(self, check, tmp_path):
        workflow = tmp_path / "ci.yml"
        workflow.write_text(
            "jobs:\n"
            "  a:\n"
            "    steps:\n"
            "      - uses: actions/checkout@v4\n"
            "        name: checkout\n"
            "      - uses: owner/repo@master\n",
            encoding="utf-8",
        )
        errors, conforming = check.check_workflow(workflow)
        assert len(conforming) == 1 and "checkout@v4" in conforming[0]
        assert len(errors) == 1
        assert "owner/repo@master" in errors[0]
        assert ":6" in errors[0], "l'erreur doit désigner la ligne fautive"

    def test_workflow_sans_reference_est_une_erreur(self, check, tmp_path, capsys):
        workflow = tmp_path / "ci.yml"
        workflow.write_text("jobs:\n  a:\n    steps: []\n", encoding="utf-8")
        errors, conforming = check.check_workflow(workflow)
        assert errors == [] and conforming == []
        # main() doit refuser le silence (chemin erroné, format inattendu...).
        assert check.main(["prog", str(workflow)]) == 1
        assert "ne prouve rien" in capsys.readouterr().out

    def test_fichier_absent_est_une_erreur(self, check, tmp_path):
        errors, _ = check.check_workflow(tmp_path / "absent.yml")
        assert errors and "introuvable" in errors[0]

    def test_motif_valide_sur_fixture_rend_exit_zero(self, check, tmp_path):
        workflow = tmp_path / "ci.yml"
        workflow.write_text("steps:\n  - uses: actions/checkout@v4\n", encoding="utf-8")
        assert check.main(["prog", str(workflow)]) == 0


class TestWorkflowReel:
    """La non-régression qui protège réellement les jobs."""

    def test_aucune_reference_de_branche_dans_ci_yml(self, check):
        errors, conforming = check.check_workflow(WORKFLOW)
        assert errors == [], "\n".join(errors)
        assert len(conforming) > 20, "le garde doit voir toutes les références du workflow"

    def test_setup_flyctl_est_epingle_et_non_une_branche(self):
        contenu = WORKFLOW.read_text(encoding="utf-8")
        assert "setup-flyctl@master" not in contenu, (
            "setup-flyctl@master est une BRANCHE : elle suit l'amont sans revue et "
            "peut disparaître (cf. actionlint@v1, 2026-08-27)"
        )
        assert contenu.count("superfly/flyctl-actions/setup-flyctl@") == 2, (
            "les deux jobs qui installent flyctl (fly-env-drift, deploy-fly) doivent "
            "référencer l'action épinglée"
        )

    def test_le_garde_est_cable_dans_le_job_workflow_lint(self):
        contenu = WORKFLOW.read_text(encoding="utf-8")
        assert "python3 .github/scripts/check-workflow-pins.py" in contenu, (
            "le garde doit être exécuté par le job workflow-lint — sinon il serait "
            "vert sans jamais tourner"
        )
