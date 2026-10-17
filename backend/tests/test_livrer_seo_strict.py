# -*- coding: utf-8 -*-
"""Régression : le trajet de livraison rend le verdict SEO dans le terminal.

Le défaut que ce test verrouille
--------------------------------
F9 (CI-COVERAGE.md) est né d'un rapport qui ne pouvait pas échouer. La sonde
stricte a fermé ce silence, mais elle tournait dans des surfaces DISTANTES — le
cron de 06:17 et le step de `frontend-build` sur le push de `main` — : celui qui
venait de livrer ne lisait le verdict nulle part, il l'attendait dans un autre
run, plus tard, ou pas du tout. `npm run livrer` (`.github/scripts/livrer.py`)
lance désormais la MÊME sonde juste après avoir confirmé que Vercel sert la
révision livrée, et c'est ce contrat que ce fichier tient.

Ce qui est verrouillé ici
-------------------------
1. la commande est celle de la CI, sans variante (`node
   scripts/check-seo-production.js --strict`), lancée depuis `frontend/` — trois
   définitions de « conforme » divergeraient, et l'une deviendrait plus
   indulgente que les autres ;
2. la sortie n'est PAS capturée : un `capture_output=True` cacherait le rapport
   et ses `::error` — or c'est précisément ce qui doit « tomber dans le
   terminal », avec l'intégration à corriger ;
3. le code de sortie de la sonde EST le verdict : 0 → `True`, non nul → `False`
   (la livraison rend alors le code 2, en nommant la surface qui a refusé).

Ce que ce test ne prouve pas : que la sonde passe sur la production (c'est une
mesure, pas une propriété du dépôt — relevé du 12/10/2026 : 3/3 intégrations
REQUISES présentes, canonical et sitemap conformes, 8/8 pages du sitemap
vérifiées), ni la composition de `main()`, qui demanderait de rejouer une
livraison entière (push, PR, fusion). Rien n'est lancé ici : `subprocess` est
remplacé DANS le module, là où il est utilisé.
"""
import importlib.util
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LIVRER = REPO_ROOT / ".github" / "scripts" / "livrer.py"
# La commande de la CI, sans variante. Écrite ici pour être comparée, jamais lue
# depuis le fichier : recopier ce qu'on juge ne prouverait rien.
COMMANDE_CI = ["node", "scripts/check-seo-production.js", "--strict"]


@pytest.fixture(scope="module")
def livrer():
    """Charge `livrer.py` comme module : l'importer ne déclenche aucune livraison
    (`main()` est sous `if __name__ == "__main__"`)."""
    spec = importlib.util.spec_from_file_location("livrer", LIVRER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _faux_subprocess(livrer, monkeypatch, code):
    """Remplace `subprocess` DANS le module jugé : la commande est enregistrée,
    aucune n'est lancée, et le faux `run` rend le code de sortie demandé."""
    appels = []

    def faux_run(args, **options):
        appels.append((args, options))
        return types.SimpleNamespace(returncode=code)

    monkeypatch.setattr(livrer, "subprocess", types.SimpleNamespace(run=faux_run))
    return appels


def test_la_sonde_est_lancee_avec_la_commande_de_la_ci(livrer, monkeypatch):
    appels = _faux_subprocess(livrer, monkeypatch, 0)

    assert livrer.verifier_seo_production_strict() is True

    assert len(appels) == 1, appels
    args, options = appels[0]
    assert args == COMMANDE_CI, args
    assert options["cwd"] == str(livrer.FRONTEND_DIR), options
    # Non capturée : c'est ce qui fait tomber le rapport dans le terminal.
    assert options["capture_output"] is False, options


def test_un_refus_de_la_sonde_rend_faux_en_nommant_le_code(livrer, monkeypatch, capsys):
    _faux_subprocess(livrer, monkeypatch, 1)

    assert livrer.verifier_seo_production_strict() is False

    sortie = capsys.readouterr()
    assert "code 1" in (sortie.err + sortie.out), sortie
    # Le refus dit aussi d'où vient le verdict, pour qu'il ne se lise pas comme une
    # panne de la livraison : c'est le MÊME verdict que le cron et `frontend-build`.
    assert "frontend-build" in (sortie.err + sortie.out), sortie
