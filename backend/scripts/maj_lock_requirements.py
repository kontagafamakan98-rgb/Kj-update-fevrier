# -*- coding: utf-8 -*-
"""Régénère `backend/requirements.lock` — les PINS et les EMPREINTES.

POURQUOI CE SCRIPT

`requirements.txt` dit l'INTENTION (des plages de versions, relues à la main) ;
`requirements.lock` dit ce qui est RÉELLEMENT installé, distribution par
distribution, avec l'empreinte SHA-256 de CHAQUE fichier publié sur PyPI. C'est
le lock que `pip install --require-hashes` consomme (Dockerfile, CI, README) :
un dépôt PyPI compromis ou un fichier remplacé entre deux déploiements rougit à
l'installation, au lieu de s'installer en silence.

POURQUOI PAS `pip-compile`

`pip-compile --generate-hashes` fait la même chose, et c'est l'outil que ce
script remplace ici pour une raison précise : il RÉSOUT avec backtracking, ce
qui prend des minutes sur des plages larges (`pydantic>=2.0.0,<3.0.0`) et l'a
rendu inutilisable sur le poste de mise à jour. Le résolveur, ici, c'est `pip`
lui-même : on installe `requirements.txt` (ce que la CI fait déjà) et on fige le
résultat. Ce qui est figé est donc ce que l'installation PRODUIT, pas ce qu'un
second résolveur aurait choisi — la même source de vérité que le déploiement.

CE QUE FONT LES ÉTAPES, ET POURQUOI CHACUNE

  1. `pip freeze` de l'interpréteur COURANT : la liste exacte des distributions
     installées. Une ligne qui n'est pas un pin (`==`) est un REFUS, jamais un
     silence : un lock qui perd une dépendance au passage ne protège rien.
  2. L'API JSON de PyPI, par distribution : `urls[]` porte le SHA-256 de CHAQUE
     fichier publié (wheel par plateforme ET sdist). On les prend TOUS : un lock
     qui ne porterait que le wheel de la machine de génération casserait sur
     l'autre (Linux en CI, Windows en local) — et `--require-hashes` compare le
     fichier qu'il TÉLÉCHARGE, pas celui qu'on avait en tête.
  3. Écriture triée, une ligne `nom==version` + une ligne par empreinte.

Un pin dont PyPI ne publie aucun fichier est un REFUS : il n'y a alors rien à
vérifier, et l'écrire quand même donnerait un lock qui a l'air complet.

USAGE

    cd backend
    python -m pip install -r requirements.txt      # l'environnement à figer
    python scripts/maj_lock_requirements.py        # écrit requirements.lock

Le fichier produit est ensuite consommé par `pip install --require-hashes`.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

BACKEND = Path(__file__).resolve().parents[1]
LOCK_PATH = BACKEND / "requirements.lock"

# Distributions qu'on ne fige PAS : pip et les outils d'amorçage de venv ne sont
# pas des dépendances du produit, et un lock qui les épinglerait empêcherait de
# mettre à jour pip (le seul outil qui installe ce lock).
EXCLUS = ("pip", "setuptools", "wheel")
EN_TETE = "# -*- coding: utf-8 -*-"


def _normaliser(nom: str) -> str:
    """Nom de distribution normalisé (PEP 503), pour trier et comparer."""
    return nom.strip().lower().replace("_", "-").replace(".", "-")


def freeze() -> List[Tuple[str, str]]:
    """Pins de l'environnement courant : (nom, version). REFUS si non pin."""
    sortie = subprocess.run(
        [sys.executable, "-m", "pip", "freeze", "--exclude", *EXCLUS],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    pins: List[Tuple[str, str]] = []
    for ligne in sortie.splitlines():
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#"):
            continue
        if "==" not in ligne or ligne.count("==") != 1:
            raise SystemExit(
                f"[REFUS] ligne `pip freeze` qui n'est pas un pin : {ligne!r} — "
                "un lock ne peut pas figer une plage, une URL ou un chemin local."
            )
        nom, version = ligne.split("==", 1)
        pins.append((nom.strip(), version.strip()))
    if not pins:
        raise SystemExit("[REFUS] `pip freeze` n'a rendu aucun pin : rien à figer.")
    return pins


def empreintes(nom: str, version: str) -> List[str]:
    """SHA-256 de tous les fichiers publiés pour cette distribution."""
    url = f"https://pypi.org/pypi/{nom}/{version}/json"
    try:
        with urllib.request.urlopen(url, timeout=30) as reponse:
            donnees = json.load(reponse)
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"[REFUS] {nom}=={version} introuvable sur PyPI ({exc.code}) : un pin "
            "absent de l'index ne peut pas être vérifié."
        ) from exc
    fichiers = donnees.get("urls") or (donnees.get("releases") or {}).get(version) or []
    hashes = sorted(
        {
            f.get("digests", {}).get("sha256")
            for f in fichiers
            if f.get("digests", {}).get("sha256")
        }
    )
    if not hashes:
        raise SystemExit(
            f"[REFUS] {nom}=={version} n'a aucun fichier ni empreinte sur PyPI : "
            "l'écrire donnerait un lock qui a l'air complet."
        )
    return hashes


def _lignes(nom: str, version: str, hashes: Iterable[str]) -> List[str]:
    hashes = list(hashes)
    lignes = [f"{nom}=={version} \\"]
    for index, empreinte in enumerate(hashes):
        fin = " \\" if index < len(hashes) - 1 else ""
        lignes.append(f"    --hash=sha256:{empreinte}{fin}")
    return lignes


def main() -> int:
    pins = freeze()
    triees = sorted(pins, key=lambda couple: _normaliser(couple[0]))
    vus = [_normaliser(nom) for nom, _ in triees]
    doublons = sorted({nom for nom in vus if vus.count(nom) > 1})
    if doublons:
        raise SystemExit(f"[REFUS] distributions en double dans le freeze : {doublons}")

    lignes: List[str] = [
        EN_TETE,
        "# Lock des dépendances backend — PINS + EMPREINTES SHA-256.",
        "#",
        "# NE PAS ÉDITER À LA MAIN. Régénérer avec :",
        "#     cd backend && python -m pip install -r requirements.txt \\",
        "#         && python scripts/maj_lock_requirements.py",
        "# puis vérifier que `python -m pip install --require-hashes -r",
        "# requirements.lock` passe. Le fichier est CONSOMMÉ par le Dockerfile, la",
        "# CI et le README : c'est `requirements.txt` (les plages, l'intention) qui se",
        "# relit à la main, jamais celui-ci.",
        "#",
        f"# Relevé : {date.today():%d/%m/%Y} — Python 3.11 (Dockerfile, CI).",
        f"# {len(triees)} distribution(s), chacune avec l'empreinte de tous ses fichiers.",
        "",
    ]
    for nom, version in triees:
        lignes.extend(_lignes(nom, version, empreintes(nom, version)))
        lignes.append("")

    LOCK_PATH.write_text("\n".join(lignes).rstrip() + "\n", encoding="utf-8", newline="\n")
    total = sum(1 for ligne in lignes if "--hash=sha256:" in ligne)
    try:
        affiche = LOCK_PATH.relative_to(BACKEND)
    except ValueError:  # lock redirigé hors du dépôt (test, poste de mesure)
        affiche = LOCK_PATH
    print(f"[OK] {affiche} : {len(triees)} distributions, {total} empreintes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
