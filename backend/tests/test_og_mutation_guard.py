# -*- coding: utf-8 -*-
"""Le garde qui prouve que les tests des refus du générateur OG savent échouer.

.github/scripts/check-og-test-mutations.py existe parce que cette preuve avait été
faite à la main — huit mutations du générateur, restaurées à l'empreinte SHA-1 —
donc hors du dépôt : une preuve qu'on ne peut pas rejouer depuis un checkout ne
protège rien. Ce garde la rejoue, et il en est le SEUL propriétaire : l'étape du job
`backend-tests` l'exécute une fois par push.

Ce fichier-ci prouve que le garde SAIT refuser — suite aveugle, condition ambiguë,
raise sans `if`, tests partagés entre deux refus, état de référence cassé, périmètre
incomplet — sans rejouer les neuf mutations du vrai générateur, ce qui paierait deux
fois la même preuve. Chaque cas monte donc une arborescence minuscule : un
générateur factice de deux refus, et la suite qui les exerce.
"""
import importlib.util
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GUARD_PATH = REPO_ROOT / ".github" / "scripts" / "check-og-test-mutations.py"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _load_guard():
    spec = importlib.util.spec_from_file_location("check_og_test_mutations", GUARD_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GUARD = _load_guard()

ONE_REFUSAL = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    return value
"""

TWO_REFUSALS = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    if value > 10:
        raise SystemExit('valeur trop grande')
    return value
"""

# Un refus que rien ne porte : la dérivation ne peut pas savoir quand il tombe.
ORPHAN = """\
def check(value):
    if value < 0:
        raise SystemExit('valeur négative')
    raise SystemExit('sans if')
"""

# La suite charge le générateur FACTICE par son chemin, comme le vrai fichier de test.
LOADER = """\
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "gen_factice",
    Path(__file__).resolve().parent.parent.parent / "frontend" / "scripts" / "gen-og-images.py",
)
GEN = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(GEN)


def refuse(value):
    try:
        GEN.check(value)
    except SystemExit:
        return True
    return False
"""

BLIND_SUITE = "def test_rien():\n    assert True\n"
BROKEN_SUITE = "def test_rien():\n    assert False\n"

# Un test par refus : chacun rougit sous le sien SEUL.
ONE_OWNER_SUITE = LOADER + """


def test_refuse_la_valeur_negative():
    assert refuse(-1)
"""

TWO_OWNERS_SUITE = LOADER + """

def test_refuse_la_valeur_negative():
    assert refuse(-1)


def test_refuse_la_valeur_trop_grande():
    assert refuse(11)
"""

# Un seul test pour les deux refus : il rougit sous l'un comme sous l'autre, donc
# aucun des deux n'a de test qui lui appartienne.
SHARED_SUITE = LOADER + """

def test_refuse_les_deux():
    assert refuse(-1) and refuse(11)
"""


def fake_repo(tmp_path, generator, suite):
    """Une arborescence où le générateur ET la suite sont ceux du cas, aux chemins
    réels : c'est ce qui permet de fabriquer le cas qu'on veut prouver."""
    tree = tmp_path / "repo"
    for relative in (GUARD.GENERATOR_FILE, GUARD.DICTIONARY_FILE):
        target = tree / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / relative, target)
    (tree / GUARD.GENERATOR_FILE).write_text(generator, encoding="utf-8")
    test = tree / GUARD.TEST_FILE
    test.parent.mkdir(parents=True, exist_ok=True)
    test.write_text(suite, encoding="utf-8")
    return tree


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

        assert changed == [1]
        alike = lambda text: [
            index for index, line in enumerate(text.splitlines()) if line.strip() == "if value < 0:"
        ]
        assert alike(source) == [1, 9], "la source doit bien porter deux lignes identiques"
        assert alike(mutated) == [9], "la seconde doit survivre intacte"


class TestRefuses:
    def test_une_suite_aveugle_ne_verrouille_rien(self, tmp_path):
        """Le garde ne se contente pas de lancer pytest : il exige un ROUGE. Une suite
        qui passe toujours doit donc lui faire nommer le refus, avec l'annotation que
        la CI affiche."""
        report = GUARD.run(fake_repo(tmp_path, ONE_REFUSAL, BLIND_SUITE))

        assert [label for label, _ in report.errors] == [GUARD.label_of(3)]
        assert "AUCUN test" in report.errors[0][1]

    def test_un_test_qui_rougit_sous_tous_les_refus_n_en_prouve_aucun(self, tmp_path):
        """Le défaut que ce garde est seul à voir : un rouge collatéral. Le test
        partagé rougit bien sous chacun des deux refus, et pourtant il n'en verrouille
        aucun — chaque refus doit avoir un test qui rougit sous lui SEUL."""
        report = GUARD.run(fake_repo(tmp_path, TWO_REFUSALS, SHARED_SUITE))

        assert [label for label, _ in report.errors] == [GUARD.label_of(3), GUARD.label_of(5)]
        assert all("aucun ne lui appartient" in message for _, message in report.errors)
        assert all(report.owners[refusal] == [] for refusal in report.owners)

    def test_un_refus_ajoute_est_mute_sans_que_personne_ne_le_declare(self, tmp_path):
        """Ce que la dérivation remplace : la table. Le générateur gagne un refus que
        la suite n'exerce pas ; le garde le mute de lui-même et le signale avec sa
        ligne, là où une table tenue à la main l'aurait ignoré."""
        report = GUARD.run(fake_repo(tmp_path, TWO_REFUSALS, ONE_OWNER_SUITE))

        assert [label for label, _ in report.errors] == [GUARD.label_of(5)]
        assert "AUCUN test" in report.errors[0][1]

    def test_un_test_propre_a_son_refus_suffit_a_le_verrouiller(self, tmp_path):
        """La contre-épreuve : la règle d'appartenance ne refuse pas tout. Deux refus,
        deux tests, chacun nommé comme propriétaire du sien."""
        report = GUARD.run(fake_repo(tmp_path, TWO_REFUSALS, TWO_OWNERS_SUITE))

        assert report.errors == []
        owners = {refusal.condition: owned for refusal, owned in report.owners.items()}
        assert [GUARD.short(name) for name in owners["value < 0"]] == [
            "test_refuse_la_valeur_negative"
        ]
        assert [GUARD.short(name) for name in owners["value > 10"]] == [
            "test_refuse_la_valeur_trop_grande"
        ]

    def test_une_suite_cassee_est_refusee_avant_toute_mutation(self, tmp_path):
        """Sans état de référence, n'importe quel rouge serait un faux positif : la
        suite doit d'abord PASSER sur les copies intactes."""
        report = GUARD.run(fake_repo(tmp_path, ONE_REFUSAL, BROKEN_SUITE))

        assert [label for label, _ in report.errors] == ["état de référence"]
        assert report.owners == {}

    def test_un_perimetre_incomplet_est_une_erreur(self, tmp_path):
        """Rien à copier (mauvaise racine) : une erreur, pas un succès silencieux."""
        report = GUARD.run(tmp_path / "absent")

        assert len(report.errors) == 1 and "périmètre" in report.errors[0][1]


class TestDepotReel:
    def test_la_derivation_couvre_chaque_raise_du_generateur(self):
        """Ce que le garde verra en CI, sur le vrai générateur : chaque refus a une
        condition unique et neutralisable, et AUCUN `raise SystemExit` n'est hors de
        sa portée. C'est ce qui remplace la table tenue à la main : un refus ajouté
        est muté, un `raise` sans `if` est signalé."""
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

    def test_le_garde_est_cable_dans_la_ci(self):
        """Le garde ne sert que s'il tourne, et il tourne ICI pour tout le monde :
        c'est l'étape qui rejoue les mutations, sur un job qui a pytest et Pillow (le
        fichier de test importe le générateur réel). Rien ne le rejoue dans la suite :
        ce contrôle de câblage est tout ce que la suite en dit."""
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        assert "python .github/scripts/check-og-test-mutations.py" in workflow
