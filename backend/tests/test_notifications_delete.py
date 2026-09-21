# -*- coding: utf-8 -*-
"""La suppression d'une notification doit la faire disparaître POUR DE VRAI.

Ce fichier existe parce que la SUPPRESSION et le MARQUAGE COMME LUE n'étaient
couverts nulle part : la liste n'était lue que pour vérifier qu'un nom de compte
supprimé n'y survit pas (test_notifications_nom_compte_supprime.py), jamais pour
établir que l'identifiant qu'elle rend sait AGIR. Le symptôme rapporté était
« je supprime, ça refuse de disparaître » — c'est-à-dire une action qui répond
au client sans que la donnée change, ou une suppression qui vise un identifiant
que la base ne connaît pas.

Ce qui est mesuré ici est le COUPLE liste ↔ action : l'identifiant rendu par la
liste est celui que la suppression (et le marquage comme lue) accepte, et il
vient du DOCUMENT (il n'est pas inventé à la lecture). Le second chemin est le
push : ce qu'il annonce doit porter le même identifiant, sinon la ligne
affichée à la réception au premier plan naît insupprimable.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

import kojo_shared
from kojo_models import NotificationType
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

LISTE = "/api/notifications"


def _notification(user_id: str, **extra) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": "Nouvelle proposition reçue",
        "body": "Un client a soumis une proposition",
        "type": "proposal_received",
        "is_read": False,
    }
    doc.update(extra)
    return doc


async def _preparer(client: AsyncClient) -> tuple:
    user = await register_and_login(client, BASE_USER)
    return user, {"Authorization": f"Bearer {user['access_token']}"}


@pytest.mark.asyncio
async def test_l_identifiant_rendu_par_la_liste_vient_du_document(client: AsyncClient):
    """L'id exposé est CELUI de la base, pas un identifiant fabriqué à la lecture.

    C'est la propriété qui rend la suppression possible : un identifiant inventé
    à chaque lecture ne désigne rien, donc toute suppression viserait à côté.
    """
    user, headers = await _preparer(client)
    doc = _notification(user["user"]["id"])
    await db_insert("notifications", doc)

    resp = await client.get(LISTE, headers=headers)
    assert resp.status_code == 200, resp.text
    rendues = resp.json()["notifications"]
    assert [n["id"] for n in rendues] == [doc["id"]], (
        "la liste ne rend pas l'identifiant du document : %s" % rendues
    )

    # Deux lectures de suite rendent le MÊME identifiant (sinon il ne désigne rien).
    resp2 = await client.get(LISTE, headers=headers)
    assert [n["id"] for n in resp2.json()["notifications"]] == [doc["id"]]


@pytest.mark.asyncio
async def test_supprimer_une_notification_la_retire_de_la_liste_et_de_la_base(
    client: AsyncClient,
):
    user, headers = await _preparer(client)
    doc = _notification(user["user"]["id"])
    await db_insert("notifications", doc)

    suppr = await client.delete(f"{LISTE}/{doc['id']}", headers=headers)
    assert suppr.status_code == 200, suppr.text

    assert (await client.get(LISTE, headers=headers)).json()["notifications"] == []
    reste = await db_find_one("notifications", {"id": doc["id"]})
    assert reste is None, "la notification est toujours en base : %s" % reste


@pytest.mark.asyncio
async def test_supprimer_une_notification_inconnue_le_dit(client: AsyncClient):
    """Un identifiant que la base ne connaît pas est un 404 NOMMÉ, jamais un
    succès silencieux : « supprimé » pour une ligne qui reste serait le pire des
    deux mondes."""
    _user, headers = await _preparer(client)
    resp = await client.delete(f"{LISTE}/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_un_document_sans_id_rend_un_identifiant_STABLE_et_supprimable(
    client: AsyncClient,
):
    """Le cas des documents anterieurs au champ `id`.

    `Notification.id` porte une valeur par DEFAUT (`uuid4`) : lu avec le modele,
    un document qui n'a pas de champ `id` en recoit donc un NOUVEAU a chaque
    lecture. L'identifiant affiche ne designe alors rien de stable — la
    suppression vise a cote, repond 404, et l'element reste a l'ecran. C'est le
    symptome rapporte : « je supprime, ca refuse de disparaitre ».
    """
    user, headers = await _preparer(client)
    ancien = _notification(user["user"]["id"])
    ancien.pop("id")  # document d'AVANT le champ id
    await db_insert("notifications", ancien)

    premiere = (await client.get(LISTE, headers=headers)).json()["notifications"]
    seconde = (await client.get(LISTE, headers=headers)).json()["notifications"]
    assert [n["id"] for n in premiere] == [n["id"] for n in seconde], (
        "l'identifiant change d'une lecture a l'autre : %s puis %s"
        % ([n["id"] for n in premiere], [n["id"] for n in seconde])
    )
    assert premiere[0]["id"], "aucun identifiant rendu : rien n'est adressable"

    suppr = await client.delete("%s/%s" % (LISTE, premiere[0]["id"]), headers=headers)
    assert suppr.status_code == 200, suppr.text
    assert (await client.get(LISTE, headers=headers)).json()["notifications"] == []


@pytest.mark.asyncio
async def test_marquer_lue_accepte_le_meme_identifiant_que_la_liste(
    client: AsyncClient,
):
    """Mark-read partage la regle d'identifiant avec la liste et la suppression.

    Meme document hereditaire (sans champ `id`) : l'action ne doit pas viser a
    cote, sinon la pastille « non lu » reste alors que le client a agi.
    """
    user, headers = await _preparer(client)
    ancien = _notification(user["user"]["id"])
    ancien.pop("id")
    await db_insert("notifications", ancien)

    rendue = (await client.get(LISTE, headers=headers)).json()["notifications"][0]
    resp = await client.put(f"{LISTE}/{rendue['id']}/read", headers=headers)
    assert resp.status_code == 200, resp.text

    relue = (await client.get(LISTE, headers=headers)).json()["notifications"][0]
    assert relue["is_read"] is True, relue


@pytest.mark.asyncio
async def test_tout_supprimer_efface_toutes_les_notifications_du_compte(
    client: AsyncClient,
):
    """Le bouton corbeille de l'en-tete (DELETE /notifications)."""
    user, headers = await _preparer(client)
    for _ in range(3):
        await db_insert("notifications", _notification(user["user"]["id"]))

    resp = await client.delete(LISTE, headers=headers)
    assert resp.status_code == 200, resp.text
    assert (await client.get(LISTE, headers=headers)).json()["notifications"] == []
    assert (await client.get(LISTE, headers=headers)).json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_on_ne_supprime_pas_la_notification_d_un_autre_compte(client: AsyncClient):
    """La suppression est portée par le compte connecté, pas par l'identifiant."""
    _user, headers = await _preparer(client)
    autre = await register_and_login(
        client, {**BASE_USER, "email": "autre_compte_notif@example.com"}
    )
    doc = _notification(autre["user"]["id"])
    await db_insert("notifications", doc)

    resp = await client.delete(f"{LISTE}/{doc['id']}", headers=headers)
    assert resp.status_code == 404, resp.text
    assert await db_find_one("notifications", {"id": doc["id"]}) is not None


@pytest.mark.asyncio
async def test_le_push_transporte_l_identifiant_serveur_de_la_ligne_stockee(
    client: AsyncClient, monkeypatch,
):
    """Le push porte l'identifiant SERVEUR de la notification qu'il annonce.

    C'est la seconde moitié du symptôme « je supprime, ça refuse de disparaître » :
    le centre de notifications affiche AUSSI ce qu'il reçoit par push (au premier
    plan, sans passer par la liste serveur). Sans identifiant dans la charge utile,
    la ligne affichée en reçoit un fabriqué côté client (`local_<horodatage>`) :
    le DELETE vise le vide, répond 404, et la ligne reste à l'écran. Le client ne
    peut pas deviner l'identifiant d'une ligne qu'il n'a jamais lue.
    """
    user, _headers = await _preparer(client)
    user_id = user["user"]["id"]
    envois: list = []

    async def faux_envoi(user_id, title, body, data=None):
        envois.append({"user_id": user_id, "title": title, "data": data})

    monkeypatch.setattr(kojo_shared, "send_web_push_to_user", faux_envoi)

    await kojo_shared.notify_user(
        user_id=user_id,
        title="Nouvelle proposition reçue",
        body="Un client a soumis une proposition",
        notif_type=NotificationType.PROPOSAL_RECEIVED,
        related_id="job-42",
        related_type="job",
    )

    assert len(envois) == 1, envois
    stockee = await db_find_one("notifications", {"user_id": user_id})
    assert stockee is not None, "aucune notification stockée : rien à supprimer"
    assert envois[0]["data"]["notification_id"] == stockee["id"], (
        "le push ne porte pas l'identifiant serveur : le client en fabriquera un, "
        "et la suppression répondra 404 (%s)" % envois[0]["data"]
    )
    # Le champ historique survit : des clients s'en servent pour ouvrir la
    # mission annoncée.
    assert envois[0]["data"]["job_id"] == "job-42"


@pytest.mark.asyncio
async def test_une_charge_utile_fournie_par_l_appelant_est_conservee(
    client: AsyncClient, monkeypatch,
):
    """Une charge utile explicite n'est pas remplacée, seulement complétée."""
    user, _headers = await _preparer(client)
    envois: list = []

    async def faux_envoi(user_id, title, body, data=None):
        envois.append(data)

    monkeypatch.setattr(kojo_shared, "send_web_push_to_user", faux_envoi)

    await kojo_shared.notify_user(
        user_id=user["user"]["id"],
        title="Paiement reçu",
        body="Le séquestre a été libéré",
        notif_type=NotificationType.PAYMENT_RECEIVED,
        push_data={"type": "payment_received", "url": "/profile"},
    )

    assert envois[0]["type"] == "payment_received"
    assert envois[0]["url"] == "/profile"
    assert envois[0]["notification_id"], envois[0]


@pytest.mark.asyncio
async def test_un_stockage_en_echec_ne_bloque_pas_le_push_ni_le_flux_metier(
    client: AsyncClient, monkeypatch,
):
    """Le push part même si le stockage échoue — et SANS identifiant, plutôt
    qu'avec un identifiant qui ne désigne rien.

    Sans ce contrat, le client croirait la ligne adressable et la suppression
    répondrait 404 : exactement le symptôme rapporté. Côté client, une entrée
    sans `notification_id` est marquée locale et se supprime sur place.
    """
    user, _headers = await _preparer(client)
    envois: list = []

    async def faux_envoi(user_id, title, body, data=None):
        envois.append(data)

    async def stockage_casse(**kwargs):
        raise RuntimeError("base indisponible")

    monkeypatch.setattr(kojo_shared, "send_web_push_to_user", faux_envoi)
    monkeypatch.setattr(kojo_shared, "store_notification", stockage_casse)

    await kojo_shared.notify_user(
        user_id=user["user"]["id"],
        title="Notification sans stockage",
        body="Le flux métier continue",
    )

    assert len(envois) == 1, "le push doit partir malgré l'échec du stockage"
    assert "notification_id" not in (envois[0] or {}), (
        "un identifiant annoncé sans ligne stockée ferait une suppression en 404 : %s"
        % envois[0]
    )
