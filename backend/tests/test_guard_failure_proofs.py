# -*- coding: utf-8 -*-
"""Aucun garde du dépôt sans PREUVE D'ÉCHEC REJOYABLE.

Le motif F17 de CI-COVERAGE.md (« les refus du générateur n'étaient prouvés par
AUCUN test ») vaut pour les gardes eux-mêmes : un garde dont rien ne démontre
qu'il sait rougir peut devenir aveugle en silence, et la CI resterait verte. Ce
fichier tient cette propriété pour l'ENSEMBLE des gardes, et pas pour un lot.

Trois faits sont vérifiés, chacun sur la source RÉELLE :

1. EXHAUSTIVITÉ — TOUT script exécutable du dépôt (dans `frontend/scripts/`,
   `.github/scripts/`, `backend/scripts/`) est déclaré dans
   `.github/scripts/guard-proofs.json`, avec son rôle (`garde` ou `outil`). Un
   script ajouté demain sans preuve fait donc rougir ici, en le nommant — au
   lieu d'être invisible jusqu'à ce que quelqu'un pense à l'inventorier.

   Ce périmètre était déduit du NOM (`check-`, `audit_`) : un outil nommé
   `dmarc_policy.py`, `setup-seo-env.js` ou `lhci-cls-budgets.cjs` échappait
   donc à la règle et restait non classé par simple omission — la décision
   « est-ce un garde ? » se prenait en choisissant un nom de fichier, ce que
   personne ne relit. Le périmètre est maintenant le RÉPERTOIRE : tout est
   classé, et un outil se déclare comme tel avec son motif.
2. PREUVE REJOUABLE — un garde exécuté par la CI doit désigner une preuve qui
   EXISTE, que le runner du dépôt collecte (Vitest pour le frontend, pytest
   pour le backend) et qui NOMME le garde qu'elle prouve. Un pointeur vers un
   fichier inexistant, ou vers un test sans rapport, est refusé.
3. UN SEUL EXÉCUTANT PAR GARDE, ET RIEN DANS L'OMBRE — un garde sans aucun
   exécutant (ni workflow, ni test) n'est admis que déclaré comme tel, avec un
   motif, ET consigné dans les « angles morts assumés » de CI-COVERAGE.md §7 :
   l'échappatoire de ce fichier s'écrit quelque part, elle ne se contente pas
   d'exister.

Ce qui est mesuré ici et ce qui ne l'est pas : ce fichier vérifie que la preuve
existe, qu'elle vise le bon garde et qu'elle est collectée ; il ne vérifie pas
que la preuve MORD. C'est le rôle du harnais de mutation
(`.github/scripts/check-guard-mutations.py`), dont les mutations sont déclarées
dans le même registre — une mutation dont le littéral a disparu rougit ici
(test des ancres) pour ne pas devenir une preuve vide.
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = REPO_ROOT / ".github" / "scripts" / "guard-proofs.json"
HARNAIS = REPO_ROOT / ".github" / "scripts" / "check-guard-mutations.py"
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
COUVERTURE = REPO_ROOT / "CI-COVERAGE.md"

# Répertoires où vit un garde, et extensions admises. Le périmètre est le
# RÉPERTOIRE, pas le préfixe du nom : voir le point 1 du docstring.
DIRS_GARDES = ("frontend/scripts", ".github/scripts", "backend/scripts")
EXTENSIONS = (".js", ".cjs", ".mjs", ".py", ".sh")


def _charger_harnais():
    """Charge le harnais par chemin : ses RÈGLES de validation du registre
    appartiennent au harnais, ce fichier les exécute au lieu de les recopier."""
    spec = importlib.util.spec_from_file_location("check_guard_mutations", HARNAIS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def harnais():
    return _charger_harnais()


@pytest.fixture(scope="module")
def registre(harnais):
    """Le registre VALIDÉ POUR LE HARNAIS : si les deux divergent, c'est ici que
    ça se voit, pas au moment où la CI lance le harnais."""
    return harnais.charger_spec(SPEC)


def scripts_gardes():
    """Les scripts du dépôt — la surface à classer (rôle `garde` ou `outil`)."""
    trouves = set()
    for dossier in DIRS_GARDES:
        racine = REPO_ROOT / dossier
        if not racine.is_dir():
            continue
        for fichier in sorted(racine.iterdir()):
            if fichier.suffix not in EXTENSIONS or not fichier.is_file():
                continue
            trouves.add("%s/%s" % (dossier, fichier.name))
    return trouves


def texte_des_workflows():
    return "\n".join(
        f.read_text(encoding="utf-8") for f in sorted(WORKFLOWS.glob("*.yml"))
    )


def est_passe_par_un_workflow(chemin):
    """La CI exécute-t-elle ce script ? On cherche son NOM, indépendamment du
    préfixe de commande (`node scripts/x.js`, `bash .github/scripts/x.sh`)."""
    return Path(chemin).name in texte_des_workflows()


def _motif_du_garde(chemin):
    """Motif tolérant : le nom du garde, ses mots séparés par -, _ ou espace —
    « check-privacy-policy » reconnaît « check_privacy_policy » et
    « test_privacy_policy_guard » ne suffit pas (il faut les trois mots)."""
    stem = Path(chemin).stem
    return re.compile(r"[-_ ]*".join(re.escape(mot) for mot in re.split(r"[-_]", stem)))


class TestExhaustivite:
    def test_chaque_garde_ou_audit_du_depot_est_declare(self, registre):
        declares = {g["chemin"] for g in registre["gardes"]}
        manquants = sorted(scripts_gardes() - declares)
        assert manquants == [], (
            "garde(s) du dépôt absent(s) du registre de preuves : %s — déclarer "
            "chacun (role, invoque_par, preuve) dans .github/scripts/guard-proofs.json"
            % manquants
        )

    def test_aucun_garde_declare_absent_du_depot(self, registre):
        fantomes = sorted(g["chemin"] for g in registre["gardes"]
                          if not (REPO_ROOT / g["chemin"]).is_file())
        assert fantomes == [], "le registre déclare des fichiers qui n'existent pas : %s" % fantomes

    def test_le_perimetre_du_garde_est_non_vide(self):
        # Un périmètre cassé (mauvaise racine, préfixe renommé) rendrait tous les
        # tests ci-dessus verts en ne vérifiant RIEN : c'est la règle du dépôt.
        trouves = scripts_gardes()
        assert len(trouves) >= 20, "périmètre suspicieusement petit : %s" % sorted(trouves)
        for dossier in DIRS_GARDES:
            assert any(c.startswith(dossier) for c in trouves), (
                "aucun garde trouvé dans %s — le périmètre du test est cassé" % dossier
            )


class TestPreuveRejouable:
    def test_un_garde_passe_par_la_ci_a_une_preuve_qui_existe(self, registre):
        manques = []
        for garde in registre["gardes"]:
            if garde["role"] != "garde" or not est_passe_par_un_workflow(garde["chemin"]):
                continue
            if not garde.get("preuve"):
                manques.append("%s : aucune preuve déclarée" % garde["chemin"])
                continue
            if not (REPO_ROOT / garde["preuve"]).is_file():
                manques.append("%s → %s : preuve INTROUVABLE" % (garde["chemin"], garde["preuve"]))
        assert manques == [], (
            "garde(s) de la CI sans preuve d'échec rejouable :\n  " + "\n  ".join(manques)
        )

    def test_la_preuve_est_collectee_par_le_runner_declare(self, registre):
        fautes = []
        for garde in registre["gardes"]:
            preuve = garde.get("preuve")
            if not preuve:
                continue
            chemin = REPO_ROOT / preuve
            if not chemin.is_file():
                continue
            if garde["runner"] == "vitest":
                if "__tests__" not in chemin.parts or not re.search(
                    r"\.test\.jsx?$", chemin.name
                ):
                    fautes.append("%s : %s n'est pas collecté par Vitest" % (garde["chemin"], preuve))
            elif garde["runner"] == "pytest":
                if chemin.parent != REPO_ROOT / "backend" / "tests" or not chemin.name.startswith("test_"):
                    fautes.append("%s : %s n'est pas collecté par pytest" % (garde["chemin"], preuve))
            else:
                fautes.append("%s : runner inconnu %r" % (garde["chemin"], garde["runner"]))
        assert fautes == [], "\n  ".join(fautes)

    def test_la_preuve_nomme_le_garde_qu_elle_prouve(self, registre):
        # Sans ce lien, une preuve peut pointer vers le test d'un AUTRE garde et
        # le registre deviendrait une liste d'espoirs.
        fautes = []
        for garde in registre["gardes"]:
            preuve = garde.get("preuve")
            if not preuve:
                continue
            chemin = REPO_ROOT / preuve
            if not chemin.is_file():
                continue
            if _motif_du_garde(garde["chemin"]).search(chemin.read_text(encoding="utf-8")):
                continue
            fautes.append("%s → %s ne nomme jamais le garde" % (garde["chemin"], preuve))
        assert fautes == [], "\n  ".join(fautes)


class TestUnSeulExecutant:
    def test_un_garde_invoque_par_la_ci_le_dit(self, registre):
        fautes = [
            g["chemin"] for g in registre["gardes"]
            if g["invoque_par"] == "ci" and not est_passe_par_un_workflow(g["chemin"])
        ]
        assert fautes == [], (
            "déclarés « invoqué par la CI » alors qu'aucun workflow ne les appelle : %s" % fautes
        )

    # NOTE (20/09/2026) : `test_un_garde_sans_executant_est_declare_et_documente`
    # a été RETIRÉ, comme il le demandait lui-même (« s'il n'y a plus aucun garde
    # sans exécutant, le retirer plutôt que le laisser passer à vide »).
    # `audit_tdz.cjs` — le dernier — a reçu un exécutant (son test), et
    # `check-og-reproducible.js` n'est pas un garde mais un outil. L'échappatoire
    # qu'il vérifiait n'existe plus ; le test suivant couvre le cas restant.

    def test_un_outil_dit_pourquoi_ce_n_est_pas_un_garde(self, registre):
        fautes = [
            g["chemin"] for g in registre["gardes"]
            if g["role"] == "outil" and not g.get("motif")
        ]
        assert fautes == [], (
            "outil(s) sans motif : déclasser un garde en outil doit s'expliquer, "
            "sinon c'est l'échappatoire qui fait taire ce fichier : %s" % fautes
        )


class TestMutations:
    def test_le_registre_est_valide_pour_le_harnais(self, registre):
        # charger_spec lève sur un registre incohérent : le fixture a déjà validé.
        assert registre["mutations"], "aucune mutation déclarée : la preuve profonde serait vide"

    def test_chaque_mutation_vise_encore_quelque_chose(self, registre):
        """L'ancre d'une mutation doit EXISTER, une seule fois. Un refactor du
        garde ne doit pas transformer sa mutation en preuve vide — le harnais le
        dirait au moment de tourner, ce test le dit avant."""
        fautes = []
        for mutation in registre["mutations"]:
            cible = REPO_ROOT / mutation["cible"]
            if not cible.is_file():
                fautes.append("%s : cible introuvable %s" % (mutation["id"], mutation["cible"]))
                continue
            occurrences = cible.read_text(encoding="utf-8").count(mutation["trouve"])
            if occurrences != 1:
                fautes.append(
                    "%s : le littéral à neutraliser apparaît %d fois (attendu 1) dans %s"
                    % (mutation["id"], occurrences, mutation["cible"])
                )
        assert fautes == [], "\n  ".join(fautes)

    def test_chaque_mutation_vise_la_preuve_declaree_de_son_garde(self, registre):
        preuves = {g["chemin"]: g["preuve"] for g in registre["gardes"]}
        fautes = [
            "%s : %s ≠ %s" % (m["id"], m["preuve"], preuves.get(m["garde"]))
            for m in registre["mutations"]
            if m["preuve"] != preuves.get(m["garde"])
        ]
        assert fautes == [], "\n  ".join(fautes)

    def test_chaque_runner_est_rejoue_par_l_etape_declaree(self, registre):
        """Chaque runner du registre est couvert par une étape déclarée, et cette
        étape est réellement invoquée par un workflow. Sans cette vérification,
        retirer une des étapes éteindrait la moitié de la preuve — ou déplacer
        le runner d'une mutation la ferait tomber dans une étape qui ne la rejoue
        pas — sans que rien ne rougisse."""
        runners = {m["runner"] for m in registre["mutations"]}
        workflow = texte_des_workflows()
        etapes = {etape["runner"]: etape["nom"] for etape in registre["rejeux"] if etape.get("runner")}
        fautes = []
        for runner in sorted(runners):
            nom = etapes.get(runner)
            if not nom:
                fautes.append("aucune étape déclarée ne rejoue les mutations « %s »" % runner)
            elif ("--etape %s" % nom) not in workflow:
                fautes.append("aucun workflow n'invoque l'étape « %s » (runner %s)" % (nom, runner))
        assert fautes == [], "\n  ".join(fautes)

    def test_le_perimetre_vient_de_la_table_pas_du_job(self):
        """Le workflow ne choisit plus quel filtre appliquer à quel job : il
        passe la référence de la PR et c'est la table qui décide ce qui est dû.

        Ce qui se vérifie ICI est le CÂBLAGE — chaque étape déclarée est
        réellement invoquée, et aucun filtre ne s'applique hors PR (où la preuve
        entière est due). Le fait que « pas de base » veuille dire « preuve
        entière » est une DÉCISION du harnais : elle est mesurée dans
        `test_guard_mutation_runner.py`, sur la fonction, pas sur le texte du
        YAML — un test de texte ne saurait pas la distinguer d'un filtre cassé.
        """
        registre = json.loads(SPEC.read_text(encoding="utf-8"))
        workflow = texte_des_workflows()
        fautes = []
        for etape in registre["rejeux"]:
            if ("--etape %s" % etape["nom"]) not in workflow:
                fautes.append(
                    "étape « %s » déclarée dans le registre, invoquée par aucun workflow"
                    % etape["nom"]
                )
        assert fautes == [], "\n  ".join(fautes)

        # Un job DÉSIGNE une étape, il ne choisit pas un filtre : nommer un runner
        # était exactement cette façon de choisir, donc le drapeau ne doit plus
        # apparaître dans une commande (un commentaire qui le cite n'en est pas
        # une).
        commandes = [
            ligne for ligne in workflow.splitlines()
            if "--changed-from" in ligne and not ligne.strip().startswith("#")
        ]
        filtres_par_job = [ligne.strip() for ligne in commandes if "--runner" in ligne]
        assert filtres_par_job == [], (
            "un job choisit encore son filtre au lieu de demander son verdict à la "
            "table : %s" % filtres_par_job
        )

        # Et un verdict que personne ne consomme serait un calcul décoratif :
        # chaque étape qui DEMANDE sa portée publie son `rejeu`, et l'étape qui
        # rejoue ne démarre que sur ce verdict.
        sans_porte = []
        portees = 0
        for bloc in workflow.split("- name:"):
            lignes = bloc.splitlines()
            if not any(
                "--etape" in ligne and "--changed-from" in ligne and "--rejouer" not in ligne
                and not ligne.strip().startswith("#")
                for ligne in lignes
            ):
                continue
            portees += 1
            identifiants = [
                ligne.split(":", 1)[1].strip() for ligne in lignes
                if ligne.strip().startswith("id:")
            ]
            if not identifiants:
                sans_porte.append(lignes[0].strip() or "(étape sans nom)")
                continue
            if not any(
                ("steps.%s.outputs.rejeu" % identifiant) in workflow
                for identifiant in identifiants
            ):
                sans_porte.append(lignes[0].strip() or "(étape sans nom)")
        assert portees >= len(registre["rejeux"]), (
            "toutes les étapes déclarées ne demandent pas leur portée : %d portée(s) "
            "pour %d étape(s)" % (portees, len(registre["rejeux"]))
        )
        assert sans_porte == [], (
            "verdict de portée publié mais consommé par aucune étape : %s" % sans_porte
        )

        # Une COMMUNE, pas une prose : un commentaire qui nomme le drapeau n'est
        # pas une invocation, et le confondre ferait accuser l'étape voisine.
        blocs = []
        for bloc in workflow.split("- name:"):
            commandes = [
                ligne for ligne in bloc.splitlines()
                if "--changed-from" in ligne and not ligne.strip().startswith("#")
            ]
            if commandes:
                blocs.append(bloc)
        assert blocs, (
            "aucun rejeu filtré : le coût par PR est reparti à la hausse, ou la "
            "ligne a été renommée sans que ce test le sache"
        )
        # Le filtre ne vaut que pour une PR : sur un push de `main` (et en
        # dispatch), l'expression de base est vide, donc c'est le rejeu entier
        # qui tourne. L'exiger ici empêche d'attacher le filtre à une étape qui
        # s'exécuterait aussi sur `main`.
        sans_condition = [
            bloc.strip().splitlines()[0] for bloc in blocs
            if "github.event.pull_request" not in bloc
        ]
        assert sans_condition == [], (
            f"un filtre de changement s'applique aussi hors PR : {sans_condition}"
        )

    def test_le_harnais_est_prouve_par_son_propre_test(self, registre):
        assert (REPO_ROOT / "backend" / "tests" / "test_guard_mutation_runner.py").is_file()
        assert json.loads(SPEC.read_text(encoding="utf-8"))["mutations"]
