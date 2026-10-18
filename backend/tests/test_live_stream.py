# -*- coding: utf-8 -*-
"""Le push (SSE) remplace le sondage : ce que ces tests établissent.

`SCALING.md` §5 chiffre le défaut : un utilisateur qui lit ses messages coûtait
jusqu'à 18 requêtes par minute alors que rien ne changeait — le sondage
(`NotificationContext` toutes les 30 s, fil ouvert toutes les 5 s, liste des
conversations toutes les 15 s). Ce fichier mesure la MOITIÉ SERVEUR du
remplacement :

  * un événement poussé arrive au flux OUVERT du bon compte, et à lui seul ;
  * l'identifiant poussé est celui de la ligne STOCKÉE (sinon la ligne reçue
    serait insupprimable — le défaut déjà documenté par
    `test_notifications_delete.py`) ;
  * un flux fermé est RETIRÉ du registre (sans quoi un onglet fermé épuiserait
    le plafond par compte, et les vrais flux finiraient en 503) ;
  * un flux en retard reçoit `resync` au lieu de perdre un événement en
    silence ;
  * le plafond est un 503 NOMMÉ, pas un flux vide et muet — un flux accepté qui
    ne pousse rien serait indiscernable d'une absence d'événements.

La moitié CLIENT (aucun `setInterval` de sondage quand le flux vit, repli
dégradé sinon) est mesurée par `frontend/src/services/__tests__/liveStream.test.js`
et `frontend/src/contexts/__tests__/NotificationStream.test.jsx`.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from httpx import AsyncClient

import kojo_live
import kojo_shared
from kojo_models import NotificationType
from tests.conftest import BASE_USER, db_find_one, register_and_login


@pytest.fixture(autouse=True)
def flux_vierges():
    """Isole chaque cas : le registre de flux est un état de PROCESS."""
    kojo_live.reset_streams()
    yield
    kojo_live.reset_streams()


def _trame(texte: str) -> tuple:
    """`(event, data)` d'une trame SSE — les commentaires sont ignorés."""
    lignes = [ligne for ligne in texte.splitlines() if ligne and not ligne.startswith(":")]
    evenement = next(ligne[len("event:"):].strip() for ligne in lignes if ligne.startswith("event:"))
    charge = next(ligne[len("data:"):].strip() for ligne in lignes if ligne.startswith("data:"))
    return evenement, json.loads(charge)


def _compte(user: dict) -> dict:
    return {"Authorization": "Bearer %s" % user["access_token"]}


@pytest.mark.asyncio
async def test_le_flux_sert_l_amorcage_puis_les_evenements_pousses():
    """Le premier événement est l'état EXACT, les suivants sont les événements.

    `ready` porte le compteur non lus : le client n'a donc pas besoin d'appeler
    `/notifications/unread-count` à l'ouverture, ce qui serait le sondage
    déguisé en amorçage.
    """
    queue = kojo_live.subscribe("compte-1")
    flux = kojo_live.event_stream(
        "compte-1", queue, initial=(("ready", {"unread_count": 3}),)
    )
    try:
        assert _trame(await anext(flux)) == ("ready", {"unread_count": 3})

        servis = kojo_live.publish("compte-1", "notification", {"notification": {"id": "n1"}})
        assert servis == 1

        evenement, charge = _trame(await anext(flux))
        assert evenement == "notification"
        assert charge["notification"]["id"] == "n1"
        assert kojo_live.active_streams() == 1
    finally:
        await flux.aclose()

    # Fermer le flux le RETIRE du registre : un abonné fantôme ferait refuser
    # les vrais flux du compte au plafond.
    assert kojo_live.active_streams() == 0
    assert kojo_live.active_streams_for("compte-1") == 0


@pytest.mark.asyncio
async def test_un_evenement_ne_joint_que_le_compte_destine():
    """Le fan-out est adressé : publier pour A ne réveille pas le flux de B."""
    queue_a = kojo_live.subscribe("a")
    queue_b = kojo_live.subscribe("b")

    assert kojo_live.publish("a", "message", {"id": "m1"}) == 1

    evenement, charge = await asyncio.wait_for(queue_a.get(), timeout=1)
    assert (evenement, charge) == ("message", {"id": "m1"})
    assert queue_b.empty(), "le flux d'un autre compte a reçu l'événement"

    assert kojo_live.publish("compte-sans-flux", "message", {}) == 0


@pytest.mark.asyncio
async def test_le_battement_de_coeur_garde_le_flux_ouvert_sans_requete(monkeypatch):
    """Le silence est rompu par un COMMENTAIRE SSE, pas par une requête.

    Sans lui, un proxy coupe une connexion muette au bout d'une minute et le
    client croit le flux vivant : la panne serait invisible des deux côtés.
    """
    monkeypatch.setattr(kojo_live, "HEARTBEAT_SECONDS", 0.01)
    queue = kojo_live.subscribe("compte-battement")
    flux = kojo_live.event_stream("compte-battement", queue)
    try:
        assert await anext(flux) == ": keepalive\n\n"
    finally:
        await flux.aclose()


@pytest.mark.asyncio
async def test_un_flux_en_retard_recoit_resync_au_lieu_de_perdre_un_evenement():
    """File pleine = le client est en retard, pas l'événement perdu.

    `resync` lui demande de RELIRE la source de vérité. Le perdre en silence
    laisserait un compteur faux jusqu'au prochain rechargement.
    """
    queue = kojo_live.subscribe("compte-lent")
    for index in range(kojo_live.MAX_QUEUE_SIZE + 5):
        kojo_live.publish("compte-lent", "notification", {"index": index})

    evenements = []
    while not queue.empty():
        evenements.append(queue.get_nowait()[0])

    assert "resync" in evenements, evenements[-3:]
    assert len(evenements) <= kojo_live.MAX_QUEUE_SIZE


@pytest.mark.asyncio
async def test_le_plafond_par_compte_est_un_refus_nomme(client: AsyncClient):
    """Au plafond, la route répond 503 (avec `Retry-After`), jamais un flux muet.

    Un flux accepté qui ne pousserait rien serait indiscernable d'une absence
    d'événements : le client attendrait indéfiniment au lieu de se rabattre sur
    son sondage dégradé.
    """
    user = await register_and_login(client, BASE_USER)
    for _ in range(kojo_live.MAX_STREAMS_PER_USER):
        kojo_live.subscribe(user["user"]["id"])

    for chemin in ("/api/notifications/stream", "/api/messages/stream"):
        resp = await client.get(chemin, headers=_compte(user))
        assert resp.status_code == 503, (chemin, resp.status_code, resp.text)
        assert resp.headers.get("retry-after") == "60", resp.headers


@pytest.mark.asyncio
async def test_les_flux_sont_fermes_aux_visiteurs_anonymes(client: AsyncClient):
    """Le flux est une surface AUTHENTIFIÉE, comme la liste qu'il remplace."""
    for chemin in ("/api/notifications/stream", "/api/messages/stream"):
        resp = await client.get(chemin)
        assert resp.status_code == 401, (chemin, resp.status_code)


@pytest.mark.asyncio
async def test_une_notification_stockee_est_poussee_avec_son_identifiant_serveur(
    client: AsyncClient, monkeypatch,
):
    """L'identifiant poussé est CELUI de la ligne stockée.

    C'est la contrepartie temps réel du défaut « je supprime, ça refuse de
    disparaître » : un identifiant inventé côté client ne désignerait rien, le
    DELETE répondrait 404 et la ligne resterait à l'écran.
    """
    user = await register_and_login(client, BASE_USER)
    user_id = user["user"]["id"]

    async def pas_de_push_web(**_kwargs):
        return None

    monkeypatch.setattr(kojo_shared, "send_web_push_to_user", pas_de_push_web)

    queue = kojo_live.subscribe(user_id)
    await kojo_shared.notify_user(
        user_id=user_id,
        title="Nouvelle proposition reçue",
        body="Un client a soumis une proposition",
        notif_type=NotificationType.PROPOSAL_RECEIVED,
        related_id="job-42",
        related_type="job",
    )

    evenement, charge = await asyncio.wait_for(queue.get(), timeout=1)
    assert evenement == "notification"
    stockee = await db_find_one("notifications", {"user_id": user_id})
    assert stockee is not None, "aucune notification stockée"
    assert charge["notification"]["id"] == stockee["id"], (
        "le flux pousse un identifiant qui ne désigne pas la ligne stockée : %s"
        % charge["notification"]
    )
    # Le corps du document suit celui de l'API (le client l'affiche tel quel).
    assert charge["notification"]["title"] == "Nouvelle proposition reçue"


@pytest.mark.asyncio
async def test_un_message_envoye_est_pousse_au_destinataire(client: AsyncClient):
    """Le message envoyé arrive au flux du DESTINATAIRE, avec sa conversation.

    La liste des conversations et le fil ouvert se mettent à jour depuis cet
    événement : c'est ce qui supprime les sondages de 15 s et 5 s.
    """
    expediteur = await register_and_login(client, BASE_USER)
    destinataire = await register_and_login(
        client, {**BASE_USER, "email": "destinataire_flux@example.com"}
    )

    queue = kojo_live.subscribe(destinataire["user"]["id"])
    # L'expéditeur reçoit le MÊME événement : ses autres appareils suivent la
    # conversation ouverte sans sondage (le compteur non-lus ne bouge que pour
    # le destinataire, côté client).
    queue_expediteur = kojo_live.subscribe(expediteur["user"]["id"])
    resp = await client.post(
        "/api/messages",
        headers=_compte(expediteur),
        json={"receiver_id": destinataire["user"]["id"], "content": "Bonjour"},
    )
    assert resp.status_code == 200, resp.text

    evenement, charge = await asyncio.wait_for(queue.get(), timeout=1)
    assert evenement == "message"
    assert charge["content"] == "Bonjour"
    assert charge["conversation_id"] == resp.json()["conversation_id"]
    assert charge["sender_id"] == expediteur["user"]["id"]
    assert charge["id"] == resp.json()["id"]

    evenement_echo, charge_echo = await asyncio.wait_for(queue_expediteur.get(), timeout=1)
    assert evenement_echo == "message"
    assert charge_echo["id"] == resp.json()["id"], (
        "l'appareil qui a envoyé (ou un autre appareil du compte) ne reçoit pas "
        "l'événement : sa liste de conversations resterait figée"
    )
