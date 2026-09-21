# -*- coding: utf-8 -*-
"""Comptes mobile money du compte et vérification de l'accès au paiement.

Ce que le dépositaire des fonds doit pouvoir joindre : l'utilisateur déclare ses
comptes mobile money ici, et `verify-payment-access` dit si le paiement est
ouvert à ce compte — deux réponses à la même question, d'où le même module.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db

from kojo_models import PaymentAccount, User

from kojo_core import get_current_user, validate_payment_accounts
from kojo_identifiants import identifiant_query

router = APIRouter()


@router.get("/users/payment-accounts")
async def get_user_payment_accounts(current_user: User = Depends(get_current_user)):
    """Comptes de paiement de l'utilisateur connecté (seul endpoint qui
    expose les numéros complets, appelé à la demande).

    Returns:
        dict: {user_id, user_type, payment_accounts, payment_accounts_count,
        is_verified, minimum_required}.
    """
    
    user_data = await db.users.find_one({**identifiant_query(current_user.id)})
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
    """Met à jour les comptes de paiement de l'utilisateur (validation
    stricte : pays, canaux PayDunya opérés, minimum requis par rôle).

    Returns:
        dict: {message, payment_verification: {linked_accounts,
        required_minimum, is_verified, accounts}}.
    """
    
    user_data = await db.users.find_one({**identifiant_query(current_user.id)})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Valider les nouveaux comptes de paiement (le pays permet de refuser
    # Wave là où le canal PayDunya n'est pas opéré : Mali, Burkina Faso).
    try:
        payment_validation = validate_payment_accounts(
            payment_data, user_data["user_type"], user_data.get("country")
        )
    except HTTPException as e:
        raise e
    
    # Mettre à jour en base de données
    await db.users.update_one(
        {**identifiant_query(current_user.id)},
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
    """Vérifie si l'utilisateur peut accéder aux paiements (comptes liés >= minimum).

    Returns:
        dict: {access_granted, message, required_minimum, current_count,
        user_type, is_verified?}.
    """
    
    user_data = await db.users.find_one({**identifiant_query(current_user.id)})
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
