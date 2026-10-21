# -*- coding: utf-8 -*-
"""« Prêt à restaurer » ne se périme pas en silence.

`backend/SAUVEGARDES_ATLAS.md` est la seule preuve datée que ce dépôt sait
restaurer sa base. Une preuve qui n'est jamais rejouée ne décrit plus une
capacité mais une intention — et rien, avant
`.github/scripts/check-exercice-restauration.py`, ne le disait : le runbook
restait daté, donc vert à la lecture, indéfiniment.

Ce fichier prouve le garde sur trois plans, comme le veut la règle du dépôt :

  * la RÈGLE (fonction pure, horloge injectée) : un exercice récent est un vert
    MESURÉ (l'âge est publié), un exercice plus vieux que la cadence annoncée
    est refusé en nommant l'âge, le seuil et le remède, et le jour du seuil
    reste vert quand le lendemain refuse ;
  * les REPÈRES : un titre « non exécuté » (§3ter) n'est PAS une preuve, une
    date impossible ou absente est refusée, et un titre de prose n'est jamais
    pris pour un exercice — un repère deviné ferait rajeunir la preuve ;
  * le CÂBLAGE : l'étape de `workflow-lint` lance réellement le garde et ne
    peut pas échouer (`continue-on-error`, commande neutralisée), et la cadence
    appliquée par le garde est celle que le runbook ANNONCE — changer la prose
    sans changer le seuil rougit ici.
"""
import datetime as dt
import importlib.util
import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
GARDE = RACINE / ".github" / "scripts" / "check-exercice-restauration.py"
RUNBOOK = RACINE / "backend" / "SAUVEGARDES_ATLAS.md"
CI = RACINE / ".github" / "workflows" / "ci.yml"

# Cadences qu'un runbook peut annoncer, en jours. La table existe pour que le
# test LISE la cadence au lieu de la recopier : si le runbook passe au
# semestre, c'est cette table qui dit à quoi le seuil doit se comparer.
CADENCES = {"mois": 30, "trimestre": 90, "semestre": 182, "an": 365}


def _charger():
    spec = importlib.util.spec_from_file_location(
        "check_exercice_restauration", GARDE
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def garde():
    return _charger()


def _runbook(*titres):
    """Un runbook au-dessus du plancher de lecture, avec les titres voulus.

    Le remplissage ne contient ni date ni titre : si un cas passe, c'est que le
    garde a lu le titre qu'on lui a donné, pas un hasard du texte.
    """
    remplissage = "\n".join(
        "La procédure décrit la restauration et ce qu'elle ne prouve pas, "
        "sans chiffre ni repère de section." for _ in range(20)
    )
    return remplissage + "\n\n" + "\n\n".join(titres) + "\n"


class TestLaRegle:
    def test_le_runbook_reel_porte_un_exercice_date_et_lu(self, garde):
        """Le lecteur trouve le vrai repère du vrai fichier — pas un motif vide."""
        texte = RUNBOOK.read_text(encoding="utf-8")
        exercices, ecartes = garde.repartir(texte)
        dates = [quand for quand, _ in exercices]
        # Le runbook porte PLUSIEURS exercices datés au fil du temps — le
        # garde juge le plus RÉCENT. Exiger une liste d'un seul élément
        # interdirait de consigner le suivant, ce qui est le contraire du but.
        assert dt.date(2026, 10, 18) in dates, "le §3 daté du 18/10/2026 n'a pas été lu : %r" % (exercices,)
        assert dt.date(2026, 10, 21) in dates, "l'exercice du 21/10/2026 n'a pas été lu : %r" % (exercices,)
        assert dates == sorted(dates), "les repères datés doivent être chronologiques : %r" % (dates,)
        assert any("non exécuté" in raison for _, raison in ecartes), (
            "le §3ter (« préparé, non exécuté ») doit être ÉCARTÉ, pas compté : %r"
            % (ecartes,)
        )

    def test_un_exercice_recent_est_un_vert_mesure(self, garde):
        """Horloge posée au dernier exercice consigné : le garde juge le PLUS
        RÉCENT des repères, et publie son âge."""
        code, lignes = garde.juger(
            RUNBOOK.read_text(encoding="utf-8"), dt.date(2026, 10, 21)
        )
        assert code == 0, "\n".join(lignes)
        sortie = "\n".join(lignes)
        # Un vert muet serait un vert sans mesure : la date, l'âge et le seuil sont dits.
        assert "21/10/2026" in sortie and "0 jour(s)" in sortie, sortie
        assert "seuil 100" in sortie, sortie

    def test_un_exercice_plus_vieux_que_la_cadence_est_refuse(self, garde):
        texte = _runbook("## 3. Exercice exécuté — 01/01/2026")
        code, lignes = garde.juger(texte, dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "291 jour(s)" in sortie, sortie
        assert "seuil 100" in sortie, sortie
        assert "Rejouer l'exercice" in sortie, (
            "un refus sans remède laisse l'exploitant devant un mur : " + sortie
        )

    def test_le_jour_du_seuil_reste_vert_et_le_lendemain_refuse(self, garde):
        """La borne est MESURÉE, pas supposée : c'est elle qu'on croit en silence."""
        texte = _runbook("## 3. Exercice exécuté — 01/01/2026")
        assert garde.juger(texte, dt.date(2026, 4, 11))[0] == 0, (
            "le 100e jour est encore dans le seuil : refuser là serait crier trop tôt"
        )
        assert garde.juger(texte, dt.date(2026, 4, 12))[0] == 1, (
            "le 101e jour dépasse le seuil : le garde doit refuser"
        )

    def test_une_date_dans_le_futur_est_refusee(self, garde):
        texte = _runbook("## 3. Exercice exécuté — 01/01/2027")
        code, lignes = garde.juger(texte, dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "FUTUR" in sortie, sortie


class TestLesReperes:
    def test_un_exercice_prepare_mais_non_execute_ne_compte_pas(self, garde):
        texte = _runbook(
            "## 3bis. Exercice Atlas rejouable — préparé le 18/10/2026, **non exécuté**"
        )
        code, lignes = garde.juger(texte, dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "EXÉCUTÉ et DATÉ" in sortie, sortie
        assert "PRÉPARÉ" in sortie, sortie

    def test_une_date_impossible_est_refusee(self, garde):
        texte = _runbook("## 3. Exercice exécuté — 31/02/2026")
        code, lignes = garde.juger(texte, dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "date impossible" in sortie, sortie

    def test_un_titre_execute_sans_date_est_refuse(self, garde):
        texte = _runbook("## 3. Exercice exécuté — la semaine dernière")
        code, lignes = garde.juger(texte, dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "sans date" in sortie, sortie

    def test_un_titre_de_prose_n_est_pas_pris_pour_un_exercice(self, garde):
        """« Ce que l'exercice prouve » n'est pas un compte rendu daté."""
        texte = _runbook("### Ce que l'exercice prouve", "### Ce que l'exercice NE prouve PAS")
        exercices, ecartes = garde.repartir(texte)
        assert exercices == [], exercices
        assert ecartes == [], (
            "un titre de prose doit être IGNORÉ, pas écarté à chaque exécution : %r"
            % (ecartes,)
        )
        assert garde.juger(texte, dt.date(2026, 10, 19))[0] == 1

    def test_un_runbook_tronque_ne_conclut_pas(self, garde):
        code, lignes = garde.juger("## 3. Exercice exécuté — 18/10/2026\n", dt.date(2026, 10, 19))
        sortie = "\n".join(lignes)
        assert code == 1, sortie
        assert "TRONQUÉ" in sortie, sortie
        assert str(garde.PLANCHER_CARACTERES) in sortie, sortie


class TestLeCabliage:
    def test_la_commande_sort_en_1_sur_un_runbook_perime(self, garde, tmp_path):
        """Le CHEMIN réel (fichier, lecture, code de sortie), pas seulement la fonction."""
        perime = tmp_path / "SAUVEGARDES_ATLAS.md"
        perime.write_text(
            _runbook("## 3. Exercice exécuté — 01/01/2026"), encoding="utf-8", newline=""
        )
        assert garde.main(["--runbook", str(perime)]) == 1

        recent = tmp_path / "recent.md"
        recent.write_text(
            _runbook(
                "## 3. Exercice exécuté — %s"
                % (dt.date.today() - dt.timedelta(days=5)).strftime("%d/%m/%Y")
            ),
            encoding="utf-8",
            newline="",
        )
        assert garde.main(["--runbook", str(recent)]) == 0

    def test_un_runbook_absent_refuse_de_rendre_un_verdict(self, garde, tmp_path, capsys):
        assert garde.main(["--runbook", str(tmp_path / "absent.md")]) == 1
        sortie = capsys.readouterr().out
        assert "introuvable" in sortie, sortie

    def test_l_etape_de_ci_lance_le_garde_et_ne_peut_pas_echouer(self):
        texte = CI.read_text(encoding="utf-8")
        assert "check-exercice-restauration.py" in texte, (
            "le garde n'est lancé par aucun workflow : sa preuve serait décorative"
        )
        blocs = [
            bloc for bloc in texte.split("- name:")
            if "check-exercice-restauration.py" in bloc
        ]
        assert len(blocs) == 1, "le garde doit être lancé par UNE étape : %d" % len(blocs)
        bloc = blocs[0]
        assert "continue-on-error" not in bloc, (
            "une étape qui ne peut pas échouer ne surveille rien"
        )
        commande = [
            ligne.strip() for ligne in bloc.splitlines()
            if "check-exercice-restauration.py" in ligne
        ][0]
        assert "||" not in commande and "&&" not in commande, (
            "commande neutralisée : %r" % commande
        )

    def test_le_runbook_declare_la_cadence_que_le_garde_applique(self, garde):
        """La cadence se LIT dans la prose ; le seuil ne s'en écarte pas en silence."""
        texte = RUNBOOK.read_text(encoding="utf-8")
        trouvee = re.search(
            r"un exercice par\s+(mois|trimestre|semestre|an)\b", texte, re.IGNORECASE
        )
        assert trouvee, "le runbook n'annonce aucune cadence : le seuil n'a plus de source"
        annoncee = CADENCES[trouvee.group(1).lower()]
        assert garde.CADENCE_JOURS == annoncee, (
            "le runbook annonce %s (%d j), le garde applique %d j"
            % (trouvee.group(1), annoncee, garde.CADENCE_JOURS)
        )
        assert garde.SEUIL_JOURS == garde.CADENCE_JOURS + garde.GRACE_JOURS
        assert "check-exercice-restauration" in texte, (
            "le runbook doit citer le garde qui juge sa fraîcheur"
        )
