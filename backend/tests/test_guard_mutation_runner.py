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


def _etape(nom="runner-python", **surcharges):
    base = {"nom": nom, "runner": "python"}
    base.update(surcharges)
    return base


def _spec(gardes=None, mutations=None, rejeux=None):
    return {
        "gardes": gardes or [_garde()],
        "mutations": mutations or [_mutation()],
        "rejeux": rejeux if rejeux is not None else [_etape()],
    }


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
        spec = _spec(gardes=[_garde(), exclu])
        assert harnais.charger_spec(_ecrire_spec(tmp_path, spec))["gardes"]

    def test_registre_valide_est_charge(self, harnais, tmp_path):
        registre = harnais.charger_spec(_ecrire_spec(tmp_path, _spec()))
        assert registre["gardes"][0]["chemin"] == "garde.txt"

    def test_etape_de_rejeu_sans_runner_ni_portee(self, harnais, tmp_path):
        # Une étape qui ne dit pas ce qu'elle rejoue serait une étape dont on ne
        # peut rien dériver : refusée.
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(rejeux=[{"nom": "flou"}])))

    def test_etape_de_rejeu_visant_une_entree_inconnue(self, harnais, tmp_path):
        etape = _etape(nom="og", runner=None, porte_sur=["absent.txt"], pourquoi="motif")
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(rejeux=[etape])))

    def test_etape_de_rejeu_portant_sur_des_entrees_sans_motif(self, harnais, tmp_path):
        # C'est la seule déclaration non dérivée d'un runner : elle doit dire
        # pourquoi, sinon elle devient le fourre-tout du registre.
        etape = _etape(nom="og", runner=None, porte_sur=["garde.txt"])
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(rejeux=[etape])))

    def test_etape_de_rejeu_en_double(self, harnais, tmp_path):
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(rejeux=[_etape(), _etape()])))

    def test_runner_sans_etape_de_rejeu(self, harnais, tmp_path):
        # Un runner déclaré dont aucune étape ne dit qu'elle le rejoue : ses
        # mutations ne seraient rejouées nulle part.
        mutations = [_mutation(), _mutation(id="autre", runner="node")]
        with pytest.raises(harnais.SpecInvalide):
            harnais.charger_spec(_ecrire_spec(tmp_path, _spec(mutations=mutations)))


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


class TestFiltreParChangement:
    """La preuve Node est filtrée sur une PR : le filtre doit être SUR, et la
    preuve entière doit rester due sur `main` (cf. `test_guard_failure_proofs`).

    Un filtre qui sous-estime le changement ferait exactement ce que le harnais
existe pour empêcher : un garde qui cesse d'être prouvé sans que rien ne
rougisse. D'où deux règles mesurées ici : on rejoue dès que le GARDE ou la
PREUVE a bougé, et on rejoue TOUT quand c'est la table ou le harnais qui a
bougé — puisque c'est eux qui calculent la sélection.
    """

    def _mutations(self):
        return [
            _mutation(id="garde-A", garde="a.txt", cible="a.txt", preuve="preuve-a.py"),
            _mutation(id="garde-B", garde="b.txt", cible="b.txt", preuve="preuve-b.py"),
            _mutation(id="garde-C", garde="c.txt", cible="c.txt", preuve="preuve-c.py"),
        ]

    def test_le_garde_modifie_rejoue_sa_mutation(self, harnais):
        retenues, motif = harnais.mutations_concernees(self._mutations(), {"a.txt"})
        assert [m["id"] for m in retenues] == ["garde-A"], motif

    def test_la_preuve_modifiee_rejoue_sa_mutation(self, harnais):
        # Le garde n'a pas bougé, mais la preuve qui doit rougir, si : c'est la
        # moitié de ce que la mutation prouve.
        retenues, motif = harnais.mutations_concernees(self._mutations(), {"preuve-b.py"})
        assert [m["id"] for m in retenues] == ["garde-B"], motif

    def test_rien_de_touche_ne_rejoue_rien(self, harnais):
        retenues, _ = harnais.mutations_concernees(self._mutations(), {"frontend/src/App.jsx"})
        assert retenues == []

    def test_un_module_importe_par_le_garde_rejoue_sa_mutation(self, harnais):
        # Les gardes frontend ne sont pas des fichiers isolés : neuf d'entre eux
        # importent `site-meta.js`. Modifier ce module partagé peut changer ce
        # qu'ils refusent sans que le garde ni sa preuve n'ait bougé — un filtre
        # qui l'ignorerait serait optimiste sur un changement réel.
        mutation = _mutation(
            id="home-shell",
            garde="frontend/scripts/check-home-shell.js",
            cible="frontend/scripts/check-home-shell.js",
            preuve="frontend/scripts/__tests__/check-home-shell.test.js",
        )
        retenues, _ = harnais.mutations_concernees([mutation], {"frontend/scripts/site-meta.js"})
        assert [m["id"] for m in retenues] == ["home-shell"]
        # Et la preuve fait partie de ce qui compte, pas seulement le garde.
        assert "frontend/scripts/check-home-shell.js" in harnais.fichiers_impliques(mutation)
        assert "frontend/scripts/site-meta.js" in harnais.fichiers_impliques(mutation)

    def test_la_table_modifiee_rejoue_tout(self, harnais):
        # La sélection est CALCULÉE par la table : quand celle-ci bouge, la
        # sélection ne dit plus rien de fiable, donc on ne saute rien.
        retenues, motif = harnais.mutations_concernees(
            self._mutations(), {".github/scripts/guard-proofs.json"}
        )
        assert len(retenues) == 3, motif
        assert "table ou le harnais" in motif, motif

    def test_le_harnais_modifie_rejoue_tout(self, harnais):
        retenues, motif = harnais.mutations_concernees(
            self._mutations(), {".github/scripts/check-guard-mutations.py"}
        )
        assert len(retenues) == 3, motif

    def test_un_filtre_illisible_est_un_echec(self, harnais):
        # Un garde qui ne peut pas conclure échoue : une référence inexistante ne
        # doit jamais se traduire par « rien à rejouer ».
        with pytest.raises(harnais.SpecInvalide):
            harnais.fichiers_changes("ref-qui-n-existe-pas-kojo", REPO_ROOT)

    def test_main_sur_filtre_vide_le_dit_et_reussit(self, harnais, monkeypatch, capsys):
        # Une PR qui ne touche aucun garde ne paie rien — et le dit, plutôt que
        # de laisser croire que la preuve a tourné.
        monkeypatch.setattr(harnais, "charger_spec", lambda chemin=None: _spec())
        monkeypatch.setattr(harnais, "fichiers_changes", lambda depuis, racine=None: set())
        assert harnais.main(["--runner", "python", "--changed-from", "une-ref"]) == 0
        sortie = capsys.readouterr().out
        assert "rien à rejouer" in sortie, sortie
        assert "main" in sortie, sortie


class TestPorteeDesEtapes:
    """Le périmètre d'un rejeu n'est plus choisi par le job : il se DÉRIVE de la
    table. Ces cas mesurent les trois choses qui rendent la dérivation sûre —
    un fichier partagé du runner rejoue tout son runner, une citation en prose
    n'est pas une dépendance, et une base introuvable rejoue TOUT."""

    def test_une_base_nue_sans_environnement_rejoue_tout(self, harnais, monkeypatch):
        monkeypatch.delenv("KOJO_MUTATIONS_DEPUIS", raising=False)
        monkeypatch.delenv("KOJO_BRANCHE_DE_BASE", raising=False)
        base, motif = harnais._base_du_changement("auto")
        assert base is None, motif
        assert "ENTIÈRE" in motif, motif

    def test_une_reference_demandee_est_respectee(self, harnais):
        base, _ = harnais._base_du_changement("HEAD~1")
        assert base == "HEAD~1"

    def test_la_base_de_la_pr_est_recuperee_puis_servie(self, harnais, monkeypatch):
        monkeypatch.setenv("KOJO_MUTATIONS_DEPUIS", "abc123")
        monkeypatch.delenv("KOJO_BRANCHE_DE_BASE", raising=False)
        appels = []

        class Faux:
            returncode = 0

        def faux_run(commande, **options):
            appels.append(commande)
            return Faux()

        monkeypatch.setattr(harnais.subprocess, "run", faux_run)
        base, motif = harnais._base_du_changement("auto")
        assert base == "FETCH_HEAD", motif
        assert appels and appels[0][-1] == "abc123", appels

    def test_une_base_non_recuperable_rejoue_tout(self, harnais, monkeypatch):
        # Un clone superficiel n'a pas la base de la PR : si le SHA ET la branche
        # échouent, on rejoue ENTIER plutôt que de ne rien rejouer.
        monkeypatch.setenv("KOJO_MUTATIONS_DEPUIS", "abc123")
        monkeypatch.setenv("KOJO_BRANCHE_DE_BASE", "main")

        class Rate:
            returncode = 128

        monkeypatch.setattr(harnais.subprocess, "run", lambda *a, **k: Rate())
        base, motif = harnais._base_du_changement("auto")
        assert base is None
        assert "ENTIÈRE" in motif, motif

    def test_le_fichier_partage_du_runner_rejoue_toutes_ses_mutations(self, harnais):
        # `conftest.py` et `pytest.ini` pèsent sur TOUTE preuve pytest : les
        # ignorer ferait passer une preuve dont la collecte a changé.
        mutation = _mutation(preuve="backend/tests/conftest.py")
        impliques = harnais.fichiers_impliques(mutation, REPO_ROOT)
        assert "backend/tests/conftest.py" in impliques
        assert "backend/pytest.ini" in impliques

    def _arbre(self, tmp_path, texte):
        (tmp_path / "backend" / "tests").mkdir(parents=True, exist_ok=True)
        (tmp_path / "backend" / "pytest.ini").write_text("", encoding="utf-8")
        (tmp_path / "backend" / "tests" / "conftest.py").write_text("", encoding="utf-8")
        (tmp_path / "cite.py").write_text("x = 1\n", encoding="utf-8")
        (tmp_path / "garde.py").write_text(texte, encoding="utf-8")
        return tmp_path

    def test_un_chemin_cite_dans_une_expression_est_une_dependance(self, harnais, tmp_path):
        # C'est la façon dont un garde désigne le fichier qu'il audite ou
        # neutralise : la citer EST dire le lien.
        racine = self._arbre(tmp_path, 'CIBLE = "cite.py"\n')
        impliques = harnais.fichiers_impliques(
            {"chemin": "garde.py", "preuve": None, "runner": None}, racine
        )
        assert "cite.py" in impliques

    def test_une_citation_en_prose_n_est_pas_une_dependance(self, harnais, tmp_path):
        # Le harnais lui-même cite `site-meta.js` en prose : compter cette prose
        # relierait ses mutations à la moitié du dépôt (mesuré : 103 fichiers au
        # lieu de 15), donc à un filtre qui ne filtre plus.
        racine = self._arbre(tmp_path, '"""Un garde qui cite "cite.py" en prose."""\n')
        impliques = harnais.fichiers_impliques(
            {"chemin": "garde.py", "preuve": None, "runner": None}, racine
        )
        assert "cite.py" not in impliques, sorted(impliques)

    def test_le_verdict_d_une_etape_est_publie_dans_la_sortie(self, harnais, monkeypatch, tmp_path, capsys):
        # Le workflow ne choisit pas son filtre : il RELAIE ce verdict. S'il
        # n'était pas publié, la seule façon de décider serait de recopier la
        # règle dans le YAML.
        sortie = tmp_path / "github_output"
        monkeypatch.setenv("GITHUB_OUTPUT", str(sortie))
        monkeypatch.setattr(harnais, "fichiers_changes", lambda base, racine=None: set())
        assert harnais.verdict_d_etape(_spec(), "runner-python", "une-ref") == 0
        contenu = sortie.read_text(encoding="utf-8")
        assert "rejeu=non" in contenu, contenu
        assert "notice" in capsys.readouterr().out

    def test_un_changement_dans_le_perimetre_rend_le_rejeu_du(self, harnais, monkeypatch, tmp_path):
        sortie = tmp_path / "github_output"
        monkeypatch.setenv("GITHUB_OUTPUT", str(sortie))
        monkeypatch.setattr(harnais, "fichiers_changes", lambda base, racine=None: {"garde.txt"})
        harnais.verdict_d_etape(_spec(), "runner-python", "une-ref")
        assert "rejeu=oui" in sortie.read_text(encoding="utf-8")

    def test_la_table_modifiee_rejoue_aussi_les_etapes(self, harnais, monkeypatch, tmp_path):
        # La portée se CALCULE à partir de la table : quand celle-ci bouge, le
        # verdict ne dit plus rien de fiable, donc le rejeu est dû — pour les
        # étapes comme pour les mutations.
        sortie = tmp_path / "github_output"
        monkeypatch.setenv("GITHUB_OUTPUT", str(sortie))
        monkeypatch.setattr(
            harnais, "fichiers_changes",
            lambda base, racine=None: {".github/scripts/guard-proofs.json"},
        )
        harnais.verdict_d_etape(_spec(), "runner-python", "une-ref")
        contenu = sortie.read_text(encoding="utf-8")
        assert "rejeu=oui" in contenu, contenu
        assert "la table ou le harnais a changé" in contenu, contenu

    def test_une_etape_inconnue_est_un_echec(self, harnais):
        with pytest.raises(harnais.SpecInvalide):
            harnais.verdict_d_etape(_spec(), "etape-qui-n-existe-pas", "une-ref")


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
