# -*- coding: utf-8 -*-
"""Fin de mission : déclaration du travailleur, validation du client, versement.

La RÈGLE (versement, verrou CAS, notifications, parrainage) vit dans
`kojo_job_completion.py` — ce module ne fait que la traduire en routes. Il porte
quatre chemins, dans l'ordre où ils ont existé :

  * `POST /jobs/{id}/complete` — route HISTORIQUE, gardée telle quelle : les
    applications déjà installées (Capacitor) l'appellent, et un client qui veut
    payer AVANT que le travailleur ait déclaré doit pouvoir le faire. Elle ne
    casse rien : elle déclenche la même libération unique ;
  * `POST /jobs/{id}/completion/proof` — photo de preuve (Cloudinary) ;
  * `POST /jobs/{id}/completion` — le travailleur DÉCLARE la fin (note
    obligatoire), ce qui arme l'échéance de libération automatique ;
  * `POST /jobs/{id}/completion/confirm` — le client VALIDE, ce qui libère
    immédiatement.
"""
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

import kojo_job_completion as completion
from kojo_core import (
    db,
    get_current_user,
    is_valid_image_content,
    upload_image_to_cloudinary,
)
from kojo_models import Job, JobCompletionMark, JobStatus, User
from kojo_identifiants import dump_stable, identifiant_job_query
from kojo_settings import OWNER_EMAIL, logger

router = APIRouter()

MAX_PROOF_BYTES = 5 * 1024 * 1024


async def _job_ou_404(job_id: str) -> dict:
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _est_owner(user: User) -> bool:
    return bool(OWNER_EMAIL) and str(user.email).strip().lower() == OWNER_EMAIL.strip().lower()


@router.post("/jobs/{job_id}/complete")
async def complete_job_and_release_payment(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """Route historique : le client clôture et libère le séquestre immédiatement.

    Conservée pour les applications déjà installées et pour le client qui veut
    payer sans attendre la déclaration du travailleur. Le versement passe par
    `kojo_job_completion.liberer_sequestre`, comme les deux autres chemins.

    Returns:
        dict: {message, job (modèle complet), payout_status
        (released | release_failed | already_released | releasing)}.
    """
    job = await _job_ou_404(job_id)

    if job.get("client_id") != current_user.id and not _est_owner(current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Une route HISTORIQUE ne doit pas devenir une porte de service du litige :
    # elle libère immédiatement, donc elle aussi est gelée tant que le désaccord
    # vit. Le propriétaire a sa propre route de décision, qui journalise.
    if completion._litige_bloquant(job):  # noqa: SLF001 - la règle a un propriétaire
        raise HTTPException(
            status_code=409,
            detail=(
                "Un litige est ouvert sur cette mission : la décision appartient "
                "au propriétaire, le paiement reste gelé jusque-là."
            ),
        )

    resultat = await completion.liberer_sequestre(job, acteur_id=current_user.id)

    # Une déclaration qui existait devient « validée » : la libération est
    # passée par cette route, pas par le délai. Sans cette écriture, l'écran
    # continuerait d'afficher « en attente de validation » sur une mission payée.
    if (job.get("completion") or {}).get("state") == completion.MARKED:
        await db.jobs.update_one(
            {**identifiant_job_query(job_id)},
            {"$set": {
                "completion.state": completion.CONFIRMED,
                "completion.confirmed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        resultat["job"] = dump_stable(
            Job, await db.jobs.find_one({**identifiant_job_query(job_id)})
        )
    return resultat


@router.post("/jobs/{job_id}/completion/proof")
async def upload_completion_proof(
    job_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Téléverse une photo de preuve de fin de mission (travailleur attribué).

    La photo n'est PAS attachée à la mission ici : elle l'est au moment de la
    déclaration, qui valide les URLs. Un téléversement abandonné ne laisse donc
    jamais une mission à moitié déclarée.

    Returns:
        dict: {proof_url} — URL Cloudinary à joindre à la déclaration.
    """
    job = await _job_ou_404(job_id)
    if str(job.get("assigned_worker_id") or "") != str(current_user.id):
        raise HTTPException(status_code=403, detail="Seul le travailleur attribué peut ajouter une preuve")
    if job.get("status") != JobStatus.IN_PROGRESS.value:
        raise HTTPException(status_code=400, detail="La mission n'est pas en cours")

    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    contenu = await file.read()
    if len(contenu) > MAX_PROOF_BYTES:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")
    if not is_valid_image_content(contenu):
        raise HTTPException(status_code=400, detail="Fichier image invalide (JPEG, PNG, GIF ou WebP requis)")

    try:
        resultat = upload_image_to_cloudinary(
            io.BytesIO(contenu),
            str(current_user.id),
            "kojo/completion_proofs",
            "completion",
        )
    except Exception as exc:
        logger.error(f"Erreur upload preuve de fin de mission: {exc}")
        raise HTTPException(status_code=500, detail="Échec de l'envoi de la photo. Veuillez réessayer.")

    return {"proof_url": resultat["photo_url"]}


@router.post("/jobs/{job_id}/completion")
async def mark_job_complete(
    job_id: str,
    payload: JobCompletionMark,
    current_user: User = Depends(get_current_user),
):
    """Le travailleur DÉCLARE la mission terminée (note + photos).

    Pose l'échéance de libération automatique (`COMPLETION_AUTO_RELEASE_DAYS`)
    et prévient le client. La mission reste `in_progress` : elle ne devient
    `completed` qu'au versement, décidé par la validation ou par l'échéance.

    Returns:
        dict: {message, job, completion}.
    """
    job = await _job_ou_404(job_id)
    return await completion.marquer_termine(
        job,
        worker_id=current_user.id,
        note=payload.note,
        proofs=payload.proofs,
    )


@router.post("/jobs/{job_id}/completion/confirm")
async def confirm_job_completion(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """Le client VALIDE la déclaration : le séquestre est libéré immédiatement.

    Returns:
        dict: {message, job, payout_status, completion_state}.
    """
    job = await _job_ou_404(job_id)
    if job.get("client_id") != current_user.id and not _est_owner(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    return await completion.confirmer_validation(job, client_id=current_user.id)
