# -*- coding: utf-8 -*-
"""Jetons de notification du compte : enregistrer, lister, révoquer.

Le jeton est la seule donnée qui permet d'atteindre un appareil : il vit et
meurt avec le compte, et c'est l'une des cascades que la suppression de compte
doit purger.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from pydantic import ValidationError

from kojo_core import db

from kojo_models import PushToken, PushTokenCreate, User

from kojo_settings import logger

from kojo_core import get_current_user
from kojo_identifiants import identifiant_query

router = APIRouter()


@router.post("/users/push-token")
async def register_push_token(
    token_data: PushTokenCreate,
    current_user: User = Depends(get_current_user)
):
    """Enregistre (ou met à jour) un token push mobile ; max 10 appareils
    actifs par utilisateur.

    Returns:
        dict: {message, token_id, action: "created" | "updated"}.
    """
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
                {**identifiant_query(existing_token["id"])},
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
    """Tokens push actifs de l'utilisateur connecté (sans le token brut).

    Returns:
        dict: {tokens: [{id, device_type, device_id, created_at, updated_at}],
        count}.
    """
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
    """Désactive un token push (désactivation, pas suppression physique —
    audit trail).

    Returns:
        dict: {message: "Push token deactivated successfully"}.
    """
    try:
        # Find token and verify ownership
        token = await db.push_tokens.find_one({**identifiant_query(token_id), "user_id": current_user.id})
        if not token:
            raise HTTPException(status_code=404, detail="Push token not found")
        
        # Deactivate token instead of deleting (for audit trail)
        await db.push_tokens.update_one(
            {**identifiant_query(token_id)},
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
