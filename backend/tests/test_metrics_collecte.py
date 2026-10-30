# -*- coding: utf-8 -*-
"""Gardes de la sonde de COLLECTE des métriques (production).

Ce que ces tests protègent : la sonde doit REFUSER en nommant la cause — aucun
jeton côté CI, route fermée (503), jeton refusé (401), route perdue (404),
famille absente, exposition illisible, acquisition jamais démarrée ou tarie — et
ne jamais rendre un vert sur un chiffre qu'elle n'a pas lu. Ces états ont été
MESURÉS le 30/10/2026 : `/metrics` répondait 401 sur l'hôte du backend (jeton
posé sur la machine) et 404 sur l'origine du site, le dépôt n'ayant aucun secret
`METRICS_TOKEN`.

Le dernier cas relie la sonde au CONTRAT (`backend/METRIQUES.md`) et au
propriétaire des étiquettes (`kojo_job_alerts.ORIGINES_COMPTEES`) : deux
déclarations séparées ne peuvent pas diverger sans rougir ici.
"""
import importlib.util
import json
import time
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "scripts" / "check_metrics_collecte.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "metriques-collecte.yml"
CONTRAT = REPO_ROOT / "backend" / "METRIQUES.md"
DEPLOIEMENT = REPO_ROOT / "backend" / "DEPLOY_FLYIO.md"
JETON = "jeton-de-test"


def _charger_sonde():
    spec = importlib.util.spec_from_file_location("check_metrics_collecte", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SONDE = _charger_sonde()


def _reponse(statut=200, texte=""):
    doublure = MagicMock()
    doublure.status = statut
    doublure.read.return_value = texte.encode("utf-8")
    doublure.__enter__.return_value = doublure
    doublure.__exit__.return_value = False
    return doublure


def _iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def _exposition(
    plus_recente: float,
    origines=None,
    hors_vocabulaire: int = 0,
    familles_supprimees=(),
):
    """Une exposition de référence : le format texte 0.0.4 que sert le backend."""
    origines = (
        {"directe": 2, "inconnue": 0, "metier": 1, "ville": 3}
        if origines is None
        else origines
    )
    lignes = [
        "# HELP kojo_alertes_emploi Veilles emploi actives, par provenance declaree.",
        "# TYPE kojo_alertes_emploi gauge",
    ]
    if "provenance" not in familles_supprimees:
        for origine, valeur in origines.items():
            lignes.append('kojo_alertes_emploi{origine="%s"} %d' % (origine, valeur))
    if "hors_vocabulaire" not in familles_supprimees:
        lignes.append("# TYPE kojo_alertes_emploi_hors_vocabulaire gauge")
        lignes.append("kojo_alertes_emploi_hors_vocabulaire %d" % hors_vocabulaire)
    if "fraicheur" not in familles_supprimees:
        lignes.append("# TYPE kojo_alertes_emploi_plus_recente_timestamp_seconds gauge")
        lignes.append(
            "kojo_alertes_emploi_plus_recente_timestamp_seconds %s" % plus_recente
        )
    return "\n".join(lignes) + "\n"


def _lancer(corps=None, statut=200, erreur=None, **options):
    """Exécute la sonde avec une réponse HTTP doublée (ou une panne de transport)."""
    url = options.pop("url", "https://api.exemple.test/metrics")
    jeton = options.pop("jeton", JETON)
    maintenant = options.pop("maintenant", None)
    if erreur is not None:
        doublure = patch.object(
            SONDE.urllib.request, "urlopen", side_effect=urllib.error.URLError(erreur)
        )
    else:
        doublure = patch.object(
            SONDE.urllib.request, "urlopen", return_value=_reponse(statut, corps or "")
        )
    with doublure:
        return SONDE.verifier(url=url, jeton=jeton, maintenant=maintenant, **options)


class TestLaChaineDeCollecte:
    """Les quatre pannes de la route ont quatre remèdes : elles se nomment."""

    def test_le_jeton_absent_est_un_refus_pas_une_premisse(self, capsys):
        code = SONDE.verifier(url="https://api.exemple.test/metrics", jeton="")
        sortie = capsys.readouterr().out
        assert code == 1, "sans jeton, la sonde doit REFUSER : personne ne peut lire"
        assert "AUCUN COLLECTEUR" in sortie
        assert "METRICS_TOKEN" in sortie
        # Le remède est nommé, sinon le refus ne se corrige pas.
        assert "gh secret set" in sortie

    def test_un_jeton_refuse_est_nomme(self, capsys):
        code = _lancer(corps=json.dumps({"detail": "jeton invalide"}), statut=401)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "401" in sortie and "REFUSE" in sortie

    def test_une_route_fermee_nomme_le_secret_de_la_machine(self, capsys):
        code = _lancer(corps="metriques fermees", statut=503)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "503" in sortie and "fly secrets set" in sortie

    def test_une_route_perdue_nomme_le_bon_hote(self, capsys):
        # Mesuré le 30/10/2026 : l'origine du site répond 404 sur /metrics, la
        # route vivant sur l'hôte du backend. Un 404 se lit donc comme un
        # mauvais hôte (ou un rewrite perdu), jamais comme une absence de données.
        code = _lancer(corps="Not Found", statut=404)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "404" in sortie and "api.kojoforafrica.cc.cd" in sortie

    def test_un_transport_injoignable_est_une_premisse(self, capsys):
        code = _lancer(erreur="DNS introuvable")
        sortie = capsys.readouterr().out
        assert code == 2, "un réseau muet ne juge pas la collecte"
        assert "PREMISSE" in sortie

    def test_une_url_inutilisable_n_interroge_rien(self, capsys):
        code = SONDE.verifier(url="pas-une-url", jeton=JETON)
        assert code == 2
        assert "inutilisable" in capsys.readouterr().out


class TestLesFamillesDeVeilles:
    """Une série absente ne peut pas passer pour une provenance inexistante."""

    def test_une_provenance_absente_est_nommee(self, capsys):
        corps = _exposition(
            time.time() - 3600,
            origines={"directe": 2, "inconnue": 0, "ville": 3},  # `metier` manque
        )
        code = _lancer(corps=corps)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "metier" in sortie and "ABSENTE" in sortie

    def test_le_hors_vocabulaire_absent_est_nomme(self, capsys):
        code = _lancer(
            corps=_exposition(time.time() - 3600, familles_supprimees=("hors_vocabulaire",))
        )
        sortie = capsys.readouterr().out
        assert code == 1
        assert "kojo_alertes_emploi_hors_vocabulaire" in sortie

    def test_une_exposition_illisible_est_refusee(self, capsys):
        corps = "kojo_alertes_emploi{origine=\"ville\"} pas-un-nombre\n"
        code = _lancer(corps=corps)
        assert code == 1
        assert "ILLISIBLE" in capsys.readouterr().out


class TestLaFraicheurDeLAcquisition:
    """`0` veut dire JAMAIS : il ne passe pas pour une acquisition fraîche."""

    def test_une_acquisition_jamais_demarree_est_un_refus(self, capsys):
        code = _lancer(corps=_exposition(0))
        sortie = capsys.readouterr().out
        assert code == 1
        assert "JAMAIS" in sortie

    def test_une_acquisition_tarie_est_nommee_avec_son_age(self, capsys):
        maintenant = time.time()
        vieille = maintenant - 40 * 86400
        code = _lancer(corps=_exposition(vieille), maintenant=maintenant)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "TARIE" in sortie and "40.0 jour" in sortie

    def test_une_date_dans_le_futur_est_un_defaut(self, capsys):
        maintenant = time.time()
        code = _lancer(corps=_exposition(maintenant + 86400), maintenant=maintenant)
        sortie = capsys.readouterr().out
        assert code == 1
        assert "FUTUR" in sortie

    def test_une_acquisition_fraiche_rend_vert_et_publie_la_mesure(self, capsys):
        maintenant = time.time()
        code = _lancer(corps=_exposition(maintenant - 2 * 3600), maintenant=maintenant)
        sortie = capsys.readouterr().out
        assert code == 0
        assert "[OK] provenance" in sortie
        assert "[OK] fraicheur" in sortie
        assert "[VERDICT] conforme" in sortie


class TestLeCout:
    """Le coût se publie sur le vert comme sur le rouge (doctrine du dépôt)."""

    @pytest.mark.parametrize("statut,corps", [(200, None), (503, "ferme")])
    def test_le_cout_est_ecrit_dans_le_resume_du_job(self, tmp_path, monkeypatch, statut, corps):
        resume = tmp_path / "resume.md"
        monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(resume))
        corps_reponse = corps if corps is not None else _exposition(time.time() - 60)
        _lancer(corps=corps_reponse, statut=statut)

        contenu = resume.read_text(encoding="utf-8")
        assert "[COUT]" in contenu
        # Une requête, des octets, une durée : les trois chiffres du coût.
        assert "1 requete(s)" in contenu and "octet(s)" in contenu and " s, seuil" in contenu


class TestLeContratEtLeWorkflow:
    """La sonde, son workflow et le contrat public ne peuvent pas diverger."""

    def test_les_quatre_provenances_sont_celles_du_module_proprietaire(self):
        from kojo_job_alerts import ORIGINES_COMPTEES

        assert set(SONDE.PROVENANCES_ATTENDUES) == set(ORIGINES_COMPTEES), (
            "la sonde recopie les provenances : une provenance ajoutee au module "
            "proprietaire doit apparaitre ici, sinon elle serait publiee sans etre lue"
        )

    def test_l_exposition_reelle_du_backend_est_acceptee(self, capsys):
        # Le corps n'est PAS ecrit a la main : il vient du module qui sert la
        # route. Un changement de format cote backend rougit ici, avant la
        # production.
        import kojo_metrics

        maintenant = time.time()
        corps = kojo_metrics.rendre(
            {
                "missions_ouvertes": 3,
                "alertes_emploi": {
                    "par_origine": {"directe": 2, "inconnue": 0, "metier": 1, "ville": 3},
                    "hors_vocabulaire": 0,
                    "plus_recente": _iso(maintenant - 3600),
                },
            }
        )
        code = _lancer(corps=corps, maintenant=maintenant)
        sortie = capsys.readouterr().out
        assert code == 0, sortie
        assert "ville=3" in sortie

    def test_le_workflow_est_planifie_et_porte_le_jeton(self):
        texte = WORKFLOW.read_text(encoding="utf-8")
        assert "cron:" in texte, "sans planification, la collecte n'est pas lue"
        assert "secrets.METRICS_TOKEN" in texte
        assert "backend/scripts/check_metrics_collecte.py" in texte
        assert "permissions:" in texte and "contents: read" in texte

    def test_le_contrat_public_nomme_le_lecteur_et_le_secret(self):
        # Le defaut du 30/10/2026 etait aussi documentaire : DEPLOY_FLYIO.md
        # disait la collecte « optionnelle », donc rien ne disait qu'il fallait
        # un LECTEUR. Le contrat doit nommer les deux secrets.
        contrat = CONTRAT.read_text(encoding="utf-8")
        assert "check_metrics_collecte.py" in contrat
        assert "gh secret set METRICS_TOKEN" in contrat
        deploiement = DEPLOIEMENT.read_text(encoding="utf-8")
        assert "gh secret set METRICS_TOKEN" in deploiement
        assert "optionnel" not in deploiement.split("Métriques Prometheus")[1][:1200].lower(), (
            "la collecte n'est plus optionnelle : sans lecteur, les series ne sont lues par personne"
        )
