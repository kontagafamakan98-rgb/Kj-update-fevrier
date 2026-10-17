# -*- coding: utf-8 -*-
"""Régression : aucune étape de workflow ne peut échouer en silence sans être déclarée.

Le défaut que ce test verrouille
--------------------------------
F9 (CI-COVERAGE.md) a une cause unique : une étape qui publie un rapport sans
pouvoir faire rougir le run. La sonde SEO n'en était qu'une INSTANCE ; la syntaxe
qui la produisait — `continue-on-error: true`, une commande neutralisée
(`|| true`, `|| :`, `|| exit 0`), des erreurs ignorées (`set +e`) — est
disponible dans n'importe quelle étape. Le garde
`.github/scripts/check-informative-steps.py` mesure cet inventaire dans tout
`.github/workflows/` et exige que chaque forme soit DÉCLARÉE, avec son motif,
dans `.github/scripts/informative-steps.json`.

Ce que ces cas tiennent
-----------------------
1. la DÉTECTION : les trois formes sont vues, au niveau de l'étape comme du job,
   et nommées (fichier:ligne, job, étape, forme) ;
2. la JUSTESSE : un commentaire n'est pas une commande, et une étape déclarée
   n'est pas accusée — une exception s'écrit, elle ne se contente pas d'exister ;
3. les REFUS du registre : déclaration périmée, nombre d'occurrences qui change,
   motif trop court, forme inconnue, registre illisible — le garde ne peut pas
   juger ce qu'il ne peut pas lire, donc il refuse de conclure au lieu de verdir ;
4. le PLANCHER de lecture : sous 40 étapes lues, c'est le lecteur qui est cassé ;
5. le CÂBLAGE : le garde tourne dans `workflow-lint`, un check requis de la
   protection de branche (mesuré le 12/10/2026).

Ce que ces tests ne prouvent pas : que les 7 formes déclarées du dépôt sont
légitimes — c'est une décision écrite, entrée par entrée, dans le registre et
dans AUDIT-VERIFICATIONS-NON-BLOQUANTES.md —, ni qu'une étape ajoutée demain sera
légitime : elle sera refusée tant qu'elle n'est pas déclarée.
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-informative-steps.py"
REGISTRE = REPO_ROOT / ".github" / "scripts" / "informative-steps.json"
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"

INVOCATION = "python3 .github/scripts/check-informative-steps.py"


def _charger():
    spec = importlib.util.spec_from_file_location("check_informative_steps", SCRIPT)
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


# ── Les fixtures : une forme par cas, aux numéros de ligne COMPTÉS ─────────────
# Le garde juge la ligne de la COMMANDE, celle qu'on peut ouvrir : les fixtures
# sont écrites en clair pour que ce numéro soit vérifiable à l'œil.

NEUTRALISEE = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Rapport qui ne peut pas échouer
        run: |
          node scripts/rapport.js || true
"""

CONTINUE_ON_ERROR_ETAPE = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Rapport doux
        continue-on-error: true
        run: node scripts/rapport.js
"""

CONTINUE_ON_ERROR_JOB = """name: Fixture
on: [push]
jobs:
  j:
    continue-on-error: true
    steps:
      - name: Verdict
        run: node scripts/verdict.js
"""

ERREURS_IGNOREES = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      - name: Mesure qui n'abandonne pas
        run: |
          set +e
          node scripts/mesure.js
"""

COMMENTAIRES_SEULEMENT = """name: Fixture
on: [push]
jobs:
  j:
    steps:
      # node scripts/rapport.js || true (cité dans un commentaire YAML)
      - name: Rapport honnête
        run: |
          # node scripts/rapport.js || true (cité dans un commentaire shell)
          node scripts/rapport.js
"""


def occurrences_de(garde, racine: Path, contenu: str) -> list[dict]:
    chemin = fixture_workflow(racine, contenu)
    trouvees, _ = garde.occurrences(chemin)
    return trouvees


# Le VERDICT du script (et non la seule détection) exige que le plancher de
# lecture soit franchi : une fixture d'une étape fait refuser le garde AVANT de
# juger, ce qui n'est pas le cas mesuré. Les fixtures du CLI portent donc 41
# étapes, dont la dernière est neutralisée — la seule qui doit être nommée.
def workflow_avec_plancher(neutralisee: bool = True) -> str:
    lignes = ["name: Fixture", "on: [push]", "jobs:", "  j:", "    steps:"]
    for rang in range(1, 41):
        lignes.append(f"      - name: Etape {rang}")
        lignes.append(f"        run: echo {rang}")
    lignes.append("      - name: Rapport qui ne peut pas échouer")
    lignes.append(
        "        run: node scripts/rapport.js || true" if neutralisee
        else "        run: node scripts/rapport.js"
    )
    return "\n".join(lignes) + "\n"


# La commande neutralisée de cette fixture : ligne 87 (41 étapes de deux lignes
# après les cinq lignes d'en-tête de job).
LIGNE_NEUTRALISEE = 87


class TestDetection:
    """Ce qui rend une étape incapable d'échouer, et comment le garde le nomme."""

    def test_une_commande_neutralisee_non_declaree_est_refusee_et_nommee(self, garde, tmp_path):
        trouvees = occurrences_de(garde, tmp_path, NEUTRALISEE)

        assert len(trouvees) == 1, trouvees
        occurrence = trouvees[0]
        assert occurrence == {
            "fichier": "fixture.yml", "job": "j",
            "etape": "Rapport qui ne peut pas échouer",
            "forme": "commande neutralisee", "ligne": 8,
        }, occurrence
        refus = garde.confronter(trouvees, [])
        assert len(refus) == 1, refus
        # Le refus dit OÙ (la ligne de la commande) ET POURQUOI : un refus sans
        # cause se corrige en recopiant la déclaration sans la comprendre.
        assert "fixture.yml:8" in refus[0]
        assert "informative-steps.json" in refus[0]
        assert "F9" in refus[0]

    def test_continue_on_error_de_l_etape_est_vu(self, garde, tmp_path):
        trouvees = occurrences_de(garde, tmp_path, CONTINUE_ON_ERROR_ETAPE)

        assert [(o["forme"], o["ligne"]) for o in trouvees] == [("continue-on-error", 7)], trouvees

    def test_continue_on_error_du_job_est_vu(self, garde, tmp_path):
        """Au niveau du job, la forme ne neutralise pas une étape mais TOUT le job,
        y compris ses étapes de verdict : le refus nomme le job, pas une étape."""
        trouvees = occurrences_de(garde, tmp_path, CONTINUE_ON_ERROR_JOB)

        assert len(trouvees) == 1, trouvees
        assert trouvees[0]["forme"] == "continue-on-error"
        assert trouvees[0]["etape"] == "<job j>"
        assert trouvees[0]["ligne"] == 5

    def test_les_erreurs_ignorees_sont_vues(self, garde, tmp_path):
        """`set +e` ne laisse aucune trace dans un verdict : c'est la forme la plus
        discrète des trois, donc celle qu'un simple grep de `|| true` manquerait."""
        trouvees = occurrences_de(garde, tmp_path, ERREURS_IGNOREES)

        assert [(o["forme"], o["ligne"]) for o in trouvees] == [("erreurs ignorees", 8)], trouvees

    def test_un_commentaire_n_est_pas_une_commande(self, garde, tmp_path):
        """Deux commentaires citent la forme : sans cette règle, le garde
        refuserait la prose qui EXPLIQUE la règle — y compris la sienne."""
        assert occurrences_de(garde, tmp_path, COMMENTAIRES_SEULEMENT) == []

    def test_une_etape_sans_name_est_nommee_par_son_rang(self, garde, tmp_path):
        """Le registre doit pouvoir nommer TOUTE étape mesurée : une étape anonyme
        rendrait la déclaration impossible, donc la forme indéclarable."""
        texte = "name: Fixture\non: [push]\njobs:\n  j:\n    steps:\n      - run: node x.js || true\n"
        trouvees = occurrences_de(garde, tmp_path, texte)

        assert len(trouvees) == 1, trouvees
        assert trouvees[0]["etape"] == "<étape 1 de j>", trouvees[0]


class TestRegistre:
    """Les refus du jugement : aucune déclaration ne vaut sans ce qu'elle décrit."""

    def _occurrence(self, ligne=8):
        return {"fichier": "fixture.yml", "job": "j", "etape": "Rapport", "forme":
                "commande neutralisee", "ligne": ligne}

    def _declaration(self, **remplacements):
        declaration = {
            "fichier": "fixture.yml", "job": "j", "etape": "Rapport",
            "forme": "commande neutralisee", "nombre": 1,
            "motif": "Harnais de mutation : l'échec est le résultat attendu, le verdict est l'assertion.",
        }
        declaration.update(remplacements)
        return declaration

    def test_une_forme_declaree_n_est_pas_accusee(self, garde):
        assert garde.confronter([self._occurrence()], [self._declaration()]) == []

    def test_une_declaration_perimee_est_refusee(self, garde):
        """Sans ce refus, le registre deviendrait une liste d'espoirs : l'entrée
        survivrait à la disparition de la forme qu'elle décrit, et une nouvelle
        forme pourrait se cacher derrière une déclaration morte."""
        refus = garde.confronter([], [self._declaration()])

        assert len(refus) == 1, refus
        assert "PÉRIMÉE" in refus[0]

    def test_le_nombre_declare_est_verifie(self, garde):
        """Une seconde neutralisation AJOUTÉE à côté d'une neutralisation déclarée
        serait une neutralisation non déclarée : le nombre est jugé, pas seulement
        la présence."""
        refus = garde.confronter([self._occurrence(), self._occurrence(12)], [self._declaration()])

        assert len(refus) == 1, refus
        assert "2 occurrence(s) mesurée(s), 1 déclarée(s)" in refus[0]

    def test_une_declaration_dupliquee_est_refusee(self, garde):
        refus = garde.confronter([self._occurrence()], [self._declaration(), self._declaration()])

        assert len(refus) == 1, refus
        assert "déclaré deux fois" in refus[0]

    def test_un_motif_trop_court_est_refuse(self, garde):
        """« outillage » n'est pas un motif : l'échappatoire de ce garde s'écrit,
        elle ne se constate pas."""
        refus = garde.confronter([self._occurrence()], [self._declaration(motif="outillage")])

        assert len(refus) == 1, refus
        assert "motif trop court" in refus[0]

    def test_une_forme_inconnue_est_refusee(self, garde, tmp_path, capsys):
        """Un registre qui nomme une forme que le garde ne mesure pas est un
        registre qui décrit autre chose que la règle appliquée."""
        chemin = tmp_path / "registre.json"
        chemin.write_text(json.dumps({"declarations": [
            {**self._declaration(), "forme": "sortie 0 par defaut"}
        ]}), encoding="utf-8")

        with pytest.raises(SystemExit) as sortie:
            garde.charger_registre(chemin)

        assert "forme inconnue" in str(sortie.value)

    def test_un_champ_manquant_est_refuse(self, garde, tmp_path):
        chemin = tmp_path / "registre.json"
        declaration = self._declaration()
        declaration.pop("motif")
        chemin.write_text(json.dumps({"declarations": [declaration]}), encoding="utf-8")

        with pytest.raises(SystemExit) as sortie:
            garde.charger_registre(chemin)

        assert "motif" in str(sortie.value)

    def test_un_registre_illisible_ne_rend_pas_vert(self, garde, tmp_path):
        with pytest.raises(SystemExit) as sortie:
            garde.charger_registre(tmp_path / "absent.json")

        assert "registre illisible" in str(sortie.value)


class TestCLI:
    """Le verdict du script : sur le dépôt réel, et sur des fixtures."""

    def test_le_depot_reel_ne_porte_que_des_formes_declarees(self, garde, capsys):
        assert garde.main([]) == 0

        sortie = capsys.readouterr().out
        assert "[OK] 7 forme(s)" in sortie, sortie
        assert "informative-steps.json" in sortie
        # Le registre ne peut pas déclarer autre chose que ce qui est MESURÉ :
        # c'est le sens du verdict, et il est écrit ici pour qu'un ajout de forme
        # déclarée passe par ce fichier (donc par une relecture).
        assert len(json.loads(REGISTRE.read_text(encoding="utf-8"))["declarations"]) == 7

    def test_l_inventaire_est_mesure(self, garde, capsys):
        """`--list` sert à RELIRE l'inventaire avant d'écrire une déclaration."""
        assert garde.main(["--list"]) == 0

        sortie = capsys.readouterr().out
        assert "Inventaire mesuré" in sortie
        assert "commande neutralisee" in sortie
        assert "erreurs ignorees" in sortie

    def test_le_garde_echoue_sur_une_fixture_non_declaree(self, garde, tmp_path, capsys):
        fixture_workflow(tmp_path, workflow_avec_plancher())

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "::error title=Étapes informatives" in sortie
        assert "n'est PAS déclarée" in sortie
        assert f"fixture.yml:{LIGNE_NEUTRALISEE}" in sortie, sortie
        assert "Rapport qui ne peut pas échouer" in sortie, sortie

    def test_une_forme_disparue_rend_sa_declaration_perimee(self, garde, tmp_path, capsys):
        """Le registre est celui du DÉPÔT, et il est jugé en entier à chaque run :
        une fixture qui ne porte plus aucune forme ne « passe » donc pas — elle
        rend périmées les déclarations qu'elle ne vérifie plus. Un périmètre qui
        se vide se DIT, il ne se tait pas (c'est ce qui empêche le registre de
        devenir une liste d'espoirs)."""
        fixture_workflow(tmp_path, workflow_avec_plancher(neutralisee=False))

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "PÉRIMÉE" in sortie, sortie

    def test_sous_le_plancher_de_lecture_le_garde_refuse_de_conclure(self, garde, tmp_path, capsys):
        """Un garde qui ne voit (presque) rien ne prouve rien : la mise en forme
        des workflows change, pas la règle — c'est la LECTURE qui casse."""
        fixture_workflow(tmp_path, COMMENTAIRES_SEULEMENT)

        assert garde.main(["--root", str(tmp_path)]) == 1

        sortie = capsys.readouterr().out
        assert "sous le plancher de 40" in sortie

    def test_sans_aucun_workflow_le_garde_refuse_de_conclure(self, garde, tmp_path, capsys):
        assert garde.main(["--root", str(tmp_path)]) == 1
        assert "aucun workflow lu" in capsys.readouterr().out

    def test_le_depot_reel_a_un_registre_lu_par_le_garde(self, garde):
        """Le registre vit à côté du garde : un chemin déplacé rendrait le garde
        incapable de juger, et il doit le DIRE (cf. charger_registre)."""
        assert garde.REGISTRE == REGISTRE
        assert REGISTRE.is_file()

    def test_le_garde_est_cable_dans_un_job_requis(self, garde):
        """Un garde que personne n'exécute ne garde rien : `workflow-lint` est un
        check REQUIS de la protection de branche (mesuré le 12/10/2026)."""
        workflow = CI.read_text(encoding="utf-8")

        # Appelé sans argument : il balaie `.github/workflows/` lui-même, donc un
        # workflow AJOUTÉ demain est couvert sans être inscrit ici.
        invocations = [
            ligne.strip() for ligne in workflow.splitlines()
            if INVOCATION in ligne and not ligne.strip().startswith("#")
        ]
        assert invocations == ["run: " + INVOCATION], invocations
        assert "      - name: Check no workflow step can fail silently (declared registry)\n" in workflow
