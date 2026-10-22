# -*- coding: utf-8 -*-
"""Alerte « litiges tranchés SANS réponse » — `kojo_scheduler`.

CE QUE CES CAS FERMENT

`mesures_arbitrage` publie déjà la part des décisions prises sans réponse, mais
seulement DANS la file d'arbitrage : un arbitre qui ne l'ouvre pas ne voit pas
que son propre taux monte. Ici, le chiffre vient à lui — une fois par
dépassement, avec la conséquence nommée.

Ce qui est jugé, et pourquoi chaque cas existe :

  • LA PÉRIODE est une FENÊTRE GLISSANTE sur `dispute.resolved_at` (l'instant de
    la DÉCISION) : une décision antérieure sort du dénominateur, un litige
    ouvert il y a six mois et tranché hier y entre. Sans ce cas, une vieille
    décision pourrait masquer un changement récent.
  • LES DATES IMPOSSIBLES SONT COMPTÉES, jamais recasées : `resolved_at`
    illisible ou dans le futur ne devient ni « dans la période » ni « sans
    réponse » ; une réponse dont la date est illisible n'est PAS une absence de
    réponse (la compter comme telle gonflerait le chiffre surveillé).
  • LE PLANCHER rend le taux `None` sous dix décisions : « trop peu de litiges »
    n'est pas un verdict, et l'alerte ne part pas.
  • « DÉPASSE » est STRICT : à la valeur du seuil, rien ne part.
  • UNE ALERTE PAR DÉPASSEMENT, réarmée par le RETOUR sous le seuil (ou par un
    changement de seuil/fenêtre, qui change ce qui est mesuré). Une période
    trop pauvre pour publier un taux n'est PAS un rétablissement.
  • LES DEUX CANAUX : notification in-app (elle atteint le propriétaire sans
    boîte mail) et email best-effort dont l'échec est ÉCRIT, jamais tu.
  • LE CÂBLAGE : bail par passage (N machines ne doivent pas alerter N fois),
    boucle démarrée ET annulée par `server.py`, boucle neutralisée par le banc
    de charge, bornes des réglages.
"""
import asyncio
import inspect
import io
import pathlib
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_job_disputes as litiges
import kojo_scheduler
import kojo_settings as reglages
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

MAINTENANT = datetime(2026, 10, 22, 9, 0, 0, tzinfo=timezone.utc)
RECENT = "2026-10-21T09:00:00+00:00"
ANCIEN = "2026-06-01T00:00:00+00:00"  # hors de la fenêtre de 90 jours
FUTUR = "2026-10-25T00:00:00+00:00"

COLLECTION = "scheduler_alerts"
SUJET = "litige_arbitrage"


def _job(dispute: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "client_id": "client-sonde",
        "assigned_worker_id": "worker-sonde",
        "title": "Plomberie urgente Dakar",
        "status": "in_progress",
        "dispute": dispute,
    }


def _litige(**champs) -> dict:
    """Un `dispute` TRANCHÉ par défaut, surchargeable."""
    base = {
        "state": litiges.TRANCHE,
        "reason": "Le joint posé fuit au bout de deux jours.",
        "opened_by": "client-sonde",
        "opened_by_role": "client",
        "opened_at": "2026-10-15T00:00:00+00:00",
        "decision_deadline_at": "2026-10-20T00:00:00+00:00",
        "resolved_at": RECENT,
        "decision": "release_worker",
        "decision_note": "Preuve conforme.",
        "decided_by": "proprietaire",
        "payment_outcome": "released",
    }
    return {**base, **champs}


def _reponse(quand: str = "2026-10-20T12:00:00+00:00") -> dict:
    return {
        "position": "release_worker",
        "note": "Le joint a été changé et testé le jour même.",
        "author_id": "worker-sonde",
        "author_role": "worker",
        "responded_at": quand,
    }


async def _decisions(sans_reponse: int, avec_reponse: int = 0, *, quand: str = RECENT):
    """Insère des litiges TRANCHÉS, à la date de décision demandée."""
    for _ in range(sans_reponse):
        await db_insert("jobs", _job(_litige(resolved_at=quand)))
    for _ in range(avec_reponse):
        await db_insert(
            "jobs", _job(_litige(resolved_at=quand, response=_reponse()))
        )


async def _etat():
    return await db_find_one(COLLECTION, {"_id": SUJET})


def _utc(valeur):
    """L'INSTANT d'une date lue en base, quel que soit le stockage.

    MongoDB rend les dates NAÏVES (le fuseau n'est pas conservé, l'instant UTC
    l'est) ; la FakeDB les rend conscientes. Comparer au datetime du test
    jugerait donc le drapeau `tzinfo` et non le fait (leçon du 17/10/2026).
    """
    if valeur is None or valeur.tzinfo is not None:
        return valeur
    return valeur.replace(tzinfo=timezone.utc)


@contextmanager
def _reglages(seuil: float = 0.5, jours: int = 90):
    """Les réglages du passage, fixés : le cas juge la RÈGLE, pas l'env local."""
    with patch("kojo_scheduler.LITIGE_SANS_REPONSE_SEUIL", seuil), patch(
        "kojo_scheduler.LITIGE_SANS_REPONSE_FENETRE_JOURS", jours
    ):
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


# ─────────────────────────── la MESURE de la période ───────────────────────


@pytest.mark.asyncio
class TestMesureSurUnePeriode:
    async def test_la_fenetre_se_juge_sur_la_date_de_decision(self):
        """Une décision d'il y a six mois est HORS fenêtre et le DIT ; c'est la
        décision qui date, pas l'ouverture du litige."""
        await _decisions(sans_reponse=4)
        await _decisions(sans_reponse=6, quand=ANCIEN)

        mesure = await litiges.mesure_sans_reponse(90, maintenant=MAINTENANT)

        assert mesure["tranches"]["total"] == 4
        assert mesure["tranches"]["sans_reponse"] == 4
        assert mesure["hors_fenetre"] == 6
        # 4 < PLANCHER : les comptes sont vrais, le taux n'est pas publié.
        assert mesure["tranches"]["taux_sans_reponse"] is None
        assert mesure["plancher"] == litiges.PLANCHER_MESURE
        assert mesure["depuis"] == (MAINTENANT - timedelta(days=90)).isoformat()
        assert mesure["litiges"]["total"] == 10

    async def test_les_dates_impossibles_sont_comptees_et_exclues(self):
        await _decisions(sans_reponse=10)
        await db_insert("jobs", _job(_litige(resolved_at="pas-une-date")))
        await db_insert("jobs", _job(_litige(resolved_at=FUTUR)))

        mesure = await litiges.mesure_sans_reponse(90, maintenant=MAINTENANT)

        assert mesure["tranches"]["total"] == 10
        assert mesure["resolved_at_illisible"] == 1
        # Une décision datée dans le futur n'a PAS eu lieu : elle n'entre dans
        # aucun dénominateur, et elle est comptée pour que le fait se voie.
        assert mesure["resolved_at_futur"] == 1
        assert mesure["tranches"]["taux_sans_reponse"] == 1.0

    async def test_une_reponse_illisible_n_est_pas_une_absence_de_reponse(self):
        await _decisions(sans_reponse=9)
        await db_insert(
            "jobs",
            _job(
                _litige(
                    resolved_at=RECENT,
                    response=_reponse("pas-une-date"),
                )
            ),
        )

        mesure = await litiges.mesure_sans_reponse(90, maintenant=MAINTENANT)

        assert mesure["tranches"]["avec_reponse"] == 1
        assert mesure["tranches"]["sans_reponse"] == 9
        # Comptée à part, jamais fondue dans « sans réponse ».
        assert mesure["tranches"]["reponse_illisible"] == 1
        assert mesure["tranches"]["taux_sans_reponse"] == 0.9

    async def test_le_plancher_rend_le_taux_none(self):
        await _decisions(sans_reponse=litiges.PLANCHER_MESURE - 1)

        mesure = await litiges.mesure_sans_reponse(90, maintenant=MAINTENANT)

        assert mesure["tranches"]["total"] == litiges.PLANCHER_MESURE - 1
        assert mesure["tranches"]["taux_sans_reponse"] is None

    async def test_seules_les_decisions_tranchees_comptent(self):
        """Un litige ouvert, échu, retiré ou en échec de paiement n'est pas une
        décision : le compter ferait un taux sur des dossiers non tranchés."""
        for etat in (litiges.OUVERT, litiges.EXPIRE, litiges.RETIRE, litiges.ECHEC):
            await db_insert("jobs", _job(_litige(state=etat, resolved_at=None)))

        mesure = await litiges.mesure_sans_reponse(90, maintenant=MAINTENANT)

        assert mesure["tranches"]["total"] == 0
        assert mesure["tranches"]["taux_sans_reponse"] is None
        assert mesure["litiges"]["total"] == 0


# ─────────────────────────── le SEUIL et l'alerte ──────────────────────────


@pytest.mark.asyncio
class TestUneAlerteParDepassement:
    async def test_sous_le_seuil_rien_ne_part_et_l_etat_le_dit(self):
        """Un passage qui ne trouve rien à signaler ÉCRIT quand même sa mesure :
        sans cette écriture, un silence serait indiscernable d'une boucle qui
        n'a pas tourné."""
        await _decisions(sans_reponse=4, avec_reponse=6)

        with _reglages(), _canaux() as (notif, email):
            resume = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )

        assert resume["sante"] == "saine"
        assert resume["taux"] == 0.4
        assert resume["alertes"] == 0
        notif.assert_not_awaited()
        email.assert_not_awaited()
        etat = await _etat()
        assert etat["sante"] == "saine"
        assert etat["taux"] == 0.4
        assert etat["tranches"] == 10
        assert etat["seuil"] == 0.5
        assert etat["fenetre_jours"] == 90

    async def test_depassement_alerte_une_fois_puis_se_tait(self):
        """La promesse : deux passages au-dessus du seuil n'envoient qu'UNE
        alerte, et le second dit son silence."""
        await _decisions(sans_reponse=6, avec_reponse=4)

        with _reglages(), _canaux() as (notif, email):
            premier = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )
            second = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT + timedelta(days=1)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert second["alertes_ignorees"] == 1
        assert notif.await_count == 1
        assert email.await_count == 1

        # La notification in-app porte les CHIFFRES, pas seulement le fait : le
        # propriétaire doit pouvoir décider sans rouvrir la file.
        appel = notif.await_args.kwargs
        assert appel["key"] == "owner_litiges_sans_reponse"
        assert appel["user_id"] == "owner-1"
        assert appel["part"] == 60
        assert appel["seuil"] == 50
        assert appel["jours"] == 90
        assert appel["tranches"] == 10
        assert appel["sans_reponse"] == 6

        assert email.await_args.args[0] == "owner@kojo.sn"
        assert "60 %" in email.await_args.args[1]

        etat = await _etat()
        assert etat["sante"] == "alertee"
        assert etat["taux"] == 0.6
        assert etat["sans_reponse"] == 6
        assert _utc(etat["alertee_at"]) == MAINTENANT
        assert etat["alerte_envoyee"] is True
        assert etat["alerte_erreur"] == ""

    async def test_egalite_au_seuil_n_alerte_pas(self):
        """« DÉPASSE » est strict : 50 % avec un seuil de 50 % n'est pas un
        dépassement. Sinon la valeur annoncée serait déjà une alerte."""
        await _decisions(sans_reponse=5, avec_reponse=5)

        with _reglages(seuil=0.5), _canaux() as (notif, email):
            resume = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )

        assert resume["taux"] == 0.5
        assert resume["alertes"] == 0
        assert resume["sante"] == "saine"
        notif.assert_not_awaited()
        email.assert_not_awaited()

    async def test_sous_le_plancher_n_alerte_pas_et_ne_rearme_pas(self):
        """Un taux `None` n'est pas un rétablissement : sans décisions, il n'y a
        aucune preuve que l'arbitrage va mieux. Réarmer là ferait repartir
        l'alerte au passage suivant, et à chaque fois."""
        await _decisions(sans_reponse=10)
        with _reglages(), _canaux():
            premier = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )
        assert premier["alertes"] == 1

        # La période redevient trop pauvre (neuf décisions) : pas d'alerte, et
        # l'état reste « alertee » — aucune réactivation silencieuse.
        await kojo_scheduler.db.jobs.delete_many({})
        await _decisions(sans_reponse=litiges.PLANCHER_MESURE - 1)

        with _reglages(), _canaux() as (notif, email):
            second = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT + timedelta(days=1)
            )

        assert second["taux"] is None
        assert second["insuffisant"] == 1
        assert second["alertes"] == 0
        notif.assert_not_awaited()
        email.assert_not_awaited()
        etat = await _etat()
        assert etat["sante"] == "alertee"
        assert etat.get("retabli_at") is None

    async def test_retour_sous_le_seuil_rearme_puis_nouveau_depassement(self):
        """Deux dépassements SÉPARÉS par un retour sous le seuil donnent DEUX
        alertes : sans réarmement, la seconde serait muette pour toujours."""
        await _decisions(sans_reponse=10)
        with _reglages(), _canaux() as (notif, email):
            premiere = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )

            # Dix réponses de plus : 10/20 = 50 %, à la valeur du seuil — le
            # retour sous (ou à) la barre réarme.
            await _decisions(sans_reponse=0, avec_reponse=10)
            retour = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT + timedelta(days=1)
            )

            # Quatre décisions sans réponse de plus : 14/24 ≈ 58 %.
            await _decisions(sans_reponse=4)
            seconde = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT + timedelta(days=2)
            )

        assert premiere["alertes"] == 1
        assert retour["alertes"] == 0
        assert retour["retablissements"] == 1
        assert retour["taux"] == 0.5
        assert seconde["alertes"] == 1
        assert seconde["taux"] == 0.583
        assert notif.await_count == 2
        assert email.await_count == 2

        etat = await _etat()
        assert _utc(etat["retabli_at"]) == MAINTENANT + timedelta(days=1)
        assert _utc(etat["alertee_at"]) == MAINTENANT + timedelta(days=2)

    async def test_un_seuil_change_est_un_nouveau_depassement(self):
        """Changer le seuil change ce qui est mesuré : le dépassement est NEUF.
        Le taire donnerait l'impression que la règle n'a pas changé."""
        await _decisions(sans_reponse=10)
        with _canaux() as (notif, email):
            with _reglages(seuil=0.9):
                premier = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                    now=MAINTENANT
                )
            with _reglages(seuil=0.5):
                second = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                    now=MAINTENANT + timedelta(days=1)
                )

        assert premier["alertes"] == 1
        assert second["alertes"] == 1
        assert notif.await_count == 2
        assert email.await_count == 2

    async def test_changer_la_fenetre_est_un_nouveau_depassement(self):
        await _decisions(sans_reponse=10)
        with _canaux() as (notif, _email):
            with _reglages(jours=90):
                await kojo_scheduler.arbitrage_sans_reponse_alert_once(now=MAINTENANT)
            with _reglages(jours=30):
                second = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                    now=MAINTENANT + timedelta(days=1)
                )

        assert second["alertes"] == 1
        assert notif.await_count == 2


@pytest.mark.asyncio
class TestCanaux:
    async def test_un_email_en_echec_est_ecrit_et_ne_realerte_pas(self):
        """L'email est le canal SECONDAIRE : son échec ne doit ni faire croire à
        une alerte reçue, ni faire réessayer à chaque passage."""
        await _decisions(sans_reponse=10)
        with _reglages(), _canaux(
            email_side_effect=RuntimeError("Configuration Brevo incomplète: BREVO_API_KEY")
        ) as (notif, email):
            premier = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
            )
            second = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT + timedelta(days=1)
            )

        assert premier["alertes"] == 1
        assert second["alertes"] == 0
        assert notif.await_count == 1
        assert email.await_count == 1
        etat = await _etat()
        assert etat["alerte_envoyee"] is False
        assert "BREVO_API_KEY" in etat["alerte_erreur"]

    async def test_owner_email_absent_est_dit_et_n_empeche_pas_l_in_app(self):
        await _decisions(sans_reponse=10)
        with _reglages(), patch(
            "kojo_scheduler.resolve_owner_id", AsyncMock(return_value="owner-1")
        ), patch("kojo_scheduler.OWNER_EMAIL", ""), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            resume = await kojo_scheduler.arbitrage_sans_reponse_alert_once(
                now=MAINTENANT
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
        await _decisions(sans_reponse=10)

        with _reglages(), patch(
            "kojo_owner.OWNER_EMAIL", owner["user"]["email"]
        ), patch("kojo_owner.OWNER_USER_ID", "kojo-owner-fantome"), patch(
            "kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]
        ), patch(
            "kojo_scheduler.notify_user_localized", AsyncMock()
        ) as notif, patch(
            "kojo_scheduler.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            await kojo_scheduler.arbitrage_sans_reponse_alert_once(now=MAINTENANT)

        assert notif.await_args.kwargs["user_id"] == owner["user"]["id"]
        assert email.await_args.args[0] == owner["user"]["email"]


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
                kojo_scheduler.litige_arbitrage_alert_loop
            )

        executer.assert_awaited_once()
        nom, duree, travail = executer.await_args.args
        assert nom == "litige_arbitrage_alert"
        assert duree == timedelta(minutes=kojo_scheduler.LITIGE_ALERTE_INTERVAL_MINUTES)
        assert travail is kojo_scheduler.arbitrage_sans_reponse_alert_once


class TestFichiersEtReglages:
    """Les faits de CÂBLAGE qui se lisent dans les fichiers, sans base."""

    def test_la_boucle_est_appelable_sans_horloge(self):
        """Le travail est un POINT D'ENTRÉE à part, qui accepte une horloge.

        Un `callable(...)` ne décrivait rien : la fonction peut exister et ne
        plus rien mesurer. Ce qui rend le cas jugeable sans attendre un jour,
        c'est le paramètre `now` — sans lui, aucun test ne peut arbitrer une
        échéance et la boucle serait le seul chemin d'exécution.
        """
        parametres = inspect.signature(
            kojo_scheduler.arbitrage_sans_reponse_alert_once
        ).parameters
        assert "now" in parametres, (
            "arbitrage_sans_reponse_alert_once doit accepter `now` : sans "
            "horloge injectable, un test ne peut pas juger une période sans "
            "attendre le passage de la boucle."
        )

    def test_server_demarre_et_annule_la_boucle(self):
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "server.py",
            encoding="utf-8",
        ).read()
        assert "asyncio.create_task(litige_arbitrage_alert_loop())" in source, (
            "server.py doit DÉMARRER l'alerte d'arbitrage — une boucle définie "
            "mais jamais lancée n'alerte personne."
        )
        assert "litige_alerte_task.cancel()" in source, (
            "et l'annuler au shutdown, comme les autres boucles."
        )
        assert "litige_alerte_task,\n        )" in source, (
            "une tâche annulée mais absente du gather reste en attente au "
            "shutdown (avertissement « Task was destroyed but it is pending »)."
        )

    def test_le_banc_de_charge_neutralise_la_boucle(self):
        """Le banc mesure le débit : une boucle d'alerte qui relit l'historique
        des litiges fausserait la mesure, et alerterait pour de faux."""
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent
            / "scripts"
            / "charge"
            / "serveur_mesure.py",
            encoding="utf-8",
        ).read()
        assert "server.litige_arbitrage_alert_loop = _boucle_inactive" in source

    def test_les_reglages_sont_bornes(self):
        """Les bornes sont lues dans le module : un seuil à 1 (jamais dépassé)
        ou à 0 (toute décision malheureuse) ne doit pas pouvoir démarrer."""
        assert isinstance(reglages.LITIGE_SANS_REPONSE_SEUIL, float)
        assert 0 < reglages.LITIGE_SANS_REPONSE_SEUIL < 1
        assert 1 <= reglages.LITIGE_SANS_REPONSE_FENETRE_JOURS <= 3650
        assert 1 <= reglages.LITIGE_ALERTE_INTERVAL_MINUTES <= 1440
        # Et le passage lit BIEN ces constantes-là : la MÊME fonction de mesure
        # (aucune seconde règle), et les réglages nommés dans son source (sans
        # quoi une copie pourrait dériver de la valeur publiée).
        assert kojo_scheduler.mesure_sans_reponse is litiges.mesure_sans_reponse
        assert kojo_scheduler.PLANCHER_MESURE == litiges.PLANCHER_MESURE
        source = io.open(
            pathlib.Path(__file__).resolve().parent.parent / "kojo_scheduler.py",
            encoding="utf-8",
        ).read()
        for nom in (
            "LITIGE_SANS_REPONSE_SEUIL",
            "LITIGE_SANS_REPONSE_FENETRE_JOURS",
            "LITIGE_ALERTE_INTERVAL_MINUTES",
        ):
            assert nom in source, "%s n'est pas lu par le passage" % nom
        assert "mesure_sans_reponse(" in source
