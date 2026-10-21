# -*- coding: utf-8 -*-
"""Séquestre à DEUX TEMPS : le travailleur déclare, le client valide, le délai libère.

LE TROU QUE CE MODULE FERME

Jusqu'ici, un seul chemin libérait l'argent séquestré : `POST
/jobs/{id}/complete`, déclenché par le CLIENT. Un client injoignable, indécis ou
malveillant laissait donc le travailleur impayé **indéfiniment**, sans recours
automatique — et le seul recours humain était un ticket support, sans état ni
échéance. Sur une place de marché où le travailleur prend le risque de se
déplacer, c'est le défaut qui coûte le plus cher.

CE QUI EXISTE MAINTENANT

  1. le travailleur DÉCLARE la fin (note obligatoire + jusqu'à 3 photos) ;
  2. le client VALIDE, ce qui libère immédiatement le séquestre ;
  3. sans validation, `passage_liberations_auto` libère à l'échéance
     (`COMPLETION_AUTO_RELEASE_DAYS`, 7 jours par défaut) : le travailleur est
     payé même si le client ne répond jamais.

CE QUI N'EST PAS DUPLIQUÉ

Le versement (`liberer_sequestre`) vit ICI, et nulle part ailleurs. Les trois
chemins — validation client, libération automatique, route historique
`/complete` — passent par la même fonction, donc par le même verrou CAS
(`held → releasing`), les mêmes notifications et le même anti-double-versement.
Le dépôt applique déjà cette règle au retrait de parrainage ; la recopier une
seconde fois pour l'escrow aurait été la première occasion de divergence.

CE QUI RESTE ASSUMÉ

- L'état de la MISSION reste `in_progress` tant que l'argent n'est pas libéré :
  la déclaration n'invente pas un statut de mission.
- Une libération automatique impossible (aucun paiement séquestré) n'est PAS
  silencieuse : l'état passe `auto_release_blocked`, le motif est conservé et le
  client est prévenu qu'un traitement manuel est nécessaire. Un travailleur
  payé « par un balayeur qui échoue en boucle » serait pire que le trou fermé.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

import kojo_job_effects as effets
from kojo_business_events import enregistrer_evenement
from kojo_core import db
from kojo_identifiants import dump_stable, identifiant_job_query, identifiant_query
from kojo_models import Job, JobStatus, Message, NotificationType
from kojo_payments import (
    build_disburse_callback_url, get_paydunya_withdraw_mode, strip_country_code_for_disburse,
)
from kojo_settings import (
    COMPLETION_AUTO_RELEASE_DAYS,
    REFERRAL_FILLEUL_REWARD,
    REFERRAL_SPONSOR_REWARD,
    logger,
)

# États de `job.completion`. Ils décrivent la DÉCLARATION, pas la mission.
MARKED = "marked"
CONFIRMED = "confirmed"
AUTO_RELEASED = "auto_released"
AUTO_RELEASE_BLOCKED = "auto_release_blocked"

# Ce que le balayage demande par passage : borné pour qu'un arriéré de mille
# missions ne tienne pas la boucle (ni le bail) pendant des minutes.
MAX_LIBERATIONS_PAR_PASSAGE = 50


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _date_fr(valeur_iso: Optional[str]) -> str:
    """Date lisible d'une échéance (`JJ/MM/AAAA`), jamais un ISO brut dans un
    message destiné à un utilisateur. Une date illisible n'invente rien : elle
    est rendue telle quelle, et le journal le dit déjà."""
    if not valeur_iso:
        return ""
    try:
        return datetime.fromisoformat(str(valeur_iso)).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return str(valeur_iso)


async def _marquer_terminee(job_id: str, client_id: str) -> None:
    """Clôt la mission et journalise sa fin. Idempotent : clé `mission_completed:<job_id>`."""
    await db.jobs.update_one({**identifiant_job_query(job_id)}, {"$set": {"status": JobStatus.COMPLETED.value}})
    await enregistrer_evenement(
        "mission_completed", f"mission_completed:{job_id}", user_id=client_id, job_id=job_id
    )


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
        ref_code = str((worker.get('referred_by') or '').strip()).upper()
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

        now = _maintenant()
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


async def liberer_sequestre(job: dict, *, acteur_id: str) -> dict:
    """Libère le séquestre d'une mission et verse le travailleur (PayDunya).

    SEUL chemin de versement. `acteur_id` est le compte qui déclenche la
    libération (le client qui valide, ou le client de la mission quand le délai
    expire) : il signe le message posé dans la conversation, et reçoit la
    notification de clôture.

    Returns:
        dict: {message, job, payout_status (released | release_failed |
        already_released | releasing)}.

    Lève HTTPException : 400 s'il n'y a ni travailleur attribué ni paiement
    confirmé, 409 si une libération est déjà en cours.
    """
    job_id = job.get("id")
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
        await _marquer_terminee(job_id, job.get("client_id"))
        await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))
        updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
        return {"message": "Mission déjà clôturée et paiement déjà versé", "job": dump_stable(Job, updated_job), "payout_status": "released"}
    if current_payout_status == "releasing":
        raise HTTPException(status_code=409, detail="Un versement est déjà en cours pour ce paiement, réessayez dans un instant")

    # Verrou : marquer "releasing" seulement si toujours "held", pour eviter
    # un double-versement en cas de double-clic/appel concurrent.
    lock_result = await db.payments.update_one(
        {**identifiant_query(payment_record["id"]), "payout_status": current_payout_status},
        effets.maj_sequestre("releasing", {"updated_at": _maintenant().isoformat()})
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
            effets.maj_sequestre("release_failed", {"payout_failure_reason": reason, "updated_at": _maintenant().isoformat()})
        )
        await _marquer_terminee(job_id, job.get("client_id"))
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
            "updated_at": _maintenant().isoformat()
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
            effets.maj_sequestre("releasing", {"disburse_error": f"Réponse incertaine du submit: {exc}", "updated_at": _maintenant().isoformat()})
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
                "updated_at": _maintenant().isoformat()
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

    await _marquer_terminee(job_id, job.get("client_id"))
    await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))

    # Notifier le travailleur et confirmer au client via le chat (canal
    # fiable existant, pas de vrai systeme de notifications push).
    conversation_id = f"{min(acteur_id, worker_id)}_{max(acteur_id, worker_id)}"
    if final_payout_status == "released":
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA a été envoyé."
    elif final_payout_status == "releasing":
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA est en cours de traitement."
    else:
        worker_message = f"✅ Mission « {job.get('title', '')} » terminée. Votre paiement de {worker_amount} FCFA sera versé manuellement, contactez le support si besoin."

    try:
        await db.messages.insert_one(Message(
            conversation_id=conversation_id,
            sender_id=acteur_id,
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
        user_id=acteur_id,
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


async def marquer_termine(job: dict, *, worker_id: str, note: str, proofs: list) -> dict:
    """Premier temps : le travailleur déclare la mission terminée, avec preuve.

    L'échéance de libération automatique est POSÉE ici, pas recalculée ailleurs :
    c'est le seul instant où l'on sait quand le client a été prévenu.

    Lève HTTPException : 403 si l'appelant n'est pas le travailleur attribué,
    409 si la mission est déjà terminée ou déjà déclarée, 400 si elle n'est pas
    en cours.
    """
    job_id = job.get("id")
    if str(job.get("assigned_worker_id") or "") != str(worker_id):
        raise HTTPException(status_code=403, detail="Seul le travailleur attribué peut déclarer la mission terminée")
    if job.get("status") == JobStatus.COMPLETED.value:
        raise HTTPException(status_code=409, detail="Cette mission est déjà terminée")
    if job.get("status") != JobStatus.IN_PROGRESS.value:
        raise HTTPException(status_code=400, detail="La mission n'est pas en cours")

    existante = job.get("completion") or {}
    if existante.get("state") in (MARKED, CONFIRMED, AUTO_RELEASED):
        raise HTTPException(status_code=409, detail="La mission a déjà été déclarée terminée")

    maintenant = _maintenant()
    echeance = maintenant + timedelta(days=COMPLETION_AUTO_RELEASE_DAYS)
    completion = {
        "state": MARKED,
        "note": note,
        "proofs": list(proofs or []),
        "marked_at": maintenant.isoformat(),
        "marked_by": worker_id,
        "auto_release_at": echeance.isoformat(),
        "confirmed_at": None,
        "auto_released_at": None,
    }

    await db.jobs.update_one(
        {**identifiant_job_query(job_id)},
        {"$set": {"completion": completion}},
    )
    await enregistrer_evenement(
        "mission_completion_marked",
        f"mission_completion_marked:{job_id}",
        user_id=worker_id,
        job_id=job_id,
    )

    # Le client doit pouvoir valider depuis la conversation ET la fiche.
    client_id = job.get("client_id")
    try:
        conversation_id = f"{min(client_id, worker_id)}_{max(client_id, worker_id)}"
        await db.messages.insert_one(Message(
            conversation_id=conversation_id,
            sender_id=worker_id,
            receiver_id=client_id,
            content=(
                f"✅ Le travailleur a déclaré la mission « {job.get('title', '')} » terminée. "
                f"Validez pour libérer le paiement ; sans réponse, il sera libéré automatiquement "
                f"le {_date_fr(completion['auto_release_at'])}."
            ),
            job_id=job_id,
        ).model_dump())
    except Exception as exc:
        logger.error(f"⚠️ Échec du message de déclaration de fin de mission: {exc}")

    asyncio.create_task(effets.notify_user_localized(
        user_id=client_id,
        key="completion_marked_client",
        notif_type=NotificationType.JOB_COMPLETED,
        related_id=job_id,
        related_type="job",
        job_title=job.get("title") or "",
        date=_date_fr(completion["auto_release_at"]),
    ))

    updated_job = await db.jobs.find_one({**identifiant_job_query(job_id)})
    return {
        "message": "Mission déclarée terminée. Le client peut valider le paiement.",
        "job": dump_stable(Job, updated_job),
        "completion": completion,
    }


async def confirmer_validation(job: dict, *, client_id: str) -> dict:
    """Second temps : le client valide la déclaration et libère le séquestre.

    Lève HTTPException 409 si aucune déclaration n'attend d'être validée.
    """
    completion = job.get("completion") or {}
    if completion.get("state") != MARKED:
        raise HTTPException(
            status_code=409,
            detail="Aucune déclaration de fin de mission n'attend votre validation.",
        )

    resultat = await liberer_sequestre(job, acteur_id=client_id)

    maintenant = _maintenant().isoformat()
    await db.jobs.update_one(
        {**identifiant_job_query(job.get("id"))},
        {"$set": {
            "completion.state": CONFIRMED,
            "completion.confirmed_at": maintenant,
        }},
    )
    await enregistrer_evenement(
        "mission_completion_confirmed",
        f"mission_completion_confirmed:{job.get('id')}",
        user_id=client_id,
        job_id=job.get("id"),
    )

    updated_job = await db.jobs.find_one({**identifiant_job_query(job.get("id"))})
    return {
        **resultat,
        "job": dump_stable(Job, updated_job),
        "completion_state": CONFIRMED,
    }


async def liberer_automatiquement(job: dict) -> dict:
    """Libère le séquestre à l'échéance, sans intervention du client.

    Trois issues, toutes DITES :
      - `released` / `release_failed` / `releasing` : le versement a été tenté
        (les statuts sont ceux de `liberer_sequestre`) ;
      - `already_in_progress` : un versement concurrent est en cours (validation
        client au même instant) — rien n'est écrit, le passage suivant tranchera ;
      - `already_completed` : la mission a été close entre-temps (route
        historique `/complete`, validation client) — la déclaration est
        RÉCONCILIÉE en `confirmed`, sinon elle resterait `marked` et le
        balayage la repasserait toutes les heures sans jamais rien dire ;
      - `blocked` : aucun paiement séquestré — l'état passe
        `auto_release_blocked` avec son motif, pour qu'un humain regarde, au
        lieu de réessayer toutes les heures en silence.
    """
    job_id = job.get("id")
    try:
        resultat = await liberer_sequestre(job, acteur_id=job.get("client_id"))
    except HTTPException as exc:
        if exc.status_code == 409:
            if job.get("status") == JobStatus.COMPLETED.value:
                # L'argent est déjà parti par un autre chemin (l'unique
                # `liberer_sequestre`) : la déclaration suit cet état au lieu
                # de rester éternellement « en attente de validation ».
                await db.jobs.update_one(
                    {**identifiant_job_query(job_id)},
                    {"$set": {
                        "completion.state": CONFIRMED,
                        "completion.confirmed_at": _maintenant().isoformat(),
                    }},
                )
                return {"payout_status": "already_completed", "detail": exc.detail}
            return {"payout_status": "already_in_progress", "detail": exc.detail}
        maintenant = _maintenant().isoformat()
        await db.jobs.update_one(
            {**identifiant_job_query(job_id)},
            {"$set": {
                "completion.state": AUTO_RELEASE_BLOCKED,
                "completion.blocked_reason": str(exc.detail),
                "completion.blocked_at": maintenant,
            }},
        )
        logger.error(
            f"⚠️ Libération automatique impossible pour la mission {job_id}: {exc.detail}"
        )
        asyncio.create_task(effets.notify_user_localized(
            user_id=job.get("client_id"),
            key="completion_blocked_client",
            notif_type=NotificationType.JOB_COMPLETED,
            related_id=job_id,
            related_type="job",
            job_title=job.get("title") or "",
        ))
        return {"payout_status": "blocked", "detail": str(exc.detail)}

    maintenant = _maintenant().isoformat()
    await db.jobs.update_one(
        {**identifiant_job_query(job_id)},
        {"$set": {
            "completion.state": AUTO_RELEASED,
            "completion.auto_released_at": maintenant,
        }},
    )
    await enregistrer_evenement(
        "mission_auto_released",
        f"mission_auto_released:{job_id}",
        user_id=job.get("client_id"),
        job_id=job_id,
    )
    for destinataire, cle in (
        (job.get("assigned_worker_id"), "completion_auto_released_worker"),
        (job.get("client_id"), "completion_auto_released_client"),
    ):
        asyncio.create_task(effets.notify_user_localized(
            user_id=destinataire,
            key=cle,
            notif_type=NotificationType.PAYMENT_RECEIVED,
            related_id=job_id,
            related_type="job",
            job_title=job.get("title") or "",
            days=COMPLETION_AUTO_RELEASE_DAYS,
        ))
    return {**resultat, "completion_state": AUTO_RELEASED}


async def passage_liberations_auto(now: Optional[datetime] = None) -> dict:
    """Un passage du balayage : libère les déclarations dont l'échéance est passée.

    Le seuil de comparaison est une CHAÎNE ISO UTC, comme `auto_release_at` :
    deux formats différents ne se comparent pas, et un balayage qui ne trouve
    jamais rien aurait l'air d'un balayage au repos.
    """
    instant = (now or _maintenant()).astimezone(timezone.utc).isoformat()
    en_attente = await db.jobs.find({
        "completion.state": MARKED,
        "completion.auto_release_at": {"$lte": instant},
        "deleted": {"$ne": True},
    }).to_list(MAX_LIBERATIONS_PAR_PASSAGE)

    resume = {"due": len(en_attente), "released": 0, "blocked": 0, "skipped": 0}
    for job in en_attente:
        try:
            issue = await liberer_automatiquement(job)
        except Exception as exc:  # noqa: BLE001 - une mission fautive n'arrête pas les autres
            logger.error(f"⚠️ Libération automatique en échec (mission {job.get('id')}): {exc}")
            resume["skipped"] += 1
            continue

        if issue.get("payout_status") == "blocked":
            resume["blocked"] += 1
        elif issue.get("payout_status") in ("already_in_progress", "already_completed"):
            resume["skipped"] += 1
        else:
            resume["released"] += 1

    if resume["released"] or resume["blocked"]:
        logger.info(f"💰 Libérations automatiques: {resume}")
    return resume
