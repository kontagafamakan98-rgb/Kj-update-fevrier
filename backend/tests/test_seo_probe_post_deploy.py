# -*- coding: utf-8 -*-
"""Régression : la sonde SEO stricte tourne AUSSI juste après un déploiement.

Le défaut que ce test verrouille
--------------------------------
F9 (CI-COVERAGE.md) est né d'un silence : quatre intégrations SEO/analytics
absentes de la production, et aucun run rouge nulle part. La sonde stricte
(`frontend/scripts/check-seo-production.js --strict`) a fermé ce silence, mais
elle ne tournait qu'une fois par jour (`.github/workflows/seo-production-probe.yml`,
`17 6 * * *`) : une livraison qui perd une variable `VITE_*` — les `VITE_*` sont
INLINÉES au build par Vercel, donc une variable absente n'échoue nulle part, elle
appauvrit le HTML — n'était constatée que jusqu'à 24 h plus tard, alors que
l'écart était encore attribuable à cette livraison.

Ce qui est verrouillé ici
-------------------------
1. la sonde stricte est une étape de `frontend-build` (le job qui, sur `main`,
   vient de constater que la production SERT le frontend de ce commit) ;
2. elle vient IMMÉDIATEMENT APRÈS cette vérification : la fenêtre d'attente du
   déploiement est donc déjà passée, et l'étape ne peut pas juger l'ancien
   artefact en le présentant comme le nouveau ;
3. la MÊME garde `main` que la vérification de révision (jamais une PR) ;
4. la MÊME commande que le cron, sans variante — deux définitions de « conforme »
   divergeraient, et la livraison deviendrait plus indulgente que le run
   quotidien ;
5. aucune soupape : ni `continue-on-error`, ni `|| true` — un rouge qui ne rougit
   pas est le silence que F9 a fermé.

Ce que ce test ne prouve pas : que la sonde passe sur la production (c'est une
mesure, pas une propriété du dépôt), ni que l'étape s'exécutera sur un run — elle
est jugée ici à sa déclaration, comme les autres verrous de workflow du dépôt
(`test_ci_workflow_pins.py`, `test_exec_bits.py`).
"""
import re
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"
CRON = REPO_ROOT / ".github" / "workflows" / "seo-production-probe.yml"

JOB = "frontend-build"
JOB_CRON = "probe"
# La garde de `main` : la production ne dit rien d'une PR, et un repli local
# ferait refuser la sonde (elle ne conclut jamais sur du local).
GARDE_MAIN = "github.event_name == 'push' && github.ref == 'refs/heads/main'"
COMMANDE = "node scripts/check-seo-production.js --strict"
EXTRACTION_REVISION = "check-deployed-revision.js"
EXTRACTION_SONDE = "check-seo-production.js"

# Plancher de lecture : sous ce nombre d'étapes, c'est le LECTEUR qui est cassé
# (mise en forme du workflow changée), pas le dépôt qui a perdu son étape. Refuser
# de juger un relevé vide vaut mieux que le juger.
MIN_ETAPES_JOB = 20

JOB_HEADER = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
STEP_HEADER = re.compile(r"^ {6}- (?P<reste>.*)$")
CLE_VALEUR = re.compile(r"^(?P<indent> +)(?P<cle>[A-Za-z0-9_-]+):(?P<valeur>.*)$")
BLOCS = ("|", ">", "|-", ">-")


def lignes_job(texte, job):
    """Les lignes d'un job, bornées par le job suivant.

    :param texte: contenu du fichier de workflow.
    :param job: nom du job (clé de premier niveau sous `jobs:`).
    :returns: lignes du bloc, sans sa ligne d'en-tête.
    """
    lignes = texte.splitlines()
    debut = None
    for index, ligne in enumerate(lignes):
        entete = JOB_HEADER.match(ligne)
        if entete and entete.group(1) == job:
            debut = index + 1
            break
    if debut is None:
        raise AssertionError(
            f"job « {job} » introuvable : le lecteur ne voit rien, il ne peut donc "
            "rien verrouiller."
        )
    fin = len(lignes)
    for index in range(debut, len(lignes)):
        if JOB_HEADER.match(lignes[index]):
            fin = index
            break
    return lignes[debut:fin]


def etapes(lignes):
    """Les étapes d'un bloc de job : une liste de dictionnaires clé → valeur.

    Lecture ligne à ligne, volontairement : `PyYAML` n'est pas une dépendance du
    dépôt (même choix que `check-workflow-pins.py`). Un bloc scalaire (`run: |`)
    est déplié et dé-indenté, pour que la COMMANDE y soit comparable telle quelle.
    """
    resultat = []
    courante = None
    cle_scalaire = None
    indentation = 0
    for ligne in lignes:
        entete = STEP_HEADER.match(ligne)
        if entete:
            courante = {}
            resultat.append(courante)
            cle_scalaire = None
            reste = entete.group("reste").strip()
            if ":" in reste:
                cle, valeur = reste.split(":", 1)
                courante[cle.strip()] = valeur.strip()
            continue
        if courante is None:
            continue
        correspondance = CLE_VALEUR.match(ligne)
        if correspondance:
            cle = correspondance.group("cle")
            valeur = correspondance.group("valeur").strip()
            if valeur in BLOCS:
                cle_scalaire = cle
                indentation = len(correspondance.group("indent"))
                courante[cle] = []
            else:
                cle_scalaire = None
                courante[cle] = valeur
            continue
        if cle_scalaire is not None and len(ligne) > indentation:
            courante[cle_scalaire].append(ligne[indentation + 1 :])
    for etape in resultat:
        for cle, valeur in list(etape.items()):
            if isinstance(valeur, list):
                etape[cle] = "\n".join(valeur).strip("\n")
    return resultat


def releve(chemin, job):
    """Les étapes d'un job, avec le plancher de lecture appliqué."""
    etapes_lues = etapes(lignes_job(chemin.read_text(encoding="utf-8"), job))
    assert len(etapes_lues) >= MIN_ETAPES_JOB, (
        f"{len(etapes_lues)} étape(s) lue(s) dans « {job} » : sous le plancher de "
        f"{MIN_ETAPES_JOB}, c'est la lecture qui est cassée (mise en forme changée) "
        "— refus de conclure sur un relevé vide."
    )
    return etapes_lues


def indices(releve_etapes, extrait):
    """Les indices des étapes dont le `run` contient `extrait`."""
    return [index for index, etape in enumerate(releve_etapes) if extrait in etape.get("run", "")]


def etape_unique(releve_etapes, extrait, role):
    """L'unique étape portant `extrait`, ou un refus qui nomme le compte lu."""
    trouves = indices(releve_etapes, extrait)
    assert len(trouves) == 1, (
        f"{len(trouves)} étape(s) {role} dans « {JOB} » ({extrait}) : une seule est "
        "attendue, sinon « l'étape qui suit » ne désigne plus la même chose."
    )
    return trouves[0]


def test_la_sonde_stricte_suit_immediatement_la_verification_de_revision():
    releve_etapes = releve(CI, JOB)
    revision = etape_unique(releve_etapes, EXTRACTION_REVISION, "vérifient la révision servie")
    sonde = etape_unique(releve_etapes, EXTRACTION_SONDE, "lancent la sonde SEO")
    assert sonde == revision + 1, (
        f"la sonde SEO est à l'étape {sonde + 1}, la vérification de révision à "
        f"l'étape {revision + 1} : elle doit venir IMMÉDIATEMENT APRÈS, pour que la "
        "fenêtre d'attente du déploiement soit déjà passée — sinon elle juge "
        "l'ancien artefact en le présentant comme le nouveau."
    )


def test_la_sonde_partage_la_garde_main_de_la_verification():
    releve_etapes = releve(CI, JOB)
    revision = releve_etapes[etape_unique(releve_etapes, EXTRACTION_REVISION, "vérifient la révision")]
    sonde = releve_etapes[etape_unique(releve_etapes, EXTRACTION_SONDE, "lancent la sonde SEO")]
    assert sonde.get("if") == revision.get("if") == GARDE_MAIN, (
        f"gardes différentes : sonde={sonde.get('if')!r}, révision={revision.get('if')!r}, "
        f"attendu={GARDE_MAIN!r}. La sonde ne tourne que là où le déploiement a été "
        "constaté : sur `main`, jamais sur une PR (le repli d'une PR serait local, et "
        "la sonde ne conclut pas sur du local)."
    )
    assert sonde.get("working-directory") == revision.get("working-directory") == "frontend", (
        f"répertoires différents : sonde={sonde.get('working-directory')!r}, "
        f"révision={revision.get('working-directory')!r} — la sonde doit tourner depuis "
        "frontend/, comme la vérification qu'elle suit."
    )


def test_la_sonde_rejoue_la_commande_du_cron_sans_variante():
    releve_etapes = releve(CI, JOB)
    sonde = releve_etapes[etape_unique(releve_etapes, EXTRACTION_SONDE, "lancent la sonde SEO")]["run"].strip()
    commandes = [
        etape.get("run", "").strip()
        for etape in etapes(lignes_job(CRON.read_text(encoding="utf-8"), JOB_CRON))
        if EXTRACTION_SONDE in etape.get("run", "")
    ]
    assert len(commandes) == 1, (
        f"{len(commandes)} commande(s) de sonde dans {CRON.name} : la référence de "
        "comparaison est introuvable, ce test ne peut donc pas juger l'égalité."
    )
    assert sonde == commandes[0] == COMMANDE, (
        f"commandes divergentes : livraison={sonde!r}, cron={commandes[0]!r}, "
        f"attendu={COMMANDE!r}. Deux définitions de « conforme » divergeraient, et la "
        "livraison deviendrait plus indulgente que le run quotidien."
    )


def test_la_sonde_ne_porte_aucune_soupape():
    releve_etapes = releve(CI, JOB)
    sonde = releve_etapes[etape_unique(releve_etapes, EXTRACTION_SONDE, "lancent la sonde SEO")]
    assert "continue-on-error" not in sonde, (
        "l'étape porte `continue-on-error` : un écart de configuration SEO ne ferait "
        "plus rougir la livraison — le silence que F9 a fermé."
    )
    commande = sonde["run"]
    assert "|| true" not in commande, (
        f"commande neutralisée ({commande!r}) : un rapport qui ne peut pas échouer "
        "n'est pas une vérification."
    )
    assert "--strict" in commande, (
        f"la sonde perd son mode strict ({commande!r}) : sans lui, une intégration "
        "REQUISE absente redevient une note que personne ne lit."
    )
