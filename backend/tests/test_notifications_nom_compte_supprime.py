"""Le nom d'un compte supprimé ne survit pas dans les notifications de l'AUTRE PARTIE.

Pourquoi ce test existe
-----------------------
`proposal_received` (reçue par le client) et `proposal_accepted` (reçue par le
travailleur) interpolent le nom de l'auteur à l'ÉCRITURE (`kojo_shared`). Le nom
est donc RECOPIÉ dans le document du destinataire, et la cascade de suppression
ne touchait que `notifications.user_id == compte supprimé` : la copie restait en
clair dans la boîte du tiers, après que `first_name`/`last_name` aient été
effacés du document `users` — un nom de personne qui survit à son effacement.

Le test suit le VRAI flux mission (inscription des deux comptes, publication,
proposition, acceptation, suppression) et mesure quatre choses, dans cet ordre
parce que l'ordre porte la preuve :

  1. la NON-VACUITÉ — avant la suppression, le nom EST dans la notification du
     tiers. Sans cette étape, le test resterait vert même si `notify_user_localized`
     n'écrivait plus rien du tout ;
  2. l'EFFET — après suppression, le nom n'y est plus, à l'API comme en base ;
  3. la RÉÉCRITURE, pas la disparition — la notification du tiers existe
     toujours (il garde son information : une proposition reçue reste une
     proposition reçue), son titre et son corps sont conservés, seul le nom cède
     la place au libellé neutre ;
  4. la PRÉCISION — aucune autre notification n'est réécrite, champ pour champ.

Limite assumée : la recherche porte sur la chaîne du nom. Deux comptes qui
porteraient EXACTEMENT le même nom sont indiscernables dans le texte d'une
notification — c'est une propriété de la donnée recopiée, pas de la recherche,
et elle disparaîtrait en ne stockant plus le nom du tout.
"""
import asyncio

import pytest
from httpx import AsyncClient

from kojo_core import db
from kojo_shared import NOM_COMPTE_SUPPRIME
from tests.conftest import (
    BASE_JOB,
    BASE_USER,
    WORKER_USER,
    register_and_login,
)

PROPOSAL_AMOUNT = 25000

# Noms distincts, et distincts de `BASE_USER` / `WORKER_USER` (qui partagent
# « Kojo Test ») : sans cette distinction, la réécriture d'un nom mesurerait
# celle de l'autre.
NOM_CLIENT = ("Kojo", "Client")
NOM_TRAVAILLEUR = ("Awa", "Diop")


def _nom(prenom_nom) -> str:
    return f"{prenom_nom[0]} {prenom_nom[1]}"


def _compte(base: dict, email: str, type_compte: str, nom) -> dict:
    return {
        **base,
        "email": email,
        "user_type": type_compte,
        "first_name": nom[0],
        "last_name": nom[1],
    }


async def _drain_les_taches_de_fond() -> None:
    """`notify_user_localized` est lancée via `asyncio.create_task` : céder la
    main laisse les écritures de notification aboutir avant de lire la base."""
    for _ in range(5):
        await asyncio.sleep(0)


async def _notifications(collection_ou_api, headers=None, client=None):
    """Les notifications du tiers, lues à l'API quand un client est fourni,
    sinon en base (l'API prouve la propriété visible, la base la prouve
    exhaustivement)."""
    if client is not None:
        resp = await client.get("/api/notifications", headers=headers)
        assert resp.status_code == 200, resp.text
        return resp.json()["notifications"]
    return await db.notifications.find({}).to_list(length=None)


async def _flux_mission(client: AsyncClient, nom_client, nom_travailleur):
    """Inscription des deux comptes, publication, proposition, acceptation.

    Rend les en-têtes des deux parties, leurs identifiants et l'identifiant de
    la mission — la même base pour les deux sens du test (le nom du travailleur
    chez le client, celui du client chez le travailleur).
    """
    client_user = await register_and_login(
        client, _compte(BASE_USER, "client@kojo.sn", "client", nom_client)
    )
    worker_user = await register_and_login(
        client, _compte(WORKER_USER, "worker@kojo.sn", "worker", nom_travailleur)
    )
    client_headers = {"Authorization": f"Bearer {client_user['access_token']}"}
    worker_headers = {"Authorization": f"Bearer {worker_user['access_token']}"}

    resp = await client.post("/api/jobs", headers=client_headers, json=BASE_JOB)
    assert resp.status_code == 200, f"création de la mission : {resp.text}"
    job_id = resp.json()["id"]

    resp = await client.post(
        f"/api/jobs/{job_id}/proposals",
        headers=worker_headers,
        json={
            "proposed_amount": PROPOSAL_AMOUNT,
            "estimated_completion_time": "2 jours",
            "message": "Je suis disponible immédiatement pour cette mission.",
        },
    )
    assert resp.status_code == 200, f"proposition : {resp.text}"

    resp = await client.get(f"/api/jobs/{job_id}/proposals", headers=client_headers)
    assert resp.status_code == 200, resp.text
    propositions = resp.json()
    assert len(propositions) == 1, propositions

    resp = await client.post(
        f"/api/jobs/{job_id}/proposals/{propositions[0]['id']}/accept",
        headers=client_headers,
        json={"location": {"latitude": 14.69, "longitude": -17.44}},
    )
    assert resp.status_code == 200, f"acceptation : {resp.text}"
    await _drain_les_taches_de_fond()

    return {
        "client_headers": client_headers,
        "worker_headers": worker_headers,
        "client_id": client_user["user"]["id"],
        "worker_id": worker_user["user"]["id"],
        "job_id": job_id,
    }


def _notifications_citant(documents, nom: str):
    return [
        doc for doc in documents
        if nom in (doc.get("title") or "") or nom in (doc.get("body") or "")
    ]


@pytest.mark.asyncio
class TestNomDuCompteSupprimeChezLeTiers:

    async def test_le_nom_du_travailleur_supprime_quitte_la_boite_du_client(
        self, client: AsyncClient
    ):
        """Le client a reçu « {worker_name} a soumis une proposition ». Le
        travailleur supprime son compte : le nom doit céder la place au libellé
        neutre, et le client doit garder sa notification."""
        flux = await _flux_mission(client, NOM_CLIENT, NOM_TRAVAILLEUR)
        nom = _nom(NOM_TRAVAILLEUR)

        # 1. NON-VACUITÉ : le nom est bien chez le tiers AVANT.
        avant_api = await _notifications(None, flux["client_headers"], client)
        citees = _notifications_citant(avant_api, nom)
        assert citees, (
            "aucune notification du client ne cite le travailleur : le flux "
            "n'écrit plus le nom, donc le test ne mesurerait rien"
        )
        avant_boite = {n["id"]: dict(n) for n in avant_api}

        # 2. Suppression du compte dont le nom est recopié.
        resp = await client.delete("/api/users/account", headers=flux["worker_headers"])
        assert resp.status_code == 200, resp.text

        # 3. EFFET, vu par l'API (ce que le tiers affiche)…
        apres_api = await _notifications(None, flux["client_headers"], client)
        assert not _notifications_citant(apres_api, nom), (
            "le nom du compte supprimé est encore servi dans la boîte du client : "
            f"{_notifications_citant(apres_api, nom)}"
        )
        # …et en BASE, partout : aucune notification d'aucune boîte ne le cite.
        tout = await _notifications(None)
        restants = _notifications_citant(tout, nom)
        assert not restants, f"le nom survit en base : {restants}"

        # 4. RÉÉCRITURE, pas disparition : mêmes identifiants, même nombre, et
        #    le seul texte modifié est celui qui portait le nom.
        apres_boite = {n["id"]: dict(n) for n in apres_api}
        # La boîte peut s'ALLONGER : la suppression fait aussi annuler la mission
        # et le client reçoit sa notification d'annulation. Elle ne doit jamais
        # se raccourcir — une notification du tiers qui disparaîtrait serait une
        # perte, pas un effacement.
        assert set(avant_boite) <= set(apres_boite), (
            "la notification du tiers a été supprimée au lieu d'être réécrite : "
            f"{sorted(set(avant_boite) - set(apres_boite))}"
        )
        ids_citees = {n["id"] for n in citees}
        for identifiant, avant in avant_boite.items():
            apres = apres_boite[identifiant]
            if identifiant in ids_citees:
                assert NOM_COMPTE_SUPPRIME in apres["body"], apres
                assert nom not in apres["body"], apres
                # Le reste de la phrase est conservé, et rien d'autre ne bouge.
                assert apres["body"] == avant["body"].replace(nom, NOM_COMPTE_SUPPRIME)
                assert apres["title"] == avant["title"]
            else:
                assert apres == avant, (
                    f"notification non concernée réécrite : {avant} → {apres}"
                )
            for champ in ("type", "related_id", "is_read", "created_at"):
                assert apres[champ] == avant[champ], (identifiant, champ)

    async def test_le_nom_du_client_supprime_quitte_la_boite_du_travailleur(
        self, client: AsyncClient
    ):
        """Symétrique : « {client_name} a accepté votre proposition » est écrite
        dans la boîte du travailleur, donc c'est elle que la suppression du
        compte client doit nettoyer. Un correctif qui ne traiterait que le sens
        « client notifié » laisserait ce nom-là en place."""
        flux = await _flux_mission(client, NOM_CLIENT, NOM_TRAVAILLEUR)
        nom = _nom(NOM_CLIENT)

        avant = await _notifications(None, flux["worker_headers"], client)
        assert _notifications_citant(avant, nom), (
            "aucune notification du travailleur ne cite le client : le flux "
            "n'écrit plus le nom, donc le test ne mesurerait rien"
        )

        resp = await client.delete("/api/users/account", headers=flux["client_headers"])
        assert resp.status_code == 200, resp.text

        apres = await _notifications(None, flux["worker_headers"], client)
        assert not _notifications_citant(apres, nom), (
            f"le nom du client supprimé est encore servi au travailleur : "
            f"{_notifications_citant(apres, nom)}"
        )
        corps = [n["body"] for n in apres]
        assert any(NOM_COMPTE_SUPPRIME in c for c in corps), (
            "aucune notification réécrite : le nom a peut-être été effacé par "
            f"un autre chemin que la réécriture — {corps}"
        )
