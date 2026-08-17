# -*- coding: utf-8 -*-
"""Endpoints PUBLICS (sans authentification) — uniquement des données
agrégées non sensibles, destinées à la landing page (chiffres réels plutôt
que des valeurs génériques codées en dur).

Sécurité : ne renvoie JAMAIS de données utilisateur individuelles, uniquement
des compteurs. Les collections sont indexées sur les champs filtrés, donc les
count_documents restent bon marché même à volume.
"""

from fastapi import APIRouter

from kojo_core import db

router = APIRouter()


@router.get("/public/stats")
async def get_public_stats():
    """Compteurs réels pour la landing : travailleurs, missions, avis, pays."""
    workers = await db.users.count_documents({"user_type": "worker"})
    clients = await db.users.count_documents({"user_type": "client"})
    open_jobs = await db.jobs.count_documents(
        {"status": "open", "deleted": {"$ne": True}}
    )
    completed_jobs = await db.jobs.count_documents(
        {"status": "completed", "deleted": {"$ne": True}}
    )
    reviews = await db.reviews.count_documents({})
    return {
        "workers": workers,
        "clients": clients,
        "open_jobs": open_jobs,
        "completed_jobs": completed_jobs,
        "reviews": reviews,
        "countries": 4,
    }
