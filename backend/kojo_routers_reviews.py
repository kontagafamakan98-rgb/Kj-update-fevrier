# -*- coding: utf-8 -*-
"""Avis / notes (reviews) entre clients et travailleurs après mission terminée.

Règles métier :
- Seule une mission TERMINÉE peut être notée.
- Seuls les participants (client + travailleur attribué) peuvent noter, et
  uniquement l'AUTRE partie.
- Un seul avis par (mission, auteur) — index unique en base.
- Le rating/total_reviews de l'utilisateur noté est recalculé à chaque
  création/suppression d'avis (pas de dérive possible).
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db, get_current_user
from kojo_models import NotificationType, Review, ReviewCreate, User
from kojo_settings import OWNER_EMAIL, logger
from kojo_shared import notify_user_localized

router = APIRouter()


async def _recompute_user_rating(user_id: str):
    """Recalcule rating (moyenne) et total_reviews depuis les avis reçus."""
    reviews = await db.reviews.find({"reviewee_id": user_id}).to_list(length=None)
    total = len(reviews)
    rating = round(sum(int(r.get("rating", 0)) for r in reviews) / total, 1) if total else 0.0
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "rating": rating,
            "total_reviews": total,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return rating, total


async def _enrich_reviews(reviews):
    """Enrichit chaque avis avec nom/photo de l'auteur (sans PII)."""
    reviewer_ids = {r.get("reviewer_id") for r in reviews if r.get("reviewer_id")}
    reviewers = {}
    if reviewer_ids:
        cursor = db.users.find(
            {"id": {"$in": list(reviewer_ids)}},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "profile_photo": 1},
        )
        async for u in cursor:
            reviewers[u["id"]] = u

    result = []
    for r in reviews:
        out = Review(**r).model_dump()
        reviewer = reviewers.get(r.get("reviewer_id"))
        if reviewer:
            full_name = f"{reviewer.get('first_name', '')} {reviewer.get('last_name', '')}".strip()
            out["reviewer_name"] = full_name or None
            out["reviewer_photo"] = reviewer.get("profile_photo")
        result.append(out)
    return result


def _is_owner_user(current_user: User) -> bool:
    return bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL


@router.post("/jobs/{job_id}/reviews")
async def create_review(
    job_id: str,
    review_data: ReviewCreate,
    current_user: User = Depends(get_current_user),
):
    """Publie un avis sur une mission TERMINÉE (l'auteur note l'autre partie ;
    un seul avis par mission et par auteur).

    Returns:
        dict: {message, review, reviewee_rating, reviewee_total_reviews}.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable")

    # Seule une mission TERMINÉE peut être notée.
    if job.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail="La mission doit être terminée pour pouvoir être notée"
        )

    client_id = job.get("client_id")
    worker_id = job.get("assigned_worker_id")

    is_owner_user = _is_owner_user(current_user)
    is_client = current_user.id == client_id
    is_worker = bool(worker_id) and current_user.id == worker_id
    if not (is_client or is_worker or is_owner_user):
        raise HTTPException(
            status_code=403,
            detail="Seuls les participants de la mission peuvent la noter"
        )

    # On note l'AUTRE partie (le client note le travailleur, et inversement).
    if is_client:
        reviewee_id = worker_id
    elif is_worker:
        reviewee_id = client_id
    else:
        reviewee_id = worker_id or client_id

    if not reviewee_id:
        raise HTTPException(
            status_code=400,
            detail="Impossible de déterminer qui noter sur cette mission"
        )

    # Un seul avis par (mission, auteur).
    existing = await db.reviews.find_one({"job_id": job_id, "reviewer_id": current_user.id})
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Vous avez déjà laissé un avis sur cette mission"
        )

    review = Review(
        job_id=job_id,
        reviewer_id=current_user.id,
        reviewee_id=reviewee_id,
        rating=review_data.rating,
        comment=review_data.comment.strip() if review_data.comment else None,
    )
    await db.reviews.insert_one(review.model_dump())

    rating, total = await _recompute_user_rating(reviewee_id)

    if reviewee_id != current_user.id:
        asyncio.create_task(notify_user_localized(
            user_id=reviewee_id,
            key="new_review",
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            rating=review.rating,
            job_title=job.get('title') or '',
        ))

    return {
        "message": "Avis publié avec succès",
        "review": review.model_dump(),
        "reviewee_rating": rating,
        "reviewee_total_reviews": total,
    }


@router.get("/jobs/{job_id}/reviews")
async def get_job_reviews(job_id: str, current_user: User = Depends(get_current_user)):
    """Avis d'une mission (accès réservé aux participants ou au owner).

    Returns:
        list[dict]: avis enrichis du nom/photo de l'auteur.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable")

    allowed = (
        _is_owner_user(current_user)
        or job.get("client_id") == current_user.id
        or job.get("assigned_worker_id") == current_user.id
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Accès interdit à ces avis")

    reviews = await db.reviews.find({"job_id": job_id}).to_list(length=None)
    return await _enrich_reviews(reviews)


@router.get("/users/{user_id}/reviews")
async def get_user_reviews(user_id: str, current_user: User = Depends(get_current_user)):
    """Avis reçus par un utilisateur (50 derniers) + résumé de notation.

    Returns:
        dict: {user, rating, total_reviews, reviews} — les avis sont
        enrichis du nom/photo de l'auteur.
    """
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "profile_photo": 1, "rating": 1, "total_reviews": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    reviews = await db.reviews.find({"reviewee_id": user_id}).sort("created_at", -1).to_list(length=50)
    return {
        "user": user,
        "rating": user.get("rating", 0.0),
        "total_reviews": user.get("total_reviews", 0),
        "reviews": await _enrich_reviews(reviews),
    }


@router.delete("/reviews/{review_id}")
async def delete_review(review_id: str, current_user: User = Depends(get_current_user)):
    """Supprime un avis (réservé à son auteur ou au owner).

    Returns:
        dict: {message: "Avis supprimé", review_id}.
    """
    review = await db.reviews.find_one({"id": review_id})
    if not review:
        raise HTTPException(status_code=404, detail="Avis introuvable")

    if review.get("reviewer_id") != current_user.id and not _is_owner_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Seul l'auteur de l'avis peut le supprimer"
        )

    reviewee_id = review.get("reviewee_id")
    await db.reviews.delete_one({"id": review_id})
    if reviewee_id:
        try:
            await _recompute_user_rating(reviewee_id)
        except Exception as exc:
            logger.warning(f"⚠️ Recalcul rating après suppression d'avis impossible: {exc}")

    return {"message": "Avis supprimé", "review_id": review_id}
