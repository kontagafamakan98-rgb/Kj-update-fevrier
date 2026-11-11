# -*- coding: utf-8 -*-
"""UNE SONDE QUI N'A PAS MESURÉ SE REPREND — preuve de la reprise bornée.

Ce que ce fichier verrouille, et pourquoi il existe
---------------------------------------------------
Le 11/11/2026, six sondes planifiées sont passées au rouge dans la même heure
alors que `main` n'avait pas bougé depuis huit jours. Aucune n'avait rendu de
verdict : échec dans `actions/checkout` (403), aucun `::error` de sonde, et
tout run relancé mourait en `startup_failure` — y compris une sonde fetch qui
n'installe pas de navigateur. Relancées à la main après le rétablissement de
GitHub, les six rendaient 0.

`reprise_sondes.py` répare ce cas-là, et ce fichier vérifie les bornes qui
l'empêchent de devenir un masque :

1. la LISTE est LUE (même découverte que l'alerte) et la reprise ne se reprend
   pas elle-même ;
2. le DÉCLENCHEUR est un échec, jamais un `cancelled` (rien n'a été tenté) ni
   un `success` ;
3. le PLAFOND est de trois tentatives et d'un jour : au-delà, un rouge est un
   verdict et il doit le rester ;
4. le CÂBLAGE du workflow : `actions: write`, `contents: read`, aucune
   neutralisation, aucune référence d'action flottante.
"""

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
SCRIPT = RACINE / ".github" / "scripts" / "reprise_sondes.py"
ALERTE = RACINE / ".github" / "scripts" / "alerte_sondes.py"
WORKFLOW = RACINE / ".github" / "workflows" / "reprise-sondes.yml"

# Planchers de LECTURE : un fichier vidé ferait passer toutes les assertions.
PLANCHER_SCRIPT = 6000
PLANCHER_WORKFLOW = 1200


def _charger(nom: str, chemin: Path):
    if nom in sys.modules:
        return sys.modules[nom]
    specification = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(specification)
    sys.modules[nom] = module
    specification.loader.exec_module(module)
    return module


reprise = _charger("reprise_sondes", SCRIPT)

TEXTE_SCRIPT = SCRIPT.read_text(encoding="utf-8")
TEXTE_WORKFLOW = WORKFLOW.read_text(encoding="utf-8")


class _Faux:
    """Un client HTTP scripté : enregistre les appels, rend ce qu'on lui dit."""

    def __init__(self, reponses=None):
        self.appels = []
        self.reponses = list(reponses or [])

    def __call__(self, methode, chemin, corps=None, *, token):
        self.appels.append({"methode": methode, "chemin": chemin, "corps": corps})
        if not self.reponses:
            return 200, {}
        return self.reponses.pop(0)

    def ecritures(self):
        return [appel for appel in self.appels if appel["methode"] == "POST"]


def _run(conclusion="failure", tentative=1, cree_le=None):
    cree_le = cree_le or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "id": 42,
        "conclusion": conclusion,
        "tentative": tentative,
        "url": "https://github.com/o/r/actions/runs/42",
        "cree_le": cree_le,
    }


class TestLesFichiersLus:
    def test_le_script_et_le_workflow_sont_ceux_qu_on_croit_juger(self):
        assert len(TEXTE_SCRIPT) > PLANCHER_SCRIPT, "script tronqué : lecture suspecte"
        assert len(TEXTE_WORKFLOW) > PLANCHER_WORKFLOW, "workflow tronqué : lecture suspecte"
        assert "def main(" in TEXTE_SCRIPT
        assert "jobs:" in TEXTE_WORKFLOW

    def test_la_liste_des_sondes_n_est_pas_recopiee(self):
        """Aucune sonde nommée en dur : la liste est LUE, comme pour l'alerte."""
        for nom in ("cdn-lente-production-probe.yml", "seo-production-probe.yml", "backup-db.yml"):
            assert nom not in TEXTE_SCRIPT, f"« {nom} » est écrit en dur"


class TestDecouverteEtExclusionDeSoi:
    def _arbre(self, tmp_path: Path, fichiers: dict) -> Path:
        dossier = tmp_path / ".github" / "workflows"
        dossier.mkdir(parents=True)
        for nom, contenu in fichiers.items():
            (dossier / nom).write_text(contenu, encoding="utf-8")
        return tmp_path

    def test_la_reprise_ne_se_reprend_pas_elle_meme(self, tmp_path):
        """Sinon un rouge de reprise se relancerait toutes les 30 minutes."""
        racine = self._arbre(tmp_path, {
            "reprise-sondes.yml": (
                "name: Reprise\non:\n  schedule:\n    - cron: '*/30 * * * *'\n"
                "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - run: python .github/scripts/reprise_sondes.py\n"
            ),
            "sonde.yml": (
                "name: Sonde\non:\n  schedule:\n    - cron: '10 9 * * *'\n"
                "jobs:\n  a:\n    runs-on: ubuntu-latest\n"
            ),
        })

        fichiers = [sonde["fichier"] for sonde in reprise.sondes(racine)]

        assert fichiers == ["sonde.yml"]

    def test_un_workflow_non_planifie_n_est_pas_repris(self, tmp_path):
        racine = self._arbre(tmp_path, {
            "ci.yml": "name: CI\non:\n  pull_request:\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n",
        })

        assert reprise.sondes(racine) == []


class TestBornesDeLaReprise:
    def test_un_echec_frais_est_repris(self):
        oui, motif = reprise.a_reprendre(_run("failure", 1))
        assert oui is True
        assert "failure" in motif

    def test_un_run_qui_n_a_pas_demarre_est_repris(self):
        """Le cas du 11/11/2026 : `startup_failure`, zéro ligne exécutée."""
        oui, _ = reprise.a_reprendre(_run("startup_failure", 1))
        assert oui is True

    def test_un_succes_n_est_jamais_repris(self):
        oui, motif = reprise.a_reprendre(_run("success", 1))
        assert oui is False
        assert "rien à reprendre" in motif

    def test_un_run_annule_n_est_pas_un_echec(self):
        """Il n'a rien fait : le relancer à la place du planificateur est un choix humain."""
        assert reprise.a_reprendre(_run("cancelled", 1))[0] is False

    def test_trois_tentatives_font_un_verdict(self):
        oui, motif = reprise.a_reprendre(_run("failure", reprise.MAX_TENTATIVES))
        assert oui is False
        assert "verdict" in motif

    def test_un_run_de_plus_d_un_jour_est_hors_reprise(self):
        vieux = _run("failure", 1)
        vieux["cree_le"] = (
            datetime.now(timezone.utc) - timedelta(hours=reprise.FENETRE_HEURES + 1)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")

        oui, motif = reprise.a_reprendre(vieux)

        assert oui is False
        assert "hors reprise" in motif

    def test_aucun_run_n_est_pas_une_reprise(self):
        assert reprise.a_reprendre(None)[0] is False

    def test_la_reprise_relance_le_run_entier(self):
        http = _Faux([(202, {})])

        reprise.reprendre(_run(), token="t", depot="o/r", http=http)

        assert len(http.ecritures()) == 1
        assert http.ecritures()[0]["chemin"] == "/repos/o/r/actions/runs/42/rerun"


class TestProgramme:
    def test_sans_jeton_la_reprise_refuse_de_conclure(self, monkeypatch):
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")

        assert reprise.main(["--simulation"], http=_Faux()) == 2

    def test_une_simulation_ne_relance_rien(self, monkeypatch, tmp_path):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
        dossier = tmp_path / ".github" / "workflows"
        dossier.mkdir(parents=True)
        (dossier / "sonde.yml").write_text(
            "name: Sonde\non:\n  schedule:\n    - cron: '10 9 * * *'\n"
            "jobs:\n  a:\n    runs-on: ubuntu-latest\n",
            encoding="utf-8",
        )
        http = _Faux([(200, {"workflow_runs": [{
            "id": 42, "conclusion": "failure", "run_attempt": 1,
            "html_url": "u", "created_at": "2026-11-11T15:00:00Z",
        }]})])

        assert reprise.main(["--racine", str(tmp_path), "--simulation"], http=http) == 0
        assert http.ecritures() == [], "une simulation ne relance rien"

    def test_une_sonde_en_echec_est_relancee(self, monkeypatch, tmp_path):
        monkeypatch.setenv("GITHUB_TOKEN", "t")
        monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
        dossier = tmp_path / ".github" / "workflows"
        dossier.mkdir(parents=True)
        (dossier / "sonde.yml").write_text(
            "name: Sonde\non:\n  schedule:\n    - cron: '10 9 * * *'\n"
            "jobs:\n  a:\n    runs-on: ubuntu-latest\n",
            encoding="utf-8",
        )
        maintenant = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        http = _Faux([
            (200, {"workflow_runs": [{
                "id": 42, "conclusion": "failure", "run_attempt": 1,
                "html_url": "u", "created_at": maintenant,
            }]}),
            (202, {}),
        ])

        assert reprise.main(["--racine", str(tmp_path)], http=http) == 0
        assert [appel["chemin"] for appel in http.ecritures()] == [
            "/repos/o/r/actions/runs/42/rerun"
        ]


class TestCablageDuWorkflow:
    def test_le_workflow_est_planifie_et_dispatchable(self):
        assert "schedule:" in TEXTE_WORKFLOW
        assert "workflow_dispatch:" in TEXTE_WORKFLOW
        assert "cron: '*/30 * * * *'" in TEXTE_WORKFLOW

    def test_les_permissions_sont_le_minimum_necessaire(self):
        assert "actions: write" in TEXTE_WORKFLOW
        assert "contents: read" in TEXTE_WORKFLOW

    def test_la_sortie_du_script_est_le_verdict_du_run(self):
        assert "reprise_sondes.py" in TEXTE_WORKFLOW
        for neutralisation in ("|| true", "|| :", "|| exit 0", "continue-on-error", "set +e"):
            assert neutralisation not in TEXTE_WORKFLOW, (
                f"« {neutralisation} » rendrait la reprise incapable d'échouer"
            )

    def test_la_branche_reprise_est_la_branche_par_defaut(self):
        assert "github.event.repository.default_branch" in TEXTE_WORKFLOW

    def test_le_workflow_porte_ses_references_d_action_epinglees(self):
        specification = importlib.util.spec_from_file_location(
            "check_workflow_pins", RACINE / ".github" / "scripts" / "check-workflow-pins.py"
        )
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)

        erreurs, conformes = module.check_workflow(WORKFLOW)

        assert erreurs == []
        assert len(conformes) >= 2
