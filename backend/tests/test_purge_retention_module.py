# -*- coding: utf-8 -*-
"""La purge de rétention, extraite du planificateur — et RÉEXPORTÉE.

Ce que ces tests tiennent, et pourquoi chacun existe :

  1. L'IDENTITÉ — `kojo_scheduler.retention_purge_once` EST l'objet de
     `kojo_purge_retention`, pas une copie. Un import qui recopierait le corps
     garderait tous les tests verts (mêmes règles, même filtre) en laissant
     DEUX passages à corriger : c'est exactement le défaut qu'une extraction
     peut introduire en silence. La preuve est `is`, pas `==`.
  2. LE CODE VIT ICI — le corps du passage n'est plus défini dans le
     planificateur (`inspect.getmodule` et la source le disent). Sans cela, un
     `async def retention_purge_once` laissé derrière masquerait le module
     extrait, et le module ne serait qu'un doublon jamais appelé.
  3. LA SURFACE PUBLIQUE EST DÉCLARÉE — `__all__` n'est ni vide ni inventé, et
     chaque nom qu'il annonce est bien réexporté par le planificateur. Un nom
     retiré de `__all__` cesserait d'être vérifié ; un nom annoncé sans objet
     ferait échouer l'import au premier usage.
  4. AUCUN RETOUR DU CYCLE — le module n'importe pas `kojo_scheduler` (ni par
     `import` ni par `from ... import`), sinon l'extraction créait un cycle au
     lieu d'un découpage.
  5. LA BOUCLE DE PRODUCTION APPELLE CET OBJET-LÀ — une itération de
     `retention_purge_loop`, avec le sommeil neutralisé et le bail espionné,
     montre que le travailleur reçu par le bail est l'objet du module. C'est le
     seul point où l'extraction pourrait être juste et la production branchée
     sur autre chose.

Ce qui n'est PAS mesuré ici : le comportement de la purge (documents dus
supprimés, les autres épargnés, idempotence, filtres partiels). Il est déjà
couvert par `backend/tests/test_retention_purge.py`, qui importe
`kojo_scheduler.retention_purge_once` — donc il prouve AUSSI que le
réexport porte le comportement, sans qu'une ligne du test ait bougé.

Mutations qui doivent rougir (rejouées à la main le 27/10/2026) : redéfinir
`async def retention_purge_once` dans le planificateur (le nom masque alors le
module), vider `__all__`, et remplacer l'appel de la boucle par une lambda.
"""
import ast
import asyncio
import inspect
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

import kojo_purge_retention as purge
import kojo_scheduler as scheduler

RACINE = Path(__file__).resolve().parents[1]


def _source(nom_module: str) -> str:
    return (RACINE / f"{nom_module}.py").read_text(encoding="utf-8")


ABSENT = object()


class TestLaSurfaceReexportee:
    def test_chaque_nom_public_est_reexporte_a_l_identique(self):
        """La surface se lit comme une table, pas comme une suite de sondes.

        On construit les DEUX tables puis on les compare : les noms manquants
        sont nommés d'un coup, et l'identité se juge objet par objet. Une
        surface VIDE est un refus — un réexport qui n'annonce rien ne serait
        plus vérifié du tout, et le test passerait en ne mesurant rien.
        """
        surface = {nom: getattr(purge, nom) for nom in purge.__all__}
        assert len(surface) >= 1, (
            "aucun nom public déclaré : le réexport ne serait plus vérifié"
        )

        reexportes = {nom: vars(scheduler).get(nom, ABSENT) for nom in surface}
        absents = sorted(nom for nom, objet in reexportes.items() if objet is ABSENT)
        assert absents == [], (
            f"non réexporté(s) par kojo_scheduler : {absents} — "
            "`from kojo_scheduler import ...` casserait"
        )

        copies = sorted(
            nom for nom, objet in surface.items() if reexportes[nom] is not objet
        )
        assert copies == [], (
            f"le(s) même(s) nom(s) ne désignent pas le même objet dans les deux "
            f"modules : {copies} — une copie a été laissée derrière"
        )

    def test_le_passage_est_une_coroutine_du_module_extrait(self):
        for nom in purge.__all__:
            fonction = getattr(purge, nom)
            assert inspect.iscoroutinefunction(fonction), f"{nom} n'est plus une coroutine"
            assert inspect.getmodule(fonction) is purge, (
                f"{nom} est défini dans {inspect.getmodule(fonction).__name__}, "
                "pas dans kojo_purge_retention"
            )


class TestLExtractionEstReelle:
    def test_le_planificateur_ne_redefinit_pas_le_passage(self):
        source = _source("kojo_scheduler")
        assert "async def retention_purge_once" not in source, (
            "le planificateur redéfinit le passage : il masque le module extrait, "
            "et deux corps de purge coexistent"
        )
        assert "from kojo_purge_retention import retention_purge_once" in source, (
            "le réexport a disparu : l'import historique ne résoudrait plus"
        )

    def test_le_module_extrait_n_importe_pas_le_planificateur(self):
        arbre = ast.parse(_source("kojo_purge_retention"))
        importes = []
        for noeud in ast.walk(arbre):
            if isinstance(noeud, ast.Import):
                importes += [alias.name for alias in noeud.names]
            elif isinstance(noeud, ast.ImportFrom):
                importes.append(noeud.module or "")
        assert "kojo_scheduler" not in importes, (
            "kojo_purge_retention importe kojo_scheduler : le cycle revient, "
            "et l'extraction n'en est plus une"
        )


@pytest.mark.asyncio
class TestLaProductionAppelleCetObjet:
    async def test_la_boucle_de_purge_passe_notre_passage_au_bail(self):
        sommeil = AsyncMock(side_effect=[None, asyncio.CancelledError()])
        executer = AsyncMock(return_value=None)
        with patch("kojo_scheduler.asyncio.sleep", sommeil):
            with patch("kojo_scheduler.executer_si_bail", executer):
                await scheduler.retention_purge_loop()

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "retention_purge"
        assert duree == timedelta(minutes=scheduler.RETENTION_SWEEP_INTERVAL_MINUTES)
        assert travail is purge.retention_purge_once, (
            "la boucle ne remet pas au bail l'objet du module extrait"
        )
