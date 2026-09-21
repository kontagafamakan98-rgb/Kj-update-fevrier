# -*- coding: utf-8 -*-
"""Collection des missions : recherche (`GET /jobs`), détail, suppression.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/surface/route_surface_jobs.json`). La vue publique (`_job_view`) et la
résolution d'identifiant (celle de `kojo_identifiants`, `identifiant_job_query`)
sont ici parce qu'elles n'ont de sens que pour ces trois routes.
"""
import asyncio
import re
from datetime import datetime, timezone
from typing import Optional

from kojo_identifiants import identifiant_job_query, identifiant_query
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError

import kojo_job_effects as effets
from kojo_core import db, get_current_user, get_current_user_optional
from kojo_job_categories import _category_search_variants
from kojo_job_refunds import execute_paydunya_refund
from kojo_models import JobPublic, JobStatus, NotificationType, User
from kojo_settings import OWNER_EMAIL, logger

router = APIRouter()



# Vue PUBLIQUE des jobs (découverte sans compte) : modélisée par une
# ALLOWLIST stricte (JobPublic dans kojo_models), pas un denylist — tout champ
# ajouté au document (identité, GPS, interne) reste privé par défaut.


def _job_view(job: dict, current_user: Optional[User]):
    """Vue d'un job selon l'identité de l'appelant.

    - Visiteur anonyme : instance JobPublic construite depuis le document —
      seuls les champs explicitement autorisés sortent (identités, point geo,
      coordonnées GPS et champs internes exclus par construction, jamais par
      un retrait manuel qui pourrait être oublié à la prochaine évolution).
    - Utilisateur connecté : document complet sans _id (comportement
      historique — le frontend lit aussi created_at en fallback d'affichage).
    """
    if current_user is None:
        return JobPublic.model_validate(job)
    view = dict(job)
    view.pop("_id", None)
    return view

@router.get("/jobs")
async def get_jobs(
    status: Optional[JobStatus] = None,
    category: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    # Recherche plein texte simple (titre + description), insensible à la casse.
    q: Optional[str] = Query(default=None, max_length=100),
    # Si défini, limite la liste aux jobs dont l'id est dans la liste
    # (séparée par des virgules, max 100) — utilisé par les onglets
    # « Mes candidatures » du frontend.
    ids: Optional[str] = Query(default=None, max_length=3000),
    # "mine=posted" (cliente) : jobs publiés par l'utilisateur courant ;
    # "mine=assigned" (travailleur) : missions qui lui sont attribuées.
    mine: Optional[str] = Query(default=None),
    # Filtre pays explicite (visiteur anonyme : découverte par pays).
    country: Optional[str] = Query(default=None),
    # Recherche par rayon côté serveur : seuls les jobs portant un point
    # GeoJSON (geo) dans le rayon entrent en compte. Sans lat/lng/radius_km
    # complets, le filtre ne s'applique pas (comportement inchangé).
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
    radius_km: Optional[float] = Query(default=None, ge=0.1, le=2000),
    response: Response = Response(),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Liste des jobs avec filtres (statut, catégorie, recherche q, ids,
    mine=posted/assigned, pays, rayon lat/lng/radius_km). Accessible en
    lecture publique (visiteur anonyme : vue nettoyée).

    Returns:
        list[dict]: vues de jobs via _job_view (le contenu diffère selon
        que l'utilisateur est connecté ou non).
    """
    try:
        query = {}
        if status:
            query["status"] = status
        if category:
            # Filtre le GROUPE d'équivalence (canonique + écritures legacy FR)
            query["category"] = {"$in": _category_search_variants(category)}
        if country:
            query["country"] = str(country).strip().lower()
        if ids:
            id_list = [i.strip() for i in ids.split(",") if i.strip()][:100]
            if id_list:
                query["id"] = {"$in": id_list}
        if mine:
            if current_user is None:
                raise HTTPException(status_code=401, detail="Authentification requise")
            if mine == "posted":
                query["client_id"] = current_user.id
            elif mine == "assigned":
                query["assigned_worker_id"] = current_user.id
            else:
                raise HTTPException(status_code=400, detail="Paramètre mine invalide")
        if q:
            q_escaped = re.escape(str(q).strip())
            query["$and"] = [
                {"$or": [
                    {"title": {"$regex": q_escaped, "$options": "i"}},
                    {"description": {"$regex": q_escaped, "$options": "i"}},
                ]}
            ]

        # Rayon : $geoWithin + $centerSphere (rayon en radians = km / 6371).
        # Nécessite l'index 2dsphere sur jobs.geo (créé au boot).
        if lat is not None and lng is not None and radius_km is not None:
            query["geo"] = {
                "$geoWithin": {
                    "$centerSphere": [[lng, lat], float(radius_km) / 6371.0]
                }
            }

        query["deleted"] = {"$ne": True}

        # Lecture PUBLIQUE (découverte sans compte) : un visiteur anonyme
        # voit les offres de tous les pays. Les utilisateurs connectés
        # restent filtrés par leur pays (comportement historique).
        if current_user is not None:
            is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
            if not is_owner_user:
                query["$or"] = [
                    {"country": current_user.country},
                    {"country": {"$exists": False}},
                    {"country": None}
                ]

        # Pagination : offset = (page - 1) * limit. Le client déduit
        # « plus de résultats » du fait que la page est pleine.
        offset = max(0, (page - 1) * limit)
        jobs = await db.jobs.find(query).sort("created_at", -1).skip(offset).to_list(limit)

        # Cache-Control : la liste PUBLIQUE (visiteur anonyme) ne change que
        # par les créations/clôtures de missions — on la sert avec un cache
        # court (60s) pour que Googlebot et les visiteurs répétés ne tapent
        # pas MongoDB à chaque vue. JAMAIS de cache pour un utilisateur
        # connecté (ses données/filtres sont personnels).
        if current_user is None:
            response.headers["Cache-Control"] = "public, max-age=60, s-maxage=60"

        logger.debug(f"✅ Retrieved {len(jobs)} jobs (auth={current_user is not None}, page={page})")
        if current_user is None:
            # Vue publique : un fiche legacy invalide ne doit JAMAIS faire
            # tomber toute la liste en 500 — on l'écarte avec un warning (elle
            # reste visible aux utilisateurs connectés, qui ont le doc brut).
            views = []
            for job in jobs:
                try:
                    views.append(_job_view(job, current_user))
                except ValidationError as exc:
                    logger.warning(f"⚠️ Job {job.get('id')} invalide pour la vue publique, ignoré: {exc}")
            return views
        return [_job_view(job, current_user) for job in jobs]

    except HTTPException:
        # Paramètre invalide (mine=..., requête anonyme) → ne PAS transformer
        # en 500 : le except Exception générique ci-dessous avalerait l'erreur.
        raise
    except Exception as e:
        logger.error(f"❌ Failed to retrieve jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving jobs")

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user: Optional[User] = Depends(get_current_user_optional)):
    """Détail d'un job (404 si introuvable/supprimé ; 403 si le job est d'un
    autre pays pour un utilisateur connecté non-owner).

    Returns:
        dict: vue du job via _job_view (contient job + relation avec
        l'utilisateur courant).
    """
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Filtre pays uniquement pour les utilisateurs connectés : un visiteur
    # anonyme (découverte) peut consulter une offre de n'importe quel pays.
    if current_user is not None:
        is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
        job_country = job.get("country")
        if not is_owner_user and job_country and job_country != current_user.country:
            raise HTTPException(status_code=403, detail="Ce job n'appartient pas à votre pays.")

    return _job_view(job, current_user)

@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user: User = Depends(get_current_user)):
    """Annule/supprime une mission (réservé à la cliente ou au owner). Si la
    mission était PAYÉE, déclenche le remboursement automatique du client
    (escrow PayDunya) avant l'annulation.

    Returns:
        dict: {message, job_id, refund_status, refunded_amount}.
    """
    job = await db.jobs.find_one({
        "$and": [
            identifiant_job_query(job_id),
            {"deleted": {"$ne": True}},
        ]
    })
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    stored_job_id = str(job.get("id") or job.get("job_id") or job.get("_id") or job_id)

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if job.get("client_id") != current_user.id and not is_owner_user:
        raise HTTPException(status_code=403, detail="Access denied")

    now_iso = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Annulation d'une mission PAYÉE : remboursement automatique du client
    # ------------------------------------------------------------------
    # Si un paiement confirmé existe (fonds séquestrés chez PayDunya), on
    # rembourse le client via l'API de décaissement avant d'annuler. Sans
    # ça, l'argent restait bloqué sans aucune voie de restitution (ni
    # remboursement client, ni libération travailleur).
    payment_record = await db.payments.find_one(
        {"job_id": stored_job_id, "status": "completed"},
        sort=[("created_at", -1)]
    )
    refund_outcome = None
    refunded_amount = None

    if payment_record:
        payout_status = payment_record.get("payout_status") or "held"

        if payout_status in ("released", "releasing"):
            raise HTTPException(
                status_code=409,
                detail="Cette mission a déjà un versement en cours ou effectué vers le travailleur : annulation impossible."
            )

        # Verrou atomique (CAS) : "held"/"release_failed" → "refunding".
        lock_result = await db.payments.update_one(
            {**identifiant_query(payment_record["id"]), "payout_status": payout_status},
            effets.maj_sequestre("refunding", {"payout_kind": "refund", "updated_at": now_iso})
        )
        if lock_result.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail="Un remboursement est déjà en cours pour cette mission"
            )

        refund_outcome = await execute_paydunya_refund(payment_record)
        refunded_amount = payment_record.get("amount")

    await db.jobs.update_one(
        identifiant_job_query(job_id),
        {
            "$set": {
                "deleted": True,
                "status": "cancelled",
                "deleted_at": now_iso,
                "deleted_by": current_user.id,
                "updated_at": now_iso
            }
        }
    )

    try:
        await db.job_proposals.delete_many({"job_id": stored_job_id})
    except Exception:
        pass

    # Notifications (best-effort) : informer le client du sort de son argent
    # et le travailleur de l'annulation.
    if payment_record:
        worker_id_for_notif = job.get("assigned_worker_id")
        job_title = job.get("title") or "la mission"
        if refund_outcome == "refunded":
            cancel_key = "mission_cancelled_client_refunded"
        elif refund_outcome == "refunding":
            cancel_key = "mission_cancelled_client_refunding"
        elif refund_outcome == "refund_failed":
            cancel_key = "mission_cancelled_client_refund_failed"
        else:
            cancel_key = "mission_cancelled_client"
        asyncio.create_task(effets.notify_user_localized(
            user_id=payment_record.get("payer_id"),
            key=cancel_key,
            notif_type=NotificationType.GENERAL,
            related_id=stored_job_id,
            related_type="job",
            job_title=job_title,
            amount=refunded_amount,
        ))
        if worker_id_for_notif:
            asyncio.create_task(effets.notify_user_localized(
                user_id=worker_id_for_notif,
                key="mission_cancelled_worker",
                notif_type=NotificationType.GENERAL,
                related_id=stored_job_id,
                related_type="job",
                job_title=job_title,
            ))

    if refund_outcome == "refunded":
        message = "Mission annulée. Le paiement a été entièrement remboursé au client."
    elif refund_outcome == "refunding":
        message = "Mission annulée. Remboursement en cours de traitement (confirmation par PayDunya)."
    elif refund_outcome == "refund_failed":
        message = "Mission annulée, mais le remboursement automatique a échoué : un remboursement manuel est nécessaire."
    else:
        message = "Job deleted successfully"

    return {
        "message": message,
        "job_id": stored_job_id,
        "refund_status": refund_outcome,
        "refunded_amount": refunded_amount,
    }
