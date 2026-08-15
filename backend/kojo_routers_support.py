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

@router.post("/support/tickets")
async def create_support_ticket(ticket_data: SupportTicketCreate):
    ticket = SupportTicket(
        full_name=ticket_data.full_name.strip(),
        phone=ticket_data.phone.strip(),
        email=ticket_data.email,
        reason=ticket_data.reason.strip(),
        message=ticket_data.message.strip(),
        channel=ticket_data.channel,
    )
    await db.support_tickets.insert_one(ticket.model_dump())
    return {
        "message": "Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.",
        "ticket_id": ticket.id,
    }

@router.get("/support/tickets")
async def list_support_tickets(
    status_filter: Optional[str] = None,
    owner_user = Depends(verify_owner_access)
):
    query = {}
    if status_filter:
        query["status"] = status_filter
    tickets = await db.support_tickets.find(query).sort("created_at", -1).to_list(500)
    return [SupportTicket(**t).model_dump() for t in tickets]

@router.patch("/support/tickets/{ticket_id}/status")
async def update_support_ticket_status(
    ticket_id: str,
    status_update: SupportTicketStatusUpdate,
    owner_user = Depends(verify_owner_access)
):
    result = await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$set": {
            "status": status_update.status.value,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande de support introuvable")
    updated = await db.support_tickets.find_one({"id": ticket_id})
    return SupportTicket(**updated).model_dump()
