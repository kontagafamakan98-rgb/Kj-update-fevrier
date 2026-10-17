# -*- coding: utf-8 -*-
"""Régression : la sonde SEO ne se lance que stricte depuis un workflow.

Le défaut que ce test verrouille
--------------------------------
F9 (CI-COVERAGE.md) est né du mode INFORMATIF de
`frontend/scripts/check-seo-production.js` : il publie un `::notice` par fait
constaté et rend **0**. Quatre intégrations SEO/analytics absentes de la
production, la CI verte, aucun run rouge nulle part — l'étape informative de
`ci.yml` a été retirée le 10/10/2026 pour cette raison exacte.

Ce qui reste vrai : la sonde tourne en `--strict` là où ça bloque (le cron
`seo-production-probe.yml` et, juste après la vérification de la révision servie,
`frontend-build`). Mais le mode par DÉFAUT du script est l'informatif : un oubli
de `--strict` rend le silence possible à nouveau, et rien ne rougissait. Ces cas
tiennent les deux moitiés du garde `.github/scripts/check-seo-probe-strict.py` :
le drapeau obligatoire, et l'étape qui ne peut pas rougir même avec le drapeau
(`continue-on-error`, commande neutralisée).

Le troisième côté, qui n'est pas un workflow
--------------------------------------------
`npm run livrer` (`.github/scripts/livrer.py`) lance la MÊME sonde stricte juste
après avoir confirmé la révision servie, pour que le verdict tombe dans le
terminal de la livraison. C'est donc une invocation de plus À COUVRIR : sans
lecture de ce fichier, retirer son `--strict` remettrait un verdict informatif
dans le trajet de livraison sans qu'aucun garde ne rougisse. Le garde le lit par
son AST, et ces cas tiennent les deux moitiés : la liste d'arguments est jugée, la
prose qui cite la sonde ne l'est pas, et un fichier déclaré INTROUVABLE refuse de
conclure au lieu de réduire le périmètre en silence.

Ce que ces tests ne prouvent pas : que la sonde passe sur la production (mesure,
pas propriété du dépôt), ni qu'un workflow AJOUTÉ demain lance la sonde — le
garde lit le dossier, donc il couvrira un fichier neuf, mais il ne peut pas
exiger qu'il en existe un.
"""
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-seo-probe-strict.py"
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
LIVRER = REPO_ROOT / ".github" / "scripts" / "livrer.py"

# La commande de la CI, sans variante : c'est celle que la livraison doit rejouer.
COMMANDE_INVOCATION = "node scripts/check-seo-production.js --strict"


def _charger():
    spec = importlib.util.spec_from_file_location("check_seo_probe_strict", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def garde():
    return _charger()


def fixture_workflow(racine: Path, contenu: str) -> Path:
    """Écrit un workflow de fixture et rend son chemin."""
    dossier = racine / ".github" / "workflows"
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / "fixture.yml"
    chemin.write_text(contenu, encoding="utf-8")
    return chemin


# Les trois formes de la surface de livraison : celle qui invoque en strict (ce que
# fait le dépôt), celle qui invoque en informatif (le défaut que le garde refuse), et
# celle qui n'invoque RIEN (elle existe, donc « surface introuvable » ne s'applique
# pas — c'est ce qu'il faut pour juger les workflows seuls).
LIVRER_STRICT = """import subprocess


def verifier():
    subprocess.run(
        ["node", "scripts/check-seo-production.js", "--strict"],
        capture_output=False,
    )
"""

LIVRER_INFORMATIF = """import subprocess


def verifier():
    subprocess.run(["node", "scripts/check-seo-production.js"], capture_output=False)
"""

LIVRER_PROSE = '''"""Une prose qui CITE node scripts/check-seo-production.js --strict."""

# node scripts/check-seo-production.js --strict (dans un commentaire)


def rien():
    return 1
'''

SANS_SONDE = """def rien():
    return 1
"""


def fixture_livrer(racine: Path, contenu: str = SANS_SONDE) -> Path:
    """Écrit la surface de livraison de la fixture et rend son chemin.

    Elle existe PAR DÉFAUT sans invoquer la sonde : le garde refuse une surface
    déclarée introuvable, donc une fixture qui l'omettrait rougirait pour une raison
    qui n'est pas celle du cas.
    """
    dossier = racine / ".github" / "scripts"
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / "livrer.py"
    chemin.write_text(contenu, encoding="utf-8")
    return chemin


INFORMATIVE = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Sonde informative (le défaut que F9 a fermé)
        run: node scripts/check-seo-production.js
"""

STRICTE = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Sonde stricte
        run: node scripts/check-seo-production.js --strict
"""


class TestAnalyse:
    """Les décisions pures : ce qui est une invocation, et ce qui est un refus."""

    def test_une_invocation_informative_est_refusee_et_nommee(self, garde):
        refus = garde.refus(INFORMATIVE, "fixture.yml")

        assert len(refus) == 1, refus
        # Le refus doit dire OÙ (fichier + ligne de la COMMANDE, celle qu'on peut
        # ouvrir) et POURQUOI : c'est le mode informatif qui a laissé F9 ouvert,
        # et un refus sans cause se corrige en remettant le drapeau sans
        # comprendre.
        assert "fixture.yml:7" in refus[0]
        assert "--strict" in refus[0]
        assert "10/10/2026" in refus[0]

    def test_une_invocation_stricte_est_acceptee(self, garde):
        assert garde.refus(STRICTE, "fixture.yml") == []

    def test_manque_le_mode_strict(self, garde):
        """Le propriétaire du refus : c'est cette ligne qui décide du drapeau."""
        assert garde.manque_le_mode_strict("node scripts/check-seo-production.js") is True
        assert garde.manque_le_mode_strict("node scripts/check-seo-production.js --strict") is False

    def test_un_commentaire_n_est_pas_une_commande(self, garde):
        # Deux commentaires citent la forme retirée : sans cette règle, le garde
        # refuserait la prose qui EXPLIQUE la règle.
        texte = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      # node scripts/check-seo-production.js (cité dans un commentaire YAML)
      - name: Sonde stricte
        run: |
          # node scripts/check-seo-production.js (cité dans un commentaire shell)
          node scripts/check-seo-production.js --strict
"""
        assert garde.refus(texte, "fixture.yml") == []
        assert len(garde.invocations(texte)) == 1

    def test_la_continuation_de_ligne_est_recollée(self, garde):
        """Un `--strict` à la ligne suivante n'est pas un oubli de drapeau."""
        texte = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Sonde stricte
        run: |
          node scripts/check-seo-production.js \\
            --strict
"""
        assert garde.refus(texte, "fixture.yml") == []
        invocations = garde.invocations(texte)
        assert len(invocations) == 1
        assert "--strict" in invocations[0][1]

    def test_une_ligne_vide_ne_prolonge_pas_la_continuation(self, garde):
        """`\\` continue sur la ligne IMMÉDIATEMENT suivante, comme dans le shell :
        une ligne vide termine la commande, donc un `--strict` plus loin
        n'appartient pas à l'invocation. Les recoller blanchirait une étape
        informative avec le drapeau d'une autre commande."""
        texte = (
            "name: Fixture\non: [push]\njobs:\n  j:\n    steps:\n"
            "      - name: Sonde\n        run: |\n"
            "          node scripts/check-seo-production.js \\\n"
            "\n"
            '          echo "mesure terminée" --strict\n'
        )
        refus = garde.refus(texte, "fixture.yml")

        assert len(refus) == 1, refus
        assert "fixture.yml:8" in refus[0]

    def test_un_commentaire_recu_en_continuation_ne_donne_pas_le_drapeau(self, garde):
        """Le shell retire le `\\` de fin de ligne AVANT de lire le commentaire :
        son texte n'est pas la suite de la commande, donc un `--strict` cité
        dans ce commentaire ne compte pas pour l'invocation."""
        texte = (
            "name: Fixture\non: [push]\njobs:\n  j:\n    steps:\n"
            "      - name: Sonde\n        run: |\n"
            "          node scripts/check-seo-production.js \\\n"
            "          # --strict (cité dans un commentaire)\n"
        )
        refus = garde.refus(texte, "fixture.yml")

        assert len(refus) == 1, refus
        assert "fixture.yml:8" in refus[0]

    def test_continue_on_error_est_refuse_meme_en_strict(self, garde):
        texte = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Sonde stricte mais neutralisée
        continue-on-error: true
        run: node scripts/check-seo-production.js --strict
"""
        refus = garde.refus(texte, "fixture.yml")

        assert len(refus) == 1, refus
        assert "continue-on-error" in refus[0]

    def test_une_commande_neutralisee_est_refusee(self, garde):
        texte = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Sonde stricte, code de sortie avalé
        run: node scripts/check-seo-production.js --strict || true
"""
        refus = garde.refus(texte, "fixture.yml")

        assert len(refus) == 1, refus
        assert "ne peut pas échouer" in refus[0]

    def test_une_liste_d_arguments_python_est_lue_et_jugee(self, garde):
        """La surface de livraison est du PYTHON : l'invocation est une liste
        d'arguments, et un `--strict` à la ligne suivante est bien le même appel."""
        invocations = garde.invocations_python(LIVRER_STRICT)

        assert len(invocations) == 1, invocations
        assert invocations[0][1] == COMMANDE_INVOCATION, invocations

    def test_une_prose_python_n_est_pas_une_invocation(self, garde):
        """Une docstring ou un commentaire qui CITENT la sonde ne sont pas des
        commandes : les confondre accuserait un fichier qui ne lance rien."""
        assert garde.invocations_python(LIVRER_PROSE) == []

    def test_une_liste_python_sans_strict_est_refusee(self, garde):
        invocations = garde.invocations_python(LIVRER_INFORMATIF)

        assert len(invocations) == 1, invocations
        numero, commande = invocations[0]
        assert garde.manque_le_mode_strict(commande) is True
        assert "livrer.py" in garde.refus_commande(numero, commande, "livrer.py")[0]

    def test_un_autre_script_n_est_pas_juge(self, garde):
        """`setup-seo-env.js` appelle la sonde EN PROCESSUS : ce n'est pas une
        invocation de CLI, et ce n'est pas ce que ce garde couvre."""
        texte = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Poser les variables, redéployer, relire
        run: node scripts/setup-seo-env.js
"""
        assert garde.invocations(texte) == []
        assert garde.refus(texte, "fixture.yml") == []


class TestCLI:
    """Le verdict du script, sur le dépôt réel et sur des fixtures."""

    def test_le_depot_reel_ne_porte_que_des_invocations_strictes(self, garde, capsys):
        assert garde.main([]) == 0

        sortie = capsys.readouterr().out
        invocations = [
            (chemin.name, commande)
            for chemin in garde.fichiers_par_defaut()
            for _, commande in garde.invocations(chemin.read_text(encoding="utf-8"))
        ]
        # Deux WORKFLOWS lancent la sonde : le cron quotidien, et l'étape de
        # livraison de `frontend-build`. Le compte est écrit ici pour qu'un
        # troisième appel — ou la disparition d'un des deux — se lise dans le
        # verdict plutôt que de passer inaperçu.
        assert len(invocations) == 2, invocations
        assert all("--strict" in commande for _, commande in invocations), invocations
        assert "ci.yml" in sortie and "seo-production-probe.yml" in sortie

    def test_le_script_de_livraison_est_lu_et_juge(self, garde, capsys):
        """Troisième surface, hors workflow : `npm run livrer` lance la MÊME sonde
        stricte juste après la confirmation de la révision servie, et c'est le même
        garde qui la lit. Le compte TOTAL est écrit ici : une surface qui
        disparaîtrait du verdict (fichier renommé, lecture neutralisée) se lirait
        comme un vert complet sur les workflows seuls."""
        assert garde.main([]) == 0

        sortie = capsys.readouterr().out
        assert "livrer.py" in sortie, sortie
        assert "[OK] 3 invocation(s)" in sortie, sortie
        # « Sans variante » : la livraison rejoue la commande de la CI telle quelle.
        commandes = [
            commande for _, commande in garde.invocations_python(LIVRER.read_text(encoding="utf-8"))
        ]
        assert commandes == [COMMANDE_INVOCATION], commandes

    def test_le_garde_echoue_sur_une_fixture_informative(self, garde, tmp_path, capsys):
        fixture_workflow(tmp_path, INFORMATIVE)
        fixture_livrer(tmp_path)

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "::error title=Sonde SEO stricte" in sortie
        assert "--strict" in sortie

    def test_un_script_de_livraison_informatif_est_refuse(self, garde, tmp_path, capsys):
        """Le trajet de livraison est une SURFACE comme une autre : une invocation
        sans `--strict` y publierait un rapport qui ne bloque rien, et le terminal
        afficherait un verdict vert sur une production non conforme."""
        fixture_workflow(tmp_path, STRICTE)
        fixture_livrer(tmp_path, LIVRER_INFORMATIF)

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "livrer.py:5" in sortie, sortie
        assert "--strict" in sortie

    def test_la_surface_declaree_introuvable_refuse_de_conclure(self, garde, tmp_path, capsys):
        """Un périmètre qui se réduit tout seul est un faux vert : la surface est
        DÉCLARÉE, donc son absence est un refus, jamais un silence."""
        fixture_workflow(tmp_path, STRICTE)

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "livrer.py introuvable" in sortie, sortie

    def test_sans_invocation_le_garde_refuse_de_conclure(self, garde, tmp_path, capsys):
        """Un garde qui ne voit rien ne prouve rien : vert à vide, il laisserait
        croire que la règle est tenue alors qu'il ne lit plus son sujet."""
        fixture_workflow(
            tmp_path,
            "name: Fixture\non: [push]\njobs:\n  j:\n    steps:\n      - run: echo rien\n",
        )
        fixture_livrer(tmp_path)

        assert garde.main(["--root", str(tmp_path)]) == 1
        assert "garde aveugle" in capsys.readouterr().out

    def test_le_garde_est_cable_dans_un_job_requis(self, garde):
        """Un garde que personne n'exécute ne garde rien : le job `workflow-lint`
        est un check REQUIS de la protection de branche (mesuré le 12/10/2026)."""
        workflow = CI.read_text(encoding="utf-8")

        # Appelé sans argument : il balaie `.github/workflows/` lui-même, donc un
        # workflow AJOUTÉ demain est couvert sans être inscrit ici.
        assert "python3 .github/scripts/check-seo-probe-strict.py\n" in workflow
