# -*- coding: utf-8 -*-
"""Création d'une mission (`POST /jobs`) et push de matching.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/job_route_surface.json`). Le push de matching vit ici parce
qu'il n'a qu'un site d'appel : la création.
"""
import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

import kojo_job_effects as effets
from kojo_core import db, get_current_user
from kojo_job_categories import _CATEGORY_GROUPS, _normalize_job_category
from kojo_models import Job, JobCreate, NotificationType, User, UserType
from kojo_settings import logger

router = APIRouter()

async def _notify_matching_workers(job: Job):
    """Notifie par push les travailleurs dont les spécialités correspondent à la
    catégorie du job (repli : travailleurs du même pays). Fire-and-forget : une
    erreur ici ne doit jamais faire échouer la création du job.
    """
    try:
        category = _normalize_job_category(job.category)
        if not category:
            return

        # 1) Travailleurs dont une spécialité = catégorie du job (insensible à
        # la casse) — on matche TOUTES les écritures du groupe (EN + FR)
        # pour ne pas rater un profil legacy.
        variants = sorted({v.lower() for v in _CATEGORY_GROUPS.get(category, [category])}, key=len, reverse=True)
        variants_regex = "^(" + "|".join(re.escape(v) for v in variants) + ")$"
        profiles = await db.worker_profiles.find({
            "specialties": {"$regex": variants_regex, "$options": "i"},
        }).to_list(50)
        worker_ids = [p.get("user_id") for p in profiles if p.get("user_id")]
        method = "spécialité"

        # 2) Repli : travailleurs du même pays (borné) si aucun match de spécialité
        if not worker_ids:
            country = (job.country or '').strip().lower()
            if country:
                same_country_users = await db.users.find(
                    {"country": country, "user_type": "worker"},
                    {"id": 1},
                ).to_list(200)
                country_ids = [u.get("id") for u in same_country_users if u.get("id")]
                if country_ids:
                    profiles = await db.worker_profiles.find(
                        {"user_id": {"$in": country_ids}}
                    ).to_list(30)
                    worker_ids = [p.get("user_id") for p in profiles if p.get("user_id")]
                    method = "pays"

        if not worker_ids:
            return

        logger.info(f"🔔 Push matching {method} : {len(worker_ids)} travailleurs pour « {job.title} »")
        for uid in worker_ids[:30]:
            try:
                await effets.notify_user_localized(
                    user_id=uid,
                    key="new_job_matching",
                    notif_type=NotificationType.GENERAL,
                    related_id=job.id,
                    related_type="job",
                    push_data={"job_id": job.id},
                    job_title=job.title,
                )
            except Exception:
                continue
    except Exception as exc:
        logger.warning(f"⚠️ Push matching échoué (non bloquant): {exc}")

@router.post("/jobs", response_model=Job)
async def create_job(
    job_data: dict,
    current_user: User = Depends(get_current_user)
):
    """Crée une mission (réservé au rôle CLIENT). Normalise la description,
    valide les montants et renvoie le job complet.

    Returns:
        Job: mission créée (modèle Pydantic complet, response_model=Job).
    """
    try:
        if current_user.user_type != UserType.CLIENT:
            raise HTTPException(status_code=403, detail="Only clients can create jobs")

        incoming = dict(job_data or {})

        def _text(value):
            return str(value).strip() if value is not None else ""

        def _number(value):
            if value in (None, ""):
                return None
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        def _ensure_min_description(description, title, location_payload):
            raw = _text(description)
            if len(raw) >= 20:
                return raw

            location_text = _text(location_payload.get("fullAddress") or location_payload.get("address"))
            title_text = _text(title) or "Job"
            fallback = f"Besoin: {title_text}"
            if location_text:
                fallback += f" à {location_text}"
            fallback += "."
            if len(fallback) >= 20:
                return fallback
            return fallback + " Détails à confirmer."

        raw_location = incoming.get("location")
        if isinstance(raw_location, str):
            location_payload = {
                "address": raw_location.strip(),
                "fullAddress": raw_location.strip(),
                "city": "",
                "district": "",
                "country": "",
                "countryCode": "",
                "latitude": None,
                "longitude": None,
                "coordinates": None,
            }
        elif isinstance(raw_location, dict):
            location_payload = {
                "address": _text(raw_location.get("address") or raw_location.get("fullAddress")),
                "fullAddress": _text(raw_location.get("fullAddress") or raw_location.get("address")),
                "city": _text(raw_location.get("city")),
                "district": _text(raw_location.get("district")),
                "country": _text(raw_location.get("country")),
                "countryCode": _text(raw_location.get("countryCode")),
                "latitude": raw_location.get("latitude"),
                "longitude": raw_location.get("longitude"),
                "coordinates": raw_location.get("coordinates"),
            }
        else:
            location_payload = {
                "address": "",
                "fullAddress": "",
                "city": "",
                "district": "",
                "country": "",
                "countryCode": "",
                "latitude": None,
                "longitude": None,
                "coordinates": None,
            }

        budget_min = _number(incoming.get("budget_min"))
        budget_max = _number(incoming.get("budget_max"))
        if budget_min is None and budget_max is not None:
            budget_min = budget_max
        if budget_max is None and budget_min is not None:
            budget_max = budget_min

        incoming["title"] = _text(incoming.get("title"))
        # Catégorie ramenée au slug CANONIQUE (plomberie → plumbing, etc.) :
        # les filtres UI interrogent les slugs EN, les données legacy sont FR.
        incoming["category"] = _normalize_job_category(incoming.get("category"))
        incoming["location"] = location_payload
        incoming["budget_min"] = budget_min
        incoming["budget_max"] = budget_max
        incoming["description"] = _ensure_min_description(incoming.get("description"), incoming["title"], location_payload)
        incoming["required_skills"] = incoming.get("required_skills") if isinstance(incoming.get("required_skills"), list) else []
        incoming["estimated_duration"] = _text(incoming.get("estimated_duration")) or None
        incoming["parts_and_tools_notes"] = _text(incoming.get("parts_and_tools_notes"))
        incoming["urgency"] = _text(incoming.get("urgency")) or "normal"
        incoming["mechanic_must_bring_parts"] = bool(incoming.get("mechanic_must_bring_parts"))
        incoming["mechanic_must_bring_tools"] = bool(incoming.get("mechanic_must_bring_tools"))
        incoming["deadline"] = incoming.get("deadline") or None

        if not incoming["title"]:
            raise HTTPException(status_code=422, detail="title is required")
        if not (location_payload.get("address") or location_payload.get("fullAddress")):
            raise HTTPException(status_code=422, detail="location is required")
        if incoming["budget_min"] is None and incoming["budget_max"] is None:
            raise HTTPException(status_code=422, detail="price is required")
        if incoming["budget_min"] > incoming["budget_max"]:
            raise HTTPException(status_code=400, detail="budget_min cannot be greater than budget_max")

        try:
            # JobCreate ne connaît qu'un sous-ensemble de champs. Le frontend
            # peut envoyer des champs supplémentaires (job_type, location_text,
            # urgency, etc.) que Pydantic rejetterait avec une 422 si on les
            # passe tels quels. On ne garde que les champs reconnus par le modèle.
            jobcreate_fields = set(JobCreate.model_fields.keys())
            filtered_for_validation = {k: v for k, v in incoming.items() if k in jobcreate_fields}
            validated_input = JobCreate(**filtered_for_validation)
        except ValidationError as validation_error:
            # Messages lisibles : « titre: String should have at least 5
            # characters » au lieu du dump Pydantic brut avec loc en tuple.
            details = []
            for err in validation_error.errors():
                field = ".".join(str(part) for part in err.get("loc", []) if part not in ("body",))
                msg = str(err.get("msg", "valeur invalide"))
                details.append(f"{field}: {msg}" if field else msg)
            raise HTTPException(status_code=422, detail="; ".join(details))

        job = Job(**validated_input.model_dump(), client_id=current_user.id, country=current_user.country)

        # Point GeoJSON pour la recherche par rayon (index 2dsphere). Un job
        # sans coordonnées GPS n'a pas de geo → exclu quand un rayon est actif.
        lat = location_payload.get("latitude")
        lng = location_payload.get("longitude")
        if lat is not None and lng is not None:
            try:
                job.geo = {"type": "Point", "coordinates": [float(lng), float(lat)]}
            except (TypeError, ValueError):
                job.geo = None

        result = await db.jobs.insert_one(job.model_dump())

        if not result.inserted_id:
            raise HTTPException(status_code=500, detail="Failed to create job")

        logger.info(f"✅ Job created successfully: {job.id} by user {current_user.id}")

        # Alertes push de matching (fire-and-forget : ne bloque jamais la réponse)
        try:
            asyncio.create_task(_notify_matching_workers(job))
        except Exception as exc:
            logger.warning(f"⚠️ Impossible de lancer le push matching: {exc}")

        return job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to create job: {e}")
        raise HTTPException(status_code=500, detail="Internal server error creating job")
