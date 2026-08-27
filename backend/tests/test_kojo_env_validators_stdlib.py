# -*- coding: utf-8 -*-
"""Régression : kojo_env_validators.py doit rester importable SANS dépendances.

Architecture verrouillée : le script d'audit Fly (.github/scripts/check-fly-
env-drift.py) importe les validateurs depuis ce module en CI, dans un job qui
n'installe PAS les dépendances backend (pas de pip install -r). Contrairement
à kojo_settings.py — qui exécute cloudinary.config() et load_dotenv à
l'import — kojo_env_validators.py doit rester stdlib-only et sans effets de
bord : une régression (ajout d'un `import cloudinary`, d'une constante lue
via os.environ, d'un appel réseau au module top-level…) casserait l'audit en
CI avec un ImportError silencieux.

Deux garde-fous complémentaires :
- STATIQUE : scan du source — aucun import (ou stdlib uniquement) et aucun
  appel de fonction au niveau module (les validateurs sont des `def` purs) ;
- RUNTIME : import réel du module dans un sous-processus Python dont les
  site-packages sont BLOQUÉS (meta path vide après le chemin stdlib) —
  prouve qu'aucune dépendance n'est requise, transitivement ou non.
"""
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
VALIDATORS = BACKEND_DIR / "kojo_env_validators.py"

# stdlib : un import de n'importe lequel de ces modules est toléré ; tout
# AUTRE import (dotenv, cloudinary, redis, motor, pywebpush…) est une
# régression de l'architecture stdlib-only.
_STDLIB_MODULES = {
    "re", "os", "sys", "json", "urllib", "urllib.request", "pathlib",
    "typing", "collections", "dataclasses", "enum", "math", "string",
    "functools", "itertools", "unicodedata", "ipaddress",
}


def _module_source() -> str:
    assert VALIDATORS.exists(), f"{VALIDATORS} absent — normalement commité"
    return VALIDATORS.read_text(encoding="utf-8")


class TestArchitectureStdlibOnly:
    """Garde-fou STATIQUE : le source du module ne doit pas devenir dépendant."""

    def test_aucun_import_tiers(self):
        source = _module_source()
        imports = re.findall(r"^\s*(?:import|from)\s+([A-Za-z0-9_.]+)", source, re.M)
        # Le module actuel n'a AUCUN import — mais on tolère le stdlib pur
        # (une future version pourrait utiliser `import re` sans rien casser).
        for module in imports:
            root = module.split(".")[0]
            assert root in _STDLIB_MODULES, (
                f"import {module} interdit dans kojo_env_validators.py — "
                f"le module doit rester stdlib-only (importable sans deps)."
            )

    def test_aucun_effet_de_bord_top_level(self):
        # Les fonctions `def` sont les SEULES constructions autorisées au
        # niveau module : pas d'appel de fonction (ex. cloudinary.config()),
        # pas de lecture os.environ, pas de constantes calculées.
        source = _module_source()
        # Enlève les docstrings et commentaires pour ne scanner que le code.
        code = re.sub(r'""".*?"""', "", source, flags=re.S)
        code = re.sub(r"#.*", "", code)
        for line in code.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("def "):
                continue
            # Toute autre ligne au niveau module (indentation 0) est un suspect.
            if line[:1] not in (" ", "\t"):
                assert stripped == "", (
                    f"ligne top-level interdite : «{stripped}» — le module ne "
                    f"doit contenir que des définitions de fonctions (aucun "
                    f"effet de bord à l'import)."
                )

    def test_les_six_validateurs_presents(self):
        source = _module_source()
        for fn in (
            "validate_https_url",
            "validate_cors_origins",
            "validate_vapid_sub_claim",
            "validate_trusted_hosts",
            "validate_redis_url",
            "validate_mongo_url",
        ):
            assert re.search(rf"^def {fn}\(", source, re.M), f"{fn} absent du module"


class TestImportSansDependances:
    """Garde-fou RUNTIME : import réel du module avec site-packages bloqués."""

    def test_import_dans_env_nu(self):
        # Sous-processus Python dont le meta path ne contient QUE le chemin
        # stdlib (sys.path[0] exclu → kojo_env_validators est chargé par
        # chemin absolu, site-packages retiré → toute dépendance tierce
        # échouerait à l'import avec ModuleNotFoundError).
        code = (
            "import sys\n"
            "import importlib.util\n"
            "# Garde SEULEMENT le chemin stdlib, retire site-packages et cwd.\n"
            "stdlib = [p for p in sys.path if 'site-packages' not in p and 'dist-packages' not in p]\n"
            "sys.path[:] = stdlib\n"
            "spec = importlib.util.spec_from_file_location('kojo_env_validators', r'%s')\n"
            "mod = importlib.util.module_from_spec(spec)\n"
            "spec.loader.exec_module(mod)\n"
            "# Preuve fonctionnelle : les 6 validateurs répondent.\n"
            "assert mod.validate_https_url('https://kojo-backend.fly.dev') == 'https://kojo-backend.fly.dev'\n"
            "assert mod.validate_vapid_sub_claim('mailto:kojoapp98@gmail.com') == 'mailto:kojoapp98@gmail.com'\n"
            "assert mod.validate_mongo_url('mongodb+srv://u:p@h/db') == 'mongodb+srv://u:p@h/db'\n"
            "print('BARE-ENV-IMPORT-OK')\n"
        ) % str(VALIDATORS)
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, (
            f"import de kojo_env_validators.py en env nu ÉCHOUÉ (exit "
            f"{result.returncode}) — le module dépend de paquets tiers :\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "BARE-ENV-IMPORT-OK" in result.stdout

    def test_kojo_settings_importe_toujours_le_module(self):
        # Après import du module dans l'env nu, on vérifie que les 6
        # fonctions sont bien ré-exportées par kojo_settings.py (API stable).
        # On charge kojo_settings via importlib dans le même process de test
        # (les deps sont présentes ici — c'est l'environnement pytest).
        import kojo_settings  # noqa: F401  (existe dans backend/, cwd du pytest)

        for fn in (
            "validate_https_url",
            "validate_cors_origins",
            "validate_vapid_sub_claim",
            "validate_trusted_hosts",
            "validate_redis_url",
            "validate_mongo_url",
        ):
            assert hasattr(kojo_settings, fn), f"kojo_settings ne ré-exporte plus {fn}"
