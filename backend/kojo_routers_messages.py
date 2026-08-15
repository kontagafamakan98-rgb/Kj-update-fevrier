
from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db
from kojo_models import (
    Message, MessageCreate, User,
)
from kojo_core import (
    get_current_user,
)

router = APIRouter()

@router.post("/messages")
async def send_message(
    message_data: MessageCreate,
    current_user: User = Depends(get_current_user)
):
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
    # Get unique conversation partners with other user info
    pipeline = [
        {"$match": {
            "$or": [
                {"sender_id": current_user.id},
                {"receiver_id": current_user.id}
            ]
        }},
        # IMPORTANT: $group avec $last/$first dépend de l'ORDRE dans lequel
        # les documents arrivent au stage - sans ce $sort explicite juste
        # avant, MongoDB ne garantit PAS que "$last" corresponde réellement
        # au message le plus récent (l'aperçu affiché pouvait donc être un
        # message au hasard, pas le dernier envoyé).
        {"$sort": {"timestamp": 1}},
        {"$group": {
            "_id": "$conversation_id",
            "last_message": {"$last": "$content"},
            "last_timestamp": {"$last": "$timestamp"},
            "sender_ids": {"$addToSet": "$sender_id"},
            "receiver_ids": {"$addToSet": "$receiver_id"}
        }},
        {"$sort": {"last_timestamp": -1}}
    ]

    conversations = await db.messages.aggregate(pipeline).to_list(100)

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
                conv["other_user"] = User(**other_user_dict).model_dump(exclude={"password_hash"})
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
    
    return [Message(**message) for message in messages]
