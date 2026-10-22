# -*- coding: utf-8 -*-
"""Litige d'une mission, côté PARTIES : ouvrir, retirer.

La RÈGLE (état, échéance, gel du paiement, décision du propriétaire) vit dans
`kojo_job_disputes.py` — ce module ne fait que la traduire en routes, comme
`kojo_routers_jobs_completion` le fait pour le séquestre.

Trois routes seulement :

  * `POST /jobs/{id}/dispute` — le client OU le travailleur attribué ouvre le
    litige (motif obligatoire). Le paiement est gelé tant qu'il vit ;
  * `POST /jobs/{id}/dispute/response` — l'AUTRE partie oppose sa version, une
    seule fois : une position et une note bornée. Sans elle, l'arbitre ne lisait
    qu'un son de cloche ;
  * `POST /jobs/{id}/dispute/withdraw` — celui qui l'a ouvert le retire.

La LECTURE n'a pas de route : le litige voyage avec la mission (`job.dispute`),
donc la page qui affiche déjà la mission affiche déjà le désaccord. Une route de
lecture séparée aurait deux sources pour un même fait, et l'écran devrait
décider laquelle croire.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import kojo_job_disputes as litiges
from kojo_core import db, get_current_user
from kojo_identifiants import dump_stable, identifiant_job_query
from kojo_models import Job, JobDisputeOpen, JobDisputeResponse, JobDisputeWithdraw, User

router = APIRouter()


async def _job_ou_404(job_id: str) -> dict:
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/dispute")
async def open_job_dispute(
    job_id: str,
    payload: JobDisputeOpen,
    current_user: User = Depends(get_current_user),
):
    """Ouvre un litige sur une mission en cours.

    Le motif est EXIGÉ (20 caractères) : c'est ce que le propriétaire lira pour
    trancher, et un litige sans motif serait une contestation muette — donc
    intraitable.

    Returns:
        dict: {message, dispute (état, motif, échéance, ouvreur)}.
    """
    job = await _job_ou_404(job_id)
    resultat = await litiges.ouvrir_litige(job, acteur_id=current_user.id, motif=payload.reason)
    resultat["job"] = dump_stable(
        Job, await db.jobs.find_one({**identifiant_job_query(job.get("id"))})
    )
    return resultat


@router.post("/jobs/{job_id}/dispute/response")
async def respond_job_dispute(
    job_id: str,
    payload: JobDisputeResponse,
    current_user: User = Depends(get_current_user),
):
    """L'AUTRE partie oppose sa version au motif, une seule fois.

    Seule la partie qui n'a PAS ouvert le litige répond : l'ouvreur s'est déjà
    exprimé par son motif, et deux textes d'un même côté feraient deux versions
    pour une seule voix. La réponse est UNIQUE et non modifiable — réécrire sa
    version après avoir lu celle de l'autre transformerait l'arbitrage en
    négociation, et le journal en brouillon.

    Returns:
        dict: {message, dispute (avec `response`), job}.
    """
    job = await _job_ou_404(job_id)
    resultat = await litiges.repondre_litige(
        job,
        acteur_id=current_user.id,
        position=payload.position,
        note=payload.note,
    )
    resultat["job"] = dump_stable(
        Job, await db.jobs.find_one({**identifiant_job_query(job.get("id"))})
    )
    return resultat


@router.post("/jobs/{job_id}/dispute/withdraw")
async def withdraw_job_dispute(
    job_id: str,
    payload: Optional[JobDisputeWithdraw] = None,
    current_user: User = Depends(get_current_user),
):
    """Retire le litige qu'on a ouvert (accord retrouvé).

    Seule la partie qui l'a ouvert peut le retirer : laisser l'autre débloquer
    l'argent reviendrait à remettre au débiteur la clé du séquestre.

    Returns:
        dict: {message, dispute}.
    """
    job = await _job_ou_404(job_id)
    resultat = await litiges.retirer_litige(job, acteur_id=current_user.id)
    resultat["job"] = dump_stable(
        Job, await db.jobs.find_one({**identifiant_job_query(job.get("id"))})
    )
    return resultat
