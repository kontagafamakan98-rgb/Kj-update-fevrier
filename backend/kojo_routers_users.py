import io
import re
import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, File, HTTPException, UploadFile
from pydantic import ValidationError

from kojo_core import db
from kojo_models import (
    Country, Language, PaymentAccount, PushToken, PushTokenCreate,
    User, validate_west_africa_phone,
)
from kojo_settings import (
    FRONTEND_APP_URL,
    REFERRAL_FILLEUL_REWARD,
    REFERRAL_SPONSOR_REWARD,
    logger,
)
from kojo_core import (
    get_current_user, is_valid_image_content, upload_image_to_cloudinary,
    upload_profile_photo_to_cloudinary, validate_payment_accounts,
)

# Même règle que le modèle User (prénom/nom).
_NAME_PATTERN = re.compile(r"^[a-zA-ZÀ-ÿ\s\-\'0-9_\.]+$")

router = APIRouter()

@router.get("/users/profile")
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user.model_dump(exclude={"password_hash"})

# Champs modifiables via PUT /users/profile — WHITELIST STRICTE.
# SECURITE : interdire l'écriture des champs sensibles (user_type,
# is_verified, rating, total_reviews, payment_accounts, payment_accounts_count,
# id, email, password_hash, created_at...) qui permettaient auparavant de
# frauder sa réputation, de s'auto-vérifier ou de contourner la validation
# des comptes de paiement (mass-assignment).
EDITABLE_PROFILE_FIELDS = {
    "first_name",
    "last_name",
    "phone",
    "preferred_language",
    "country",
    "bio",
    "skills",
    "profile_photo",
}

@router.put("/users/profile")
async def update_profile(
    user_data: dict,
    current_user: User = Depends(get_current_user)
):
    # Seuls les champs de la whitelist sont acceptés ; les autres sont ignorés
    # (jamais stockés), y compris les champs sensibles tentés par un client.
    update_data = {k: v for k, v in user_data.items() if k in EDITABLE_PROFILE_FIELDS}

    # Re-validation des champs modifiables : le modèle User n'est pas
    # reconstruit sur cette route, donc sans vérification explicite un
    # pays/téléphone invalide corrompait le profil et faisait échouer TOUS
    # les endpoints d'auth ensuite (ValidationError Pydantic en cascade).
    if "country" in update_data:
        country_value = str(update_data["country"]).strip().lower()
        valid_countries = {c.value for c in Country}
        if country_value not in valid_countries:
            raise HTTPException(
                status_code=400,
                detail=f"Pays invalide. Pays supportés: {', '.join(sorted(valid_countries))}"
            )
        update_data["country"] = country_value

    if "preferred_language" in update_data:
        lang_value = str(update_data["preferred_language"]).strip().lower()
        valid_langs = {l.value for l in Language}
        if lang_value not in valid_langs:
            raise HTTPException(
                status_code=400,
                detail=f"Langue invalide. Langues supportées: {', '.join(sorted(valid_langs))}"
            )
        update_data["preferred_language"] = lang_value

    if "phone" in update_data:
        try:
            update_data["phone"] = validate_west_africa_phone(str(update_data["phone"]))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    for name_field in ("first_name", "last_name"):
        if name_field in update_data:
            name_value = str(update_data[name_field] or "").strip()
            if not (2 <= len(name_value) <= 50) or not _NAME_PATTERN.match(name_value):
                raise HTTPException(
                    status_code=400,
                    detail=f"{name_field}: 2-50 caractères, sans caractères spéciaux"
                )
            update_data[name_field] = name_value

    if "bio" in update_data:
        bio = str(update_data["bio"] or "").strip()
        if len(bio) > 1000:
            raise HTTPException(status_code=400, detail="La bio ne peut pas dépasser 1000 caractères")
        update_data["bio"] = bio

    if "skills" in update_data:
        skills = update_data["skills"]
        if not isinstance(skills, list):
            raise HTTPException(status_code=400, detail="skills doit être une liste")
        if len(skills) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 compétences")
        for skill in skills:
            if not isinstance(skill, str) or not (1 <= len(skill) <= 100):
                raise HTTPException(
                    status_code=400,
                    detail="Compétence invalide (chaîne de 1 à 100 caractères)"
                )

    if "profile_photo" in update_data:
        photo = update_data["profile_photo"]
        if photo is not None:
            photo = str(photo).strip()
            if len(photo) > 500 or not photo.startswith(("http://", "https://")):
                raise HTTPException(status_code=400, detail="URL de photo invalide")
            update_data["profile_photo"] = photo

    update_data["updated_at"] = datetime.now(timezone.utc)

    await db.users.update_one(
        {"id": current_user.id},
        {"$set": update_data}
    )
    
    return {"message": "Profile updated successfully"}

@router.post("/users/profile-photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")

    file_content = await file.read()
    file_size = len(file_content)

    if file_size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")

    # Le content-type est spoofable : vérifier la signature réelle du fichier.
    if not is_valid_image_content(file_content):
        raise HTTPException(
            status_code=400,
            detail="Fichier image invalide (JPEG, PNG, GIF ou WebP requis)"
        )

    try:
        upload_result = upload_profile_photo_to_cloudinary(
            io.BytesIO(file_content),
            str(current_user.id)
        )

        photo_url = upload_result["photo_url"]

        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {"profile_photo": photo_url, "updated_at": datetime.now(timezone.utc)}}
        )

        return {
            "message": "Profile photo uploaded successfully",
            "photo_url": photo_url
        }

    except Exception as e:
        # Détail complet loggé côté serveur uniquement - on ne renvoie jamais
        # le message d'erreur brut d'un service tiers (Cloudinary) au client,
        # ça peut exposer des détails d'infra/config non destinés au public.
        logger.error(f"Erreur upload photo Cloudinary: {e}")
        raise HTTPException(status_code=500, detail="Échec de l'envoi de la photo. Veuillez réessayer.")

@router.get("/users/profile-photo")
async def get_current_user_profile_photo(current_user: User = Depends(get_current_user)):
    """Get current user's profile photo"""
    # Pas de photo = etat normal (compte sans photo), pas une erreur.
    # On renvoie 200 avec photo_url: null plutot qu'un 404 pour eviter
    # de polluer la console navigateur sur chaque page qui verifie la photo.
    return {
        "photo_url": current_user.profile_photo,
        "user_id": current_user.id
    }

@router.get("/users/{user_id}/profile-photo")
async def get_user_profile_photo(user_id: str, current_user: User = Depends(get_current_user)):
    """Get any user's profile photo (endpoint authentifié pour l'affichage
    des photos d'autres utilisateurs dans les conversations/missions).

    SECURITE : rendu authentifié pour empêcher l'énumération d'identifiants
    utilisateurs par un tiers non connecté (chaque requête révélant si un
    user_id existe)."""
    try:
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Pas de photo = etat normal, pas une erreur (voir commentaire ci-dessus).
        return {
            "photo_url": user.get("profile_photo"),
            "user_id": user_id
        }
    except Exception as e:
        logger.error(f"Error fetching profile photo for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.delete("/users/profile-photo")
async def delete_profile_photo(current_user: User = Depends(get_current_user)):
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo to delete")
    
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"profile_photo": None, "updated_at": datetime.now(timezone.utc)}}
    )
    
    return {"message": "Profile photo deleted successfully"}

@router.post("/users/push-token")
async def register_push_token(
    token_data: PushTokenCreate,
    current_user: User = Depends(get_current_user)
):
    """Register push notification token for mobile app"""
    try:
        logger.debug(f"Registering push token for user: {current_user.id}")
        
        # Verify user_id matches current user (security check)
        if token_data.user_id != current_user.id:
            raise HTTPException(
                status_code=403, 
                detail="Cannot register push token for different user"
            )
        
        # Check if token already exists for this user and device
        existing_token = await db.push_tokens.find_one({
            "user_id": current_user.id,
            "device_type": token_data.device_type,
            "device_id": token_data.device_id
        })
        
        if existing_token:
            # Update existing token
            await db.push_tokens.update_one(
                {"id": existing_token["id"]},
                {
                    "$set": {
                        "push_token": token_data.push_token,
                        "active": True,
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )
            logger.debug(f"Updated existing push token for user: {current_user.id}")
            return {
                "message": "Push token updated successfully",
                "token_id": existing_token["id"],
                "action": "updated"
            }
        else:
            # Limite d'appareils par utilisateur : evite le gonflement de la
            # collection push_tokens et le spam push multi-appareils.
            MAX_PUSH_TOKENS_PER_USER = 10
            active_count = await db.push_tokens.count_documents({"user_id": current_user.id, "active": True})
            if active_count >= MAX_PUSH_TOKENS_PER_USER:
                raise HTTPException(
                    status_code=400,
                    detail=f"Trop de dispositifs enregistrés (maximum {MAX_PUSH_TOKENS_PER_USER}). Supprimez un ancien appareil."
                )

            # Create new token
            push_token = PushToken(
                user_id=current_user.id,
                push_token=token_data.push_token,
                device_type=token_data.device_type,
                device_id=token_data.device_id
            )
            
            await db.push_tokens.insert_one(push_token.model_dump())
            logger.debug(f"Created new push token for user: {current_user.id}")
            
            return {
                "message": "Push token registered successfully",
                "token_id": push_token.id,
                "action": "created"
            }
            
    except ValidationError as e:
        # Détail Pydantic loggé côté serveur uniquement - exposer la structure
        # interne du modèle push token au client n'apporte rien à l'utilisateur
        # final et donne des informations inutiles sur l'implémentation backend.
        logger.error(f"Validation error in push token registration: {e}")
        raise HTTPException(status_code=422, detail="Données de token invalides")
    except Exception as e:
        logger.error(f"Error registering push token: {e}")
        raise HTTPException(status_code=500, detail="Failed to register push token")

@router.get("/users/push-tokens")
async def get_user_push_tokens(current_user: User = Depends(get_current_user)):
    """Get all push tokens for current user"""
    try:
        tokens = await db.push_tokens.find(
            {"user_id": current_user.id, "active": True}
        ).to_list(length=None)
        
        return {
            "tokens": [
                {
                    "id": token["id"],
                    "device_type": token["device_type"], 
                    "device_id": token.get("device_id"),
                    "created_at": token["created_at"],
                    "updated_at": token["updated_at"]
                } 
                for token in tokens
            ],
            "count": len(tokens)
        }
    except Exception as e:
        logger.error(f"Error getting push tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to get push tokens")

@router.delete("/users/push-token/{token_id}")
async def delete_push_token(
    token_id: str,
    current_user: User = Depends(get_current_user)
):
    """Delete/deactivate a push token"""
    try:
        # Find token and verify ownership
        token = await db.push_tokens.find_one({"id": token_id, "user_id": current_user.id})
        if not token:
            raise HTTPException(status_code=404, detail="Push token not found")
        
        # Deactivate token instead of deleting (for audit trail)
        await db.push_tokens.update_one(
            {"id": token_id},
            {
                "$set": {
                    "active": False,
                    "updated_at": datetime.now(timezone.utc)
                }
            }
        )
        
        logger.debug(f"Deactivated push token {token_id} for user: {current_user.id}")
        return {"message": "Push token deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting push token: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete push token")

@router.get("/users/payment-accounts")
async def get_user_payment_accounts(current_user: User = Depends(get_current_user)):
    """Obtenir les comptes de paiement de l'utilisateur connecté"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user_id": current_user.id,
        "user_type": user_data["user_type"],
        "payment_accounts": user_data.get("payment_accounts", {}),
        "payment_accounts_count": user_data.get("payment_accounts_count", 0),
        "is_verified": user_data.get("is_verified", False),
        "minimum_required": 2 if user_data["user_type"] == "worker" else 1
    }

@router.put("/users/payment-accounts")
async def update_user_payment_accounts(
    payment_data: PaymentAccount,
    current_user: User = Depends(get_current_user)
):
    """Mettre à jour les comptes de paiement de l'utilisateur"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Valider les nouveaux comptes de paiement
    try:
        payment_validation = validate_payment_accounts(payment_data, user_data["user_type"])
    except HTTPException as e:
        raise e
    
    # Mettre à jour en base de données
    await db.users.update_one(
        {"id": current_user.id},
        {
            "$set": {
                "payment_accounts": payment_validation["account_details"],
                "payment_accounts_count": payment_validation["linked_accounts_count"],
                "is_verified": payment_validation["is_verified"],
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    return {
        "message": "Comptes de paiement mis à jour avec succès",
        "payment_verification": {
            "linked_accounts": payment_validation["linked_accounts_count"],
            "required_minimum": 2 if user_data["user_type"] == "worker" else 1,
            "is_verified": payment_validation["is_verified"],
            "accounts": payment_validation["account_details"]
        }
    }

@router.post("/users/verify-payment-access")
async def verify_payment_access(current_user: User = Depends(get_current_user)):
    """Vérifier si l'utilisateur peut accéder aux fonctionnalités de paiement"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    payment_count = user_data.get("payment_accounts_count", 0)
    user_type = user_data["user_type"]
    is_verified = user_data.get("is_verified", False)
    
    # Vérifier les conditions d'accès
    if user_type == "client" and payment_count < 1:
        return {
            "access_granted": False,
            "message": "Les clients doivent lier au moins 1 moyen de paiement",
            "required_minimum": 1,
            "current_count": payment_count,
            "user_type": user_type
        }
    elif user_type == "worker" and payment_count < 2:
        return {
            "access_granted": False,
            "message": "Les travailleurs doivent lier au minimum 2 moyens de paiement",
            "required_minimum": 2,
            "current_count": payment_count,
            "user_type": user_type
        }
    
    return {
        "access_granted": True,
        "message": "Accès autorisé aux fonctionnalités de paiement",
        "is_verified": is_verified,
        "payment_accounts_count": payment_count,
        "user_type": user_type
    }


# ---------------------------------------------------------------------------
# Portfolio travailleur (photos de réalisations) — preuve sociale
# ---------------------------------------------------------------------------

@router.post("/users/portfolio")
async def add_portfolio_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Ajoute une photo au portfolio du travailleur (max 10)."""
    if current_user.user_type != "worker":
        raise HTTPException(status_code=403, detail="Réservé aux travailleurs")

    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")

    file_content = await file.read()
    if len(file_content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")
    if not is_valid_image_content(file_content):
        raise HTTPException(status_code=400, detail="Fichier image invalide (JPEG, PNG, GIF ou WebP requis)")

    try:
        upload_result = upload_image_to_cloudinary(
            io.BytesIO(file_content),
            str(current_user.id),
            "kojo/portfolio",
            "portfolio",
        )
    except Exception as exc:
        logger.error(f"Erreur upload portfolio Cloudinary: {exc}")
        raise HTTPException(status_code=500, detail="Échec de l'envoi de la photo. Veuillez réessayer.")

    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    images = list((profile or {}).get("portfolio_images") or [])
    if len(images) >= 10:
        raise HTTPException(status_code=400, detail="Maximum 10 portfolio images")

    images.append(upload_result["photo_url"])
    if profile:
        await db.worker_profiles.update_one(
            {"user_id": current_user.id},
            {"$set": {"portfolio_images": images, "updated_at": datetime.now(timezone.utc)}},
        )
    else:
        await db.worker_profiles.insert_one(
            {"user_id": current_user.id, "portfolio_images": images, "created_at": datetime.now(timezone.utc)}
        )

    return {"portfolio_images": images}


@router.get("/users/portfolio")
async def get_portfolio(current_user: User = Depends(get_current_user)):
    """Retourne le portfolio du travailleur courant (liste d'URLs)."""
    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    return {"portfolio_images": list((profile or {}).get("portfolio_images") or [])}


@router.delete("/users/portfolio/{index}")
async def remove_portfolio_image(
    index: int,
    current_user: User = Depends(get_current_user),
):
    """Supprime la photo de portfolio à l'index donné."""
    if current_user.user_type != "worker":
        raise HTTPException(status_code=403, detail="Réservé aux travailleurs")

    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    images = list(profile.get("portfolio_images") or [])
    if index < 0 or index >= len(images):
        raise HTTPException(status_code=404, detail="Image not found")

    images.pop(index)
    await db.worker_profiles.update_one(
        {"user_id": current_user.id},
        {"$set": {"portfolio_images": images, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"portfolio_images": images}


# ---------------------------------------------------------------------------
# Parrainage — code d'invitation à partager
# ---------------------------------------------------------------------------

_REFERRAL_ALPHABET = string.ascii_uppercase + string.digits


def _generate_referral_code(length: int = 10) -> str:
    return ''.join(secrets.choice(_REFERRAL_ALPHABET) for _ in range(length))


async def _ensure_referral_code(user_id: str) -> str:
    """Retourne le code de parrainage de l'utilisateur, en le générant (unique)
    s'il n'en a pas encore."""
    user_data = await db.users.find_one({"id": user_id}, {"referral_code": 1})
    existing = (user_data or {}).get("referral_code")
    if existing:
        return existing

    for _ in range(10):
        code = _generate_referral_code()
        clash = await db.users.find_one({"referral_code": code}, {"id": 1})
        if not clash:
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"referral_code": code, "updated_at": datetime.now(timezone.utc)}},
            )
            return code
    raise HTTPException(status_code=500, detail="Impossible de générer un code de parrainage")


@router.get("/users/referral")
async def get_referral(current_user: User = Depends(get_current_user)):
    """Retourne le code de parrainage de l'utilisateur (le génère si absent),
    ainsi que le solde de récompense de parrainage et son historique."""
    code = await _ensure_referral_code(current_user.id)
    user_data = await db.users.find_one(
        {"id": current_user.id},
        {"referral_reward_balance": 1, "referral_rewards": 1},
    )
    return {
        "referral_code": code,
        "invite_url": f"{FRONTEND_APP_URL}/register?ref={code}",
        "reward_balance": float((user_data or {}).get("referral_reward_balance") or 0),
        "reward_history": (user_data or {}).get("referral_rewards") or [],
        "sponsor_reward": REFERRAL_SPONSOR_REWARD,
        "filleul_reward": REFERRAL_FILLEUL_REWARD,
    }


@router.post("/users/referral/apply")
async def apply_referral(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """Enregistre le code du parrain saisi à l'inscription (référence croisée,
    pas de crédit monétaire automatique)."""
    code = str((payload or {}).get("code") or '').strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Code de parrainage requis")

    sponsor = await db.users.find_one({"referral_code": code}, {"id": 1})
    if not sponsor:
        raise HTTPException(status_code=404, detail="Code de parrainage invalide")
    if sponsor["id"] == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous parrainer vous-même")

    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"referred_by": code, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Code de parrainage appliqué", "referred_by": code}
