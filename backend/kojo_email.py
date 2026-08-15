# -*- coding: utf-8 -*-
"""Service email : OTP, jetons de vérification, fournisseurs Brevo/Gmail."""

import base64
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import List, Optional

import jwt
import requests
from fastapi import HTTPException

from kojo_core import db
from kojo_settings import (
    BREVO_API_KEY,
    BREVO_API_URL,
    BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME,
    EMAIL_OTP_EXPIRY_MINUTES,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    EMAIL_OTP_SECRET,
    EMAIL_PROVIDER,
    EMAIL_VERIFICATION_TOKEN_MINUTES,
    GMAIL_ACCESS_TOKEN_CACHE,
    GMAIL_ACCESS_TOKEN_SAFETY_SECONDS,
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN,
    GMAIL_SENDER_EMAIL,
    GMAIL_SENDER_NAME,
    GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS,
    GMAIL_TOKEN_REFRESH_RETRIES,
    JWT_ALGORITHM,
    PASSWORD_RESET_FROM_EMAIL,
    logger,
)

def gmail_is_configured() -> bool:
    return all([
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        GMAIL_REFRESH_TOKEN,
        GMAIL_SENDER_EMAIL
    ])

def get_missing_gmail_env_vars() -> List[str]:
    missing = []
    if not GMAIL_CLIENT_ID:
        missing.append("GMAIL_CLIENT_ID")
    if not GMAIL_CLIENT_SECRET:
        missing.append("GMAIL_CLIENT_SECRET")
    if not GMAIL_REFRESH_TOKEN:
        missing.append("GMAIL_REFRESH_TOKEN")
    if not GMAIL_SENDER_EMAIL:
        missing.append("GMAIL_SENDER_EMAIL")
    return missing

def generate_email_otp_code(length: int = 6) -> str:
    return ''.join(secrets.choice('0123456789') for _ in range(length))

def hash_email_otp(email: str, purpose: str, otp_code: str) -> str:
    payload = f"{EMAIL_OTP_SECRET}:{purpose}:{email.lower().strip()}:{otp_code}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def mask_email_address(email: str) -> str:
    if '@' not in email:
        return email
    local, domain = email.split('@', 1)
    masked_local = local[:2] + ('*' * max(1, len(local) - 2)) if len(local) > 2 else local[0] + '*'
    domain_name, *domain_parts = domain.split('.')
    masked_domain = domain_name[:1] + ('*' * max(1, len(domain_name) - 1))
    return f"{masked_local}@{'.'.join([masked_domain] + domain_parts)}"

def create_email_verification_token(email: str, purpose: str = "signup") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=EMAIL_VERIFICATION_TOKEN_MINUTES)
    payload = {
        "sub": email.lower().strip(),
        "purpose": purpose,
        "type": "email_verification",
        "exp": expire
    }
    return jwt.encode(payload, EMAIL_OTP_SECRET, algorithm=JWT_ALGORITHM)

def verify_email_verification_token(token: str, email: str, purpose: str = "signup") -> dict:
    try:
        payload = jwt.decode(token, EMAIL_OTP_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "email_verification":
            raise HTTPException(status_code=401, detail="Jeton de vérification invalide")
        if payload.get("sub") != email.lower().strip():
            raise HTTPException(status_code=401, detail="Jeton de vérification non valide pour cet email")
        if payload.get("purpose") != purpose:
            raise HTTPException(status_code=401, detail="Jeton de vérification non valide pour cette opération")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="La vérification email a expiré. Veuillez demander un nouveau code.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton de vérification email invalide")

def invalidate_gmail_access_token_cache():
    GMAIL_ACCESS_TOKEN_CACHE["access_token"] = ""
    GMAIL_ACCESS_TOKEN_CACHE["expires_at"] = 0.0

def get_gmail_access_token(force_refresh: bool = False) -> str:
    now_ts = time.time()
    cached_token = GMAIL_ACCESS_TOKEN_CACHE.get("access_token", "")
    cached_expires_at = float(GMAIL_ACCESS_TOKEN_CACHE.get("expires_at", 0.0) or 0.0)

    if cached_token and not force_refresh and now_ts < (cached_expires_at - GMAIL_ACCESS_TOKEN_SAFETY_SECONDS):
        return cached_token

    last_error = ""

    for attempt in range(1, GMAIL_TOKEN_REFRESH_RETRIES + 1):
        try:
            token_response = requests.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": GMAIL_CLIENT_ID,
                    "client_secret": GMAIL_CLIENT_SECRET,
                    "refresh_token": GMAIL_REFRESH_TOKEN,
                    "grant_type": "refresh_token"
                },
                timeout=15
            )

            if token_response.ok:
                token_payload = token_response.json()
                access_token = token_payload.get("access_token")
                expires_in = int(token_payload.get("expires_in") or 3600)
                if access_token:
                    GMAIL_ACCESS_TOKEN_CACHE["access_token"] = access_token
                    GMAIL_ACCESS_TOKEN_CACHE["expires_at"] = time.time() + max(300, expires_in)
                    return access_token
                last_error = "Réponse OAuth Gmail invalide: access_token manquant"
            else:
                last_error = token_response.text or f"HTTP {token_response.status_code}"
        except requests.RequestException as exc:
            last_error = str(exc)

        if attempt < GMAIL_TOKEN_REFRESH_RETRIES:
            sleep_seconds = GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS * attempt
            logger.warning(
                "⚠️ Gmail token refresh attempt %s/%s failed, retrying in %.1fs",
                attempt,
                GMAIL_TOKEN_REFRESH_RETRIES,
                sleep_seconds
            )
            time.sleep(sleep_seconds)

    invalidate_gmail_access_token_cache()
    logger.error("❌ Gmail token refresh failed after %s attempts: %s", GMAIL_TOKEN_REFRESH_RETRIES, last_error)
    raise HTTPException(status_code=502, detail="Impossible d'obtenir un accès Gmail après plusieurs tentatives. Vérifiez la configuration OAuth Google sur Render.")

def brevo_is_configured() -> bool:
    return all([
        BREVO_API_KEY,
        BREVO_SENDER_EMAIL,
    ])

def get_missing_brevo_env_vars() -> List[str]:
    missing = []
    if not BREVO_API_KEY:
        missing.append('BREVO_API_KEY')
    if not BREVO_SENDER_EMAIL:
        missing.append('BREVO_SENDER_EMAIL')
    return missing

def send_email_via_brevo_api(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    if not brevo_is_configured():
        missing = ', '.join(get_missing_brevo_env_vars())
        raise HTTPException(status_code=503, detail=f"Configuration Brevo incomplète: {missing}")

    sender_email = PASSWORD_RESET_FROM_EMAIL or BREVO_SENDER_EMAIL
    payload = {
        'sender': {
            'email': sender_email,
            'name': BREVO_SENDER_NAME,
        },
        'to': [
            {
                'email': to_email,
            }
        ],
        'subject': subject,
        'htmlContent': html_body or f'<pre>{text_body}</pre>',
        'textContent': text_body,
    }

    try:
        brevo_response = requests.post(
            BREVO_API_URL,
            headers={
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': BREVO_API_KEY,
            },
            json=payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.error('❌ Brevo send transport error: %s', exc)
        raise HTTPException(status_code=502, detail='Transport Brevo indisponible. Réessayez dans un instant.')

    if not brevo_response.ok:
        logger.error('❌ Brevo send failed: %s', brevo_response.text)
        raise HTTPException(status_code=502, detail="Échec d'envoi Brevo. Vérifiez BREVO_API_KEY et l'expéditeur sur Render.")

    return brevo_response.json()

def send_email_via_gmail_api(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    if not gmail_is_configured():
        missing = ', '.join(get_missing_gmail_env_vars())
        raise HTTPException(status_code=503, detail=f"Configuration Gmail incomplète: {missing}")

    if html_body:
        message = MIMEMultipart('alternative')
        message.attach(MIMEText(text_body, 'plain', 'utf-8'))
        message.attach(MIMEText(html_body, 'html', 'utf-8'))
    else:
        message = MIMEText(text_body, 'plain', 'utf-8')

    message['to'] = to_email
    message['from'] = formataddr((GMAIL_SENDER_NAME, GMAIL_SENDER_EMAIL))
    message['subject'] = subject

    raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

    def perform_send(access_token: str):
        return requests.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json={"raw": raw_message},
            timeout=20
        )

    try:
        gmail_response = perform_send(get_gmail_access_token())
    except requests.RequestException as exc:
        logger.error("❌ Gmail send transport error: %s", exc)
        raise HTTPException(status_code=502, detail="Transport Gmail indisponible. Réessayez dans un instant.")

    if gmail_response.status_code in (401, 403):
        logger.warning("⚠️ Gmail send rejected cached token, forcing refresh")
        invalidate_gmail_access_token_cache()
        try:
            gmail_response = perform_send(get_gmail_access_token(force_refresh=True))
        except requests.RequestException as exc:
            logger.error("❌ Gmail retry transport error: %s", exc)
            raise HTTPException(status_code=502, detail="Transport Gmail indisponible. Réessayez dans un instant.")

    if not gmail_response.ok:
        logger.error(f"❌ Gmail send failed: {gmail_response.text}")
        raise HTTPException(status_code=502, detail="Échec d'envoi Gmail. Vérifiez le compte expéditeur, les scopes OAuth et le refresh token sur Render.")

    return gmail_response.json()

def build_email_otp_email(purpose: str, otp_code: str) -> dict:
    if purpose == "password_reset":
        subject = "Réinitialisation du mot de passe KOJO"
        text_body = (
            f"Bonjour,\n\n"
            f"Voici votre code KOJO pour réinitialiser votre mot de passe : {otp_code}\n\n"
            f"Ce code expire dans {EMAIL_OTP_EXPIRY_MINUTES} minutes.\n"
            f"Ne partagez jamais ce code avec qui que ce soit.\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\n"
            f"Équipe KOJO"
        )
        html_body = f"""
        <div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#eff6ff;border:1px solid #93c5fd;border-radius:16px;\">
          <div style=\"text-align:center;margin-bottom:24px;\">
            <div style=\"display:inline-block;background:#2563eb;color:#ffffff;border-radius:999px;padding:14px 18px;font-weight:700;font-size:20px;\">KOJO</div>
          </div>
          <h2 style=\"color:#1d4ed8;margin-bottom:8px;\">Réinitialisation de votre mot de passe</h2>
          <p style=\"color:#1e3a8a;font-size:15px;line-height:1.6;\">Utilisez ce code pour définir un nouveau mot de passe KOJO.</p>
          <div style=\"margin:24px 0;padding:20px;background:#ffffff;border:1px dashed #60a5fa;border-radius:12px;text-align:center;\">
            <div style=\"font-size:34px;letter-spacing:8px;font-weight:700;color:#2563eb;\">{otp_code}</div>
          </div>
          <p style=\"color:#1e3a8a;font-size:14px;line-height:1.6;\">Ce code expire dans <strong>{EMAIL_OTP_EXPIRY_MINUTES} minutes</strong>.</p>
          <p style=\"color:#1e3a8a;font-size:14px;line-height:1.6;\">Ne partagez jamais ce code. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <p style=\"color:#1d4ed8;font-size:13px;margin-top:24px;\">Équipe KOJO</p>
        </div>
        """
    else:
        subject = "Votre code de vérification KOJO"
        text_body = (
            f"Bonjour,\n\n"
            f"Voici votre code de vérification KOJO : {otp_code}\n\n"
            f"Ce code expire dans {EMAIL_OTP_EXPIRY_MINUTES} minutes.\n"
            f"Ne partagez jamais ce code avec qui que ce soit.\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\n"
            f"Équipe KOJO"
        )
        html_body = f"""
        <div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff7ed;border:1px solid #fdba74;border-radius:16px;\">
          <div style=\"text-align:center;margin-bottom:24px;\">
            <div style=\"display:inline-block;background:#ea580c;color:#ffffff;border-radius:999px;padding:14px 18px;font-weight:700;font-size:20px;\">KOJO</div>
          </div>
          <h2 style=\"color:#9a3412;margin-bottom:8px;\">Vérification de votre email</h2>
          <p style=\"color:#7c2d12;font-size:15px;line-height:1.6;\">Voici votre code de vérification KOJO.</p>
          <div style=\"margin:24px 0;padding:20px;background:#ffffff;border:1px dashed #fb923c;border-radius:12px;text-align:center;\">
            <div style=\"font-size:34px;letter-spacing:8px;font-weight:700;color:#ea580c;\">{otp_code}</div>
          </div>
          <p style=\"color:#7c2d12;font-size:14px;line-height:1.6;\">Ce code expire dans <strong>{EMAIL_OTP_EXPIRY_MINUTES} minutes</strong>.</p>
          <p style=\"color:#7c2d12;font-size:14px;line-height:1.6;\">Ne partagez jamais ce code. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <p style=\"color:#9a3412;font-size:13px;margin-top:24px;\">Équipe KOJO</p>
        </div>
        """

    return {
        "subject": subject,
        "text_body": text_body,
        "html_body": html_body
    }

async def issue_email_otp(email: str, purpose: str = "signup") -> dict:
    now = datetime.now(timezone.utc)
    existing_otp = await db.email_otps.find_one({"email": email, "purpose": purpose})

    if existing_otp and existing_otp.get("last_sent_at"):
        last_sent_at = existing_otp["last_sent_at"]
        if last_sent_at.tzinfo is None:
            last_sent_at = last_sent_at.replace(tzinfo=timezone.utc)

        elapsed = (now - last_sent_at).total_seconds()
        if elapsed < EMAIL_OTP_RESEND_COOLDOWN_SECONDS:
            remaining = max(1, int(EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsed + 0.999))
            raise HTTPException(
                status_code=429,
                detail=f"Veuillez patienter {remaining}s avant de renvoyer un autre code.",
                headers={"Retry-After": str(remaining)}
            )

    otp_code = generate_email_otp_code()
    otp_hash = hash_email_otp(email, purpose, otp_code)
    expires_at = now + timedelta(minutes=EMAIL_OTP_EXPIRY_MINUTES)
    email_content = build_email_otp_email(purpose, otp_code)
    if EMAIL_PROVIDER == "none":
        # Mode "none" : on génère et stocke le code OTP sans l'envoyer par
        # email (utile en test/local, et conforme à la valeur "none"
        # documentée dans .env.example). Le code reste vérifiable via
        # /auth/email/verify-otp.
        logger.info("ℹ️ EMAIL_PROVIDER=none: envoi d'email OTP désactivé (email=%s, purpose=%s)", email, purpose)
    elif EMAIL_PROVIDER == "gmail":
        send_email_via_gmail_api(email, email_content["subject"], email_content["text_body"], email_content["html_body"])
    else:
        send_email_via_brevo_api(email, email_content["subject"], email_content["text_body"], email_content["html_body"])

    await db.email_otps.update_one(
        {"email": email, "purpose": purpose},
        {
            "$set": {
                "otp_hash": otp_hash,
                "attempt_count": 0,
                "verified_at": None,
                "last_sent_at": now,
                "expires_at": expires_at,
                "updated_at": now,
                "status": "pending"
            },
            "$setOnInsert": {
                "created_at": now
            },
            "$inc": {
                "send_count": 1
            }
        },
        upsert=True
    )

    return {
        "message": "Code de vérification envoyé par email.",
        "masked_email": mask_email_address(email),
        "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
        "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    }
