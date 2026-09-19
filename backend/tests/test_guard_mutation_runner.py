# -*- coding: utf-8 -*-
"""Le harnais générique de mutation (`.github/scripts/check-guard-mutations.py`)
sait-il ÉCHOUER, et sait-il RESTAURER ?

Un harnais qui muterait le dépôt sans se restaurer, ou qui déclarerait « prouvé »
une mutation qui n'a rien fait rougir, serait pire que pas de harnais : il
laisserait un faux vert ET un arbre modifié. Ces cas le mesurent donc sur ses
deux propriétés vitales :

  * les DÉCISIONS — mutation qui ne mord pas, rouge sans le motif attendu, ancre
    disparue ou ambiguë, preuve non exécutable : chacune doit être un ÉCHEC, et
    elles se testent sur des verdicts écrits d'avance (ces cas n'exécutent
    jamais la vraie suite : ils lancent de petites commandes Python jetables) ;
  * la RESTAURATION — après chaque mutation, la cible doit être identique à
    l'OCTET, y compris quand la preuve elle-même écrit dans le fichier muté.

Ce fichier exécute aussi le REGISTRE RÉEL du dépôt en mode `--list` : un
registre invalide doit faire échouer le harnais au moment où la CI l'appelle,
pas seulement dans les cas synthétiques ci-dessous.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNAIS = REPO_ROOT / ".github" / "scripts" / "check-guard-mutations.py"


@pytest.fixture(scope="module")
def harnais():
    spec = importlib.util.spec_from_file_location("check_guard_mutations", HARNAIS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _garde(chemin="garde.txt", role="garde", invoque="ci", preuve="preuve.py", runner="pytest"):
    return {
        "chemin": chemin,
        "role": role,
        "invoque_par": invoque,
        "preuve": preuve,
        "runner": runner,
    }


def _mutation(**surcharges):
    base = {
        "id": "cas",
        "garde": "garde.txt",
        "cible": "garde.txt",
        "trouve": "INTERDIT",
        "remplace": "AUTORISE",
        "runner": "python",
        "preuve": "preuve.py",
        "commande": [sys.executable, "-c", "import sys; sys.exit(1)"],
        "cwd": ".",
        "attend": ["BOOM"],
    }
    base.update(surcharges)
    return base


def _spec(gardes=None, mutations=None):
    return {"gardes": gardes or [_garde()], "mutations": mutations or [_mutation()]}


def _ecrire_spec(tmp_path, contenu):
    chemin = tmp_path / "guard-proofs.json"
    chemin.write_text(json.dumps(contenu), encoding="utf-8")
    return chemin


class TestValidationDuRegistre:
    def test_registre_absent(self, harnais, tmp_path):
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(tmp_path / "absent.json")

    def test_gardes_vide(self, harnais, tmp_path):
        chemin = _ecrire_spec(tmp_path, {"gardes": [], "mutations": [_mutation()]})
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(chemin)

    def test_mutation_visant_un_garde_non_declare(self, harnais, tmp_path):
        chemin = _ecrire_spec(tmp_path, _spec(mutations=[_mutation(garde="autre.txt", cible="autre.txt")]))
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(chemin)

    def test_mutation_qui_ne_vise_pas_le_garde_lui_meme(self, harnais, tmp_path):
        chemin = _ecrire_spec(tmp_path, _spec(mutations=[_mutation(cible="autre.txt")]))
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(chemin)

    def test_mutation_sans_effet(self, harnais, tmp_path):
        chemin = _ecrire_spec(tmp_path, _spec(mutations=[_mutation(remplace="INTERDIT")]))
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(chemin)

    def test_identifiants_dupliques(self, harnais, tmp_path):
        chemin = _ecrire_spec(tmp_path, _spec(mutations=[_mutation(), _mutation()]))
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(chemin)

    def test_champ_inconnu_dans_un_garde(self, harnais, tmp_path):
        garde = _garde()
        garde["statut"] = "prouve"
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(gardes=[garde])))

    def test_role_inconnu(self, harnais, tmp_path):
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(gardes=[_garde(role="verificateur")])))

    def test_garde_ni_mute_ni_exclu(self, harnais, tmp_path):
        # L'exhaustivité est une RÈGLE, pas un espoir : un garde ajouté sans
        # mutation et sans motif d'exclusion doit rendre le registre invalide,
        # sinon il resterait sans preuve d'échec sans que rien ne le signale.
        spec = _spec(gardes=[_garde(), _garde(chemin="autre.txt", preuve="p.py", runner="pytest")])
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, spec))

    def test_garde_mute_et_declare_hors_atteinte(self, harnais, tmp_path):
        # Les deux à la fois : soit il est prouvé par mutation, soit on déclare
        # ne pas pouvoir — l'un des deux ment, donc le registre est refusé.
        garde = _garde()
        garde["hors_mutation"] = "motif"
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(gardes=[garde])))

    def test_garde_exclu_avec_motif_est_accepte(self, harnais, tmp_path):
        # La voie d'exclusion reste OUVERTE et motivée : sans ce cas, la règle
        # ci-dessus pourrait être satisfaite en refusant tout.
        exclu = _garde(chemin="hors.txt", invoque="aucun", preuve=None, runner=None)
        exclu["hors_mutation"] = "aucune preuve ne peut rougir (mesuré)"
        spec = {"gardes": [_garde(), exclu], "mutations": [_mutation()]}
        assert harnais.charger_spec(_ecrire_spec(tmp_path, spec))["gardes"]

    def test_registre_valide_est_charge(self, harnais, tmp_path):
        registre = harnais.charger_spec(_ecrire_spec(tmp_path, _spec()))
        assert registre["gardes"][0]["chemin"] == "garde.txt"


class TestDecisions:
    """Chaque verdict attendu est écrit d'avance : aucun cas n'exécute la suite."""

    def test_mutation_qui_ne_mord_pas_est_un_echec(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if INTERDIT:\n    pass\n", encoding="utf-8")
        mutation = _mutation(commande=[sys.executable, "-c", "print('vert')"])
        ok, detail = harnais.executer(mutation, tmp_path)
        assert ok is False
        assert "VERTE" in detail, detail

    def test_rouge_sans_le_motif_attendu_est_un_echec(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if INTERDIT:\n    pass\n", encoding="utf-8")
        mutation = _mutation(
            commande=[sys.executable, "-c", "print('autre chose'); import sys; sys.exit(1)"]
        )
        ok, detail = harnais.executer(mutation, tmp_path)
        assert ok is False
        assert "n'a pas nommé" in detail, detail

    def test_rouge_nomme_est_prouve(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if INTERDIT:\n    pass\n", encoding="utf-8")
        mutation = _mutation(
            commande=[sys.executable, "-c", "print('BOOM: INTERDIT neutralise'); import sys; sys.exit(1)"]
        )
        ok, detail = harnais.executer(mutation, tmp_path)
        assert ok is True, detail
        assert "BOOM" in detail

    def test_ancre_disparue_est_un_echec(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if AUTORISE:\n    pass\n", encoding="utf-8")
        ok, detail = harnais.executer(_mutation(), tmp_path)
        assert ok is False
        assert "0 fois" in detail, detail

    def test_ancre_ambigue_est_un_echec(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if INTERDIT:\n    pass\nif INTERDIT:\n    pass\n", encoding="utf-8")
        ok, detail = harnais.executer(_mutation(), tmp_path)
        assert ok is False
        assert "2 fois" in detail, detail

    def test_preuve_non_executable_est_un_echec(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        cible.write_text("if INTERDIT:\n    pass\n", encoding="utf-8")
        mutation = _mutation(commande=["binaire-inexistant-kojo", "--prouve"])
        ok, detail = harnais.executer(mutation, tmp_path)
        assert ok is False
        assert "non exécutable" in detail, detail

    def test_cible_absente_est_un_echec(self, harnais, tmp_path):
        ok, detail = harnais.executer(_mutation(), tmp_path)
        assert ok is False
        assert "introuvable" in detail, detail


class TestRestauration:
    def test_la_cible_est_restauree_a_l_octet_apres_un_rouge(self, harnais, tmp_path):
        cible = tmp_path / "garde.txt"
        original = "if INTERDIT:\n    pass\n"
        cible.write_text(original, encoding="utf-8")
        mutation = _mutation(
            commande=[sys.executable, "-c", "print('x'); import sys; sys.exit(1)"]
        )
        harnais.executer(mutation, tmp_path)
        assert cible.read_text(encoding="utf-8") == original

    def test_la_preuve_peut_ecrire_dans_le_garde_sans_abimer_l_arbre(self, harnais, tmp_path):
        # Une preuve qui relance un formateur, un build ou un générateur peut
        # réécrire la cible : la restauration par octets doit gagner dans tous
        # les cas, sinon le harnais laisserait une mutation dans l'arbre.
        cible = tmp_path / "garde.txt"
        original = "if INTERDIT:\n    pass\n"
        cible.write_text(original, encoding="utf-8")
        mutation = _mutation(
            commande=[
                sys.executable,
                "-c",
                "open('garde.txt','w',encoding='utf-8').write('CORROMPU'); import sys; sys.exit(1)",
            ]
        )
        ok, detail = harnais.executer(mutation, tmp_path)
        assert ok is False  # le motif attendu n'est pas nommé
        assert cible.read_text(encoding="utf-8") == original, "la cible n'a pas été restaurée"

    def test_la_commande_de_preuve_utilise_l_interpreteur_courant(self, harnais):
        assert harnais.commande_de({"commande": ["{python}", "-m", "pytest"]})[0] == sys.executable


class TestRegistreReel:
    def test_le_registre_du_depot_est_valide(self, harnais):
        registre = harnais.charger_spec(REPO_ROOT / ".github" / "scripts" / "guard-proofs.json")
        assert len(registre["gardes"]) >= 20
        assert registre["mutations"]

    def test_liste_sans_muter(self, harnais, capsys):
        assert harnais.main(["--list"]) == 0
        sortie = capsys.readouterr().out
        assert "Registre valide" in sortie
        # `--list` est ce qu'un mainteneur lit avant de rejouer les mutations :
        # chaque mutation déclarée doit y être nommée avec sa preuve. C'est le
        # registre qui est relu ici (source unique), pas le libellé du message.
        registre = harnais.charger_spec()
        for mutation in registre["mutations"]:
            assert mutation["id"] in sortie, mutation["id"]
            assert mutation["preuve"] in sortie, mutation["preuve"]

    def test_only_inconnu_est_un_echec(self, harnais):
        assert harnais.main(["--only", "mutation-qui-n-existe-pas"]) == 1

    def test_runner_sans_mutation_est_un_echec(self, harnais, monkeypatch, tmp_path):
        # Un filtre de runner qui ne sélectionne RIEN doit échouer : sinon une
        # étape de CI pourrait ne plus rien prouver en restant verte.
        spec = _spec(mutations=[_mutation(runner="python")])
        spec["mutations"][0]["garde"] = "garde.txt"
        monkeypatch.setattr(harnais, "charger_spec", lambda chemin=None: spec)
        monkeypatch.setattr(harnais, "REPO_ROOT", tmp_path)
        assert harnais.main(["--runner", "node"]) == 1
