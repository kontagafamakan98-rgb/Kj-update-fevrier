# -*- coding: utf-8 -*-
"""LE PÉRIMÈTRE DU GATE : la règle, pure et sans E/S — déclaration contre ci.yml,
et déclaration contre la protection de branche RÉELLE.

POURQUOI CE MODULE EXISTE. Deux chemins appliquent le même gate, et jusqu'au
16/10/2026 ils ne jugeaient pas le même périmètre : la protection de `main`
exigeait huit checks nommés pendant que `ci.yml` en déclarait onze, et
`livrer.py` attendait, lui, TOUS les check-runs du commit de tête — y compris
les trois que la protection ignorait. Une fusion manuelle pouvait donc passer
avec la suite e2e rouge (15 rouges / 27 exécutions, dont un cas réel) ou avec
des avis de sécurité de PRODUCTION non corrigés (6 rouges / 30 runs), alors que
le trajet de livraison refusait ces mêmes runs.

La liste vit désormais dans `gate-perimetre.json`, UNE fois, et ce module rend
les deux verdicts qui la tiennent honnête :

  • HORS LIGNE (ce que `check-gate-perimetre.py` juge dans `workflow-lint`, et ce
    que `livrer.py` vérifie avant de pousser) : chaque check déclaré doit
    correspondre, par son identifiant de job ET par le nom que GitHub rapportera,
    à un job réel de `ci.yml` — un nom qui a dérivé ferait attendre la protection
    et la livraison un check-run qui n'arrivera jamais, en silence. Et tout job de
    `ci.yml` doit être soit déclaré, soit exempté AVEC son motif : une liste qui
    ne couvre pas un job est une liste qui a oublié quelque chose.
  • EN LIGNE (ce que `livrer.py` vérifie avec le jeton du propriétaire, et le
    garde avec `--en-ligne`) : la protection de branche doit exiger EXACTEMENT
    les checks déclarés, et la même valeur de `strict`. Un réglage fait à la main
    dans l'interface GitHub se voit ici, au lieu d'être découvert des semaines
    plus tard par une fusion qui passe quand elle n'aurait pas dû.

Ce que ce module ne juge pas, et qui est écrit : si un job DEVRAIT être un gate
(chaque exemption porte son motif, et les décisions surface par surface vivent
dans AUDIT-VERIFICATIONS-NON-BLOQUANTES.md), et si un check requis est
effectivement VERT sur un run donné (c'est le rôle de la CI, pas d'une
déclaration).

Stdlib uniquement : ce module tourne dans `workflow-lint`, un job qui n'installe
pas Python via setup-python (seule la commande `python3` de l'image du runner
existe) — le même périmètre que ses voisins `check-*.py`.
"""
from __future__ import annotations

import json
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
DEPOT = ICI.parents[1]
DECLARATION = ICI / "gate-perimetre.json"
WORKFLOW_CI = DEPOT / ".github" / "workflows" / "ci.yml"

# Longueur minimale du motif d'une exemption : en dessous, elle ne dit rien.
LONGUEUR_MOTIF = 40

# Planchers de lecture : en dessous, le garde REFUSE de conclure. Un `ci.yml`
# illisible ou une déclaration amputée rendrait tous ses refus muets en rendant
# son périmètre vide (un job non vu n'est jamais un job non déclaré).
PLANCHERS = {"checks": 8, "jobs": 10}


def charger(chemin: Path = DECLARATION) -> tuple[dict | None, str]:
    """La déclaration, ou (None, pourquoi) — jamais une exception : un registre

    illisible est un REFUS nommé, pas un plantage du job."""
    try:
        texte = chemin.read_text(encoding="utf-8")
    except OSError as erreur:
        return None, f"déclaration illisible ({chemin}) : {erreur}"
    try:
        declaration = json.loads(texte)
    except json.JSONDecodeError as erreur:
        return None, f"déclaration illisible ({chemin}) : JSON invalide ({erreur})"
    if not isinstance(declaration, dict):
        return None, f"déclaration ({chemin}) : un objet JSON était attendu"
    return declaration, ""


def lire_ci(source: str) -> list[tuple[str, str]]:
    """Les jobs de `ci.yml`, dans l'ordre : (identifiant, nom rapporté par GitHub).

    Le nom rapporté est celui du check-run : le `name:` du job, ou son
    identifiant quand il n'en a pas (c'est ainsi que GitHub nomme le check).
    Lecture ligne à ligne, sans PyYAML (comme les autres gardes du dossier) :
    l'identifiant d'un job est à DEUX espaces d'indentation, son `name:` à
    QUATRE — un `- name:` d'étape est à six, donc il ne peut pas être pris pour
    le nom d'un job.
    """
    jobs: list[tuple[str, str]] = []
    dans_jobs = False
    courant: str | None = None
    for ligne in source.splitlines():
        if re.match(r"^jobs:\s*$", ligne):
            dans_jobs = True
            continue
        if not dans_jobs:
            continue
        job = re.match(r"^  ([A-Za-z0-9][A-Za-z0-9_-]*):\s*$", ligne)
        if job:
            courant = job.group(1)
            jobs.append((courant, courant))
            continue
        if courant is None:
            continue
        nom = re.match(r"^    name:\s*(.+?)\s*$", ligne)
        if nom and nom.group(1) not in ("|", ">", "|-", ">-"):
            valeur = nom.group(1).strip().strip("'\"")
            jobs[-1] = (courant, valeur)
            courant = None
    return jobs


def auditer(declaration: dict, jobs: list[tuple[str, str]]) -> list[str]:
    """Les refus HORS LIGNE : la déclaration et `ci.yml` disent-ils la même chose ?"""
    refus: list[str] = []
    checks = declaration.get("checks") or []
    hors = declaration.get("hors_gate") or []

    if not isinstance(checks, list) or not isinstance(hors, list):
        return ["déclaration : `checks` et `hors_gate` doivent être des listes"]

    if not isinstance(declaration.get("strict"), bool):
        refus.append(
            "déclaration : `strict` (branche à jour exigée) doit être un booléen — sans lui, "
            "la protection et la livraison ne peuvent pas être comparées sur ce point"
        )

    par_job = {job: nom for job, nom in jobs}
    declares: set[str] = set()

    for entree in checks:
        if not isinstance(entree, dict):
            refus.append(f"check déclaré : {entree!r} — un objet {{job, nom}} était attendu")
            continue
        job = str(entree.get("job") or "").strip()
        nom = str(entree.get("nom") or "").strip()
        if not job or not nom:
            refus.append(f"check déclaré : job ou nom vide ({entree!r})")
            continue
        if job in declares:
            refus.append(f"check « {nom} » : le job `{job}` est déclaré deux fois")
        declares.add(job)
        if job not in par_job:
            refus.append(
                f"check « {nom} » : le job `{job}` n'existe plus dans ci.yml — la protection "
                f"exigerait un check-run que plus aucun job ne rapporte"
            )
            continue
        nom_ci = par_job[job]
        if nom_ci != nom:
            refus.append(
                f"check « {nom} » : ci.yml nomme ce job « {nom_ci} » (le nom du check-run est "
                f"celui du job) — l'écart ferait attendre un check-run qui n'arrivera jamais"
            )

    exemptes: set[str] = set()
    for entree in hors:
        if not isinstance(entree, dict):
            refus.append(f"exemption : {entree!r} — un objet {{job, nom, motif}} était attendu")
            continue
        job = str(entree.get("job") or "").strip()
        nom = str(entree.get("nom") or "").strip()
        motif = str(entree.get("motif") or "")
        if job in declares:
            refus.append(
                f"exemption « {nom} » : le job `{job}` est AUSSI déclaré comme check — une seule "
                f"des deux listes doit le porter"
            )
        if job and job not in par_job:
            # Une exemption est périmée quand son job a disparu : laisser une
            # exemption survivre à sa cause, c'est déjà justifier autre chose.
            refus.append(f"exemption « {nom} » : le job `{job}` n'existe plus dans ci.yml — exemption PÉRIMÉE")
        if len(motif) < LONGUEUR_MOTIF:
            refus.append(
                f"exemption « {nom} » : motif de {len(motif)} caractère(s) (< {LONGUEUR_MOTIF}) — "
                f"un job hors gate sans POURQUOI est un oubli avec un droit de passage"
            )
        exemptes.add(job or nom)

    for job, nom in jobs:
        if job not in declares and job not in exemptes:
            refus.append(
                f"job `{job}` (« {nom} ») : ni check déclaré, ni exempté avec son motif — la liste "
                f"ne couvre plus ci.yml, donc les deux périmètres ne peuvent pas être les mêmes"
            )

    if len(checks) < PLANCHERS["checks"]:
        refus.append(
            f"plancher de lecture non atteint : {len(checks)} check(s) déclaré(s) < "
            f"{PLANCHERS['checks']} — une déclaration vide ne prouve rien"
        )
    if len(jobs) < PLANCHERS["jobs"]:
        refus.append(
            f"plancher de lecture non atteint : {len(jobs)} job(s) lu(s) dans ci.yml < "
            f"{PLANCHERS['jobs']} — un lecteur cassé rendrait tous les refus ci-dessus muets"
        )
    return refus


def noms_attendus(declaration: dict) -> list[str]:
    """Les noms EXACTS que les deux périmètres doivent attendre, dans l'ordre déclaré."""
    return [str(entree.get("nom") or "").strip() for entree in (declaration.get("checks") or [])]


def comparer_protection(protection: dict | None, declaration: dict) -> list[str]:
    """Les refus EN LIGNE : ce que GitHub exige est-il exactement ce qui est déclaré ?

    Prend la charge utile de `GET /branches/{branche}/protection` (injectable :
    les cas limites se mesurent sans réseau, et le garde ne fait alors qu'une
    comparaison).
    """
    if not isinstance(protection, dict):
        return ["protection de branche illisible : aucun objet rendu par GitHub"]

    exigences = protection.get("required_status_checks") or {}
    contextes = list(exigences.get("contexts") or [])
    strict = exigences.get("strict")
    attendus = noms_attendus(declaration)
    refus: list[str] = []

    for nom in attendus:
        if nom not in contextes:
            refus.append(
                f"la protection de branche n'exige PAS « {nom} » — une fusion faite dans "
                f"l'interface GitHub peut passer avec ce check rouge"
            )
    for contexte in sorted(contextes):
        if contexte not in attendus:
            refus.append(
                f"la protection de branche exige « {contexte} », que le périmètre déclaré ne "
                f"porte pas — soit le déclarer (check ou exemption motivée), soit le retirer"
            )
    if bool(strict) != bool(declaration.get("strict")):
        refus.append(
            f"la protection de branche a `strict: {strict}` et la déclaration "
            f"`strict: {declaration.get('strict')}` — la branche à jour n'est donc pas exigée "
            f"de la même façon des deux côtés"
        )
    return refus


def lire_protection(jeton: str, depot: str, branche: str = "main", timeout: int = 20) -> tuple[dict | None, str]:
    """La protection de branche, lue avec un jeton — (`None`, pourquoi) en cas d'échec.

    Ce chemin demande un accès ADMIN au dépôt : la CI (jeton par défaut) ne peut
    pas le prendre, c'est pourquoi il vit dans le pré-vol de `livrer.py` et dans
    `check-gate-perimetre.py --en-ligne`, jamais dans `workflow-lint`.
    """
    url = f"https://api.github.com/repos/{depot}/branches/{branche}/protection"
    requete = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {jeton}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kojo-gate-perimetre/1.0",
        },
    )
    try:
        with urllib.request.urlopen(requete, timeout=timeout) as reponse:
            return json.loads(reponse.read().decode("utf-8")), ""
    except urllib.error.HTTPError as erreur:
        return None, f"protection de branche illisible (HTTP {erreur.code}) : {erreur.reason}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as erreur:
        return None, f"protection de branche injoignable ({erreur})"


def depot_du_remote(racine: Path = DEPOT) -> str:
    """`propriétaire/nom` du remote `origin` — le dépôt que la protection concerne."""
    try:
        sortie = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(racine),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""
    correspondance = re.search(r"github\.com[:/]+([^/]+/[^/\s]+?)(?:\.git)?$", sortie)
    return correspondance.group(1) if correspondance else ""


def lire_perimetre(chemin_ci: Path = WORKFLOW_CI) -> tuple[dict | None, list[tuple[str, str]], str]:
    """La déclaration, les jobs de `ci.yml`, et le premier empêchement rencontré."""
    declaration, empechement = charger()
    if declaration is None:
        return None, [], empechement
    try:
        source = chemin_ci.read_text(encoding="utf-8")
    except OSError as erreur:
        return declaration, [], f"ci.yml illisible ({chemin_ci}) : {erreur}"
    return declaration, lire_ci(source), ""
