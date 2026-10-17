#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LE PÉRIMÈTRE DU GATE EST-IL LE MÊME DES DEUX CÔTÉS ? (hors ligne, et en ligne sur demande)

Ce que ce garde juge, et pourquoi il existe. Deux chemins appliquent le même
gate : la protection de `main` (ce qu'une fusion par l'interface GitHub doit
attendre) et la livraison automatique (`.github/scripts/livrer.py`). Le
12/10/2026, ils ne jugeaient pas le même périmètre : la protection exigeait
HUIT checks nommés alors que `ci.yml` en déclarait ONZE, et la livraison
attendait, elle, TOUS les check-runs — y compris les trois que la protection
ignorait. Une fusion manuelle est donc passée avec la suite e2e rouge (15 rouges
/ 27 exécutions, dont un cas réel) et avec des avis de sécurité de PRODUCTION
non corrigés (6 rouges / 30 runs), quand le trajet de livraison refusait ces
mêmes runs.

La liste vit une seule fois (`.github/scripts/gate-perimetre.json`), et ce garde
rend le verdict HORS LIGNE :

  • chaque check déclaré doit correspondre à un job de `ci.yml` — par son
    identifiant ET par le NOM que GitHub rapportera (le nom d'un check-run est
    celui du job) : un nom qui a dérivé ferait attendre les deux périmètres un
    check-run qui n'arrivera jamais ;
  • tout job de `ci.yml` doit être soit déclaré, soit exempté AVEC son motif
    (≥ 40 caractères) : une liste qui ne couvre pas un job est une liste qui a
    oublié quelque chose ;
  • une exemption PÉRIMÉE (son job a disparu), une exemption qui est AUSSI
    déclarée comme check, un `strict` non déclaré : refusés ;
  • et il REFUSE DE CONCLURE sous ses planchers de lecture (8 checks, 10 jobs
    lus dans `ci.yml`), parce qu'un lecteur cassé rend tous ces refus muets.

Ce qu'il ne peut pas juger ici, et qui est écrit : la protection de branche
RÉELLE demande un accès admin au dépôt, que le jeton de la CI n'a pas — c'est
pourquoi la comparaison EN LIGNE (`--en-ligne`, avec `GH_TOKEN`) vit dans le
pré-vol de `livrer.py`, qui a le jeton du propriétaire, et reste disponible ici
pour un run manuel. Le garde hors ligne, lui, est une étape de `workflow-lint`
(un job requis) : un renommage de job qui n'aurait pas suivi dans la déclaration
rougit là, avant que la protection n'attende un nom disparu.

Usage :
    python3 .github/scripts/check-gate-perimetre.py                 # hors ligne (CI)
    GH_TOKEN=… python3 .github/scripts/check-gate-perimetre.py --en-ligne   # + GitHub
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Sortie terminal tolérante (cp1252 sous Windows, utf-8 sous le runner) : le
# garde publie des guillemets français et des flèches, jamais des mojibakes.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):  # repl Python sans reconfigure
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

from perimetre_gate import (  # noqa: E402  (import après l'insertion du chemin)
    LONGUEUR_MOTIF,
    PLANCHERS,
    comparer_protection,
    depot_du_remote,
    lire_perimetre,
    lire_protection,
    noms_attendus,
)


def main(argv: list[str] | None = None) -> int:
    analyseur = argparse.ArgumentParser(description="Vérifie le périmètre du gate (déclaration ↔ ci.yml ↔ protection).")
    analyseur.add_argument("--en-ligne", action="store_true", help="compare aussi la protection de branche RÉELLE")
    analyseur.add_argument("--jeton", default="", help="jeton GitHub (défaut : GH_TOKEN / GITHUB_TOKEN)")
    analyseur.add_argument("--depot", default="", help="propriétaire/nom (défaut : dérivé du remote origin)")
    analyseur.add_argument("--branche", default="main", help="branche protégée examinée (défaut : main)")
    options = analyseur.parse_args(argv)

    declaration, jobs, empechement = lire_perimetre()
    if declaration is None:
        print(f"[ECHEC] {empechement}")
        return 1

    attendus = noms_attendus(declaration)
    hors = declaration.get("hors_gate") or []
    print(
        f"Périmètre du gate : {len(attendus)} check(s) déclaré(s), {len(hors)} exemption(s), "
        f"strict={declaration.get('strict')} — planchers {PLANCHERS}"
    )
    for entree in declaration.get("checks") or []:
        print(f"  exigé   : « {entree.get('nom')} »  (job {entree.get('job')})")
    for entree in hors:
        motif = str(entree.get("motif") or "")
        print(f"  exempté : « {entree.get('nom')} »  (motif de {len(motif)} caractères, ≥ {LONGUEUR_MOTIF})")
    print(f"  → {len(jobs)} job(s) lu(s) dans ci.yml")

    refus = []
    if empechement:
        refus.append(empechement)
    else:
        from perimetre_gate import auditer  # noqa: E402  (même dossier)

        refus = auditer(declaration, jobs)

    if options.en_ligne:
        jeton = (options.jeton or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
        depot = options.depot or depot_du_remote()
        if not jeton:
            refus.append(
                "comparaison en ligne demandée sans jeton : poser GH_TOKEN (ou --jeton) — la "
                "protection de branche ne se lit pas sans accès admin, et conclure sans elle "
                "serait conclure sur la moitié du périmètre"
            )
        elif not depot:
            refus.append("dépôt introuvable : passer --depot propriétaire/nom (le remote origin n'a rien donné)")
        else:
            protection, empechement_ligne = lire_protection(jeton, depot, options.branche)
            if protection is None:
                # Un jeton qui ne peut pas lire la protection laisse la moitié en
                # ligne NON MESURÉE : c'est un refus nommé avec son remède, jamais
                # un vert qui n'a rien vérifié.
                refus.append(
                    empechement_ligne
                    + " — la protection de branche RÉELLE ne se lit qu'avec un jeton ayant "
                    "les droits admin du dépôt (GH_TOKEN) : sans elle, la moitié en ligne du "
                    "périmètre n'est pas mesurée"
                )
            else:
                exigences = (protection.get("required_status_checks") or {})
                print(
                    f"  protection de {options.branche} ({depot}) : "
                    f"{len(exigences.get('contexts') or [])} check(s) exigé(s), strict={exigences.get('strict')}"
                )
                refus.extend(comparer_protection(protection, declaration))

    if refus:
        print(f"\n❌ Périmètre du gate non tenu ({len(refus)} refus) :")
        for ligne in refus:
            print(f"  • {ligne}")
        print(
            "\n   → corriger .github/scripts/gate-perimetre.json, ou le job de ci.yml qui a "
            "dérivé, ou le réglage de protection de branche. Les deux périmètres doivent "
            "attendre EXACTEMENT les mêmes checks : une fusion par l'interface GitHub ne doit "
            "pas pouvoir passer là où la livraison automatique refuse."
        )
        return 1

    print(
        f"\n[OK] La déclaration, ci.yml et "
        f"{'la protection de ' + options.branche if options.en_ligne else 'le périmètre hors ligne'} "
        f"attendent les mêmes {len(attendus)} vérification(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
