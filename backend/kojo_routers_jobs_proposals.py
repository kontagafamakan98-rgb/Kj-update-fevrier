# -*- coding: utf-8 -*-
"""Candidatures : dépôt (`POST /jobs/{id}/proposals`) et acceptation.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/surface/route_surface_jobs.json`). Les modèles de requête de
l'acceptation vivent ici, avec la seule route qui les lit.
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import kojo_job_effects as effets
from kojo_core import db, get_current_user
from kojo_models import (
    Job, JobProposal, JobStatus, Message, NotificationType, ProposalCreate, User, UserType,
)
from kojo_settings import OWNER_EMAIL, logger
from kojo_shared import nom_affiche

router = APIRouter()

@router.post("/jobs/{job_id}/proposals")
async def create_proposal(
    job_id: str,
    proposal_data: ProposalCreate,
    current_user: User = Depends(get_current_user)
):
    """Soumet une proposition de travailleur sur un job ouvert (une seule par
    travailleur et par job ; cohérence pays vérifiée).

    Returns:
        dict: {message: "Proposal submitted successfully"}.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can create proposals")
    
    # Check if job exists (et n'est pas supprimé)
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Un job déjà attribué/terminé/annulé n'accepte plus de propositions
    if job.get("status") != JobStatus.OPEN.value:
        raise HTTPException(status_code=400, detail="Ce job n'accepte plus de nouvelles propositions")

    # Cohérence pays : un travailleur ne postule que sur des jobs de son pays
    job_country = job.get("country")
    if job_country and current_user.country.value != job_country:
        raise HTTPException(status_code=403, detail="Ce job n'est pas dans votre pays")

    # Check if worker already proposed
    existing_proposal = await db.job_proposals.find_one({
        "job_id": job_id,
        "worker_id": current_user.id
    })
    if existing_proposal:
        raise HTTPException(status_code=400, detail="You have already proposed for this job")
    
    proposal = JobProposal(
        **proposal_data.model_dump(),
        job_id=job_id,
        worker_id=current_user.id
    )
    
    await db.job_proposals.insert_one(proposal.model_dump())

    # Notifier le client qu'une nouvelle proposition est arrivée
    client_id = job.get("client_id")
    if client_id:
        worker_name = nom_affiche(current_user) or "Un travailleur"
        asyncio.create_task(effets.notify_user_localized(
            user_id=client_id,
            key="proposal_received",
            notif_type=NotificationType.PROPOSAL_RECEIVED,
            related_id=job_id,
            related_type="job",
            worker_name=worker_name,
            job_title=job.get("title") or "",
        ))

    return {"message": "Proposal submitted successfully"}

class ProposalAcceptLocation(BaseModel):
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    accuracy: Optional[float] = None

class ProposalAcceptRequest(BaseModel):
    location: Optional[ProposalAcceptLocation] = None

@router.post("/jobs/{job_id}/proposals/{proposal_id}/accept")
async def accept_job_proposal(
    job_id: str,
    proposal_id: str,
    accept_data: ProposalAcceptRequest = ProposalAcceptRequest(),
    current_user: User = Depends(get_current_user)
):
    """
    Accepte une proposition de travailleur pour un job :
    - Attribue le job au travailleur (assigned_worker_id, status -> in_progress)
    - Marque cette proposition "accepted" et les autres "rejected"
    - Si une position GPS est fournie (capturee cote client au moment du
      clic), elle est enregistree sur le job ET envoyee automatiquement au
      travailleur via un message dans la discussion, sans action manuelle
      supplementaire.

    Returns:
        dict: {message, job, proposal_status, worker} — le job mis à jour
        (in_progress, assigned_worker_id) et la proposition acceptée.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if job.get("client_id") != current_user.id and not is_owner_user:
        raise HTTPException(status_code=403, detail="Access denied")

    proposal = await db.job_proposals.find_one({"id": proposal_id, "job_id": job_id})
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")

    worker_id = proposal.get("worker_id")
    worker = await db.users.find_one({"id": worker_id})
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Un job terminé/annulé n'accepte plus de propositions.
    if job.get("status") in (JobStatus.COMPLETED.value, JobStatus.CANCELLED.value):
        raise HTTPException(
            status_code=409,
            detail="Cette mission est déjà terminée ou annulée"
        )

    # Empeche d'ecraser accidentellement une mission deja attribuee a un
    # AUTRE travailleur (mais permet de re-confirmer le meme travailleur).
    existing_assigned = job.get("assigned_worker_id")
    if existing_assigned and existing_assigned != worker_id:
        raise HTTPException(
            status_code=409,
            detail="Ce job a déjà été attribué à un autre travailleur"
        )

    now = datetime.now(timezone.utc)

    shared_location = None
    loc = accept_data.location
    if loc and loc.latitude is not None and loc.longitude is not None:
        shared_location = {
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "accuracy": loc.accuracy,
            "shared_at": now.isoformat(),
            "maps_url": f"https://www.google.com/maps?q={loc.latitude},{loc.longitude}"
        }

    job_update = {
        "assigned_worker_id": worker_id,
        "accepted_proposal_id": proposal_id,
        "status": JobStatus.IN_PROGRESS.value,
    }
    if shared_location:
        job_update["shared_location"] = shared_location

    # Attribution ATOMIQUE (compare-and-set) : évite la course entre deux
    # acceptations concurrentes qui écraseraient assigned_worker_id (le
    # simple update_one précédent n'était pas conditionnel).
    claim_result = await db.jobs.update_one(
        {
            "id": job_id,
            "status": {"$nin": [JobStatus.COMPLETED.value, JobStatus.CANCELLED.value]},
            "$or": [
                {"assigned_worker_id": None},
                {"assigned_worker_id": {"$exists": False}},
                {"assigned_worker_id": worker_id},
            ],
        },
        {"$set": job_update}
    )
    if claim_result.matched_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Ce job a déjà été attribué à un autre travailleur"
        )

    await db.job_proposals.update_one(
        {"id": proposal_id},
        {"$set": {"status": "accepted"}}
    )
    await db.job_proposals.update_many(
        {"job_id": job_id, "id": {"$ne": proposal_id}},
        {"$set": {"status": "rejected"}}
    )

    # Message automatique au travailleur — adresse conditionnelle au paiement.
    # Si le client a déjà payé : on envoie l'adresse immédiatement.
    # Si le client n'a pas encore payé : on prévient le travailleur d'attendre.
    # (L'adresse sera envoyée automatiquement via l'IPN PayDunya dès confirmation.)
    payment_completed = await db.payments.find_one({
        "job_id": job_id,
        "status": "completed",
    })

    # Rechargement du job pour avoir shared_location si elle vient d'être ajoutée
    updated_job = await db.jobs.find_one({"id": job_id}) or {**job, **job_update}
    if shared_location:
        updated_job["shared_location"] = shared_location

    if payment_completed:
        await effets._dispatch_address_to_worker(
            job=updated_job,
            worker_id=worker_id,
            sender_id=current_user.id,
            phase="accepted",
        )
    else:
        # Envoie d'abord le message de félicitations sans adresse
        message_lines = [f"✅ Votre proposition a été acceptée pour « {job.get('title', 'la mission')} »."]
        conversation_id = f"{min(current_user.id, worker_id)}_{max(current_user.id, worker_id)}"
        try:
            await db.messages.insert_one(Message(
                conversation_id=conversation_id,
                sender_id=current_user.id,
                receiver_id=worker_id,
                content="\n".join(message_lines),
                job_id=job_id,
            ).model_dump())
        except Exception as exc:
            logger.error(f"⚠️ Échec du message d'acceptation: {exc}")

        # Puis le message d'attente de paiement dans la langue du travailleur
        await effets._send_payment_pending_to_worker(
            job=updated_job,
            worker_id=worker_id,
            sender_id=current_user.id,
        )

    # Notifier le travailleur que sa proposition a été acceptée (sa langue)
    client_name = nom_affiche(current_user) or "Le client"
    asyncio.create_task(effets.notify_user_localized(
        user_id=worker_id,
        key="proposal_accepted",
        notif_type=NotificationType.PROPOSAL_ACCEPTED,
        related_id=job_id,
        related_type="job",
        client_name=client_name,
        job_title=job.get("title") or "",
    ))

    updated_job = await db.jobs.find_one({"id": job_id})
    return {
        "message": "Proposition acceptée avec succès",
        "job": Job(**updated_job).model_dump(),
    }
