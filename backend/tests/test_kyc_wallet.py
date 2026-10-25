# -*- coding: utf-8 -*-
"""LE TITULAIRE DU WALLET MOBILE MONEY (25/10/2026).

Ce que ces tests ferment
------------------------
`get_mobile_money_account` exigeait un compte Orange Money ou Wave pour
décaisser, mais rien ne prouvait que ce compte appartenait au titulaire du
compte Kojo : il suffisait de déclarer le wallet d'un tiers pour être payé
dessus. C'est la fraude qui coûte de l'argent réel, et elle ne demande aucun
document.

Ce que ces cas prouvent
-----------------------
1. Le nom DÉCLARÉ est comparé au nom du COMPTE (casse, accents, ordre des mots) :
   deux écritures du même nom ne bloquent pas un versement légitime.
2. Un nom DIFFÉRENT retient l'argent : 403 nommé, séquestre toujours `held`,
   aucun décaissement émis, mission non close.
3. L'absence de nom, ou de wallet, est un refus NOMMÉ et distinct — un refus
   muet se relirait comme une panne au moment où la personne attend son argent.
4. Le propriétaire tranche (valider / refuser) AVEC un motif, et sa décision
   débloque ou ferme le versement pour de vrai.
5. La décision ne couvre que le couple (nom, numéro) validé : changer le numéro
   la rend caduque, sinon une validation serait un blanc-seing à vie.
6. Les refus de la route de décision sont nommés : 400 sans motif, 409 sur le
   compte propriétaire ou un compte supprimé, 404 sur un identifiant inconnu.
7. La même porte protège le RETRAIT DES RÉCOMPENSES (même canal mobile money) et
   n'y laisse pas un verrou « retrait en cours » éternel.
8. La file du SERVICE CLIENTÈLE (propriétaire ET agents qu'il a ajoutés) est
   FERMÉE aux autres comptes, ne publie jamais un
   numéro entier ni le condensé du mot de passe, et dit quand sa lecture est
   bornée.
"""
import asyncio
import contextlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_job_completion as completion
import kojo_kyc as kyc
from kojo_core import db
from tests.conftest import (
    BASE_USER,
    WORKER_USER,
    db_find_one,
    db_insert,
    register_and_login,
)

OWNER_EMAIL_TEST = "proprietaire-wallets@kojo.sn"


@contextlib.contextmanager
def _proprietaire(email: str = OWNER_EMAIL_TEST):
    """Le propriétaire se désigne par l'EMAIL, en production comme ici.

    Deux noms à patcher : la porte (`kojo_owner.OWNER_EMAIL`) et la garde de
    `kojo_kyc` qui relit `kojo_settings.OWNER_EMAIL` à l'appel.
    """
    with patch("kojo_owner.OWNER_EMAIL", email), patch("kojo_settings.OWNER_EMAIL", email):
        yield


@contextlib.contextmanager
def _paydunya_ok():
    """PayDunya répond success : ce banc mesure la RÈGLE, pas le transport."""
    with patch("kojo_job_effects.create_paydunya_disburse_invoice",
               return_value={"disburse_token": "tok-test"}), \
         patch("kojo_job_effects.submit_paydunya_disburse_invoice",
               return_value={"status": "success", "response_code": "00"}) as submit, \
         patch("kojo_job_completion.build_disburse_callback_url",
               return_value="https://api.test/payments/disburse-ipn"), \
         patch("kojo_job_effects.notify_user_localized", AsyncMock()):
        yield submit


def _job(client_id: str, worker_id: str) -> dict:
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
        "completion": {
            "state": "marked",
            "note": "Fuite réparée, joint changé et test d'étanchéité effectué.",
            "proofs": [],
            "marked_at": datetime.now(timezone.utc).isoformat(),
            "auto_release_at": datetime.now(timezone.utc).isoformat(),
        },
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


async def _poser_wallet(worker_id: str, **champs) -> None:
    """Écrit le wallet du travailleur EN BASE : ces cas mesurent la lecture du
    document, pas le formulaire (dont la validation a ses propres tests)."""
    comptes = {
        "orange_money": "+221771234567",
        "wave": "+221771234568",
        "holder_name": "Kojo Test",
        **champs,
    }
    await db.users.update_one(
        {"id": worker_id},
        {"$set": {"payment_accounts": {k: v for k, v in comptes.items() if v is not None}}},
    )


async def _proprietaire_connecte(client: AsyncClient) -> dict:
    with _proprietaire():
        session = await register_and_login(
            client,
            {**BASE_USER, "email": OWNER_EMAIL_TEST, "first_name": "Famakan", "last_name": "Master"},
        )
    return {"Authorization": f"Bearer {session['access_token']}"}


async def _owner_get(client: AsyncClient, url: str, **kwargs):
    """Une lecture PROPRIÉTAIRE : la porte lit `OWNER_EMAIL` À L'APPEL, donc le
    nom doit être patché pendant la requête, pas seulement à l'inscription."""
    with _proprietaire():
        return await client.get(url, **kwargs)


async def _owner_post(client: AsyncClient, url: str, **kwargs):
    with _proprietaire():
        return await client.post(url, **kwargs)


class TestComparaisonDesNoms:
    """La règle de comparaison, sans réseau : c'est elle qui décide."""

    def test_casse_accents_et_ordre_des_mots_ne_bloquent_pas(self):
        # « Moussa Traoré » et « traore MOUSSA » désignent la même personne.
        assert kyc.noms_correspondent("Moussa Traoré", "traore MOUSSA")
        assert kyc.noms_correspondent("KONTAga  Famakan", "Famakan Kontaga")

    def test_un_nom_different_ne_correspond_pas_et_le_flou_est_refuse(self):
        # Pas de distance d'édition : « Traore » et « Traor » sont deux noms
        # différents, et un rapprochement approximatif laisserait passer
        # exactement ce que la verification veut empêcher.
        assert not kyc.noms_correspondent("Moussa Traore", "Moussa Traor")
        assert not kyc.noms_correspondent("Fatoumata Diop", "Kojo Test")
        assert not kyc.noms_correspondent("", "")

    def test_l_empreinte_change_avec_le_nom_ou_le_numero(self):
        base = {"payment_accounts": {"orange_money": "+221771234567", "holder_name": "Awa Diallo"}}
        autre_nom = {"payment_accounts": {"orange_money": "+221771234567", "holder_name": "Awa Ndiaye"}}
        autre_numero = {"payment_accounts": {"orange_money": "+221770000000", "holder_name": "Awa Diallo"}}
        assert kyc.empreinte(base) == kyc.empreinte(dict(base))
        assert kyc.empreinte(base) != kyc.empreinte(autre_nom)
        assert kyc.empreinte(base) != kyc.empreinte(autre_numero)


@pytest.mark.asyncio
class TestPorteDuVersement:
    """Le versement : retenu tant que le nom ne correspond pas, sans exception."""

    async def test_un_wallet_au_nom_du_travailleur_paie(self, client: AsyncClient):
        """L'écriture « Kojo Test » correspond au nom du compte de la fixture :
        le versement doit passer SANS décision du propriétaire."""
        equipe = await _equipe(client)
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        assert resp.json()["payout_status"] == "released"
        assert submit.called
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_un_wallet_au_nom_d_un_tiers_retient_l_argent(self, client: AsyncClient):
        """LE défaut mesuré : le nom déclaré n'est pas celui du compte.

        Ce qui est vérifié n'est pas le code HTTP seul mais l'ÉTAT DE L'ARGENT :
        séquestre toujours `held`, aucun décaissement émis, motif nommé.
        """
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name="Fatoumata Diop")
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        detail = resp.json()["detail"]
        assert "travailleur" in detail.lower()
        assert "propriétaire" in detail.lower()  # il dit QUI peut débloquer
        submit.assert_not_called()

        sequestre = await db_find_one("payments", {"id": paiement["id"]})
        assert sequestre["payout_status"] == "held", "l'argent a bougé malgré le refus"
        mission = await db_find_one("jobs", {"id": job["id"]})
        assert mission["status"] == "in_progress", "la mission a été close sans versement"

    async def test_sans_titulaire_declare_le_refus_nomme_ce_qui_manque(self, client: AsyncClient):
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name=None)
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        assert "NOM DU TITULAIRE" in resp.json()["detail"]
        submit.assert_not_called()
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "held"

    async def test_sans_wallet_le_refus_en_nomme_un_autre(self, client: AsyncClient):
        equipe = await _equipe(client)
        await db.users.update_one({"id": equipe["worker_id"]}, {"$set": {"payment_accounts": {}}})
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)

        with _paydunya_ok():
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        assert "aucun compte Orange Money ou Wave" in resp.json()["detail"]
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "held"

    async def test_le_retrait_des_recompenses_est_garde_et_relache_son_verrou(
        self, client: AsyncClient
    ):
        """Même porte, même argent : la récompense sort par le même canal.

        Le verrou anti double-retrait est posé AVANT la vérification : s'il
        n'était pas relâché sur ce refus, le compte ne pourrait plus jamais
        retenter — un blocage définitif déguisé en retrait en cours.
        """
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name="Fatoumata Diop")
        await db.users.update_one(
            {"id": equipe["worker_id"]},
            {"$set": {"referral_reward_balance": 5000.0}},
        )

        resp = await client.post(
            "/api/users/referral/withdraw", headers=equipe["worker_headers"]
        )

        assert resp.status_code == 403, resp.text
        assert "travailleur" in resp.json()["detail"].lower()
        compte = await db_find_one("users", {"id": equipe["worker_id"]})
        assert compte.get("referral_withdrawal_in_progress") is not True
        assert float(compte["referral_reward_balance"]) == 5000.0


@pytest.mark.asyncio
class TestDecisionProprietaire:
    """Le contrôle manuel : un humain tranche, une note l'explique, l'argent suit."""

    async def _fle_attente(self, client: AsyncClient):
        """Un versement retenu + l'en-tête du propriétaire, prêts à décider."""
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name="Fatoumata Diop")
        job = _job(equipe["client_id"], equipe["worker_id"])
        paiement = _paiement(job["id"], equipe["client_id"], equipe["worker_id"])
        await db_insert("jobs", job)
        await db_insert("payments", paiement)
        entetes = await _proprietaire_connecte(client)
        return equipe, job, paiement, entetes

    async def test_valider_debloque_le_versement(self, client: AsyncClient):
        equipe, job, paiement, entetes = await self._fle_attente(client)

        decision = await _owner_post(
            client,
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=entetes,
            json={
                "decision": "verifier",
                "note": "Titulaire joint par téléphone, carte d'identité vue au guichet.",
            },
        )
        assert decision.status_code == 200, decision.text
        assert decision.json()["etat"] == "verifie"

        # L'état est écrit sur le DOCUMENT du compte, avec son auteur.
        compte = await db_find_one("users", {"id": equipe["worker_id"]})
        assert compte["wallet_verification"]["etat"] == "verifie"
        assert compte["wallet_verification"]["methode"] == "manuel"
        assert compte["wallet_verification"]["decide_par"]
        assert compte["wallet_verification"]["historique"]

        # ... et l'argent peut enfin partir, par le chemin normal.
        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 200, resp.text
        assert submit.called
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_refuser_ferme_le_versement_en_nommant_le_motif(self, client: AsyncClient):
        equipe, job, paiement, entetes = await self._fle_attente(client)

        refus = await _owner_post(
            client,
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=entetes,
            json={
                "decision": "refuser",
                "note": "Le wallet appartient à un tiers sans lien avec le compte.",
            },
        )
        assert refus.status_code == 200, refus.text

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        assert "refusé par le propriétaire" in resp.json()["detail"]
        submit.assert_not_called()
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "held"

    async def test_apres_la_decision_le_balayage_paie_sans_relance(self, client: AsyncClient):
        """UNE décision, pas une tâche par versement.

        Retenu par la vérification, le versement automatique ne doit pas être
        figé (`auto_release_blocked` ne se rejoue jamais) : la déclaration reste
        `marked`, et le passage suivant paie tout seul dès que le titulaire est
        vérifié — sans que le client ni le propriétaire ait à relancer quoi que
        ce soit.
        """
        equipe, job, paiement, entetes = await self._fle_attente(client)
        await db.jobs.update_one(
            {"id": job["id"]},
            {"$set": {"completion.auto_release_at": (
                datetime.now(timezone.utc) - timedelta(minutes=1)
            ).isoformat()}},
        )

        with _paydunya_ok() as submit:
            resume = await completion.passage_liberations_auto()
            await asyncio.sleep(0)

        assert resume["wallet_hold"] == 1, resume
        assert resume["released"] == 0
        assert resume["blocked"] == 0, "une attente de vérification n'est pas un échec"
        submit.assert_not_called()
        mission = await db_find_one("jobs", {"id": job["id"]})
        assert mission["completion"]["state"] == completion.MARKED, (
            "la déclaration a été figée : la décision arriverait trop tard"
        )

        await _owner_post(
            client,
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=entetes,
            json={"decision": "verifier", "note": "Titulaire vérifié au guichet avec sa pièce."},
        )

        with _paydunya_ok() as submit:
            resume = await completion.passage_liberations_auto()
            await asyncio.sleep(0)

        assert resume["released"] == 1, resume
        assert submit.called
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "released"

    async def test_un_motif_court_est_refuse(self, client: AsyncClient):
        equipe = await _equipe(client)
        entetes = await _proprietaire_connecte(client)

        resp = await _owner_post(
            client,
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=entetes,
            json={"decision": "verifier", "note": "ok"},
        )
        assert resp.status_code == 400, resp.text
        assert str(kyc.NOTE_MINIMUM) in resp.json()["detail"]
        compte = await db_find_one("users", {"id": equipe["worker_id"]})
        assert not compte.get("wallet_verification")

    async def test_la_decision_ne_couvre_pas_un_numero_change(self, client: AsyncClient):
        """Une validation porte sur le couple (nom, numéro) qu'elle a couvert.

        Changer le numéro après coup rouvre le dossier : sinon valider un wallet
        reviendrait à autoriser n'importe quel numéro pour toujours.
        """
        equipe, job, paiement, entetes = await self._fle_attente(client)
        await _owner_post(
            client,
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=entetes,
            json={"decision": "verifier", "note": "Titulaire vérifié au téléphone et au guichet."},
        )

        # Le travailleur remplace ses numéros : la décision ne s'applique plus.
        await _poser_wallet(
            equipe["worker_id"],
            orange_money="+221770000001",
            wave="+221770000002",
            holder_name="Fatoumata Diop",
        )

        with _paydunya_ok() as submit:
            resp = await client.post(
                f"/api/jobs/{job['id']}/completion/confirm",
                headers=equipe["client_headers"],
            )
            await asyncio.sleep(0)

        assert resp.status_code == 403, resp.text
        submit.assert_not_called()
        assert (await db_find_one("payments", {"id": paiement["id"]}))["payout_status"] == "held"

    async def test_un_compte_ordinaire_ne_decide_pas(self, client: AsyncClient):
        equipe = await _equipe(client)
        with _proprietaire():
            resp = await client.post(
                f"/api/support/wallets/{equipe['worker_id']}/decision",
                headers=equipe["worker_headers"],
                json={"decision": "verifier", "note": "Je valide mon propre wallet tranquillement."},
            )
        assert resp.status_code in (401, 403), resp.text
        compte = await db_find_one("users", {"id": equipe["worker_id"]})
        assert not compte.get("wallet_verification")

    async def test_un_compte_supprime_ou_le_proprietaire_ne_se_valide_pas(
        self, client: AsyncClient
    ):
        entetes = await _proprietaire_connecte(client)
        # Le propriétaire lui-même : 409 (il n'a pas de wallet à faire valider).
        moi = await client.get("/api/auth/me", headers=entetes)
        assert moi.status_code == 200, moi.text
        with _proprietaire():
            resp = await client.post(
                f"/api/support/wallets/{moi.json()['id']}/decision",
                headers=entetes,
                json={"decision": "verifier", "note": "Je valide mon propre compte, évidemment."},
            )
        assert resp.status_code == 409, resp.text

        # Un compte supprimé : 409 aussi, en le nommant.
        equipe = await _equipe(client)
        await db_insert(
            "users",
            {
                "id": "supprime-wallet-1",
                "email": "supprime@kojo.deleted",
                "deleted": True,
                "payment_accounts": {"orange_money": "+221771111111", "holder_name": "Ancien Nom"},
            },
        )
        resp = await _owner_post(
            client,
            "/api/support/wallets/supprime-wallet-1/decision",
            headers=entetes,
            json={"decision": "verifier", "note": "Ce compte n'existe plus mais je le valide."},
        )
        assert resp.status_code == 409, resp.text
        assert "supprimé" in resp.json()["detail"].lower()

        # Un identifiant inconnu : 404.
        resp = await _owner_post(
            client,
            "/api/support/wallets/inconnu-wallet-999/decision",
            headers=entetes,
            json={"decision": "verifier", "note": "Un identifiant qui n'existe pas du tout."},
        )
        assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
class TestFileDesPortefeuilles:
    """Ce que le propriétaire voit pour décider, et ce qu'il ne voit pas."""

    async def test_la_file_est_fermee_et_ne_publie_pas_le_numero_entier(
        self, client: AsyncClient
    ):
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name="Fatoumata Diop")
        entetes = await _proprietaire_connecte(client)

        # Un compte ordinaire n'obtient rien.
        with _proprietaire():
            interdit = await client.get("/api/support/wallets", headers=equipe["worker_headers"])
        assert interdit.status_code in (401, 403), interdit.text

        resp = await _owner_get(
            client, "/api/support/wallets", headers=entetes, params={"etat": "en_attente"}
        )
        assert resp.status_code == 200, resp.text
        corps = resp.json()
        assert corps["count"] >= 1
        portefeuille = next(
            p for p in corps["portefeuilles"] if p["compte_id"] == equipe["worker_id"]
        )
        assert portefeuille["etat"] == "en_attente"
        assert portefeuille["nom_declare"] == "Fatoumata Diop"
        assert portefeuille["nom_compte"] == "Kojo Test"
        # Le numéro n'est jamais rendu en entier, et le condensé du mot de passe
        # n'est pas dans la charge utile.
        assert portefeuille["wallet_masque"].endswith("67")
        assert "+221771234567" not in str(corps)
        assert "password_hash" not in str(corps)

    async def test_un_etat_inconnu_ne_passe_pas_la_route_et_est_nomme_au_module(
        self, client: AsyncClient
    ):
        entetes = await _proprietaire_connecte(client)
        resp = await _owner_get(
            client, "/api/support/wallets", headers=entetes, params={"etat": "peut_etre"}
        )
        assert resp.status_code == 422, resp.text

        # La règle elle-même nomme l'état refusé quand on l'appelle directement
        # (c'est ce que la route protège par son motif, pas un doublon).
        with pytest.raises(Exception) as refus:
            await kyc.lister_portefeuilles(etat="peut_etre")
        assert "peut_etre" in str(refus.value)

    async def test_un_agent_du_support_peut_trancher(self, client: AsyncClient):
        """LE SERVICE CLIENTÈLE, PAS SEULEMENT LE PROPRIÉTAIRE (25/10/2026).

        `verify_support_access` ouvre cette file au propriétaire ET aux agents
        qu'il a ajoutés : une file qu'une seule personne peut vider est un
        goulot d'étranglement, et c'est le bureau qui reçoit l'appel du
        travailleur qui attend son argent. Ce qui est accordé reste étroit —
        les tickets et les portefeuilles —, pas les gains ni l'arbitrage.
        """
        equipe = await _equipe(client)
        await _poser_wallet(equipe["worker_id"], holder_name="Fatoumata Diop")

        # L'agent est ajouté par le propriétaire, par la route réelle : le rôle
        # qu'il porte ensuite est un FAIT écrit sur son compte.
        agent = await register_and_login(
            client, {**BASE_USER, "email": "agent-wallets@kojo.sn"}
        )
        agent_entetes = {"Authorization": f"Bearer {agent['access_token']}"}
        entetes_proprietaire = await _proprietaire_connecte(client)
        ajout = await _owner_post(
            client,
            "/api/support/team",
            headers=entetes_proprietaire,
            json={"email": "agent-wallets@kojo.sn"},
        )
        assert ajout.status_code == 201, ajout.text

        file_agent = await client.get("/api/support/wallets", headers=agent_entetes)
        assert file_agent.status_code == 200, file_agent.text
        assert any(
            p["compte_id"] == equipe["worker_id"] for p in file_agent.json()["portefeuilles"]
        )

        decision = await client.post(
            f"/api/support/wallets/{equipe['worker_id']}/decision",
            headers=agent_entetes,
            json={"decision": "verifier", "note": "Appel du travailleur, titulaire confirmé."},
        )
        assert decision.status_code == 200, decision.text

        # La trace nomme l'AUTEUR de la décision : un agent, pas le propriétaire.
        compte = await db_find_one("users", {"id": equipe["worker_id"]})
        assert compte["wallet_verification"]["decide_par"] == agent["user"]["id"]

        # Le service clientèle n'obtient PAS les gains ni l'arbitrage : cette
        # file ne doit pas devenir une porte dérobée vers `/owner/*`.
        assert (await client.get("/api/owner/commission-stats", headers=agent_entetes)).status_code in (401, 403)

    async def test_la_file_dit_quand_sa_lecture_est_bornee(self, client: AsyncClient):
        entetes = await _proprietaire_connecte(client)
        resp = await _owner_get(client, "/api/support/wallets", headers=entetes)
        assert resp.status_code == 200, resp.text
        corps = resp.json()
        # `tronque` est TOUJOURS publié : une file incomplète qui se tait ferait
        # croire qu'il n'y a plus rien à valider.
        assert "tronque" in corps
        assert corps["limite"] == 50
