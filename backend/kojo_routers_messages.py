import asyncio
import jwt
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from kojo_core import db
from kojo_models import (
    Country, EmailOtpRequest, EmailOtpResendRequest,
    EmailOtpVerifyRequest, Job, JobCreate, JobProposal, JobStatus, Language,
    MarkReadRequest, Message, MessageCreate, Notification, NotificationType,
    PasswordResetConfirmRequest, PaymentAccount, PaymentCheckoutRequest,
    PaymentMethod, PaymentQuoteRequest, PaymentStatus,
    ProposalCreate, PushToken, PushTokenCreate, SupportTicket,
    SupportTicketCreate, SupportTicketStatus, SupportTicketStatusUpdate,
    User, UserLogin, UserRegister, UserType, UserWithPayment, WorkerProfile,
)
from kojo_settings import (
    EMAIL_OTP_EXPIRY_MINUTES,
    EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    JWT_ALGORITHM,
    JWT_SECRET,
    OWNER_EMAIL,
    PAYDUNYA_MODE,
    PAYDUNYA_STORE_NAME,
    PAYMENT_COMMISSION_RATE,
    VAPID_PUBLIC_KEY,
    logger,
)
from kojo_core import (
    create_access_token, get_current_user, hash_password, is_database_available,
    log_and_raise_http_exception, mask_bank_account_info, revoke_token,
    sanitize_email, sanitize_input_string, security,
    upload_profile_photo_to_cloudinary, validate_payment_accounts,
    verify_owner_access, verify_password, validate_orange_money_number,
    validate_wave_number,
)
from kojo_email import (
    create_email_verification_token, generate_email_otp_code, hash_email_otp,
    issue_email_otp, verify_email_verification_token, mask_email_address,
)
from kojo_shared import notify_user, _dispatch_address_to_worker
from kojo_payments import (
    PAYDUNYA_CHANNELS,
    build_checkout_redirect_url, build_disburse_callback_url,
    build_payment_callback_url, calculate_payment_breakdown,
    check_paydunya_disburse_status, confirm_paydunya_invoice,
    create_paydunya_disburse_invoice, create_paydunya_invoice,
    get_paydunya_channel, get_paydunya_withdraw_mode,
    is_paydunya_configured, map_paydunya_status, normalize_payment_country,
    serialize_payment_record, strip_country_code_for_disburse,
    submit_paydunya_disburse_invoice, sync_payment_status_with_paydunya,
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
