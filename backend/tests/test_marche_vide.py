# -*- coding: utf-8 -*-
"""Alerte « place de marché VIDE » — `kojo_scheduler`.

CE QUE CES CAS FERMENT

Le 23/10/2026 la production comptait ZÉRO mission ouverte, et le fait n'existait
que sur `/metrics` — un scrape que personne n'ouvre. Il a fallu onze jours de
PRÉMISSES dans les sondes de SEO pour l'apercevoir. Une place de marché sans
mission n'a rien à faire postuler, aucune fiche à indexer et aucun revenu :
c'est une panne d'exploitation, et le propriétaire doit l'apprendre du backend.

Ce qui est jugé, et pourquoi chaque cas existe :

  • LA DURÉE, pas l'instant : un creux entre deux missions n'est pas une panne.
    Sous `MARCHE_VIDE_ALERTE_HEURES`, rien ne part — et le chronomètre est posé.
  • LE CHRONOMÈTRE VIT EN BASE : un redémarrage (donc un nouvel appel sans
    mémoire de process) ne remet pas la durée à zéro, sinon une machine
    redéployée chaque jour ne franchirait jamais le seuil.
  • UNE LECTURE EN PANNE N'EST PAS UN MARCHÉ VIDE : elle est écrite et n'alerte
    pas — une panne de base ne doit pas produire une alerte sur la mauvaise
    cause, ni réarmer l'épisode en cours.
  • LA RÈGLE DU CORPUS EST PARTAGÉE avec la jauge `/metrics` : une seule
    définition de « mission ouverte », sinon la jauge dirait « vide » pendant
    que l'alerte se tairait.
  • UNE SEULE ALERTE PAR ÉPISODE, réarmée par le RETOUR d'une mission ouverte ;
    un seuil modifié est un épisode NEUF, et une date illisible ne devient ni
    « depuis toujours » (elle alerterait sur une donnée qu'on ne sait pas lire)
    ni « maintenant » en silence : elle est comptée.
  • LES DEUX CANAUX : notification in-app (elle atteint le propriétaire sans
    boîte mail) et email best-effort dont l'échec est ÉCRIT, jamais tu.
  • LE CÂBLAGE : bail par passage, boucle démarrée ET annulée par `server.py`,
    boucle neutralisée par le banc de charge, bornes des réglages.
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

COLLECTION = "scheduler_alerts"
SUJET = "marche_vide"


def _job(statut: str = "open", **champs) -> dict:
    base = {
        "id": "job-%s" % statut,
        "client_id": "client-sonde",
        "title": "Plomberie urgente Dakar",
        "status": statut,
    }
    return {**base, **champs}


async def _vide():
    """Un corpus OUVERT vide — mais pas une table vide : des missions existent,
    elles ne sont simplement ni ouvertes ni vivantes. C'est le cas réel : une
    place de marché qui a tourné et qui ne publie plus rien."""
    await db_insert("jobs", _job("in_progress", id="en-cours"))
    await db_insert("jobs", _job("completed", id="terminee"))
    await db_insert("jobs", _job("open", id="supprimee", deleted=True))


async def _une_mission_ouverte():
    await db_insert("jobs", _job("open", id="ouverte"))


async def _etat():
    return await db_find_one(COLLECTION, {"_id": SUJET})


def _utc(valeur):
    """L'INSTANT d'une date lue en base, quel que soit le stockage.

    MongoDB rend les dates NAÏVES (le fuseau n'est pas conservé, l'instant UTC
    l'est) ; la FakeDB les rend conscientes. Comparer au datetime du test
    jugerait donc le drapeau `tzinfo` et non le fait.
    """
    if valeur is None or valeur.tzinfo is not None:
        return valeur
    return valeur.replace(tzinfo=timezone.utc)


@contextmanager
def _seuil(heures: int = 24):
    """Le seuil, fixé : le cas juge la RÈGLE, pas l'env local."""
    with patch("kojo_scheduler.MARCHE_VIDE_ALERTE_HEURES", heures):
        yield


@contextmanager
def _canaux(email_side_effect=None):
    """Les deux canaux, observés — sans réseau ni envoi réel."""
    with patch("kojo_scheduler.resolve_owner_id", AsyncMock(return_value="owner-1")), patch(
        "kojo_scheduler.OWNER_EMAIL", "owner@kojo.sn"
    ), patch("kojo_scheduler.notify_user_localized", AsyncMock()) as notif, patch(
        "kojo_scheduler.send_email_via_active_provider",
        new_callable=AsyncMock,
        side_effect=email_side_effect,
    ) as email:
        yield notif, email


# ────────────────────────────── la MESURE du vide ──────────────────────────


@pytest.mark.asyncio
class TestMesureDuVide:
    async def test_des_missions_non_ouvertes_ne_comptent_pas(self):
        """La règle est celle du corpus OUVERT : une mission en cours, terminée
        ou supprimée n'est pas une mission à postuler. Les compter ferait
        croire que la place respire alors qu'elle ne publie plus rien."""
        await _vide()

        with _seuil(), _canaux() as (notif, email):
            resume = await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        assert resume["missions_ouvertes"] == 0
        assert resume["etat"] == "vide"
        assert resume["alertes"] == 0
        notif.assert_not_awaited()
        email.assert_not_awaited()

    async def test_un_creux_sous_le_seuil_pose_le_chronometre_sans_alerter(self):
        """Une heure sans mission n'est pas une panne. Le passage ÉCRIT quand
        même sa mesure et son chronomètre : sans cette écriture, un silence
        serait indiscernable d'une boucle qui n'a pas tourné."""
        await _vide()

        with _seuil(24), _canaux() as (notif, _email):
            resume = await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        assert resume["etat"] == "vide"
        assert resume["vide_depuis_heures"] == 0
        notif.assert_not_awaited()
        etat = await _etat()
        assert etat["etat"] == "vide"
        assert etat["heures"] == 24
        assert etat["missions_ouvertes"] == 0
        assert _utc(etat["vide_depuis"]) == MAINTENANT
        assert etat.get("alertee_at") is None

    async def test_une_mission_ouverte_rend_la_place_saine(self):
        await _une_mission_ouverte()

        with _seuil(), _canaux() as (notif, _email):
            resume = await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        assert resume["etat"] == "saine"
        assert resume["missions_ouvertes"] == 1
        notif.assert_not_awaited()
        etat = await _etat()
        assert etat["etat"] == "saine"
        # Le chronomètre est effacé : un vidage ultérieur repart de zéro, il
        # n'hérite pas de la durée de l'épisode précédent.
        assert etat.get("vide_depuis") is None

    async def test_le_chronometre_survit_a_un_redemarrage(self):
        """Trois jours plus tard, sans aucune mémoire de process : la durée
        mesurée est la CONTINUITÉ du vide, pas le temps depuis le dernier
        appel. C'est ce qui rend l'alerte possible sur une machine redéployée
        chaque jour."""
        await _vide()
        with _seuil(72), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        # Aucun état en mémoire : le passage ne lit que la base.
        with _seuil(72), _canaux() as (notif, _email):
            resume = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(days=3, hours=1)
            )

        # 73 h de vide CONTINU, alors que le passage précédent a eu lieu il y a
        # trois jours : c'est la durée qui décide, pas le temps écoulé depuis
        # le dernier appel (qui aurait donné 0 h sans l'état en base).
        assert resume["vide_depuis_heures"] == 73.0
        assert resume["alertes"] == 1
        assert notif.await_count == 1
        etat = await _etat()
        assert _utc(etat["vide_depuis"]) == MAINTENANT


# ─────────────────────────── le SEUIL et l'alerte ──────────────────────────


@pytest.mark.asyncio
class TestUneAlerteParEpisode:
    async def test_le_seuil_franchi_alerte_avec_les_deux_canaux(self):
        """La promesse : au-delà de 24 h de vide, UNE alerte, sur les deux
        canaux, avec la durée et le seuil — le propriétaire doit pouvoir agir
        sans ouvrir /metrics."""
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), _canaux() as (notif, email):
            resume = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

        assert resume["alertes"] == 1
        assert resume["etat"] == "alertee"
        assert resume["vide_depuis_heures"] == 25.0

        appel = notif.await_args.kwargs
        assert appel["key"] == "owner_marche_vide"
        assert appel["user_id"] == "owner-1"
        assert appel["duree"] == 25.0
        assert appel["heures"] == 24

        assert email.await_args.args[0] == "owner@kojo.sn"
        assert "25.0 h" in email.await_args.args[1]
        assert "kojo_missions_ouvertes" in email.await_args.args[2]

        etat = await _etat()
        assert etat["etat"] == "alertee"
        assert _utc(etat["alertee_at"]) == MAINTENANT + timedelta(hours=25)
        assert etat["alerte_envoyee"] is True
        assert etat["alerte_erreur"] == ""

    async def test_le_meme_episode_n_alerte_qu_une_fois(self):
        """Deux passages au-dessus du seuil n'envoient qu'UNE alerte, et le
        second dit son silence. Sans cette promesse, l'alerte deviendrait un
        rappel horaire qu'on apprend à ignorer."""
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), _canaux() as (notif, email):
            premier = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )
            second = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=26)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert second["alertes_ignorees"] == 1
        assert notif.await_count == 1
        assert email.await_count == 1

    async def test_le_retour_d_une_mission_rearme_puis_nouvel_episode(self):
        """Deux épisodes SÉPARÉS par le retour d'une mission donnent DEUX
        alertes : sans réarmement, la seconde serait muette pour toujours."""
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), _canaux() as (notif, _email):
            premiere = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

            # La place republie : c'est un rétablissement, et le chronomètre
            # repart de cet instant.
            await _une_mission_ouverte()
            retour = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(days=2)
            )

            # Puis plus rien : le vide est OBSERVÉ à ce passage-là (le
            # chronomètre ne peut pas remonter avant la mesure qui l'a vu), et
            # 25 h plus loin le seuil est franchi de nouveau.
            await kojo_scheduler.db.jobs.delete_many({"id": "ouverte"})
            debut = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(days=2, hours=1)
            )
            seconde = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(days=2, hours=26)
            )

        assert premiere["alertes"] == 1
        assert retour["etat"] == "saine"
        assert retour["retablissements"] == 1
        assert retour["alertes"] == 0
        assert debut["etat"] == "vide"
        assert debut["alertes"] == 0
        assert seconde["alertes"] == 1
        assert seconde["vide_depuis_heures"] == 25.0
        assert notif.await_count == 2

        etat = await _etat()
        assert _utc(etat["retabli_at"]) == MAINTENANT + timedelta(days=2)
        assert _utc(etat["alertee_at"]) == MAINTENANT + timedelta(days=2, hours=26)

    async def test_un_seuil_change_est_un_episode_neuf(self):
        """Changer le seuil change ce qui est mesuré : l'épisode est NEUF. Le
        taire donnerait l'impression que la règle n'a pas changé."""
        await _vide()
        with _canaux() as (notif, _email):
            with _seuil(48):
                under = await kojo_scheduler.marche_vide_alert_once(
                    now=MAINTENANT
                )
            # Toujours vide, 25 h plus tard : sous 48 h, au-dessus de 24 h.
            with _seuil(24):
                over = await kojo_scheduler.marche_vide_alert_once(
                    now=MAINTENANT + timedelta(hours=25)
                )

        assert under["alertes"] == 0
        assert over["alertes"] == 1
        assert notif.await_count == 1

    async def test_une_date_illisible_ne_declenche_pas_l_alerte(self):
        """`vide_depuis` illisible n'est ni « depuis toujours » (elle alerterait
        sur une donnée qu'on ne sait pas lire) ni « maintenant » en silence :
        elle est COMPTÉE, et le chronomètre repart de cet instant."""
        await _vide()
        await db_insert(
            COLLECTION,
            {
                "_id": SUJET,
                "etat": "vide",
                "vide_depuis": "pas-une-date",
                "signature": kojo_scheduler._signature_marche_vide(24),
            },
        )

        with _seuil(24), _canaux() as (notif, _email):
            resume = await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        assert resume["alertes"] == 0
        assert resume["etat"] == "vide"
        etat = await _etat()
        assert etat["horodatage_illisible"] == 1
        assert _utc(etat["vide_depuis"]) == MAINTENANT

    async def test_une_horloge_en_arriere_ne_se_lit_pas_comme_une_panne(self):
        """Un état daté dans le FUTUR (horloge retournée, restauration de base)
        ne doit pas produire une durée négative interprétée en alerte."""
        await _vide()
        await db_insert(
            COLLECTION,
            {
                "_id": SUJET,
                "etat": "vide",
                "vide_depuis": MAINTENANT + timedelta(days=3),
                "signature": kojo_scheduler._signature_marche_vide(24),
            },
        )

        with _seuil(24), _canaux() as (notif, _email):
            resume = await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        assert resume["alertes"] == 0
        assert resume["vide_depuis_heures"] == 0
        notif.assert_not_awaited()
        etat = await _etat()
        assert etat["horodatage_illisible"] == 1
        assert _utc(etat["vide_depuis"]) == MAINTENANT


# ────────────────────── la LECTURE en panne et les canaux ──────────────────


@pytest.mark.asyncio
class TestLectureEnPanneEtCanaux:
    async def test_une_lecture_en_panne_n_alerte_pas_et_ne_rearme_pas(self):
        """Une panne de base n'est pas un marché vide : elle est écrite, elle
        n'alerte pas, et elle n'efface pas l'épisode en cours (sinon la reprise
        relancerait une alerte pour la même panne)."""
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)
            await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

        with _seuil(), _canaux() as (notif, email), patch(
            "kojo_scheduler.compter_missions_ouvertes",
            AsyncMock(side_effect=RuntimeError("base injoignable")),
        ):
            resume = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=26)
            )

        assert resume["etat"] == "lecture_impossible"
        assert resume["alertes"] == 0
        assert "base injoignable" in resume["lecture_erreur"]
        notif.assert_not_awaited()
        email.assert_not_awaited()
        etat = await _etat()
        # L'état de l'épisode est INTACT : la panne de lecture n'a rien réarmé.
        assert etat["etat"] == "alertee"
        assert "base injoignable" in etat["lecture_erreur"]

    async def test_un_email_en_echec_est_ecrit_et_ne_realerte_pas(self):
        """L'email est le canal SECONDAIRE : son échec ne doit ni faire croire à
        une alerte reçue, ni faire réessayer à chaque passage."""
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), _canaux(
            email_side_effect=RuntimeError("Configuration Brevo incomplète: BREVO_API_KEY")
        ) as (notif, email):
            premier = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )
            second = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=26)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert notif.await_count == 1
        assert email.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert "BREVO_API_KEY" in etat["alerte_erreur"]

    async def test_owner_email_absent_est_dit_et_n_empeche_pas_l_in_app(self):
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), patch(
            "kojo_scheduler.resolve_owner_id", AsyncMock(return_value="owner-1")
        ), patch("kojo_scheduler.OWNER_EMAIL", ""), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            resume = await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

        assert resume["alertes"] == 1
        email.assert_not_awaited()
        assert notif.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert etat["alerte_erreur"] == "OWNER_EMAIL non configuré"

    async def test_le_proprietaire_resolu_par_email_atteint_le_compte_reel(
        self, client: AsyncClient
    ):
        """Le scénario de production : `OWNER_USER_ID` ne correspond à aucun
        compte, le propriétaire est trouvé par email. La notification doit viser
        CE compte — sinon elle est écrite dans le vide."""
        owner = await register_and_login(client, BASE_USER)
        await _vide()
        with _seuil(), _canaux():
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)

        with _seuil(), patch(
            "kojo_owner.OWNER_EMAIL", owner["user"]["email"]
        ), patch("kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"), patch(
            "kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]
        ), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

        assert notif.await_args.kwargs["user_id"] == owner["user"]["id"]
        assert email.await_args.args[0] == owner["user"]["email"]

    async def test_l_alerte_atteint_vraiment_la_boite_du_proprietaire(
        self, client: AsyncClient
    ):
        """Le chemin COMPLET, sans mâtin : la notification est réellement
        écrite dans la boîte du compte propriétaire, avec les chiffres.

        C'est ce que le demandeur verra ; un test qui ne fait que vérifier
        l'appel à `notify_user_localized` laisserait une clé i18n manquante ou
        un destinataire fantôme passer pour une alerte reçue.
        """
        owner = await register_and_login(client, BASE_USER)
        await _vide()

        with _seuil(), patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), patch(
            "kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"
        ), patch("kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]), patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ):
            await kojo_scheduler.marche_vide_alert_once(now=MAINTENANT)
            await kojo_scheduler.marche_vide_alert_once(
                now=MAINTENANT + timedelta(hours=25)
            )

        notification = await db_find_one(
            "notifications", {"user_id": owner["user"]["id"]}
        )
        assert notification is not None, (
            "une alerte qui n'écrit rien dans la boîte du propriétaire n'a "
            "atteint personne — c'est exactement le silence que cette boucle "
            "existe pour rompre."
        )
        assert notification.get("title")
        assert "25.0" in notification["body"]
        assert "kojo_missions_ouvertes" in notification["body"]


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
            await self._une_iteration_de_boucle(kojo_scheduler.marche_vide_alert_loop)

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "marche_vide_alert"
        assert duree == timedelta(
            minutes=kojo_scheduler.MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES
        )
        assert travail is kojo_scheduler.marche_vide_alert_once


class TestFichiersEtReglages:
    """Les faits de CÂBLAGE qui se lisent dans les fichiers, sans base."""

    def test_le_texte_existe_en_francais_et_en_anglais_et_replie_ailleurs(self):
        """L'alerte est une phrase d'EXPLOITATION, fr et en seulement : elle
        nomme une route et une série Prometheus. Les autres langues servies
        tombent sur le repli français — jamais sur une clé absente."""
        fr = kojo_shared._get_notif_msgs("fr", "owner_marche_vide", duree=25.0, heures=24)
        en = kojo_shared._get_notif_msgs("en", "owner_marche_vide", duree=25.0, heures=24)
        wo = kojo_shared._get_notif_msgs("wo", "owner_marche_vide", duree=25.0, heures=24)

        assert "25.0" in fr[1] and "kojo_missions_ouvertes" in fr[1]
        assert "25.0" in en[1] and "kojo_missions_ouvertes" in en[1]
        assert fr != en
        assert wo == fr

    def test_le_passage_est_appelable_sans_horloge(self):
        """Le travail est un POINT D'ENTRÉE à part, qui accepte une horloge.

        Sans ce paramètre, aucun test ne peut juger une durée de 24 h sans
        attendre le passage de la boucle — et la boucle serait le seul chemin
        d'exécution.
        """
        parametres = inspect.signature(
            kojo_scheduler.marche_vide_alert_once
        ).parameters
        assert "now" in parametres

    def test_server_demarre_et_annule_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert "asyncio.create_task(marche_vide_alert_loop())" in source, (
            "server.py doit DÉMARRER l'alerte marché vide — une boucle définie "
            "mais jamais lancée n'alerte personne."
        )
        assert "marche_task.cancel()" in source
        assert "            marche_task,\n" in source, (
            "une tâche annulée mais absente du gather reste en attente au "
            "shutdown."
        )

    def test_le_banc_de_charge_neutralise_la_boucle(self):
        """Le banc mesure le débit : une boucle qui compte le corpus à chaque
        passage ajouterait une requête non mesurée, et alerterait pour de faux
        (le corpus du banc n'est pas celui de la production)."""
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent
            / "scripts"
            / "charge"
            / "serveur_mesure.py",
            encoding="utf-8",
        ).read()
        assert "server.marche_vide_alert_loop = _boucle_inactive" in source

    def test_les_reglages_sont_bornes(self):
        assert 1 <= reglages.MARCHE_VIDE_ALERTE_HEURES <= 720
        assert 1 <= reglages.MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES <= 1440
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "kojo_scheduler.py",
            encoding="utf-8",
        ).read()
        for nom in (
            "MARCHE_VIDE_ALERTE_HEURES",
            "MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES",
        ):
            assert nom in source, "%s n'est pas lu par le passage" % nom

    def test_la_jauge_metrics_et_l_alerte_partagent_le_meme_comptage(self):
        """UNE seule définition de « mission ouverte ».

        Deux comptages écrits séparément finiraient par ne plus compter la même
        chose : la jauge dirait « vide » pendant que l'alerte se tairait (ou
        l'inverse) — et c'est exactement le genre d'écart qu'aucune des deux
        mesures ne signalerait.
        """
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert "compter_missions_ouvertes()" in source, (
            "la route /metrics doit lire la règle partagée, pas la réécrire."
        )
        assert '"status": "open"' not in source, (
            "server.py ne doit plus porter sa PROPRE requête de corpus : c'est "
            "la seconde règle que ce test interdit."
        )
