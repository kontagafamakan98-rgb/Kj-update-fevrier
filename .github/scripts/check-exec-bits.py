#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérifie que les fichiers exécutés directement par la CI sont exécutables.

Le job `mobile-build` lance `./gradlew assembleDebug`. Le bit exécutable de
`gradlew` est porté par GIT (mode 100755 sur frontend/android/gradlew, commit
dcb4e43) et non par le système de fichiers d'un poste de développement : c'est
le checkout du runner Linux qui le matérialise. Si ce mode est perdu — un
`git add` depuis une machine Linux après un `chmod -x`, un outil qui réécrit le
fichier, une normalisation d'index… — le job échoue sur « Permission denied »,
mais seulement au step APK : mesuré sur le run 35137466972, ce step ne démarre
qu'à +39 s du job (Node, npm ci, build web, cap sync, Java 21, SDK Android) et
le build Gradle dure ensuite ~95 s. Le message, lui, ne dit pas que la cause est
un mode git.

Ce script tourne en 0,17 s (mesuré), en PREMIER step du job, et sépare trois
pannes distinctes — parce qu'elles ont trois corrections différentes :

  1. mode git != 100755 : le bit est perdu DANS GIT, la source durable.
     Correction : `git update-index --chmod=+x frontend/android/gradlew`.
  2. mode git correct mais fichier non exécutable après checkout : le runner
     n'a pas matérialisé le mode (environnement inhabituel, pas le dépôt).
  3. shebang absent ou terminé par un CR (fins de ligne CRLF) : l'exécution
     échouera MÊME avec le bit, le noyau cherchant l'interpréteur « /bin/sh\\r ».
     Correction : les règles `eol=lf` de .gitattributes.

Un garde qui ne peut pas conclure (git absent, fichier non suivi) ÉCHOUE : il ne
doit jamais passer en silence, sinon il ne prouve rien.

Usage : python3 .github/scripts/check-exec-bits.py [--repo-root CHEMIN]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

# Fichiers lancés directement par le workflow (préfixe « ./ »), donc dont le bit
# exécutable est une propriété REQUISE — pas un détail d'outillage. Les scripts
# invoqués via `bash script.sh` ou `python script.py` n'ont pas à figurer ici :
# leur mode n'a aucune influence sur leur exécution.
REQUIRED_EXECUTABLE = ("frontend/android/gradlew",)

# Mode attendu dans l'index git : la source durable, que le checkout d'un runner
# Linux restitue tel quel.
EXECUTABLE_MODE = "100755"

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[2]


def _make_output_utf8():
    """Rend la sortie tolérante à une console non-UTF-8.

    Découvert en vrai : le premier chemin de succès de ce script terminait par un
    emoji, et sous un console cp1252 (Windows) le print levait UnicodeEncodeError
    — le garde « plantait » donc au lieu de conclure, avec un code de sortie 1 qui
    ressemblait à un échec de vérification. Un contrôle qui ne peut pas conclure
    est pire qu'inutile.

    Le runner GitHub est en UTF-8, mais dépendre de la locale d'exécution pour un
    check REQUIS est une fragilité gratuite. `hasattr` est nécessaire : pytest
    remplace sys.stdout par un objet sans `reconfigure`.
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):  # pragma: no cover - dépend du flux
                pass


def git_index_mode(repo_root, rel_path, run=None):
    """Mode enregistré dans l'index git pour un chemin.

    Retourne ``(mode, erreur)``. ``mode`` vaut None si le fichier n'est pas suivi
    par git ; ``erreur`` est renseignée si git n'a pas pu répondre du tout (git
    absent, dépôt invalide) — cas que l'appelant doit traiter comme un échec, pas
    comme un succès silencieux.

    ``run`` est injectable (tests) : par défaut ``subprocess.run``.
    """
    runner = run or subprocess.run
    try:
        proc = runner(
            ["git", "-C", str(repo_root), "ls-files", "-s", "--", rel_path],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return None, "git est introuvable dans le PATH — impossible de lire le mode enregistré"
    except OSError as exc:  # pragma: no cover - dépend de l'environnement
        return None, f"exécution de git impossible ({exc})"

    # `git ls-files` retourne 0 même quand le chemin n'est pas suivi (sortie
    # vide) : un code non nul signale donc un vrai problème de dépôt.
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        return None, f"git ls-files a échoué : {detail[0] if detail else 'raison inconnue'}"

    out = (proc.stdout or "").strip()
    if not out:
        return None, None
    return out.split()[0], None


def shebang_error(data):
    """Retourne le message d'erreur du shebang, ou None s'il est exploitable.

    La ligne complète est inspectée volontairement : un shebang correct suivi
    d'un CR (fichier en CRLF) est exactement la panne « bad interpreter » qui
    échoue à l'exécution alors que le bit, lui, est présent.
    """
    if not data.startswith(b"#!"):
        return (
            "le fichier ne commence pas par un shebang (#!) : il ne peut pas être "
            "exécuté directement"
        )
    first_line = data.split(b"\n", 1)[0]
    if first_line.endswith(b"\r"):
        return (
            "le shebang se termine par un CR (fichier en CRLF) : le noyau cherchera "
            "l'interpréteur « /bin/sh\\r » et l'exécution échouera même avec le bit "
            "exécutable — les règles eol=lf de .gitattributes doivent être conservées"
        )
    return None


def check_path(repo_root, rel_path, is_executable=None, run=None):
    """Contrôle un chemin et retourne ``(erreurs, information)``.

    ``erreurs`` est une liste de messages ; ``information`` la ligne de succès
    (None s'il y a au moins une erreur).

    ``is_executable`` et ``run`` sont injectables : Windows n'a pas de bit
    exécutable sur son système de fichiers, et un test doit pouvoir simuler
    « mode git correct, fichier non exécutable après checkout » sans dépendre de
    la plateforme.
    """
    probe = is_executable or (lambda p: os.access(p, os.X_OK))
    target = Path(repo_root) / rel_path
    if not target.is_file():
        return ([f"{rel_path} est absent du dépôt"], None)

    errors = []
    mode, git_error = git_index_mode(repo_root, rel_path, run=run)

    if git_error:
        errors.append(git_error)
    elif mode is None:
        errors.append(
            f"{rel_path} n'est pas suivi par git : le mode exécutable ne peut pas être "
            f"transmis au checkout — ajoute-le avec les règles .gitattributes"
        )
    elif mode != EXECUTABLE_MODE:
        errors.append(
            f"mode {mode} dans git au lieu de {EXECUTABLE_MODE} : le bit exécutable est "
            f"perdu, corrige-le avec « git update-index --chmod=+x {rel_path} »"
        )

    if not probe(target):
        errors.append(
            f"{rel_path} n'est pas exécutable après le checkout (mode git {mode or 'inconnu'}) : "
            f"c'est le checkout qui n'a pas matérialisé le bit, pas le dépôt qui l'a perdu"
        )

    shebang = shebang_error(target.read_bytes())
    if shebang:
        errors.append(f"{rel_path} : {shebang}")

    if errors:
        return (errors, None)
    return ([], f"OK {rel_path} — mode git {mode}, exécutable, shebang exploitable")


def main(argv=None):
    """Point d'entrée CLI. Retourne 0 si tous les chemins sont exploitables."""
    parser = argparse.ArgumentParser(description="Contrôle des bits exécutables requis par la CI.")
    parser.add_argument(
        "--repo-root",
        default=str(DEFAULT_REPO_ROOT),
        help="racine du dépôt (contient .git) — injectable pour les tests",
    )
    args = parser.parse_args(argv)

    _make_output_utf8()
    errors = []
    print(f"Bits exécutables requis par la CI ({args.repo_root}) :")
    for rel_path in REQUIRED_EXECUTABLE:
        path_errors, info = check_path(args.repo_root, rel_path)
        if info:
            print(f"   {info}")
        errors.extend((rel_path, message) for message in path_errors)

    if errors:
        print("", file=sys.stderr)
        for rel_path, message in errors:
            # Annotation GitHub : l'erreur s'affiche sur la ligne concernée dans
            # l'onglet « Files changed », là où elle est actionnable.
            print(f"::error file={rel_path}::{message}", file=sys.stderr)
        print(
            f"\n[ECHEC] {len(errors)} problème(s) : le job mobile échouerait sur "
            f"« Permission denied » au step APK, après l'installation de Node, "
            f"Java 21 et du SDK Android.",
            file=sys.stderr,
        )
        return 1

    # Marqueurs ASCII uniquement (convention des autres scripts CI du dépôt) :
    # un emoji hors cp1252 ferait planter la sortie sur un poste Windows.
    print(f"[OK] {len(REQUIRED_EXECUTABLE)} chemin(s) vérifié(s) : exécutables directement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
