# -*- coding: utf-8 -*-
"""Relance du CLIENT « votre mission n'a reçu aucune candidature ».

CE QUE CES CAS FERMENT

L'alerte propriétaire dit que la place ne se remplit pas. Elle ne dit rien à la
seule personne qui peut corriger CETTE mission — son client, qui a fixé un prix,
une date et un quartier, et qui n'ouvre jamais la file d'arbitrage. Sans cette
relance, une mission trop chère meurt en silence : le client croit qu'il attend,
alors que personne n'a vu son annonce.

Ce qui est jugé, et pourquoi chaque cas existe :

  • LE SEUIL EST UNE ANCIENNETÉ (heures) : une mission publiée il y a une heure
    sans proposition est une mission qui vient de paraître, pas un échec.
  • UNE RELANCE PAR MISSION : le marqueur vit sur le DOCUMENT de la mission
    (`nudge_sans_proposition_at`), pas dans une mémoire de process — un
    redémarrage ne relance pas tout le monde une seconde fois.
  • TOUS LES STATUTS DE CANDIDATURE comptent : une candidature refusée prouve
    que la mission a été VUE ; la relancer serait un reproche faux.
  • UNE MISSION SANS CLIENT LISIBLE est COMPTÉE (`sans_client`), jamais
    notifiée à personne.
  • UNE LECTURE EN PANNE n'est pas « rien à relancer » : elle est écrite, ne
    relance rien, et ne pose aucun marqueur.
  • LE PLAFOND PAR PASSAGE borne la rafale (une rafale de notifications est le
    meilleur moyen de faire désinstaller l'application) ; le reste part au
    passage suivant, SANS marqueur posé.
  • LE CÂBLAGE : bail par passage, boucle démarrée ET annulée par `server.py`,
    neutralisée dans le banc de charge, bornes des réglages, texte traduit.
"""
import asyncio
import inspect
import io
import pathlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_scheduler
import kojo_settings as reglages
import kojo_shared
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

MAINTENANT = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
ANCIENNE = (MAINTENANT - timedelta(hours=8)).isoformat()
RECENTE = (MAINTENANT - timedelta(hours=2)).isoformat()

COLLECTION = "scheduler_alerts"
SUJET = "client_sans_proposition"


def _job(
    identifiant: str = "job-1",
    publiee: str = ANCIENNE,
    client: str = "client-1",
    **champs,
) -> dict:
    base = {
        "id": identifiant,
        "client_id": client,
        "title": "Plomberie urgente Dakar",
        "description": "Fuite sous l'évier, à réparer aujourd'hui.",
        "category": "plomberie",
        "status": "open",
        "posted_at": publiee,
    }
    return {**base, **champs}


async def _proposition(job_id: str, statut: str = "pending") -> dict:
    doc = {
        "id": "prop-1",
        "job_id": job_id,
        "worker_id": "worker-sonde",
        "status": statut,
        "message": "Je peux passer dans l'heure.",
        "proposed_price": 15000,
        "created_at": (MAINTENANT - timedelta(hours=7)).isoformat(),
    }
    await db_insert("job_proposals", doc)
    return doc


async def _etat():
    return await db_find_one(COLLECTION, {"_id": SUJET})


@contextmanager
def _relances():
    """Isole l'envoi : ce qu'on juge ici est QUI est relancé, et avec quoi."""
    with patch(
        "kojo_scheduler.notify_user_localized", new_callable=AsyncMock
    ) as notif:
        yield notif


@contextmanager
def _seuil(heures: int = 6):
    with patch("kojo_scheduler.CLIENT_SANS_PROPOSITION_HEURES", heures):
        yield


# ──────────────────────────── qui est relancé, et quand ─────────────────────


@pytest.mark.asyncio
class TestRelanceDuClient:
    async def test_une_mission_ancienne_relance_son_client(self):
        await db_insert("jobs", _job())

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "relancee"
        assert resume["relances"] == 1
        assert resume["sans_proposition"] == 1

        appel = notif.await_args.kwargs
        assert appel["user_id"] == "client-1"
        assert appel["key"] == "client_mission_sans_proposition"
        assert appel["related_id"] == "job-1"
        assert appel["related_type"] == "job"
        assert appel["heures"] == 8
        assert appel["job_title"] == "Plomberie urgente Dakar"

        # Le marqueur vit sur la MISSION : c'est lui qui empêche une seconde
        # relance après un redémarrage, pas une mémoire de process.
        mission = await db_find_one("jobs", {"id": "job-1"})
        assert mission.get("nudge_sans_proposition_at") is not None
        assert mission.get("nudge_sans_proposition_heures") == 8

    async def test_une_mission_recente_ne_relance_pas(self):
        """Publiée il y a deux heures : elle vient de paraître."""
        await db_insert("jobs", _job(publiee=RECENTE))

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        assert resume["relances"] == 0
        assert resume["etat"] == "saine"
        notif.assert_not_awaited()

    async def test_une_mission_avec_proposition_ne_relance_pas(self):
        await db_insert("jobs", _job())
        await _proposition("job-1")

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["relances"] == 0
        notif.assert_not_awaited()

    async def test_une_candidature_refusee_prouve_que_la_mission_a_ete_vue(self):
        """Refuser un travailleur n'est pas « personne ne postule » : relancer
        serait un reproche faux, sur un fait déjà arrivé."""
        await db_insert("jobs", _job())
        await _proposition("job-1", statut="rejected")

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["relances"] == 0
        notif.assert_not_awaited()

    async def test_une_mission_fermee_ou_supprimee_ne_relance_pas(self):
        await db_insert("jobs", _job("en-cours", status="in_progress"))
        await db_insert("jobs", _job("terminee", status="completed"))
        await db_insert("jobs", _job("annulee", status="cancelled"))
        await db_insert("jobs", _job("supprimee", deleted=True))

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["missions_ouvertes"] == 0
        assert resume["relances"] == 0
        notif.assert_not_awaited()

    async def test_une_seule_relance_par_mission(self):
        await db_insert("jobs", _job())

        with _seuil(), _relances() as notif:
            premier = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )
            second = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT + timedelta(hours=1)
            )

        assert premier["relances"] == 1
        assert second["relances"] == 0
        assert second["deja_relancees"] == 1
        assert second["etat"] == "saine"
        assert notif.await_count == 1

        mission = await db_find_one("jobs", {"id": "job-1"})
        # Le marqueur n'est PAS réécrit: la date dit quand la relance a eu lieu.
        assert mission.get("nudge_sans_proposition_at") is not None

    async def test_une_mission_sans_client_est_comptee_sans_notification(self):
        await db_insert("jobs", _job(client=""))

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["sans_client"] == 1
        assert resume["relances"] == 0
        notif.assert_not_awaited()

    async def test_une_date_illisible_est_comptee_et_exclue(self):
        await db_insert("jobs", _job(publiee="pas-une-date"))

        with _seuil(), _relances() as notif:
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        etat = await _etat()
        assert etat["date_illisible"] == 1
        notif.assert_not_awaited()

    async def test_le_plafond_par_passage_borne_la_rafale(self):
        """Deux missions, une seule relance autorisée par passage : la seconde
        n'est PAS marquée, donc elle partira au passage suivant."""
        await db_insert("jobs", _job("job-1"))
        await db_insert("jobs", _job("job-2"))

        with _seuil(), _relances() as notif, patch(
            "kojo_scheduler.MAX_CLIENTS_RELANCEES", 1
        ):
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["relances"] == 1
        assert resume["plafond_atteint"] == 1
        assert notif.await_count == 1
        restante = await db_find_one("jobs", {"id": "job-2"})
        assert restante.get("nudge_sans_proposition_at") is None


# ────────────────────────────── les PRÉMISSES ──────────────────────────────


@pytest.mark.asyncio
class TestPremisses:
    async def test_une_lecture_en_panne_ne_relance_personne(self):
        """Une panne n'est pas « aucune mission à relancer » : relancer sur une
        mesure illisible ferait des reproches au hasard."""
        await db_insert("jobs", _job())

        with _seuil(), _relances() as notif, patch(
            "kojo_scheduler._missions_en_attente",
            AsyncMock(
                side_effect=kojo_scheduler.LectureImpossible(
                    "lecture_erreur", "base injoignable"
                )
            ),
        ):
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "lecture_impossible"
        assert "base injoignable" in resume["lecture_erreur"]
        notif.assert_not_awaited()

        mission = await db_find_one("jobs", {"id": "job-1"})
        assert mission.get("nudge_sans_proposition_at") is None
        etat = await _etat()
        assert "base injoignable" in etat["lecture_erreur"]

    async def test_une_mesure_tronquee_ne_relance_personne(self):
        """Plafond de propositions atteint : on ne sait pas qui a déjà reçu une
        candidature, donc on ne relance personne."""
        await db_insert("jobs", _job())

        with _seuil(), _relances() as notif, patch(
            "kojo_scheduler._missions_en_attente",
            AsyncMock(
                return_value={
                    "missions_ouvertes": 1,
                    "sans": [(MAINTENANT - timedelta(hours=8), "job-1", _job())],
                    "date_illisible": 0,
                    "tronque": False,
                    "propositions_tronquees": True,
                }
            ),
        ):
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "mesure_tronquee"
        notif.assert_not_awaited()
        mission = await db_find_one("jobs", {"id": "job-1"})
        assert mission.get("nudge_sans_proposition_at") is None


# ─────────────────────────────── le CÂBLAGE ────────────────────────────────


@pytest.mark.asyncio
class TestCablage:
    async def _une_iteration_de_boucle(self, boucle):
        sommeil = AsyncMock(side_effect=[None, asyncio.CancelledError()])
        with patch("kojo_scheduler.asyncio.sleep", sommeil):
            await boucle()

    async def test_la_boucle_passe_par_le_bail(self):
        executer = AsyncMock(return_value=None)
        with patch("kojo_scheduler.executer_si_bail", executer):
            await self._une_iteration_de_boucle(
                kojo_scheduler.clients_sans_proposition_loop
            )

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "client_sans_proposition"
        assert duree == timedelta(
            minutes=kojo_scheduler.CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES
        )
        assert travail is kojo_scheduler.clients_sans_proposition_once

    async def test_la_relance_atteint_vraiment_la_boite_du_client(
        self, client: AsyncClient
    ):
        """Le chemin COMPLET, sans mâtin : le client inscrit reçoit réellement la
        notification, et la mission porte son marqueur."""
        inscrit = await register_and_login(client, BASE_USER)
        await db_insert(
            "jobs",
            _job(client=inscrit["user"]["id"], title="Réparation de frigo"),
        )

        with _seuil():
            resume = await kojo_scheduler.clients_sans_proposition_once(
                now=MAINTENANT
            )

        assert resume["relances"] == 1
        notification = await db_find_one(
            "notifications", {"user_id": inscrit["user"]["id"]}
        )
        assert notification is not None, (
            "une relance qui n'écrit rien dans la boîte du client n'a atteint "
            "personne."
        )
        assert "Réparation de frigo" in notification["body"]
        assert "aucune proposition" in notification["body"].lower()



class TestFichiersEtReglages:
    """Les faits de CÂBLAGE qui se lisent dans les fichiers, sans base."""

    def test_server_demarre_et_annule_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert (
            "asyncio.create_task(\n        clients_sans_proposition_loop()\n    )"
            in source
        ), "server.py doit DÉMARRER la relance client."
        assert "client_sans_proposition_task.cancel()" in source
        assert "            client_sans_proposition_task,\n" in source, (
            "une tâche annulée mais absente du gather reste en attente au "
            "shutdown."
        )

    def test_le_banc_de_charge_neutralise_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent
            / "scripts"
            / "charge"
            / "serveur_mesure.py",
            encoding="utf-8",
        ).read()
        assert "server.clients_sans_proposition_loop = _boucle_inactive" in source

    def test_les_reglages_sont_bornes(self):
        assert 1 <= reglages.CLIENT_SANS_PROPOSITION_HEURES <= 168
        assert 1 <= reglages.CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES <= 1440
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "kojo_scheduler.py",
            encoding="utf-8",
        ).read()
        for nom in (
            "CLIENT_SANS_PROPOSITION_HEURES",
            "CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES",
        ):
            assert nom in source, "%s n'est pas lu par le passage" % nom

    def test_le_texte_existe_en_francais_et_en_anglais_et_replie_ailleurs(self):
        fr = kojo_shared._get_notif_msgs(
            "fr", "client_mission_sans_proposition", job_title="Frigo", heures=8
        )
        en = kojo_shared._get_notif_msgs(
            "en", "client_mission_sans_proposition", job_title="Frigo", heures=8
        )
        wo = kojo_shared._get_notif_msgs(
            "wo", "client_mission_sans_proposition", job_title="Frigo", heures=8
        )

        assert "Frigo" in fr[1] and "8" in fr[1]
        assert "Frigo" in en[1] and "8" in en[1]
        assert fr != en
        # Le français sert de repli là où la langue n'est pas traduite.
        assert wo == fr

    def test_le_passage_est_appelable_sans_horloge(self):
        parametres = inspect.signature(
            kojo_scheduler.clients_sans_proposition_once
        ).parameters
        assert "now" in parametres
