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

@router.get("/notifications/vapid-public-key")
async def get_vapid_public_key():
    """Retourne la clé VAPID publique pour que le frontend puisse s'abonner."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Notifications push non configurées sur ce serveur")
    return {"vapid_public_key": VAPID_PUBLIC_KEY}

@router.get("/notifications")
async def get_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user)
):
    """Récupère les notifications de l'utilisateur connecté (les plus récentes en premier)."""
    query: dict = {"user_id": current_user.id}
    if unread_only:
        query["is_read"] = False

    notifications = await db.notifications.find(query).sort("created_at", -1).to_list(limit)
    unread_count = await db.notifications.count_documents({"user_id": current_user.id, "is_read": False})

    return {
        "notifications": [Notification(**n).model_dump() for n in notifications],
        "unread_count": unread_count,
        "total": len(notifications),
    }

@router.get("/notifications/unread-count")
async def get_unread_count(current_user: User = Depends(get_current_user)):
    """Retourne uniquement le compteur de notifications non lues (polling léger)."""
    count = await db.notifications.count_documents({"user_id": current_user.id, "is_read": False})
    return {"unread_count": count}

@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user)
):
    """Marque une notification spécifique comme lue."""
    result = await db.notifications.update_one(
        {"id": notification_id, "user_id": current_user.id},
        {"$set": {"is_read": True}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    return {"message": "Notification marquée comme lue"}

@router.put("/notifications/mark-all-read")
async def mark_all_notifications_read(current_user: User = Depends(get_current_user)):
    """Marque toutes les notifications de l'utilisateur comme lues."""
    result = await db.notifications.update_many(
        {"user_id": current_user.id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"message": f"{result.modified_count} notification(s) marquée(s) comme lue(s)", "updated": result.modified_count}

@router.delete("/notifications/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user)
):
    """Supprime une notification de l'utilisateur."""
    result = await db.notifications.delete_one({"id": notification_id, "user_id": current_user.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    return {"message": "Notification supprimée"}

@router.delete("/notifications")
async def delete_all_notifications(current_user: User = Depends(get_current_user)):
    """Supprime toutes les notifications de l'utilisateur."""
    result = await db.notifications.delete_many({"user_id": current_user.id})
    return {"message": f"{result.deleted_count} notification(s) supprimée(s)", "deleted": result.deleted_count}
