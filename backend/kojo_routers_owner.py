import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from kojo_core import db
from kojo_email_suppressions import (
    adresse_boite,
    etat_des_suppressions,
    lever_suppression,
)
from kojo_settings import (
    JWT_ALGORITHM,
    LITIGE_DECISION_DAYS,
    PAYOUT_ALERT_THRESHOLD_HOURS,
    logger,
)
import kojo_job_disputes as litiges
# Modération des comptes : le répertoire, les états et la lecture des fils.
# La logique vit dans `kojo_comptes_admin` (une seule définition de « banni ») ;
# ce routeur ne fait que l'exposer au propriétaire.
import kojo_comptes_admin as comptes
from kojo_core import (
    is_database_available, verify_owner_access,
)
import kojo_commission as paliers_commission
from kojo_payments import (
    get_effective_commission_rate,
    maj_sequestre,
    paydunya_circuit_state,
    refresh_paydunya_circuit_from_db,
)
from kojo_routers_jobs import execute_paydunya_refund
# Helpers du sweeper (kojo_scheduler) : source unique de vérité pour les
# statuts incertains et le calcul de la durée de blocage.
from kojo_scheduler import _STUCK_PAYOUT_STATUSES, _stuck_for, mesure_relances
from kojo_identifiants import identifiant_query

router = APIRouter()

@router.get("/stats")
async def get_system_stats(owner_user = Depends(verify_owner_access)):
    """Statistics endpoint — PROPRIÉTAIRE UNIQUEMENT (les compteurs
    d'utilisateurs/missions ne doivent être visibles d'aucun utilisateur
    lambda ; la landing utilise /api/public/stats, qui reste public).

    Returns:
        dict: {total_users, total_jobs, total_workers, total_clients,
        supported_countries, supported_languages, database, timestamp}.
    """
    db_available = await is_database_available()

    if not db_available:
        return {
            "total_users": 0,
            "total_jobs": 0,
            "total_workers": 0,
            "total_clients": 0,
            "supported_countries": ["senegal", "mali", "cote_divoire", "burkina_faso"],
            "supported_languages": ["fr", "en", "wo", "bm", "mos"],
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
        "total_clients": total_clients,                "supported_countries": ["senegal", "mali", "cote_divoire", "burkina_faso"],
        "supported_languages": ["fr", "en", "wo", "bm", "mos"],
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
    """Statistiques des commissions - PROPRIÉTAIRE UNIQUEMENT.

    Returns:
        dict: {status, owner_email, stats} (stats = détail commission).
    """
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
    """Informations de debug - PROPRIÉTAIRE UNIQUEMENT.

    Returns:
        dict: {system_status, database_connected, total_users, …} — vue
        technique complète.
    """
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
    """Gestion des utilisateurs - PROPRIÉTAIRE UNIQUEMENT (paginé).

    Returns:
        dict: {status, users (sans password_hash), stats, access_level}.
    """
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
    """Mettre à jour les paramètres de commission - PROPRIÉTAIRE UNIQUEMENT.

    Returns:
        dict: {status, message, new_settings}.
    """
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

@router.get("/owner/commission-paliers")
async def get_commission_tiers(owner_user = Depends(verify_owner_access)):
    """Paliers de commission : la configuration ET le taux de croisière.

    Les deux chiffres vont ensemble : « lancement 0 % » ne se lit pas sans le
    taux standard auquel il se compare. Le taux standard reste résolu par
    `kojo_payments.get_effective_commission_rate` — un seul propriétaire.

    Returns:
        dict: {status, paliers (actif, seuils, taux), taux_standard_percent}.
    """
    configuration = await paliers_commission.configuration()
    taux_standard = await get_effective_commission_rate()
    return {
        "status": "success",
        "paliers": configuration,
        "taux_standard_percent": round(taux_standard * 100, 2),
    }


@router.post("/owner/commission-paliers")
async def update_commission_tiers(
    reglages: dict,
    owner_user = Depends(verify_owner_access),
):
    """Règle les paliers de commission — PROPRIÉTAIRE UNIQUEMENT.

    Un refus nomme le champ fautif (400) au lieu de réparer la valeur en
    silence : un taux saisi 60 et ramené à 50 ferait croire que le barème est
    appliqué alors qu'il ne l'est pas.

    Returns:
        dict: {status, message, paliers} — la configuration RÉELLEMENT relue.
    """
    try:
        configuration = await paliers_commission.enregistrer(reglages)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "status": "success",
        "message": "Paliers de commission mis à jour",
        "paliers": configuration,
    }


@router.post("/owner/payments/{payment_id}/retry-refund")
async def retry_payment_refund(payment_id: str, owner_user = Depends(verify_owner_access)):
    """Relance le remboursement automatique d'un paiement passé en
    refund_failed (ex: le client n'avait pas de compte mobile money à
    l'annulation, ou PayDunya l'a refusé). On réessaie avec les comptes
    ACTUELS du payeur.

    PROPRIÉTAIRE UNIQUEMENT. Un remboursement en cours (refunding) n'est
    jamais relancé ici : il est tranché par l'IPN ou la re-vérification du
    statut, pas par une seconde tentative (risque de double remboursement).

    Returns:
        dict: {payment_id, job_id, refund_status, refunded_amount}.
    """
    payment_record = await db.payments.find_one({**identifiant_query(payment_id)})
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
        {**identifiant_query(payment_id), "payout_status": "refund_failed"},
        maj_sequestre("refunding", {"updated_at": datetime.now(timezone.utc).isoformat()})
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

@router.get("/owner/stuck-payouts")
async def get_stuck_payouts(owner_user = Depends(verify_owner_access)):
    """Liste les décaissements restés en statut incertain (releasing/refunding)
    avec leur durée de blocage et l'état de la dernière alerte propriétaire.

    PROPRIÉTAIRE UNIQUEMENT. Complément du sweeper (kojo_scheduler) : l'alerte
    pousse au propriétaire au-delà du seuil (PAYOUT_ALERT_THRESHOLD_HOURS), cet
    endpoint donne la vue exhaustive et à jour pour agir (relancer un refund,
    contacter PayDunya…) :
    - blocked_since / blocked_hours : depuis quand le statut est incertain
      (même calcul que le sweeper : dernière transition de statut).
    - exceeds_threshold : le seuil d'alerte est dépassé.
    - alerted / last_alert_at / needs_alert : statut de l'alerte envoyée par le
      sweeper (jamais alerté, alerté à date, ou à alerter au prochain passage).
    - reminders_sent : nombre de RAPPELS déjà envoyés par le sweeper pour ce
      décaissement (0 = première alerte seule ; incrémenté à chaque rappel
      périodique tant que le blocage dure).
    Tri du plus bloqué au moins bloqué.

    Returns:
        dict: {count, threshold_hours, paydunya_circuit, payouts: [{payment_id,
        job_id, amount, blocked_since, blocked_seconds, blocked_hours,
        exceeds_threshold, alerted, last_alert_at, reminders_sent, …}]}.
    """
    now = datetime.now(timezone.utc)
    threshold = timedelta(hours=PAYOUT_ALERT_THRESHOLD_HOURS)

    payments = await db.payments.find({
        "payout_status": {"$in": list(_STUCK_PAYOUT_STATUSES)},
    }).to_list(length=500)

    items = []
    for payment in payments:
        stuck_for = _stuck_for(payment, now)
        if stuck_for is None:
            blocked_seconds = None
            blocked_hours = None
        else:
            blocked_seconds = int(stuck_for.total_seconds())
            blocked_hours = int(blocked_seconds // 3600)

        exceeds_threshold = bool(stuck_for is not None and stuck_for >= threshold)
        last_alert_at = payment.get("owner_payout_alerted_at")

        items.append({
            "payment_id": payment.get("id"),
            "job_id": payment.get("job_id"),
            "amount": int(payment.get("amount", 0) or 0),
            "payout_kind": payment.get("payout_kind"),
            "payout_status": payment.get("payout_status"),
            "payer_id": payment.get("payer_id"),
            "receiver_id": payment.get("receiver_id"),
            "disburse_token_present": bool(payment.get("disburse_token")),
            "blocked_since": payment.get("updated_at") or payment.get("created_at"),
            "blocked_seconds": blocked_seconds,
            "blocked_hours": blocked_hours,
            "exceeds_threshold": exceeds_threshold,
            "alerted": bool(last_alert_at),
            "last_alert_at": last_alert_at,
            "needs_alert": bool(exceeds_threshold and not last_alert_at),
            "reminders_sent": int(payment.get("owner_payout_reminders_sent", 0) or 0),
            "created_at": payment.get("created_at"),
            "updated_at": payment.get("updated_at"),
        })

    # Du plus bloqué au moins bloqué (blocage inconnu en dernier).
    items.sort(
        key=lambda item: (item["blocked_seconds"] if item["blocked_seconds"] is not None else -1),
        reverse=True,
    )

    # État du circuit breaker GLOBAL PayDunya : si le circuit est OUVERT
    # (échecs réseau consécutifs), TOUS les statuts ci-dessus sont simplement
    # « non re-vérifiés » — l'owner doit le savoir pour interpréter la liste.
    # Refresh préalable : partage inter-workers (un autre worker a pu ouvrir
    # le circuit) — l'endpoint montre l'état le plus récent, pas celui local.
    await refresh_paydunya_circuit_from_db()
    circuit = paydunya_circuit_state()

    return {
        "count": len(items),
        "threshold_hours": PAYOUT_ALERT_THRESHOLD_HOURS,
        "payouts": items,
        "paydunya_circuit": {
            "state": circuit["state"],
            "consecutive_failures": circuit["consecutive_failures"],
            "failure_threshold": circuit["failure_threshold"],
            "remaining_cooldown_seconds": int(circuit["remaining_cooldown_seconds"]),
        },
    }


# Champs du journal métier rendus au propriétaire : allowlist, jamais le document brut.
# `details` n'y est que depuis le litige tracé, et n'y porte que des clés
# ÉNUMÉRÉES par `kojo_business_events.DETAILS_AUTORISES` (decision, paiement,
# echeance, position) : ni le motif ni la note de réponse, écrits par une
# partie, n'entrent dans le journal.
_CHAMPS_EVENEMENT_METIER = (
    "id", "type", "cle", "user_id", "job_id", "proposal_id", "payment_id", "details", "created_at",
)

# Champs du litige rendus au propriétaire : allowlist, comme partout ailleurs.
_CHAMPS_LITIGE = (
    "state", "reason", "opened_by", "opened_by_role", "opened_at",
    "decision_deadline_at", "expired_at", "resolved_at", "decision",
    "decision_note", "decided_by", "payment_outcome", "withdrawn_at",
    # Décision TENTÉE dont le paiement a échoué : le CODE d'échec et l'instant
    # de l'essai, sans quoi la décision serait relue comme jamais tentée.
    "decision_failure", "decision_attempted_at",
    # La version de l'AUTRE partie : l'arbitre tranche sur deux versions, donc
    # il doit pouvoir les lire toutes les deux ici, sans ouvrir la fiche.
    "response",
)


class ChangementEtatCompte(BaseModel):
    """Corps de `POST /owner/accounts/{id}/state`.

    Trois états, pas quatre : `actif` réactive, `restreint` ferme les écritures,
    `banni` ferme l'accès. Le motif est FACULTATIF dans le modèle parce que la
    réactivation n'a rien à justifier ; il est EXIGÉ pour les deux autres par
    `kojo_comptes_admin.changer_etat`, qui rend un 400 nommant la longueur
    minimale au lieu de réparer une sanction muette.
    """
    etat: Literal["actif", "restreint", "banni"]
    motif: Optional[str] = Field(default=None, max_length=500)


class OwnerDisputeDecision(BaseModel):
    """Corps de `POST /owner/missions/{job_id}/litige/decision`.

    Deux décisions, pas trois : verser le travailleur ou rembourser le client.
    Un partage exigerait de couper un décaissement, ce que PayDunya ne fait pas
    — l'inventer produirait une décision inapplicable. La note est EXIGÉE
    (10 caractères) : c'est ce que les deux parties liront pour comprendre,
    et une décision muette relancerait le désaccord qu'elle prétend clore.
    """
    decision: Literal["release_worker", "refund_client"]
    note: str = Field(min_length=10, max_length=1000)


def _evenement_public(evenement: dict) -> dict:
    """Un jalon du journal, réduit à l'allowlist — `details` SEULEMENT s'il existe.

    L'écriture ne pose `details` que lorsqu'il y a quelque chose à dire (les
    jalons d'avant le litige gardent exactement leur forme) ; la lecture doit
    dire la même chose, sinon une clé `null` apparaîtrait sur des événements
    qui n'ont jamais eu de détail, et l'écran devrait distinguer « pas de
    détail » de « détail vide ».
    """
    entree = {champ: evenement.get(champ) for champ in _CHAMPS_EVENEMENT_METIER}
    if entree.get("details") is None:
        entree.pop("details", None)
    return entree


def _litige_public(job: dict) -> dict:
    dispute = job.get("dispute") or {}
    return {
        "job_id": job.get("id") or job.get("job_id"),
        "title": job.get("title"),
        "status": job.get("status"),
        "client_id": job.get("client_id"),
        "worker_id": job.get("assigned_worker_id"),
        "litige": {champ: dispute.get(champ) for champ in _CHAMPS_LITIGE},
    }


@router.get("/owner/missions/{job_id}/evenements")
async def get_mission_business_events(job_id: str, owner_user = Depends(verify_owner_access)):
    """Journal des événements métier d'une mission, par ordre chronologique.

    PROPRIÉTAIRE UNIQUEMENT, lecture seule. Tous les jalons de
    `kojo_business_events` y passent : les quatre d'avant le séquestre (mission
    créée, proposition acceptée, paiement confirmé, mission terminée), les trois
    du séquestre à deux temps et les cinq du litige tracé. `details` ne porte
    que des clés ÉNUMÉRÉES (decision, paiement, echeance, position) : ni le motif
    ni la note de réponse n'y sont — un journal append-only relu et exporté ne
    doit pas exposer une prose écrite par une partie. La note se lit à sa source
    (`GET /owner/missions/{job_id}/litige`), que l'écran du propriétaire pose
    sous le jalon `mission_dispute_answered`. Une mission sans événement renvoie
    une liste vide.

    Returns:
        Dict à trois clés : `job_id` (mission demandée), `count` (nombre de jalons
        rendus) et `evenements` (liste des jalons, du plus ancien au plus récent),
        chaque entrée réduite à l'allowlist des champs publiés — jamais le
        document brut.
    """
    evenements = await db.business_events.find(
        {"job_id": job_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(length=200)

    return {
        "job_id": job_id,
        "count": len(evenements),
        "evenements": [_evenement_public(evenement) for evenement in evenements],
    }


@router.get("/owner/litiges")
async def list_disputes(
    etat: Optional[str] = Query(None, pattern="^(open|expired|decision_failed|resolved|withdrawn)$"),
    limite: int = Query(100, ge=1, le=500),
    owner_user = Depends(verify_owner_access),
):
    """File d'arbitrage : les litiges à trancher, échéance la plus proche d'abord.

    C'est le remède à la cécité de l'échéance : un litige dont la fenêtre se
    referme demain doit se lire AVANT un litige déjà refermé, et le propriétaire
    ne peut pas dépendre d'un identifiant de mission qu'il n'a pas sous les yeux.
    Une décision DONT LE PAIEMENT A ÉCHOUÉ (`decision_failed`) y figure aussi,
    en tête : elle a un remède nommé (`decision_failure`) et l'argent reste
    gelé tant qu'elle n'est pas relancée.

    Returns:
        dict: {count, etats, fidelite (jours de la fenêtre), litiges} — chaque
        entrée réduite à l'allowlist des champs du désaccord, jamais le document
        brut de la mission.
    """
    etats = [etat] if etat else [litiges.ECHEC, litiges.OUVERT, litiges.EXPIRE]
    jobs = await litiges.file_arbitrage(etats=etats, limite=limite)
    return {
        "count": len(jobs),
        "etats": etats,
        "fenetre_jours": LITIGE_DECISION_DAYS,
        "litiges": [_litige_public(job) for job in jobs],
    }


@router.get("/owner/litiges/mesures")
async def get_dispute_measures(owner_user = Depends(verify_owner_access)):
    """Mesures de l'ARBITRAGE, sur l'historique des litiges.

    PROPRIÉTAIRE UNIQUEMENT. La file dit ce qui reste à trancher ; ces chiffres
    disent comment l'arbitrage se passe : réponses reçues AVANT l'échéance,
    décisions prises SANS réponse (l'arbitre a tranché sur une seule version),
    et délai entre la réponse et la décision.

    Les taux valent `null` sous le plancher : un pourcentage sur trois litiges
    n'est pas une mesure. `fenetres` rejoue les mêmes chiffres sur 30 et 90
    jours, pour distinguer l'état actuel de l'historique.

    Returns:
        dict: {mesure_le, plancher, depuis, litiges: {total, lus, tronque},
        etats, reponse: {avec_reponse, avant_echeance, apres_echeance,
        echeance_illisible, taux_avant_echeance}, tranches: {total,
        sans_reponse, avec_reponse, taux_sans_reponse},
        delai_reponse_decision: {n, mediane_heures, moyenne_heures,
        max_heures, incoherents}, fenetres: [{fenetre_jours, depuis,
        decisions: {...}, reponses: {...}, delai_reponse_decision: {...}}]}.
    """
    return await litiges.mesures_arbitrage()


@router.get("/owner/relances/mesures")
async def get_relance_measures(owner_user = Depends(verify_owner_access)):
    """Mesures de la RELANCE CLIENT, sur les missions relancées.

    PROPRIÉTAIRE UNIQUEMENT. Les compteurs de `/metrics` disent combien de
    relances sont parties ; ils ne disent pas si elles ont servi. Ces chiffres
    répondent à la seule question qui compte : parmi les missions relancées de
    la fenêtre, combien ont reçu au moins une candidature APRÈS la relance, et
    après combien de temps.

    Le taux vaut `null` sous `plancher` (un pourcentage sur trois envois est du
    bruit) et sous une lecture tronquée — on ne sait alors plus quelles missions
    ont reçu une candidature. Les exclusions sont comptées, jamais recasées : un
    marqueur illisible ou futur, une candidature antérieure à la relance (la
    donnée se contredit) et une candidature sans date lisible ont chacun leur
    compteur.

    Returns:
        dict: {mesure_le, fenetre_jours, depuis, plancher, relances: {total,
        lues, tronque}, mesurees, avec_candidature, sans_candidature,
        taux_candidature, delai_candidature: {n, mediane_heures,
        moyenne_heures, max_heures}, exclusions: {...}}.
    """
    return await mesure_relances()


@router.get("/owner/missions/{job_id}/litige")
async def get_mission_dispute(job_id: str, owner_user = Depends(verify_owner_access)):
    """Litige courant d'une mission (lecture), ou `litige: null` s'il n'y en a pas.

    Returns:
        dict: {job_id, title, status, client_id, worker_id, litige}.
    """
    job = await litiges.litiges_du_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable")
    return _litige_public(job)


@router.post("/owner/missions/{job_id}/litige/decision")
async def decide_mission_dispute(
    job_id: str,
    payload: OwnerDisputeDecision,
    owner_user = Depends(verify_owner_access),
):
    """TRANCHER un litige : verser le travailleur, ou rembourser le client.

    L'argent ne bouge que par les propriétaires uniques de chaque chemin
    (`liberer_sequestre` pour le versement, `execute_paydunya_refund` pour le
    remboursement) : cette route décide, elle ne paie pas elle-même.

    Quand le paiement échoue, `dispute_state` vaut `decision_failed`, `echec`
    nomme le code, `relance` vaut True et le message dit l'action à faire : le
    litige n'est PAS refermé.

    Returns:
        dict: {message, decision, payment_outcome, dispute_state, echec,
        relance} — les deux derniers ne sont rendus que sur un échec.
    """
    job = await litiges.litiges_du_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable")
    return await litiges.decider_litige(
        job,
        # `verify_owner_access` rend le DOCUMENT du compte (dict), pas un
        # modèle : l'identifiant se lit comme partout ailleurs dans ce routeur.
        owner_id=owner_user["id"],
        decision=payload.decision,
        note=payload.note,
    )


# ── Adresses email retenues (rebonds définitifs, plaintes) ───────────────────
#
# Ces deux routes sont la contrepartie de l'ingestion des webhooks : retenir
# une adresse est irréversible du point de vue de l'apprenant, donc il faut
# pouvoir (1) VOIR ce qui est retenu et pourquoi, et (2) le LEVER sans écrire
# en base de production à la main — un correctif appliqué à la main ne laisse
# aucune trace de qui l'a décidé ni de quand.
_CHAMPS_SUPPRESSION = (
    "email",
    "motif",
    "type_rebond",
    "sous_type",
    "message",
    "premier_fait_le",
    "dernier_fait_le",
    "faits",
    "fournisseur",
)


class EmailSuppressionLever(BaseModel):
    """L'adresse à rendre joignable. Un corps JSON plutôt qu'un segment d'URL :
    une adresse email contient `@` et `+`, que le chemin devrait encoder (et
    qu'un encodage approximatif transformerait en une AUTRE adresse)."""

    email: str = Field(min_length=3, max_length=320)


@router.get("/owner/email-suppressions")
async def get_email_suppressions(
    limite: int = Query(200, ge=1, le=1000), owner_user = Depends(verify_owner_access)
):
    """Adresses email auxquelles le produit n'écrit plus, et pourquoi.

    PROPRIÉTAIRE UNIQUEMENT. Une adresse est retenue après un rebond DÉFINITIF
    (la boîte n'existe pas) ou une plainte (le destinataire nous a signalés
    comme indésirables) ; les rebonds non définitifs n'y figurent pas — ils
    alertent, mais la boîte existe.

    L'adresse est rendue ENTIÈRE (et non masquée) : c'est le propriétaire, il
    doit pouvoir décider, et il doit pouvoir la recopier pour la lever. Le
    `message` du fournisseur l'est aussi : c'est le seul élément qui explique le
    classement, il est borné à l'écriture, et il est déjà passé par la boîte de
    qui reçoit ces alertes.

    Returns:
        dict: {total, count, tronque, suppressions} — `tronque` dit si la borne
        demandée a coupé la vue (une vue bornée qui se taisait ferait croire à
        une liste complète).
    """
    documents, total = await etat_des_suppressions(limite)

    return {
        "total": total,
        "count": len(documents),
        "tronque": total > len(documents),
        "suppressions": [
            {champ: document.get(champ) for champ in _CHAMPS_SUPPRESSION}
            for document in documents
        ],
    }


@router.post("/owner/email-suppressions/lever")
async def lever_email_suppression(
    payload: EmailSuppressionLever, owner_user = Depends(verify_owner_access)
):
    """Rend une adresse joignable : les emails repartent vers elle.

    PROPRIÉTAIRE UNIQUEMENT, et c'est une DÉCISION : rien ne lève une
    suppression automatiquement (une horloge qui rouvrirait une adresse morte
    remettrait le produit à écrire dans le vide). Sert les cas réels — boîte
    recréée, adresse changée, fait mal classé.

    `levee` vaut False quand l'adresse n'était PAS retenue : c'est un FAIT, pas
    un échec — l'objectif (« cette adresse est joignable ») est atteint, et le
    dire vaut mieux qu'un 404 qu'on relit comme une panne.

    Returns:
        dict: {email, levee} — `email` est la forme NORMALISÉE (minuscules,
        sans étiquette `+tag`) sur laquelle la décision a porté.
    """
    adresse = adresse_boite(payload.email)
    levee = await lever_suppression(adresse)
    if levee:
        logger.info("✅ Adresse email rendue joignable par le propriétaire : %s", adresse)
    return {"email": adresse, "levee": levee}


# ══ MODÉRATION DES COMPTES ══════════════════════════════════════════════════
#
# Ce que le propriétaire ne pouvait pas faire : VOIR ses comptes, et ARRÊTER un
# compte. Il avait des tuiles de gains, une file de litiges et des paliers — des
# chiffres sur la place de marché, pas un seul nom. Un compte qui arnaque ne se
# corrige pas depuis une courbe. Les cinq routes ci-dessous ouvrent le
# répertoire, trois états de compte et la lecture des conversations, et rien de
# plus : ni suppression, ni mot de passe, ni changement de rôle.


@router.get("/owner/accounts")
async def list_owner_accounts(
    recherche: Optional[str] = Query(None, max_length=80),
    role: Optional[str] = Query(None, pattern="^(client|worker|owner|support)$"),
    etat: Optional[str] = Query(None, pattern="^(actif|restreint|banni)$"),
    pays: Optional[str] = Query(None, max_length=40),
    limite: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    owner_user = Depends(verify_owner_access),
):
    """Le répertoire des comptes Kojo — PROPRIÉTAIRE UNIQUEMENT.

    Recherche (nom, email, téléphone, identifiant, code de parrainage), rôle
    (`client`, `worker`, `owner`, `support`), état (`actif`, `restreint`,
    `banni`) et pays. Les comptes SUPPRIMÉS sont exclus de la liste (ils sont
    anonymisés, et un compte supprimé n'a plus d'accès à fermer) mais leur
    nombre reste publié dans `mesures.supprimes`.

    `mesures` porte les totaux lus, pas une seconde vérité : le compte des
    bannis et la liste filtrée viennent de la MÊME lecture, donc une puce
    « bannis (3) » ne peut pas désigner une liste vide.

    Returns:
        dict: {count, total, offset, limite, tronque, comptes, mesures}.
        `tronque` dit que la lecture bornée a coupé la vue — un répertoire
        incomplet qui se tait ferait croire qu'il n'y a que ces comptes.
    """
    return await comptes.lister_comptes(
        recherche=comptes.normaliser_recherche(recherche),
        role=role,
        etat=etat,
        pays=pays,
        limite=limite,
        offset=offset,
    )


@router.get("/owner/accounts/{user_id}")
async def get_owner_account(user_id: str, owner_user = Depends(verify_owner_access)):
    """Un compte, son activité COMPTÉE et l'historique de ses décisions.

    PROPRIÉTAIRE UNIQUEMENT. Les quatre compteurs de `activite` sont calculés
    sur les collections qui les possèdent (missions, propositions, messages,
    avis) : l'écran ne déduit pas « ce compte est actif » d'une date de
    création.

    Returns:
        dict: le compte (allowlist) + `activite` + `historique`.
    """
    compte = await db.users.find_one(
        {**identifiant_query(user_id)}, {"password_hash": 0}
    )
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return await comptes.detail_compte(compte)


@router.post("/owner/accounts/{user_id}/state")
async def set_owner_account_state(
    user_id: str,
    payload: ChangementEtatCompte,
    owner_user = Depends(verify_owner_access),
):
    """Restreindre, bannir ou réactiver un compte — PROPRIÉTAIRE UNIQUEMENT.

    Le refus est NOMMÉ et ne répare rien :
      * 400 — motif absent ou trop court pour restreindre/bannir ;
      * 409 — compte propriétaire (il ne se modère pas lui-même) ou compte
              supprimé (il n'a plus d'accès à fermer) ;
      * 404 — identifiant inconnu.

    L'état est relu APRÈS écriture et rendu tel qu'il est en base : une réponse
    qui recopierait la demande ferait croire à une décision appliquée alors
    qu'une écriture peut échouer sans lever.

    Returns:
        dict: {message, compte} — `compte` est le document RÉELLEMENT relu
        (`account_state`, motif, date, historique).
    """
    compte = await db.users.find_one(
        {**identifiant_query(user_id)}, {"password_hash": 0}
    )
    if not compte:
        raise HTTPException(status_code=404, detail="Compte introuvable")

    decision = await comptes.changer_etat(
        compte,
        etat=payload.etat,
        motif=payload.motif,
        auteur=owner_user,
    )
    logger.info(
        "🛡️ Compte %s → %s par le propriétaire (motif : %s)",
        decision["id"], decision["etat"], decision["motif"],
    )

    relu = await db.users.find_one({**identifiant_query(user_id)}, {"password_hash": 0})
    return {
        "message": {
            "actif": "Compte réactivé.",
            "restreint": "Compte restreint : les écritures sont fermées.",
            "banni": "Compte banni : l'accès est fermé.",
        }[decision["etat"]],
        "compte": await comptes.detail_compte(relu or compte),
    }


@router.get("/owner/conversations")
async def list_owner_conversations(
    recherche: Optional[str] = Query(None, max_length=80),
    owner_user = Depends(verify_owner_access),
):
    """Les conversations de la plateforme — PROPRIÉTAIRE UNIQUEMENT, lecture.

    Chaque entrée nomme ses DEUX participants (nom, email, rôle) : une
    conversation sans nom ne se modère pas. `dernier_message` est l'aperçu de
    ce qui s'y dit, pas le fil entier — le fil s'ouvre à la demande.

    Returns:
        dict: {total, count, tronque, conversations}.
    """
    return await comptes.lister_conversations(comptes.normaliser_recherche(recherche))


@router.get("/owner/conversations/{conversation_id}")
async def get_owner_conversation(
    conversation_id: str,
    owner_user = Depends(verify_owner_access),
):
    """Le fil d'une conversation — PROPRIÉTAIRE UNIQUEMENT, LECTURE SEULE.

    Cette route ne pose JAMAIS `read` : ouvrir un fil en modération ne doit pas
    effacer l'indicateur de non-lus des participants. `lu_marque: false` est
    publié pour que l'écran puisse l'affirmer au lieu de le laisser croire.

    La lecture est journalisée (identifiant du fil et identifiant du
    propriétaire, jamais le contenu) : un accès à la vie privée des gens doit
    laisser une trace exploitable, et le contenu d'un message n'a rien à faire
    dans un journal d'exploitation.

    Returns:
        dict: {conversation_id, participants, count, messages, lecture,
        lu_marque}.
    """
    fil = await comptes.fil_de_conversation(conversation_id)
    logger.info(
        "👁️ Lecture de modération du fil %s par le propriétaire %s (%d message(s))",
        conversation_id, owner_user.get("id"), fil["count"],
    )
    return fil
