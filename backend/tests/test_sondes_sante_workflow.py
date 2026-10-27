# -*- coding: utf-8 -*-
"""UNE SONDE ROUGE DOIT DEVENIR UNE ALERTE — preuve du destinataire.

Ce que ce fichier verrouille, et pourquoi il existe
---------------------------------------------------
Le 27/10/2026, l'assistant support de production rendait 502 en une seconde,
cinq fois sur cinq. La sonde `ai-assistant-probe` était ROUGE depuis la veille —
et personne ne l'a appris, parce qu'un cron rouge n'est pas une alerte. Le dépôt
mesurait treize choses chaque matin et ne parlait à personne.

`.github/workflows/sondes-sante.yml` + `.github/scripts/alerte_sondes.py` sont le
destinataire. Ce qui est jugé ici, sur l'artefact réel :

1. LA LISTE est LUE, pas recopiée — une sonde déposée demain est surveillée
   sans toucher au script, l'alerte ne se surveille pas elle-même (sinon elle
   publierait chaque matin un « non jugée » et apprendrait à être ignorée) ;
2. LE VERDICT distingue quatre cas dont trois ne sont pas des rouges : un run
   annulé n'a rien mesuré, une sonde jamais exécutée ne protège rien, et un
   rouge est un rouge ;
3. L'ÉCRITURE n'a lieu que sur un ROUGE : même panne = même empreinte = aucune
   réécriture ; tout est vert et une issue est ouverte = elle est fermée en le
   disant ; tout est vert et rien n'est ouvert = AUCUNE écriture ;
4. LA PRÉMISSE (jeton absent, API illisible, moins de huit sondes lues, aucun run
   lu) sort en 2 — jamais un vert — et n'écrase pas une alerte réelle déjà
   ouverte ;
5. LE CÂBLAGE du workflow : permissions minimales (`issues: write`,
   `actions: read`, `contents: read`), aucune étape qui ne peut pas échouer, et
   la sortie du script qui EST le verdict du run.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
SCRIPT = RACINE / ".github" / "scripts" / "alerte_sondes.py"
WORKFLOW = RACINE / ".github" / "workflows" / "sondes-sante.yml"

# Planchers de LECTURE : sous ces tailles, le fichier lu n'est pas celui qu'on
# croit juger (fichier vidé, chemin déplacé) et toutes les assertions qui
# suivent seraient des preuves de rien.
PLANCHER_SCRIPT = 8000
PLANCHER_WORKFLOW = 1200


def _charger():
    """Importe le script (nom souligné, hors paquet) comme le font les gardes."""
    nom = "alerte_sondes"
    if nom in sys.modules:
        return sys.modules[nom]
    spec = importlib.util.spec_from_file_location(nom, SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


alerte = _charger()

TEXTE_WORKFLOW = WORKFLOW.read_text(encoding="utf-8")
TEXTE_SCRIPT = SCRIPT.read_text(encoding="utf-8")


class _Faux:
    """Un client HTTP scripté : enregistre les appels, rend ce qu'on lui dit."""

    def __init__(self, reponses=None):
        self.appels = []
        self.reponses = list(reponses or [])

    def __call__(self, methode, chemin, corps=None, *, token):
        self.appels.append({
            "methode": methode,
            "chemin": chemin,
            "corps": corps,
            "token": token,
        })
        if not self.reponses:
            return 200, {}
        return self.reponses.pop(0)

    def ecritures(self):
        return [appel for appel in self.appels if appel["methode"] in ("POST", "PATCH")]


def _ligne(fichier="ai-assistant-probe.yml", conclusion="failure", url=None):
    return {
        "fichier": fichier,
        "nom": "Sonde",
        "conclusion": conclusion,
        "statut": "completed",
        "url": url or f"https://github.com/o/r/actions/runs/{fichier}",
        "cree_le": "2026-10-26T14:31:00Z",
        "tete": "abc12345",
    }


def _verdict(echecs=(), vertes=(), non_jugees=(), jamais=()):
    return {
        "echecs": list(echecs),
        "vertes": list(vertes),
        "non_jugees": list(non_jugees),
        "jamais_executees": list(jamais),
    }


class TestLesFichiersLus:
    """Sans plancher de lecture, un fichier vide ferait passer tout le reste."""

    def test_le_script_et_le_workflow_sont_ceux_qu_on_croit_juger(self):
        assert len(TEXTE_SCRIPT) > PLANCHER_SCRIPT, "script tronqué : lecture suspecte"
        assert len(TEXTE_WORKFLOW) > PLANCHER_WORKFLOW, "workflow tronqué : lecture suspecte"
        assert "def main(" in TEXTE_SCRIPT
        assert "jobs:" in TEXTE_WORKFLOW

    def test_le_registre_des_sondes_n_est_pas_recopie(self):
        """Aucun nom de sonde n'est gravé dans le script : la liste est LUE."""
        for nom in ("ai-assistant-probe.yml", "seo-production-probe.yml", "backup-db.yml"):
            assert nom not in TEXTE_SCRIPT, (
                f"« {nom} » est écrit en dur : une sonde ajoutée demain ne serait "
                "pas surveillée, et une sonde retirée resterait attendue"
            )


class TestDecouverteDesSondes:
    def _arbre(self, tmp_path: Path, fichiers: dict) -> Path:
        dossier = tmp_path / ".github" / "workflows"
        dossier.mkdir(parents=True)
        for nom, contenu in fichiers.items():
            (dossier / nom).write_text(contenu, encoding="utf-8")
        return tmp_path

    def test_une_sonde_planifiee_est_decouverte_et_jamais_oubliee(self, tmp_path):
        racine = self._arbre(tmp_path, {
            "nouvelle-sonde.yml": (
                "name: Nouvelle sonde\non:\n  schedule:\n    - cron: '10 9 * * *'\n"
                "  workflow_dispatch:\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n"
                "    steps:\n      - run: echo ok\n"
            ),
        })

        trouvees = alerte.sondes(racine)

        assert [sonde["fichier"] for sonde in trouvees] == ["nouvelle-sonde.yml"]
        assert trouvees[0]["nom"] == "Nouvelle sonde"

    def test_un_workflow_non_planifie_n_est_pas_une_sonde(self, tmp_path):
        racine = self._arbre(tmp_path, {
            "ci.yml": "name: CI\non:\n  pull_request:\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n",
        })

        assert alerte.sondes(racine) == []

    def test_l_alerte_ne_se_surveille_pas_elle_meme(self, tmp_path):
        """Sinon elle publierait un « non jugée » chaque matin, tous les matins."""
        racine = self._arbre(tmp_path, {
            "sondes-sante.yml": (
                "name: Alerte\non:\n  schedule:\n    - cron: '50 7 * * *'\n"
                "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - run: python .github/scripts/alerte_sondes.py\n"
            ),
        })

        assert alerte.sondes(racine) == []


class TestVerdict:
    def test_quatre_cas_jamais_fondus(self):
        entrees = [
            {"fichier": "rouge.yml", "nom": "Rouge", "run": {
                "conclusion": "failure", "statut": "completed",
                "url": "u1", "cree_le": "", "tete": "a"}},
            {"fichier": "vert.yml", "nom": "Vert", "run": {
                "conclusion": "success", "statut": "completed",
                "url": "u2", "cree_le": "", "tete": "b"}},
            {"fichier": "annule.yml", "nom": "Annulé", "run": {
                "conclusion": "cancelled", "statut": "completed",
                "url": "u3", "cree_le": "", "tete": "c"}},
            {"fichier": "jamais.yml", "nom": "Jamais", "run": None},
        ]

        verdict = alerte.juger(entrees)

        assert [ligne["fichier"] for ligne in verdict["echecs"]] == ["rouge.yml"]
        assert [ligne["fichier"] for ligne in verdict["vertes"]] == ["vert.yml"]
        assert [ligne["fichier"] for ligne in verdict["non_jugees"]] == ["annule.yml"]
        assert [ligne["fichier"] for ligne in verdict["jamais_executees"]] == ["jamais.yml"]

    def test_un_run_annule_n_est_pas_un_rouge(self):
        """Un run annulé n'a rien mesuré : le compter comme rouge apprendrait à l'ignorer."""
        verdict = alerte.juger([{
            "fichier": "annule.yml", "nom": "Annulé",
            "run": {"conclusion": "cancelled", "statut": "completed", "url": "", "cree_le": "", "tete": ""},
        }])

        assert verdict["echecs"] == []
        assert len(verdict["non_jugees"]) == 1

    def test_l_empreinte_ne_bouge_pas_tant_que_la_panne_est_la_meme(self):
        premier = alerte.empreinte(_verdict(echecs=[_ligne()]))
        identique = alerte.empreinte(_verdict(echecs=[_ligne()]))
        autre_sonde = alerte.empreinte(_verdict(echecs=[_ligne(fichier="seo-production-probe.yml")]))

        assert premier == identique
        assert premier != autre_sonde


class TestEcritureSeulementSurUnRouge:
    def test_une_panne_ouvre_une_issue(self):
        http = _Faux([(200, []), (201, {"number": 7})])

        resultat = alerte.gerer_issue(
            _verdict(echecs=[_ligne()]), depot="o/r", branche="main", token="t", http=http
        )

        assert resultat == "ouverte"
        ecritures = http.ecritures()
        assert len(ecritures) == 1
        assert ecritures[0]["methode"] == "POST"
        assert ecritures[0]["chemin"].endswith("/issues")
        assert ecritures[0]["corps"]["title"] == alerte.TITRE
        assert alerte.MARQUEUR in ecritures[0]["corps"]["body"]

    def test_la_meme_panne_ne_reecrit_rien(self):
        corps = alerte.corps_issue(_verdict(echecs=[_ligne()]), depot="o/r", branche="main")
        http = _Faux([(200, [{"number": 7, "body": corps}])])

        resultat = alerte.gerer_issue(
            _verdict(echecs=[_ligne()]), depot="o/r", branche="main", token="t", http=http
        )

        assert resultat == "inchangee"
        assert http.ecritures() == [], "un fil qui se réécrit chaque matin devient du bruit"

    def test_une_autre_panne_met_a_jour_sans_ouvrir_de_second_fil(self):
        ancien = alerte.corps_issue(
            _verdict(echecs=[_ligne(fichier="seo-production-probe.yml")]), depot="o/r", branche="main"
        )
        http = _Faux([(200, [{"number": 7, "body": ancien}]), (200, {})])

        resultat = alerte.gerer_issue(
            _verdict(echecs=[_ligne()]), depot="o/r", branche="main", token="t", http=http
        )

        assert resultat == "mise a jour"
        assert [appel["methode"] for appel in http.ecritures()] == ["PATCH"]
        assert http.ecritures()[0]["chemin"].endswith("/issues/7")

    def test_tout_vert_ferme_l_issue_en_le_disant(self):
        http = _Faux([(200, [{"number": 7, "body": alerte.MARQUEUR}]), (200, {}), (200, {})])

        resultat = alerte.gerer_issue(
            _verdict(vertes=[_ligne(conclusion="success")]),
            depot="o/r", branche="main", token="t", http=http,
        )

        assert resultat == "fermee"
        methodes = [appel["methode"] for appel in http.ecritures()]
        assert methodes == ["POST", "PATCH"], "un rétablissement se dit, puis se referme"
        assert http.ecritures()[0]["chemin"].endswith("/comments")
        assert http.ecritures()[1]["corps"]["state"] == "closed"

    def test_tout_vert_sans_issue_n_ecrit_absolument_rien(self):
        http = _Faux([(200, [])])

        resultat = alerte.gerer_issue(
            _verdict(vertes=[_ligne(conclusion="success")]),
            depot="o/r", branche="main", token="t", http=http,
        )

        assert resultat == "rien"
        assert http.ecritures() == []


class TestPremisses:
    def test_sans_jeton_le_script_refuse_de_conclure(self, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")

        assert alerte.main(["--simulation"]) == 2

    def test_trop_peu_de_sondes_lues_est_une_premisse(self, monkeypatch, tmp_path):
        """Sous le plancher, c'est la LECTURE qui est cassée — pas « tout va bien »."""
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
        (tmp_path / ".github" / "workflows").mkdir(parents=True)

        assert alerte.main(["--racine", str(tmp_path), "--simulation"]) == 2

    def test_une_premisse_ouvre_une_issue_quand_aucune_alerte_n_existe(self):
        http = _Faux([(200, []), (201, {"number": 9})])

        resultat = alerte.gerer_issue(
            None, depot="o/r", branche="main", token="t", http=http,
            motif_premisse="GITHUB_TOKEN absent",
        )

        assert resultat == "ouverte"
        corps = http.ecritures()[0]["corps"]["body"]
        assert "ne peut pas conclure" in corps
        assert "GITHUB_TOKEN absent" in corps
        assert "pas un vert" in corps

    def test_une_premisse_n_ecrase_pas_une_alerte_reelle(self):
        """L'écraser effacerait le seul fait actionnable du fil."""
        http = _Faux([(200, [{"number": 7, "body": alerte.MARQUEUR}])])

        resultat = alerte.gerer_issue(
            None, depot="o/r", branche="main", token="t", http=http,
            motif_premisse="API illisible",
        )

        assert resultat == "inchangee"
        assert http.ecritures() == []


class TestCablageDuWorkflow:
    def test_le_workflow_est_planifie_et_dispatchable(self):
        assert "schedule:" in TEXTE_WORKFLOW
        assert "workflow_dispatch:" in TEXTE_WORKFLOW
        assert "cron:" in TEXTE_WORKFLOW

    def test_les_permissions_sont_le_minimum_necessaire(self):
        assert "issues: write" in TEXTE_WORKFLOW
        assert "actions: read" in TEXTE_WORKFLOW
        assert "contents: read" in TEXTE_WORKFLOW

    def test_la_sortie_du_script_est_le_verdict_du_run(self):
        """Aucune neutralisation : un 2 (prémisse) doit rougir le run."""
        assert "alerte_sondes.py" in TEXTE_WORKFLOW
        for neutralisation in ("|| true", "|| :", "|| exit 0", "continue-on-error", "set +e"):
            assert neutralisation not in TEXTE_WORKFLOW, (
                f"« {neutralisation} » rendrait l'alerte incapable d'échouer"
            )

    def test_le_script_recoit_le_jeton_et_le_depot(self):
        assert "GITHUB_TOKEN" in TEXTE_WORKFLOW
        assert "GITHUB_REPOSITORY" in TEXTE_WORKFLOW

    def test_la_branche_jugee_est_la_branche_par_defaut(self):
        """Une valeur gravée divergerait le jour d'un renommage de branche."""
        assert "github.event.repository.default_branch" in TEXTE_WORKFLOW

    def test_le_workflow_porte_ses_references_d_action_epinglees(self):
        """Aucune référence de branche : `check-workflow-pins.py` lit la même règle."""
        specification = importlib.util.spec_from_file_location(
            "check_workflow_pins",
            RACINE / ".github" / "scripts" / "check-workflow-pins.py",
        )
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)

        erreurs, conformes = module.check_workflow(WORKFLOW)

        assert erreurs == []
        assert len(conformes) >= 2, "le workflow doit au moins checkout et installer Python"
