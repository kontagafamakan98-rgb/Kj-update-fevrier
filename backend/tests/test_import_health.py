# -*- coding: utf-8 -*-
"""Santé d'import : TOUT module du dépôt s'importe, en un seul endroit.

Pourquoi ce test existe
-----------------------
Six suites de tests faisaient chacune `assert SCRIPT.exists()`, puis chargeaient
le fichier par `importlib` — vérifier qu'un fichier est sur le disque au lieu de
vérifier qu'il tient debout. Une assertion d'existence ne voit ni un import
cassé, ni un nom retiré, ni un module renommé ailleurs que dans son propre test :
le 2026-08-27, un `NameError: name 'urlparse' is not defined` a atteint la
production alors que tous les fichiers existaient (test_split_integrity.py).

Ce test fait ce que les assertions d'existence ne faisaient pas : il IMPORTE
chaque module, et nomme celui qui ne s'importe plus avec l'erreur exacte.

Périmètre
---------
- les modules du paquet backend (backend/*.py), importés PAR LEUR NOM (donc le
  même objet que celui déjà chargé : aucun second exemplaire de `server` ou de
  la connexion Motor) ;
- les scripts hors paquet (backend/scripts/*.py, .github/scripts/*.py), dont le
  nom de fichier n'est pas un identifiant Python, chargés par chemin.

Ce qui n'est PAS importé, volontairement : les fichiers de tests (les importer
réenregistrerait leurs tests dans ce processus) et les paquets de site-packages
(leur santé n'est pas la nôtre — la suite fonctionnelle s'en charge).

Le pendant frontend vit dans frontend/scripts/__tests__/import-health.test.js :
les deux moitiés du dépôt ont le même garde, et la même preuve de non-vacuité.
"""
import importlib
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

# Modules du paquet : importables par leur nom (backend/ est sur sys.path).
NAMED_MODULES = sorted(path.stem for path in BACKEND_DIR.glob("*.py"))

# Scripts hors paquet : chargés par chemin (leur nom n'est pas un identifiant).
PATH_MODULES = sorted(
    [
        *BACKEND_DIR.glob("scripts/*.py"),
        *sorted((REPO_ROOT / ".github" / "scripts").glob("*.py")),
    ]
)

def build_targets():
    """Renvoie [(étiquette, callable qui importe)] pour chaque module du périmètre."""
    targets = [
        (f"backend/{name}.py", lambda name=name: importlib.import_module(name))
        for name in NAMED_MODULES
    ]
    targets += [
        (str(path.relative_to(REPO_ROOT)).replace("\\", "/"), lambda path=path: _load_by_path(path))
        for path in PATH_MODULES
    ]
    return targets


def _load_by_path(path):
    """Charge un script par chemin, comme le font les tests qui le pilotent."""
    name = f"_import_health_{path.stem.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def import_failures(targets=None):
    """[(étiquette, message d'erreur)] pour chaque module qui ne s'importe pas.

    Les échecs sont RASSEMBLÉS au lieu d'interrompre le parcours : une seule
    exécution doit nommer tous les modules cassés, pas seulement le premier.
    """
    failures = []
    for label, load in targets if targets is not None else build_targets():
        try:
            load()
        except BaseException as exc:  # noqa: BLE001 — toute panne d'import compte
            failures.append((label, f"{type(exc).__name__}: {exc}"))
    return failures


def assert_imports_healthy(failures):
    """Refuse une liste d'échecs en nommant chaque module et son erreur."""
    assert not failures, (
        "module(s) qui ne s'importent plus :\n"
        + "\n".join(f"  • {label}\n    {message}" for label, message in failures)
    )


def test_le_perimetre_est_reellement_decouvert():
    """Non-vacuité de la DÉCOUVERTE.

    Un globbing cassé (mauvais chemin, mauvaise extension) rendrait le test
    principal vert en n'important rien : c'est le seul faux vert que ce garde
    peut produire, donc il est refusé ici.
    """
    assert len(NAMED_MODULES) >= 20, (
        f"modules backend découverts : {NAMED_MODULES} — le globbing est cassé, "
        "donc le test d'import ne prouverait rien"
    )
    assert "kojo_core" in NAMED_MODULES and "server" in NAMED_MODULES
    labels = [label for label, _ in build_targets()]
    for attendu in (
        "backend/scripts/dmarc_policy.py",
        ".github/scripts/check-email-auth.py",
        ".github/scripts/check-exec-bits.py",
        ".github/scripts/check-fly-env-drift.py",
        ".github/scripts/check-workflow-pins.py",
    ):
        assert attendu in labels, f"{attendu} n'est pas dans le périmètre importé"


def test_tous_les_modules_s_importent():
    """Le garde lui-même : chaque module du périmètre s'importe, ou on le dit."""
    assert_imports_healthy(import_failures())


def test_le_garde_echoue_quand_un_module_ne_s_importe_plus(tmp_path):
    """Non-vacuité : un module cassé fait bien ROUGIR le garde.

    Un dossier de production réel ne contient pas de module cassé — donc sans ce
    test, rien ne prouverait que `import_failures` sait échouer plutôt que de
    retourner une liste vide.
    """
    casse = tmp_path / "module_casse.py"
    casse.write_text("import paquet_qui_n_existe_pas\n", encoding="utf-8")
    sain = tmp_path / "module_sain.py"
    sain.write_text("VALEUR = 1\n", encoding="utf-8")

    failures = import_failures(
        [(str(sain), lambda p=sain: _load_by_path(p)), (str(casse), lambda p=casse: _load_by_path(p))]
    )

    assert [label for label, _ in failures] == [str(casse)]
    assert "ModuleNotFoundError" in failures[0][1]
    with pytest.raises(AssertionError) as captured:
        assert_imports_healthy(failures)
    assert "paquet_qui_n_existe_pas" in str(captured.value), (
        "le rapport doit porter l'erreur RÉELLE, pas seulement le nom du fichier"
    )
