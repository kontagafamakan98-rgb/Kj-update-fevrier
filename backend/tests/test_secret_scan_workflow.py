# -*- coding: utf-8 -*-
"""Le scan de secrets est-il BRANCHÉ, BLOQUANT, et capable de dire « je n'ai rien vu » ?

Le dépôt pinçait déjà ses actions, appliquait une allowlist aux paiements et
exigeait `JWT_SECRET` en production : la surface des CLÉS n'était jugée par
personne. Une clé collée dans un script ne cassait aucun test, et une fois
fusionnée elle reste dans l'historique même après sa suppression du fichier.

Ce fichier verrouille les quatre propriétés qui rendent le gate utile, et
chacune des quatre a un échec SILENCIEUX correspondant :

1. CÂBLAGE — le job `secret-scan` de `ci.yml` porte exactement le nom déclaré
   dans `.github/scripts/gate-perimetre.json`. Un nom qui dérive ferait attendre
   la protection de `main` (et `livrer.py`) un check-run qui n'arrivera jamais —
   le même défaut que la protection et la livraison qui ne jugeaient pas la même
   liste (12/10/2026).
2. BLOCAGE — aucune forme qui ne peut pas échouer (`continue-on-error`,
   `|| true`, `set +e`) dans ce job : c'est la famille de F9, et
   `check-informative-steps.py` la refuse ailleurs pour la même raison.
3. PÉRIMÈTRE — la PR juge `base...HEAD`, jamais `--all`. Rejouer l'historique à
   chaque PR rendrait le gate rouge sur des faits qu'aucune PR ne peut corriger
   (21 constats de 2025-2026, tous jugés non-secrets le 20/10/2026), donc on
   l'apprendrait à être ignoré. La passe d'historique a son propre workflow.
4. MESURE — `rapport-secrets.py` sort en 1 sur un constat, en 2 quand il ne peut
   PAS conclure (rapport absent, JSON inattendu, plage comptant des commits dont
   le scanner n'en a lu aucun). Sans ce deuxième refus, une plage mal calculée
   scannerait zéro commit et paraîtrait propre : un vert qui n'a rien mesuré.

Ce que ce fichier ne prouve pas : que gitleaks reconnaît un secret d'un
fournisseur donné (ce sont ses règles, et `.gitleaks.toml` ne fait que les
compléter par des exceptions bornées), ni que la protection de branche RÉELLE
exige le nouveau check — cela ne se lit qu'avec un jeton admin, et c'est le
pré-vol de `livrer.py` qui le refuse tant que le réglage n'a pas suivi.
"""
import importlib.util
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"
HISTORIQUE = REPO_ROOT / ".github" / "workflows" / "secret-scan-history.yml"
CONFIG = REPO_ROOT / ".gitleaks.toml"
DECLARATION = REPO_ROOT / ".github" / "scripts" / "gate-perimetre.json"
RAPPORT = REPO_ROOT / ".github" / "scripts" / "rapport-secrets.py"
INSTALLATEUR = REPO_ROOT / ".github" / "scripts" / "install-gitleaks.sh"

NOM_DU_CHECK = "Secrets (gitleaks)"


def _lire(chemin):
    assert chemin.is_file(), f"fichier attendu absent : {chemin}"
    return chemin.read_text(encoding="utf-8")


def _bloc_du_job(texte, identifiant):
    """Le bloc d'un job de `ci.yml` (indentation de 2 espaces), sans le suivant.

    Lecture par indentation, comme les autres gardes du dépôt : PyYAML n'est pas
    une dépendance, et la question posée (« qu'y a-t-il DANS ce job ») n'en a
    pas besoin.
    """
    lignes = texte.splitlines()
    debut = None
    for index, ligne in enumerate(lignes):
        if re.fullmatch(r"  %s:\s*" % re.escape(identifiant), ligne):
            debut = index
            break
    if debut is None:
        raise AssertionError(f"job « {identifiant} » absent de ci.yml")
    fin = len(lignes)
    for index in range(debut + 1, len(lignes)):
        if re.fullmatch(r"  [A-Za-z0-9_-]+:\s*", lignes[index]):
            fin = index
            break
    return "\n".join(lignes[debut:fin])


@pytest.fixture(scope="module")
def ci():
    return _lire(CI)


@pytest.fixture(scope="module")
def job(ci):
    return _bloc_du_job(ci, "secret-scan")


@pytest.fixture(scope="module")
def config():
    return tomllib.loads(_lire(CONFIG))


@pytest.fixture(scope="module")
def declaration():
    return json.loads(_lire(DECLARATION))


class TestCablage:
    """Le job existe, sous le nom que les deux périmètres attendent."""

    def test_le_job_porte_le_nom_declare_dans_le_perimetre(self, job, declaration):
        assert f"name: {NOM_DU_CHECK}" in job, (
            "le nom du job doit être EXACTEMENT celui déclaré : un nom qui dérive "
            "fait attendre un check-run qui n'arrivera jamais"
        )
        declare = [c for c in declaration["checks"] if c["job"] == "secret-scan"]
        assert declare, "secret-scan doit être déclaré comme check du gate"
        assert declare[0]["nom"] == NOM_DU_CHECK

    def test_le_perimetre_complet_est_coherent_avec_ci_yml(self):
        """Le garde HORS LIGNE du périmètre doit passer sur la déclaration réelle.

        Il vérifie les deux sens : chaque check déclaré nomme un job de `ci.yml`,
        et chaque job de `ci.yml` est soit déclaré, soit exempté avec son motif.
        """
        spec = importlib.util.spec_from_file_location(
            "perimetre_gate", REPO_ROOT / ".github" / "scripts" / "perimetre_gate.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        perimetre, jobs, empechement = module.lire_perimetre()
        assert perimetre is not None, empechement
        assert module.auditer(perimetre, jobs) == []

    def test_le_job_bloque_la_pr(self, job):
        """Aucune forme qui ne peut pas échouer : elle rendrait le gate muet."""
        assert "continue-on-error" not in job, "une étape de ce job ne peut pas échouer"
        assert not re.search(r"\|\|\s*(true|:|exit 0)\b", job), "commande neutralisée"
        assert not re.search(r"\bset\s+\+e\b", job), "erreurs ignorées"

    def test_le_job_lit_l_historique_complet_du_depot(self, job):
        assert "fetch-depth: 0" in job, (
            "sans historique, `origin/<base>` ne peut pas être matérialisé : la "
            "plage de la PR serait vide, donc un vert qui n'a rien mesuré"
        )


class TestBlocage:
    """La PR juge SES commits — l'historique a sa propre passe."""

    def test_la_plage_de_pr_part_de_la_branche_de_base(self, job):
        assert '"origin/${BASE_REF:-}...HEAD"' in job, (
            "la plage doit être calculée contre la branche de base de la PR"
        )
        assert "git rev-list --count" in job, (
            "le nombre de commits attendus doit être MESURÉ, jamais supposé"
        )

    def test_la_plage_n_est_pas_l_historique_entier(self, job):
        """`--all` est un REPLI déclaré (première publication), pas le défaut.

        S'il devenait le mode principal, chaque PR rejouerait tout l'historique :
        lenteur inutile, et surtout rouge permanent sur des constats anciens
        qu'aucune PR ne peut corriger.
        """
        assert job.count('PLAGE="--all"') == 1, (
            "un seul repli `--all`, dans la branche « before est nul »"
        )
        repli = job.split('PLAGE="--all"')[0]
        assert "refs/heads/" in repli and "rev-list" in repli, (
            "le mode principal doit calculer une plage, pas scanner tout"
        )

    def test_le_verdict_sans_mesure_est_refuse(self, job):
        assert "--commits-attendus" in job, (
            "le rapporteur doit recevoir le nombre de commits attendus, sinon une "
            "plage vide passerait pour un dépôt propre"
        )


class TestConfiguration:
    """Les exceptions sont bornées, motivées, et ne désarment pas les règles."""

    def test_les_regles_par_defaut_sont_conservees(self, config):
        assert config.get("extend", {}).get("useDefault") is True, (
            "sans `useDefault`, le fichier REMPLACE le jeu de règles par le sien : "
            "une couverture réduite que rien ne dirait"
        )

    def test_chaque_exception_est_motivee(self, config):
        exceptions = config.get("allowlists") or []
        assert exceptions, "aucune exception déclarée : le fichier ne servirait à rien"
        for entree in exceptions:
            description = str(entree.get("description") or "")
            assert len(description) >= 40, (
                f"exception sans motif lisible (< 40 caractères) : {description!r}"
            )

    def test_chaque_exception_est_bornee(self, config):
        """Une exception sans chemin est une surface aveugle : elle éteint la règle.

        Le dépôt refuse ailleurs ce qu'un garde qui ne voit rien prétend prouver ;
        ici c'est la même règle, appliquée à la portée d'une exception.
        """
        for entree in config.get("allowlists") or []:
            assert entree.get("paths"), f"exception non bornée par un chemin : {entree}"
            assert entree.get("targetRules"), f"exception non bornée par une règle : {entree}"

    def test_aucun_chemin_qui_accepte_tout(self, config):
        inacceptables = {".*", "^.*$", "", ".", "^/", "^.*"}
        for entree in config.get("allowlists") or []:
            for motif in entree.get("paths") or []:
                assert motif not in inacceptables, (
                    f"un chemin qui accepte tout rend l'exception globale : {motif!r}"
                )


class TestRapport:
    """Le rapporteur rend un VERDICT, et refuse de conclure sans mesure."""

    def _lancer(self, tmp_path, rapport=None, journal=None, attendus=0):
        chemin_rapport = tmp_path / "rapport.json"
        if rapport is not None:
            chemin_rapport.write_text(rapport, encoding="utf-8")
        arguments = [sys.executable, str(RAPPORT), "--rapport", str(chemin_rapport)]
        if journal is not None:
            chemin_journal = tmp_path / "gitleaks.log"
            chemin_journal.write_text(journal, encoding="utf-8")
            arguments += ["--journal", str(chemin_journal)]
        arguments += ["--commits-attendus", str(attendus)]
        return subprocess.run(
            arguments,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={"PYTHONIOENCODING": "utf-8", "PATH": ""},
            cwd=str(REPO_ROOT),
        )

    def test_un_rapport_vide_est_vert(self, tmp_path):
        resultat = self._lancer(tmp_path, rapport="[]", journal="1 commits scanned.\n", attendus=1)
        assert resultat.returncode == 0, resultat.stdout + resultat.stderr
        assert "::error" not in resultat.stdout

    def test_un_constat_est_bloquant_et_annote(self, tmp_path):
        rapport = json.dumps(
            [
                {
                    "RuleID": "github-pat",
                    "Description": "Identifiant GitHub",
                    "File": "backend/kojo_secret_oublie.py",
                    "StartLine": 42,
                    "Secret": "ghp_valeurQuiNeDoitJamaisSortir0123456789",
                    "Commit": "0123456789abcdef",
                }
            ]
        )
        resultat = self._lancer(tmp_path, rapport=rapport, journal="1 commits scanned.\n", attendus=1)
        assert resultat.returncode == 1, resultat.stdout + resultat.stderr
        assert "::error" in resultat.stdout
        assert "file=backend/kojo_secret_oublie.py" in resultat.stdout, (
            "l'annotation doit nommer le fichier : c'est là qu'on corrige"
        )
        assert "line=42" in resultat.stdout
        assert "github-pat" in resultat.stdout
        assert "ghp_valeurQuiNeDoitJamaisSortir0123456789" not in resultat.stdout, (
            "la valeur d'un secret ne doit JAMAIS être publiée dans une annotation"
        )

    def test_un_rapport_absent_refuse_de_conclure(self, tmp_path):
        resultat = self._lancer(tmp_path, rapport=None)
        assert resultat.returncode == 2, resultat.stdout + resultat.stderr
        assert "sans verdict" in resultat.stdout

    @pytest.mark.parametrize("contenu", ["null", "{pas du json", '{"pas": "une liste"}'])
    def test_un_rapport_illisible_ou_de_forme_inattendue_refuse(self, tmp_path, contenu):
        resultat = self._lancer(tmp_path, rapport=contenu)
        assert resultat.returncode == 2, resultat.stdout + resultat.stderr

    def test_une_plage_non_parcourue_refuse_de_conclure(self, tmp_path):
        """Le cas silencieux : 12 commits à juger, 0 lus, 0 constat, tout paraît propre."""
        resultat = self._lancer(tmp_path, rapport="[]", journal="0 commits scanned.\n", attendus=12)
        assert resultat.returncode == 2, resultat.stdout + resultat.stderr
        assert "0" in resultat.stdout

    def test_un_journal_muet_refuse_de_conclure(self, tmp_path):
        resultat = self._lancer(tmp_path, rapport="[]", journal="gitleaks: rien\n", attendus=3)
        assert resultat.returncode == 2, resultat.stdout + resultat.stderr

    def test_un_journal_lisible_mais_zero_attendu_reste_vert(self, tmp_path):
        """Aucun commit à juger (PR déjà fusionnée) : rien à mesurer, et c'est dit."""
        resultat = self._lancer(tmp_path, rapport="[]", journal="0 commits scanned.\n", attendus=0)
        assert resultat.returncode == 0, resultat.stdout + resultat.stderr


class TestInstallation:
    """La version et l'empreinte sont des CONSTANTES, vérifiées avant exécution."""

    def test_le_script_epingle_une_version_et_son_empreinte(self):
        texte = _lire(INSTALLATEUR)
        assert re.search(r'GITLEAKS_VERSION="\d+\.\d+\.\d+"', texte), (
            "une version flottante (« latest ») rendrait le scan non reproductible"
        )
        assert re.search(r'GITLEAKS_SHA256="[0-9a-f]{64}"', texte), (
            "l'archive doit être comparée à l'empreinte publiée par sa release"
        )
        assert "sha256sum -c -" in texte, "l'empreinte doit être VÉRIFIÉE, pas seulement écrite"
        assert "set -eu" in texte, "un échec de vérification doit arrêter le script"

    def test_les_deux_workflows_passent_par_le_meme_installateur(self, job):
        assert ".github/scripts/install-gitleaks.sh" in job
        assert ".github/scripts/install-gitleaks.sh" in _lire(HISTORIQUE), (
            "deux installations divergeraient en silence : une seule source de version"
        )


class TestHistorique:
    """La passe unique existe, se rejoue à la demande, et ne se mêle pas au gate."""

    def test_le_workflow_est_un_dispatch_pas_un_cron(self):
        texte = _lire(HISTORIQUE)
        assert "workflow_dispatch:" in texte
        assert "schedule:" not in texte, (
            "rejouer chaque nuit sur un historique immuable produirait le même "
            "verdict : un rouge permanent s'apprend à être ignoré"
        )

    def test_la_passe_lit_TOUT_l_historique(self):
        texte = _lire(HISTORIQUE)
        assert '--log-opts="--all"' in texte
        assert "fetch-depth: 0" in texte
        assert "git rev-list --count --all" in texte, (
            "le nombre attendu doit être mesuré sur le même périmètre que le scan"
        )

    def test_la_passe_rend_elle_aussi_un_verdict(self):
        texte = _lire(HISTORIQUE)
        assert "continue-on-error" not in texte
        assert ".github/scripts/rapport-secrets.py" in texte
        assert "--commits-attendus" in texte
