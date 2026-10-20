#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trajet complet de livraison automatisé — Kojo.

Enchaîne sans rupture :
  0. Arbre de travail PROPRE — la livraison publie des COMMITS : un fichier
     modifié ou non suivi (non ignoré) n'entre dans aucune PR, et le refuser
     est la seule façon de ne pas livrer autre chose que ce que l'auteur a
     sous les yeux ;
  1. Pré-vol local (check-test-environment --avant-push, branches propres)
  2. Push de la branche de travail courante vers origin (sans fuite de secret)
  3. Détection ou ouverture de la Pull Request sur GitHub
  4. Attente active des checks du PÉRIMÈTRE DÉCLARÉ de la CI sur le commit de tête
     (`.github/scripts/gate-perimetre.json` : exactement les checks que la
     protection de `main` exige, ni plus ni moins)
  5. Fusion de la PR (méthode configurable : squash ou merge, défaut squash)

Avant le push, un PRÉ-VOL compare le périmètre déclaré aux jobs de `ci.yml` ET
aux checks que la protection de `main` exige réellement : une dérive du réglage
GitHub se voit ici, attribuable à la livraison, plutôt que six semaines plus tard
par une fusion manuelle passée sous un check rouge.
  6. Élagage et synchronisation locale (suppression de la branche de travail fusionnée)
  7. Attente et confirmation formelle des révisions servies en production. Les
     révisions ATTENDUES se lisent sur la BASE DISTANTE (`origin/main`, relu
     après la fusion), jamais sur le `main` local : l'étape 6 est best-effort,
     donc un dépôt local périmé ne doit pas faire refuser une production qui
     sert pourtant le bon commit (faux refus, code 2). La base est relue UNE
     SEULE FOIS par livraison (`lire_base_distante`) et PASSÉE aux deux
     confirmations : deux lectures séparées feraient deux `git fetch` pour un
     même fait, et pourraient tomber de part et d'autre d'un `main` qui avance —
     deux verdicts qui ne parlent plus du même état du dépôt.
     - Vercel (frontend) : balise meta `kojo-build-revision` sur https://kojoforafrica.cc.cd
     - SEO (frontend)    : sonde stricte `check-seo-production.js --strict`, lancée JUSTE
       APRÈS la confirmation de la révision servie — la MÊME commande que la CI, et son
       verdict tombe dans le terminal (une intégration requise absente, ou une sonde qui
       ne peut pas conclure, refuse la livraison : code 2)
     - Fly.io (backend)  : endpoint `/health` sur https://api.kojoforafrica.cc.cd/health

Un refus de l'une des trois confirmations rend le code 2 (« la PR est fusionnée mais
la production n'est pas conforme ») — jamais 0.

Usage :
    python .github/scripts/livrer.py [options]

Options :
    --branche NOM        Branche à livrer (défaut : branche courante)
    --titre TITRE        Titre de la PR (défaut : message du dernier commit)
    --corps TEXTE        Corps / description de la PR
    --mode METHODE       Méthode de fusion GitHub : squash | merge | rebase (défaut : squash)
    --timeout-ci MIN     Délai maximal d'attente des checks CI en minutes (défaut : 25)
    --timeout-prod MIN   Délai maximal de confirmation production en minutes (défaut : 10)
    --skip-push          Ne pas repousser la branche (si déjà poussée)
    --reprise-pr NUM     Reprendre une PR déjà ouverte sans tenter de la recréer
    --token TOKEN        Jeton GitHub personnel (sinon lu depuis GH_TOKEN ou GITHUB_TOKEN)
    --dry-run            Simule les étapes sans exécuter de push, création de PR ou merge
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# La règle du PÉRIMÈTRE DU GATE vit dans `.github/scripts/perimetre_gate.py`, à
# côté : elle est partagée avec le garde `check-gate-perimetre.py`. Ce seul
# import est ce qui garantit que la livraison et la protection de branche
# attendent la MÊME liste, au lieu de deux définitions qui dérivent.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from perimetre_gate import (  # noqa: E402  (import après l'insertion du chemin)
    auditer,
    comparer_protection,
    lire_perimetre,
    lire_protection,
    noms_attendus,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
BACKEND_DIR = REPO_ROOT / "backend"

URL_FRONTEND_PROD = "https://kojoforafrica.cc.cd"
URL_BACKEND_HEALTH = os.environ.get("KOJO_BACKEND_HEALTH_URL", "https://api.kojoforafrica.cc.cd/health").strip()

REPO_OWNER = "kontagafamakan98-rgb"
REPO_NAME = "Kj-update-fevrier"
API_BASE = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}"

# Rendre la sortie terminal propre et tolérante sous Windows / cp1252
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass


def log(msg: str):
    horodate = time.strftime("%H:%M:%S")
    print(f"[{horodate}] {msg}", flush=True)


def log_erreur(msg: str):
    horodate = time.strftime("%H:%M:%S")
    print(f"[{horodate}] ❌ {msg}", file=sys.stderr, flush=True)


def log_succes(msg: str):
    horodate = time.strftime("%H:%M:%S")
    print(f"[{horodate}] ✅ {msg}", flush=True)


def exec_cmd(args, cwd=None, capture=True, check=True, env=None) -> str:
    """Exécute une commande système de façon contrôlée."""
    environ = os.environ.copy()
    if env:
        environ.update(env)
    res = subprocess.run(
        args,
        cwd=cwd or str(REPO_ROOT),
        capture_output=capture,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environ,
    )
    if check and res.returncode != 0:
        cmd_str = " ".join(args) if isinstance(args, list) else str(args)
        err = res.stderr.strip() if res.stderr else res.stdout.strip()
        raise RuntimeError(f"Échec commande `{cmd_str}` (code {res.returncode}) :\n{err}")
    return res.stdout.strip() if capture else ""


def obtenir_jeton(arg_token: str | None) -> str:
    token = (arg_token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if not token:
        # Essayer via git credential pour github.com
        try:
            p = subprocess.Popen(
                ["git", "credential", "fill"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            out, _ = p.communicate(input="protocol=https\nhost=github.com\n\n", timeout=5)
            for line in out.splitlines():
                if line.startswith("password="):
                    token = line.split("=", 1)[1].strip()
                    break
        except Exception:
            pass

    if not token:
        raise ValueError(
            "Aucun jeton GitHub trouvé. Définir la variable d'environnement GH_TOKEN "
            "ou passer --token <jeton>."
        )
    return token


def appel_github(methode: str, chemin: str, jeton: str, donnees: dict | None = None) -> dict | list | None:
    url = f"{API_BASE}/{chemin.lstrip('/')}"
    corps = json.dumps(donnees).encode("utf-8") if donnees is not None else None
    req = urllib.request.Request(url, data=corps, method=methode)
    req.add_header("Authorization", f"Bearer {jeton}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "kojo-livrer-pipeline/1.0")
    if donnees is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            if not raw.strip():
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        err_corps = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_corps)
            msg = parsed.get("message", err_corps)
        except Exception:
            msg = err_corps
        raise RuntimeError(f"GitHub API {methode} {chemin} -> HTTP {exc.code} : {msg}")
    except Exception as exc:
        raise RuntimeError(f"Erreur réseau GitHub API {methode} {chemin} : {exc}")


def arbre_de_travail_sale() -> list[str]:
    """Les changements NON COMMITÉS, lus par `git status --porcelain`.

    La sortie inclut les fichiers modifiés, indexés ET non suivis non ignorés :
    ce sont exactement ceux qu'un auteur croirait livrés, et qu'aucun commit ne
    porte. Les fichiers ignorés (résultats de bancs, `.env`) n'en font pas
    partie : ils ne sont pas destinés à la PR, et les refuser rendrait la
    commande inutilisable sur un poste qui vient de mesurer.

    Une liste vide = rien à signaler.
    """
    sortie = exec_cmd(["git", "status", "--porcelain"])
    return [ligne for ligne in sortie.splitlines() if ligne.strip()]


def verifier_arbre_propre() -> None:
    """Refuse de livrer un arbre qui porte des changements non commités.

    `npm run livrer` ouvre (ou reprend) une PR et la FUSIONNE quand elle est
    verte : livrer depuis un disque sale produirait une PR verte qui ne contient
    pas le travail visible de l'auteur, sans que rien ne le dise. La décision
    reste à l'auteur — committer (ou retirer) —, pas à la commande : elle refuse,
    en NOMMANT les chemins, et n'ajoute ni ne commite rien d'elle-même.

    Refusé aussi en `--dry-run` : l'arbre sale est un FAIT, pas une simulation,
    et un « ça marcherait » qui ignore ce fait serait un faux vert.
    """
    sale = arbre_de_travail_sale()
    if not sale:
        return
    apercu = ", ".join(sale[:5])
    if len(sale) > 5:
        apercu += f", … ({len(sale)} au total)"
    raise RuntimeError(
        "Arbre de travail NON PROPRE : la livraison ne publie que les COMMITS, "
        "donc ces changements ne seraient pas dans la PR. Committer ou retirer "
        f"ces chemins, puis relancer — {apercu}."
    )


def verifier_prevol_local():
    log("Exécution du pré-vol local (vérification résidus git et environnement)...")
    res = subprocess.run(
        ["node", "frontend/scripts/check-test-environment.js", "--avant-push"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if res.returncode != 0:
        log_erreur("Le pré-vol local a refusé le push :")
        print(res.stderr or res.stdout)
        raise RuntimeError("Pré-vol local échoué.")
    log_succes("Pré-vol local conforme.")


def verifier_perimetre_du_gate(jeton: str, en_ligne: bool = True) -> list[str]:
    """Le périmètre du gate est-il le MÊME des deux côtés de la livraison ?

    Deux questions, et les deux doivent être vertes pour que la livraison parte :

      1. HORS LIGNE — la liste déclarée (`.github/scripts/gate-perimetre.json`)
         et `ci.yml` disent-elles la même chose ? C'est la règle partagée avec le
         garde `check-gate-perimetre.py` qui répond (noms de check-run exacts,
         tout job déclaré ou exempté, planchers de lecture) : la rejouer ici
         évite de livrer sur une déclaration cassée quand le garde n'a pas tourné.
      2. EN LIGNE — ce que GitHub exige RÉELLEMENT sur `main` est-il exactement
         cette liste ? C'est le fait que seul un jeton du propriétaire peut lire
         (l'accès à la protection demande les droits admin du dépôt) : le garde
         hors ligne ne peut donc pas le porter, tandis que la livraison, elle,
         a le jeton — et c'est là que la dérive se voit, AVANT que la PR ne
         fusionne sur un gate qui n'est pas celui qu'on croit.

    Un refus n'est pas un avertissement : sans cette vérification, une fusion
    peut passer par l'interface GitHub sous un check rouge (mesuré le
    12/10/2026 : e2e et avis de sécurité hors protection, 8 checks requis pour
    11 jobs déclarés). Un jeton qui ne peut pas lire la protection est un refus
    NOMMÉ, jamais un vert silencieux.
    """
    declaration, jobs, empechement = lire_perimetre()
    if declaration is None:
        return [empechement]
    refus = [empechement] if empechement else auditer(declaration, jobs)
    attendus = noms_attendus(declaration)

    if not en_ligne:
        log(
            "  Périmètre hors ligne vérifié (%d check(s) déclaré(s)) — la protection "
            "de 'main' n'est PAS relue ici : elle n'est comparable qu'en ligne." % len(attendus)
        )
        return refus

    protection, empechement_ligne = lire_protection(jeton, f"{REPO_OWNER}/{REPO_NAME}", "main")
    if protection is None:
        refus.append(
            empechement_ligne
            + " — la livraison exige que le périmètre RÉEL de 'main' soit comparable : "
            "poser un jeton avec les droits admin du dépôt (GH_TOKEN), ou lire et corriger "
            "le réglage à la main, puis relancer"
        )
        return refus

    contextes = (protection.get("required_status_checks") or {}).get("contexts") or []
    log(
        "  Protection de 'main' : %d check(s) exigé(s), strict=%s"
        % (len(contextes), (protection.get("required_status_checks") or {}).get("strict"))
    )
    return refus + comparer_protection(protection, declaration)


def pousser_branche(branche: str, jeton: str, max_tentatives: int = 3):
    log(f"Push de la branche '{branche}' vers origin (sans persister le jeton)...")
    url_distante = f"https://x-access-token:{jeton}@github.com/{REPO_OWNER}/{REPO_NAME}.git"
    # HÉRITER de l'environnement, puis poser le drapeau : un `env=` qui ne contient
    # QUE cette variable prive le git enfant de PATH, HOME, SystemRoot, etc. Sous
    # Windows/MSYS, la résolution DNS du sous-processus échoue alors par un
    # « Could not resolve host: github.com » — le push refusait avant même de partir.
    # C'est le motif déjà en place dans `exec_cmd` (copie de os.environ puis ajout).
    env_git = os.environ.copy()
    env_git["GIT_TERMINAL_PROMPT"] = "0"
    cmd = ["git", "-c", "credential.helper=", "push", "-u", url_distante, branche]
    try:
        succes = False
        dernier_err = ""
        for i in range(1, max_tentatives + 1):
            res = subprocess.run(
                cmd,
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env_git,
            )
            if res.returncode == 0:
                succes = True
                break
            dernier_err = res.stderr or res.stdout
            if "Could not resolve host" in dernier_err or "unable to access" in dernier_err:
                log(f"Échec réseau intermittent lors du push (tentative {i}/{max_tentatives}), nouvel essai dans 3s...")
                time.sleep(3)
            else:
                break

        if not succes:
            err_nettoyee = dernier_err.replace(jeton, "***")
            raise RuntimeError(f"Échec git push :\n{err_nettoyee}")
        log_succes(f"Branche '{branche}' poussée avec succès.")
    finally:
        # S'assurer qu'aucun jeton n'a fui dans .git/config
        config_path = REPO_ROOT / ".git" / "config"
        if config_path.is_file():
            texte_conf = config_path.read_text(encoding="utf-8", errors="replace")
            if jeton in texte_conf or "x-access-token" in texte_conf:
                log_erreur("ALERTE : le jeton s'est retrouvé dans .git/config ! Nettoyage immédiat.")
                texte_nettoyee = re.sub(r"https://x-access-token:[^@]+@", "https://", texte_conf)
                config_path.write_text(texte_nettoyee, encoding="utf-8")


def trouver_ou_creer_pr(branche: str, titre: str | None, corps: str | None, jeton: str, reprise_pr: int | None = None) -> dict:
    if reprise_pr:
        log(f"Récupération de la PR spécifiée #{reprise_pr}...")
        pr = appel_github("GET", f"pulls/{reprise_pr}", jeton)
        return pr

    log(f"Recherche d'une PR ouverte existante pour la branche '{branche}'...")
    prs = appel_github("GET", f"pulls?head={REPO_OWNER}:{branche}&state=open", jeton)
    if prs and len(prs) > 0:
        pr = prs[0]
        log(f"PR existante trouvée : #{pr['number']} ({pr['title']})")
        return pr

    log("Aucune PR ouverte trouvée. Création d'une nouvelle Pull Request vers 'main'...")
    if not titre:
        # Extraire le message du dernier commit de la branche
        titre = exec_cmd(["git", "log", "-1", "--format=%s", branche])
    if not corps:
        corps = exec_cmd(["git", "log", "-1", "--format=%b", branche])
        if not corps.strip():
            corps = f"Livraison automatique de la branche `{branche}`."

    payload = {
        "title": titre,
        "head": branche,
        "base": "main",
        "body": corps,
    }
    pr = appel_github("POST", "pulls", jeton, payload)
    log_succes(f"Pull Request créée : #{pr['number']} - {pr['html_url']}")
    return pr


def attendre_checks_ci(sha: str, jeton: str, timeout_minutes: int = 25,
                       attendus: list[str] | None = None) -> bool:
    """Attend les checks du PÉRIMÈTRE DÉCLARÉ, et eux seuls.

    L'ancienne version attendait TOUS les check-runs du commit de tête, y compris
    ceux que la protection de `main` n'exige pas : c'était la moitié du décalage
    mesuré le 12/10/2026, et cela faisait refuser une livraison sur un rapport de
    taille (`Bundle size report (PR comment)`, qui publie un commentaire) tandis
    qu'une fusion manuelle passait sous la suite e2e rouge. Ici les deux périmètres
    lisent la MÊME liste (`gate-perimetre.json`), et un check-run hors liste est
    DIT ignoré plutôt que silencieusement compté comme vert.

    Une liste vide n'est pas un vert : si rien n'est déclaré, c'est la déclaration
    qui est cassée, et cette fonction refuse.
    """
    noms = [str(nom) for nom in (attendus or [])]
    if not noms:
        log_erreur(
            "Périmètre de gate vide : aucun check déclaré — refus d'attendre « tous les "
            "check-runs », qui est exactement la façon dont les deux périmètres ont divergé."
        )
        return False

    log(f"Surveillance des checks CI sur le commit de tête {sha[:10]}...")
    log(f"Périmètre déclaré ({len(noms)} check(s)) : {', '.join(noms)}")
    deadline = time.time() + (timeout_minutes * 60)
    ignores_dits = set()

    while time.time() < deadline:
        data = appel_github("GET", f"commits/{sha}/check-runs?per_page=100", jeton)
        runs = data.get("check_runs", [])
        par_nom = {r["name"]: r for r in runs if r.get("name") in noms}
        ignores = sorted({r["name"] for r in runs} - set(noms))
        for nom in ignores:
            if nom not in ignores_dits:
                ignores_dits.add(nom)
                log(f"  check hors périmètre, ignoré : {nom}")

        if not runs:
            log("En attente de l'enregistrement des check-runs par GitHub...")
            time.sleep(10)
            continue

        absents = [nom for nom in noms if nom not in par_nom]
        termines = []
        en_cours = []
        echoues = []

        for nom in sorted(noms):
            run = par_nom.get(nom)
            if run is None:
                continue
            statut = run["status"]
            conclusion = run.get("conclusion")
            if statut == "completed":
                if conclusion in ("success", "skipped", "neutral"):
                    termines.append(nom)
                else:
                    echoues.append((nom, conclusion, run.get("html_url")))
            else:
                en_cours.append(nom)

        log(
            f"Progression CI : {len(termines)}/{len(noms)} terminés, {len(en_cours)} en cours, "
            f"{len(echoues)} échec(s), {len(absents)} pas encore rapporté(s)"
        )

        if echoues:
            log_erreur(f"Un ou plusieurs checks du périmètre ont échoué ({len(echoues)}) :")
            for nom, conc, url in echoues:
                print(f"   - {nom} : {conc} ({url})")
            return False

        if len(termines) == len(noms):
            log_succes(f"Les {len(noms)} checks du périmètre déclaré sont au vert (ou skipped attendu) !")
            return True

        time.sleep(20)

    log_erreur(f"Délai d'attente CI dépassé ({timeout_minutes} minutes).")
    return False


def fusionner_pr(pr_number: int, sha: str, mode: str, jeton: str) -> str:
    log(f"Fusion de la PR #{pr_number} via l'API GitHub (mode: {mode})...")
    payload = {
        "sha": sha,
        "merge_method": mode,
    }
    res = appel_github("PUT", f"pulls/{pr_number}/merge", jeton, payload)
    if not res.get("merged"):
        raise RuntimeError(f"La fusion de la PR #{pr_number} a été rejetée : {res.get('message')}")
    merge_sha = res.get("sha", "")
    log_succes(f"PR #{pr_number} fusionnée avec succès ! Commit de merge : {merge_sha[:10]}")
    return merge_sha


def synchroniser_et_nettoyer_local(branche_travail: str):
    log("Synchronisation de la branche locale 'main' et élagage...")
    # Basculer sur main
    exec_cmd(["git", "checkout", "main"])
    exec_cmd(["git", "fetch", "--prune", "origin"])
    exec_cmd(["git", "pull", "--ff-only", "origin", "main"])

    # Supprimer la branche locale de travail si distincte de main
    if branche_travail != "main":
        log(f"Nettoyage de la branche locale de travail '{branche_travail}'...")
        # delete_branch_on_merge supprime la branche sur origin
        # En local, on tente -d puis -D
        res = subprocess.run(
            ["git", "branch", "-d", branche_travail],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if res.returncode != 0:
            exec_cmd(["git", "branch", "-D", branche_travail])
        log_succes(f"Branche locale '{branche_travail}' supprimée proprement.")


# Référence des révisions attendues : la BASE DISTANTE, jamais le `main` local.
REF_BASE_DISTANTE = "origin/main"


class BaseDistante:
    """`origin/main`, RELUE UNE FOIS par livraison, puis partagée.

    Les deux confirmations de production (Vercel, Fly) répondent à la MÊME
    question : la base distante porte-t-elle la fusion, et quel commit chaque
    surface doit-elle servir ? Les laisser relire la référence chacune de leur
    côté coûtait deux `git fetch` pour un seul fait — et surtout deux occasions
    de lire deux états différents, si un `main` avance entre les deux : les deux
    verdicts n'auraient alors plus parlé du même dépôt.

    Cette classe porte donc ce qui a été LU (`fusion`, `ref`), et la seule
    opération qui reste propre à une surface : le dernier commit qui touche SES
    chemins. Elle ne relit jamais rien — la relecture est celle de
    `lire_base_distante`, et elle n'a lieu qu'une fois.
    """

    def __init__(self, fusion: str, ref: str = REF_BASE_DISTANTE):
        self.fusion = fusion
        self.ref = ref

    def revision(self, chemins: list[str]) -> str:
        """Dernier commit de la référence distante touchant `chemins`.

        Aucun `fetch` ici (voir la classe) : un `rev-list` local, par surface.
        Un résultat vide est un REFUS, jamais une révision vide comparée en
        silence.
        """
        revision = exec_cmd(["git", "rev-list", "-1", self.ref, "--", *chemins])
        if not revision:
            raise RuntimeError(
                f"aucun commit de {self.ref} ne touche {', '.join(chemins)} — "
                "la référence ou les chemins ne sont pas ceux du dépôt."
            )
        return revision


def lire_base_distante(merge_sha: str) -> BaseDistante:
    """Relit `origin/main`, vérifie qu'il porte la fusion, et rend la base PARTAGÉE.

    L'étape 6 (`synchroniser_et_nettoyer_local`) est BEST-EFFORT : son échec est
    journalisé et le trajet continue. Lire les révisions attendues sur `HEAD`
    faisait donc dépendre le verdict d'un `main` local périmé — un `git pull
    --ff-only` refusé, une bascule ratée — et la vérification attendait le
    commit d'AVANT la fusion pendant que la production servait le nouveau :
    `livrer` rendait 2 sur une livraison réussie.

    On relit donc la référence DISTANTE ici, et on refuse de conclure quand
    elle ne porte pas la fusion : comparer à une référence non relue rendrait
    le même faux verdict, en silence. L'appelant lit cette base UNE fois et la
    passe aux deux confirmations — c'est ce qui fait qu'une livraison ne fait
    qu'un `fetch` et qu'elle juge ses deux surfaces contre le MÊME état.
    """
    if not merge_sha:
        raise RuntimeError(
            "Révision de fusion inconnue : le verdict de production ne peut pas "
            "être rattaché à la fusion qui vient d'avoir lieu."
        )
    exec_cmd(["git", "fetch", "origin", "main"])
    res = subprocess.run(
        ["git", "merge-base", "--is-ancestor", merge_sha, REF_BASE_DISTANTE],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"{REF_BASE_DISTANTE} ne contient pas la fusion {merge_sha[:10]} : la "
            "référence distante n'a pas été relue, et un verdict rendu contre elle "
            "serait faux. Vérifier le réseau puis relancer (`git fetch origin main`)."
        )
    return BaseDistante(merge_sha)


def verifier_production_frontend(base: BaseDistante, timeout_minutes: int = 10) -> bool:
    log(f"Contrôle de la révision servie par VERCEL (frontend sur {URL_FRONTEND_PROD})...")
    try:
        # Le dernier commit frontend se lit sur la base DISTANTE PARTAGÉE (relue
        # une fois par la livraison), jamais sur le `main` local : c'est ce qui
        # rend le verdict indépendant de l'étape de synchronisation, best-effort.
        dernier_frontend = base.revision(["frontend/"])
    except Exception as exc:
        log_erreur(f"Révision frontend non établie : {exc}")
        return False
    log(
        f"Révisions acceptées : {base.fusion[:10]} (merge) ou "
        f"{dernier_frontend[:10]} (dernier commit frontend sur {base.ref})"
    )

    cmd = [
        "node",
        "scripts/check-deployed-revision.js",
        "--attendu",
        base.fusion,
        "--sinon",
        dernier_frontend,
        "--tentatives",
        str(max(1, int(timeout_minutes * 60 / 20))),
        "--delai",
        "20",
    ]
    res = subprocess.run(
        cmd,
        cwd=str(FRONTEND_DIR),
        capture_output=False,
    )
    if res.returncode == 0:
        log_succes("Vercel production : Révision validée et servie !")
        return True
    else:
        log_erreur("Vercel production : Délais dépassé ou révision non servie.")
        return False


def verifier_seo_production_strict() -> bool:
    """La sonde SEO STRICTE de la production, verdict rendu dans le terminal.

    Elle est lancée APRÈS la confirmation de la révision servie, et c'est ce qui la
    rend lisible : la production vient d'être reconstatée comme servant ce commit,
    donc un écart de configuration `VITE_*` (ces variables sont INLINÉES au build par
    Vercel : une variable absente n'échoue nulle part, elle appauvrit le HTML) est
    attribuable à la livraison qui vient d'avoir lieu. Le cron de 06:17 ne le verrait
    que le lendemain, et le step de `frontend-build` qui lance cette MÊME commande sur
    le push de `main` n'est pas attendu par cette livraison.

    MÊME commande que la CI, sans variante : `--strict` est le seul mode qui BLOQUE
    (une intégration requise absente, ou une sonde qui ne peut pas conclure, sort en
    1). Le mode par défaut du script étant l'informatif, lancer celui-ci ici rendrait
    le silence de F9 possible dans le trajet de livraison ; c'est pourquoi
    `.github/scripts/check-seo-probe-strict.py` lit AUSSI ce fichier et refuse toute
    invocation hors `--strict`.

    La sortie est STREAMÉE (aucune capture) : le rapport du script, ses `::notice` et
    ses `::error` nommant l'intégration à corriger, s'affichent tels quels.
    """
    log("Contrôle SEO de la production (sonde stricte, même commande que la CI)...")
    res = subprocess.run(
        ["node", "scripts/check-seo-production.js", "--strict"],
        cwd=str(FRONTEND_DIR),
        capture_output=False,
    )
    if res.returncode == 0:
        log_succes("SEO production : sonde stricte verte.")
        return True
    log_erreur(
        f"SEO production : la sonde stricte a refusé (code {res.returncode}). Corriger "
        "l'intégration nommée ci-dessus (variable Vercel à poser, puis redéploiement) : "
        "c'est le même verdict que le cron de 06:17 et que le step de `frontend-build`."
    )
    return False


def verifier_production_backend(base: BaseDistante, timeout_minutes: int = 10) -> bool:
    log(f"Contrôle de la révision servie par FLY.IO (backend sur {URL_BACKEND_HEALTH})...")
    try:
        # MÊME base que le frontend : elle a été relue une seule fois, en amont.
        dernier_backend = base.revision(["backend/", ".github/workflows/ci.yml"])
    except Exception as exc:
        log_erreur(f"Révision backend non établie : {exc}")
        return False
    log(f"Révision backend attendue : {dernier_backend[:10]} (sur {base.ref})")

    cmd = [
        sys.executable,
        "backend/scripts/check_deployed_revision.py",
        "--attendu",
        dernier_backend,
        "--tentatives",
        str(max(1, int(timeout_minutes * 60 / 20))),
        "--delai",
        "20",
    ]
    res = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=False,
    )
    if res.returncode == 0:
        log_succes("Fly.io backend : Révision validée et servie !")
        return True
    else:
        log_erreur("Fly.io backend : Délais dépassé ou révision non servie.")
        return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--branche", help="Branche à livrer (défaut : branche courante)")
    parser.add_argument("--titre", help="Titre de la Pull Request")
    parser.add_argument("--corps", help="Corps de la Pull Request")
    parser.add_argument("--mode", choices=["squash", "merge", "rebase"], default="squash",
                        help="Méthode de fusion (défaut : squash)")
    parser.add_argument("--timeout-ci", type=int, default=25,
                        help="Délai max d'attente de la CI en minutes (défaut : 25)")
    parser.add_argument("--timeout-prod", type=int, default=10,
                        help="Délai max de confirmation production en minutes (défaut : 10)")
    parser.add_argument("--skip-push", action="store_true",
                        help="Ne pas pousser la branche git")
    parser.add_argument("--reprise-pr", type=int,
                        help="Numéro de PR existante à reprendre")
    parser.add_argument("--token", help="Jeton GitHub (ou variable GH_TOKEN / GITHUB_TOKEN)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simule sans effectuer de push, PR ou merge")

    options = parser.parse_args(argv)

    branche = options.branche or exec_cmd(["git", "branch", "--show-current"])
    if not branche:
        log_erreur("Impossible de déterminer la branche courante.")
        return 1

    if branche == "main":
        log_erreur("La politique du dépôt interdit de livrer directement depuis 'main'. Travaillez sur une branche dédiée.")
        return 1

    sha_local = exec_cmd(["git", "rev-parse", "HEAD"])
    log(f"Démarrage du trajet de livraison pour '{branche}' ({sha_local[:10]})...")

    # 0. L'arbre de travail, AVANT le jeton et le réseau : un refus local et
    # immédiat, qui ne dépend d'aucun accès GitHub.
    try:
        verifier_arbre_propre()
        log_succes("Arbre de travail propre (tout est commité).")
    except Exception as exc:
        log_erreur(str(exc))
        return 1

    try:
        jeton = obtenir_jeton(options.token)
    except Exception as exc:
        log_erreur(str(exc))
        return 1

    # 1. Pré-vol local
    try:
        verifier_prevol_local()
    except Exception as exc:
        return 1

    # 1 bis. Pré-vol du PÉRIMÈTRE DU GATE : la livraison n'attend que les checks
    # que la protection de 'main' exige, donc elle refuse de partir si le réglage
    # GitHub et la liste déclarée ne disent plus la même chose. En simulation
    # (`--dry-run`), la protection n'est pas relue (le trajet ne fusionnera rien) :
    # seul le verdict hors ligne est rendu, et c'est DIT.
    refus_gate = verifier_perimetre_du_gate(jeton, en_ligne=not options.dry_run)
    if refus_gate:
        log_erreur(f"Le périmètre du gate n'est pas aligné ({len(refus_gate)} refus) :")
        for ligne in refus_gate:
            print(f"   • {ligne}")
        log_erreur(
            "Livraison arrêtée : fusionner ici ferait passer la PR sous un gate qui n'est pas "
            "celui que la protection de 'main' applique. Corriger .github/scripts/gate-perimetre.json "
            "(ou le réglage GitHub), puis relancer."
        )
        return 1

    if options.dry_run:
        log("[DRY-RUN] Simulation terminée avec succès.")
        return 0

    # 2. Push de la branche
    if not options.skip_push:
        try:
            pousser_branche(branche, jeton)
        except Exception as exc:
            log_erreur(f"Échec du push : {exc}")
            return 1
    else:
        log("Étape push sautée (--skip-push).")

    # 3. PR (recherche ou création)
    try:
        pr = trouver_ou_creer_pr(branche, options.titre, options.corps, jeton, options.reprise_pr)
    except Exception as exc:
        log_erreur(f"Échec de l'étape PR : {exc}")
        return 1

    pr_number = pr["number"]
    pr_head_sha = pr["head"]["sha"]

    # 4. Attente des checks CI — ceux du périmètre déclaré, pas « tous les check-runs »
    attendus = noms_attendus(lire_perimetre()[0] or {})
    ok_ci = attendre_checks_ci(pr_head_sha, jeton, options.timeout_ci, attendus)
    if not ok_ci:
        log_erreur(f"La CI a échoué ou expiré sur la PR #{pr_number}. Fusion abandonnée.")
        return 1

    # 5. Fusion de la PR
    try:
        merge_sha = fusionner_pr(pr_number, pr_head_sha, options.mode, jeton)
    except Exception as exc:
        log_erreur(f"Échec de la fusion : {exc}")
        return 1

    # 6. Synchronisation locale
    try:
        synchroniser_et_nettoyer_local(branche)
    except Exception as exc:
        # Best-effort, et SANS conséquence sur le verdict : les révisions
        # attendues se lisent sur `origin/main` relu dans les deux confirmations.
        log_erreur(f"Erreur lors de la synchronisation locale : {exc}")

    # 7. Confirmation des révisions servies en production
    log("Vérification des déploiements réels en production...")
    # On attend quelques secondes que les déploiements Vercel/Fly soient initiés sur GitHub push
    time.sleep(5)

    # LA BASE DISTANTE SE LIT ICI, UNE FOIS, et sert aux DEUX confirmations.
    # Deux lectures séparées (une par surface) feraient deux `git fetch` pour un
    # seul fait, et surtout deux instants de mesure : un `main` qui avance entre
    # les deux rendrait les deux verdicts étrangers l'un à l'autre. Ici, les
    # deux surfaces sont jugées contre le MÊME état, et l'échec de la lecture
    # est UNE cause, nommée une fois.
    try:
        base = lire_base_distante(merge_sha)
        log_succes(f"Base distante relue : {base.ref} porte la fusion {merge_sha[:10]}.")
    except Exception as exc:
        base = None
        log_erreur(f"Base distante NON relue : {exc}")
        log(
            "Confirmations de production NON exécutées : sans base distante relue, "
            "aucun verdict ne peut être rattaché à la fusion qui vient d'avoir lieu."
        )

    ok_front = verifier_production_frontend(base, options.timeout_prod) if base else False

    # La sonde SEO stricte se lance JUSTE APRÈS la révision servie : elle juge le même
    # artefact que celle-ci vient de confirmer. Tant qu'elle n'est pas confirmée, la
    # lancer porterait le verdict sur une AUTRE production que celle qui vient d'être
    # livrée — on la saute donc, en le DISANT (un saut silencieux se lirait comme un vert).
    ok_seo = verifier_seo_production_strict() if ok_front else False
    if not ok_front:
        log(
            "Sonde SEO stricte NON exécutée : la révision servie n'est pas confirmée — "
            "la sonde porterait sur une autre production que celle qui vient d'être livrée."
        )

    ok_back = verifier_production_backend(base, options.timeout_prod) if base else False

    refus = [
        nom
        for nom, ok in (
            ("Vercel (révision servie)", ok_front),
            ("SEO strict (production)", ok_seo),
            ("Fly.io (révision servie)", ok_back),
        )
        if not ok
    ]
    if not refus:
        log_succes("Trajet de livraison COMPLET terminé avec succès !")
        log(
            f"PR #{pr_number} intégrée dans main ({merge_sha[:10]}). Production Vercel et "
            "Fly.io à jour, sonde SEO stricte verte."
        )
        return 0
    log_erreur(
        "La PR est fusionnée mais la confirmation de production a refusé ou expiré sur : "
        f"{', '.join(refus)}."
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
