# -*- coding: utf-8 -*-
"""Séquestre à deux temps : déclaration, validation, libération automatique.

CE QUE CES TESTS FERMENT

Le trou d'origine : seul le CLIENT pouvait libérer l'argent
(`POST /jobs/{id}/complete`). Un client injoignable laissait donc le travailleur
impayé indéfiniment, sans recours. Ici on prouve les trois issues :

  1. le travailleur DÉCLARE (note + photos), ce qui arme une échéance ;
  2. le client VALIDE, ce qui libère immédiatement ;
  3. sans validation, le balayage LIBÈRE à l'échéance — et le versement passe
     par le même verrou, donc une seule fois.

Ce qui est aussi prouvé : une libération impossible (aucun paiement séquestré)
n'est pas silencieuse et n'est pas retentée en boucle, et la route historique
`/complete` reste utilisable (applications déjà installées).
"""
import asyncio
import contextlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_job_completion as completion
from tests.conftest import (
    BASE_USER,
    WORKER_USER,
    db_find_one,
    db_insert,
    register_and_login,
)

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _job(client_id: str, worker_id: str, **extra) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "assigned_worker_id": worker_id,
        "title": "Plomberie urgente Dakar",
        "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent.",
        "category": "plomberie",
        "budget_min": 10000,
        "budget_max": 30000,
        "location": {"address": "Dakar Plateau, Sénégal"},
        "country": "senegal",
        "status": "in_progress",
        "posted_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


def _paiement(job_id: str, client_id: str, worker_id: str, worker_amount: float = 25800) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "payer_id": client_id,
        "receiver_id": worker_id,
        "amount": 30000,
        "worker_amount": worker_amount,
        "status": "completed",
        "payout_status": "held",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@contextlib.contextmanager
def _paydunya_ok():
    """PayDunya répond success et rien ne sort du processus : ce banc mesure la
    RÈGLE (qui libère, une seule fois), pas le transport d'un tiers."""
    with patch("kojo_job_effects.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "tok-test"}), \
         patch("kojo_job_effects.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_job_completion.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_effects.notify_user_localized", AsyncMock()) as notif:
        yield notif


async def _equipe(client: AsyncClient):
    """Un client, un travailleur attribuable, et leurs en-têtes."""
    client_session = await register_and_login(client, {**BASE_USER, "email": f"client-{uuid.uuid4().hex[:6]}@kojo.sn"})
    worker_session = await register_and_login(client, {**WORKER_USER, "email": f"worker-{uuid.uuid4().hex[:6]}@kojo.sn"})
    return {
        "client_id": client_session["user"]["id"],
        "client_headers": {"Authorization": f"Bearer {client_session['access_token']}"},
        "worker_id": worker_session["user"]["id"],
        "worker_headers": {"Authorization": f"Bearer {worker_session['access_token']}"},
    }


@pytest.mark.asyncio
class TestDeclaration:
    async def test_le_travailleur_declare_la_fin_et_arme_l_echeance(self, client: AsyncClient):
        """La déclaration pose l'échéance, prévient le client, et NE clôt PAS
        la mission : elle reste `in_progress` tant que l'argent n'est pas parti."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paydunya_ok() as notif:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion",
                headers=equipe["worker_headers"],
                json={
                    "note": "Fuite réparée, joint changé et test d'étanchéité effectué.",
                    "proofs": ["https://res.cloudinary.com/kojo/image/upload/preuve.jpg"],
                },
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["status"] == "in_progress"
        assert stocke["completion"]["state"] == completion.MARKED
        assert stocke["completion"]["marked_by"] == equipe["worker_id"]
        assert stocke["completion"]["proofs"] == ["https://res.cloudinary.com/kojo/image/upload/preuve.jpg"]

        echeance = datetime.fromisoformat(stocke["completion"]["auto_release_at"])
        attendu = datetime.now(timezone.utc) + timedelta(days=completion.COMPLETION_AUTO_RELEASE_DAYS)
        assert abs((echeance - attendu).total_seconds()) < 120

        # Le client est prévenu, avec la date de libération automatique.
        notif.assert_called_once()
        assert notif.call_args.kwargs["key"] == "completion_marked_client"
        assert notif.call_args.kwargs["date"]

        evenement = await db_find_one(
            "business_events", {"cle": f"mission_completion_marked:{job['id']}"}
        )
        assert evenement is not None
        assert evenement["type"] == "mission_completion_marked"

    async def test_un_autre_compte_ne_peut_pas_declarer(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        for entetes in (equipe["client_headers"],):
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion",
                headers=entetes,
                json={"note": "Je déclare un travail que je n'ai pas fait, vraiment."},
            )
            assert resp.status_code == 403, resp.text

        autre = await register_and_login(client, {**WORKER_USER, "email": f"autre-{uuid.uuid4().hex[:6]}@kojo.sn"})
        resp = await client.post(
            f"/api/jobs/{job['id']}/completion",
            headers={"Authorization": f"Bearer {autre['access_token']}"},
            json={"note": "Je déclare un travail que je n'ai pas fait, vraiment."},
        )
        assert resp.status_code == 403, resp.text

        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert not stocke.get("completion")

    async def test_une_declaration_se_double_refusee(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paydunya_ok():
            premier = await client.post(
                f"/api/jobs/{job['id']}/completion",
                headers=equipe["worker_headers"],
                json={"note": "Fuite réparée, joint changé et test effectué."},
            )
            second = await client.post(
                f"/api/jobs/{job['id']}/completion",
                headers=equipe["worker_headers"],
                json={"note": "Fuite réparée, joint changé et test effectué."},
            )
            await asyncio.sleep(0)

        assert premier.status_code == 200
        assert second.status_code == 409
        assert "déjà" in second.json()["detail"].lower()

    async def test_une_preuve_hors_cloudinary_est_refusee(self, client: AsyncClient):
        """Une URL arbitraire ferait charger un tiers dans la page du client."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/completion",
            headers=equipe["worker_headers"],
            json={
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": ["https://exemple-malveillant.test/preuve.png"],
            },
        )
        assert resp.status_code == 422

    async def test_une_note_trop_courte_est_refusee(self, client: AsyncClient):
        """La note est la preuve minimale opposable : vide ou d'une ligne, elle
        ne donne au client rien à valider et n'oppose rien en cas de litige."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/completion",
            headers=equipe["worker_headers"],
            json={"note": "Fait."},
        )
        assert resp.status_code == 422
        assert not (await db_find_one("jobs", {"id": job["id"]})).get("completion")

    async def test_la_preuve_photo_est_televersee_pour_le_travailleur_attribue(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with patch(
            "kojo_routers_jobs_completion.upload_image_to_cloudinary",
            return_value={"photo_url": "https://res.cloudinary.com/kojo/image/upload/p.jpg"},
        ):
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/proof",
                headers=equipe["worker_headers"],
                files={"file": ("preuve.png", PNG_BYTES, "image/png")},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["proof_url"].startswith("https://res.cloudinary.com/")

        refus = await client.post(
            f"/api/jobs/{job['id']}/completion/proof",
            headers=equipe["client_headers"],
            files={"file": ("preuve.png", PNG_BYTES, "image/png")},
        )
        assert refus.status_code == 403


@pytest.mark.asyncio
class TestValidationClient:
    async def test_le_client_valide_et_le_versement_ne_part_qu_une_fois(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok():
            declare = await client.post(
                f"/api/jobs/{job['id']}/completion",
                headers=equipe["worker_headers"],
                json={"note": "Fuite réparée, joint changé et test d'étanchéité."},
            )
            assert declare.status_code == 200, declare.text

        with _paydunya_ok() as notif:
            valide = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert valide.status_code == 200, valide.text
        assert valide.json()["payout_status"] == "released"

        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["status"] == "completed"
        assert stocke["completion"]["state"] == completion.CONFIRMED
        assert stocke["completion"]["confirmed_at"]

        sequestre = await db_find_one("payments", {"id": paiement["id"]})
        assert sequestre["payout_status"] == "released"

        evenement = await db_find_one(
            "business_events", {"cle": f"mission_completion_confirmed:{job['id']}"}
        )
        assert evenement is not None

        # Rejouer la validation ne repaie pas : l'état n'est plus `marked`.
        with _paydunya_ok() as second_submit:
            rejoue = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)
        assert rejoue.status_code == 409
        second_submit.assert_not_called()

    async def test_le_travailleur_ne_valide_pas_a_la_place_du_client(self, client: AsyncClient):
        """Celui qui déclare n'est pas celui qui paie : sinon la validation ne
        serait qu'un clic du travailleur sur son propre versement."""
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            },
        )
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["worker_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        submit.assert_not_called()
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "held"

    async def test_valider_sans_declaration_est_refuse(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/completion/confirm",
            headers=equipe["client_headers"],
        )
        assert resp.status_code == 409
        assert "validation" in resp.json()["detail"].lower()


@pytest.mark.asyncio
class TestLiberationAutomatique:
    async def test_a_l_echeance_le_travailleur_est_paye_sans_le_client(self, client: AsyncClient):
        equipe = await _equipe(client)
        echeance = datetime.now(timezone.utc) - timedelta(minutes=1)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": (echeance - timedelta(days=7)).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": echeance.isoformat(),
            },
        )
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as notif:
            resume = await completion.passage_liberations_auto()
            await asyncio.sleep(0)

        # `frozen` compte les missions qu'un litige OUVERT a gelées : 0 ici, et
        # c'est un compteur distinct d'un échec — le journal doit pouvoir dire
        # « gelé par contestation » sans le confondre avec « libération ratée ».
        assert resume == {"due": 1, "released": 1, "blocked": 0, "skipped": 0, "frozen": 0}
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["status"] == "completed"
        assert stocke["completion"]["state"] == completion.AUTO_RELEASED
        assert stocke["completion"]["auto_released_at"]
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

        evenement = await db_find_one("business_events", {"cle": f"mission_auto_released:{job['id']}"})
        assert evenement is not None

        # Les deux côtés sont prévenus, et le travailleur l'est en premier.
        cles = [appel.kwargs["key"] for appel in notif.call_args_list]
        assert "completion_auto_released_worker" in cles
        assert "completion_auto_released_client" in cles

    async def test_avant_l_echeance_rien_ne_part(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            },
        )
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _paydunya_ok() as notif:
            resume = await completion.passage_liberations_auto()
            await asyncio.sleep(0)

        assert resume["due"] == 0
        notif.assert_not_called()
        assert (await db_find_one("jobs", {"id": job["id"]}))["status"] == "in_progress"

    async def test_une_mission_close_entre_temps_est_reconciliee(self, client: AsyncClient):
        """La mission a été payée par un autre chemin (route historique, ou
        validation client au même instant) pendant que la déclaration attendait.
        La déclaration doit SUIVRE cet état : laissée `marked`, le balayage la
        repasserait toutes les heures sans jamais rien écrire."""
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            status="completed",
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
            },
        )
        paiement = {
            **_paiement(job["id"], equipe["client_id"], equipe["worker_id"]),
            "payout_status": "released",
        }
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as submit:
            premier = await completion.passage_liberations_auto()
            await asyncio.sleep(0)
            second = await completion.passage_liberations_auto()

        # Aucun second versement, et la déclaration cesse d'être « en attente ».
        submit.assert_not_called()
        assert premier == {"due": 1, "released": 0, "blocked": 0, "skipped": 1, "frozen": 0}
        assert second["due"] == 0

        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["completion"]["state"] == completion.CONFIRMED
        assert stocke["completion"]["confirmed_at"]
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_sans_sequestre_la_liberation_est_dite_et_non_retentee(self, client: AsyncClient):
        """Aucun paiement confirmé : on ne peut pas payer, et on ne réessaie pas
        toutes les heures en silence. L'état le dit, avec son motif."""
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            },
        )
        await db_insert("jobs", job)

        with _paydunya_ok() as notif:
            premier = await completion.passage_liberations_auto()
            await asyncio.sleep(0)
            second = await completion.passage_liberations_auto()

        assert premier == {"due": 1, "released": 0, "blocked": 1, "skipped": 0, "frozen": 0}
        assert second["due"] == 0

        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["completion"]["state"] == completion.AUTO_RELEASE_BLOCKED
        assert "Aucun paiement" in stocke["completion"]["blocked_reason"]
        assert stocke["status"] == "in_progress"
        assert any(c.kwargs["key"] == "completion_blocked_client" for c in notif.call_args_list)


@pytest.mark.asyncio
class TestRouteHistorique:
    async def test_complete_reste_utilisable_et_paie_une_mission_non_declaree(self, client: AsyncClient):
        """Les applications installées appellent `/complete` : la route ne casse
        pas, et elle entre dans le MÊME versement (un seul propriétaire)."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok():
            resp = await client.post(f"/api/jobs/{job['id']}/complete", headers=equipe["client_headers"])
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        assert resp.json()["payout_status"] == "released"
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["status"] == "completed"
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_complete_sur_une_declaration_la_marque_validee(self, client: AsyncClient):
        """Un client qui paie avant de valider ne laisse pas l'écran bloqué sur
        « en attente » : la déclaration devient `confirmed`."""
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                "auto_release_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            },
        )
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _paydunya_ok():
            resp = await client.post(f"/api/jobs/{job['id']}/complete", headers=equipe["client_headers"])

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["completion"]["state"] == completion.CONFIRMED
        assert stocke["completion"]["confirmed_at"]


@pytest.mark.asyncio
class TestReglages:
    async def test_le_delai_vient_du_reglage_et_pas_d_une_copie(self, client: AsyncClient):
        """Le délai se LIT dans `COMPLETION_AUTO_RELEASE_DAYS` : aucun nombre
        n'est recopié dans le module de déclaration."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with patch.object(completion, "COMPLETION_AUTO_RELEASE_DAYS", 3):
            with _paydunya_ok():
                resp = await client.post(
                    f"/api/jobs/{job['id']}/completion",
                    headers=equipe["worker_headers"],
                    json={"note": "Fuite réparée, joint changé et test d'étanchéité."},
                )
                await asyncio.sleep(0)

        assert resp.status_code == 200
        stocke = await db_find_one("jobs", {"id": job["id"]})
        echeance = datetime.fromisoformat(stocke["completion"]["auto_release_at"])
        marque = datetime.fromisoformat(stocke["completion"]["marked_at"])
        assert timedelta(days=2, hours=23) < (echeance - marque) < timedelta(days=3, hours=1)
