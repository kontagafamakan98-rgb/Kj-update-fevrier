# -*- coding: utf-8 -*-
"""Sortir de `pending` RETIRE l'échéance du checkout : l'invariant tient à l'écriture.

Pourquoi ce test existe
-----------------------
`expires_at` est écrit à la création du checkout (`kojo_routers_payments.py`) et
c'est, avec le statut, ce qui dit à la purge qu'un paiement est un panier
abandonné plutôt qu'une pièce comptable. Tant que l'échéance n'était JAMAIS
retirée, la survie d'un paiement versé reposait sur la seule clause
`status: pending` du filtre partiel de `kojo_retention.py` : un refactor du
filtre pouvait supprimer des pièces comptables sans qu'aucun test ne bronche
(un paiement `completed` du test voisin ne porte pas d'échéance, donc il survit
même sans la clause).

L'invariant est donc porté par l'ÉCRITURE, en un seul endroit
(`kojo_payments.maj_statut_collecte` : la seule écriture du statut d'une
collecte). Ce fichier le mesure par la VRAIE surface — checkout, webhook IPN,
retour de statut par l'API — et jamais en appelant la fonction qui le porte.

Trois choses, dans cet ordre parce que l'ordre porte la preuve :
  1. la NON-VACUITÉ — l'échéance EXISTE après le checkout, sinon retirer le
     champ partout satisferait le test ;
  2. l'EFFET — après la transition, elle n'est plus là, sur les DEUX chemins
     qui font sortir un paiement de `pending` (IPN et retour de statut) ;
  3. l'INVARIANT, sur tous les paiements — « porte l'échéance » ⟺ « encore en
     attente ». Regarder le seul document qu'on vient de traverser laisserait
     passer un correctif qui ne nettoie que celui-là.

La clause `status: pending` du filtre de purge reste un SECOND FILET : les
documents écrits avant ce changement portent encore une échéance périmée.
"""
import ast
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from kojo_core import db
from kojo_retention import RETENTION_RULES
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

# Le nom du champ n'est pas recopié : il appartient à la règle de conservation,
# seul document qui dit ce que la purge lit.
CHAMP_ECHEANCE = next(
    regle.ttl_field for regle in RETENTION_RULES if regle.collection == "payments"
)


async def _mission_payable(client_user) -> str:
    """Une mission en cours, assignée à un travailleur : le checkout exige une
    mission payable (même forme que les autres tests de paiement)."""
    job_id = str(uuid.uuid4())
    worker_id = "worker-echeance"
    proposal_id = str(uuid.uuid4())
    await db_insert("jobs", {
        "id": job_id, "title": "Mission à échéance",
        "client_id": client_user["user"]["id"], "status": "in_progress",
        "assigned_worker_id": worker_id, "accepted_proposal_id": proposal_id,
        "deleted": False,
    })
    await db_insert("job_proposals", {
        "id": proposal_id, "job_id": job_id, "worker_id": worker_id,
        "proposed_amount": 5000, "status": "accepted",
    })
    return job_id


async def _checkout(client: AsyncClient, headers: dict, job_id: str, jeton: str) -> str:
    """Le vrai endpoint de checkout : c'est lui qui écrit l'échéance."""
    with patch(
        "kojo_routers_payments.is_paydunya_configured", return_value=True
    ), patch(
        "kojo_routers_payments.create_paydunya_invoice",
        return_value={
            "token": jeton, "response_code": "00",
            "response_text": f"https://paydunya.test/{jeton}",
        },
    ):
        resp = await client.post("/api/payments/checkout", headers=headers, json={
            "job_id": job_id, "amount": 5000,
            "payment_method": "orange_money", "country": "senegal",
        })
    assert resp.status_code == 200, resp.text
    return resp.json()["payment_id"]


def _confirmation(statut_provider: str):
    """La réponse du fournisseur, simulée : aucun appel réseau."""
    return patch(
        "kojo_payments.confirm_paydunya_invoice",
        return_value={"invoice": {"status": statut_provider}},
    )


async def _ipn(client: AsyncClient, payment_id: str, statut_provider: str):
    """PREMIER chemin de sortie de `pending` : le webhook PayDunya."""
    with patch("kojo_payments.is_paydunya_configured", return_value=True), _confirmation(statut_provider):
        resp = await client.post(
            "/api/payments/ipn/paydunya", json={"custom_data": {"payment_id": payment_id}}
        )
    assert resp.status_code == 200, resp.text
    return resp


async def _statut_par_api(client: AsyncClient, headers: dict, payment_id: str, statut_provider: str):
    """SECOND chemin : `/payments/status/{id}`, que l'app interroge quand l'IPN
    n'arrive jamais. Les deux passent par la même écriture — un correctif posé
    dans un seul laisserait l'autre échéance en place."""
    with patch("kojo_payments.is_paydunya_configured", return_value=True), _confirmation(statut_provider):
        resp = await client.get(f"/api/payments/status/{payment_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _paiements():
    return await db.payments.find({}).to_list(length=None)


async def _verifie_l_invariant():
    """« porte l'échéance » ⟺ « encore en attente », sur TOUS les paiements."""
    documents = await _paiements()
    assert documents, "aucun paiement en base : l'invariant ne porterait sur rien"
    portent = sorted(doc["id"] for doc in documents if CHAMP_ECHEANCE in doc)
    en_attente = sorted(doc["id"] for doc in documents if doc.get("status") == "pending")
    assert portent == en_attente, (
        "des paiements portent une échéance de checkout sans être en attente "
        f"(ou l'inverse) — portent={portent}, en_attente={en_attente}"
    )
    return documents


@pytest.mark.asyncio
class TestEcheanceDeCheckout:

    async def test_un_paiement_abouti_perd_son_echeance(self, client: AsyncClient):
        """Le client paie : le paiement devient `completed` et n'a plus d'échéance."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        # DEUX paiements : un qui reste en attente, un qui aboutit. Sans le
        # premier, un correctif qui supprimerait l'échéance partout passerait.
        en_attente = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-attente"
        )
        abouti = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-abouti"
        )

        avant = await db_find_one("payments", {"id": abouti})
        assert CHAMP_ECHEANCE in avant, (
            "l'échéance n'est pas écrite à la création du checkout : ce cas ne "
            "mesurerait rien"
        )

        await _ipn(client, abouti, "completed")

        apres = await db_find_one("payments", {"id": abouti})
        assert apres["status"] == "completed", apres
        assert CHAMP_ECHEANCE not in apres, (
            "un paiement abouti porte encore son échéance de checkout : sa "
            "survie ne tient qu'à la clause de statut du filtre de purge, "
            "c'est-à-dire à une ligne qu'un refactor peut déplacer"
        )
        # La transition retire l'échéance, RIEN d'autre : les faits comptables
        # du document sont intacts.
        for champ in ("amount", "job_id", "payer_id", "receiver_id",
                      "commission_amount", "worker_amount", "payment_method"):
            assert apres[champ] == avant[champ], champ

        documents = await _verifie_l_invariant()
        assert [d["id"] for d in documents if d.get("status") == "pending"] == [en_attente], (
            "le paiement laissé en attente a lui aussi perdu son échéance : la "
            "transition nettoie plus que ce qui a quitté `pending`"
        )

    async def test_le_retour_de_statut_par_l_api_perd_aussi_l_echeance(self, client: AsyncClient):
        """L'autre chemin : l'IPN peut ne jamais arriver, et c'est
        `/payments/status/{id}` qui fait alors sortir le paiement de `pending`."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        payment_id = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-statut"
        )

        assert CHAMP_ECHEANCE in await db_find_one("payments", {"id": payment_id}), (
            "l'échéance n'est pas écrite à la création du checkout : ce cas ne "
            "mesurerait rien"
        )

        corps = await _statut_par_api(client, headers, payment_id, "completed")

        assert corps.get(CHAMP_ECHEANCE) is None, corps
        apres = await db_find_one("payments", {"id": payment_id})
        assert apres["status"] == "completed", apres
        assert CHAMP_ECHEANCE not in apres, (
            "le chemin `/payments/status` laisse l'échéance en place alors que "
            "l'IPN la retire : les deux chemins ne font donc pas la même chose"
        )
        await _verifie_l_invariant()

    async def test_un_paiement_abandonne_perd_aussi_son_echeance(self, client: AsyncClient):
        """La règle porte sur la SORTIE de `pending`, pas sur le succès : un
        panier annulé côté PayDunya ne doit pas non plus garder une échéance —
        sinon la clause de statut redevient le seul filet pour ce cas."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        payment_id = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-annule"
        )

        await _ipn(client, payment_id, "cancelled")

        apres = await db_find_one("payments", {"id": payment_id})
        assert apres["status"] == "cancelled", apres
        assert CHAMP_ECHEANCE not in apres, (
            "un paiement annulé garde son échéance de checkout"
        )
        await _verifie_l_invariant()


# ---------------------------------------------------------------------------
# Le point unique, vérifié sur le CODE réel
# ---------------------------------------------------------------------------
# L'invariant ne vaut que si personne d'autre n'écrit le statut d'une collecte :
# un second écrivain pourrait le faire changer sans retirer l'échéance, et la
# survie d'un paiement versé retomberait sur la clause du filtre de purge — la
# dépendance que ce lot supprime. Le contrôle lit les sources de production
# plutôt qu'une liste d'appels à tenir à jour : un appel ajouté demain est
# examiné sans qu'on pense à l'inscrire ici.
RACINE = Path(__file__).resolve().parents[2]
ECRITURES = {"update_one", "update_many", "find_one_and_update", "replace_one"}


def _sources_de_production():
    backend = RACINE / "backend"
    return sorted([*backend.glob("kojo_*.py"), backend / "server.py"])


def _appels_ciblant_les_paiements(arbre):
    for noeud in ast.walk(arbre):
        if (
            isinstance(noeud, ast.Call)
            and isinstance(noeud.func, ast.Attribute)
            and noeud.func.attr in ECRITURES
            and ast.unparse(noeud.func.value) == "db.payments"
        ):
            yield noeud


def _ecrit_le_statut(mise_a_jour) -> bool:
    """Le document écrit porte-t-il une clé `status` ? La constante cherchée est
    exactement « status » : `payout_status` (versement au travailleur, qui suit
    une autre horloge) n'est donc pas confondu avec elle."""
    if mise_a_jour is None:
        return False
    for noeud in ast.walk(mise_a_jour):
        if isinstance(noeud, ast.Dict):
            for cle in noeud.keys:
                if isinstance(cle, ast.Constant) and cle.value == "status":
                    return True
    return False


def _passe_par_le_point_unique(mise_a_jour) -> bool:
    return (
        isinstance(mise_a_jour, ast.Call)
        and "maj_statut_collecte" in ast.unparse(mise_a_jour)
    )


def test_le_statut_d_une_collecte_a_un_seul_ecrivain():
    """Aucune source de production n'écrit le statut d'une collecte ailleurs que
    par `kojo_payments.maj_statut_collecte` — celui qui retire l'échéance."""
    ecrivains = []
    for chemin in _sources_de_production():
        arbre = ast.parse(chemin.read_text(encoding="utf-8"))
        for appel in _appels_ciblant_les_paiements(arbre):
            mise_a_jour = appel.args[1] if len(appel.args) > 1 else None
            if _ecrit_le_statut(mise_a_jour) and not _passe_par_le_point_unique(mise_a_jour):
                ecrivains.append(f"{chemin.name}:{appel.lineno}")
    assert not ecrivains, (
        "écriture directe du statut d'une collecte, hors du point unique qui "
        f"retire l'échéance de checkout : {ecrivains}"
    )
