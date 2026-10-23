# -*- coding: utf-8 -*-
"""MESURE des relances clients : ont-elles fait arriver des candidatures ?

CE QUE CES CAS FERMENT

La relance dit au client qu'il peut corriger son prix, sa date ou son quartier.
Elle ne dit pas si la mission a ENSUITE reçu une candidature — et le compteur
d'envois ne le dira jamais : un envoi n'est pas un effet. Sans cette mesure, le
dépôt saurait combien de messages sont partis et pas s'ils servent à quelque
chose, c'est-à-dire exactement le silence que les alertes de la place existent
pour fermer.

Ce qui est jugé, et pourquoi chaque cas existe :

  • UNE CANDIDATURE NE COMPTE QUE SI ELLE EST ARRIVÉE APRÈS LA RELANCE : une
    candidature antérieure sur une mission relancée est une CONTRADICTION,
    comptée à part (`candidature_prealable`), jamais recasée en succès.
  • UNE DATE ILLISIBLE n'est ni un succès ni un échec : marqueur illisible,
    futur ou hors fenêtre sont COMPTÉS et exclus ; une candidature sans date
    lisible a son propre compteur.
  • LE PLANCHER : sous `RELANCE_PLANCHER_MESURE` relances mesurées, le taux vaut
    `None` et les comptes restent publiés. 0 % publié reste une mesure, `None`
    n'en est pas une.
  • UNE LECTURE TRONQUÉE ne publie AUCUN taux : on ne sait plus quelles missions
    ont reçu une candidature, donc conclure serait inventer.
  • LE COMPTEUR DU PROCESS compte les envois ; un envoi en échec est compté et
    laisse la mission à relancer (aucun marqueur posé).
  • LA ROUTE est réservée au propriétaire, et `/metrics` publie les deux
    familles du compteur (leur nom est vérifié par le test des métriques, qui
    exige aussi leur présence dans `METRIQUES.md`).
"""
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_metrics
import kojo_scheduler
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

MAINTENANT = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)


def _il_y_a(jours: float = 0, heures: float = 0) -> str:
    return (
        MAINTENANT - timedelta(days=jours, hours=heures)
    ).isoformat()


def _job(
    identifiant: str,
    relance_le: str | None = None,
    client: str = "client-1",
    **champs,
) -> dict:
    doc = {
        "id": identifiant,
        "client_id": client,
        "title": "Plomberie %s" % identifiant,
        "status": "open",
        "posted_at": _il_y_a(jours=2),
    }
    if relance_le is not None:
        doc["nudge_sans_proposition_at"] = relance_le
    return {**doc, **champs}


async def _proposition(job_id: str, cree_le: str | None, statut: str = "pending") -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "worker_id": "worker-sonde",
        "status": statut,
        "message": "Je peux passer demain matin.",
        "proposed_price": 22000,
    }
    if cree_le is not None:
        doc["created_at"] = cree_le
    await db_insert("job_proposals", doc)
    return doc


async def _owner(client: AsyncClient) -> dict:
    session = await register_and_login(
        client,
        {
            **BASE_USER,
            "email": "owner-%s@kojo.sn" % uuid.uuid4().hex[:6],
            "user_type": "owner",
        },
    )
    return {
        "id": session["user"]["id"],
        "email": session["user"]["email"],
        "headers": {"Authorization": "Bearer %s" % session["access_token"]},
    }


@contextmanager
def _en_tant_que_proprietaire(owner: dict):
    with patch("kojo_owner.OWNER_EMAIL", owner["email"]), patch(
        "kojo_owner.OWNER_USER_ID", owner["id"]
    ):
        yield


@contextmanager
def _compteurs_vierges():
    """Les compteurs sont ceux du PROCESS : un test les remet à zéro."""
    with patch.dict(
        "kojo_scheduler._compteurs_relance", {"envoyees": 0, "echecs": 0}, clear=True
    ):
        yield


# ─────────────────────── ce qui compte comme un effet ──────────────────────


@pytest.mark.asyncio
class TestEffetDeLaRelance:
    async def test_une_candidature_apres_la_relance_est_un_succes(self):
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=3)))
        await _proposition("job-1", _il_y_a(heures=1))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == 1
        assert mesures["avec_candidature"] == 1
        assert mesures["sans_candidature"] == 0
        assert mesures["delai_candidature"]["n"] == 1
        assert mesures["delai_candidature"]["mediane_heures"] == 2.0

    async def test_une_candidature_anterieure_n_est_pas_un_effet(self):
        """La mission a été relancée alors qu'une candidature existait déjà :
        la donnée se contredit, et la compter en succès flatterait la relance."""
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=2)))
        await _proposition("job-1", _il_y_a(heures=5))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["avec_candidature"] == 0
        assert mesures["exclusions"]["candidature_prealable"] == 1
        assert mesures["delai_candidature"]["n"] == 0

    async def test_une_mission_sans_candidature_reste_un_echec_mesure(self):
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=4)))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == 1
        assert mesures["sans_candidature"] == 1
        assert mesures["avec_candidature"] == 0

    async def test_une_candidature_sans_date_ne_devient_pas_un_succes_ni_un_echec(self):
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=4)))
        await _proposition("job-1", None)

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["avec_candidature"] == 0
        assert mesures["sans_candidature"] == 0
        assert mesures["exclusions"]["propositions_date_illisible"] == 1

    async def test_le_delai_est_median_moyen_et_pire(self):
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=10)))
        await db_insert("jobs", _job("job-2", relance_le=_il_y_a(heures=10)))
        await db_insert("jobs", _job("job-3", relance_le=_il_y_a(heures=10)))
        await _proposition("job-1", _il_y_a(heures=8))  # 2 h
        await _proposition("job-2", _il_y_a(heures=4))  # 6 h
        await _proposition("job-3", _il_y_a(heures=1))  # 9 h

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)
        delais = mesures["delai_candidature"]

        assert delais["n"] == 3
        assert delais["mediane_heures"] == 6.0
        assert delais["moyenne_heures"] == round((2 + 6 + 9) / 3, 1)
        assert delais["max_heures"] == 9.0

    async def test_une_mission_avec_plusieurs_formes_d_identifiant_est_reliee(self):
        """Une proposition peut désigner la mission par `job_id` ou par `_id` :
        ne lire qu'une forme laisserait croire qu'aucune candidature n'est
        arrivée."""
        await db_insert(
            "jobs",
            {**_job(None), "id": "job-formes", "_id": "mongo-42", "nudge_sans_proposition_at": _il_y_a(heures=5)},
        )
        await db_insert(
            "job_proposals",
            {
                "id": "prop-importee",
                "job_id": "",
                "_id": "mongo-42",
                "status": "pending",
                "created_at": _il_y_a(heures=1),
            },
        )

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["avec_candidature"] == 1


# ───────────────────────────── les prémisses ───────────────────────────────


@pytest.mark.asyncio
class TestPremissesEtBornes:
    async def test_un_marqueur_illisible_est_compte_et_exclu(self):
        await db_insert("jobs", _job("job-1", relance_le="pas-une-date"))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == 0
        assert mesures["exclusions"]["date_illisible"] == 1

    async def test_un_marqueur_futur_est_compte_et_exclu(self):
        """Une date future ne devient pas « maintenant » : elle est mesurée
        comme impossible, pas comme une relance qui vient de partir."""
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=-2)))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == 0
        assert mesures["exclusions"]["date_future"] == 1

    async def test_un_marqueur_hors_fenetre_est_compte_et_exclu(self):
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(jours=45)))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == 0
        assert mesures["exclusions"]["hors_fenetre"] == 1
        assert mesures["fenetre_jours"] == kojo_scheduler.RELANCE_FENETRE_JOURS

    async def test_le_taux_reste_non_publie_sous_le_plancher(self):
        for index in range(kojo_scheduler.RELANCE_PLANCHER_MESURE - 1):
            await db_insert("jobs", _job("job-%s" % index, relance_le=_il_y_a(heures=4)))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["mesurees"] == kojo_scheduler.RELANCE_PLANCHER_MESURE - 1
        assert mesures["taux_candidature"] is None, (
            "un pourcentage sur %s relances est du bruit, pas une mesure"
            % mesures["mesurees"]
        )
        assert mesures["plancher"] == kojo_scheduler.RELANCE_PLANCHER_MESURE

    async def test_le_taux_est_publie_au_plancher(self):
        for index in range(kojo_scheduler.RELANCE_PLANCHER_MESURE):
            await db_insert("jobs", _job("job-%s" % index, relance_le=_il_y_a(heures=4)))
        for index in range(4):
            await _proposition("job-%s" % index, _il_y_a(heures=1))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["taux_candidature"] == 0.4
        assert mesures["avec_candidature"] == 4
        assert mesures["mesurees"] == kojo_scheduler.RELANCE_PLANCHER_MESURE

    async def test_zero_pour_cent_publie_reste_une_mesure(self):
        for index in range(kojo_scheduler.RELANCE_PLANCHER_MESURE):
            await db_insert("jobs", _job("job-%s" % index, relance_le=_il_y_a(heures=4)))

        mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["taux_candidature"] == 0.0
        assert mesures["taux_candidature"] is not None

    async def test_une_lecture_tronquee_ne_publie_aucun_taux(self):
        for index in range(3):
            await db_insert("jobs", _job("job-%s" % index, relance_le=_il_y_a(heures=4)))

        with patch("kojo_scheduler.MAX_RELANCEES_MESUREES", 2):
            mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["relances"]["tronque"] is True
        assert mesures["exclusions"]["mesure_tronquee"] is True
        assert mesures["taux_candidature"] is None

    async def test_des_propositions_tronquees_ne_publient_aucun_taux(self):
        for index in range(kojo_scheduler.RELANCE_PLANCHER_MESURE):
            await db_insert("jobs", _job("job-%s" % index, relance_le=_il_y_a(heures=4)))
            await _proposition("job-%s" % index, _il_y_a(heures=1))

        with patch("kojo_scheduler.MAX_PROPOSITIONS_LUES", 2):
            mesures = await kojo_scheduler.mesure_relances(now=MAINTENANT)

        assert mesures["exclusions"]["propositions_tronquees"] is True
        assert mesures["taux_candidature"] is None, (
            "sans savoir quelles missions ont reçu une candidature, aucun taux "
            "ne se publie"
        )


# ─────────────────────── le compteur et sa publication ─────────────────────


@pytest.mark.asyncio
class TestCompteurEtPublication:
    async def test_une_relance_envoyee_est_comptee(self):
        await db_insert(
            "jobs",
            {
                "id": "job-envoyee",
                "client_id": "client-1",
                "title": "Fuite",
                "status": "open",
                "posted_at": (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat(),
            },
        )

        with _compteurs_vierges(), patch(
            "kojo_scheduler.CLIENT_SANS_PROPOSITION_HEURES", 1
        ), patch("kojo_scheduler.notify_user_localized", new_callable=AsyncMock):
            resume = await kojo_scheduler.clients_sans_proposition_once()
            compteurs = kojo_scheduler.relance_stats()

        assert resume["relances"] == 1
        assert compteurs["envoyees"] == 1
        assert compteurs["echecs"] == 0

    async def test_un_envoi_qui_echoue_est_compte_et_ne_marque_pas_la_mission(self):
        await db_insert(
            "jobs",
            {
                "id": "job-echec",
                "client_id": "client-1",
                "title": "Fuite",
                "status": "open",
                "posted_at": (datetime.now(timezone.utc) - timedelta(hours=9)).isoformat(),
            },
        )

        with _compteurs_vierges(), patch(
            "kojo_scheduler.CLIENT_SANS_PROPOSITION_HEURES", 1
        ), patch(
            "kojo_scheduler.notify_user_localized",
            new_callable=AsyncMock,
            side_effect=RuntimeError("push refuse"),
        ):
            with pytest.raises(RuntimeError):
                await kojo_scheduler.clients_sans_proposition_once()
            compteurs = kojo_scheduler.relance_stats()

        assert compteurs["echecs"] == 1
        assert compteurs["envoyees"] == 0
        mission = await db_find_one("jobs", {"id": "job-echec"})
        assert mission.get("nudge_sans_proposition_at") is None, (
            "un envoi raté qui pose le marqueur perd la mission pour toujours"
        )

    async def test_les_deux_familles_sortent_sur_metrics(self):
        with patch.dict(
            "kojo_scheduler._compteurs_relance",
            {"envoyees": 7, "echecs": 2},
            clear=True,
        ):
            texte = kojo_metrics.rendre()

        assert "kojo_relances_envoyees_total 7" in texte
        assert "kojo_relances_echecs_total 2" in texte
        assert "# TYPE kojo_relances_envoyees_total counter" in texte

    async def test_la_route_est_reservee_au_proprietaire(self, client: AsyncClient):
        owner = await _owner(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": "tiers-%s@kojo.sn" % uuid.uuid4().hex[:6]}
        )
        await db_insert("jobs", _job("job-1", relance_le=_il_y_a(heures=4)))
        await _proposition("job-1", _il_y_a(heures=1))

        refuse = await client.get(
            "/api/owner/relances/mesures",
            headers={"Authorization": "Bearer %s" % intrus["access_token"]},
        )
        with _en_tant_que_proprietaire(owner):
            accepte = await client.get(
                "/api/owner/relances/mesures", headers=owner["headers"]
            )

        assert refuse.status_code == 403, refuse.text
        assert accepte.status_code == 200, accepte.text
        corps = accepte.json()
        assert corps["mesurees"] >= 1
        assert corps["avec_candidature"] >= 1
        assert corps["plancher"] == kojo_scheduler.RELANCE_PLANCHER_MESURE
        assert corps["fenetre_jours"] == kojo_scheduler.RELANCE_FENETRE_JOURS
        # Sous le plancher, le taux n'est pas publié — la route le DIT au lieu
        # de rendre un pourcentage muet.
        assert corps["taux_candidature"] is None


class TestLaFenetreEstDeclaree:
    def test_la_fenetre_par_defaut_vient_d_une_constante(self):
        assert kojo_scheduler.RELANCE_FENETRE_JOURS == 30

    def test_le_plancher_est_celui_de_l_arbitrage(self):
        """Deux planchers différents rendraient deux taux incomparables."""
        import kojo_job_disputes as litiges

        assert kojo_scheduler.RELANCE_PLANCHER_MESURE == litiges.PLANCHER_MESURE
