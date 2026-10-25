
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import kojo_live
from kojo_auth_core import exiger_compte_actif
from kojo_core import db
from kojo_models import (
    Message, MessageCreate, User,
)
from kojo_core import (
    get_current_user,
)
from kojo_settings import logger
from kojo_identifiants import dump_stable, identifiant_query

# Champs JAMAIS exposés quand on sérialise un AUTRE utilisateur (PII).
SENSITIVE_OTHER_USER_FIELDS = {"password_hash", "payment_accounts", "email", "phone"}

router = APIRouter()

@router.post("/messages")
async def send_message(
    message_data: MessageCreate,
    current_user: User = Depends(get_current_user),
    # Écrire est une ÉCRITURE : un compte restreint (lecture seule) la perd.
    # La lecture des fils existants, elle, reste ouverte.
    _actif: User = Depends(exiger_compte_actif),
):
    """Envoie un message privé (l'expéditeur doit exister et différer du
    destinataire ; la conversation est dérivée des deux ids triés).

    Returns:
        dict: message créé (conversation_id, sender_id, receiver_id,
        content, job_id, timestamp…).
    """
    # Anti-spam / anti-bruit : le destinataire doit exister, et on ne peut
    # pas s'envoyer un message à soi-même.
    if message_data.receiver_id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous envoyer un message à vous-même")

    # Projection {"id": 1} (pas {"_id": 1}) : reste truthy avec la FakeDB de
    # test qui projette vers un dict vide pour _id seul.
    receiver_exists = await db.users.find_one({**identifiant_query(message_data.receiver_id)}, {"id": 1})
    if receiver_exists is None:
        raise HTTPException(status_code=404, detail="Destinataire introuvable")

    # Generate conversation ID
    conversation_id = f"{min(current_user.id, message_data.receiver_id)}_{max(current_user.id, message_data.receiver_id)}"

    message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        receiver_id=message_data.receiver_id,
        content=message_data.content,
        job_id=message_data.job_id
    )

    await db.messages.insert_one(message.model_dump())
    # PUSH TEMPS RÉEL : le message est stocké AVANT d'être annoncé, donc le
    # destinataire peut l'afficher sans relire l'API (et sans le voir deux fois
    # s'il relit quand même : le client déduplique par identifiant). Un envoi
    # sans flux ouvert est le cas normal — l'événement part dans le vide et le
    # message reste lisible par `GET /messages/{conversation_id}`.
    charge = message.model_dump(mode="json")
    kojo_live.publish(message_data.receiver_id, "message", charge)
    # Le MÊME événement part à l'expéditeur : ses autres appareils suivent la
    # conversation ouverte sans sondage. L'appareil qui vient d'envoyer
    # déduplique par identifiant (il relit son propre fil au plus une fois),
    # et le client n'incrémente le compteur non-lus que si le message est REÇU.
    kojo_live.publish(current_user.id, "message", charge)
    return message.model_dump()

@router.get("/messages")
async def get_all_messages(current_user: User = Depends(get_current_user)):
    """Récupérer tous les messages de l'utilisateur connecté (100 derniers).

    Returns:
        list[dict]: messages où l'utilisateur est expéditeur ou destinataire.
    """
    messages = await db.messages.find({
        "$or": [
            {"sender_id": current_user.id},
            {"receiver_id": current_user.id}
        ]
    }, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return messages

@router.get("/messages/conversations")
async def get_conversations(current_user: User = Depends(get_current_user)):
    """Liste des conversations de l'utilisateur (dernier message, non-lus,
    interlocuteur). L'interlocuteur supprimé (soft-delete RGPD) est un objet
    neutre {is_deleted: true} — jamais null.

    Returns:
        list[dict]: conversations triées par activité décroissante, chacune
        avec last_message, last_timestamp, unread_count, other_user et
        other_user_name.
    """
    # Regroupement par conversation fait en Python (équivalent fonctionnel de
    # l'ancien pipeline $match/$sort/$group de Mongo) : le dernier message est
    # déterminé par comparaison de timestamp, donc PAS de dépendance à l'ordre
    # d'arrivée des documents. Compatible avec la FakeDB de test.
    # Borné (2000) : évite de charger toute la collection en mémoire sur un
    # compte très actif, tout en restant largement au-dessus des conversations
    # réelles. Un message plus ancien que cette fenêtre n'affecte pas l'aperçu.
    messages = await db.messages.find({
        "$or": [
            {"sender_id": current_user.id},
            {"receiver_id": current_user.id}
        ]
    }).to_list(length=2000)

    grouped = {}
    for msg in messages:
        conv_id = msg.get("conversation_id")
        if not conv_id:
            continue
        entry = grouped.setdefault(conv_id, {
            "_id": conv_id,
            "last_message": None,
            "last_timestamp": None,
            "sender_ids": set(),
            "receiver_ids": set(),
            "unread_count": 0,
        })
        ts = msg.get("timestamp")
        if entry["last_timestamp"] is None or str(ts) > str(entry["last_timestamp"]):
            entry["last_timestamp"] = ts
            entry["last_message"] = msg.get("content")
        if msg.get("sender_id"):
            entry["sender_ids"].add(msg["sender_id"])
        if msg.get("receiver_id"):
            entry["receiver_ids"].add(msg["receiver_id"])
            if msg["receiver_id"] == current_user.id and not msg.get("read"):
                entry["unread_count"] += 1

    conversations = []
    for entry in grouped.values():
        entry["sender_ids"] = sorted(entry["sender_ids"])
        entry["receiver_ids"] = sorted(entry["receiver_ids"])
        conversations.append(entry)

    conversations.sort(key=lambda c: str(c["last_timestamp"] or ""), reverse=True)
    conversations = conversations[:100]

    # Get other user info for each conversation
    result = []
    for conv in conversations:

        # Extract other user ID from conversation
        conv_parts = conv["_id"].split("_")
        other_user_id = None

        # Find the ID that is not current user
        for uid in conv_parts:
            if uid != current_user.id:
                other_user_id = uid
                break

        # Fetch other user data
        if other_user_id:
            other_user = await db.users.find_one({**identifiant_query(other_user_id)})
            if other_user:
                other_user_dict = {k: v for k, v in other_user.items() if k != "_id"}
                # SECURITE/PII : on n'expose JAMAIS les comptes de paiement,
                # l'email ou le téléphone de l'interlocuteur — uniquement
                # les données utiles à l'affichage (nom, photo, notation).
                conv["other_user"] = dump_stable(
                    User, other_user_dict, exclude=SENSITIVE_OTHER_USER_FIELDS
                )
                first_name = other_user.get("first_name", "").strip()
                last_name = other_user.get("last_name", "").strip()
                full_name = f"{first_name} {last_name}".strip()
                conv["other_user_name"] = full_name or other_user.get("email") or "Unknown"
            else:
                # Interlocuteur SUPPRIMÉ (soft-delete RGPD) : jamais null —
                # objet neutre `is_deleted: true` pour que les consommateurs
                # (rendu avatar, nom, navigation) n'aient pas à gérer un null
                # (même pattern que les retours `detected:false` du frontend).
                conv["other_user"] = {
                    "id": other_user_id,
                    "first_name": "",
                    "last_name": "",
                    "profile_photo": None,
                    "is_deleted": True,
                }
                conv["other_user_name"] = "Unknown"

        result.append(conv)

    return result

@router.get("/messages/stream")
async def stream_messages(current_user: User = Depends(get_current_user)):
    """Flux SSE des messages REÇUS par le compte connecté (remplace le sondage).

    Chaque événement `message` porte le message complet (identifiant,
    conversation, contenu, horodatage) : la liste des conversations et le fil
    ouvert se mettent à jour sans aucune requête. Le fil reste relu quand il est
    ouvert, parce que c'est CETTE lecture qui marque les messages comme lus —
    une fois par message reçu, plus toutes les 5 secondes.

    Déclarée AVANT `/messages/{conversation_id}` : l'ordre d'enregistrement
    décide, et `stream` serait sinon pris pour un identifiant de conversation.

    Raises:
        HTTPException: 503 quand un des deux plafonds est atteint — celui du
            process, ou celui du COMPTE (tous workers confondus). Le client
            retombe alors sur son sondage dégradé.

    Returns:
        StreamingResponse: `text/event-stream`.
    """
    try:
        return await kojo_live.sse_response(
            current_user.id,
            initial=(('ready', {"ok": True}),),
        )
    except kojo_live.StreamCapacityExceeded as exc:
        raise HTTPException(
            status_code=503,
            detail="Flux temps réel momentanément indisponible : réessayez dans un instant.",
            headers={"Retry-After": "60"},
        ) from exc

async def _nomme_participant(conversation_id: str, user_id: str) -> bool:
    """Le fil encore VIDE nomme-t-il ce compte comme l'un de ses deux participants ?

    `conversation_id` vaut `{id1}_{id2}`, les deux identifiants triés — mais un
    identifiant peut LUI-MÊME contenir « _ » (comptes hérités, ex.
    « famakan_kontaga_master_2024 »). Le découpage sur « _ » ne le reconnaît
    alors plus : mesuré en production le 25/10/2026, ce compte ouvrait une
    conversation ENCORE VIDE et recevait 403 « Access denied », donc la fiche
    affichait une erreur au lieu du compositeur de message.

    On lit donc les DEUX côtés de chaque séparateur, et on exige que l'autre
    côté soit un compte EXISTANT : sans cette vérification, « abc » serait
    déclaré participant d'un fil entre « abc_def » et « ghi » — un fragment
    d'identifiant ne désigne personne. Un fil REMPLI ne passe jamais par ici :
    son appartenance se lit dans ses messages (première requête de la route).
    """
    for position, caractere in enumerate(conversation_id):
        if caractere != "_":
            continue
        gauche, droite = conversation_id[:position], conversation_id[position + 1:]
        if gauche == user_id and droite:
            autre = droite
        elif droite == user_id and gauche:
            autre = gauche
        else:
            continue
        pair = await db.users.find_one({**identifiant_query(autre)}, {"id": 1})
        if pair is not None:
            return True
    return False


@router.get("/messages/{conversation_id}")
async def get_conversation_messages(
    conversation_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    current_user: User = Depends(get_current_user)
):
    """Messages d'une conversation (paginated par offset, ordre asc/desc ;
    accès réservé aux participants ; marque les reçus comme lus).

    Returns:
        list[dict]: messages de la conversation (ordre chronologique),
        avec conversation_id et les flags de lecture.
    """
    # ── L'appartenance se LIT DANS LE FIL, elle ne se devine pas ───────────
    # `conversation_id` vaut "{id1}_{id2}", et le découpage sur « _ » supposait
    # que les identifiants n'en contiennent jamais. C'est faux : les comptes
    # hérités en portent un (« famakan_kontaga_master_2024 »). Mesuré en
    # production le 24/10/2026 : ce compte ouvrait une conversation où il avait
    # écrit et recevait 403 « Access denied » — ses propres messages lui étaient
    # interdits, parce que le découpage ne le reconnaissait pas comme
    # participant.
    #
    # La première lecture est donc la PLUS EXACTE : un message du fil dont
    # l'expéditeur ou le destinataire est ce compte. Elle ne dépend d'aucune
    # forme d'identifiant, et elle resserre le contrôle au passage (un compte
    # qui n'apparaît dans le fil qu'en FRAGMENT d'un autre identifiant ne passe
    # plus). Le découpage ne survit que pour le fil VIDE, où il n'y a rien à
    # lire : c'est ce qui permet à un participant d'ouvrir une conversation
    # qu'aucun message n'a encore remplie.
    appartient = await db.messages.find_one(
        {
            "conversation_id": conversation_id,
            "$or": [
                {"sender_id": current_user.id},
                {"receiver_id": current_user.id},
            ],
        },
        {"id": 1},
    )
    if appartient is None:
        fil = await db.messages.find_one({"conversation_id": conversation_id}, {"id": 1})
        if fil is not None or not await _nomme_participant(conversation_id, current_user.id):
            raise HTTPException(status_code=403, detail="Access denied")
    
    # Pagination par offset. Le mode asc conserve le contrat historique ; le
    # mode desc permet au frontend de récupérer d'abord les messages récents,
    # puis les pages plus anciennes avec un offset croissant.
    sort_direction = -1 if order == "desc" else 1
    messages = await db.messages.find({
        "conversation_id": conversation_id
    }).sort("timestamp", sort_direction).skip(offset).to_list(limit)
    if order == "desc":
        # L'UI affiche toujours le fil dans l'ordre chronologique.
        messages.reverse()

    # Marquer comme lus les messages REÇUS par l'utilisateur qui ouvre la
    # conversation (le flag read n'était jamais utilisé : aucun indicateur
    # de non-lu n'était possible). read_at alimente l'accusé de réception
    # « Lu » côté frontend (horodatage unique pour le lot).
    if messages:
        try:
            read_at = datetime.now(timezone.utc)
            await db.messages.update_many(
                {
                    "conversation_id": conversation_id,
                    "receiver_id": current_user.id,
                    "read": False,
                },
                {"$set": {"read": True, "read_at": read_at}}
            )
            # Réflète le marquage dans la réponse renvoyée (sinon le client
            # voit read=False sur les messages qu'il vient d'ouvrir).
            for message in messages:
                if message.get("receiver_id") == current_user.id:
                    message["read"] = True
                    message["read_at"] = read_at
        except Exception as exc:
            logger.error(f"⚠️ Échec du marquage des messages comme lus: {exc}")

    return [Message(**message) for message in messages]
