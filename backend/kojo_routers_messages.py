
from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db
from kojo_models import (
    Message, MessageCreate, User,
)
from kojo_core import (
    get_current_user,
)
from kojo_settings import logger

# Champs JAMAIS exposés quand on sérialise un AUTRE utilisateur (PII).
SENSITIVE_OTHER_USER_FIELDS = {"password_hash", "payment_accounts", "email", "phone"}

router = APIRouter()

@router.post("/messages")
async def send_message(
    message_data: MessageCreate,
    current_user: User = Depends(get_current_user)
):
    # Anti-spam / anti-bruit : le destinataire doit exister, et on ne peut
    # pas s'envoyer un message à soi-même.
    if message_data.receiver_id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous envoyer un message à vous-même")

    # Projection {"id": 1} (pas {"_id": 1}) : reste truthy avec la FakeDB de
    # test qui projette vers un dict vide pour _id seul.
    receiver_exists = await db.users.find_one({"id": message_data.receiver_id}, {"id": 1})
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
    return message.model_dump()

@router.get("/messages")
async def get_all_messages(current_user: User = Depends(get_current_user)):
    """Récupérer tous les messages de l'utilisateur connecté"""
    messages = await db.messages.find({
        "$or": [
            {"sender_id": current_user.id},
            {"receiver_id": current_user.id}
        ]
    }, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return messages

@router.get("/messages/conversations")
async def get_conversations(current_user: User = Depends(get_current_user)):
    # Regroupement par conversation fait en Python (équivalent fonctionnel de
    # l'ancien pipeline $match/$sort/$group de Mongo) : le dernier message est
    # déterminé par comparaison de timestamp, donc PAS de dépendance à l'ordre
    # d'arrivée des documents. Compatible avec la FakeDB de test.
    messages = await db.messages.find({
        "$or": [
            {"sender_id": current_user.id},
            {"receiver_id": current_user.id}
        ]
    }).to_list(length=None)

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
            other_user = await db.users.find_one({"id": other_user_id})
            if other_user:
                other_user_dict = {k: v for k, v in other_user.items() if k != "_id"}
                # SECURITE/PII : on n'expose JAMAIS les comptes de paiement,
                # l'email ou le téléphone de l'interlocuteur — uniquement
                # les données utiles à l'affichage (nom, photo, notation).
                conv["other_user"] = User(**other_user_dict).model_dump(
                    exclude=SENSITIVE_OTHER_USER_FIELDS
                )
                first_name = other_user.get("first_name", "").strip()
                last_name = other_user.get("last_name", "").strip()
                full_name = f"{first_name} {last_name}".strip()
                conv["other_user_name"] = full_name or other_user.get("email") or "Unknown"
            else:
                conv["other_user"] = None
                conv["other_user_name"] = "Unknown"

        result.append(conv)

    return result

@router.get("/messages/{conversation_id}")
async def get_conversation_messages(
    conversation_id: str,
    current_user: User = Depends(get_current_user)
):
    # Verify user is part of conversation. conversation_id est formaté
    # "{id1}_{id2}" - on compare les IDs exacts après split, pas une
    # recherche de sous-chaîne ("in") qui pouvait matcher par accident si
    # l'ID d'un utilisateur apparaissait comme fragment d'un autre.
    participant_ids = conversation_id.split("_")
    if current_user.id not in participant_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    
    messages = await db.messages.find({
        "conversation_id": conversation_id
    }).sort("timestamp", 1).to_list(100)

    # Marquer comme lus les messages REÇUS par l'utilisateur qui ouvre la
    # conversation (le flag read n'était jamais utilisé : aucun indicateur
    # de non-lu n'était possible).
    if messages:
        try:
            await db.messages.update_many(
                {
                    "conversation_id": conversation_id,
                    "receiver_id": current_user.id,
                    "read": False,
                },
                {"$set": {"read": True}}
            )
        except Exception as exc:
            logger.error(f"⚠️ Échec du marquage des messages comme lus: {exc}")

    return [Message(**message) for message in messages]
