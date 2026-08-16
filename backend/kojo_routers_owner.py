import logging
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query

from kojo_core import db
from kojo_models import (
    User,
)
from kojo_settings import (
    JWT_ALGORITHM,
)
from kojo_core import (
    get_current_user, is_database_available, verify_owner_access,
)
from kojo_payments import get_effective_commission_rate
from kojo_routers_jobs import execute_paydunya_refund

router = APIRouter()

@router.get("/stats")
async def get_system_stats(current_user: User = Depends(get_current_user)):
    """Statistics endpoint (authentifié — ne plus exposer les compteurs
    d'utilisateurs/missions publiquement à quiconque n'est pas connecté)."""
    db_available = await is_database_available()

    if not db_available:
        return {
            "total_users": 0,
            "total_jobs": 0,
            "total_workers": 0,
            "total_clients": 0,
            "supported_countries": ["senegal", "mali", "cote_divoire", "burkina_faso"],
            "supported_languages": ["fr", "en", "wo", "bm"],
            "database": "unavailable",
            "timestamp": datetime.now(timezone.utc)
        }

    total_users = await db.users.count_documents({})
    total_jobs = await db.jobs.count_documents({})
    total_workers = await db.users.count_documents({"user_type": "worker"})
    total_clients = await db.users.count_documents({"user_type": "client"})
    
    return {
        "total_users": total_users,
        "total_jobs": total_jobs,
        "total_workers": total_workers,
        "total_clients": total_clients,
        "supported_countries": ["senegal", "mali", "cote_divoire", "burkina_faso"],
        "supported_languages": ["fr", "en", "wo", "bm"],
        "database": "connected",
        "timestamp": datetime.now(timezone.utc)
    }

async def compute_real_commission_stats() -> Dict[str, Any]:
    commission_rate = await get_effective_commission_rate()
    completed_payments = [item async for item in db.payments.find({'status': 'completed'}).sort('created_at', -1)]
    now = datetime.now(timezone.utc)
    today = now.date()

    total_transactions = len(completed_payments)
    total_commission_earned = sum(int(item.get('commission_amount', 0) or 0) for item in completed_payments)
    total_volume = sum(int(item.get('amount', 0) or 0) for item in completed_payments)

    daily_commission = 0
    monthly_commission = 0
    method_totals: Dict[str, Dict[str, int]] = {}
    recent_transactions = []

    for item in completed_payments:
        created_raw = item.get('completed_at') or item.get('updated_at') or item.get('created_at')
        try:
            created_dt = datetime.fromisoformat(str(created_raw).replace('Z', '+00:00'))
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
        except Exception:
            created_dt = now

        if created_dt.date() == today:
            daily_commission += int(item.get('commission_amount', 0) or 0)
        if created_dt.year == now.year and created_dt.month == now.month:
            monthly_commission += int(item.get('commission_amount', 0) or 0)

        method = item.get('payment_method', 'unknown')
        bucket = method_totals.setdefault(method, {'volume': 0, 'commission': 0})
        bucket['volume'] += int(item.get('amount', 0) or 0)
        bucket['commission'] += int(item.get('commission_amount', 0) or 0)

        if len(recent_transactions) < 10:
            recent_transactions.append({
                'id': item.get('id'),
                'amount': int(item.get('amount', 0) or 0),
                'commission': int(item.get('commission_amount', 0) or 0),
                'worker_amount': int(item.get('worker_amount', 0) or 0),
                'method': method,
                'paymentMethod': method,
                'date': created_dt.isoformat(),
                'timestamp': created_dt.isoformat()
            })

    top_payment_methods = [
        {'method': method, 'volume': data['volume'], 'commission': data['commission']}
        for method, data in sorted(method_totals.items(), key=lambda item: item[1]['volume'], reverse=True)
    ]

    return {
        'total_transactions': total_transactions,
        'total_commission_earned': total_commission_earned,
        'commission_rate': round(commission_rate * 100),
        'total_volume': total_volume,
        'daily_commission': daily_commission,
        'monthly_commission': monthly_commission,
        'top_payment_methods': top_payment_methods,
        'recent_transactions': recent_transactions
    }

@router.get("/owner/commission-stats")
async def get_commission_stats(owner_user = Depends(verify_owner_access)):
    """Statistiques des commissions - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        stats = await compute_real_commission_stats()
        return {
            "status": "success",
            "owner_email": owner_user["email"],
            "stats": stats
        }
    except Exception as e:
        logging.error(f"Error getting commission stats: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@router.get("/owner/debug-info")
async def get_debug_info(owner_user = Depends(verify_owner_access)):
    """Informations de debug - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Compter les utilisateurs
        total_users = await db.users.count_documents({})
        clients = await db.users.count_documents({"user_type": "client"})
        workers = await db.users.count_documents({"user_type": "worker"})
        
        # Compter les jobs
        total_jobs = await db.jobs.count_documents({})
        active_jobs = await db.jobs.count_documents({"status": "open"})
        
        debug_info = {
            "system_status": "running",
            "database_connected": True,
            "total_users": total_users,
            "user_breakdown": {
                "clients": clients,
                "workers": workers,
                "owner": 1
            },
            "jobs_stats": {
                "total_jobs": total_jobs,
                "active_jobs": active_jobs
            },
            "server_info": {
                "jwt_algorithm": JWT_ALGORITHM,
                "cors_enabled": True,
                "uploads_enabled": True
            },
            "owner_permissions": owner_user.get("permissions", [])
        }
        
        return {
            "status": "success",
            "debug_info": debug_info,
            "access_level": "OWNER_FULL_ACCESS"
        }
        
    except Exception as e:
        logging.error(f"Error getting debug info: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@router.get("/owner/users-management")
async def get_users_management(
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    owner_user = Depends(verify_owner_access)
):
    """Gestion des utilisateurs - PROPRIÉTAIRE UNIQUEMENT (paginé)"""
    try:
        # Récupérer les utilisateurs (sauf le propriétaire), paginé pour
        # éviter de charger toute la collection en mémoire à chaque appel.
        users_cursor = db.users.find(
            {"user_type": {"$ne": "owner"}},
            {"password_hash": 0, "_id": 0}  # Exclure les mots de passe et _id
        ).skip(offset).limit(limit)
        users = await users_cursor.to_list(length=limit)
        
        # Statistiques des utilisateurs
        user_stats = {
            "total_users": len(users),
            "clients": len([u for u in users if u.get("user_type") == "client"]),
            "workers": len([u for u in users if u.get("user_type") == "worker"]),
            "by_country": {}
        }
        
        # Compter par pays
        for user in users:
            country = user.get("country", "unknown")
            user_stats["by_country"][country] = user_stats["by_country"].get(country, 0) + 1
        
        return {
            "status": "success",
            "users": users,
            "stats": user_stats,
            "access_level": "OWNER_FULL_ACCESS"
        }
        
    except Exception as e:
        logging.error(f"Error getting users management: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@router.post("/owner/update-commission-settings")
async def update_commission_settings(
    settings: dict,
    owner_user = Depends(verify_owner_access)
):
    """Mettre à jour les paramètres de commission - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Valider les paramètres
        commission_rate = settings.get("commission_rate", 14)
        if not 0 <= commission_rate <= 50:
            raise HTTPException(status_code=400, detail="Taux de commission invalide (0-50%)")
        
        # Sauvegarder les paramètres en base
        await db.settings.update_one(
            {"type": "commission"},
            {
                "$set": {
                    "commission_rate": commission_rate,
                    "owner_accounts": settings.get("owner_accounts", {}),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": owner_user["id"]
                }
            },
            upsert=True
        )
        
        return {
            "status": "success",
            "message": "Paramètres de commission mis à jour",
            "new_settings": settings
        }
        
    except Exception as e:
        logging.error(f"Error updating commission settings: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@router.post("/owner/payments/{payment_id}/retry-refund")
async def retry_payment_refund(payment_id: str, owner_user = Depends(verify_owner_access)):
    """Relance le remboursement automatique d'un paiement passé en
    refund_failed (ex: le client n'avait pas de compte mobile money à
    l'annulation, ou PayDunya l'a refusé). On réessaie avec les comptes
    ACTUELS du payeur.

    PROPRIÉTAIRE UNIQUEMENT. Un remboursement en cours (refunding) n'est
    jamais relancé ici : il est tranché par l'IPN ou la re-vérification du
    statut, pas par une seconde tentative (risque de double remboursement)."""
    payment_record = await db.payments.find_one({"id": payment_id})
    if not payment_record:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    if payment_record.get("payout_kind") != "refund":
        raise HTTPException(status_code=400, detail="Ce paiement n'est pas un remboursement")
    if payment_record.get("payout_status") != "refund_failed":
        raise HTTPException(
            status_code=409,
            detail=f"Remboursement non relançable (statut actuel : {payment_record.get('payout_status') or 'inconnu'})"
        )

    # Verrou CAS : relance uniquement depuis refund_failed.
    lock_result = await db.payments.update_one(
        {"id": payment_id, "payout_status": "refund_failed"},
        {"$set": {
            "payout_status": "refunding",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    if lock_result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Remboursement déjà en cours")

    refund_status = await execute_paydunya_refund(payment_record)
    return {
        "payment_id": payment_id,
        "job_id": payment_record.get("job_id"),
        "refund_status": refund_status,
        "refunded_amount": payment_record.get("amount"),
    }
