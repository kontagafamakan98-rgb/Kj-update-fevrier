# -*- coding: utf-8 -*-
"""Profil travailleur (`/workers/profile`) — création, lecture, mise à jour.

Extrait de `kojo_routers_jobs.py` sans changement de comportement : la surface
publique de ces routes (méthode, chemin, dépendances, modèle de réponse) est
figée par `tests/job_route_surface.json`.
"""
from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db, get_current_user
from kojo_models import User, UserType, WorkerProfile

router = APIRouter()

@router.post("/workers/profile")
async def create_worker_profile(
    profile_data: WorkerProfile,
    current_user: User = Depends(get_current_user)
):
    """Crée le profil travailleur (réservé au rôle WORKER).

    Returns:
        dict: {message: "Worker profile created successfully"}.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can create worker profiles")
    
    profile_data.user_id = current_user.id
    await db.worker_profiles.insert_one(profile_data.model_dump())
    return {"message": "Worker profile created successfully"}

@router.get("/workers/profile")
async def get_worker_profile(current_user: User = Depends(get_current_user)):
    """Profil travailleur de l'utilisateur connecté (404 si inexistant).

    Returns:
        WorkerProfile: objet profil travailleur complet.
    """
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

    Returns:
        dict: {message: "Worker profile updated successfully"}.
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
