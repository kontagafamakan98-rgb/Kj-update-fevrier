# -*- coding: utf-8 -*-
"""Parrainage : code, filleuls, application du code, retrait du solde.

Le retrait est un DÉCAISSEMENT PayDunya (même mécanisme que les versements
travailleurs), avec son verrou anti double-retrait et un solde décrémenté à la
CONFIRMATION : le tout forme une seule histoire, qui se lit d'un bloc. Le code
de parrainage est généré ici, à côté des seules routes qui le lisent.
"""
import asyncio

import secrets

import string

import uuid

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from kojo_core import db

from kojo_models import NotificationType, User, UserType

from kojo_settings import (
    FRONTEND_APP_URL,
    REFERRAL_FILLEUL_REWARD,
    REFERRAL_SPONSOR_REWARD,
    logger,

)

from kojo_core import get_current_user

from kojo_shared import apply_referral_payout_confirmed, notify_user_localized

from kojo_payments import (
    build_disburse_callback_url,
    create_paydunya_disburse_invoice,
    get_mobile_money_account,
    get_paydunya_withdraw_mode,
    maj_sequestre,
    strip_country_code_for_disburse,
    submit_paydunya_disburse_invoice,

)

router = APIRouter()


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
    ainsi que le solde de récompense de parrainage et son historique.

    Le parrainage est réservé aux TRAVAILLEURS (pas aux clients).

    Returns:
        dict: {referral_code, invite_url, reward_balance,
        reward_history, sponsor_reward, filleul_reward, withdraw_minimum}.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Le parrainage est réservé aux travailleurs")
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
        "withdraw_minimum": 200,
    }


@router.get("/users/referral/filleuls")
async def get_referral_filleuls(current_user: User = Depends(get_current_user)):
    """Liste les comptes créés via le code de parrainage de l'utilisateur
    (les filleuls). Chaque entrée contient les infos publiques du filleul et
    son éventuelle contribution au parrainage (récompenses déjà générées).

    Réservé aux travailleurs (le parrainage ne concerne pas les clients).

    Returns:
        dict: {filleuls: [{infos publiques du filleul, récompenses générées}]}.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Le parrainage est réservé aux travailleurs")
    code = await _ensure_referral_code(current_user.id)

    filleuls = []
    cursor = db.users.find(
        {"referred_by": code},
        {
            "_id": 0,
            "id": 1,
            "first_name": 1,
            "last_name": 1,
            "profile_photo": 1,
            "created_at": 1,
            "referral_reward_balance": 1,
            "referral_first_job_rewarded": 1,
        },
    )
    async for f in cursor:
        filleuls.append({
            "id": f.get("id"),
            "first_name": f.get("first_name"),
            "last_name": f.get("last_name"),
            "profile_photo": f.get("profile_photo"),
            "created_at": f.get("created_at"),
            "completed_first_job": bool(f.get("referral_first_job_rewarded")),
            "reward_earned": float(f.get("referral_reward_balance") or 0),
        })

    # Plus récents d'abord
    filleuls.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return {"filleuls": filleuls}


@router.post("/users/referral/apply")
async def apply_referral(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """Enregistre le code du parrain saisi à l'inscription (référence croisée,
    pas de crédit monétaire automatique). Réservé aux travailleurs : un
    client ne peut ni parrainer ni être parrainé (il ne réalise pas de
    mission, donc aucune récompense ne peut être débloquée).

    Returns:
        dict: {message, referred_by} (code du parrain appliqué).
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Le parrainage est réservé aux travailleurs")
    code = str((payload or {}).get("code") or '').strip().upper()
    if not code:
        raise HTTPException(status_code=422, detail="Code de parrainage requis")

    sponsor = await db.users.find_one(
        {"referral_code": code}, {"id": 1, "user_type": 1, "referred_by": 1}
    )
    if not sponsor:
        raise HTTPException(status_code=404, detail="Code de parrainage invalide")
    if sponsor.get("user_type") != UserType.WORKER.value:
        raise HTTPException(status_code=400, detail="Ce code de parrainage n'est pas valide")
    if sponsor["id"] == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous parrainer vous-même")
    # Un travailleur déjà parrainé ne peut pas servir de parrain à son tour :
    # son code n'est plus applicable (il continue à gagner ses récompenses
    # en tant que filleul, mais ne peut plus en générer).
    if sponsor.get("referred_by"):
        raise HTTPException(status_code=400, detail="Ce code de parrainage n'est plus actif : son propriétaire a déjà été parrainé")

    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"referred_by": code, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Code de parrainage appliqué", "referred_by": code}


# ---------------------------------------------------------------------------
# Retrait du solde de récompense de parrainage (décaissement PayDunya)
# ---------------------------------------------------------------------------

# Minimum PayDunya pour un décaissement (même règle que la collecte).
REFERRAL_WITHDRAW_MINIMUM = 200.0


async def _release_referral_withdraw_lock(user_id: str) -> None:
    """Lève le verrou anti double-retrait (referral_withdrawal_in_progress).

    À appeler sur TOUT chemin terminal du retrait qui n'a pas (ou plus)
    d'opération en cours chez PayDunya : échec sûr (get-invoice refusé,
    réponse négative au submit) ou succès. Le verrou ne reste posé que tant
    qu'un décaissement est en attente de confirmation (releasing) — c'est
    l'IPN ou le check-status qui le lève alors via
    apply_referral_payout_confirmed (kojo_shared).
    """
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"referral_withdrawal_in_progress": False, "updated_at": datetime.now(timezone.utc)}},
    )


@router.post("/users/referral/withdraw")
async def withdraw_referral_rewards(current_user: User = Depends(get_current_user)):
    """Retire le solde de récompenses de parrainage (bonus + récompenses)
    vers le compte mobile money du travailleur, via le décaissement PayDunya
    (même mécanisme que les versements travailleurs).

    - Réservé aux travailleurs.
    - Solde minimum : 200 FCFA (minimum PayDunya).
    - Un seul retrait en cours à la fois (verrou CAS anti double-décaissement,
      concurrent ou en attente de confirmation PayDunya).
    - Le solde n'est décrémenté qu'à la CONFIRMATION du décaissement (submit
      "success" ou IPN/check-status ultérieur) : en cas d'échec le solde
      reste intact et le travailleur peut réessayer.

    Returns:
        dict: {status (released | releasing), payment_id, reward_balance,
        message}.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Le retrait des récompenses est réservé aux travailleurs")

    user = await db.users.find_one({"id": current_user.id})
    balance = float((user or {}).get("referral_reward_balance") or 0)

    if balance < REFERRAL_WITHDRAW_MINIMUM:
        raise HTTPException(
            status_code=400,
            detail=f"Solde insuffisant : le retrait minimum est de {int(REFERRAL_WITHDRAW_MINIMUM)} FCFA (solde : {int(balance)} FCFA)",
        )

    # Verrou CAS anti double-retrait (même esprit que le verrou "releasing"
    # des versements travailleurs) : posé atomiquement, levé uniquement au
    # statut terminal (released via apply_referral_payout_confirmed, ou
    # release_failed ci-dessous). Tant qu'un retrait est en cours ou en
    # attente de confirmation PayDunya, un nouveau retrait est refusé.
    lock = await db.users.update_one(
        {"id": current_user.id, "referral_withdrawal_in_progress": {"$ne": True}},
        {"$set": {"referral_withdrawal_in_progress": True, "updated_at": datetime.now(timezone.utc)}},
    )
    if lock.matched_count == 0:
        raise HTTPException(status_code=409, detail="Un retrait de récompenses est déjà en cours, réessayez dans un instant")

    withdraw_method, withdraw_phone = get_mobile_money_account((user or {}).get("payment_accounts"))
    if not withdraw_method or not withdraw_phone:
        await _release_referral_withdraw_lock(current_user.id)
        raise HTTPException(
            status_code=400,
            detail="Aucun compte Orange Money ou Wave configuré : ajoutez un moyen de paiement pour retirer vos récompenses",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    payment_id = str(uuid.uuid4())
    withdraw_mode = get_paydunya_withdraw_mode(withdraw_method, (user or {}).get("country"))
    account_alias = strip_country_code_for_disburse(withdraw_phone)
    amount = int(balance)

    # Préparation du décaissement. Un échec EXPLICITE ici (get-invoice refusé)
    # est sûr : PayDunya n'a rien exécuté, le solde reste intact.
    try:
        invoice = create_paydunya_disburse_invoice(
            account_alias=account_alias,
            amount=amount,
            withdraw_mode=withdraw_mode,
            callback_url=build_disburse_callback_url(),
        )
        disburse_token = invoice.get("disburse_token")
    except HTTPException as exc:
        # Échec SÛR : PayDunya n'a rien exécuté → on lève le verrou pour que
        # le travailleur puisse réessayer (le solde est intact).
        await _release_referral_withdraw_lock(current_user.id)
        raise HTTPException(status_code=502, detail=f"Retrait impossible pour le moment : {exc.detail}")
    except Exception as exc:
        logger.error(f"⚠️ Erreur inattendue lors de la préparation du retrait de récompenses: {exc}")
        await _release_referral_withdraw_lock(current_user.id)
        raise HTTPException(status_code=502, detail="Retrait impossible pour le moment, réessayez plus tard")

    if not disburse_token:
        await _release_referral_withdraw_lock(current_user.id)
        raise HTTPException(status_code=502, detail="Retrait impossible pour le moment : réponse PayDunya invalide")

    # Enregistrement du retrait AVANT le submit : si le submit lève (timeout
    # réseau), le retrait reste identifiable et confirmable via l'IPN ou un
    # check-status (même convention que les versements travailleurs).
    await db.payments.insert_one({
        "id": payment_id,
        "job_id": "referral_withdrawal",
        "payer_id": current_user.id,
        "receiver_id": current_user.id,
        "amount": amount,
        "payment_method": withdraw_method,
        "status": "completed",
        "country": (user or {}).get("country"),
        "provider": "paydunya",
        "provider_channel": withdraw_mode,
        "payout_kind": "referral",
        "payout_status": "releasing",
        "disburse_token": disburse_token,
        "created_at": now_iso,
        "updated_at": now_iso,
    })

    try:
        submit_result = submit_paydunya_disburse_invoice(disburse_token, disburse_id=f"referral_{payment_id}")
    except Exception as exc:
        # Réponse INCERTAINE (timeout réseau…) : PayDunya a peut-être exécuté
        # le décaissement. On reste "releasing" (confirmation par l'IPN ou un
        # check-status) au lieu de marquer un échec définitif : un échec
        # permettrait de relancer → risque de DOUBLE retrait.
        logger.error(f"⚠️ Réponse incertaine du submit PayDunya (retrait récompenses): {exc}")
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {
                "disburse_error": f"Réponse incertaine du submit: {exc}",
                "updated_at": now_iso,
            }},
        )
        asyncio.create_task(notify_user_localized(
            user_id=current_user.id,
            key="referral_withdraw_pending",
            notif_type=NotificationType.GENERAL,
            amount=amount,
        ))
        return {
            "status": "releasing",
            "payment_id": payment_id,
            "reward_balance": balance,
            "message": "Retrait en cours de traitement, vous serez notifié à la confirmation.",
        }

    provider_status = str(
        submit_result.get("status")
        or ("success" if str(submit_result.get("response_code")) == "00" else "failed")
    ).strip().lower()

    if provider_status == "success":
        # Décaissement confirmé : on marque le statut, puis on applique la
        # confirmation via le point unique de vérité (kojo_shared.
        # apply_referral_payout_confirmed) qui décrémente le solde, trace le
        # retrait, notifie ET lève le verrou anti double-retrait
        # (referral_withdrawal_in_progress).
        await db.payments.update_one(
            {"id": payment_id},
            maj_sequestre("released", {"disburse_provider_response": submit_result, "updated_at": datetime.now(timezone.utc).isoformat()}),
        )
        await apply_referral_payout_confirmed({"id": payment_id})
        return {
            "status": "released",
            "payment_id": payment_id,
            "reward_balance": 0.0,
            "message": f"Retrait de {amount} FCFA confirmé : le montant a été envoyé sur votre compte mobile money.",
        }

    if provider_status == "pending":
        await db.payments.update_one(
            {"id": payment_id},
            maj_sequestre("releasing", {"disburse_provider_response": submit_result}),
        )
        asyncio.create_task(notify_user_localized(
            user_id=current_user.id,
            key="referral_withdraw_pending",
            notif_type=NotificationType.GENERAL,
            amount=amount,
        ))
        return {
            "status": "releasing",
            "payment_id": payment_id,
            "reward_balance": balance,
            "message": "Retrait en cours de traitement, vous serez notifié à la confirmation.",
        }

    # Échec explicite : PayDunya n'a rien exécuté, solde intact, réessayable.
    # On marque le statut terminal, puis on applique l'issue via le point
    # unique de vérité (kojo_shared.apply_referral_payout_confirmed) qui
    # notifie l'échec ET lève le verrou anti double-retrait (idempotent via
    # referral_lock_released) — même chemin que l'IPN / le check-status.
    await db.payments.update_one(
        {"id": payment_id},
        maj_sequestre("release_failed", {"payout_failure_reason": submit_result.get("response_text") or "Échec du retrait PayDunya", "disburse_provider_response": submit_result, "updated_at": datetime.now(timezone.utc).isoformat()}),
    )
    await apply_referral_payout_confirmed({"id": payment_id})
    return {
        "status": "release_failed",
        "payment_id": payment_id,
        "reward_balance": balance,
        "message": "Le retrait a échoué : votre solde est intact, vous pouvez réessayer.",
    }
