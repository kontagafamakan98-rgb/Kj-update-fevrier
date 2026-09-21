# -*- coding: utf-8 -*-
"""Suivi : mes candidatures, celles d'une mission, l'état du paiement.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/job_route_surface.json`).
"""
from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db, get_current_user
from kojo_models import JobProposal, User, UserType
from kojo_settings import OWNER_EMAIL

router = APIRouter()

@router.get("/proposals/mine")
async def get_my_proposals(current_user: User = Depends(get_current_user)):
    """
    Liste des propositions envoyées par le travailleur connecté, tous jobs
    confondus - permet au frontend d'afficher fiablement "déjà postulé" en
    se basant sur des données serveur, au lieu d'un simple marqueur
    localStorage (qui se perd en changeant d'appareil/navigateur ou en
    vidant le cache, ce qui laissait l'utilisateur postuler une 2e fois et
    tomber sur une erreur "vous avez déjà postulé").

    Returns:
        list[dict]: propositions du travailleur (job_id, status,
        proposed_amount, created_at) — liste vide pour un non-travailleur.
    """
    if current_user.user_type != UserType.WORKER:
        return []

    proposals = await db.job_proposals.find(
        {"worker_id": current_user.id},
        {"_id": 0, "job_id": 1, "status": 1, "proposed_amount": 1, "created_at": 1}
    ).to_list(500)
    return proposals

@router.get("/jobs/{job_id}/proposals")
async def get_job_proposals(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """Liste des propositions d'un job (réservé à la cliente du job).

    Returns:
        list[dict]: propositions enrichies du nom/photo/notation du
        travailleur (worker_name, worker_photo, rating…).
    """
    # Check if user is the job owner
    job = await db.jobs.find_one({"id": job_id, "client_id": current_user.id})
    if not job:
        raise HTTPException(status_code=403, detail="Access denied")
    
    proposals = await db.job_proposals.find({"job_id": job_id}).to_list(100)

    # Enrichir chaque proposition avec le nom et la photo du travailleur.
    # Sans ca, le frontend n'a que worker_id (aucun nom, aucune photo) et
    # retombe systematiquement sur "Travailleur" generique sans image.
    worker_ids = list({p.get("worker_id") for p in proposals if p.get("worker_id")})
    workers_by_id = {}
    if worker_ids:
        workers_cursor = db.users.find(
            {"id": {"$in": worker_ids}},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "profile_photo": 1, "rating": 1, "total_reviews": 1}
        )
        async for w in workers_cursor:
            workers_by_id[w["id"]] = w

    enriched = []
    for p in proposals:
        proposal_out = JobProposal(**p).model_dump()
        worker = workers_by_id.get(p.get("worker_id"))
        if worker:
            full_name = f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip()
            proposal_out["worker_name"] = full_name or None
            proposal_out["worker_photo"] = worker.get("profile_photo")
            proposal_out["worker"] = {
                "id": worker.get("id"),
                "first_name": worker.get("first_name"),
                "last_name": worker.get("last_name"),
                "profile_photo": worker.get("profile_photo"),
                "rating": worker.get("rating"),
                "total_reviews": worker.get("total_reviews"),
            }
        enriched.append(proposal_out)

    return enriched

@router.get("/jobs/{job_id}/payment-status")
async def get_job_payment_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Statut REEL du paiement d'un job, base uniquement sur ce qui existe
    en base de donnees (jamais devine a partir du statut du job). Sert de
    source de verite unique pour l'affichage cote client ET travailleur,
    afin d'eviter d'afficher "argent sequestre" quand rien n'a ete paye.

    Returns:
        dict: {has_payment, payment_status, payout_status, amount,
        worker_amount, created_at, completed_at} — has_payment false quand
        aucun paiement n'existe.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    allowed = (
        job.get("client_id") == current_user.id
        or job.get("assigned_worker_id") == current_user.id
        or is_owner_user
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")

    payment_record = await db.payments.find_one(
        {"job_id": job_id},
        sort=[("created_at", -1)]
    )

    if not payment_record:
        return {"has_payment": False, "payment_status": None, "payout_status": None, "amount": None}

    return {
        "has_payment": True,
        "payment_status": payment_record.get("status"),
        "payout_status": payment_record.get("payout_status"),
        "amount": payment_record.get("amount"),
        "worker_amount": payment_record.get("worker_amount"),
        "created_at": payment_record.get("created_at"),
        "completed_at": payment_record.get("completed_at"),
    }
