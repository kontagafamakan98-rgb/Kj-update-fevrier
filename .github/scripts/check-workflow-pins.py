#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Garde-fou des références d'actions (`uses:`) dans .github/workflows/.

── Le défaut que ce garde existe pour empêcher ──────────────────────────────
Le 2026-08-27, le job `workflow-lint` est tombé **avant même de démarrer ses
étapes** :

    ##[error]Unable to resolve action `rhysd/actionlint@v1`, unable to find version `v1`

Une référence d'action est un contrat avec un dépôt EXTERNE : si le tag
n'existe pas (ou plus), le job ne peut pas être préparé — rouge d'infrastructure,
sans rapport avec le code du dépôt, et impossible à diagnostiquer depuis les
logs de nos propres étapes (elles n'ont jamais tourné).

Le même risque reste ouvert pour une référence sur une BRANCHE, qui suit le
travail amont sans revue : `superfly/flyctl-actions/setup-flyctl@master` était
dans cet état (documenté comme tel). Une branche peut être renommée, supprimée
ou réécrite ; un tag de version est stable, un SHA est immuable.

── Ce que ce garde vérifie ──────────────────────────────────────────────────
   1. chaque `uses:` est épinglé à un **tag de version** (`@v4`, `@v1.4`,
      `@v1.7.12`) ou à un **SHA de commit** (au moins 7 caractères
      hexadécimaux) ;
   2. aucune référence de BRANCHE (`@master`, `@main`, `@HEAD`, `@latest`,
      `@dependabot/…`) ;
   3. `./` (action locale) et `docker://` (image) ne sont pas concernés.

── Ce qu'il ne peut PAS prouver ─────────────────────────────────────────────
Le garde contrôle la **forme** de la référence, pas son existence : il ne
contacte pas les dépôts amont, donc un tag mal orthographié ou supprimé lui
échappe (c'est exactement le cas `actionlint@v1` ci-dessus, qui avait la bonne
forme). Un SHA reste la seule référence qu'aucune réécriture amont ne peut
déplacer.

Usage : python .github/scripts/check-workflow-pins.py [chemin_du_workflow]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

DEFAULT_WORKFLOW = Path(".github/workflows/ci.yml")

# `uses:` peut être une clé de step (`- uses: x`) ou d'un `with:` imbriqué.
USES_PATTERN = re.compile(r"^\s*(?:-\s*)?uses:\s*[\"']?([^\"'\s#]+)")

# Tag de version (`v4`, `1.6`, `v1.7.12`) : stable, mais peut bouger.
VERSION_TAG = re.compile(r"^v?\d+(?:\.\d+)*$")

# SHA de commit (7 à 40 hexadécimaux) : immuable.
COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{7,40}$")


def classify_reference(reference: str) -> tuple[bool, str]:
    """Classe une référence `uses:`.

    :param reference: valeur brute de `uses:` (ex. ``actions/checkout@v4``).
    :returns: ``(conforme, motif)`` — le motif explique le verdict.
    """
    if reference.startswith("./"):
        return True, "action locale"
    if reference.startswith("docker://"):
        return True, "image docker"
    if "@" not in reference:
        return False, "aucune référence (ni tag ni SHA) après « @ » attendu"
    _, ref = reference.rsplit("@", 1)
    if COMMIT_SHA.fullmatch(ref):
        return True, "SHA de commit (immuable)"
    if VERSION_TAG.fullmatch(ref):
        return True, "tag de version"
    return False, (
        f"référence de BRANCHE ou de tag flottant (« {ref} ») : une branche suit "
        "le travail amont sans revue et peut disparaître — épingle un tag de "
        "version ou, mieux, un SHA de commit"
    )


def check_workflow(path: Path) -> tuple[list[str], list[str]]:
    """Lit un workflow et rend ``(erreurs, références_conformes)``.

    Le fichier est lu **ligne à ligne**, volontairement : PyYAML n'est pas une
    dépendance du dépôt, et l'analyse demandée (une clé `uses:` par ligne) n'en
    a pas besoin.
    """
    errors: list[str] = []
    conforming: list[str] = []

    if not path.exists():
        return [f"{path} introuvable — le garde ne peut rien vérifier"], conforming

    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        match = USES_PATTERN.match(line)
        if not match:
            continue
        reference = match.group(1)
        ok, reason = classify_reference(reference)
        if ok:
            conforming.append(f"{path}:{lineno} {reference} ({reason})")
        else:
            errors.append(f"{path}:{lineno} {reference} — {reason}")
    return errors, conforming


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_WORKFLOW
    errors, conforming = check_workflow(path)

    if errors:
        print(f"[ECHEC] {len(errors)} référence(s) d'action non épinglée(s) :")
        for message in errors:
            print(f"   - {message}")
        print(
            "   Une référence non résoluble fait échouer le job AVANT ses étapes "
            "(cf. `actionlint@v1`, 2026-08-27) : rouge d'infrastructure, sans "
            "rapport avec le code."
        )
        return 1

    if not conforming:
        print(
            f"[ECHEC] aucune référence `uses:` trouvée dans {path} — "
            "un garde qui ne voit rien ne prouve rien (chemin ou format modifié ?)"
        )
        return 1

    print(f"[OK] {len(conforming)} référence(s) d'action épinglée(s) dans {path} :")
    for message in conforming:
        print(f"   - {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
