# -*- coding: utf-8 -*-
"""Le garde qui prouve que les tests des refus du générateur OG savent échouer.

.github/scripts/check-og-test-mutations.py existe parce que cette preuve avait été
faite à la main — huit mutations du générateur, restaurées à l'empreinte SHA-1 —
donc hors du dépôt : une preuve qu'on ne peut pas rejouer depuis un checkout ne
protège rien. Ce fichier prouve le garde LUI-MÊME : qu'il refuse une mutation sans
effet, une ligne de refus introuvable et un périmètre cassé, et qu'il passe sur le
dépôt réel (ce que la CI exécute aussi, en étape propre).

Les cas de refus tournent sur des arborescences temporaires, avec UNE seule
mutation (la table est réduite pour le cas) : rejouer les neuf ici doublerait le
temps de la suite sans rien prouver de plus — c'est le rôle de la CI.
"""
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GUARD_PATH = REPO_ROOT / ".github" / "scripts" / "check-og-test-mutations.py"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _load_guard():
    spec = importlib.util.spec_from_file_location("check_og_test_mutations", GUARD_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GUARD = _load_guard()

# Une suite qui passe TOUJOURS : neutraliser un refus ne peut donc rien y changer,
# ce qui place le garde devant le cas qu'il doit savoir refuser.
BLIND_SUITE = "def test_rien():\n    assert True\n"


@pytest.fixture
def one_mutation(monkeypatch):
    """Réduit la table du garde à une entrée : prouver sa capacité n'oblige pas à
    rejouer les neuf refus (la CI les rejoue tous)."""
    monkeypatch.setattr(GUARD, "MUTATIONS", (GUARD.MUTATIONS[0],))


@pytest.fixture
def fake_repo(tmp_path):
    """Une arborescence où le GÉNÉRATEUR est le vrai — donc ses lignes de refus sont
    celles du dépôt — mais où la suite de test est choisie par le cas."""

    def _build(test_source=BLIND_SUITE, drop=None):
        work = tmp_path / "repo"
        for relative in (GUARD.GENERATOR_FILE, GUARD.DICTIONARY_FILE):
            target = work / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        test = work / GUARD.TEST_FILE
        test.parent.mkdir(parents=True, exist_ok=True)
        test.write_text(test_source, encoding="utf-8")
        if drop is not None:
            generator = work / GUARD.GENERATOR_FILE
            generator.write_text(
                generator.read_text(encoding="utf-8").replace(drop, "if False:  # deja neutralise"),
                encoding="utf-8",
            )
        return work

    return _build


class TestRefuses:
    def test_une_mutation_qui_ne_rougit_rien_est_refusee(self, fake_repo, one_mutation, capsys):
        """Le garde ne se contente pas de lancer pytest : il exige un ROUGE. Une suite
        qui passe toujours doit donc lui faire nommer le refus comme non verrouillé,
        avec l'annotation que la CI affiche."""
        work = fake_repo()
        label = GUARD.MUTATIONS[0][0]

        assert GUARD.main(["--root", str(work)]) == 1

        captured = capsys.readouterr().out
        assert "[ECHEC]" in captured and label in captured and "::error" in captured

    def test_une_ligne_de_refus_introuvable_est_une_erreur(self, fake_repo, one_mutation):
        """Le garde vise des lignes du générateur : si l'une disparaît, il doit le dire
        plutôt que de croire avoir tout couvert avec huit mutations sur neuf."""
        work = fake_repo(drop=GUARD.MUTATIONS[0][1])

        errors = GUARD.run(work, sys.executable)

        assert len(errors) == 1
        label, message = errors[0]
        assert label == GUARD.MUTATIONS[0][0] and GUARD.MUTATIONS[0][1] in message

    def test_un_perimetre_incomplet_est_une_erreur(self, tmp_path, one_mutation):
        """Rien à copier (mauvaise racine) : une erreur, pas un succès silencieux."""
        errors = GUARD.run(tmp_path / "absent", sys.executable)

        assert len(errors) == 1 and "périmètre" in errors[0][1]


class TestDepotReel:
    def test_chaque_mutation_designe_une_ligne_unique_du_generateur(self):
        """La table du garde suit le générateur : chaque ligne visée existe, et la
        neutraliser ne change QU'une ligne — celle-là."""
        source = (REPO_ROOT / GUARD.GENERATOR_FILE).read_text(encoding="utf-8")

        for label, condition in GUARD.MUTATIONS:
            mutated = GUARD.neutralized(source, condition)
            assert mutated is not None, "%s : la ligne « %s » a disparu du générateur" % (label, condition)
            changed = [
                index
                for index, (before, after) in enumerate(zip(source.splitlines(), mutated.splitlines()))
                if before != after
            ]
            assert len(changed) == 1 and "if False:" in mutated.splitlines()[changed[0]], label

    def test_le_garde_est_cable_dans_la_ci(self):
        """Le garde ne sert que s'il tourne : la CI doit l'appeler, sur un job qui a
        pytest et Pillow (le fichier de test importe le générateur réel)."""
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        assert "python .github/scripts/check-og-test-mutations.py" in workflow

    def test_le_garde_passe_sur_le_depot_reel(self):
        """Le chemin vert — celui que la CI exécute — par le même appel que la CI :
        les neuf refus sont verrouillés par le fichier de test réel."""
        done = subprocess.run(
            [sys.executable, ".github/scripts/check-og-test-mutations.py"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        assert done.returncode == 0, done.stdout + done.stderr
        assert "[OK] %d refus" % len(GUARD.MUTATIONS) in done.stdout
