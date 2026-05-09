from datetime import datetime, timezone
from uuid import uuid4
@api_router.post("/jobs", response_model=Job)
async def create_job(
    job_data: dict,
    current_user: User = Depends(get_current_user)
):
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
        incoming["category"] = _text(incoming.get("category")) or "general"
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
            validated_input = JobCreate(**incoming)
        except Exception as validation_error:
            raise HTTPException(status_code=422, detail=str(validation_error))

        job = Job(**validated_input.dict(), client_id=current_user.id)
        result = await db.jobs.insert_one(job.dict())

        if not result.inserted_id:
            raise HTTPException(status_code=500, detail="Failed to create job")

        logger.info(f"✅ Job created successfully: {job.id} by user {current_user.id}")
        return job

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to create job: {e}")
        raise HTTPException(status_code=500, detail="Internal server error creating job")

@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    return job

@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("client_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.jobs.update_one(
        {"id": job_id},
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
        await db.job_proposals.delete_many({"job_id": job_id})
    except Exception:
        pass

    try:
        await db.proposals.delete_many({"job_id": job_id})
    except Exception:
        pass

    return {"message": "Job deleted successfully", "job_id": job_id}

# Job Proposal Routes

def _proposal_collection():
    collection = getattr(db, "job_proposals", None)
    if collection is not None:
        return collection
    collection = getattr(db, "proposals", None)
    if collection is not None:
        return collection
    raise HTTPException(status_code=500, detail="Proposals collection not configured")


def _display_name_from_user(user: User) -> str:
    full_name = getattr(user, "full_name", None)
    if isinstance(full_name, str) and full_name.strip():
        return full_name.strip()

    first_name = getattr(user, "first_name", None)
    last_name = getattr(user, "last_name", None)
    combined = " ".join([str(part).strip() for part in [first_name, last_name] if part]).strip()
    if combined:
        return combined

    email = getattr(user, "email", None)
    if isinstance(email, str) and email.strip():
        return email.strip()

    return "Travailleur"


@api_router.post("/jobs/{job_id}/proposals")
async def create_job_proposal(job_id: str, proposal_data: dict, current_user: User = Depends(get_current_user)):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can apply to jobs")

    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if str(job.get("status") or "open").lower() not in {"open", "published", "active"}:
        raise HTTPException(status_code=400, detail="This job is not open for proposals")

    collection = _proposal_collection()
    existing = await collection.find_one({"job_id": job_id, "worker_id": current_user.id})
    if existing:
        return existing

    proposed_amount = proposal_data.get("proposed_amount")
    estimated_completion_time = str(proposal_data.get("estimated_completion_time") or proposal_data.get("estimated_duration") or "").strip()
    message = str(proposal_data.get("message") or proposal_data.get("cover_letter") or proposal_data.get("description") or "").strip()

    try:
        proposed_amount = float(proposed_amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "proposed_amount"], "msg": "Input should be a valid number"}])

    if proposed_amount <= 0:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "proposed_amount"], "msg": "Amount must be greater than zero"}])

    if not estimated_completion_time:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "estimated_completion_time"], "msg": "Estimated completion time is required"}])

    if len(message) < 10:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "message"], "msg": "Message must contain at least 10 characters"}])

    now_iso = datetime.now(timezone.utc).isoformat()
    proposal = {
        "id": str(uuid4()),
        "job_id": job_id,
        "client_id": job.get("client_id"),
        "worker_id": current_user.id,
        "worker_name": _display_name_from_user(current_user),
        "proposed_amount": proposed_amount,
        "estimated_completion_time": estimated_completion_time,
        "estimated_duration": estimated_completion_time,
        "message": message,
        "cover_letter": message,
        "description": message,
        "status": "pending",
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    result = await collection.insert_one(proposal)
    if not result.inserted_id:
        raise HTTPException(status_code=500, detail="Failed to create proposal")

    await db.jobs.update_one(
        {"id": job_id},
        {
            "$set": {"updated_at": now_iso},
            "$inc": {"proposals_count": 1},
        },
    )

    return proposal


@api_router.get("/jobs/{job_id}/proposals")
async def get_job_proposals(job_id: str, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    collection = _proposal_collection()
    query = {"job_id": job_id}

    is_owner = job.get("client_id") == current_user.id
    if not is_owner:
        if current_user.user_type != UserType.WORKER:
            raise HTTPException(status_code=403, detail="Access denied")
        query["worker_id"] = current_user.id

    cursor = collection.find(query).sort("created_at", -1)
    proposals = await cursor.to_list(length=200)
    return proposals


@api_router.put("/jobs/{job_id}")
async def update_job(job_id: str, job_data: dict, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("client_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_fields = {
        "title",
        "description",
        "category",
        "budget_min",
        "budget_max",
        "estimated_duration",
        "deadline",
        "urgency",
        "mechanic_must_bring_parts",
        "mechanic_must_bring_tools",
        "parts_and_tools_notes",
        "location",
        "status",
        "assigned_worker_id",
        "accepted_proposal_id",
    }

    updates = {key: value for key, value in (job_data or {}).items() if key in allowed_fields}
    if not updates:
        raise HTTPException(status_code=400, detail="No supported fields provided")

    collection = _proposal_collection()
    assigned_worker_id = updates.get("assigned_worker_id")
    accepted_proposal_id = updates.get("accepted_proposal_id")

    if assigned_worker_id:
        accepted_proposal = None
        if accepted_proposal_id:
            accepted_proposal = await collection.find_one({"job_id": job_id, "id": accepted_proposal_id, "worker_id": assigned_worker_id})
        if accepted_proposal is None:
            accepted_proposal = await collection.find_one({"job_id": job_id, "worker_id": assigned_worker_id})
        if accepted_proposal is None:
            raise HTTPException(status_code=422, detail="The selected worker has no proposal for this job")

        updates["assigned_worker_id"] = assigned_worker_id
        updates["accepted_proposal_id"] = accepted_proposal.get("id")
        updates["status"] = str(updates.get("status") or "assigned").strip().lower() or "assigned"

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.jobs.update_one({"id": job_id}, {"$set": updates})

    if assigned_worker_id:
        await collection.update_many({"job_id": job_id}, {"$set": {"updated_at": updates["updated_at"]}})
        await collection.update_one(
            {"job_id": job_id, "worker_id": assigned_worker_id},
            {"$set": {"status": "accepted", "updated_at": updates["updated_at"]}},
        )
        await collection.update_many(
            {"job_id": job_id, "worker_id": {"$ne": assigned_worker_id}},
            {"$set": {"status": "pending", "updated_at": updates["updated_at"]}},
        )

    updated_job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    return updated_job
