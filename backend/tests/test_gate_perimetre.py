# -*- coding: utf-8 -*-
"""LES DEUX PÉRIMÈTRES DU GATE ATTENDENT-ILS LA MÊME LISTE ? — preuve du garde.

Ce que ce fichier verrouille, et pourquoi. Deux chemins appliquent le même gate :
la protection de `main` (ce qu'une fusion par l'interface GitHub doit attendre)
et la livraison automatique (`.github/scripts/livrer.py`). Le 12/10/2026, ils ne
jugeaient pas le même périmètre : la protection exigeait HUIT checks nommés
pendant que `ci.yml` en déclarait ONZE, et la livraison attendait, elle, TOUS les
check-runs — y compris les trois que la protection ignorait. Une fusion manuelle
pouvait donc passer avec la suite e2e rouge (15 rouges / 27 exécutions, dont un
cas réel) et avec des avis de sécurité de PRODUCTION non corrigés, quand le trajet
de livraison refusait ces mêmes runs.

Trois surfaces sont mesurées ici, chacune sur l'artefact réel :

1. LA RÈGLE (`.github/scripts/perimetre_gate.py`) — lecture de `ci.yml` (le nom
   d'un check-run est le `name:` du JOB, jamais celui d'une étape), refus d'un nom
   dérivé, d'un job ni déclaré ni exempté, d'une exemption périmée ou d'un motif
   qui ne dit rien, planchers de lecture, et comparaison en ligne de la protection
   RÉELLE (le désaccord dans les deux sens, et le `strict`).
2. LA DÉCLARATION DU DÉPÔT (`.github/scripts/gate-perimetre.json`) — elle est
   auditée contre le `ci.yml` RÉEL : un job renommé, ajouté ou retiré fait rougir
   ici, dans un job requis, avant que la protection n'attende un check-run que
   personne ne rapporte.
3. LE GARDE CLI (`.github/scripts/check-gate-perimetre.py`) — son verdict est
   mesuré par son INTERFACE (`main(argv)`), y compris le chemin en ligne avec une
   protection injectée, donc sans réseau et sans jeton.
4. LA LIVRAISON (`.github/scripts/livrer.py`) — le SECOND chemin qui applique le
   gate, et le chemin PAR DÉFAUT d'une PR verte : elle doit attendre EXACTEMENT
   la liste déclarée (un check-run rouge HORS périmètre ne bloque pas, un check du
   périmètre rouge bloque), refuser un périmètre déclaré vide au lieu de retomber
   sur « tous les check-runs », juger le périmètre en pré-vol avant de pousser,
   REFUSER un arbre de travail sale (elle publie des commits) avant le jeton et le
   réseau, et appeler ses étapes dans l'ordre — production comprise, APRÈS la
   fusion (lu par AST, pas par expression régulière sur la prose).
   Preuve du point d'entrée : `package.json` expose `livrer` vers ce script.

Deux asymétries assumées, écrites ici pour ne pas être relues comme des oublis :
la protection de branche RÉELLE ne se lit qu'avec un jeton admin du dépôt, donc
son verdict live est prouvé par injection (le chemin réseau, lui, est celui de
`lire_protection`, dont le refus nommé est verrouillé) ; et le fait que la
protection GitHub soit effectivement réglée sur ces dix checks est mesuré à la
livraison, par le pré-vol de `livrer.py`, pas par une suite de tests hors ligne.

Les mutations qui prouvent ces refus vivent dans `.github/scripts/guard-proofs.json`
et visent les fichiers RÉELS `.github/scripts/perimetre_gate.py` et
`.github/scripts/check-gate-perimetre.py` : neutraliser un de ces refus fait
rougir les tests nommés, ici même.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / ".github" / "scripts"
CHEMIN_REGLE = SCRIPTS / "perimetre_gate.py"
CHEMIN_GARDE = SCRIPTS / "check-gate-perimetre.py"
CHEMIN_LIVRAISON = SCRIPTS / "livrer.py"
PACKAGE = REPO_ROOT / "package.json"
DECLARATION = SCRIPTS / "gate-perimetre.json"
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _charger(nom: str, chemin: Path):
    """Charge un module par CHEMIN : le garde a un tiret dans son nom (donc aucun
    import Python possible), et la règle doit être lue telle qu'elle est livrée,
    jamais recopiée dans ce fichier de preuve."""
    spec = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def regle():
    return _charger("perimetre_gate_pour_preuve", CHEMIN_REGLE)


@pytest.fixture(scope="module")
def garde():
    return _charger("check_gate_perimetre_pour_preuve", CHEMIN_GARDE)


@pytest.fixture(scope="module")
def livraison():
    """`livrer.py` chargé comme module : l'importer ne lance aucune livraison
    (`main()` est sous `if __name__ == "__main__"`). C'est le SECOND chemin qui
    applique le gate, donc celui qui doit attendre EXACTEMENT la même liste."""
    return _charger("livrer_pour_preuve", CHEMIN_LIVRAISON)


@pytest.fixture
def base(regle):
    """La déclaration RÉELLE et les jobs RÉELS de `ci.yml` — la base verte à
    partir de laquelle chaque cas limite est une seule perturbation."""
    declaration, jobs, empechement = regle.lire_perimetre()
    assert empechement == "", f"la déclaration du dépôt n'est pas lisible : {empechement}"
    return declaration, jobs


def _copie(declaration) -> dict:
    return json.loads(json.dumps(declaration))


def _protection(declaration, strict=None, contextes=None) -> dict:
    """Une charge utile de protection CONFORME, dérivée de la déclaration : les
    cas limites sont des perturbations de celle-ci, pas des littéraux recopiés."""
    return {
        "required_status_checks": {
            "strict": declaration.get("strict") if strict is None else strict,
            "contexts": [c["nom"] for c in declaration["checks"]] if contextes is None else contextes,
        }
    }


def _mentionne(refus: list[str], extrait: str) -> bool:
    return any(extrait in ligne for ligne in refus)


class TestSurfaceLivree:
    """Ce que le dépôt porte VRAIMENT : la déclaration, les fichiers, le câblage."""

    def test_les_deux_surfaces_du_perimetre_existent(self):
        # Nommer les fichiers ici est aussi ce qui rattache cette preuve à ses
        # deux entrées du registre (`guard-proofs.json`) : perimetre_gate.py et
        # check-gate-perimetre.py.
        assert CHEMIN_REGLE.is_file(), "la règle partagée manque : perimetre_gate.py"
        assert CHEMIN_GARDE.is_file(), "le garde hors ligne manque : check-gate-perimetre.py"
        assert DECLARATION.is_file(), "la déclaration unique manque : gate-perimetre.json"

    def test_la_declaration_nomme_des_checks_et_des_exemptions_motivees(self, base):
        declaration, jobs = base
        assert declaration["checks"], "aucun check déclaré : le périmètre serait vide"
        assert isinstance(declaration["strict"], bool), "`strict` doit être déclaré, pas deviné"
        for entree in declaration["hors_gate"]:
            assert len(entree["motif"]) >= 40, (
                f"exemption « {entree['nom']} » : un job hors gate sans pourquoi"
            )
        # Et les jobs lus sont bien ceux du workflow, pas ceux d'un fichier voisin.
        assert len(jobs) >= 10, f"ci.yml lu comme ayant {len(jobs)} job(s) : lecteur douteux"

    def test_le_garde_est_execute_par_un_job_requis(self, base):
        declaration, _ = base
        texte = CI.read_text(encoding="utf-8")
        assert "python3 .github/scripts/check-gate-perimetre.py" in texte, (
            "le garde du périmètre n'est appelé par aucun workflow : il ne peut pas "
            "rougir là où ça compte"
        )
        jobs_requis = {entree["job"] for entree in declaration["checks"]}
        assert "workflow-lint" in jobs_requis, (
            "le garde tourne dans workflow-lint, qui doit être lui-même du périmètre — "
            "un garde hors gate protège les autres et pas lui-même"
        )


class TestLectureDeCiYml:
    def test_un_job_sans_name_est_rapporte_par_son_identifiant(self, regle):
        jobs = regle.lire_ci(
            "jobs:\n"
            "  sans-nom:\n"
            "    runs-on: ubuntu-latest\n"
            "  avec-nom:\n"
            "    name: Un job nommé\n"
        )
        assert jobs == [("sans-nom", "sans-nom"), ("avec-nom", "Un job nommé")]

    def test_le_name_d_une_etape_n_est_pas_le_nom_du_job(self, regle):
        """Le nom d'un check-run est celui du JOB. Prendre le `- name:` d'une
        étape ferait croire à un nom dérivé — et ferait refuser un dépôt sain."""
        jobs = regle.lire_ci(
            "jobs:\n"
            "  mon-job:\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n"
            "      - name: Une étape\n"
            "        run: echo bonjour\n"
        )
        assert jobs == [("mon-job", "mon-job")]

    def test_les_jobs_hors_de_la_cle_jobs_ne_sont_pas_lus(self, regle):
        jobs = regle.lire_ci("name: CI\non: push\n\njobs:\n  seul:\n    name: Seul\n")
        assert jobs == [("seul", "Seul")]


class TestNomDesChecks:
    def test_un_nom_derive_est_refuse(self, regle, base):
        """Le nom déclaré doit être celui que GitHub rapportera. Un nom dérivé
        ferait attendre la protection ET la livraison un check-run inexistant :
        elles attendraient indéfiniment un vert qui ne viendra jamais."""
        declaration, jobs = base
        casse = _copie(declaration)
        casse["checks"][0]["nom"] = "Un nom qui a dérivé"
        refus = regle.auditer(casse, jobs)
        assert _mentionne(refus, "ci.yml nomme ce job"), refus

    def test_un_job_qui_n_existe_plus_est_refuse(self, regle, base):
        declaration, jobs = base
        depart = declaration["checks"][0]["job"]
        refus = regle.auditer(declaration, [j for j in jobs if j[0] != depart])
        assert _mentionne(refus, "n'existe plus dans ci.yml"), refus

    def test_un_job_declare_deux_fois_est_refuse(self, regle, base):
        declaration, jobs = base
        double = _copie(declaration)
        double["checks"].append(json.loads(json.dumps(double["checks"][0])))
        refus = regle.auditer(double, jobs)
        assert _mentionne(refus, "déclaré deux fois"), refus

    def test_un_check_sans_job_ou_sans_nom_est_refuse(self, regle, base):
        declaration, jobs = base
        vide = _copie(declaration)
        vide["checks"].append({"job": "", "nom": ""})
        refus = regle.auditer(vide, jobs)
        assert _mentionne(refus, "job ou nom vide"), refus


class TestCouverture:
    def test_un_job_de_ci_yml_non_couvert_est_refuse(self, regle, base):
        """Tout job de `ci.yml` est déclaré, ou exempté AVEC son motif. Un job
        qui n'est ni l'un ni l'autre est un périmètre qui a oublié quelque
        chose — et c'est ainsi que les deux listes avaient divergé."""
        declaration, jobs = base
        refus = regle.auditer(declaration, jobs + [("job-nouveau", "Un job ajouté")])
        assert _mentionne(refus, "job-nouveau"), refus
        assert _mentionne(refus, "ni check déclaré, ni exempté"), refus

    def test_un_job_exempte_avec_son_motif_ne_fait_pas_rougir(self, regle, base):
        declaration, jobs = base
        assert regle.auditer(declaration, jobs) == [], "la base du dépôt doit être verte"

    def test_une_exemption_doit_dire_pourquoi(self, regle, base):
        declaration, jobs = base
        muette = _copie(declaration)
        muette["hors_gate"] = [{"job": "job-nouveau", "nom": "Un job ajouté", "motif": ""}]
        refus = regle.auditer(muette, jobs + [("job-nouveau", "Un job ajouté")])
        assert _mentionne(refus, "hors gate sans POURQUOI"), refus

    def test_un_motif_trop_court_est_refuse(self, regle, base):
        """Un motif de moins de 40 caractères ne dit rien : c'est un oubli qui a
        reçu un droit de passage, et il survivrait à sa cause."""
        declaration, jobs = base
        court = _copie(declaration)
        court["hors_gate"] = [{"job": "job-nouveau", "nom": "Un job ajouté", "motif": "pas un gate"}]
        refus = regle.auditer(court, jobs + [("job-nouveau", "Un job ajouté")])
        assert _mentionne(refus, "< 40"), refus

    def test_une_exemption_perimee_est_refusee(self, regle, base):
        declaration, jobs = base
        perimee = _copie(declaration)
        perimee["hors_gate"] = [
            {"job": "job-disparu", "nom": "Un job disparu",
             "motif": "Ce job a existé, puis a été retiré de ci.yml : une exemption qui "
                      "survit à sa cause justifie désormais autre chose."}
        ]
        refus = regle.auditer(perimee, jobs)
        assert _mentionne(refus, "exemption PÉRIMÉE"), refus

    def test_une_exemption_aussi_declaree_comme_check_est_refusee(self, regle, base):
        declaration, jobs = base
        double = _copie(declaration)
        premier = double["checks"][0]
        double["hors_gate"] = [
            {"job": premier["job"], "nom": premier["nom"],
             "motif": "Ce job est déclaré comme check ET exempté : une seule des deux "
                      "listes peut le porter, sinon laquelle fait foi n'est pas lisible."}
        ]
        refus = regle.auditer(double, jobs)
        assert _mentionne(refus, "est AUSSI déclaré comme check"), refus


class TestPlanchers:
    def test_un_strict_non_booleen_est_refuse(self, regle, base):
        declaration, jobs = base
        flou = _copie(declaration)
        flou["strict"] = "true"
        refus = regle.auditer(flou, jobs)
        assert _mentionne(refus, "doit être un booléen"), refus

    def test_des_listes_invalides_sont_refusees(self, regle, base):
        declaration, jobs = base
        refus = regle.auditer({"strict": True, "checks": "aucun", "hors_gate": []}, jobs)
        assert _mentionne(refus, "doivent être des listes"), refus

    def test_sous_le_plancher_de_checks_le_garde_refuse(self, regle, base):
        declaration, jobs = base
        ampute = _copie(declaration)
        ampute["checks"] = ampute["checks"][:3]
        refus = regle.auditer(ampute, jobs)
        assert _mentionne(refus, "plancher de lecture non atteint"), refus
        assert any("3 check(s) déclaré(s)" in ligne for ligne in refus), refus

    def test_sous_le_plancher_de_lecture_le_garde_refuse(self, regle, base):
        """Un lecteur de `ci.yml` cassé rendrait TOUS les refus muets (un job non
        vu n'est jamais un job non couvert) : sous le plancher, on refuse."""
        declaration, _ = base
        refus = regle.auditer(declaration, [])
        assert _mentionne(refus, "job(s) lu(s) dans ci.yml <"), refus


class TestChargement:
    def test_un_fichier_absent_est_un_refus_nomme(self, regle, tmp_path):
        declaration, empechement = regle.charger(tmp_path / "absent.json")
        assert declaration is None and "illisible" in empechement

    def test_un_json_invalide_est_un_refus_nomme(self, regle, tmp_path):
        (tmp_path / "casse.json").write_text("{ pas du json", encoding="utf-8")
        declaration, empechement = regle.charger(tmp_path / "casse.json")
        assert declaration is None and "JSON invalide" in empechement

    def test_un_tableau_n_est_pas_une_declaration(self, regle, tmp_path):
        (tmp_path / "liste.json").write_text("[1, 2]", encoding="utf-8")
        declaration, empechement = regle.charger(tmp_path / "liste.json")
        assert declaration is None and "objet JSON" in empechement

    def test_un_ci_yml_absent_est_un_refus_nomme(self, regle):
        declaration, jobs, empechement = regle.lire_perimetre(REPO_ROOT / "ci-absent.yml")
        assert declaration is not None and jobs == [] and "ci.yml illisible" in empechement

    def test_le_depot_du_remote_est_lu_ou_refuse(self, regle, tmp_path):
        """`depot_du_remote` sert au chemin en ligne : hors dépôt git il rend une
        chaîne vide (jamais un « propriétaire/nom » inventé), et dans ce dépôt il
        rend la forme `propriétaire/nom`, sans le suffixe `.git`."""
        assert regle.depot_du_remote(tmp_path) == ""
        depuis_le_depot = regle.depot_du_remote()
        assert depuis_le_depot == "" or (
            "/" in depuis_le_depot and not depuis_le_depot.endswith(".git")
        ), depuis_le_depot


class TestProtection:
    """La comparaison EN LIGNE : ce que GitHub exige, contre ce qui est déclaré."""

    def test_une_protection_conforme_est_acceptee(self, regle, base):
        declaration, _ = base
        assert regle.comparer_protection(_protection(declaration), declaration) == []

    def test_un_check_declare_absent_de_la_protection_est_refuse(self, regle, base):
        """C'est le défaut mesuré le 12/10/2026 : la protection exigeait huit
        checks quand la déclaration en portait onze. Un check déclaré et non
        exigé est un trou par lequel une fusion passe sous un rouge."""
        declaration, _ = base
        noms = [c["nom"] for c in declaration["checks"]]
        refus = regle.comparer_protection(_protection(declaration, contextes=noms[1:]), declaration)
        assert _mentionne(refus, "n'exige PAS"), refus

    def test_un_check_exige_hors_declaration_est_refuse(self, regle, base):
        declaration, _ = base
        noms = [c["nom"] for c in declaration["checks"]] + ["Check fantôme"]
        refus = regle.comparer_protection(_protection(declaration, contextes=noms), declaration)
        assert _mentionne(refus, "que le périmètre déclaré ne porte pas"), refus

    def test_un_strict_different_est_refuse(self, regle, base):
        declaration, _ = base
        refus = regle.comparer_protection(_protection(declaration, strict=not declaration["strict"]), declaration)
        assert _mentionne(refus, "strict:"), refus

    def test_une_protection_illisible_est_un_refus(self, regle, base):
        declaration, _ = base
        refus = regle.comparer_protection(None, declaration)
        assert _mentionne(refus, "illisible"), refus

    def test_les_noms_attendus_suivent_l_ordre_declare(self, regle, base):
        declaration, _ = base
        assert regle.noms_attendus(declaration) == [c["nom"] for c in declaration["checks"]]
        assert regle.noms_attendus({}) == []


class TestCLI:
    """Le verdict du garde, mesuré par son interface — `main(argv)` — et pas par
    ses fonctions internes.

    Les noms injectés le sont DANS le module du garde (c'est là qu'ils sont
    utilisés) : c'est la règle de patch du dépôt.
    """

    def test_le_garde_du_depot_est_vert(self, garde, capsys):
        assert garde.main([]) == 0
        sortie = capsys.readouterr().out
        assert "attendent les mêmes" in sortie, sortie

    def test_une_declaration_en_ecart_fait_refuser_le_garde(self, garde, base, monkeypatch, capsys):
        """Le verdict hors ligne, de bout en bout : une déclaration dont un nom a
        dérivé doit faire sortir le garde en 1 (et non en 0 avec un joli rapport)."""
        declaration, jobs = base
        casse = _copie(declaration)
        casse["checks"][0]["nom"] = "Un nom qui a dérivé"
        monkeypatch.setattr(garde, "lire_perimetre", lambda: (casse, jobs, ""))
        assert garde.main([]) == 1
        sortie = capsys.readouterr().out
        assert "Périmètre du gate non tenu" in sortie, sortie

    def test_une_declaration_illisible_fait_refuser_le_garde(self, garde, monkeypatch, capsys):
        monkeypatch.setattr(garde, "lire_perimetre", lambda: (None, [], "déclaration illisible (test)"))
        assert garde.main([]) == 1
        assert "illisible" in capsys.readouterr().out

    def test_en_ligne_sans_jeton_refuse_de_conclure(self, garde, monkeypatch, capsys):
        monkeypatch.delenv("GH_TOKEN", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        assert garde.main(["--en-ligne", "--depot", "exemple/depot"]) == 1
        sortie = capsys.readouterr().out
        assert "sans jeton" in sortie, sortie

    def test_en_ligne_avec_une_protection_conforme_est_vert(self, garde, base, monkeypatch, capsys):
        declaration, jobs = base
        monkeypatch.setattr(garde, "lire_perimetre", lambda: (declaration, jobs, ""))
        monkeypatch.setattr(garde, "lire_protection", lambda *a, **k: (_protection(declaration), ""))
        assert garde.main(["--en-ligne", "--jeton", "x", "--depot", "exemple/depot"]) == 0
        sortie = capsys.readouterr().out
        assert "attendent les mêmes" in sortie, sortie

    def test_en_ligne_avec_une_protection_derivee_est_refuse(self, garde, base, monkeypatch, capsys):
        declaration, jobs = base
        noms = [c["nom"] for c in declaration["checks"]]
        monkeypatch.setattr(garde, "lire_perimetre", lambda: (declaration, jobs, ""))
        monkeypatch.setattr(
            garde, "lire_protection",
            lambda *a, **k: (_protection(declaration, contextes=noms[1:]), ""),
        )
        assert garde.main(["--en-ligne", "--jeton", "x", "--depot", "exemple/depot"]) == 1
        sortie = capsys.readouterr().out
        assert "n'exige PAS" in sortie, sortie

    def test_en_ligne_sans_pouvoir_lire_la_protection_refuse(self, garde, base, monkeypatch, capsys):
        """Un jeton qui ne peut pas lire la protection (droits admin absents,
        réseau) laisse la moitié en ligne NON MESURÉE : le garde refuse, au lieu
        de publier un vert qui n'a rien vérifié."""
        declaration, jobs = base
        monkeypatch.setattr(garde, "lire_perimetre", lambda: (declaration, jobs, ""))
        monkeypatch.setattr(garde, "lire_protection", lambda *a, **k: (None, "HTTP 404 : Not Found"))
        assert garde.main(["--en-ligne", "--jeton", "x", "--depot", "exemple/depot"]) == 1
        sortie = capsys.readouterr().out
        assert "HTTP 404" in sortie and "droits admin" in sortie, sortie


HORS_PERIMETRE = "Bundle size report (PR comment)"


def _runs(declaration, hors_perimetre="failure"):
    """Les check-runs qu'un commit de tête rapporte RÉELLEMENT : ceux du périmètre
    déclaré, plus le rapport de taille (hors gate, cf. la déclaration)."""
    runs = [
        {"name": entree["nom"], "status": "completed", "conclusion": "success", "html_url": "u"}
        for entree in declaration["checks"]
    ]
    if hors_perimetre:
        runs.append(
            {"name": HORS_PERIMETRE, "status": "completed", "conclusion": hors_perimetre, "html_url": "u"}
        )
    return runs


class TestLivraison:
    """Le SECOND chemin du gate : la livraison automatique.

    C'est ici que le décalage des deux périmètres a été mesuré (`attendre_checks_ci`
    attendait TOUS les check-runs, pendant que la protection n'en exigeait que
    huit) : ces cas mesurent donc la livraison par ce qu'elle ATTEND, avec un faux
    `appel_github` — aucun réseau, aucune PR, aucune fusion.
    """

    def test_la_livraison_attend_la_liste_declaree_et_rien_d_autre(self, livraison, base, monkeypatch, capsys):
        """Un check-run ROUGE HORS périmètre ne bloque plus la livraison : c'est le
        rapport de taille, qui publie un commentaire et dont le budget réel est
        asserté dans `frontend-build` (requis). L'ancien « tous les check-runs »
        faisait refuser exactement là."""
        declaration, _ = base
        monkeypatch.setattr(livraison, "appel_github", lambda *a, **k: {"check_runs": _runs(declaration)})
        noms = [c["nom"] for c in declaration["checks"]]
        assert livraison.attendre_checks_ci("sha", "jeton", 1, noms) is True
        sortie = capsys.readouterr().out
        assert HORS_PERIMETRE in sortie, "le check hors périmètre doit être DIT ignoré, pas tu"
        assert "checks du périmètre déclaré sont au vert" in sortie, sortie

    def test_un_check_du_perimetre_rouge_bloque_la_livraison(self, livraison, base, monkeypatch, capsys):
        declaration, _ = base
        runs = _runs(declaration, hors_perimetre=None)
        runs[0]["conclusion"] = "failure"
        monkeypatch.setattr(livraison, "appel_github", lambda *a, **k: {"check_runs": runs})
        assert livraison.attendre_checks_ci("sha", "jeton", 1, [c["nom"] for c in declaration["checks"]]) is False
        assert runs[0]["name"] in capsys.readouterr().out

    def test_la_livraison_refuse_un_perimetre_vide(self, livraison, monkeypatch, capsys):
        """Sans liste déclarée, refuser vaut mieux que retomber sur « tous les
        check-runs » : c'est la déclaration qui serait cassée, et un vide n'est
        jamais un vert. La vérification passe AVANT tout appel à GitHub."""
        def interdit(*a, **k):
            raise AssertionError("aucun appel GitHub ne doit partir sur un périmètre vide")

        monkeypatch.setattr(livraison, "appel_github", interdit)
        assert livraison.attendre_checks_ci("sha", "jeton", 0, []) is False
        capture = capsys.readouterr()
        # Le refus est un `log_erreur` (stderr) : c'est le canal que la livraison
        # utilise pour tout ce qui ARRÊTE le trajet.
        assert "Périmètre de gate vide" in capture.err, capture.err

    def test_le_pre_vol_de_la_livraison_juge_la_declaration_du_depot(self, livraison, capsys):
        """Le pré-vol hors ligne, sur l'arbre RÉEL : la livraison refuse de partir
        si la déclaration et `ci.yml` ne disent plus la même chose."""
        assert livraison.verifier_perimetre_du_gate("jeton", en_ligne=False) == []
        assert "n'est PAS relue ici" in capsys.readouterr().out

    def test_le_pre_vol_refuse_une_declaration_en_ecart(self, livraison, base, monkeypatch):
        declaration, jobs = base
        casse = _copie(declaration)
        casse["checks"][0]["nom"] = "Un nom qui a dérivé"
        monkeypatch.setattr(livraison, "lire_perimetre", lambda: (casse, jobs, ""))
        refus = livraison.verifier_perimetre_du_gate("jeton", en_ligne=False)
        assert _mentionne(refus, "ci.yml nomme ce job"), refus

    def test_le_pre_vol_refuse_de_conclure_si_la_protection_est_illisible(self, livraison, base, monkeypatch):
        """La moitié EN LIGNE ne se mesure qu'avec la protection réelle : un jeton
        qui ne peut pas la lire laisse la livraison refuser, en nommant le remède
        (l'accord de l'ancien comportement — « on livrera quand même » — est
        exactement ce qui a laissé la PR #158 fusionner sous une suite rouge)."""
        declaration, jobs = base
        monkeypatch.setattr(livraison, "lire_perimetre", lambda: (declaration, jobs, ""))
        monkeypatch.setattr(livraison, "lire_protection", lambda *a, **k: (None, "HTTP 403 : Forbidden"))
        refus = livraison.verifier_perimetre_du_gate("jeton", en_ligne=True)
        assert _mentionne(refus, "droits admin"), refus


class TestCheminParDefaut:
    """`npm run livrer` est le chemin PAR DÉFAUT d'une PR verte — et reste tenu.

    Un point d'entrée qui se débranche, une étape retirée ou déplacée après la
    fusion ne rougiraient nulle part : la commande continuerait de rendre 0 en
    faisant moins. Ces cas tiennent le contrat du trajet, pas son code.
    """

    # L'ordre attendu, ÉCRIT ici pour être comparé au fichier jugé (le lire
    # depuis `livrer.py` ne prouverait rien). `verifier_arbre_propre` d'abord :
    # c'est le seul contrôle qui doit tomber AVANT le jeton et le réseau.
    ETAPES = [
        "verifier_arbre_propre",
        "obtenir_jeton",
        "verifier_prevol_local",
        "verifier_perimetre_du_gate",
        "pousser_branche",
        "trouver_ou_creer_pr",
        "attendre_checks_ci",
        "fusionner_pr",
        "synchroniser_et_nettoyer_local",
        "verifier_production_frontend",
        "verifier_seo_production_strict",
        "verifier_production_backend",
    ]

    def test_npm_run_livrer_lance_ce_script(self):
        scripts = json.loads(PACKAGE.read_text(encoding="utf-8")).get("scripts", {})
        assert scripts.get("livrer") == "python .github/scripts/livrer.py", scripts

    def test_les_etapes_sont_toutes_appelees_dans_l_ordre(self):
        appels = _appels_de_main()
        assert appels, "main() introuvable ou sans appel : le trajet n'est pas jugé"
        positions = []
        for nom in self.ETAPES:
            assert nom in appels, f"l'étape {nom} n'est plus appelée par main()"
            positions.append(appels.index(nom))
        assert positions == sorted(set(positions)), (
            "l'ordre du trajet a changé : "
            + ", ".join(f"{nom}@{i}" for nom, i in zip(self.ETAPES, positions))
        )
        # La production se confirme APRÈS la fusion : l'inverse ne vérifierait
        # qu'une intention.
        assert positions[-1] > positions[self.ETAPES.index("fusionner_pr")]

    def test_les_trois_confirmations_de_production_sont_dans_le_trajet(self):
        appels = _appels_de_main()
        for confirmation in (
            "verifier_production_frontend",
            "verifier_seo_production_strict",
            "verifier_production_backend",
        ):
            assert confirmation in appels, f"{confirmation} a disparu du trajet"


def _appels_de_main():
    """Les appels de `main()`, dans l'ordre du FICHIER (donc de l'exécution)."""
    arbre = ast.parse(CHEMIN_LIVRAISON.read_text(encoding="utf-8"))
    for noeud in arbre.body:
        if isinstance(noeud, ast.FunctionDef) and noeud.name == "main":
            appels = [
                (sous.lineno, sous.func.id)
                for sous in ast.walk(noeud)
                if isinstance(sous, ast.Call) and isinstance(sous.func, ast.Name)
            ]
            return [nom for _, nom in sorted(appels)]
    return []


class TestRevisionsDepuisOriginMain:
    """Les révisions ATTENDUES se lisent sur `origin/main`, jamais sur `HEAD`.

    L'étape de synchronisation locale est best-effort : `livrer.py` journalise son
    échec et continue. Lire les révisions attendues sur `HEAD` faisait donc
    dépendre le verdict d'un `main` local périmé — un `git pull --ff-only`
    refusé — et la vérification attendait le commit d'AVANT la fusion pendant que
    la production servait le nouveau : un faux refus (code 2) sur une livraison
    réussie. Ces cas figent la référence LUE, et le refus quand elle n'a pas pu
    être relue.
    """

    FUSION = "a" * 40
    DISTANTE = "b" * 40

    def _faux_outils(self, livraison, monkeypatch, ancestor: int = 0):
        """Faux `exec_cmd` et faux `subprocess.run`, qui NOTENT chaque commande."""
        appels = []

        def faux_exec(args, *a, **k):
            appels.append(list(args))
            if args[:3] == ["git", "rev-list", "-1"]:
                return self.DISTANTE
            return ""

        def faux_run(args, *a, **k):
            appels.append(list(args))
            if "merge-base" in args:
                return SimpleNamespace(returncode=ancestor)
            return SimpleNamespace(returncode=0)

        monkeypatch.setattr(livraison, "exec_cmd", faux_exec)
        monkeypatch.setattr(livraison, "subprocess", SimpleNamespace(run=faux_run))
        return appels

    def test_le_frontend_lit_le_dernier_commit_sur_origin_main(self, livraison, monkeypatch):
        appels = self._faux_outils(livraison, monkeypatch)
        assert livraison.verifier_production_frontend(self.FUSION, timeout_minutes=1) is True
        assert ["git", "fetch", "origin", "main"] in appels, "la base distante n'a pas été relue"
        assert any(
            a[:4] == ["git", "rev-list", "-1", livraison.REF_BASE_DISTANTE]
            and a[-1] == "frontend/"
            for a in appels
        ), appels
        assert not any("HEAD" in a for a in appels), "le main local a été consulté"
        controle = next(a for a in appels if a and a[0] == "node")
        assert controle[controle.index("--sinon") + 1] == self.DISTANTE, controle
        assert controle[controle.index("--attendu") + 1] == self.FUSION, controle

    def test_le_backend_lit_aussi_origin_main(self, livraison, monkeypatch):
        appels = self._faux_outils(livraison, monkeypatch)
        assert livraison.verifier_production_backend(self.FUSION, timeout_minutes=1) is True
        assert any(
            a[:4] == ["git", "rev-list", "-1", livraison.REF_BASE_DISTANTE]
            and ".github/workflows/ci.yml" in a
            for a in appels
        ), appels
        assert not any("HEAD" in a for a in appels), "le main local a été consulté"
        controle = next(
            a for a in appels if any("check_deployed_revision.py" in str(x) for x in a)
        )
        assert controle[controle.index("--attendu") + 1] == self.DISTANTE, controle

    def test_une_base_distante_qui_ne_porte_pas_la_fusion_refuse_de_conclure(
        self, livraison, monkeypatch, capsys
    ):
        appels = self._faux_outils(livraison, monkeypatch, ancestor=1)
        assert livraison.verifier_production_frontend(self.FUSION, timeout_minutes=1) is False
        # Le contrôle de production ne part PAS contre une référence non relue :
        # ce serait le même faux verdict, en silence.
        assert not any(a and a[0] == "node" for a in appels), appels
        sortie = capsys.readouterr().err
        assert "origin/main" in sortie and self.FUSION[:10] in sortie, sortie


class TestArbrePropre:
    """La livraison publie des COMMITS : un disque sale est REFUSÉ, pas ignoré.

    Sans ce refus, `npm run livrer` ouvrirait une PR verte qui ne contient pas le
    travail visible de l'auteur. Et le refus tombe AVANT le jeton et le réseau :
    c'est la différence entre un refus local immédiat et une livraison qui a déjà
    poussé avant de s'en apercevoir.
    """

    def test_un_arbre_sale_est_refuse_en_nommant_les_chemins(self, livraison, monkeypatch):
        monkeypatch.setattr(
            livraison, "exec_cmd", lambda *a, **k: " M backend/kojo_live.py\n?? notes.md"
        )
        with pytest.raises(RuntimeError) as refus:
            livraison.verifier_arbre_propre()
        message = str(refus.value)
        assert "NON PROPRE" in message, message
        assert "COMMITS" in message, message
        assert "backend/kojo_live.py" in message and "notes.md" in message, message

    def test_un_arbre_propre_passe(self, livraison, monkeypatch):
        monkeypatch.setattr(livraison, "exec_cmd", lambda *a, **k: "")
        assert livraison.verifier_arbre_propre() is None

    def test_le_refus_tombe_avant_le_jeton_et_le_reseau(self, livraison, monkeypatch, capsys):
        monkeypatch.setattr(livraison, "exec_cmd", lambda *a, **k: " M backend/a.py")

        def interdit(*a, **k):
            raise AssertionError("aucun jeton ni appel réseau ne doit partir sur un arbre sale")

        monkeypatch.setattr(livraison, "obtenir_jeton", interdit)
        monkeypatch.setattr(livraison, "appel_github", interdit)
        assert livraison.main(["--branche", "feat/exemple"]) == 1
        assert "NON PROPRE" in capsys.readouterr().err

    def test_un_arbre_sale_est_refuse_aussi_en_simulation(self, livraison, monkeypatch, capsys):
        # Le dry-run simule les EFFETS, pas les faits : un arbre sale reste un
        # arbre sale, et un « ça marcherait » qui l'ignore serait un faux vert.
        monkeypatch.setattr(livraison, "exec_cmd", lambda *a, **k: " M backend/a.py")
        monkeypatch.setattr(livraison, "obtenir_jeton", lambda *a, **k: "jeton-factice")
        assert livraison.main(["--branche", "feat/exemple", "--dry-run"]) == 1
        assert "NON PROPRE" in capsys.readouterr().err
