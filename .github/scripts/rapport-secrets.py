#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rend le VERDICT d'un rapport gitleaks — et refuse de conclure sans mesure.

── Pourquoi ce script, et pas `gitleaks --exit-code 1` ─────────────────────
Un scanner qui sort en 1 sur un constat ne dit pas au développeur OÙ regarder,
ni ce qui a été jugé. Ce script lit le rapport JSON produit par gitleaks et
publie une annotation par constat (fichier, ligne, règle) — la surface où un
auteur de PR corrige effectivement — puis sort en 1. Il ne publie JAMAIS la
valeur trouvée : le rapport est produit avec `--redact`, et le message ne
reprend que la règle et le chemin.

── Trois sorties, jamais deux ──────────────────────────────────────────────
    0 = rapport lu, aucun constat ;
    1 = au moins un constat (bloquant) ;
    2 = PRÉMISSE : le rapport manque, n'est pas du JSON, n'a pas la forme
        attendue, ou le scanner n'a lu AUCUN commit alors qu'il y en avait à
        lire. Un vert qui n'a rien mesuré est exactement le silence que le
        dépôt refuse ailleurs (sondes de production, corpus vide) : ici il
        prend la forme d'une plage de commits mal calculée, qui scannera zéro
        commit et paraîtra propre.

── Ce qu'il ne juge pas ────────────────────────────────────────────────────
Il ne relance pas gitleaks et ne connaît pas ses règles : il juge le RAPPORT.
Un scanner qui n'aurait pas tourné est détecté par l'absence de journal, jamais
par une supposition.

Usage :
    python3 .github/scripts/rapport-secrets.py --rapport rapport.json \\
        [--journal gitleaks.log] [--commits-attendus N]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Sortie terminal tolérante (cp1252 sous Windows, utf-8 sous le runner) : les
# messages portent des accents et des annotations, jamais des mojibakes — et un
# `UnicodeEncodeError` sur un poste Windows ferait sortir en 1 (donc « secret
# trouvé ») au lieu de rendre le verdict.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):  # repli Python sans reconfigure
    pass

MOTIF_DEFINITIONS_URL = "https://github.com/gitleaks/gitleaks#configuration"

# Le nombre de constats annotés séparément : au-delà, une ligne de synthèse
# (une PR qui publie 200 clés n'a pas besoin de 200 annotations pour être
# comprise, et les annotations ont un coût d'affichage réel).
MAX_ANNOTATIONS = 50

# gitleaks écrit « 12 commits scanned. » sur son journal (INF). Le motif est lu,
# jamais supposé : c'est la seule preuve que la plage a été parcourue.
COMMITS_SCANNES = re.compile(r"(\d+)\s+commits?\s+scanned", re.IGNORECASE)


def _echapper_donnees(valeur: str) -> str:
    """Échappement des annotations GitHub (`::error::`)."""
    return (
        valeur.replace("%", "%25")
        .replace("\r", "%0D")
        .replace("\n", "%0A")
    )


def _echapper_propriete(valeur: str) -> str:
    """Échappement des PROPRIÉTÉS (`file=`, `line=`, `title=`) d'une annotation."""
    return _echapper_donnees(valeur).replace(":", "%3A").replace(",", "%2C")


def lire_rapport(chemin: Path) -> list[dict]:
    """Lit le rapport JSON. Lève ValueError sur toute forme inattendue.

    Un rapport ABSENT n'est pas un rapport vide : gitleaks n'écrit son fichier
    que s'il a tourné jusqu'au bout, donc « pas de fichier » = « pas de
    verdict ». La distinction est ici, pas chez l'appelant.
    """
    if not chemin.is_file():
        raise ValueError(
            f"rapport introuvable : {chemin} — le scanner n'a rien rendu, "
            "donc il n'y a pas de verdict (ni vert ni rouge)"
        )
    try:
        contenu = json.loads(chemin.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"rapport illisible ({exc}) : {chemin}") from exc
    if contenu is None:
        # JSON `null` : gitleaks a écrit un fichier sans tableau. Refusé plutôt
        # que normalisé en « aucun constat », qui serait un vert inventé.
        raise ValueError(f"rapport vide (JSON `null`) : {chemin}")
    if not isinstance(contenu, list):
        raise ValueError(f"rapport de forme inattendue (attendu : liste) : {chemin}")
    for constat in contenu:
        if not isinstance(constat, dict) or "File" not in constat or "RuleID" not in constat:
            raise ValueError(f"constat de forme inattendue dans {chemin} : {constat!r}")
    return contenu


def compter_commits(chemin: Path) -> int | None:
    """Commits lus par gitleaks, d'après son journal — `None` si illisible."""
    if not chemin.is_file():
        return None
    try:
        texte = chemin.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    occurrences = COMMITS_SCANNES.findall(texte)
    if not occurrences:
        return None
    return int(occurrences[-1])


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description="Verdict d'un rapport gitleaks.")
    analyseur.add_argument("--rapport", required=True, help="rapport JSON produit par gitleaks")
    analyseur.add_argument("--journal", default="", help="journal du scan (pour le nombre de commits lus)")
    analyseur.add_argument(
        "--commits-attendus",
        type=int,
        default=0,
        help="nombre de commits que la plage devait contenir (0 = non mesuré)",
    )
    options = analyseur.parse_args(argv)

    try:
        constats = lire_rapport(Path(options.rapport))
    except ValueError as exc:
        print(f"::error title=Scan de secrets sans verdict::{_echapper_donnees(str(exc))}")
        return 2

    # ── La plage a-t-elle été PARCOURUE ? ───────────────────────────────────
    # Une plage mal calculée (`origin/main...HEAD` sur un clone sans la branche
    # de base, un SHA d'avant-réception vide) ne produit aucune erreur : git
    # rend zéro commit, gitleaks rend zéro constat, et le job serait vert en
    # n'ayant rien jugé. L'attendu vient de `git rev-list --count`, jamais d'une
    # constante ; le lu vient du journal de gitleaks, jamais d'une supposition.
    if options.commits_attendus > 0:
        lus = compter_commits(Path(options.journal)) if options.journal else None
        if lus is None:
            print(
                "::error title=Scan de secrets sans verdict::"
                + _echapper_donnees(
                    f"{options.commits_attendus} commit(s) à juger, mais le journal du scan "
                    f"est illisible ou ne dit aucun commit lu ({options.journal or 'aucun journal'}) "
                    "— la plage n'est pas prouvée parcourue"
                )
            )
            return 2
        if lus == 0:
            print(
                "::error title=Scan de secrets sans verdict::"
                + _echapper_donnees(
                    f"la plage comptait {options.commits_attendus} commit(s) et le scanner "
                    "en a lu 0 — un vert qui n'a rien mesuré (plage ou clone incomplet)"
                )
            )
            return 2
        print(f"Commits lus : {lus} (plage de {options.commits_attendus}).")

    if not constats:
        print("Aucun secret détecté dans la plage jugée.")
        return 0

    print(
        f"{len(constats)} constat(s) — chaque ligne est bloquante. "
        f"Règles et exceptions : {MOTIF_DEFINITIONS_URL}"
    )
    for constat in constats[:MAX_ANNOTATIONS]:
        fichier = str(constat.get("File") or "(fichier inconnu)")
        ligne = constat.get("StartLine") or 0
        regle = str(constat.get("RuleID") or "regle-inconnue")
        description = str(constat.get("Description") or "").strip()
        commit = str(constat.get("Commit") or "")[:8]
        message = (
            f"{description or regle} — commit {commit or 'inconnu'}. "
            "Aucune valeur n'est publiée : retirer le secret du commit, le RÉVOQUER "
            "s'il a été publié, et ajouter une exception MOTIVÉE dans .gitleaks.toml "
            "si c'est une fixture (chemin, commits et règle, jamais une valeur)."
        )
        proprietes = (
            f"file={_echapper_propriete(fichier)},line={int(ligne)},"
            f"title=Secret détecté ({_echapper_propriete(regle)})"
        )
        print(f"::error {proprietes}::{_echapper_donnees(message)}")
    if len(constats) > MAX_ANNOTATIONS:
        print(
            f"::error title=Scan de secrets::"
            f"{len(constats) - MAX_ANNOTATIONS} constat(s) supplémentaire(s), non annotés un par un."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
