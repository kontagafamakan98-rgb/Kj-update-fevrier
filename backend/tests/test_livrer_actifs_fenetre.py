# -*- coding: utf-8 -*-
"""Régression : une bascule Vercel ne fait pas refuser une livraison correcte.

Le défaut que ce test verrouille
---------------------------------
Mesuré le 27/10/2026, deux livraisons de suite. La sonde d'actifs est lancée
juste après la fusion, pendant que Vercel remplace l'artefact, et elle jugeait
UNE fois :

* 08:25 — « manifeste ≠ artefact : annoncé=c46f7bc9885c servi=be0be05cc862 »,
  c'est-à-dire le HTML de l'ancien build avec le manifeste du nouveau ;
* 09:07 — deux chunks lazy en 404 (`CreateJob-C_ntOy7f.js`,
  `HowItWorks-Lm1RwtdI.js`).

Les deux fois la production était CORRECTE : mesurés en HTTP réel quelques
minutes plus tard, les deux chunks rendaient 200 et la sonde rendait vert sur
73 actifs. La livraison sortait pourtant en code 2 (« la PR est fusionnée mais
la production n'est pas conforme ») — un refus qui tombe sur une bascule apprend
à relancer sans lire, ce qui est exactement le silence que les sondes existent
pour fermer.

Ce qui est verrouillé ici
-------------------------
1. les tentatives et l'attente se LISENT dans le module (`ACTIFS_TENTATIVES`,
   `ACTIFS_ATTENTE_SECONDES`) : une valeur recopiée ici ne prouverait rien ;
2. un écart suivi d'un vert rend `True`, et la bascule est DITE (tentative N/M) ;
3. un écart qui survit à toutes les tentatives est REFUSÉ, en nommant le nombre
   de mesures espacées — une fenêtre n'est pas un assouplissement ;
4. une sonde non exécutable (code 2) n'est PAS réessayée : elle ne dit rien des
   actifs, donc réessayer ne changerait pas ce qu'on sait.

Ce que ce test ne prouve pas : que la production sert les bons actifs (c'est une
mesure, pas une propriété du dépôt). Rien n'est lancé ici : `subprocess` et
`time.sleep` sont remplacés DANS le module, là où ils sont utilisés.
"""
import importlib.util
import time as horloge
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
LIVRER = REPO_ROOT / ".github" / "scripts" / "livrer.py"
COMMANDE_SONDE = ["node", "scripts/check-deployed-assets.js"]


@pytest.fixture(scope="module")
def livrer():
    """Charge `livrer.py` comme module : l'importer ne déclenche aucune livraison
    (`main()` est sous `if __name__ == "__main__"`)."""
    spec = importlib.util.spec_from_file_location("livrer_actifs", LIVRER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _faux_subprocess(livrer, monkeypatch, codes):
    """Remplace `subprocess` DANS le module : chaque appel consomme le prochain
    code de `codes`, et le dernier code est répété s'il y a plus d'appels."""
    restants = list(codes)
    appels = []

    def faux_run(args, **options):
        appels.append((args, options))
        code = restants.pop(0) if len(restants) > 1 else restants[0]
        return types.SimpleNamespace(returncode=code)

    monkeypatch.setattr(livrer, "subprocess", types.SimpleNamespace(run=faux_run))
    return appels


def _faux_sommeil(livrer, monkeypatch):
    """Le sommeil est remplacé pour que la fenêtre soit JUGÉE, pas subie : une
    attente réelle rendrait ce fichier dépendant d'une horloge."""
    attentes = []

    def faux_sleep(secondes):
        attentes.append(secondes)

    # Seul le SOMMEIL est remplacé : le module se sert aussi de `time.strftime`
    # pour dater ses lignes, et un faux module nu ferait tomber la journalisation.
    monkeypatch.setattr(
        livrer,
        "time",
        types.SimpleNamespace(sleep=faux_sleep, strftime=horloge.strftime),
    )
    return attentes


def test_la_fenetre_se_lit_dans_le_module_et_n_est_pas_vide(livrer):
    assert livrer.ACTIFS_TENTATIVES >= 2, livrer.ACTIFS_TENTATIVES
    assert livrer.ACTIFS_ATTENTE_SECONDES > 0, livrer.ACTIFS_ATTENTE_SECONDES


def test_une_bascule_vercel_ne_refuse_pas_la_livraison(livrer, monkeypatch, capsys):
    appels = _faux_subprocess(livrer, monkeypatch, [1, 0])
    attentes = _faux_sommeil(livrer, monkeypatch)

    assert livrer.verifier_actifs_production() is True

    assert len(appels) == 2, appels
    assert attentes == [livrer.ACTIFS_ATTENTE_SECONDES], attentes
    args, options = appels[0]
    assert args == COMMANDE_SONDE, args
    assert options["cwd"] == str(livrer.FRONTEND_DIR), options
    sortie = capsys.readouterr()
    assert "bascule Vercel" in (sortie.err + sortie.out), sortie


def test_un_ecart_qui_survit_a_la_fenetre_est_refuse(livrer, monkeypatch, capsys):
    appels = _faux_subprocess(livrer, monkeypatch, [1])
    _faux_sommeil(livrer, monkeypatch)

    assert livrer.verifier_actifs_production() is False

    assert len(appels) == livrer.ACTIFS_TENTATIVES, len(appels)
    sortie = capsys.readouterr()
    assert "ce n'est plus une bascule" in (sortie.err + sortie.out), sortie


def test_une_sonde_non_executable_n_est_pas_reessayee(livrer, monkeypatch, capsys):
    appels = _faux_subprocess(livrer, monkeypatch, [2])
    attentes = _faux_sommeil(livrer, monkeypatch)

    assert livrer.verifier_actifs_production() is False

    assert len(appels) == 1, appels
    assert attentes == [], attentes
    sortie = capsys.readouterr()
    assert "non exécutable" in (sortie.err + sortie.out), sortie
