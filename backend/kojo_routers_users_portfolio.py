# -*- coding: utf-8 -*-
"""Portfolio travailleur : les photos de réalisations (preuve sociale).

Le portfolio est la vitrine du travailleur ; il ne sert qu'à lui, et n'a aucune
règle en commun avec le profil (une image de portfolio n'est pas une identité,
c'est une preuve de travail).
"""
import io

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from kojo_core import db

from kojo_models import User

from kojo_settings import logger

from kojo_core import get_current_user, is_valid_image_content, upload_image_to_cloudinary

router = APIRouter()


# ---------------------------------------------------------------------------
# Portfolio travailleur (photos de réalisations) — preuve sociale
# ---------------------------------------------------------------------------

@router.post("/users/portfolio")
async def add_portfolio_image(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Ajoute une photo au portfolio du travailleur (max 10, image vérifiée,
    stockée sur Cloudinary).

    Returns:
        dict: {portfolio_images} — liste à jour des URLs.
    """
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
    """Retourne le portfolio du travailleur courant (liste d'URLs).

    Returns:
        dict: {portfolio_images: [urls]}. Liste vide si aucun portfolio.
    """
    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    return {"portfolio_images": list((profile or {}).get("portfolio_images") or [])}


@router.delete("/users/portfolio/{index}")
async def remove_portfolio_image(
    index: int,
    current_user: User = Depends(get_current_user),
):
    """Supprime la photo de portfolio à l'index donné.

    Returns:
        dict: {portfolio_images} — liste à jour des URLs.
    """
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
