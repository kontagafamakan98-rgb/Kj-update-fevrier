# -*- coding: utf-8 -*-
"""Litige tracé : état, échéance, décision du propriétaire, journal.

CE QUE CES TESTS FERMENT

Le séquestre à deux temps réglait le client SILENCIEUX. Il ne réglait pas le
client qui CONTESTE : l'échéance de libération automatique payait le
travailleur sans qu'aucun arbitre ait lu le désaccord, et un litige déclaré ne
laissait aucune trace — ni état, ni échéance, ni décision. Un désaccord et une
absence produisaient donc le même geste.

Ce qui est prouvé ici, dans l'ordre du parcours :

  1. une partie ouvre (motif exigé, échéance posée, autre partie + propriétaire
     prévenus) ;
  2. tant qu'il vit, l'argent est GELÉ : ni validation du client, ni route
     historique, ni balayage de libération ne le versent ;
  3. l'AUTRE partie répond UNE fois (position + note bornée), et c'est cette
     deuxième version que le propriétaire lit avec la première ;
  4. l'ouvreur peut le retirer, et l'argent repart ;
  5. le propriétaire tranche — verser ou rembourser — par les propriétaires
     UNIQUES de chaque chemin (aucun double versement possible) ;
  6. l'échéance fait foi : passée sans décision, le litige se referme et la
     règle ordinaire reprend ;
  7. chaque fait entre dans `business_events`, avec des détails ÉNUMÉRÉS —
     jamais le motif ni la note, qui sont des proses écrites par une partie ;
  8. une décision dont le PAIEMENT échoue (séquestre introuvable, décaissement
     refusé) ne referme pas le désaccord : elle laisse un jalon nommé avec son
     code d'échec, reste dans la file, gèle encore l'argent, et peut être
     RELANCÉE — une décision « tranchée » sans argent versé est le silence que
     ce module existe pour fermer.
"""
import asyncio
import contextlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

import kojo_core as core
import kojo_job_completion as completion
import kojo_job_disputes as litiges
from tests.conftest import (
    BASE_USER,
    WORKER_USER,
    db_find_one,
    db_insert,
    register_and_login,
)

MOTIF = "Le joint posé fuit au bout de deux jours, le travail n'est pas fini."
REPONSE = "Le joint a été changé et testé le jour même ; la fuite vient du siphon, pas de mon travail."


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


def _paiement(job_id: str, client_id: str, worker_id: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "payer_id": client_id,
        "receiver_id": worker_id,
        "amount": 30000,
        "worker_amount": 25800,
        "status": "completed",
        "payout_status": "held",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@contextlib.contextmanager
def _paiements_simules():
    """PayDunya répond success et rien ne sort du processus.

    Ce banc mesure la RÈGLE (qui peut payer, une seule fois, et sous quelle
    condition), pas le transport d'un tiers.
    """
    with patch("kojo_job_effects.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "tok-test"}), \
         patch("kojo_job_effects.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}), \
         patch("kojo_job_completion.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_refunds.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_effects.notify_user_localized", AsyncMock()) as notif:
        yield notif


NOTE_DECISION = "Preuve conforme : la déclaration, les trois photos et le délai sont vérifiés."


@contextlib.contextmanager
def _decaissement_refuse(detail: str = "Solde PayDunya insuffisant"):
    """PayDunya REFUSE la facture de décaissement : échec SÛR, donc relançable.

    Le chemin de paiement distingue un refus explicite (rien n'a été exécuté)
    d'une réponse INCERTAINE (le versement a peut-être eu lieu) : c'est le refus
    qu'on simule ici, parce que c'est lui qui doit laisser une trace et une
    relance sans risquer un double paiement.
    """
    with patch("kojo_job_effects.create_paydunya_disburse_invoice",
               side_effect=HTTPException(status_code=400, detail=detail)), \
         patch("kojo_job_completion.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_refunds.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_effects.notify_user_localized", AsyncMock()) as notif:
        yield notif


async def _equipe(client: AsyncClient):
    client_session = await register_and_login(
        client, {**BASE_USER, "email": f"client-{uuid.uuid4().hex[:6]}@kojo.sn"}
    )
    worker_session = await register_and_login(
        client, {**WORKER_USER, "email": f"worker-{uuid.uuid4().hex[:6]}@kojo.sn"}
    )
    return {
        "client_id": client_session["user"]["id"],
        "client_headers": {"Authorization": f"Bearer {client_session['access_token']}"},
        "worker_id": worker_session["user"]["id"],
        "worker_headers": {"Authorization": f"Bearer {worker_session['access_token']}"},
    }


async def _owner(client: AsyncClient):
    session = await register_and_login(
        client, {**BASE_USER, "email": f"owner-{uuid.uuid4().hex[:6]}@kojo.sn", "user_type": "owner"}
    )
    return {
        "id": session["user"]["id"],
        "email": session["user"]["email"],
        "headers": {"Authorization": f"Bearer {session['access_token']}"},
    }


@contextlib.contextmanager
def _en_tant_que_proprietaire(owner: dict):
    with patch("kojo_owner.OWNER_EMAIL", owner["email"]), \
         patch("kojo_owner.OWNER_USER_ID", owner["id"]):
        yield


@pytest.mark.asyncio
class TestOuverture:
    async def test_le_client_ouvre_le_litige_et_gele_le_paiement(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _en_tant_que_proprietaire(owner), _paiements_simules() as notif:
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute",
                headers=equipe["client_headers"],
                json={"reason": MOTIF},
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["dispute"]["state"] == litiges.OUVERT
        assert stocke["dispute"]["opened_by"] == equipe["client_id"]
        assert stocke["dispute"]["opened_by_role"] == "client"
        assert stocke["dispute"]["reason"] == MOTIF

        echeance = datetime.fromisoformat(stocke["dispute"]["decision_deadline_at"])
        attendu = datetime.now(timezone.utc) + timedelta(days=litiges.LITIGE_DECISION_DAYS)
        assert abs((echeance - attendu).total_seconds()) < 120

        # L'autre partie ET le propriétaire sont prévenus : un litige dont
        # personne n'apprend l'existence est un litige que personne ne tranche.
        cles = [appel.kwargs.get("key") for appel in notif.call_args_list]
        assert "dispute_opened_worker" in cles
        assert "dispute_opened_owner" in cles

        evenement = await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_opened"}
        )
        assert evenement is not None
        # Le journal date la FENÊTRE : c'est ce qui permet de relire, plus
        # tard, combien de temps le désaccord est resté sans arbitre.
        assert evenement["details"]["echeance"] == stocke["dispute"]["decision_deadline_at"]

    async def test_le_travailleur_ouvre_le_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules() as notif:
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute",
                headers=equipe["worker_headers"],
                json={"reason": MOTIF},
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["dispute"]["opened_by_role"] == "worker"
        assert "dispute_opened_client" in [a.kwargs.get("key") for a in notif.call_args_list]

    async def test_un_tiers_ne_peut_pas_ouvrir_un_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": f"intrus-{uuid.uuid4().hex[:6]}@kojo.sn"}
        )
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/dispute",
            headers={"Authorization": f"Bearer {intrus['access_token']}"},
            json={"reason": MOTIF},
        )
        assert resp.status_code == 403, resp.text
        assert (await db_find_one("jobs", {"id": job["id"]})).get("dispute") is None

    async def test_un_motif_trop_court_est_refuse(self, client: AsyncClient):
        """Un litige sans motif serait une contestation muette, donc intraitable."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/dispute",
            headers=equipe["client_headers"],
            json={"reason": "fuit"},
        )
        assert resp.status_code == 422, resp.text

    async def test_pas_de_litige_sur_une_mission_non_attribuee(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"], status="open", assigned_worker_id=None)
        await db_insert("jobs", job)

        resp = await client.post(
            f"/api/jobs/{job['id']}/dispute",
            headers=equipe["client_headers"],
            json={"reason": MOTIF},
        )
        assert resp.status_code == 400, resp.text

    async def test_un_second_litige_est_refuse_tant_que_le_premier_vit(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            premier = await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            second = await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["worker_headers"], json={"reason": MOTIF}
            )

        assert premier.status_code == 200, premier.text
        assert second.status_code == 409, second.text


@pytest.mark.asyncio
class TestGelDuPaiement:
    async def test_la_liberation_automatique_ne_paie_pas_par_dessus_un_litige(self, client: AsyncClient):
        """LE test du module : sans lui, contester ne sert à rien."""
        equipe = await _equipe(client)
        echeance_passee = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        job = _job(
            equipe["client_id"], equipe["worker_id"],
            completion={
                "state": "marked",
                "note": "Fuite réparée, joint changé et test d'étanchéité effectué.",
                "proofs": [],
                "marked_at": echeance_passee,
                "marked_by": equipe["worker_id"],
                "auto_release_at": echeance_passee,
            },
        )
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules() as notif:
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resume = await litiges.passage_litiges_expires()  # non échu encore
            resultat = await completion.passage_liberations_auto()
            await asyncio.sleep(0)

        assert resume["due"] == 0
        # Le litige est exclu de la REQUÊTE : la mission contestée ne consomme
        # même pas une place du passage.
        assert resultat["due"] == 0
        assert resultat["released"] == 0
        stocke = await db_find_one("payments", {"id": paiement["id"]})
        assert stocke["payout_status"] == "held"
        assert (await db_find_one("jobs", {"id": job["id"]}))["status"] == "in_progress"

    async def test_la_validation_du_client_est_refusee_pendant_le_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(
            equipe["client_id"], equipe["worker_id"],
            completion={"state": "marked", "note": "Travail déclaré terminé, preuve jointe.", "proofs": []},
        )
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["worker_headers"], json={"reason": MOTIF}
            )
            validation = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm", headers=equipe["client_headers"]
            )
            historique = await client.post(
                f"/api/jobs/{job['id']}/complete", headers=equipe["client_headers"]
            )

        assert validation.status_code == 409, validation.text
        assert "litige" in validation.json()["detail"].lower()
        # La route HISTORIQUE n'est pas une porte de service du litige.
        assert historique.status_code == 409, historique.text

    async def test_le_retrait_rend_le_paiement_a_la_regle_ordinaire(self, client: AsyncClient):
        equipe = await _equipe(client)
        echeance_passee = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        job = _job(
            equipe["client_id"], equipe["worker_id"],
            completion={
                "state": "marked",
                "note": "Fuite réparée, joint changé et test d'étanchéité effectué.",
                "proofs": [],
                "auto_release_at": echeance_passee,
            },
        )
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            retrait = await client.post(
                f"/api/jobs/{job['id']}/dispute/withdraw", headers=equipe["client_headers"]
            )
            resume = await completion.passage_liberations_auto()

        assert retrait.status_code == 200, retrait.text
        assert resume["released"] == 1
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["state"] == litiges.RETIRE

    async def test_l_autre_partie_ne_peut_pas_retirer_le_litige(self, client: AsyncClient):
        """Sinon le débiteur aurait la clé du séquestre."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/withdraw", headers=equipe["worker_headers"]
            )

        assert resp.status_code == 403, resp.text
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["state"] == litiges.OUVERT


@pytest.mark.asyncio
class TestReponseDeLAutrePartie:
    """Une réponse, une seule, par la partie qui n'a PAS ouvert le litige.

    Sans elle, l'arbitre ne lisait que la version de celui qui conteste : un
    son de cloche, sur un désaccord qui engage de l'argent. Le propriétaire doit
    pouvoir trancher sur les DEUX versions.
    """

    async def test_le_travailleur_repond_au_litige_du_client(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _en_tant_que_proprietaire(owner), _paiements_simules() as notif:
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": REPONSE},
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("jobs", {"id": job["id"]})
        reponse = stocke["dispute"]["response"]
        assert reponse["position"] == "release_worker"
        assert reponse["note"] == REPONSE
        assert reponse["author_id"] == equipe["worker_id"]
        assert reponse["author_role"] == "worker"
        assert reponse["responded_at"]
        # La réponse voyage avec la mission : l'écran qui affiche le désaccord
        # affiche les deux versions, sans route de lecture séparée.
        assert resp.json()["dispute"]["response"]["position"] == "release_worker"

        # Le journal garde la POSITION (énumérée) et JAMAIS la note : elle est
        # écrite par une partie, donc peut porter un nom, une adresse, un numéro.
        evenement = await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_answered"}
        )
        assert evenement is not None
        assert evenement["user_id"] == equipe["worker_id"]
        assert evenement["details"] == {"position": "release_worker"}
        evenements = await core.db.business_events.find({"job_id": job["id"]}).to_list(50)
        assert all(REPONSE not in str(e) for e in evenements)

        # Le propriétaire est prévenu : c'est le moment où il a les deux versions.
        assert "dispute_answered_owner" in [a.kwargs.get("key") for a in notif.call_args_list]

    async def test_le_client_repond_au_litige_du_travailleur(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["worker_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["client_headers"],
                json={"position": "refund_client", "note": REPONSE},
            )

        assert resp.status_code == 200, resp.text
        reponse = (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["response"]
        assert reponse["author_role"] == "client"
        assert reponse["position"] == "refund_client"

    async def test_l_ouvreur_ne_repond_pas_a_son_propre_litige(self, client: AsyncClient):
        """Sa version, c'est le motif : deux textes d'un même côté feraient
        deux versions pour une seule voix."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["client_headers"],
                json={"position": "refund_client", "note": REPONSE},
            )

        assert resp.status_code == 403, resp.text
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"].get("response") is None

    async def test_un_tiers_ne_repond_pas(self, client: AsyncClient):
        equipe = await _equipe(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": f"tiers-{uuid.uuid4().hex[:6]}@kojo.sn"}
        )
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers={"Authorization": f"Bearer {intrus['access_token']}"},
                json={"position": "release_worker", "note": REPONSE},
            )

        assert resp.status_code == 403, resp.text
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"].get("response") is None

    async def test_une_seule_reponse_par_litige(self, client: AsyncClient):
        """Réécrire sa version après avoir lu celle de l'autre transformerait
        l'arbitrage en négociation, et le journal en brouillon."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            premier = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": REPONSE},
            )
            second = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "refund_client", "note": "Je change d'avis sur la demande."},
            )

        assert premier.status_code == 200, premier.text
        assert second.status_code == 409, second.text
        reponse = (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["response"]
        assert reponse["position"] == "release_worker"
        # Un seul jalon : le journal ne compte pas les tentatives de réécriture.
        evenements = await core.db.business_events.find(
            {"job_id": job["id"], "type": "mission_dispute_answered"}
        ).to_list(10)
        assert len(evenements) == 1

    async def test_une_reponse_trop_courte_ou_mal_orientee_est_refusee(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            courte = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": "faux"},
            )
            inconnue = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "partager", "note": REPONSE},
            )

        assert courte.status_code == 422, courte.text
        # Trois décisions n'existent pas : un partage exigerait de couper un
        # décaissement, ce que PayDunya ne fait pas.
        assert inconnue.status_code == 422, inconnue.text
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"].get("response") is None

    async def test_repondre_a_un_litige_tranche_est_refuse(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            with _en_tant_que_proprietaire(owner):
                await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "release_worker", "note": "Preuve conforme, travail achevé."},
                )
            resp = await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": REPONSE},
            )

        assert resp.status_code == 409, resp.text

    async def test_le_proprietaire_lit_les_deux_versions(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": REPONSE},
            )
            file_ = await client.get("/api/owner/litiges", headers=owner["headers"])
            fiche = await client.get(f"/api/owner/missions/{job['id']}/litige", headers=owner["headers"])

        assert file_.status_code == 200, file_.text
        assert fiche.status_code == 200, fiche.text
        for litige in (file_.json()["litiges"][0]["litige"], fiche.json()["litige"]):
            # Les DEUX versions, dans le même document : le motif de l'ouvreur et
            # la réponse de l'autre partie.
            assert litige["reason"] == MOTIF
            assert litige["response"]["note"] == REPONSE
            assert litige["response"]["position"] == "release_worker"

    async def test_le_journal_du_proprietaire_nomme_les_jalons_du_litige(self, client: AsyncClient):
        """L'écran des jalons lit UNE chronologie, pas quatre jalons d'avant le litige.

        Le journal ne porte que des faits ÉNUMÉRÉS : l'échéance, la position et
        la décision s'y lisent en clair (l'écran les met en français), et la
        prose des parties — motif, note de réponse — reste dehors, puisqu'elle
        est écrite par un tiers et que le journal se relit et s'exporte.
        """
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert(
            "payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        )

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            ouverture = await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "refund_client", "note": REPONSE},
            )
            await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "release_worker", "note": "Preuve conforme, travail achevé."},
            )
            journal = await client.get(
                f"/api/owner/missions/{job['id']}/evenements", headers=owner["headers"]
            )

        assert ouverture.status_code == 200, ouverture.text
        assert journal.status_code == 200, journal.text
        jalons = {e["type"]: e for e in journal.json()["evenements"]}
        assert {
            "mission_dispute_opened",
            "mission_dispute_answered",
            "mission_dispute_decided",
        } <= set(jalons)
        # L'échéance : la date exacte que le litige porte, pas une reformulation.
        fiche = await db_find_one("jobs", {"id": job["id"]})
        assert jalons["mission_dispute_opened"]["details"] == {
            "echeance": fiche["dispute"]["decision_deadline_at"]
        }
        assert jalons["mission_dispute_answered"]["details"] == {"position": "refund_client"}
        decision = jalons["mission_dispute_decided"]["details"]
        assert decision["decision"] == "release_worker"
        assert decision["paiement"]
        # Aucune prose de partie dans le journal (motif ni note de réponse).
        texte = str(journal.json())
        assert MOTIF not in texte
        assert REPONSE not in texte
        # Ordre chronologique : la chronologie se lit d'un seul tenant.
        types = [e["type"] for e in journal.json()["evenements"]]
        assert types.index("mission_dispute_opened") < types.index("mission_dispute_answered")
        assert types.index("mission_dispute_answered") < types.index("mission_dispute_decided")

    async def test_un_tiers_ne_lit_pas_la_reponse(self, client: AsyncClient):
        equipe = await _equipe(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": f"tiers-{uuid.uuid4().hex[:6]}@kojo.sn"}
        )
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            await client.post(
                f"/api/jobs/{job['id']}/dispute/response",
                headers=equipe["worker_headers"],
                json={"position": "release_worker", "note": REPONSE},
            )
            resp = await client.get(
                f"/api/jobs/{job['id']}", headers={"Authorization": f"Bearer {intrus['access_token']}"}
            )

        assert resp.status_code == 200, resp.text
        assert "dispute" not in resp.json()
        # Ni la note ni la position ne fuient par un autre champ de la fiche.
        assert REPONSE not in resp.text
        assert "release_worker" not in resp.text


@pytest.mark.asyncio
class TestDecisionProprietaire:
    async def test_verser_le_travailleur_passe_par_l_unique_liberation(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["worker_headers"], json={"reason": MOTIF}
            )
            with _en_tant_que_proprietaire(owner):
                resp = await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "release_worker", "note": "Preuve photo conforme, travail achevé."},
                )

        assert resp.status_code == 200, resp.text
        stocke = await db_find_one("payments", {"id": paiement["id"]})
        assert stocke["payout_status"] == "released"
        job_apres = await db_find_one("jobs", {"id": job["id"]})
        assert job_apres["status"] == "completed"
        assert job_apres["dispute"]["state"] == litiges.TRANCHE
        assert job_apres["dispute"]["decision"] == "release_worker"
        assert job_apres["dispute"]["decided_by"] == owner["id"]

        evenement = await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_decided"}
        )
        assert evenement["user_id"] == owner["id"]
        assert evenement["details"]["decision"] == "release_worker"
        assert evenement["details"]["paiement"] == "released"

    async def test_la_motivation_de_la_decision_est_lue_chez_le_proprietaire(self, client: AsyncClient):
        """La prose de la décision n'entre pas au journal : elle se lit au litige.

        L'écran du journal pose cette motivation SOUS le jalon de la décision ;
        sa source est cette lecture propriétaire. Si `decision_note` quittait
        l'allowlist, l'écran serait muet sans qu'aucun jalon ne rougisse — donc
        la source est jugée ici, et le journal est jugé MUET de la même prose.
        """
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))
        note = "Preuve photo conforme, travail achevé le jour même."

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            with _en_tant_que_proprietaire(owner):
                decision = await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "release_worker", "note": note},
                )
                fiche = await client.get(
                    f"/api/owner/missions/{job['id']}/litige", headers=owner["headers"]
                )
                journal = await client.get(
                    f"/api/owner/missions/{job['id']}/evenements", headers=owner["headers"]
                )

        assert decision.status_code == 200, decision.text
        assert fiche.status_code == 200, fiche.text
        assert fiche.json()["litige"]["decision_note"] == note
        assert fiche.json()["litige"]["state"] == litiges.TRANCHE
        # Le journal reste un journal de FAITS : la note n'y est pas recopiée.
        assert journal.status_code == 200, journal.text
        assert note not in journal.text
        jalon = next(
            e for e in journal.json()["evenements"] if e["type"] == "mission_dispute_decided"
        )
        assert "note" not in jalon["details"]

    async def test_rembourser_le_client_ferme_la_mission(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules() as notif:
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            with _en_tant_que_proprietaire(owner):
                resp = await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "refund_client", "note": "Travail non réalisé, remboursement total."},
                )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "refunded"
        job_apres = await db_find_one("jobs", {"id": job["id"]})
        assert job_apres["status"] == "cancelled"
        assert job_apres["dispute"]["decision"] == "refund_client"
        cles = [a.kwargs.get("key") for a in notif.call_args_list]
        assert "dispute_refunded_client" in cles
        assert "dispute_refunded_worker" in cles

    async def test_un_non_proprietaire_ne_tranche_pas(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=equipe["client_headers"],
                json={"decision": "release_worker", "note": "Je tranche moi-même, merci."},
            )

        assert resp.status_code == 403, resp.text
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["state"] == litiges.OUVERT

    async def test_une_decision_sans_litige_est_refusee(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _en_tant_que_proprietaire(owner):
            resp = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "release_worker", "note": "Décision sans litige."},
            )
        assert resp.status_code == 409, resp.text

    async def test_une_seconde_decision_ne_verse_pas_deux_fois(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            with _en_tant_que_proprietaire(owner):
                premier = await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "release_worker", "note": "Preuve conforme, travail achevé."},
                )
                second = await client.post(
                    f"/api/owner/missions/{job['id']}/litige/decision",
                    headers=owner["headers"],
                    json={"decision": "refund_client", "note": "Je change d'avis, remboursez-le."},
                )

        assert premier.status_code == 200, premier.text
        assert second.status_code == 409, second.text
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_la_file_d_arbitrage_rend_les_litiges_et_leur_echeance(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        premier = _job(equipe["client_id"], equipe["worker_id"], title="Mission la plus urgente")
        second = _job(equipe["client_id"], equipe["worker_id"], title="Mission moins urgente")
        await db_insert("jobs", premier)
        await db_insert("jobs", second)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{second['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            await client.post(
                f"/api/jobs/{premier['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            # La première ouverte garde une échéance plus lointaine : c'est la
            # plus proche de sa fin qui doit sortir en tête.
            await core.db.jobs.update_one(
                {"id": premier["id"]},
                {"$set": {"dispute.decision_deadline_at": (datetime.now(timezone.utc) + timedelta(days=9)).isoformat()}},
            )
            with _en_tant_que_proprietaire(owner):
                resp = await client.get("/api/owner/litiges", headers=owner["headers"])

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["count"] == 2
        assert data["fenetre_jours"] == litiges.LITIGE_DECISION_DAYS
        assert [item["job_id"] for item in data["litiges"]] == [second["id"], premier["id"]]
        # Allowlist : le motif est rendu (c'est ce que le propriétaire lit),
        # jamais le document brut de la mission.
        assert set(data["litiges"][0]) == {"job_id", "title", "status", "client_id", "worker_id", "litige"}


@pytest.mark.asyncio
class TestEcheance:
    async def test_l_echeance_referme_le_litige_et_rend_la_main_a_la_regle(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        echeance_passee = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        job = _job(
            equipe["client_id"], equipe["worker_id"],
            completion={
                "state": "marked",
                "note": "Fuite réparée, joint changé et test d'étanchéité effectué.",
                "proofs": [],
                "auto_release_at": echeance_passee,
            },
        )
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _paiements_simules() as notif:
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            # On se place APRÈS la fenêtre d'arbitrage (le seuil est un argument
            # explicite : la fonction est jugée sur son moment, pas sur l'horloge).
            plus_tard = datetime.now(timezone.utc) + timedelta(days=litiges.LITIGE_DECISION_DAYS + 1)
            with _en_tant_que_proprietaire(owner):
                resume = await litiges.passage_litiges_expires(now=plus_tard)
            await asyncio.sleep(0)

        assert resume["due"] == 1
        assert resume["expired"] == 1
        job_apres = await db_find_one("jobs", {"id": job["id"]})
        assert job_apres["dispute"]["state"] == litiges.EXPIRE
        assert job_apres["dispute"]["expired_at"]
        evenement = await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_expired"}
        )
        assert evenement is not None
        cles = [a.kwargs.get("key") for a in notif.call_args_list]
        assert "dispute_expired_owner" in cles

        # Fenêtre refermée SANS décision : la règle ordinaire reprend, sinon un
        # propriétaire injoignable bloquerait le paiement pour toujours.
        with _paiements_simules():
            resultat = await completion.passage_liberations_auto()
        assert resultat["released"] == 1
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_un_litige_non_echu_n_est_pas_referme(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resume = await litiges.passage_litiges_expires()

        assert resume == {"due": 0, "expired": 0, "skipped": 0}
        assert (await db_find_one("jobs", {"id": job["id"]}))["dispute"]["state"] == litiges.OUVERT


@pytest.mark.asyncio
class TestLectureDuLitige:
    """Le désaccord se lit par ses PARTIES, jamais par un compte quelconque.

    Le motif est écrit par une partie : il peut porter un nom, une adresse, un
    numéro. C'est pour cette raison qu'il n'entre pas dans le journal métier —
    et la même raison interdit de le servir sur `GET /jobs/{id}`, que tout
    compte connecté peut appeler. La fiche reste consultable : c'est le
    désaccord qui se cache.
    """

    async def test_les_deux_parties_lisent_le_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            cote_client = await client.get(f"/api/jobs/{job['id']}", headers=equipe["client_headers"])
            cote_worker = await client.get(f"/api/jobs/{job['id']}", headers=equipe["worker_headers"])

        assert cote_client.status_code == 200, cote_client.text
        assert cote_client.json()["dispute"]["reason"] == MOTIF
        # L'autre partie doit savoir CE QUI est contesté, sinon elle ne peut pas
        # répondre au grief.
        assert cote_worker.json()["dispute"]["reason"] == MOTIF

    async def test_un_compte_tiers_ne_lit_pas_le_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": f"tiers-{uuid.uuid4().hex[:6]}@kojo.sn"}
        )
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.get(
                f"/api/jobs/{job['id']}", headers={"Authorization": f"Bearer {intrus['access_token']}"}
            )

        assert resp.status_code == 200, resp.text
        assert "dispute" not in resp.json()
        # La mission, elle, reste lisible : on cache le désaccord, pas la fiche.
        assert resp.json()["id"] == job["id"]

    async def test_un_visiteur_anonyme_ne_lit_pas_le_litige(self, client: AsyncClient):
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)

        with _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            # Le client de test garde les cookies de session : sans les vider,
            # cet appel serait celui d'un compte CONNECTÉ et ne dirait rien du
            # visiteur anonyme.
            client.cookies.clear()
            resp = await client.get(f"/api/jobs/{job['id']}")

        assert resp.status_code == 200, resp.text
        assert "dispute" not in resp.json()


@pytest.mark.asyncio
class TestEchecDeDecision:
    """Une décision qui n'a RIEN payé ne referme pas le désaccord.

    Le trou fermé ici est celui de la panne silencieuse : `liberer_sequestre`
    et `execute_paydunya_refund` répondent « refusé » par un STATUT, pas par une
    exception. Le litige passait donc en `resolved`, les notifications
    annonçaient un versement, la file d'arbitrage se vidait — et le compte
    n'avait rien reçu. Ce qui est jugé : l'état, le jalon, la relance, et le gel.
    """

    async def test_un_versement_refuse_laisse_une_trace_et_le_litige_ouvert(self, client: AsyncClient):
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )

        with _en_tant_que_proprietaire(owner), _decaissement_refuse() as notif:
            resp = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "release_worker", "note": NOTE_DECISION},
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        corps = resp.json()
        # La réponse DIT que rien n'a été versé et quoi faire : un 200 qui
        # annonce « litige tranché » sur un versement refusé est le mensonge.
        assert corps["dispute_state"] == litiges.ECHEC
        assert corps["echec"] == litiges.ECHEC_VERSEMENT_REFUSE
        assert corps["relance"] is True
        assert corps["payment_outcome"] == "release_failed"
        assert "relancer" in corps["message"].lower()

        stocke = await db_find_one("jobs", {"id": job["id"]})
        dispute = stocke["dispute"]
        assert dispute["state"] == litiges.ECHEC
        assert dispute["decision_failure"] == litiges.ECHEC_VERSEMENT_REFUSE
        assert dispute["decision_attempted_at"]
        assert dispute["payment_outcome"] == "release_failed"
        assert dispute["resolved_at"] is None
        # Ni décision ni note : le litige voyage avec la mission, ses parties le
        # lisent, et une décision NON exécutée n'a rien à leur annoncer.
        assert dispute["decision"] is None
        assert dispute["decision_note"] is None

        # Le jalon : la décision tentée et son CODE, jamais la phrase PayDunya.
        jalon = await db_find_one(
            "business_events",
            {"job_id": job["id"], "type": "mission_dispute_decision_failed"},
        )
        assert jalon is not None
        assert jalon["details"] == {
            "decision": "release_worker",
            "paiement": "release_failed",
            "echec": "versement_refuse",
        }
        assert await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_decided"}
        ) is None

        # Aucune des notifications d'un litige TRANCHÉ n'est partie.
        cles = [appel.kwargs.get("key") for appel in notif.call_args_list]
        assert "dispute_paid_client" not in cles

        # La file d'arbitrage la garde, en tête, avec le remède à lire.
        with _en_tant_que_proprietaire(owner):
            avec_file = await client.get("/api/owner/litiges", headers=owner["headers"])
        assert avec_file.status_code == 200, avec_file.text
        premiere = avec_file.json()["litiges"][0]
        assert premiere["job_id"] == job["id"]
        assert premiere["litige"]["state"] == litiges.ECHEC
        assert premiere["litige"]["decision_failure"] == litiges.ECHEC_VERSEMENT_REFUSE

    async def test_la_relance_verse_une_fois_la_cause_corrigee(self, client: AsyncClient):
        """Le refus de verser clôt la mission SANS payer : la relance doit la reprendre."""
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("payments", paiement)

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )

        with _en_tant_que_proprietaire(owner), _decaissement_refuse():
            premier = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "release_worker", "note": NOTE_DECISION},
            )
        assert premier.json()["dispute_state"] == litiges.ECHEC
        # Le refus de verser clôt la mission administrativement, sans payer.
        assert (await db_find_one("jobs", {"id": job["id"]}))["status"] == "completed"

        with _en_tant_que_proprietaire(owner), _paiements_simules() as notif:
            second = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "release_worker", "note": NOTE_DECISION},
            )
            await asyncio.sleep(0)

        assert second.status_code == 200, second.text
        assert second.json()["payment_outcome"] == "released"
        assert second.json()["dispute_state"] == litiges.TRANCHE

        stocke = await db_find_one("jobs", {"id": job["id"]})
        assert stocke["dispute"]["state"] == litiges.TRANCHE
        assert stocke["dispute"]["decision"] == "release_worker"
        # L'échec corrigé ne reste pas collé à l'état courant : le journal le garde.
        assert "decision_failure" not in stocke["dispute"]
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

        # Deux jalons : l'échec, puis la décision exécutée.
        assert await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_decision_failed"}
        ) is not None
        assert await db_find_one(
            "business_events", {"job_id": job["id"], "type": "mission_dispute_decided"}
        ) is not None
        cles = [appel.kwargs.get("key") for appel in notif.call_args_list]
        assert "dispute_paid_client" in cles

    async def test_un_sequestre_introuvable_trace_l_echec_et_gele_encore(self, client: AsyncClient):
        """Aucun paiement séquestré : 400 nommé, jalon, et l'argent reste gelé."""
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(
            equipe["client_id"],
            equipe["worker_id"],
            completion={
                "state": completion.MARKED,
                "note": "Fuite réparée, joint changé et test d'étanchéité.",
                "proofs": [],
                "marked_at": datetime.now(timezone.utc).isoformat(),
                "marked_by": equipe["worker_id"],
                # Échéance PASSÉE : sans le gel, la libération automatique
                # paierait le travailleur alors que l'arbitre a décidé l'inverse.
                "auto_release_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
            },
        )
        await db_insert("jobs", job)

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )
            resp = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "refund_client", "note": NOTE_DECISION},
            )

        assert resp.status_code == 400, resp.text
        detail = resp.json()["detail"]
        assert "paiement séquestré" in detail.lower()
        # Le refus porte son REMÈDE : sans lui, le propriétaire relit la même
        # erreur sans savoir quoi corriger.
        assert "vérifier le paiement" in detail

        dispute = (await db_find_one("jobs", {"id": job["id"]}))["dispute"]
        assert dispute["state"] == litiges.ECHEC
        assert dispute["decision_failure"] == litiges.ECHEC_SEQUESTRE_INTROUVABLE
        assert dispute["resolved_at"] is None

        jalon = await db_find_one(
            "business_events",
            {"job_id": job["id"], "type": "mission_dispute_decision_failed"},
        )
        assert jalon["details"]["echec"] == "sequestre_introuvable"
        assert jalon["details"]["decision"] == "refund_client"

        # Le gel, mesuré : la requête du balayage EXCLUT les états bloquants
        # (`ETATS_BLOQUANTS`, lu et non recopié), donc la mission n'occupe même
        # pas une place du passage — et rien n'est versé.
        with _paiements_simules() as notif:
            resume = await completion.passage_liberations_auto()
            await asyncio.sleep(0)
        assert resume == {"due": 0, "released": 0, "blocked": 0, "skipped": 0, "frozen": 0, "wallet_hold": 0}
        notif.assert_not_called()
        assert (await db_find_one("jobs", {"id": job["id"]}))["status"] == "in_progress"

    async def test_un_remboursement_refuse_ne_ferme_pas_la_mission_en_verse(self, client: AsyncClient):
        """Remboursement refusé : le jalon dit le code, pas la phrase du fournisseur."""
        equipe = await _equipe(client)
        owner = await _owner(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", _paiement(job["id"], equipe["client_id"], equipe["worker_id"]))

        with _en_tant_que_proprietaire(owner), _paiements_simules():
            await client.post(
                f"/api/jobs/{job['id']}/dispute", headers=equipe["client_headers"], json={"reason": MOTIF}
            )

        with _en_tant_que_proprietaire(owner), _decaissement_refuse("Compte Wave du client fermé"):
            resp = await client.post(
                f"/api/owner/missions/{job['id']}/litige/decision",
                headers=owner["headers"],
                json={"decision": "refund_client", "note": NOTE_DECISION},
            )

        corps = resp.json()
        assert corps["echec"] == litiges.ECHEC_REMBOURSEMENT_REFUSE
        assert corps["payment_outcome"] == "refund_failed"
        # La phrase du fournisseur est RENDUE au propriétaire (il doit savoir
        # quoi corriger) mais n'entre pas dans le journal (code énuméré seul).
        assert "Wave" in corps["message"]
        jalon = await db_find_one(
            "business_events",
            {"job_id": job["id"], "type": "mission_dispute_decision_failed"},
        )
        assert "Wave" not in str(jalon)
        assert jalon["details"]["paiement"] == "refund_failed"

        dispute = (await db_find_one("jobs", {"id": job["id"]}))["dispute"]
        assert dispute["state"] == litiges.ECHEC
        assert dispute["decision_failure"] == litiges.ECHEC_REMBOURSEMENT_REFUSE


def _litige(**champs) -> dict:
    """Un document `dispute` complet, surchargeable — même forme que le backend."""
    base = {
        "state": litiges.OUVERT,
        "reason": MOTIF,
        "opened_by": "client-x",
        "opened_by_role": "client",
        "opened_at": "2026-10-01T00:00:00+00:00",
        "decision_deadline_at": "2026-10-06T00:00:00+00:00",
        "expired_at": None,
        "resolved_at": None,
        "decision": None,
        "decision_note": None,
        "decided_by": None,
        "payment_outcome": None,
        "withdrawn_at": None,
    }
    return {**base, **champs}


def _reponse(quand: str, position: str = "release_worker") -> dict:
    return {
        "position": position,
        "note": REPONSE,
        "author_id": "worker-x",
        "author_role": "worker",
        "responded_at": quand,
    }


@pytest.mark.asyncio
class TestMesuresArbitrage:
    """L'arbitrage se MESURE : à temps, sans réponse, et à quel délai.

    La file dit ce qui reste à faire ; ces trois chiffres disent comment
    l'arbitrage se passe — et ils se calculent sur l'historique, jamais sur la
    seule file du jour. Ce qui est jugé : les dénominateurs, la médiane, les
    dates illisibles (comptées, jamais remplacées par « maintenant »), et le
    plancher sous lequel un taux n'est pas publié.
    """

    async def test_les_trois_questions_se_mesurent_sur_l_historique(self):
        # A : réponse AVANT l'échéance, puis décision 20 h plus tard.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            response=_reponse("2026-10-03T00:00:00+00:00"),
            resolved_at="2026-10-03T20:00:00+00:00",
            decision="release_worker",
        )))
        # B : tranché SANS aucune réponse.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            resolved_at="2026-10-04T00:00:00+00:00",
            decision="refund_client",
        )))
        # C : réponse reçue APRÈS l'échéance, fenêtre échue.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.EXPIRE,
            response=_reponse("2026-10-08T00:00:00+00:00"),
            expired_at="2026-10-07T00:00:00+00:00",
        )))
        # D : décision tentée, paiement échoué, aucune réponse.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.ECHEC,
            decision_failure="versement_refuse",
        )))
        # E : encore ouvert — le dénominateur des réponses doit l'inclure.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            opened_at="2026-10-02T00:00:00+00:00",
        )))
        # F : retiré (accord retrouvé).
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.RETIRE,
            withdrawn_at="2026-10-02T00:00:00+00:00",
        )))

        mesures = await litiges.mesures_arbitrage()

        assert mesures["litiges"] == {"total": 6, "lus": 6, "tronque": False}
        assert mesures["etats"] == {
            "open": 1, "expired": 1, "resolved": 2, "withdrawn": 1, "decision_failed": 1,
        }
        assert mesures["reponse"]["avec_reponse"] == 2
        assert mesures["reponse"]["avant_echeance"] == 1
        assert mesures["reponse"]["apres_echeance"] == 1
        assert mesures["tranches"] == {
            "total": 2, "sans_reponse": 1, "avec_reponse": 1, "taux_sans_reponse": None,
        }
        # 20 h entre la réponse et la décision — la SEULE paire complète.
        assert mesures["delai_reponse_decision"]["n"] == 1
        assert mesures["delai_reponse_decision"]["mediane_heures"] == 20.0
        assert mesures["delai_reponse_decision"]["max_heures"] == 20.0
        # Sous le plancher : les comptes sont publiés, les taux NON.
        assert mesures["reponse"]["taux_avant_echeance"] is None
        assert mesures["plancher"] == litiges.PLANCHER_MESURE
        assert mesures["depuis"] == "2026-10-01T00:00:00+00:00"

    async def test_les_taux_se_publient_au_dessus_du_plancher(self):
        for _ in range(litiges.PLANCHER_MESURE):
            await db_insert("jobs", _job("c", "w", dispute=_litige(
                state=litiges.TRANCHE,
                response=_reponse("2026-10-02T00:00:00+00:00"),
                resolved_at="2026-10-02T10:00:00+00:00",
                decision="release_worker",
            )))

        mesures = await litiges.mesures_arbitrage()

        assert mesures["tranches"]["total"] == litiges.PLANCHER_MESURE
        # 0 % est une MESURE, pas une absence : il ne se confond pas avec `None`.
        assert mesures["tranches"]["taux_sans_reponse"] == 0.0
        assert mesures["reponse"]["taux_avant_echeance"] == 1.0
        assert mesures["delai_reponse_decision"]["mediane_heures"] == 10.0

    async def test_une_date_illisible_est_comptee_pas_devenue_absence(self):
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            response=_reponse("pas-une-date"),
            resolved_at="2026-10-05T00:00:00+00:00",
            decision="release_worker",
        )))

        mesures = await litiges.mesures_arbitrage()

        # Elle n'est PAS « sans réponse » (ce qui gonflerait le chiffre du
        # dessus), et elle ne produit aucun délai inventé.
        assert mesures["reponse"]["reponse_illisible"] == 1
        assert mesures["tranches"]["sans_reponse"] == 0
        assert mesures["tranches"]["avec_reponse"] == 0
        assert mesures["delai_reponse_decision"]["n"] == 0
        assert mesures["delai_reponse_decision"]["mediane_heures"] is None

    async def test_la_route_est_reservee_au_proprietaire(self, client: AsyncClient):
        owner = await _owner(client)
        intrus = await register_and_login(
            client, {**BASE_USER, "email": f"tiers-{uuid.uuid4().hex[:6]}@kojo.sn"}
        )
        job = _job("c", "w", dispute=_litige())
        await db_insert("jobs", job)

        refuse = await client.get(
            "/api/owner/litiges/mesures",
            headers={"Authorization": f"Bearer {intrus['access_token']}"},
        )
        with _en_tant_que_proprietaire(owner):
            accepte = await client.get("/api/owner/litiges/mesures", headers=owner["headers"])

        assert refuse.status_code == 403, refuse.text
        assert accepte.status_code == 200, accepte.text
        assert accepte.json()["litiges"]["total"] == 1
        assert accepte.json()["plancher"] == litiges.PLANCHER_MESURE


def _il_y_a(jours: float = 0, heures: float = 0) -> str:
    """Horodatage ISO relatif à MAINTENANT — une fenêtre glissante se juge sur
    des dates relatives, sinon le test vieillit avec sa constante."""
    return (datetime.now(timezone.utc) - timedelta(days=jours, hours=heures)).isoformat()


@pytest.mark.asyncio
class TestFenetresDesMesures:
    """L'historique entier ne dit pas si l'arbitrage va MIEUX.

    Une décision d'il y a six mois et celle d'hier pèsent pareil dans les trois
    chiffres globaux. Les mêmes questions sont donc rejouées sur 30 et 90 jours,
    avec DEUX ancrages : une décision appartient à la période de `resolved_at`,
    une réponse à celle de `responded_at`. Ce qui est jugé ici : l'exclusion hors
    fenêtre (comptée, jamais recasée), la publication des taux par fenêtre, et le
    fait que la fenêtre de 30 jours dit EXACTEMENT la même chose que l'alerte
    (`mesure_sans_reponse`) — deux règles qui divergeraient en silence.
    """

    async def test_les_30_jours_excluent_ce_que_les_90_jours_gardent(self):
        # Récente, sans réponse.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at=_il_y_a(2), decision="refund_client",
        )))
        # Ancienne (45 j), sans réponse : hors des 30 jours, dans les 90.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at=_il_y_a(45), decision="refund_client",
        )))
        # Réponse il y a 4 j (avant l'échéance d'il y a 2 j), décision il y a 1 j.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            decision_deadline_at=_il_y_a(2),
            response=_reponse(_il_y_a(4)),
            resolved_at=_il_y_a(1),
            decision="release_worker",
        )))
        # Réponse il y a 76 j, décision il y a 75 j : hors des 30 jours.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            response=_reponse(_il_y_a(76)),
            resolved_at=_il_y_a(75),
            decision="release_worker",
        )))
        # Réponse il y a 2 j dans un litige ENCORE OUVERT : elle compte dans les
        # réponses de la période, et dans aucune décision.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            opened_at=_il_y_a(5),
            decision_deadline_at=_il_y_a(1),
            response=_reponse(_il_y_a(2)),
        )))

        mesures = await litiges.mesures_arbitrage()
        fenetres = {f["fenetre_jours"]: f for f in mesures["fenetres"]}

        assert sorted(fenetres) == list(litiges.FENETRES_MESURES)
        # 30 jours : deux décisions, deux réponses ; les deux anciennes sont
        # COMPTÉES comme hors fenêtre (jamais silencieusement fondues).
        court = fenetres[30]
        assert court["decisions"]["total"] == 2
        assert court["decisions"]["sans_reponse"] == 1
        assert court["decisions"]["avec_reponse"] == 1
        assert court["decisions"]["hors_fenetre"] == 2
        assert court["reponses"]["total"] == 2
        assert court["reponses"]["avant_echeance"] == 2
        assert court["reponses"]["hors_fenetre"] == 1
        # 90 jours : les quatre décisions et les trois réponses.
        long = fenetres[90]
        assert long["decisions"]["total"] == 4
        assert long["decisions"]["sans_reponse"] == 2
        assert long["decisions"]["avec_reponse"] == 2
        assert long["decisions"]["hors_fenetre"] == 0
        assert long["reponses"]["total"] == 3
        assert long["reponses"]["avant_echeance"] == 3
        # Sous le plancher dans les deux fenêtres : comptes vrais, taux None.
        assert court["decisions"]["taux_sans_reponse"] is None
        assert long["decisions"]["taux_sans_reponse"] is None

    async def test_les_taux_se_publient_par_fenetre(self):
        # 12 décisions récentes, 3 sans réponse → 25 % sur 30 jours.
        for index in range(12):
            await db_insert("jobs", _job("c", "w", dispute=_litige(
                state=litiges.TRANCHE,
                resolved_at=_il_y_a(10, heures=index),
                decision="refund_client" if index < 3 else "release_worker",
                response=None if index < 3 else _reponse(_il_y_a(11, heures=index)),
            )))
        # 12 décisions PLUS ANCIENNES, toutes avec réponse, il y a 60 jours.
        for index in range(12):
            await db_insert("jobs", _job("c", "w", dispute=_litige(
                state=litiges.TRANCHE,
                resolved_at=_il_y_a(60, heures=index),
                response=_reponse(_il_y_a(61, heures=index)),
                decision="release_worker",
            )))

        mesures = await litiges.mesures_arbitrage()
        fenetres = {f["fenetre_jours"]: f for f in mesures["fenetres"]}

        # Les 30 jours disent la santé ACTUELLE : 3 / 12.
        assert fenetres[30]["decisions"]["taux_sans_reponse"] == 0.25
        # Les 90 jours gardent l'historique : 3 / 24, et le taux baisse.
        assert fenetres[90]["decisions"]["total"] == 24
        assert fenetres[90]["decisions"]["taux_sans_reponse"] == 0.125
        # Le quart des décisions récentes est bien ignoré des 30 jours.
        assert fenetres[30]["decisions"]["hors_fenetre"] == 12

    async def test_une_date_impossible_est_comptee_dans_chaque_fenetre(self):
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at="pas-une-date", decision="refund_client",
        )))
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            resolved_at=(datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            decision="refund_client",
        )))

        mesures = await litiges.mesures_arbitrage()

        for fenetre in mesures["fenetres"]:
            # Ni « maintenant » ni « pas de décision » : comptée à part.
            assert fenetre["decisions"]["total"] == 0
            assert fenetre["decisions"]["date_illisible"] == 1
            assert fenetre["decisions"]["date_future"] == 1

    async def test_la_fenetre_de_30_jours_dit_la_meme_chose_que_l_alerte(self):
        # Deux décisions dans la période (une sans réponse), une hors période :
        # l'alerte et la vue partagent la règle, ils doivent compter pareil.
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at=_il_y_a(3), decision="refund_client",
        )))
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE,
            response=_reponse(_il_y_a(4)),
            resolved_at=_il_y_a(2),
            decision="release_worker",
        )))
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at=_il_y_a(120), decision="refund_client",
        )))

        vue = await litiges.mesures_arbitrage()
        fenetre = next(f for f in vue["fenetres"] if f["fenetre_jours"] == 30)
        alerte = await litiges.mesure_sans_reponse(30)

        assert fenetre["decisions"]["total"] == alerte["tranches"]["total"] == 2
        assert fenetre["decisions"]["sans_reponse"] == alerte["tranches"]["sans_reponse"] == 1
        assert fenetre["decisions"]["hors_fenetre"] == alerte["hors_fenetre"] == 1
        assert fenetre["decisions"]["taux_sans_reponse"] == alerte["tranches"]["taux_sans_reponse"]

    async def test_la_route_publie_les_deux_fenetres(self, client: AsyncClient):
        owner = await _owner(client)
        await db_insert("jobs", _job("c", "w", dispute=_litige(
            state=litiges.TRANCHE, resolved_at=_il_y_a(2), decision="refund_client",
        )))

        with _en_tant_que_proprietaire(owner):
            reponse = await client.get("/api/owner/litiges/mesures", headers=owner["headers"])

        assert reponse.status_code == 200, reponse.text
        fenetres = reponse.json()["fenetres"]
        assert [f["fenetre_jours"] for f in fenetres] == [30, 90]
        for fenetre in fenetres:
            assert set(fenetre) == {
                "fenetre_jours", "depuis", "decisions", "reponses", "delai_reponse_decision",
            }
            assert "taux_sans_reponse" in fenetre["decisions"]
            assert "taux_avant_echeance" in fenetre["reponses"]
