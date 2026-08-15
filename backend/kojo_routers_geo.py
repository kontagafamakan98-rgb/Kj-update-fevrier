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

WEST_AFRICA_COUNTRIES = {
    "senegal": {
        "code": "senegal",
        "name": "Sénégal",
        "nameFrench": "Sénégal",
        "nameEnglish": "Senegal",
        "flag": "🇸🇳",
        "phonePrefix": "+221",
        "phonePrefixes": ["+221"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Dakar",
        "languages": ["fr", "wo"],
        "primaryLanguage": "fr",
        "localLanguage": "wo",
        "timezone": "Africa/Dakar",
        "coordinates": {"lat": 14.6928, "lng": -17.4467}
    },
    "mali": {
        "code": "mali",
        "name": "Mali",
        "nameFrench": "Mali",
        "nameEnglish": "Mali",
        "flag": "🇲🇱",
        "phonePrefix": "+223",
        "phonePrefixes": ["+223"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Bamako",
        "languages": ["fr", "bm"],
        "primaryLanguage": "fr",
        "localLanguage": "bm",
        "timezone": "Africa/Bamako",
        "coordinates": {"lat": 12.6392, "lng": -8.0029}
    },
    "burkina_faso": {
        "code": "burkina_faso",
        "name": "Burkina Faso",
        "nameFrench": "Burkina Faso",
        "nameEnglish": "Burkina Faso",
        "flag": "🇧🇫",
        "phonePrefix": "+226",
        "phonePrefixes": ["+226"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Ouagadougou",
        "languages": ["fr", "mos"],
        "primaryLanguage": "fr",
        "localLanguage": "mos",
        "timezone": "Africa/Ouagadougou",
        "coordinates": {"lat": 12.3714, "lng": -1.5197}
    },
    "cote_divoire": {
        "code": "cote_divoire",
        "name": "Côte d'Ivoire",
        "nameFrench": "Côte d'Ivoire",
        "nameEnglish": "Ivory Coast",
        "flag": "🇨🇮",
        "phonePrefix": "+225",
        "phonePrefixes": ["+225"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Abidjan",
        "languages": ["fr", "en"],
        "primaryLanguage": "fr",
        "localLanguage": "fr",
        "timezone": "Africa/Abidjan",
        "coordinates": {"lat": 5.3600, "lng": -4.0083}
    }
}

IP_COUNTRY_HINTS = {
    # Sénégal ISPs
    "41.82.": "senegal", "41.83.": "senegal", "196.1.": "senegal", "196.206.": "senegal",
    # Mali ISPs
    "41.73.": "mali", "217.64.": "mali", "196.200.": "mali",
    # Burkina Faso ISPs
    "41.78.": "burkina_faso", "196.28.": "burkina_faso", "41.203.": "burkina_faso",
    # Côte d'Ivoire ISPs
    "41.66.": "cote_divoire", "196.180.": "cote_divoire", "41.207.": "cote_divoire"
}

def detect_country_from_ip(ip_address: str) -> Optional[str]:
    """Détecter le pays à partir de l'adresse IP"""
    if not ip_address or ip_address in ["127.0.0.1", "localhost", "::1"]:
        return None
    
    # Vérifier les préfixes IP connus
    for prefix, country in IP_COUNTRY_HINTS.items():
        if ip_address.startswith(prefix):
            return country
    
    return None

def detect_country_from_phone(phone: str) -> Optional[str]:
    """Détecter le pays à partir du numéro de téléphone"""
    if not phone:
        return None
    
    phone = phone.strip().replace(" ", "")
    
    phone_to_country = {
        "+221": "senegal",
        "+223": "mali",
        "+226": "burkina_faso",
        "+225": "cote_divoire"
    }
    
    for prefix, country in phone_to_country.items():
        if phone.startswith(prefix):
            return country
    
    return None

@router.get("/geolocation/available-countries")
async def get_available_countries():
    return {
        "countries": [
            {"id": "mali", "name": "Mali", "flag": "🇲🇱", "languages": ["fr", "en", "bm"]},
            {"id": "senegal", "name": "Sénégal", "flag": "🇸🇳", "languages": ["fr", "en", "wo"]},
            {"id": "cote_divoire", "name": "Côte d'Ivoire", "flag": "🇨🇮", "languages": ["fr", "en"]},
            {"id": "burkina_faso", "name": "Burkina Faso", "flag": "🇧🇫", "languages": ["fr", "en", "mos"]}
        ]
    }

@router.get("/geolocation/detect")
async def detect_geolocation(request: Request, phone: Optional[str] = None):
    """
    Détecter automatiquement le pays de l'utilisateur.
    
    Méthodes de détection (par ordre de priorité):
    1. Numéro de téléphone (si fourni)
    2. Adresse IP
    3. Défaut: Sénégal (hub principal)
    
    Returns:
        - detected: bool - Si la détection a réussi
        - method: str - Méthode utilisée (phone, ip, default)
        - country: dict - Informations complètes du pays
        - supported_countries: list - Liste des pays supportés
    """
    detected_country = None
    detection_method = "default"
    
    # 1. Détection via numéro de téléphone
    if phone:
        detected_country = detect_country_from_phone(phone)
        if detected_country:
            detection_method = "phone"
    
    # 2. Détection via IP
    if not detected_country:
        # Obtenir l'IP du client
        client_ip = request.client.host if request.client else None
        
        # Vérifier les headers de proxy
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            client_ip = real_ip
        
        if client_ip:
            detected_country = detect_country_from_ip(client_ip)
            if detected_country:
                detection_method = "ip"
    
    # 3. Défaut: Sénégal
    if not detected_country:
        detected_country = "senegal"
        detection_method = "default"
    
    country_info = WEST_AFRICA_COUNTRIES.get(detected_country, WEST_AFRICA_COUNTRIES["senegal"])
    
    return {
        "detected": detection_method != "default",
        "method": detection_method,
        "country": country_info,
        "supported_countries": list(WEST_AFRICA_COUNTRIES.values()),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@router.get("/geolocation/countries")
async def get_supported_countries():
    """
    Obtenir la liste des pays supportés par Kojo.
    
    Returns:
        - countries: list - Liste complète des pays avec leurs informations
        - total: int - Nombre total de pays
    """
    return {
        "countries": list(WEST_AFRICA_COUNTRIES.values()),
        "total": len(WEST_AFRICA_COUNTRIES),
        "default_country": "senegal"
    }

class PhoneValidationRequest(BaseModel):
    phone: str = Field(..., description="Numéro de téléphone à valider")
    country: Optional[str] = Field(None, description="Code du pays à vérifier (optionnel)")

@router.post("/geolocation/validate-phone")
async def validate_phone_for_country(request: PhoneValidationRequest):
    """
    Valider un numéro de téléphone et détecter/vérifier le pays.
    
    Args:
        phone: Numéro de téléphone à valider
        country: Code du pays à vérifier (optionnel)
    
    Returns:
        - valid: bool - Si le numéro est valide
        - detected_country: str - Pays détecté
        - matches_country: bool - Si le numéro correspond au pays spécifié
        - formatted: str - Numéro formaté
    """
    phone = request.phone
    country = request.country
    
    if not phone:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis")
    
    phone = phone.strip().replace(" ", "").replace("-", "")
    detected = detect_country_from_phone(phone)
    
    # Validation du format
    is_valid = False
    if detected:
        # Vérifier la longueur (préfixe + 8-10 chiffres selon le pays)
        country_info = WEST_AFRICA_COUNTRIES.get(detected)
        if country_info:
            prefix = country_info["phonePrefix"]
            local_number = phone[len(prefix):]
            # Côte d'Ivoire a 10 chiffres, autres pays 8-9
            if detected == "cote_divoire":
                is_valid = len(local_number) >= 8 and len(local_number) <= 10 and local_number.isdigit()
            else:
                is_valid = len(local_number) >= 8 and len(local_number) <= 9 and local_number.isdigit()
    
    matches = True
    if country and detected:
        matches = detected == country
    
    return {
        "valid": is_valid,
        "phone": phone,
        "detected_country": detected,
        "country_info": WEST_AFRICA_COUNTRIES.get(detected) if detected else None,
        "matches_country": matches,
        "formatted": phone if is_valid else None
    }
