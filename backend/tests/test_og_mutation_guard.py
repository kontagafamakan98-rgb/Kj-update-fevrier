# -*- coding: utf-8 -*-
"""Le garde qui prouve que les tests des refus du générateur OG savent échouer.

.github/scripts/check-og-test-mutations.py rejoue, sur des COPIES, la neutralisation
de chaque refus de frontend/scripts/gen-og-images.py : c'est la preuve que
backend/tests/test_gen_og_images.py verrouille vraiment quelque chose. Cette preuve a
UN seul exécutant — l'étape du job `backend-tests`, qui la paie une fois par push
(3,0 à 5,0 s sur le runner) — et ce fichier-ci n'en est pas un second : il n'exécute
JAMAIS pytest.

Ce qu'il prouve tient en trois choses : la dérivation des refus est lue dans l'arbre
du générateur (un `raise` sans `if` est un orphelin, une condition écrite aussi
ailleurs ne compte pas), les DÉCISIONS du garde sur des verdicts écrits d'avance (un
refus que personne n'exerce, un test partagé entre deux refus, une suite déjà rouge,
un périmètre incomplet), et le CÂBLAGE de l'étape qui, elle, rejoue tout pour de vrai.
Si la frontière du garde changeait de forme, c'est cette étape qui le dirait : elle
seule voit passer de vrais rouges.
"""
import importlib.util
import re
import shutil
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
COMMAND = "python .github/scripts/check-og-test-mutations.py"

TWO_REFUSALS = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    if value > 10:
        raise SystemExit('valeur trop grande')
    return value
"""

THREE_REFUSALS = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    if value > 10:
        raise SystemExit('valeur trop grande')
    if value == 5:
        raise SystemExit('cinq pile')
    return value
"""

# Un refus que rien ne porte : la dérivation ne peut pas savoir quand il tombe.
ORPHAN = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    raise SystemExit('sans if')
"""


def fake_repo(tmp_path, generator):
    """Une arborescence où le GÉNÉRATEUR est celui du cas, aux chemins réels. Le
    fichier de test n'est jamais exécuté ici — la seule frontière du garde est
    remplacée — donc son contenu n'a pas à être une suite : seul son existence
    compte pour le périmètre."""
    tree = tmp_path / "repo"
    for relative in (GUARD.GENERATOR_FILE, GUARD.DICTIONARY_FILE):
        target = tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / relative, target)
    (tree / GUARD.GENERATOR_FILE).write_text(generator, encoding="utf-8")
    suite = tree / GUARD.TEST_FILE
    suite.parent.mkdir(parents=True, exist_ok=True)
    suite.write_text("def test_rien():\n    assert True\n", encoding="utf-8")
    return tree


def job_block(name, workflow):
    """Le bloc YAML d'un job : de sa clé, indentée de deux espaces, à la suivante."""
    lines = workflow.splitlines()
    start = next(index for index, line in enumerate(lines) if line.strip() == "%s:" % name)
    end = next(
        (
            index
            for index, line in enumerate(lines[start + 1 :], start + 1)
            if re.match(r"^  [A-Za-z0-9_-]+:$", line)
        ),
        len(lines),
    )
    return "\n".join(lines[start:end])


@pytest.fixture
def verdicts(monkeypatch):
    """Remplace la seule frontière du garde — lancer pytest — par des verdicts écrits
    d'avance, refus par refus, le premier appel étant l'état de référence."""
    calls = []

    def _install(reference_ok, *per_refusal):
        def fake_suite(tree, python):
            calls.append(tree)
            if len(calls) == 1:
                return (0 if reference_ok else 1, "", [])
            return (0, "", list(per_refusal[len(calls) - 2]))

        monkeypatch.setattr(GUARD, "suite_run", fake_suite)
        return calls

    return _install


class TestDerivation:
    """La table n'est pas écrite : elle est lue dans l'arbre du générateur."""

    def test_chaque_raise_et_la_condition_qui_le_porte(self):
        refusals, orphans = GUARD.parse_refusals(TWO_REFUSALS)

        assert [(refusal.line, refusal.condition) for refusal in refusals] == [
            (3, "value < 0"),
            (5, "value > 10"),
        ]
        assert orphans == []

    def test_un_raise_sans_if_est_un_orphelin(self):
        refusals, orphans = GUARD.parse_refusals(ORPHAN)

        assert [refusal.condition for refusal in refusals] == ["value < 0"]
        assert orphans == [4]

    def test_neutralise_la_seule_ligne_qui_porte_le_refus(self):
        refusals, _ = GUARD.parse_refusals(TWO_REFUSALS)
        mutated = GUARD.neutralized(TWO_REFUSALS, refusals[1])
        changed = [
            index
            for index, (before, after) in enumerate(
                zip(TWO_REFUSALS.splitlines(), mutated.splitlines())
            )
            if before != after
        ]

        assert changed == [3] and mutated.splitlines()[3].strip() == "if False:"

    def test_une_autre_ligne_qui_ressemble_ne_compte_pas(self):
        """Le générateur réel porte « if not name.endswith('.json'): » deux fois : une
        fois pour ignorer un fichier, une fois pour refuser. Le remplacement vise la
        portion que l'arbre désigne, donc ce n'est pas un motif à retrouver — et la
        même source garde son `if` intact."""
        source = (
            TWO_REFUSALS
            + "\n\ndef skip(value):\n    if value < 0:\n        return None\n    return value\n"
        )
        refusals, _ = GUARD.parse_refusals(source)
        mutated = GUARD.neutralized(source, refusals[0])
        changed = [
            index
            for index, (before, after) in enumerate(zip(source.splitlines(), mutated.splitlines()))
            if before != after
        ]
        alike = lambda text: [
            index for index, line in enumerate(text.splitlines()) if line.strip() == "if value < 0:"
        ]

        assert changed == [1]
        assert alike(source) == [1, 9], "la source doit bien porter deux lignes identiques"
        assert alike(mutated) == [9], "la seconde doit survivre intacte"


class TestLeRapport:
    """Ce que le garde conclut des rouges qu'il mesure."""

    def test_un_refus_dont_le_test_rougit_sous_un_autre_refus_est_refuse(self, tmp_path, verdicts):
        """Le défaut que ce garde est seul à voir : un rouge collatéral. Le test
        partagé rougit bien sous les deux refus, et pourtant il n'en verrouille aucun
        — et le refus qui a son test à lui passe, ce qui prouve que la règle ne
        refuse pas tout."""
        verdicts(
            True,
            ["suite::test_du_premier", "partage::test_commun"],
            ["partage::test_commun"],
            ["partage::test_commun"],
        )
        report = GUARD.run(fake_repo(tmp_path, THREE_REFUSALS))

        assert [label for label, _ in report.errors] == [GUARD.label_of(5), GUARD.label_of(7)]
        assert all("aucun ne lui appartient" in message for _, message in report.errors)
        assert "if value == 5:" in report.errors[0][1], "l'autre refus doit être nommé"
        owners = list(report.owners.values())
        assert owners[0] == ["suite::test_du_premier"], "le refus qui a son test passe"
        assert owners[1:] == [[], []]

    def test_un_refus_que_personne_n_exerce_est_rapporte(self, tmp_path, verdicts):
        """Ce que la dérivation remplace : la table. Un refus ajouté au générateur est
        muté de lui-même, et signalé tant qu'aucun test ne rougit sous lui — là où une
        table tenue à la main l'aurait ignoré."""
        verdicts(True, ["suite::test_du_premier"], [], ["suite::test_du_troisieme"])
        report = GUARD.run(fake_repo(tmp_path, THREE_REFUSALS))

        assert [label for label, _ in report.errors] == [GUARD.label_of(5)]
        assert "AUCUN test" in report.errors[0][1]

    def test_une_suite_deja_rouge_arrete_avant_toute_mutation(self, tmp_path, verdicts):
        """Sans état de référence, n'importe quel rouge serait un faux positif : la
        suite doit d'abord PASSER sur les copies intactes, et rien ne doit être muté
        ensuite."""
        calls = verdicts(False, ["suite::test_quelconque"])
        report = GUARD.run(fake_repo(tmp_path, THREE_REFUSALS))

        assert [label for label, _ in report.errors] == ["état de référence"]
        assert report.owners == {} and len(calls) == 1

    def test_un_perimetre_incomplet_est_une_erreur(self, tmp_path):
        """Rien à copier (mauvaise racine) : une erreur, pas un succès silencieux."""
        report = GUARD.run(tmp_path / "absent")

        assert len(report.errors) == 1 and "périmètre" in report.errors[0][1]


class TestCablage:
    def test_le_seul_executeur_est_l_etape_du_job_backend(self):
        """La preuve est payée une fois par push, ici et nulle part ailleurs : le
        commandement n'apparaît qu'une fois dans le workflow, dans le job qui installe
        `backend/requirements.txt` — donc Pillow, que le fichier de test importe et que
        les copies du garde exécutent."""
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        backend = job_block("backend-tests", workflow)

        assert workflow.count(COMMAND) == 1, "un second exécutant paierait la même preuve deux fois"
        assert COMMAND in backend
        assert "-r requirements.txt" in backend, "sans ses dépendances, l'étape ne peut pas tourner"

    def test_la_derivation_couvre_chaque_raise_du_generateur(self):
        """Ce que le garde verra en CI, sur le vrai générateur : chaque refus a une
        condition unique et neutralisable, et AUCUN `raise SystemExit` n'est hors de sa
        portée. C'est ce qui remplace la table tenue à la main : un refus ajouté est
        muté, un `raise` sans `if` est signalé."""
        source = (REPO_ROOT / GUARD.GENERATOR_FILE).read_text(encoding="utf-8")
        refusals, orphans = GUARD.parse_refusals(source)
        conditions = [refusal.condition for refusal in refusals]

        assert refusals, "la dérivation ne voit plus aucun refus : elle est cassée"
        assert orphans == [], "ces raises ne sont portés par aucun if : %s" % orphans
        assert len(set(conditions)) == len(conditions), "deux refus partagent une condition"
        for refusal in refusals:
            mutated = GUARD.neutralized(source, refusal)
            changed = [
                index
                for index, (before, after) in enumerate(
                    zip(source.splitlines(), mutated.splitlines())
                )
                if before != after
            ]
            assert len(changed) == 1, refusal
