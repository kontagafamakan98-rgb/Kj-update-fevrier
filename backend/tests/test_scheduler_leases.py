"""Bail de tâche partagé entre instances (kojo_scheduler.executer_si_bail).

Plusieurs instances tournent (workers, machines Fly) et chacune lance ses boucles
de fond. Ces tests prouvent qu'un passage n'est exécuté qu'une fois par
période, par UNE seule instance, qu'un bail échu est repris, et que les deux
boucles passent bien par ce bail.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

import kojo_scheduler
from tests.conftest import db_find_one

MAINTENANT = datetime(2026, 10, 9, 12, 0, 0, tzinfo=timezone.utc)
DUREE = timedelta(minutes=60)


@pytest.mark.asyncio
class TestBailDeTache:
    async def test_deux_instances_simultanees_n_executent_qu_une_fois(self):
        """Deux instances demandent le même passage au même instant : une seule
        exécute, l'autre le saute (aucun double check-status, aucune double alerte)."""
        travail = AsyncMock(return_value="fait")

        resultats = await asyncio.gather(
            kojo_scheduler.executer_si_bail("tache-simultanee", DUREE, travail, holder="machine-A"),
            kojo_scheduler.executer_si_bail("tache-simultanee", DUREE, travail, holder="machine-B"),
        )

        assert travail.await_count == 1
        # Exactement un passage a renvoyé un résultat, l'autre None (sauté).
        assert sorted(r is None for r in resultats) == [False, True]

    async def test_meme_instance_ne_rejoue_pas_dans_la_periode(self):
        """Le bail tient pendant toute la période, y compris pour son propre
        détenteur : pas de passage doublé si la boucle se réveille trop tôt."""
        travail = AsyncMock(return_value="fait")

        await kojo_scheduler.executer_si_bail("tache-tenue", DUREE, travail, holder="machine-A")
        deuxieme = await kojo_scheduler.executer_si_bail("tache-tenue", DUREE, travail, holder="machine-A")

        assert travail.await_count == 1
        assert deuxieme is None

    async def test_bail_echu_est_repris_par_une_autre_instance(self):
        """La machine qui tenait le bail a disparu : une fois l'échéance passée,
        une autre instance prend le relais (la tâche ne s'arrête pas)."""
        assert await kojo_scheduler.acquerir_bail(
            "tache-reprise", DUREE, holder="machine-morte", now=MAINTENANT
        )
        # Toujours tenu juste avant l'échéance : refusé.
        assert not await kojo_scheduler.acquerir_bail(
            "tache-reprise", DUREE, holder="machine-B", now=MAINTENANT + timedelta(minutes=59)
        )
        # Échu : repris, et le détenteur est bien la nouvelle instance.
        assert await kojo_scheduler.acquerir_bail(
            "tache-reprise", DUREE, holder="machine-B", now=MAINTENANT + timedelta(minutes=61)
        )
        stored = await db_find_one("scheduler_leases", {"_id": "tache-reprise"})
        assert stored["holder"] == "machine-B"

    async def test_le_bail_est_persiste_sous_le_nom_de_la_tache(self):
        """Le verrou vit en base (partagé entre processus), sous le nom de la tâche."""
        await kojo_scheduler.executer_si_bail(
            "tache-persistee", DUREE, AsyncMock(return_value=None), holder="machine-A"
        )
        stored = await db_find_one("scheduler_leases", {"_id": "tache-persistee"})
        assert stored is not None
        assert stored["holder"] == "machine-A"

    async def test_des_taches_differentes_ne_se_bloquent_pas(self):
        """Le sweeper et la purge ont chacun leur bail : l'un ne saute pas l'autre."""
        sweep = AsyncMock(return_value="sweep")
        purge = AsyncMock(return_value="purge")

        assert await kojo_scheduler.executer_si_bail("payout_stuck_sweeper", DUREE, sweep, holder="A") == "sweep"
        assert await kojo_scheduler.executer_si_bail("retention_purge", DUREE, purge, holder="A") == "purge"

    async def test_panne_de_base_saute_le_passage_sans_le_lancer(self):
        """Base injoignable pendant la prise de bail : le passage n'est PAS lancé
        sans verrou (échec fermé) et l'erreur remonte à la boucle, qui la journalise."""
        travail = AsyncMock(return_value="fait")

        with patch("kojo_scheduler.acquerir_bail", AsyncMock(side_effect=RuntimeError("Mongo down"))):
            with pytest.raises(RuntimeError):
                await kojo_scheduler.executer_si_bail("tache-panne", DUREE, travail, holder="A")

        travail.assert_not_called()

    async def test_identifiant_d_instance_vient_de_la_machine_fly(self, monkeypatch):
        """Sur Fly, le détenteur est l'identifiant de machine (lisible en base) ;
        hors Fly, un repère hôte:pid reste unique par processus."""
        monkeypatch.setenv("FLY_MACHINE_ID", "7811x2d9")
        assert kojo_scheduler.scheduler_holder_id() == "7811x2d9"

        monkeypatch.delenv("FLY_MACHINE_ID", raising=False)
        assert kojo_scheduler.scheduler_holder_id().endswith(":" + str(os.getpid()))


@pytest.mark.asyncio
class TestBouclesPassentParLeBail:
    """Câblage : chaque boucle exécute son passage via executer_si_bail, avec le
    nom et la durée de SA tâche. Sans ce câblage, le bail existerait sans que rien
    ne le prenne, et le sweeper tournerait N fois en production."""

    async def _une_iteration_de_boucle(self, boucle):
        """Fait tourner la boucle une fois : le premier sommeil passe, le second
        lève CancelledError (arrêt propre de la boucle)."""
        sommeil = AsyncMock(side_effect=[None, asyncio.CancelledError()])
        with patch("kojo_scheduler.asyncio.sleep", sommeil):
            await boucle()

    async def test_boucle_sweeper_passe_par_le_bail(self):
        executer = AsyncMock(return_value=None)
        with patch("kojo_scheduler.executer_si_bail", executer):
            await self._une_iteration_de_boucle(kojo_scheduler.payout_stuck_sweeper_loop)

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "payout_stuck_sweeper"
        assert duree == timedelta(minutes=kojo_scheduler.PAYOUT_SWEEPER_INTERVAL_MINUTES)
        assert travail is kojo_scheduler.payout_stuck_sweep_once

    async def test_boucle_purge_passe_par_le_bail(self):
        executer = AsyncMock(return_value=None)
        with patch("kojo_scheduler.executer_si_bail", executer):
            await self._une_iteration_de_boucle(kojo_scheduler.retention_purge_loop)

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "retention_purge"
        assert duree == timedelta(minutes=kojo_scheduler.RETENTION_SWEEP_INTERVAL_MINUTES)
        assert travail is kojo_scheduler.retention_purge_once
