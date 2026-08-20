import base64
import io
import jwt
import uuid
from datetime import datetime, timezone

from cloudinary import uploader as cloudinary_uploader
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ValidationError

from kojo_core import db
from kojo_models import (
    Country, EmailOtpRequest, EmailOtpResendRequest,
    EmailOtpVerifyRequest, PasswordResetConfirmRequest, User, UserLogin, UserWithPayment, WorkerProfile,
)
from kojo_settings import (
    EMAIL_OTP_EXPIRY_MINUTES,
    EMAIL_OTP_MAX_ATTEMPTS,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    JWT_ALGORITHM,
    JWT_SECRET,
    OWNER_EMAIL,
    logger,
)
from kojo_core import (
    create_access_token, get_current_user, hash_password, is_token_revoked,
    is_valid_image_content, log_and_raise_http_exception, revoke_token,
    sanitize_email, security, validate_payment_accounts, verify_password,
)
from kojo_email import (
    create_email_verification_token, hash_email_otp, issue_email_otp,
    verify_email_verification_token, mask_email_address,
)

router = APIRouter()

@router.post("/auth/email/check-availability")
async def check_signup_email_availability(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    return {
        "email": clean_email,
        "available": existing_user is None,
        "message": "Adresse email disponible" if not existing_user else "Cette adresse email est déjà utilisée"
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
    await db.users.update_one(
        {"email": clean_email},
        {
            "$set": {
                "password_hash": hash_password(payload.new_password),
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
async def register_user_verified(user_data: UserWithPayment):
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
        
        # Valider les comptes de paiement selon le type d'utilisateur
        try:
            payment_validation = validate_payment_accounts(user_data.payment_accounts, user_data.user_type)
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
        
        # Create access token
        access_token = create_access_token(data={"sub": user.id, "email": user.email})
        
        response_data = {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user.model_dump(exclude={"password_hash"}),
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
async def login_user(credentials: UserLogin):
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
    
    access_token = create_access_token(data={"sub": user["id"], "email": user["email"]})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": User(**user).model_dump(exclude={"password_hash"})
    }

@router.post("/auth/logout")
async def logout_user(
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """
    Déconnexion de l'utilisateur.
    Le token présenté est ajouté à une liste noire (db.revoked_tokens) jusqu'à
    sa date d'expiration naturelle, afin qu'il ne puisse plus être réutilisé
    même s'il a été intercepté avant le logout.
    """
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        jti = payload.get("jti")
        exp_timestamp = payload.get("exp")
        if jti and exp_timestamp:
            expire_at = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
            await revoke_token(jti, expire_at)
    except jwt.InvalidTokenError:
        pass  # token déjà invalide/expiré, rien à révoquer

    logger.info(f"User {current_user.email} logged out")
    return {"message": "Logout successful", "status": "success"}

@router.get("/auth/me")
async def get_current_user_auth(current_user: User = Depends(get_current_user)):
    return current_user.model_dump(exclude={"password_hash"})

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
