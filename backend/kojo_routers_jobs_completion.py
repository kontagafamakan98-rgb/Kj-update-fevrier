# -*- coding: utf-8 -*-
"""Clôture d'une mission (`POST /jobs/{id}/complete`) : versement et bonus.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/surface/route_surface_jobs.json`). L'attribution du bonus de première
mission vit ici : elle n'a qu'un site d'appel, la clôture.
"""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

import kojo_job_effects as effets
from kojo_core import db, get_current_user
from kojo_models import Job, JobStatus, Message, NotificationType, User
from kojo_payments import (
    build_disburse_callback_url, get_paydunya_withdraw_mode, strip_country_code_for_disburse,
)
from kojo_settings import (
    OWNER_EMAIL,
    REFERRAL_FILLEUL_REWARD,
    REFERRAL_SPONSOR_REWARD,
    logger,
)
from kojo_identifiants import dump_stable, identifiant_query, identifiant_job_query

router = APIRouter()

async def _maybe_award_first_job_referral_reward(worker_id: str, job_id: str, job_title: str) -> None:
    """Crédite la récompense de parrainage quand le filleul termine sa PREMIÈRE
    mission : le parrain reçoit REFERRAL_SPONSOR_REWARD et le filleul reçoit
    REFERRAL_FILLEUL_REWARD (FCFA).

    Idempotent : un compte ne touche sa récompense qu'une seule fois (le flag
    referral_first_job_rewarded est posé à la première mission terminée), et
    un code invalide/absent est ignoré silencieusement (non bloquant).
    """
    try:
        worker = await db.users.find_one({**identifiant_query(worker_id)}, {"referred_by": 1, "referral_first_job_rewarded": 1})
        if not worker:
            return
        if worker.get("referral_first_job_rewarded"):
            return
        ref_code = str((worker.get("referred_by") or '').strip()).upper()
        if not ref_code:
            return

        # Le parrainage est réservé aux travailleurs : un parrain client ne
        # peut pas recevoir de récompense (le code n'est d'ailleurs plus
        # applicable à un compte client à l'inscription).
        # Un travailleur déjà parrainé ne peut pas servir de parrain à son
        # tour : son code n'est plus applicable, donc aucune récompense de
        # parrainage pour lui.
        sponsor = await db.users.find_one(
            {"referral_code": ref_code}, {"id": 1, "user_type": 1, "referred_by": 1}
        )
        if not sponsor or sponsor.get("id") == worker_id:
            return
        if sponsor.get("user_type") != "worker":
            return
        if sponsor.get("referred_by"):
            return

        now = datetime.now(timezone.utc)
        reward_record = {
            "type": "first_job",
            "job_id": job_id,
            "job_title": job_title,
            "created_at": now.isoformat(),
        }

        # Crédit du filleul + pose du flag (même update, atomique)
        await db.users.update_one(
            {**identifiant_query(worker_id)},
            {
                "$set": {"referral_first_job_rewarded": True, "updated_at": now},
                "$inc": {"referral_reward_balance": REFERRAL_FILLEUL_REWARD},
                "$push": {"referral_rewards": {**reward_record, "role": "filleul", "amount": REFERRAL_FILLEUL_REWARD}},
            },
        )

        # Crédit du parrain
        await db.users.update_one(
            {**identifiant_query(sponsor["id"])},
            {
                "$inc": {"referral_reward_balance": REFERRAL_SPONSOR_REWARD},
                "$push": {"referral_rewards": {**reward_record, "role": "parrain", "amount": REFERRAL_SPONSOR_REWARD}},
            },
        )

        # Notifications pour les deux (dans leur langue préférée)
        asyncio.create_task(effets.notify_user_localized(
            user_id=worker_id,
            key="bonus_filleul_first_mission",
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            job_title=job_title,
            amount=REFERRAL_FILLEUL_REWARD,
        ))
        asyncio.create_task(effets.notify_user_localized(
            user_id=sponsor["id"],
            key="bonus_sponsor_first_mission",
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            job_title=job_title,
            amount=REFERRAL_SPONSOR_REWARD,
        ))
    except Exception as exc:
        # Non bloquant : une erreur de récompense ne doit jamais casser la
        # clôture de mission ni le versement au travailleur.
        logger.error(f"⚠️ Attribution de la récompense de parrainage impossible: {exc}")

@router.post("/jobs/{job_id}/complete")
async def complete_job_and_release_payment(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Bouton "Travail Termine" : cloture la mission et declenche le versement
    (decaissement PayDunya) du montant sequestre vers le travailleur.

    Le paiement collecte reste "sequestre" (payout_status='held') tant que
    cette route n'a pas ete appelee : c'est ca, l'escrow, dans ce systeme.
    Si le decaissement automatique echoue (pas de compte mobile money
    valide, panne PayDunya, etc.), la mission est quand meme cloturee mais
    le paiement reste marque a traiter manuellement (payout_status=
    'release_failed') plutot que de bloquer le client indefiniment.

    Returns:
        dict: {message, job (modèle complet), payout_status
        (released | release_failed | already_released)}.
    """
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if job.get("client_id") != current_user.id and not is_owner_user:
        raise HTTPException(status_code=403, detail="Access denied")

    worker_id = job.get("assigned_worker_id")
    if not worker_id:
        raise HTTPException(status_code=400, detail="Aucun travailleur attribué à cette mission")

    if job.get("status") == JobStatus.COMPLETED.value:
        raise HTTPException(status_code=409, detail="Cette mission est déjà marquée comme terminée")

    # Trouver le paiement collecte et sequestre pour ce job (le plus recent)
    payment_record = await db.payments.find_one(
        {"job_id": job_id, "status": "completed"},
        sort=[("created_at", -1)]
    )
    if not payment_record:
        raise HTTPException(
            status_code=400,
            detail="Aucun paiement confirmé trouvé pour cette mission. Le client doit d'abord payer."
        )

    # Idempotence : si deja libere ou en cours de liberation, ne pas relancer
    current_payout_status = payment_record.get("payout_status") or "held"
    if current_payout_status == "released":
        # Deja verse : on se contente de cloturer le job si ce n'est pas fait
        await db.jobs.update_one({**identifiant_job_query(job_id)}, {"$set": {"status": JobStatus.COMPLETED.value}})
        await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))
        updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
        return {"message": "Mission déjà clôturée et paiement déjà versé", "job": dump_stable(Job, updated_job), "payout_status": "released"}
    if current_payout_status == "releasing":
        raise HTTPException(status_code=409, detail="Un versement est déjà en cours pour ce paiement, réessayez dans un instant")

    # Verrou : marquer "releasing" seulement si toujours "held", pour eviter
    # un double-versement en cas de double-clic/appel concurrent.
    lock_result = await db.payments.update_one(
        {**identifiant_query(payment_record["id"]), "payout_status": current_payout_status},
        effets.maj_sequestre("releasing", {"updated_at": datetime.now(timezone.utc).isoformat()})
    )
    if lock_result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Un versement est déjà en cours pour ce paiement, réessayez dans un instant")

    worker = await db.users.find_one({**identifiant_query(worker_id)})
    worker_payment_accounts = (worker or {}).get("payment_accounts") or {}
    worker_amount = payment_record.get("worker_amount") or 0

    # On choisit Orange Money en priorite, sinon Wave (le compte bancaire
    # n'est pas un mode de decaissement automatique supporte par PayDunya
    # actuellement : dans ce cas on reste en versement manuel).
    payout_method = None
    payout_phone = None
    if worker_payment_accounts.get("orange_money"):
        payout_method = "orange_money"
        payout_phone = worker_payment_accounts["orange_money"]
    elif worker_payment_accounts.get("wave"):
        payout_method = "wave"
        payout_phone = worker_payment_accounts["wave"]

    async def _mark_release_failed(reason: str):
        await db.payments.update_one(
            {**identifiant_query(payment_record["id"])},
            effets.maj_sequestre("release_failed", {"payout_failure_reason": reason, "updated_at": datetime.now(timezone.utc).isoformat()})
        )
        await db.jobs.update_one({**identifiant_job_query(job_id)}, {"$set": {"status": JobStatus.COMPLETED.value}})
        await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))

    if not payout_method or not payout_phone:
        await _mark_release_failed("Le travailleur n'a pas de compte Orange Money ou Wave configuré")
        updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
        return {
            "message": "Mission clôturée, mais le versement automatique est impossible : le travailleur n'a pas de compte Orange Money ou Wave enregistré. Un versement manuel est nécessaire.",
            "job": dump_stable(Job, updated_job),
            "payout_status": "release_failed",
        }

    withdraw_mode = get_paydunya_withdraw_mode(payout_method, worker.get("country"))
    account_alias = strip_country_code_for_disburse(payout_phone)

    try:
        invoice = effets.create_paydunya_disburse_invoice(
            account_alias=account_alias,
            amount=worker_amount,
            withdraw_mode=withdraw_mode,
            callback_url=build_disburse_callback_url(),
        )
        disburse_token = invoice.get("disburse_token")
    except HTTPException as exc:
        # get-invoice REFUSÉ : PayDunya n'a rien exécuté → échec sûr, relançable.
        await _mark_release_failed(str(exc.detail))
        updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
        return {
            "message": f"Mission clôturée, mais le versement automatique a échoué ({exc.detail}). Un versement manuel est nécessaire.",
            "job": dump_stable(Job, updated_job),
            "payout_status": "release_failed",
        }
    except Exception as exc:
        logger.error(f"⚠️ Erreur inattendue lors de la préparation du versement: {exc}")
        await _mark_release_failed("Erreur inattendue lors de la préparation du versement")
        updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
        return {
            "message": "Mission clôturée, mais le versement automatique a échoué. Un versement manuel est nécessaire.",
            "job": dump_stable(Job, updated_job),
            "payout_status": "release_failed",
        }

    # Token persisté AVANT le submit : si le submit lève (timeout réseau), le
    # versement reste identifiable et confirmable via l'IPN ou un check-status.
    await db.payments.update_one(
        {**identifiant_query(payment_record["id"])},
        {"$set": {
            "disburse_token": disburse_token,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )

    try:
        submit_result = effets.submit_paydunya_disburse_invoice(disburse_token, disburse_id=payment_record["id"])
    except Exception as exc:
        # Réponse INCERTAINE (timeout réseau…) : PayDunya a peut-être exécuté
        # le versement. On garde "releasing" (confirmation par l'IPN ou un
        # check-status) au lieu de "release_failed" : un échec définitif
        # permettrait une relance → risque de DOUBLE versement au travailleur.
        logger.error(f"⚠️ Réponse incertaine du submit PayDunya (versement travailleur): {exc}")
        await db.payments.update_one(
            {**identifiant_query(payment_record["id"])},
            effets.maj_sequestre("releasing", {"disburse_error": f"Réponse incertaine du submit: {exc}", "updated_at": datetime.now(timezone.utc).isoformat()})
        )
        final_payout_status = "releasing"
    else:
        provider_status = str(
            submit_result.get("status")
            or ("success" if str(submit_result.get("response_code")) == "00" else "failed")
        ).strip().lower()

        await db.payments.update_one(
            {**identifiant_query(payment_record["id"])},
            {"$set": {
                "disburse_provider_response": submit_result,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )

        if provider_status == "success":
            final_payout_status = "released"
        elif provider_status == "pending":
            # Statut definitif inconnu pour l'instant (ex: Orange Money Mali
            # repond toujours "pending") : le callback ou un check-status
            # ulterieur confirmera. On garde "releasing" pour que le suivi
            # sache qu'il faut verifier plus tard.
            final_payout_status = "releasing"
        else:
            final_payout_status = "release_failed"
            await db.payments.update_one(
                {**identifiant_query(payment_record["id"])},
                {"$set": {"payout_failure_reason": submit_result.get("response_text") or "Échec du versement PayDunya"}}
            )

        await db.payments.update_one({**identifiant_query(payment_record["id"])}, effets.maj_sequestre(final_payout_status))

    await db.jobs.update_one({**identifiant_job_query(job_id)}, {"$set": {"status": JobStatus.COMPLETED.value}})
    await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))

    # Notifier le travailleur et confirmer au client via le chat (canal
    # fiable existant, pas de vrai systeme de notifications push).
    conversation_id = f"{min(current_user.id, worker_id)}_{max(current_user.id, worker_id)}"
    if final_payout_status == "released":
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA a été envoyé."
    elif final_payout_status == "releasing":
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA est en cours de traitement."
    else:
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA sera versé manuellement, contactez le support si besoin."

    try:
        await db.messages.insert_one(Message(
            conversation_id=conversation_id,
            sender_id=current_user.id,
            receiver_id=worker_id,
            content=worker_message,
            job_id=job_id
        ).model_dump())
    except Exception as exc:
        logger.error(f"⚠️ Échec de l'envoi du message automatique de fin de mission: {exc}")

    # Notifier le travailleur via push selon le statut du versement (sa langue)
    if final_payout_status == "released":
        payment_key = "payment_sent_worker"
    elif final_payout_status == "releasing":
        payment_key = "payment_releasing_worker"
    else:
        payment_key = "payment_manual_worker"

    asyncio.create_task(effets.notify_user_localized(
        user_id=worker_id,
        key=payment_key,
        notif_type=NotificationType.PAYMENT_RECEIVED,
        related_id=job_id,
        related_type="job",
        job_title=job.get("title") or "",
        amount=worker_amount,
    ))

    # Notifier le client que la mission est bien clôturée
    asyncio.create_task(effets.notify_user_localized(
        user_id=current_user.id,
        key="mission_closed",
        notif_type=NotificationType.JOB_COMPLETED,
        related_id=job_id,
        related_type="job",
        job_title=job.get("title") or "",
    ))

    updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
    return {
        "message": "Mission clôturée avec succès",
        "job": dump_stable(Job, updated_job),
        "payout_status": final_payout_status,
    }
