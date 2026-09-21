# -*- coding: utf-8 -*-
"""Profil du compte et photo de profil.

Deux sujets qui n'ont en commun que leur préfixe d'URL, mais qui partagent un
même fait : l'identité publique du compte (nom, prénom, photo). Le profil
(`GET`/`PUT /users/profile`) et la photo (`POST`/`GET`/`DELETE`, plus la lecture
de la photo d'un AUTRE compte pour les missions) se lisent donc ensemble.

La règle de validation du nom vit ici, à côté du seul endroit qui l'applique.
"""
import io

import re

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from kojo_core import db

from kojo_models import Country, Language, User, validate_west_africa_phone

from kojo_settings import logger

from kojo_core import (
    get_current_user,
    is_valid_image_content,
    upload_profile_photo_to_cloudinary,

)

router = APIRouter()


# Même règle que le modèle User (prénom/nom).
_NAME_PATTERN = re.compile(r"^[a-zA-ZÀ-ÿ\s\-\'0-9_\.]+$")

router = APIRouter()

@router.get("/users/profile")
async def get_profile(current_user: User = Depends(get_current_user)):
    """Profil de l'utilisateur connecté.

    PRIVACITÉ : payment_accounts n'est JAMAIS renvoyé ici — le frontend
    ne l'utilise que via GET /users/payment-accounts à la demande.

    Returns:
        dict: profil User complet, SANS password_hash ni payment_accounts.
    """
    # PRIVACITÉ : payment_accounts (numéros Orange Money/Wave, cartes,
    # comptes bancaires COMPLETS) n'est JAMAIS renvoyé dans le profil — le
    # frontend ne l'utilise que via GET /users/payment-accounts, appelé à la
    # demande quand l'utilisateur ouvre la section comptes. Exclure ici
    # évite que les numéros transitent/soient stockés avec le profil
    # (ex: localStorage du frontend) même quand ils ne sont pas affichés.
    return current_user.model_dump(exclude={"password_hash", "payment_accounts"})

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
    """Met à jour le profil (whitelist stricte : first_name, last_name, phone,
    preferred_language, country, bio, skills, profile_photo — les champs
    sensibles sont ignorés, jamais écrits).

    Returns:
        dict: {message: "Profile updated successfully"}.
    """
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
        if photo is None:
            # null = suppression explicite de la photo (comportement historique).
            update_data["profile_photo"] = None
        else:
            photo = str(photo).strip()
            if not photo:
                # Chaîne vide (formulaire sans photo) : on ne touche pas au
                # champ existant plutôt que de stocker une chaîne vide.
                update_data.pop("profile_photo", None)
            elif len(photo) > 500 or not photo.startswith("https://res.cloudinary.com/"):
                # La source de vérité des photos est Cloudinary (upload via
                # /users/profile-photo). On refuse les URLs externes qui
                # serviraient de pisteur (tracking) ou de lien arbitraire.
                raise HTTPException(status_code=400, detail="URL de photo invalide (Cloudinary requis)")
            else:
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
    """Upload de la photo de profil (max 5 Mo, image réelle vérifiée par
    signature, stockée sur Cloudinary).

    Returns:
        dict: {message, photo_url}.
    """
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
    """Photo de profil de l'utilisateur connecté (200 avec photo_url: null
    quand aucune photo — état normal, pas une erreur).

    Returns:
        dict: {photo_url, user_id}.
    """
    # Pas de photo = etat normal (compte sans photo), pas une erreur.
    # On renvoie 200 avec photo_url: null plutot qu'un 404 pour eviter
    # de polluer la console navigateur sur chaque page qui verifie la photo.
    return {
        "photo_url": current_user.profile_photo,
        "user_id": current_user.id
    }

@router.get("/users/{user_id}/profile-photo")
async def get_user_profile_photo(user_id: str, current_user: User = Depends(get_current_user)):
    """Photo de profil d'un autre utilisateur (authentifié, pour l'affichage
    dans les conversations/missions).

    SECURITE : rendu authentifié pour empêcher l'énumération d'identifiants
    utilisateurs par un tiers non connecté (chaque requête révélant si un
    user_id existe).

    Returns:
        dict: {photo_url, user_id} — photo_url null si l'utilisateur n'a pas
        de photo (état normal).
    """
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
    """Supprime la photo de profil (404 si aucune photo).

    Returns:
        dict: {message: "Profile photo deleted successfully"}.
    """
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo to delete")
    
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"profile_photo": None, "updated_at": datetime.now(timezone.utc)}}
    )
    
    return {"message": "Profile photo deleted successfully"}
