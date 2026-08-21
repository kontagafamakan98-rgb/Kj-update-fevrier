import asyncio
import re
from bson import ObjectId
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from kojo_core import db
from kojo_shared import _send_payment_pending_to_worker
from kojo_models import (
    Job, JobCreate, JobProposal,
    JobStatus, Message, NotificationType, ProposalCreate, User, UserType,
    WorkerProfile,
)
from kojo_settings import (
    OWNER_EMAIL,
    REFERRAL_FILLEUL_REWARD,
    REFERRAL_SPONSOR_REWARD,
    logger,
)
from kojo_core import (
    get_current_user,
)
from kojo_shared import notify_user_localized, _dispatch_address_to_worker
from kojo_payments import (
    build_disburse_callback_url,
    create_paydunya_disburse_invoice, get_paydunya_withdraw_mode,
    strip_country_code_for_disburse, submit_paydunya_disburse_invoice,
)

router = APIRouter()


def _job_identifier_query(job_id: str) -> dict:
    """Find current and legacy jobs regardless of the stored identifier field."""
    candidates = [{"id": job_id}, {"job_id": job_id}]
    if ObjectId.is_valid(job_id):
        candidates.append({"_id": ObjectId(job_id)})
    return {"$or": candidates}


async def _maybe_award_first_job_referral_reward(worker_id: str, job_id: str, job_title: str) -> None:
    """Crédite la récompense de parrainage quand le filleul termine sa PREMIÈRE
    mission : le parrain reçoit REFERRAL_SPONSOR_REWARD et le filleul reçoit
    REFERRAL_FILLEUL_REWARD (FCFA).

    Idempotent : un compte ne touche sa récompense qu'une seule fois (le flag
    referral_first_job_rewarded est posé à la première mission terminée), et
    un code invalide/absent est ignoré silencieusement (non bloquant).
    """
    try:
        worker = await db.users.find_one({"id": worker_id}, {"referred_by": 1, "referral_first_job_rewarded": 1})
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
            {"id": worker_id},
            {
                "$set": {"referral_first_job_rewarded": True, "updated_at": now},
                "$inc": {"referral_reward_balance": REFERRAL_FILLEUL_REWARD},
                "$push": {"referral_rewards": {**reward_record, "role": "filleul", "amount": REFERRAL_FILLEUL_REWARD}},
            },
        )

        # Crédit du parrain
        await db.users.update_one(
            {"id": sponsor["id"]},
            {
                "$inc": {"referral_reward_balance": REFERRAL_SPONSOR_REWARD},
                "$push": {"referral_rewards": {**reward_record, "role": "parrain", "amount": REFERRAL_SPONSOR_REWARD}},
            },
        )

        # Notifications pour les deux (dans leur langue préférée)
        asyncio.create_task(notify_user_localized(
            user_id=worker_id,
            key="bonus_filleul_first_mission",
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            job_title=job_title,
            amount=REFERRAL_FILLEUL_REWARD,
        ))
        asyncio.create_task(notify_user_localized(
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


@router.post("/workers/profile")
async def create_worker_profile(
    profile_data: WorkerProfile,
    current_user: User = Depends(get_current_user)
):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can create worker profiles")
    
    profile_data.user_id = current_user.id
    await db.worker_profiles.insert_one(profile_data.model_dump())
    return {"message": "Worker profile created successfully"}

@router.get("/workers/profile")
async def get_worker_profile(current_user: User = Depends(get_current_user)):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Access denied")
    
    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    if not profile:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    return WorkerProfile(**profile)


@router.put("/workers/profile")
async def update_worker_profile(
    profile_data: WorkerProfile,
    current_user: User = Depends(get_current_user)
):
    """Met à jour le profil travailleur (spécialités, portfolio, description…).

    Le frontend gère le portfolio (ajout/suppression de photos) via
    /users/portfolio ; ce PUT sert à la mise à jour globale du profil.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can update worker profiles")

    profile_data.user_id = current_user.id
    existing = await db.worker_profiles.find_one({"user_id": current_user.id})
    if not existing:
        await db.worker_profiles.insert_one(profile_data.model_dump())
    else:
        await db.worker_profiles.update_one(
            {"user_id": current_user.id},
            {"$set": profile_data.model_dump(exclude={"created_at"})},
        )
    return profile_data.model_dump()


async def _notify_matching_workers(job: Job):
    """Notifie par push les travailleurs dont les spécialités correspondent à la
    catégorie du job (repli : travailleurs du même pays). Fire-and-forget : une
    erreur ici ne doit jamais faire échouer la création du job.
    """
    try:
        category = (job.category or '').strip().lower()
        if not category:
            return

        # 1) Travailleurs dont une spécialité = catégorie du job (insensible à la casse)
        profiles = await db.worker_profiles.find({
            "specialties": {"$regex": f"^{re.escape(category)}$", "$options": "i"},
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
                await notify_user_localized(
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
            # JobCreate ne connaît qu'un sous-ensemble de champs. Le frontend
            # peut envoyer des champs supplémentaires (job_type, location_text,
            # urgency, etc.) que Pydantic rejetterait avec une 422 si on les
            # passe tels quels. On ne garde que les champs reconnus par le modèle.
            jobcreate_fields = set(JobCreate.model_fields.keys())
            filtered_for_validation = {k: v for k, v in incoming.items() if k in jobcreate_fields}
            validated_input = JobCreate(**filtered_for_validation)
        except Exception as validation_error:
            raise HTTPException(status_code=422, detail=str(validation_error))

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

@router.get("/jobs", response_model=List[Job])
async def get_jobs(
    status: Optional[JobStatus] = None,
    category: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
    # Recherche par rayon côté serveur : seuls les jobs portant un point
    # GeoJSON (geo) dans le rayon entrent en compte. Sans lat/lng/radius_km
    # complets, le filtre ne s'applique pas (comportement inchangé).
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
    radius_km: Optional[float] = Query(default=None, ge=0.1, le=2000),
    current_user: User = Depends(get_current_user)
):
    try:
        query = {}
        if status:
            query["status"] = status
        if category:
            query["category"] = category

        # Rayon : $geoWithin + $centerSphere (rayon en radians = km / 6371).
        # Nécessite l'index 2dsphere sur jobs.geo (créé au boot).
        if lat is not None and lng is not None and radius_km is not None:
            query["geo"] = {
                "$geoWithin": {
                    "$centerSphere": [[lng, lat], float(radius_km) / 6371.0]
                }
            }

        query["deleted"] = {"$ne": True}
        
        is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
        if not is_owner_user:
            query["$or"] = [
                {"country": current_user.country},
                {"country": {"$exists": False}},
                {"country": None}
            ]

        jobs = await db.jobs.find(query).sort("created_at", -1).to_list(limit)
        
        logger.debug(f"✅ Retrieved {len(jobs)} jobs for user {current_user.id}")
        return [Job(**job) for job in jobs]
        
    except Exception as e:
        logger.error(f"❌ Failed to retrieve jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving jobs")

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    job_country = job.get("country")
    if not is_owner_user and job_country and job_country != current_user.country:
        raise HTTPException(status_code=403, detail="Ce job n'appartient pas à votre pays.")
        
    return Job(**job)

async def execute_paydunya_refund(payment_record: dict) -> str:
    """Exécute le remboursement d'un paiement séquestré vers le compte mobile
    money du payeur (Orange Money en priorité, sinon Wave). Retourne le statut
    final : "refunded", "refunding" ou "refund_failed".

    Appelée par delete_job (annulation d'une mission payée) et par l'endpoint
    owner de relance (kojo_routers_owner.retry_payment_refund). Le verrou CAS
    (held/release_failed/refund_failed → refunding) est posé PAR LES APPELANTS
    avant l'appel — cette fonction n'exécute que le versement et les mises à
    jour de statut.

    Anti double-remboursement :
    - Un échec EXPLICITE (get-invoice refusé, réponse négative au submit) →
      "refund_failed" : PayDunya n'a rien exécuté, une relance est sûre.
    - Une réponse INCERTAINE (exception réseau pendant le submit) →
      "refunding" : PayDunya a peut-être exécuté le versement ; seule l'IPN
      ou un check-status pourra trancher. Marquer un échec définitif ici
      permettrait une relance → double remboursement.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    payer = await db.users.find_one({"id": payment_record.get("payer_id")})
    payer_accounts = (payer or {}).get("payment_accounts") or {}
    refund_method = None
    refund_phone = None
    if payer_accounts.get("orange_money"):
        refund_method, refund_phone = "orange_money", payer_accounts["orange_money"]
    elif payer_accounts.get("wave"):
        refund_method, refund_phone = "wave", payer_accounts["wave"]

    if not refund_method or not refund_phone:
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "refund_failed",
                "payout_failure_reason": "Le client n'a pas de compte Orange Money ou Wave configuré",
                "updated_at": now_iso,
            }}
        )
        return "refund_failed"

    try:
        withdraw_mode = get_paydunya_withdraw_mode(
            refund_method, (payer or {}).get("country")
        )
        account_alias = strip_country_code_for_disburse(refund_phone)
        invoice = create_paydunya_disburse_invoice(
            account_alias=account_alias,
            amount=payment_record.get("amount") or 0,
            withdraw_mode=withdraw_mode,
            callback_url=build_disburse_callback_url(),
        )
        disburse_token = invoice.get("disburse_token")
    except HTTPException as exc:
        # get-invoice REFUSÉ : PayDunya n'a rien exécuté → échec sûr, relançable.
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "refund_failed",
                "payout_failure_reason": str(exc.detail),
                "updated_at": now_iso,
            }}
        )
        return "refund_failed"
    except Exception as exc:
        logger.error(f"⚠️ Erreur inattendue lors de la préparation du remboursement: {exc}")
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "refund_failed",
                "payout_failure_reason": "Erreur inattendue lors de la préparation du remboursement",
                "updated_at": now_iso,
            }}
        )
        return "refund_failed"

    # Token persisté AVANT le submit : si le submit lève (timeout réseau), le
    # paiement reste identifiable et confirmable via l'IPN ou un check-status.
    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "disburse_token": disburse_token,
            "payout_kind": "refund",
            "updated_at": now_iso,
        }}
    )

    try:
        submit_result = submit_paydunya_disburse_invoice(
            disburse_token,
            disburse_id=f"refund_{payment_record['id']}",
        )
    except Exception as exc:
        # Réponse INCERTAINE : on reste "refunding" (à confirmer par l'IPN ou
        # check-status) plutôt que "refund_failed" — voir docstring.
        logger.error(f"⚠️ Réponse incertaine du submit PayDunya (remboursement): {exc}")
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "refunding",
                "disburse_error": f"Réponse incertaine du submit: {exc}",
                "updated_at": now_iso,
            }}
        )
        return "refunding"

    provider_status = str(
        submit_result.get("status")
        or ("success" if str(submit_result.get("response_code")) == "00" else "failed")
    ).strip().lower()

    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "disburse_provider_response": submit_result,
            "updated_at": now_iso,
        }}
    )

    if provider_status == "success":
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {"payout_status": "refunded"}}
        )
        return "refunded"
    if provider_status == "pending":
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {"payout_status": "refunding"}}
        )
        return "refunding"

    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "payout_status": "refund_failed",
            "payout_failure_reason": submit_result.get("response_text") or "Échec du remboursement PayDunya",
        }}
    )
    return "refund_failed"


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({
        "$and": [
            _job_identifier_query(job_id),
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
            {"id": payment_record["id"], "payout_status": payout_status},
            {"$set": {
                "payout_status": "refunding",
                "payout_kind": "refund",
                "updated_at": now_iso,
            }}
        )
        if lock_result.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail="Un remboursement est déjà en cours pour cette mission"
            )

        refund_outcome = await execute_paydunya_refund(payment_record)
        refunded_amount = payment_record.get("amount")

    await db.jobs.update_one(
        _job_identifier_query(job_id),
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
        asyncio.create_task(notify_user_localized(
            user_id=payment_record.get("payer_id"),
            key=cancel_key,
            notif_type=NotificationType.GENERAL,
            related_id=stored_job_id,
            related_type="job",
            job_title=job_title,
            amount=refunded_amount,
        ))
        if worker_id_for_notif:
            asyncio.create_task(notify_user_localized(
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

@router.post("/jobs/{job_id}/proposals")
async def create_proposal(
    job_id: str,
    proposal_data: ProposalCreate,
    current_user: User = Depends(get_current_user)
):
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
        worker_name = f"{current_user.first_name} {current_user.last_name}".strip() or "Un travailleur"
        asyncio.create_task(notify_user_localized(
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
        await _dispatch_address_to_worker(
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
        await _send_payment_pending_to_worker(
            job=updated_job,
            worker_id=worker_id,
            sender_id=current_user.id,
        )

    # Notifier le travailleur que sa proposition a été acceptée (sa langue)
    client_name = f"{current_user.first_name} {current_user.last_name}".strip() or "Le client"
    asyncio.create_task(notify_user_localized(
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
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
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
        await db.jobs.update_one({"id": job_id}, {"$set": {"status": JobStatus.COMPLETED.value}})
        await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))
        updated_job = await db.jobs.find_one({"id": job_id})
        return {"message": "Mission déjà clôturée et paiement déjà versé", "job": Job(**updated_job).model_dump(), "payout_status": "released"}
    if current_payout_status == "releasing":
        raise HTTPException(status_code=409, detail="Un versement est déjà en cours pour ce paiement, réessayez dans un instant")

    # Verrou : marquer "releasing" seulement si toujours "held", pour eviter
    # un double-versement en cas de double-clic/appel concurrent.
    lock_result = await db.payments.update_one(
        {"id": payment_record["id"], "payout_status": current_payout_status},
        {"$set": {"payout_status": "releasing", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if lock_result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Un versement est déjà en cours pour ce paiement, réessayez dans un instant")

    worker = await db.users.find_one({"id": worker_id})
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
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "release_failed",
                "payout_failure_reason": reason,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        await db.jobs.update_one({"id": job_id}, {"$set": {"status": JobStatus.COMPLETED.value}})
        await _maybe_award_first_job_referral_reward(worker_id, job_id, job.get("title", ""))

    if not payout_method or not payout_phone:
        await _mark_release_failed("Le travailleur n'a pas de compte Orange Money ou Wave configuré")
        updated_job = await db.jobs.find_one({"id": job_id})
        return {
            "message": "Mission clôturée, mais le versement automatique est impossible : le travailleur n'a pas de compte Orange Money ou Wave enregistré. Un versement manuel est nécessaire.",
            "job": Job(**updated_job).model_dump(),
            "payout_status": "release_failed",
        }

    withdraw_mode = get_paydunya_withdraw_mode(payout_method, worker.get("country"))
    account_alias = strip_country_code_for_disburse(payout_phone)

    try:
        invoice = create_paydunya_disburse_invoice(
            account_alias=account_alias,
            amount=worker_amount,
            withdraw_mode=withdraw_mode,
            callback_url=build_disburse_callback_url(),
        )
        disburse_token = invoice.get("disburse_token")
    except HTTPException as exc:
        # get-invoice REFUSÉ : PayDunya n'a rien exécuté → échec sûr, relançable.
        await _mark_release_failed(str(exc.detail))
        updated_job = await db.jobs.find_one({"id": job_id})
        return {
            "message": f"Mission clôturée, mais le versement automatique a échoué ({exc.detail}). Un versement manuel est nécessaire.",
            "job": Job(**updated_job).model_dump(),
            "payout_status": "release_failed",
        }
    except Exception as exc:
        logger.error(f"⚠️ Erreur inattendue lors de la préparation du versement: {exc}")
        await _mark_release_failed("Erreur inattendue lors de la préparation du versement")
        updated_job = await db.jobs.find_one({"id": job_id})
        return {
            "message": "Mission clôturée, mais le versement automatique a échoué. Un versement manuel est nécessaire.",
            "job": Job(**updated_job).model_dump(),
            "payout_status": "release_failed",
        }

    # Token persisté AVANT le submit : si le submit lève (timeout réseau), le
    # versement reste identifiable et confirmable via l'IPN ou un check-status.
    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "disburse_token": disburse_token,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )

    try:
        submit_result = submit_paydunya_disburse_invoice(disburse_token, disburse_id=payment_record["id"])
    except Exception as exc:
        # Réponse INCERTAINE (timeout réseau…) : PayDunya a peut-être exécuté
        # le versement. On garde "releasing" (confirmation par l'IPN ou un
        # check-status) au lieu de "release_failed" : un échec définitif
        # permettrait une relance → risque de DOUBLE versement au travailleur.
        logger.error(f"⚠️ Réponse incertaine du submit PayDunya (versement travailleur): {exc}")
        await db.payments.update_one(
            {"id": payment_record["id"]},
            {"$set": {
                "payout_status": "releasing",
                "disburse_error": f"Réponse incertaine du submit: {exc}",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        final_payout_status = "releasing"
    else:
        provider_status = str(
            submit_result.get("status")
            or ("success" if str(submit_result.get("response_code")) == "00" else "failed")
        ).strip().lower()

        await db.payments.update_one(
            {"id": payment_record["id"]},
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
                {"id": payment_record["id"]},
                {"$set": {"payout_failure_reason": submit_result.get("response_text") or "Échec du versement PayDunya"}}
            )

        await db.payments.update_one({"id": payment_record["id"]}, {"$set": {"payout_status": final_payout_status}})

    await db.jobs.update_one({"id": job_id}, {"$set": {"status": JobStatus.COMPLETED.value}})
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

    asyncio.create_task(notify_user_localized(
        user_id=worker_id,
        key=payment_key,
        notif_type=NotificationType.PAYMENT_RECEIVED,
        related_id=job_id,
        related_type="job",
        job_title=job.get("title") or "",
        amount=worker_amount,
    ))

    # Notifier le client que la mission est bien clôturée
    asyncio.create_task(notify_user_localized(
        user_id=current_user.id,
        key="mission_closed",
        notif_type=NotificationType.JOB_COMPLETED,
        related_id=job_id,
        related_type="job",
        job_title=job.get("title") or "",
    ))

    updated_job = await db.jobs.find_one({"id": job_id})
    return {
        "message": "Mission clôturée avec succès",
        "job": Job(**updated_job).model_dump(),
        "payout_status": final_payout_status,
    }

@router.get("/proposals/mine")
async def get_my_proposals(current_user: User = Depends(get_current_user)):
    """
    Liste des propositions envoyées par le travailleur connecté, tous jobs
    confondus - permet au frontend d'afficher fiablement "déjà postulé" en
    se basant sur des données serveur, au lieu d'un simple marqueur
    localStorage (qui se perd en changeant d'appareil/navigateur ou en
    vidant le cache, ce qui laissait l'utilisateur postuler une 2e fois et
    tomber sur une erreur "vous avez déjà postulé").
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
