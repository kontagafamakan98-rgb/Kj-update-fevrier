# -*- coding: utf-8 -*-
"""Le journal rotatif n'écrit RIEN dans l'arbre du dépôt.

Ce qu'un chemin relatif avait coûté : `RotatingFileHandler('kojo_backend.log')`
se résout contre le répertoire courant, donc un backend lancé depuis `backend/`
déposait 10 Mo × 6 à côté du code, et chaque exécution de la suite en laissait un
de plus (constaté le 19/09/2026 : 3,5 Mo dans `backend/`, 178 Ko à la racine).
Rien ne relit ce fichier — `fly logs` lit la sortie standard.

Les propriétés mesurées ici, chacune sur la fonction RÉELLE du module :
  * le chemin par défaut est ABSOLU et hors du dépôt ;
  * il ne dépend PAS du répertoire courant (la cause du bug, et ce qui empêche
    sa réapparition) ;
  * sous pytest, l'écriture fichier est DÉSACTIVÉE — c'est le mode dans lequel
    tourne la CI ;
  * `KOJO_LOG_FILE` est honoré dans les deux sens : chemin explicite, ou
    désactivation par une valeur qui ne nomme aucun fichier ;
  * la suite réelle, telle qu'elle tourne, n'ajoute AUCUN `*.log*` au dépôt, et
    l'écriture fonctionne toujours quand on lui donne une destination.

Le module est chargé par son CHEMIN : c'est le fichier que le backend importe.
"""
import importlib.util
import logging
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SETTINGS = REPO_ROOT / "backend" / "kojo_settings.py"


@pytest.fixture(scope="module")
def settings():
    spec = importlib.util.spec_from_file_location("kojo_settings_journal", SETTINGS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fichiers_de_journal(racine=REPO_ROOT):
    """Tout `*.log*` de l'arbre, hors dépendances et hors `.git` — la mesure
    qui a révélé le problème."""
    ignores = {".git", ".venv", "node_modules", "__pycache__", ".mongo-tmp", "dist"}
    trouves = set()
    for chemin in racine.rglob("*"):
        if any(partie in ignores for partie in chemin.parts):
            continue
        if chemin.is_file() and ".log" in chemin.name:
            trouves.add(chemin.relative_to(racine).as_posix())
    return trouves


class TestChemin:
    def test_le_defaut_est_absolu_et_hors_du_depot(self, settings):
        chemin = settings.chemin_du_journal(environ={}, en_test=False)

        assert chemin is not None, "par défaut, le fichier doit rester activé en production"
        assert chemin.is_absolute(), chemin
        assert REPO_ROOT not in chemin.parents, (
            "le journal par défaut tombe dans l'arbre du dépôt : %s" % chemin
        )

    def test_le_chemin_ne_depend_pas_du_repertoire_courant(self, settings, monkeypatch):
        """C'est LA cause du bug : un chemin relatif se résout contre le cwd.
        Mesuré depuis les deux répertoires qui polluaient l'arbre."""
        monkeypatch.chdir(REPO_ROOT)
        depuis_racine = settings.chemin_du_journal(environ={}, en_test=False)
        monkeypatch.chdir(REPO_ROOT / "backend")
        depuis_backend = settings.chemin_du_journal(environ={}, en_test=False)

        assert depuis_racine == depuis_backend, (
            "le journal suit encore le répertoire courant : %s ≠ %s"
            % (depuis_racine, depuis_backend)
        )

    def test_sous_pytest_l_ecriture_fichier_est_desactivee(self, settings):
        assert settings.chemin_du_journal(environ={}, en_test=True) is None

    def test_le_module_charge_en_test_n_ouvre_aucun_fichier(self, settings):
        """Le cas réel : ce fichier de test tourne sous pytest, donc le module
        tel qu'il est chargé ne doit viser aucun fichier."""
        assert settings.JOURNAL_FILE is None, (
            "le module a résolu %s pendant la suite de tests" % settings.JOURNAL_FILE
        )
        assert "pytest" in sys.modules, "prémisse du cas : pytest est bien importé"

    @pytest.mark.parametrize("valeur", ["", "0", "off", "false", "none", "stdout", "STDOUT", " Off "])
    def test_une_valeur_sans_fichier_desactive_l_ecriture(self, settings, valeur):
        assert settings.chemin_du_journal(environ={"KOJO_LOG_FILE": valeur}, en_test=False) is None

    def test_un_chemin_explicite_est_honore(self, settings, tmp_path):
        vise = tmp_path / "ailleurs" / "kojo.log"
        chemin = settings.chemin_du_journal(
            environ={"KOJO_LOG_FILE": str(vise)}, en_test=False
        )

        assert chemin == vise.resolve()
        assert REPO_ROOT not in chemin.parents

    def test_un_chemin_explicite_vaut_aussi_en_test(self, settings, tmp_path):
        """Une valeur explicite est un choix, pas un défaut : quelqu'un qui
        débogue une suite veut pouvoir garder le fichier."""
        vise = tmp_path / "debug.log"
        chemin = settings.chemin_du_journal(
            environ={"KOJO_LOG_FILE": str(vise)}, en_test=True
        )

        assert chemin == vise.resolve()


class TestEcriture:
    def test_la_suite_reelle_n_ajoute_aucun_fichier_de_journal(self):
        """Mesure sur la suite qui tourne : journaliser ne doit RIEN créer dans
        l'arbre, ni maintenant ni au prochain `pytest`."""
        avant = _fichiers_de_journal()
        logging.getLogger("kojo_backend").warning("sonde de destination de journal")
        apres = _fichiers_de_journal()

        assert apres - avant == set(), (
            "des fichiers de journal sont apparus dans le dépôt : %s" % sorted(apres - avant)
        )

    def test_l_ecriture_fonctionne_encore_quand_elle_est_autorisee(self, settings, tmp_path):
        """Contre-épreuve : la désactivation ne doit pas avoir supprimé la
        fonction. On donne au module une destination temporaire et on vérifie
        qu'il y écrit vraiment."""
        vise = tmp_path / "kojo" / "kojo_backend.log"
        handlers = settings._handlers_de_journal(vise)
        try:
            assert len(handlers) == 2, "sortie standard + fichier attendus"
            journal = logging.getLogger("kojo_backend_ecriture_test")
            journal.handlers = handlers
            journal.setLevel(logging.INFO)
            journal.warning("écrit quelque part")
            for handler in handlers:
                handler.flush()
            assert vise.is_file(), "le fichier rotatif n'écrit plus rien"
            assert "écrit quelque part" in vise.read_text(encoding="utf-8")
        finally:
            for handler in handlers:
                handler.close()

    def test_une_destination_impossible_ne_casse_pas_le_demarrage(self, settings, tmp_path):
        """Un journal non inscriptible ne doit pas empêcher le backend de
        démarrer : on retombe sur la sortie standard."""
        blocage = tmp_path / "fichier"
        blocage.write_text("je suis un fichier, pas un dossier", encoding="utf-8")
        handlers = settings._handlers_de_journal(blocage / "kojo_backend.log")
        try:
            assert len(handlers) == 1, "seule la sortie standard doit rester"
        finally:
            for handler in handlers:
                handler.close()
