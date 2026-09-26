#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trajet complet de livraison automatisé — Kojo.

Enchaîne sans rupture :
  1. Pré-vol local (check-test-environment --avant-push, branches propres)
  2. Push de la branche de travail courante vers origin (sans fuite de secret)
  3. Détection ou ouverture de la Pull Request sur GitHub
  4. Attente active de tous les checks requis de la CI sur le commit de tête
  5. Fusion de la PR (méthode configurable : squash ou merge, défaut squash)
  6. Élagage et synchronisation locale (suppression de la branche de travail fusionnée)
  7. Attente et confirmation formelle des révisions servies en production :
     - Vercel (frontend) : balise meta `kojo-build-revision` sur https://kojoforafrica.cc.cd
     - Fly.io (backend)  : endpoint `/health` sur https://api.kojoforafrica.cc.cd/health

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


def attendre_checks_ci(sha: str, jeton: str, timeout_minutes: int = 25) -> bool:
    log(f"Surveillance des checks CI sur le commit de tête {sha[:10]}...")
    deadline = time.time() + (timeout_minutes * 60)
    derniers_etats = {}

    while time.time() < deadline:
        data = appel_github("GET", f"commits/{sha}/check-runs?per_page=100", jeton)
        runs = data.get("check_runs", [])
        if not runs:
            log("En attente de l'enregistrement des check-runs par GitHub...")
            time.sleep(10)
            continue

        total = len(runs)
        termines = []
        en_cours = []
        echoues = []

        for r in sorted(runs, key=lambda x: x["name"]):
            nom = r["name"]
            statut = r["status"]
            conclusion = r.get("conclusion")
            derniers_etats[nom] = f"{statut} / {conclusion}"

            if statut == "completed":
                if conclusion in ("success", "skipped", "neutral"):
                    termines.append(nom)
                else:
                    echoues.append((nom, conclusion, r.get("html_url")))
            else:
                en_cours.append(nom)

        # Rapport de progression si changements
        log(f"Progression CI : {len(termines)}/{total} terminés, {len(en_cours)} en cours, {len(echoues)} échec(s)")

        if echoues:
            log_erreur(f"Un ou plusieurs checks CI ont échoué ({len(echoues)}) :")
            for nom, conc, url in echoues:
                print(f"   - {nom} : {conc} ({url})")
            return False

        if len(termines) == total and total > 0:
            log_succes(f"Tous les {total} checks CI sont passés au vert (ou skipped attendu) !")
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


def verifier_production_frontend(sha_attendu: str, timeout_minutes: int = 10) -> bool:
    log(f"Contrôle de la révision servie par VERCEL (frontend sur {URL_FRONTEND_PROD})...")
    # Calculer également la révision dernier commit frontend si pertinent
    dernier_frontend = exec_cmd(["git", "rev-list", "-1", "HEAD", "--", "frontend/"])
    log(f"Révisions acceptées : {sha_attendu[:10]} (merge) ou {dernier_frontend[:10]} (dernier commit frontend)")

    cmd = [
        "node",
        "scripts/check-deployed-revision.js",
        "--attendu",
        sha_attendu,
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


def verifier_production_backend(sha_attendu: str, timeout_minutes: int = 10) -> bool:
    log(f"Contrôle de la révision servie par FLY.IO (backend sur {URL_BACKEND_HEALTH})...")
    dernier_backend = exec_cmd(["git", "rev-list", "-1", "HEAD", "--", "backend/", ".github/workflows/ci.yml"])
    log(f"Révision backend attendue : {dernier_backend[:10]}")

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

    # 4. Attente des checks CI
    ok_ci = attendre_checks_ci(pr_head_sha, jeton, options.timeout_ci)
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
        log_erreur(f"Erreur lors de la synchronisation locale : {exc}")

    # 7. Confirmation des révisions servies en production
    log("Vérification des déploiements réels en production...")
    # On attend quelques secondes que les déploiements Vercel/Fly soient initiés sur GitHub push
    time.sleep(5)

    ok_front = verifier_production_frontend(merge_sha, options.timeout_prod)
    ok_back = verifier_production_backend(merge_sha, options.timeout_prod)

    if ok_front and ok_back:
        log_succes("Trajet de livraison COMPLET terminé avec succès !")
        log(f"PR #{pr_number} intégrée dans main ({merge_sha[:10]}). Production Vercel et Fly.io à jour.")
        return 0
    else:
        log_erreur("La PR est fusionnée mais la confirmation de production a rencontré un refus ou un délai.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
