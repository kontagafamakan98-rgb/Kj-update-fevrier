import base64
import io
import jwt
import uuid
from urllib.parse import urlparse
from datetime import datetime, timezone
from typing import Optional

import requests
from cloudinary import uploader as cloudinary_uploader
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, ValidationError

from kojo_core import db
from kojo_models import (
    Country, EmailOtpRequest, EmailOtpResendRequest,
    EmailOtpVerifyRequest, Language, PasswordResetConfirmRequest, User,
    UserLogin, UserType, UserWithPayment, WorkerProfile,
)
from kojo_settings import (
    EMAIL_OTP_EXPIRY_MINUTES,
    EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    GOOGLE_AUTH_ENABLED,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_TOKENINFO_URL,
    JWT_ALGORITHM,
    JWT_SECRET,
    OWNER_EMAIL,
    logger,
)
from kojo_core import (
    clear_auth_cookies, create_access_token, get_current_user, hash_password,
    is_token_revoked, is_valid_image_content, log_and_raise_http_exception,
    revoke_token, sanitize_email, security, set_auth_cookies,
    validate_payment_accounts, verify_password,
)
from kojo_email import (
    create_email_verification_token, hash_email_otp, issue_email_otp,
    verify_email_verification_token, mask_email_address,
)

router = APIRouter()


class GoogleAuthRequest(BaseModel):
    """Payload du POST /auth/google : le code d'autorisation Google obtenu par
    le frontend (flux serveur avec PKCE) + le profil choisi par l'utilisateur.

    user_type/country/preferred_language/legal_documents_accepted sont fournis
    par le frontend (l'utilisateur les choisit) UNIQUEMENT pour la CRÉATION ;
    ils sont ignorés si le compte existe déjà."""
    code: str = Field(min_length=20, max_length=4096)
    user_type: Optional[UserType] = None
    country: Optional[Country] = None
    preferred_language: Optional[Language] = None
    legal_documents_accepted: bool = False


class GoogleLinkRequest(BaseModel):
    """Liaison d'un compte Google à un compte mot-de-passe existant (fusion).
    L'utilisateur doit être connecté (Bearer) et fournir son mot de passe pour
    prouver qu'il est bien le propriétaire du compte email."""
    code: str = Field(min_length=20, max_length=4096)
    password: str = Field(max_length=128)


async def _exchange_google_code(code: str, origin: Optional[str] = None) -> dict:
    """Échange le code d'autorisation Google contre un id_token (flux serveur).
    Lève HTTPException(401) si l'échange échoue ou si l'id_token est invalide.

    redirect_uri à l'échange : en mode POPUP (Google Identity Services,
    initCodeClient), Google utilise l'ORIGINE de la page appelante comme
    redirect_uri du code — pas une URL de callback. On reprend donc l'origine
    de la requête (header Origin, la même origine que le frontend via le proxy
    Vercel), avec repli sur GOOGLE_REDIRECT_URI si l'origine est absente ou
    invalide (clients non navigateur). Un redirect_uri non déclaré dans la
    console Google ferait échouer l'échange (redirect_uri_mismatch)."""
    if not GOOGLE_AUTH_ENABLED:
        raise HTTPException(status_code=503, detail="La connexion Google n'est pas configurée sur le serveur")

    # L'origine doit être une origine nue http(s) (sans chemin ni query).
    redirect_uri = GOOGLE_REDIRECT_URI
    if origin:
        try:
            parsed = urlparse(origin)
            if parsed.scheme in ("http", "https") and parsed.netloc and not parsed.path and not parsed.query:
                redirect_uri = origin
        except ValueError:
            pass

    token_url = "https://oauth2.googleapis.com/token"
    try:
        resp = requests.post(token_url, data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }, timeout=15)
        resp.raise_for_status()
        token_data = resp.json()
    except requests.RequestException as exc:
        logger.error(f"Google token exchange error: {exc}")
        raise HTTPException(status_code=401, detail="Échec de l'authentification Google")

    id_token = token_data.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Réponse Google invalide")

    # Vérification de l'id_token via l'endpoint tokeninfo de Google (vérifie
    # la signature ET l'audience). On n'utilise pas le payload du client.
    try:
        verify_resp = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": id_token},
            timeout=15,
        )
        verify_resp.raise_for_status()
        claims = verify_resp.json()
    except requests.RequestException as exc:
        logger.error(f"Google id_token verification error: {exc}")
        raise HTTPException(status_code=401, detail="Jeton Google invalide")

    # Vérification stricte de l'audience : le jeton doit être émis POUR notre
    # client_id (sinon un jeton valide pour une AUTRE app serait accepté).
    aud = claims.get("aud") or claims.get("azp")
    if aud != GOOGLE_CLIENT_ID:
        logger.error(f"Google id_token audience mismatch: {aud}")
        raise HTTPException(status_code=401, detail="Jeton Google invalide")

    sub = claims.get("sub")
    email = claims.get("email")
    email_verified = bool(claims.get("email_verified"))
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Jeton Google invalide")
    if not email_verified:
        raise HTTPException(status_code=401, detail="Email non vérifié par Google")

    return {
        "sub": sub,
        "email": email,
        "email_verified": email_verified,
        "given_name": claims.get("given_name") or "",
        "family_name": claims.get("family_name") or "",
        "name": claims.get("name") or "",
        "picture": claims.get("picture") or "",
        "locale": claims.get("locale") or "",
    }

@router.post("/auth/email/check-availability")
async def check_signup_email_availability(payload: EmailOtpRequest):
    """Anti-énumération STRICT : réponse identique que l'email soit libre ou
    déjà inscrit (available=None, message neutre) — on ne fait plus aucune
    lecture en base ici. L'existence réelle d'un compte n'est révélée qu'au
    moment où l'utilisateur finalise son inscription (register-verified, qui
    renvoie « Cette adresse email est déjà utilisée »), ce qui ne permet pas
    d'énumérer les emails par simple scan.
    """
    clean_email = sanitize_email(payload.email)
    return {
        "email": clean_email,
        "available": None,
        "message": "Vérification effectuée.",
    }

def _generic_otp_response(clean_email: str) -> dict:
    """Réponse identique qu'un email soit libre ou déjà inscrit (anti-énumération)."""
    return {
        "message": "Si cette adresse est disponible, un code de vérification a été envoyé.",
        "masked_email": mask_email_address(clean_email),
        "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
        "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    }

@router.post("/auth/email/send-otp")
async def send_signup_email_otp(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)

    existing_user = await db.users.find_one({"email": clean_email})
    if existing_user:
        # Réponse générique sans envoi d'email : on ne révèle pas qu'un compte
        # existe déjà, et on n'envoie pas d'OTP à une adresse déjà inscrite.
        return _generic_otp_response(clean_email)

    return await issue_email_otp(clean_email, payload.purpose)

@router.post("/auth/email/resend-otp")
async def resend_signup_email_otp(payload: EmailOtpResendRequest):
    clean_email = sanitize_email(payload.email)

    existing_user = await db.users.find_one({"email": clean_email})
    if existing_user:
        return _generic_otp_response(clean_email)

    return await issue_email_otp(clean_email, payload.purpose)

@router.post("/auth/email/verify-otp")
async def verify_signup_email_otp(payload: EmailOtpVerifyRequest):
    clean_email = sanitize_email(payload.email)
    now = datetime.now(timezone.utc)

    otp_record = await db.email_otps.find_one({"email": clean_email, "purpose": payload.purpose})
    if not otp_record:
        raise HTTPException(status_code=404, detail="Aucun code OTP actif pour cet email. Demandez un nouveau code.")

    expires_at = otp_record.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if not expires_at or expires_at <= now:
        await db.email_otps.delete_one({"email": clean_email, "purpose": payload.purpose})
        raise HTTPException(status_code=400, detail="Le code a expiré. Demandez un nouveau code.")

    if otp_record.get("attempt_count", 0) >= EMAIL_OTP_MAX_ATTEMPTS:
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": payload.purpose},
            {
                "$set": {
                    "status": "locked",
                    "updated_at": now
                }
            }
        )
        raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")

    candidate_hash = hash_email_otp(clean_email, payload.purpose, payload.otp)
    if candidate_hash != otp_record.get("otp_hash"):
        new_attempt_count = otp_record.get("attempt_count", 0) + 1
        new_status = "locked" if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS else "pending"
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": payload.purpose},
            {
                "$set": {
                    "attempt_count": new_attempt_count,
                    "updated_at": now,
                    "last_attempt_at": now,
                    "status": new_status
                }
            }
        )
        if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")
        remaining = max(0, EMAIL_OTP_MAX_ATTEMPTS - new_attempt_count)
        raise HTTPException(status_code=400, detail=f"Code invalide. Tentatives restantes: {remaining}.")

    verification_token = create_email_verification_token(clean_email, payload.purpose)
    await db.email_otps.update_one(
        {"email": clean_email, "purpose": payload.purpose},
        {
            "$set": {
                "verified_at": now,
                "updated_at": now,
                "status": "verified"
            }
        }
    )

    return {
        "message": "Email vérifié avec succès.",
        "verification_token": verification_token,
        "masked_email": mask_email_address(clean_email),
        "verified": True
    }

@router.post("/auth/password/forgot/request")
async def request_password_reset_otp(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    if not existing_user:
        return {
            "message": "Si cette adresse email existe, un code de réinitialisation a été envoyé.",
            "masked_email": mask_email_address(clean_email),
            "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
            "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        }

    otp_result = await issue_email_otp(clean_email, "password_reset")
    otp_result["message"] = "Si cette adresse email existe, un code de réinitialisation a été envoyé."
    return otp_result

@router.post("/auth/password/forgot/resend")
async def resend_password_reset_otp(payload: EmailOtpResendRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    if not existing_user:
        return {
            "message": "Si cette adresse email existe, un code de réinitialisation a été envoyé.",
            "masked_email": mask_email_address(clean_email),
            "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
            "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        }

    otp_result = await issue_email_otp(clean_email, "password_reset")
    otp_result["message"] = "Si cette adresse email existe, un code de réinitialisation a été envoyé."
    return otp_result

@router.post("/auth/password/forgot/verify")
async def verify_password_reset_otp(payload: EmailOtpVerifyRequest):
    clean_email = sanitize_email(payload.email)
    now = datetime.now(timezone.utc)

    otp_record = await db.email_otps.find_one({"email": clean_email, "purpose": "password_reset"})
    if not otp_record:
        raise HTTPException(status_code=404, detail="Aucun code actif pour cette adresse email. Demandez un nouveau code.")

    expires_at = otp_record.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if not expires_at or expires_at <= now:
        await db.email_otps.delete_one({"email": clean_email, "purpose": "password_reset"})
        raise HTTPException(status_code=400, detail="Le code a expiré. Demandez un nouveau code.")

    if otp_record.get("attempt_count", 0) >= EMAIL_OTP_MAX_ATTEMPTS:
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": "password_reset"},
            {"$set": {"status": "locked", "updated_at": now}}
        )
        raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")

    candidate_hash = hash_email_otp(clean_email, "password_reset", payload.otp)
    if candidate_hash != otp_record.get("otp_hash"):
        new_attempt_count = otp_record.get("attempt_count", 0) + 1
        new_status = "locked" if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS else "pending"
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": "password_reset"},
            {
                "$set": {
                    "attempt_count": new_attempt_count,
                    "updated_at": now,
                    "last_attempt_at": now,
                    "status": new_status
                }
            }
        )
        if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")
        remaining = max(0, EMAIL_OTP_MAX_ATTEMPTS - new_attempt_count)
        raise HTTPException(status_code=400, detail=f"Code invalide. Tentatives restantes: {remaining}.")

    verification_token = create_email_verification_token(clean_email, "password_reset")
    await db.email_otps.update_one(
        {"email": clean_email, "purpose": "password_reset"},
        {
            "$set": {
                "verified_at": now,
                "updated_at": now,
                "status": "verified"
            }
        }
    )

    return {
        "message": "Code vérifié avec succès.",
        "verification_token": verification_token,
        "masked_email": mask_email_address(clean_email),
        "verified": True
    }

@router.post("/auth/password/reset")
async def reset_password_with_verified_token(payload: PasswordResetConfirmRequest):
    clean_email = sanitize_email(payload.email)
    verification_payload = verify_email_verification_token(
        payload.verification_token, clean_email, purpose="password_reset"
    )

    # Anti-replay : un jeton déjà utilisé ne peut pas réinitialiser à nouveau
    # (le jeton est stateless et resterait sinon valide 30 min après usage).
    _jti = verification_payload.get("jti")
    _exp_ts = verification_payload.get("exp")
    if _jti and await is_token_revoked(_jti):
        raise HTTPException(
            status_code=401,
            detail="Ce jeton de vérification a déjà été utilisé. Demandez un nouveau code."
        )

    user = await db.users.find_one({"email": clean_email})
    if not user:
        raise HTTPException(status_code=404, detail="Adresse email introuvable.")

    now = datetime.now(timezone.utc)
    # password_version incrémentée : TOUS les jetons émis avant ce reset sont
    # désormais invalides (get_current_user compare pwdv du jeton à cette
    # valeur) — un jeton volé ne survit pas à la réinitialisation.
    await db.users.update_one(
        {"email": clean_email},
        {
            "$set": {
                "password_hash": hash_password(payload.new_password),
                "password_version": (user.get("password_version") or 0) + 1,
                "updated_at": now
            }
        }
    )
    await db.email_otps.delete_one({"email": clean_email, "purpose": "password_reset"})

    # Révoquer le jeton après usage (usage unique).
    if _jti and _exp_ts:
        try:
            await revoke_token(_jti, datetime.fromtimestamp(_exp_ts, tz=timezone.utc))
        except Exception as exc:
            logger.warning(f"⚠️ Révocation du jeton de reset impossible: {exc}")

    return {
        "message": "Mot de passe réinitialisé avec succès.",
        "email": clean_email,
        "password_reset": True
    }

@router.post("/auth/register-verified")
async def register_user_verified(user_data: UserWithPayment, response: Response):
    """Inscription avec vérification OBLIGATOIRE de l'email (OTP) et
    validation obligatoire des comptes de paiement.

    SECURITE : depuis que /auth/register (sans vérification) a été retiré,
    CETTE route est le seul chemin d'inscription. Le jeton de vérification
    email est requis — un client qui s'inscrirait sans l'avoir obtenu via
    le flux OTP (/auth/email/send-otp → verify-otp) est rejeté avec un 400.
    """
    
    try:
        # Sanitize email input to prevent injection
        clean_email = sanitize_email(user_data.email)
        email_verified = False
        email_verified_at = None

        if not user_data.email_verification_token:
            log_and_raise_http_exception(
                400,
                "La vérification de l'adresse email est obligatoire pour créer un compte. "
                "Veuillez vérifier votre email avec le code qui vous a été envoyé."
            )

        if user_data.email_verification_token:
            verification_payload = verify_email_verification_token(
                user_data.email_verification_token, clean_email, "signup"
            )
            email_verified = True
            email_verified_at = datetime.now(timezone.utc)
        
        # Check if email already exists
        existing_user = await db.users.find_one({"email": clean_email})
        if existing_user:
            log_and_raise_http_exception(400, "Cette adresse email est déjà utilisée")
        
        # Valider les comptes de paiement selon le type d'utilisateur (le pays
        # permet de refuser Wave là où le canal n'est pas opéré).
        try:
            payment_validation = validate_payment_accounts(
                user_data.payment_accounts, user_data.user_type, user_data.country
            )
        except HTTPException as e:
            raise e
        
                # Gérer la photo de profil si fournie
        profile_photo_path = None
        user_id = str(uuid.uuid4())  # Generate user ID first

        if user_data.profile_photo_base64:
            try:
                image_data = base64.b64decode(
                    user_data.profile_photo_base64.split(',')[1]
                    if ',' in user_data.profile_photo_base64
                    else user_data.profile_photo_base64
                )

                # Même limite que l'endpoint d'upload dédié (5 Mo) : sans ça,
                # un payload base64 arbitrairement gros coûtait un décodage +
                # un upload Cloudinary (DoS / coût).
                if len(image_data) > 5 * 1024 * 1024:
                    raise HTTPException(
                        status_code=400,
                        detail="Photo trop volumineuse. Taille maximale : 5 Mo"
                    )

                # Vérification des magic bytes (le client peut envoyer
                # n'importe quel contenu sous couvert d'une "photo").
                if not is_valid_image_content(image_data):
                    raise HTTPException(
                        status_code=400,
                        detail="Fichier image invalide (JPEG, PNG, GIF ou WebP requis)"
                    )

                upload_result = cloudinary_uploader.upload(
                    io.BytesIO(image_data),
                    folder="kojo/profile_photos",
                    public_id=f"register_{user_id}_{uuid.uuid4().hex}",
                    resource_type="image"
                )

                profile_photo_path = upload_result.get("secure_url") or upload_result.get("url")
                logger.info(f"✅ Photo de profil Cloudinary sauvegardée: {profile_photo_path}")

            except Exception as e:
                logger.warning(f"⚠️ Erreur sauvegarde photo profil Cloudinary: {e}")

        # Create user with payment verification - avec gestion d'erreur complète
        try:
            user = User(
                id=user_id,
                email=clean_email,
                password_hash=hash_password(user_data.password),
                first_name=user_data.first_name,
                last_name=user_data.last_name,
                phone=user_data.phone,
                user_type=user_data.user_type,
                country=user_data.country,
                preferred_language=user_data.preferred_language,
                legal_documents_accepted=user_data.legal_documents_accepted,
                legal_documents_accepted_at=user_data.legal_documents_accepted_at,
                legal_documents_version=user_data.legal_documents_version,
                profile_photo=profile_photo_path,  # Ajouter le chemin de la photo
                is_verified=payment_validation["is_verified"],
                email_verified=email_verified,
                email_verified_at=email_verified_at,
                payment_accounts=payment_validation["account_details"],
                payment_accounts_count=payment_validation["linked_accounts_count"],
                created_at=datetime.now(timezone.utc).isoformat(),
                updated_at=datetime.now(timezone.utc).isoformat()
            )
        except ValidationError as ve:
            # Gestion spécifique des erreurs de validation Pydantic
            validation_errors = []
            for error in ve.errors():
                field = error.get('loc', [''])[0] if error.get('loc') else 'unknown'
                message = error.get('msg', 'Erreur de validation')
                
                # Messages d'erreur en français
                if 'string_too_short' in error.get('type', ''):
                    if field == 'first_name':
                        message = "Le prénom doit contenir au moins 2 caractères"
                    elif field == 'last_name':
                        message = "Le nom de famille doit contenir au moins 2 caractères"
                    else:
                        message = f"Le champ {field} doit contenir au moins 2 caractères"
                elif 'string_pattern_mismatch' in error.get('type', ''):
                    if field in ['first_name', 'last_name']:
                        message = f"Le {field} contient des caractères non autorisés"
                    elif field == 'phone':
                        message = "Le numéro de téléphone n'est pas au bon format"
                    else:
                        message = f"Le format du champ {field} est incorrect"
                
                validation_errors.append(f"{message}")
            
            error_message = "; ".join(validation_errors)
            logger.warning(f"❌ Erreur validation utilisateur: {error_message}")
            log_and_raise_http_exception(422, f"Erreur de validation: {error_message}")
        
        except Exception as e:
            logger.error(f"❌ Erreur création utilisateur: {str(e)}")
            log_and_raise_http_exception(500, "Erreur lors de la création du compte utilisateur")
        
        await db.users.insert_one(user.model_dump())
        await db.email_otps.delete_one({"email": clean_email, "purpose": "signup"})

        # Parrainage : applique le code saisi à l'inscription (?ref=...).
        # Non bloquant : un code invalide est simplement ignoré, l'inscription
        # reste valide. Le booléen referral_applied est renvoyé au client pour
        # afficher une confirmation à l'inscription quand le code a bien été
        # appliqué.
        # RÈGLE PRODUIT : le parrainage est réservé aux TRAVAILLEURS (le
        # parrain comme l'invité). Aucun crédit n'est fait à l'inscription :
        # le parrain ET l'invité reçoivent leur récompense uniquement quand
        # l'invité termine sa PREMIÈRE mission (voir
        # _maybe_award_first_job_referral_reward dans kojo_routers_jobs.py).
        referral_applied = False
        ref_code = str((user_data.referral_code or '').strip()).upper()
        if ref_code and user_data.user_type == "worker":
            try:
                sponsor = await db.users.find_one(
                    {"referral_code": ref_code}, {"id": 1, "user_type": 1, "referred_by": 1}
                )
                if (
                    sponsor
                    and sponsor.get("id") != user_id
                    and sponsor.get("user_type") == "worker"
                    # Un travailleur déjà parrainé ne peut pas parrainer à son tour
                    and not sponsor.get("referred_by")
                ):
                    await db.users.update_one(
                        {"id": user_id},
                        {"$set": {"referred_by": ref_code, "updated_at": datetime.now(timezone.utc)}},
                    )
                    referral_applied = True
            except Exception as exc:
                logger.warning(f"⚠️ Application du code de parrainage impossible: {exc}")

        # Jeton de vérification à usage unique : révoqué après l'inscription
        # pour empêcher toute relecture (replay) dans sa fenêtre de validité.
        try:
            _jti = verification_payload.get("jti")
            _exp_ts = verification_payload.get("exp")
            if _jti and _exp_ts:
                await revoke_token(_jti, datetime.fromtimestamp(_exp_ts, tz=timezone.utc))
        except Exception as exc:
            logger.warning(f"⚠️ Révocation du jeton de vérification impossible: {exc}")
        
        # Créer le profil travailleur si c'est un travailleur avec des informations supplémentaires
        worker_profile_created = False
        if user_data.user_type == "worker" and (
            user_data.worker_specialties or 
            user_data.worker_experience_years is not None
        ):
            worker_profile = WorkerProfile(
                user_id=user.id,
                specialties=user_data.worker_specialties or [],
                experience_years=user_data.worker_experience_years or 0,

                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            
            await db.worker_profiles.insert_one(worker_profile.model_dump())
            worker_profile_created = True
            logger.info(f"✅ Profil travailleur créé pour {user.email}")
        
        # Create access token. pwdv=0 : nouveau compte, version de mot de
        # passe initiale (sera incrémentée à chaque changement de mot de passe
        # pour révoquer les sessions antérieures).
        access_token = create_access_token(data={"sub": user.id, "email": user.email, "pwdv": 0})
        
        # Session par cookie httpOnly (cf. /auth/login).
        set_auth_cookies(response, access_token)
        
        response_data = {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user.model_dump(exclude={"password_hash", "payment_accounts"}),
            "referral_applied": referral_applied,
            "referral_welcome_bonus": 0,
            "payment_verification": {
                "linked_accounts": payment_validation["linked_accounts_count"],
                "required_minimum": 2 if user_data.user_type == "worker" else 1,
                "is_verified": payment_validation["is_verified"],
                "message": f"Compte vérifié avec {payment_validation['linked_accounts_count']} moyen(s) de paiement lié(s)"
            }
        }
        
        # Ajouter les informations du profil travailleur si créé
        if worker_profile_created:
            response_data["worker_profile"] = {
                "specialties": user_data.worker_specialties or [],
                "experience_years": user_data.worker_experience_years or 0,

            }
        
        return response_data

    except HTTPException:
        # Re-raise HTTPException (comme les erreurs de validation 422)
        raise
    except Exception as e:
        # Gestion globale des erreurs non capturées
        logger.error(f"❌ Erreur inattendue lors de l'inscription: {str(e)}")
        log_and_raise_http_exception(500, "Une erreur inattendue s'est produite lors de l'inscription. Veuillez réessayer.")

@router.post("/auth/login")
async def login_user(credentials: UserLogin, response: Response):
    try:
        # Sanitize email input
        clean_email = sanitize_email(credentials.email)
        user = await db.users.find_one({"email": clean_email})
    except ValueError as e:
        # sanitize_email() lève ValueError pour des raisons lisibles par un
        # humain ("Email too long", "Invalid characters"...) sans détail
        # d'infra. On le logue quand même pour tracer les tentatives
        # suspectes, mais on renvoie un message générique au client.
        logger.warning(f"Tentative de login avec email invalide: {e}")
        raise HTTPException(status_code=400, detail="Adresse email invalide")
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={
        "sub": user["id"],
        "email": user["email"],
        "pwdv": user.get("password_version", 0),
    })
    
    # Session par cookie httpOnly : le token vit hors localStorage (protection
    # XSS). Le token reste renvoyé dans le corps pour le mobile/legacy.
    set_auth_cookies(response, access_token)
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": User(**user).model_dump(exclude={"password_hash", "payment_accounts"})
    }


@router.post("/auth/google")
async def google_auth(payload: GoogleAuthRequest, response: Response, request: Request):
    """Connexion / inscription via Google (SSO).

    Le frontend obtient un code d'autorisation Google (Google Identity
    Services, flux serveur avec PKCE) et l'envoie ici. Le backend échange le
    code contre un id_token, vérifie la signature + l'audience + l'email
    vérifié, puis :
    - si un compte est déjà lié à ce sub Google → connexion directe (session)
    - si un compte existe avec le même email (compte mot-de-passe) → on ne lie
      PAS automatiquement ici (risque de détournement) : on renvoie un statut
      "email_exists" pour que le frontend propose la fusion via /auth/google/link.
    - sinon → création du compte (sans OTP : l'email est vérifié par Google).

    Règle produit : l'utilisateur choisit user_type/country/language à la
    création. Les comptes de paiement sont vérifiés APRÈS (onboarding), pas ici.
    """
    claims = await _exchange_google_code(payload.code, origin=request.headers.get("origin"))
    email = claims["email"]
    sub = claims["sub"]

    # Défense en profondeur : un email non vérifié par Google ne peut jamais
    # créer de compte (la vérification principale vit dans _exchange_google_code,
    # mais on re-vérifie ici avant toute création).
    if not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Email non vérifié par Google")

    # 1. Compte déjà lié à ce sub Google → connexion directe
    existing = await db.users.find_one({"google_sub": sub})
    if existing:
        access_token = create_access_token(data={
            "sub": existing["id"],
            "email": existing["email"],
            "pwdv": existing.get("password_version", 0),
        })
        set_auth_cookies(response, access_token)
        return {
            "status": "success",
            "linked": True,
            "access_token": access_token,
            "token_type": "bearer",
            "user": User(**existing).model_dump(exclude={"password_hash", "payment_accounts"}),
        }

    # 2. Un compte existe avec le même email (mais pas lié à ce sub Google)
    #    → ne pas fusionner automatiquement : laisser le frontend proposer la
    #    fusion sécurisée (mot de passe requis).
    email_user = await db.users.find_one({"email": email})
    if email_user:
        return {
            "status": "email_exists",
            "message": "Un compte existe déjà avec cet email. Connectez-vous pour lier votre compte Google.",
        }

    # 3. Création du compte Google (sans OTP : email vérifié par Google)
    if not payload.legal_documents_accepted:
        raise HTTPException(status_code=400, detail="Vous devez accepter les conditions d'utilisation")

    user_type = payload.user_type or UserType.CLIENT
    country = payload.country or Country.SENEGAL
    preferred_language = payload.preferred_language or Language.FRENCH

    # Nom : priorité aux prénom/nom fournis par Google, sinon le nom complet.
    first_name = (claims.get("given_name") or "").strip()
    last_name = (claims.get("family_name") or "").strip()
    if (len(first_name) < 2 or len(last_name) < 2) and claims.get("name"):
        parts = claims["name"].strip().split()
        if len(parts) >= 2:
            first_name = first_name or parts[0]
            last_name = last_name or " ".join(parts[1:])
        elif parts:
            first_name = first_name or parts[0]
            last_name = last_name or ""
    # Filet de sécurité : le modèle exige min 2 caractères sur les noms
    if len(first_name) < 2:
        first_name = "Utilisateur"
    if len(last_name) < 2:
        last_name = "Kojo"

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "password_hash": None,
        "google_sub": sub,
        "first_name": first_name[:50],
        "last_name": last_name[:50],
        "phone": "",
        "user_type": user_type.value,
        "country": country.value,
        "preferred_language": preferred_language.value,
        "legal_documents_accepted": True,
        "legal_documents_accepted_at": now,
        "email_verified": True,
        "email_verified_at": now,
        "is_verified": False,
        "profile_photo": claims.get("picture") or None,
        "referral_reward_balance": 0.0,
        "referral_rewards": [],
        "payment_accounts": None,
        "payment_accounts_count": 0,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": now,
        "updated_at": now,
    }

    try:
        await db.users.insert_one(user_doc)
    except Exception as exc:
        logger.error(f"Google auth: création du compte impossible: {exc}")
        # Concurrence : un compte créé entre-temps avec le même email/sub
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email ou ce compte Google")

    access_token = create_access_token(data={"sub": user_id, "email": email, "pwdv": 0})
    set_auth_cookies(response, access_token)
    return {
        "status": "success",
        "linked": False,
        "created": True,
        "needs_onboarding": True,
        "access_token": access_token,
        "token_type": "bearer",            "user": User(**user_doc).model_dump(exclude={"password_hash", "payment_accounts"}),
    }


@router.post("/auth/google/link")
async def google_link(payload: GoogleLinkRequest, request: Request, current_user: User = Depends(get_current_user)):
    """Fusion : lie un compte Google au compte mot-de-passe connecté.

    L'utilisateur doit être connecté (Bearer) et fournir son mot de passe :
    on vérifie qu'il est bien le propriétaire du compte avant de lier le sub
    Google. Après liaison, il pourra se connecter via Google à l'avenir.
    """
    claims = await _exchange_google_code(payload.code, origin=request.headers.get("origin"))
    sub = claims["sub"]

    # Le sub Google ne doit pas déjà être lié à un AUTRE compte
    existing_sub = await db.users.find_one({"google_sub": sub})
    if existing_sub and existing_sub["id"] != current_user.id:
        raise HTTPException(status_code=409, detail="Ce compte Google est déjà lié à un autre compte Kojo")

    # Vérifier le mot de passe du compte courant (preuve de propriété)
    user_doc = await db.users.find_one({"id": current_user.id})
    if not user_doc or not user_doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="Ce compte n'a pas de mot de passe")
    if not verify_password(payload.password, user_doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Mot de passe incorrect")

    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"google_sub": sub, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"status": "linked", "message": "Compte Google lié avec succès"}

@router.post("/auth/logout")
async def logout_user(
    response: Response,
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Déconnexion de l'utilisateur.
    Le token présenté est ajouté à une liste noire (db.revoked_tokens) jusqu'à
    sa date d'expiration naturelle, afin qu'il ne puisse plus être réutilisé
    même s'il a été intercepté avant le logout.
    Les cookies de session (httpOnly) + CSRF sont aussi retirés (cookie auth).
    """
    # Le token peut venir du header (mobile) OU du cookie httpOnly : on
    # révoque le jti du header quand il est présent ; pour le cookie, la
    # révocation est best-effort (clear_auth_cookies retire de toute façon la
    # session côté navigateur).
    try:
        token = (credentials.credentials if credentials and credentials.credentials
                 else current_user.__kojo_token__ if hasattr(current_user, "__kojo_token__") else None)
        # fallback : lire depuis la requête via cookie n'est pas accessible ici,
        # mais la révocation est best-effort (le cookie sera de toute façon supprimé).
        payload = jwt.decode(token or "", JWT_SECRET, algorithms=[JWT_ALGORITHM])
        jti = payload.get("jti")
        exp_timestamp = payload.get("exp")
        if jti and exp_timestamp:
            expire_at = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
            await revoke_token(jti, expire_at)
    except jwt.InvalidTokenError:
        pass  # token déjà invalide/expiré, rien à révoquer

    # Retire les cookies de session (cookie auth) — best-effort même si la
    # révocation serveur a échoué.
    clear_auth_cookies(response)
    logger.info(f"User {current_user.email} logged out")
    return {"message": "Logout successful", "status": "success"}

@router.get("/auth/me")
async def get_current_user_auth(current_user: User = Depends(get_current_user)):
    return current_user.model_dump(exclude={"password_hash", "payment_accounts"})

class CountryUpdate(BaseModel):
    country: Country

@router.patch("/auth/me/country")
async def update_user_country(
    country_update: CountryUpdate,
    current_user: User = Depends(get_current_user)
):
    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if is_owner_user:
        return {"message": "Owner accounts have access to all countries. Country change bypassed.", "country": current_user.country}
        
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"country": country_update.country.value, "updated_at": datetime.now(timezone.utc)}}
    )
    return {"message": "Country updated successfully", "country": country_update.country.value}
