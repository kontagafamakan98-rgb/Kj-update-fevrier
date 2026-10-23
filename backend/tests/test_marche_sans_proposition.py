# -*- coding: utf-8 -*-
"""Alerte « missions ouvertes SANS AUCUNE proposition » — `kojo_scheduler`.

CE QUE CES CAS FERMENT

L'alerte « marché vide » dit que l'OFFRE a disparu. Celle-ci dit que l'offre est
LÀ et que personne n'a répondu. Une mission publiée depuis plusieurs jours sans
une seule candidature est trop chère, mal datée, invisible — ou située dans une
ville où aucun travailleur n'est inscrit. Quatre corrections différentes, dont
aucune n'apparaît sur un tableau de bord qui compte des missions.

Ce qui est jugé, et pourquoi chaque cas existe :

  • L'ANCIENNETÉ, pas l'absence : une mission publiée il y a une heure sans
    proposition est une mission qui vient de paraître.
  • TOUS LES STATUTS DE CANDIDATURE comptent : une candidature refusée reste une
    candidature, donc la mission a été vue.
  • LES IDENTIFIANTS LEGACY sont joints des DEUX côtés : une mission peut porter
    `job_id` ou `_id` (jeu importé) et sa proposition a été écrite avec la chaîne
    que le client avait reçue — comparer sur `id` seul ferait alerter sur une
    mission qui a déjà trouvé preneur ; et une proposition importée désigne la
    mission par son `_id`, donc la retenir sur `job_id` seul la rendrait
    invisible.
  • DEUX PRÉMISSES : missions illisibles, ou PROPOSITIONS illisibles. La seconde
    est la plus dangereuse — conclure « aucune proposition » sur une lecture en
    panne ferait alerter sur TOUTES les missions ouvertes. Dans les deux cas :
    erreur écrite, aucun envoi, épisode en cours NON réarmé.
  • UNE ALERTE PAR CROISSANCE : le même nombre ne se répète pas toutes les six
    heures ; une mission de plus qui vieillit fait grandir le compte et rouvre
    l'alerte ; le retour à zéro réarme.
  • LES DEUX CANAUX, comme les autres alertes d'exploitation : notification
    in-app (elle atteint le propriétaire sans boîte mail) et email best-effort
    dont l'échec est ÉCRIT.
  • LE CÂBLAGE : bail par passage, boucle démarrée ET annulée par `server.py`,
    neutralisée dans le banc de charge, bornes des réglages.
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

import kojo_shared
import kojo_scheduler
import kojo_settings as reglages
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

MAINTENANT = datetime(2026, 10, 23, 9, 0, 0, tzinfo=timezone.utc)
VIEILLE = (MAINTENANT - timedelta(days=5)).isoformat()
RECENTE = (MAINTENANT - timedelta(hours=6)).isoformat()

COLLECTION = "scheduler_alerts"
SUJET = "missions_sans_proposition"


def _job(identifiant: str = "job-1", publiee: str = VIEILLE, **champs) -> dict:
    base = {
        "id": identifiant,
        "client_id": "client-sonde",
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
        "created_at": (MAINTENANT - timedelta(days=4)).isoformat(),
    }
    await db_insert("job_proposals", doc)
    return doc


async def _etat():
    return await db_find_one(COLLECTION, {"_id": SUJET})


def _utc(valeur):
    """L'INSTANT d'une date lue en base (Mongo la rend naïve, la FakeDB non)."""
    if valeur is None or valeur.tzinfo is not None:
        return valeur
    return valeur.replace(tzinfo=timezone.utc)


@contextmanager
def _seuil(jours: int = 3):
    with patch("kojo_scheduler.MISSIONS_SANS_PROPOSITION_JOURS", jours):
        yield


@contextmanager
def _canaux(email_side_effect=None):
    with patch("kojo_scheduler.resolve_owner_id", AsyncMock(return_value="owner-1")), patch(
        "kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"
    ), patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, patch(
        "kojo_scheduler.send_email_via_active_provider",
        new_callable=AsyncMock,
        side_effect=email_side_effect,
    ) as email:
        yield notif, email


# ───────────────────────── la MESURE de la file d'attente ──────────────────


@pytest.mark.asyncio
class TestMesureDesMissionsEnAttente:
    async def test_une_mission_ancienne_sans_proposition_alerte(self):
        await db_insert("jobs", _job())

        with _seuil(), _canaux() as (notif, email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "alertee"
        assert resume["missions_ouvertes"] == 1
        assert resume["sans_proposition"] == 1
        assert resume["plus_ancienne_jours"] == 5.0
        assert resume["alertes"] == 1

        appel = notif.await_args.kwargs
        assert appel["key"] == "owner_missions_sans_proposition"
        assert appel["user_id"] == "owner-1"
        assert appel["count"] == 1
        assert appel["jours"] == 3
        assert appel["total"] == 1
        assert appel["plus_ancienne"] == 5.0

        assert email.await_args.args[0] == "owner@kojo.sn"
        assert "1 mission" in email.await_args.args[1]
        assert "5.0" in email.await_args.args[2]

        etat = await _etat()
        assert etat["etat"] == "alertee"
        assert etat["missions_sans_proposition"] == 1
        assert etat["alertee_pour"] == 1
        assert etat["ids"] == ["job-1"]
        assert etat["alerte_envoyee"] is True
        assert etat["alerte_erreur"] == ""
        assert _utc(etat["alertee_at"]) == MAINTENANT

    async def test_une_mission_recente_ne_compte_pas(self):
        """Publiée il y a six heures : elle vient de paraître, pas d'attendre."""
        await db_insert("jobs", _job(publiee=RECENTE))

        with _seuil(), _canaux() as (notif, email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["missions_ouvertes"] == 1
        assert resume["sans_proposition"] == 0
        assert resume["etat"] == "saine"
        notif.assert_not_awaited()
        email.assert_not_awaited()

    async def test_une_mission_avec_proposition_ne_compte_pas(self):
        await db_insert("jobs", _job())
        await _proposition("job-1")

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        assert resume["etat"] == "saine"
        notif.assert_not_awaited()

    async def test_une_candidature_refusee_reste_une_candidature(self):
        """La mission a été VUE. Compter seulement les candidatures en attente
        ferait alerter sur une mission dont le client a déjà refusé quelqu'un."""
        await db_insert("jobs", _job())
        await _proposition("job-1", statut="rejected")

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        notif.assert_not_awaited()

    async def test_une_mission_fermee_attribuee_ou_supprimee_ne_compte_pas(self):
        await db_insert("jobs", _job("fermee", status="in_progress"))
        await db_insert("jobs", _job("terminee", status="completed"))
        await db_insert("jobs", _job("annulee", status="cancelled"))
        await db_insert("jobs", _job("supprimee", deleted=True))

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["missions_ouvertes"] == 0
        assert resume["sans_proposition"] == 0
        notif.assert_not_awaited()

    async def test_une_mission_ancienne_par_son_identifiant_legacy(self):
        """`job_id` / `_id` (jeu importé) : la proposition a été écrite avec la
        chaîne que le client avait reçue. Comparer sur `id` seul ferait alerter
        sur une mission qui a déjà trouvé preneur."""
        await db_insert(
            "jobs",
            {
                "job_id": "legacy-42",
                "client_id": "client-sonde",
                "title": "Réparation de frigo",
                "status": "open",
                "posted_at": VIEILLE,
            },
        )
        await _proposition("legacy-42")

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        notif.assert_not_awaited()

    async def test_une_proposition_importee_sous_son_identifiant_de_mission(self):
        """Jeu IMPORTÉ : la proposition porte la mission dans `_id`, sans `job_id`.

        La requête l'a appariée sur `_id` — ne retenir que `job_id` dans les
        propositions lues rendrait ces lignes invisibles, et la mission
        compterait comme « sans candidature » alors qu'on vient de la lire.
        """
        await db_insert(
            "jobs",
            {
                "_id": "mission-importee",
                "client_id": "client-sonde",
                "title": "Coiffure à domicile",
                "status": "open",
                "posted_at": VIEILLE,
            },
        )
        await db_insert(
            "job_proposals",
            {
                "_id": "mission-importee",
                "worker_id": "worker-sonde",
                "status": "pending",
                "created_at": (MAINTENANT - timedelta(days=4)).isoformat(),
            },
        )

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["missions_ouvertes"] == 1
        assert resume["sans_proposition"] == 0
        assert resume["etat"] == "saine"
        notif.assert_not_awaited()

    async def test_une_date_illisible_est_comptee_et_exclue(self):
        """Une date illisible n'est ni « très ancienne » (elle alerterait sur une
        donnée qu'on ne sait pas lire) ni « récente » en silence : elle est
        comptée, et elle sort de la mesure."""
        await db_insert("jobs", _job(publiee="pas-une-date"))

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["sans_proposition"] == 0
        notif.assert_not_awaited()
        etat = await _etat()
        assert etat["date_illisible"] == 1

    async def test_la_mesure_est_tronquee_et_le_dit(self):
        for index in range(3):
            await db_insert("jobs", _job("job-%s" % index))

        with _seuil(), patch("kojo_scheduler.MAX_MISSIONS_MESUREES", 2), _canaux():
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["missions_ouvertes"] == 2
        etat = await _etat()
        assert etat["tronque"] is True

    async def test_un_plafond_de_propositions_atteint_est_une_premisse(self):
        """Au plafond, on ne sait pas quelles missions ont reçu une candidature :
        ce n'est pas « aucune proposition », donc ce n'est pas une alerte."""
        for index in range(2):
            await db_insert("jobs", _job("job-%s" % index))
            await _proposition("job-%s" % index)

        with _seuil(), patch("kojo_scheduler.MAX_PROPOSITIONS_LUES", 1), _canaux() as (
            notif,
            _email,
        ):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "mesure_tronquee"
        assert resume["propositions_tronquees"] == 1
        assert resume["alertes"] == 0
        notif.assert_not_awaited()


# ────────────────────────── une alerte par CROISSANCE ──────────────────────


@pytest.mark.asyncio
class TestUneAlerteParCroissance:
    async def test_le_meme_nombre_n_alerte_qu_une_fois(self):
        await db_insert("jobs", _job())

        with _seuil(), _canaux() as (notif, email):
            premier = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )
            second = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert second["alertes_ignorees"] == 1
        assert notif.await_count == 1
        assert email.await_count == 1

    async def test_une_mission_de_plus_rouvre_l_alerte(self):
        """Le compte GRANDIT : c'est un fait neuf pour le propriétaire, donc une
        alerte neuve — et elle nomme le nouveau total, pas un rappel du même."""
        await db_insert("jobs", _job("job-1"))

        with _seuil(), _canaux() as (notif, _email):
            premiere = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )
            await db_insert("jobs", _job("job-2", publiee=VIEILLE))
            seconde = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )

        assert premiere["alertes"] == 1
        assert seconde["alertes"] == 1
        assert seconde["sans_proposition"] == 2
        assert notif.await_count == 2
        assert notif.await_args.kwargs["count"] == 2

    async def test_une_proposition_fait_baisser_sans_alerter_ni_rearmer(self):
        """La file redescend sans se vider : rien à dire, mais le niveau retenu
        reste le plus haut — une file qui regrossit au-delà alertera de nouveau."""
        await db_insert("jobs", _job("job-1"))
        await db_insert("jobs", _job("job-2"))

        with _seuil(), _canaux() as (notif, _email):
            premiere = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )
            await _proposition("job-1")
            descente = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )

        assert premiere["sans_proposition"] == 2
        assert descente["sans_proposition"] == 1
        assert descente["alertes"] == 0
        assert descente["retablissements"] == 0
        assert notif.await_count == 1
        etat = await _etat()
        assert etat["alertee_pour"] == 2
        assert etat.get("retabli_at") is None

    async def test_le_retour_a_zero_rearme_puis_nouvel_episode(self):
        await db_insert("jobs", _job("job-1"))

        with _seuil(), _canaux() as (notif, _email):
            premiere = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )
            await kojo_scheduler.db.jobs.update_one(
                {"id": "job-1"}, {"$set": {"status": "in_progress"}}
            )
            retour = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )
            await db_insert("jobs", _job("job-2"))
            seconde = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=12)
            )

        assert premiere["alertes"] == 1
        assert retour["etat"] == "saine"
        assert retour["retablissements"] == 1
        assert seconde["alertes"] == 1
        assert notif.await_count == 2

        etat = await _etat()
        assert _utc(etat["retabli_at"]) == MAINTENANT + timedelta(hours=6)
        assert _utc(etat["alertee_at"]) == MAINTENANT + timedelta(hours=12)

    async def test_un_seuil_change_est_un_episode_neuf(self):
        """Changer l'ancienneté change ce qui est mesuré : la même mission passe
        d'« invisible » à « en attente ». Le taire ferait croire que rien n'a
        changé."""
        await db_insert("jobs", _job())  # 5 jours

        with _canaux() as (notif, _email):
            with _seuil(10):
                sous = await kojo_scheduler.missions_sans_proposition_alert_once(
                    now=MAINTENANT
                )
            with _seuil(3):
                sur = await kojo_scheduler.missions_sans_proposition_alert_once(
                    now=MAINTENANT + timedelta(hours=6)
                )

        assert sous["sans_proposition"] == 0
        assert sous["alertes"] == 0
        assert sur["alertes"] == 1
        assert notif.await_count == 1


# ───────────────────── les PRÉMISSES et les deux canaux ────────────────────


@pytest.mark.asyncio
class TestPremissesEtCanaux:
    async def test_la_lecture_des_missions_en_panne_n_alerte_pas(self):
        await db_insert("jobs", _job())
        with _seuil(), _canaux() as (notif, email), patch.object(
            kojo_scheduler.db.jobs,
            "find",
            side_effect=RuntimeError("base injoignable"),
        ):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "lecture_impossible"
        assert "base injoignable" in resume["lecture_erreur"]
        notif.assert_not_awaited()
        email.assert_not_awaited()

    async def test_la_lecture_des_propositions_en_panne_n_invente_pas_l_absence(self):
        """LE cas dangereux : conclure « aucune proposition » sur une lecture en
        panne alerterait sur TOUTES les missions ouvertes, à chaque incident de
        la collection `job_proposals`."""
        await db_insert("jobs", _job())
        await _proposition("job-1")

        with _seuil(), _canaux() as (notif, email), patch.object(
            kojo_scheduler.db.job_proposals,
            "find",
            side_effect=RuntimeError("collection illisible"),
        ):
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["etat"] == "lecture_impossible"
        assert resume["alertes"] == 0
        notif.assert_not_awaited()
        email.assert_not_awaited()
        etat = await _etat()
        assert "collection illisible" in etat["propositions_lecture_erreur"]

    async def test_une_panne_n_efface_pas_l_episode_en_cours(self):
        """La panne n'est pas un rétablissement : l'épisode signalé reste
        signalé, sinon la reprise relancerait une alerte pour le même fait."""
        await db_insert("jobs", _job())

        with _seuil(), _canaux():
            await kojo_scheduler.missions_sans_proposition_alert_once(now=MAINTENANT)

        with _seuil(), _canaux() as (notif, _email), patch.object(
            kojo_scheduler.db.jobs, "find", side_effect=RuntimeError("panne")
        ):
            panne = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )

        assert panne["etat"] == "lecture_impossible"
        etat = await _etat()
        assert etat["etat"] == "alertee"
        assert etat.get("retabli_at") is None
        notif.assert_not_awaited()

    async def test_un_email_en_echec_est_ecrit_et_ne_realerte_pas(self):
        await db_insert("jobs", _job())

        with _seuil(), _canaux(
            email_side_effect=RuntimeError("Configuration Brevo incomplète: BREVO_API_KEY")
        ) as (notif, email):
            premier = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )
            second = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT + timedelta(hours=6)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert notif.await_count == 1
        assert email.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert "BREVO_API_KEY" in etat["alerte_erreur"]

    async def test_owner_email_absent_est_dit_et_n_empeche_pas_l_in_app(self):
        await db_insert("jobs", _job())

        with _seuil(), patch(
            "kojo_scheduler.resolve_owner_id", AsyncMock(return_value="owner-1")
        ), patch("kojo_scheduler.OWNER_EMAIL", ""), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            resume = await kojo_scheduler.missions_sans_proposition_alert_once(
                now=MAINTENANT
            )

        assert resume["alertes"] == 1
        email.assert_not_awaited()
        assert notif.await_count == 1
        etat = await _etat()
        assert etat["alerte_erreur"] == "OWNER_EMAIL non configuré"

    async def test_le_proprietaire_resolu_par_email_atteint_le_compte_reel(
        self, client: AsyncClient
    ):
        owner = await register_and_login(client, BASE_USER)
        await db_insert("jobs", _job())

        with _seuil(), patch(
            "kojo_owner.OWNER_EMAIL", owner["user"]["email"]
        ), patch("kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"), patch(
            "kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]
        ), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            await kojo_scheduler.missions_sans_proposition_alert_once(now=MAINTENANT)

        assert notif.await_args.kwargs["user_id"] == owner["user"]["id"]
        assert email.await_args.args[0] == owner["user"]["email"]

    async def test_l_alerte_atteint_vraiment_la_boite_du_proprietaire(
        self, client: AsyncClient
    ):
        """Le chemin COMPLET, sans mâtin : la notification est réellement écrite
        dans la boîte du compte propriétaire, avec les chiffres."""
        owner = await register_and_login(client, BASE_USER)
        await db_insert("jobs", _job())

        with _seuil(), patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), patch(
            "kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"
        ), patch("kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]), patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ):
            await kojo_scheduler.missions_sans_proposition_alert_once(now=MAINTENANT)

        notification = await db_find_one(
            "notifications", {"user_id": owner["user"]["id"]}
        )
        assert notification is not None, (
            "une alerte qui n'écrit rien dans la boîte du propriétaire n'a "
            "atteint personne."
        )
        assert notification.get("title")
        assert "5.0" in notification["body"]
        assert "sans AUCUNE proposition" in notification["body"]


# ────────────────────────────── le CÂBLAGE ─────────────────────────────────


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
                kojo_scheduler.missions_sans_proposition_alert_loop
            )

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "missions_sans_proposition_alert"
        assert duree == timedelta(
            minutes=kojo_scheduler.MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES
        )
        assert travail is kojo_scheduler.missions_sans_proposition_alert_once


class TestFichiersEtReglages:
    """Les faits de CÂBLAGE qui se lisent dans les fichiers, sans base."""

    def test_le_texte_existe_en_francais_et_en_anglais_et_replie_ailleurs(self):
        fr = kojo_shared._get_notif_msgs(
            "fr", "owner_missions_sans_proposition",
            count=2, total=3, jours=3, plus_ancienne=5.0,
        )
        en = kojo_shared._get_notif_msgs(
            "en", "owner_missions_sans_proposition",
            count=2, total=3, jours=3, plus_ancienne=5.0,
        )
        wo = kojo_shared._get_notif_msgs(
            "wo", "owner_missions_sans_proposition",
            count=2, total=3, jours=3, plus_ancienne=5.0,
        )

        assert "2" in fr[1] and "5.0" in fr[1]
        assert "2" in en[1] and "5.0" in en[1]
        assert fr != en
        assert wo == fr

    def test_le_passage_est_appelable_sans_horloge(self):
        parametres = inspect.signature(
            kojo_scheduler.missions_sans_proposition_alert_once
        ).parameters
        assert "now" in parametres

    def test_server_demarre_et_annule_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert (
            "asyncio.create_task(\n        missions_sans_proposition_alert_loop()\n    )"
            in source
        ), "server.py doit DÉMARRER l'alerte missions sans proposition."
        assert "sans_proposition_task.cancel()" in source
        assert "            sans_proposition_task,\n" in source, (
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
        assert "server.missions_sans_proposition_alert_loop = _boucle_inactive" in source

    def test_les_reglages_sont_bornes(self):
        assert 1 <= reglages.MISSIONS_SANS_PROPOSITION_JOURS <= 90
        assert 1 <= reglages.MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES <= 1440
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "kojo_scheduler.py",
            encoding="utf-8",
        ).read()
        for nom in (
            "MISSIONS_SANS_PROPOSITION_JOURS",
            "MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES",
        ):
            assert nom in source, "%s n'est pas lu par le passage" % nom
