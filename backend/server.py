# -*- coding: utf-8 -*-
"""
Kojo API — point d'entrée FastAPI.

Ce fichier ne fait plus que : créer l'app et ses middlewares, inclure les
routers par domaine (kojo_routers_*), déclarer les routes racine et gérer le
cycle de vie (startup/shutdown). Toute la logique métier vit dans :
  - kojo_settings  : config (env, logging, secrets, constantes, en-têtes)
  - kojo_models    : modèles Pydantic + énumérations
  - kojo_core      : MongoDB, rate-limiting, middlewares de sécurité, auth
  - kojo_email     : OTP / vérification email / Brevo / Gmail
  - kojo_shared    : notifications (base + push web) et adresses mission
  - kojo_payments  : intégration PayDunya (factures, statuts, décaissements)
  - kojo_routers_* : endpoints HTTP par domaine
"""
import asyncio
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, FastAPI, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from kojo_core import (
    RateLimitMiddleware,
    WestAfricaSecurityMiddleware,
    _rate_limit_cleanup_loop,
    build_trusted_hosts,
    client,
    create_database_indexes,
    db,
    ensure_owner_exists,
    is_database_available,
    request_counts,
)
from kojo_email import generate_email_otp_code, hash_email_otp
from kojo_settings import APP_ENV, logger

# Routers par domaine (chacun exporte `router`)
from kojo_routers_auth import router as auth_router
from kojo_routers_geo import router as geo_router
from kojo_routers_jobs import router as jobs_router
from kojo_routers_messages import router as messages_router
from kojo_routers_notifications import router as notifications_router
from kojo_routers_owner import router as owner_router
from kojo_routers_payments import router as payments_router
from kojo_routers_support import router as support_router
from kojo_routers_users import router as users_router

# ---------------------------------------------------------------------------
# App principale (sans préfixe)
# ---------------------------------------------------------------------------
_is_prod = APP_ENV in ("production", "prod")
app = FastAPI(
    title="Kojo API",
    description="Service/Worker Platform for Mali & Senegal",
    # Désactive la documentation interactive en production — /docs et /redoc
    # exposent le schéma complet de l'API (noms de routes, modèles, types)
    # ce qui facilite la reconnaissance pour un attaquant. Inutile en prod
    # puisque le frontend n'en a pas besoin.
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)

# Middleware gzip (optimisation réseaux lents Afrique de l'Ouest)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ---------------------------------------------------------------------------
# Routes racine de l'API (/api, /api/health)
# ---------------------------------------------------------------------------
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Kojo API - Connecting Mali & Senegal", "status": "running"}


@api_router.get("/health")
async def health_check():
    db_available = await is_database_available()

    return {
        "status": "healthy" if db_available else "degraded",
        "timestamp": datetime.now(timezone.utc),
        "database": "connected" if db_available else "unavailable",
        "version": "1.0.0"
    }


# Inclusion des routers par domaine
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(support_router)
api_router.include_router(notifications_router)
api_router.include_router(jobs_router)
api_router.include_router(messages_router)
api_router.include_router(geo_router)
api_router.include_router(payments_router)
api_router.include_router(owner_router)


# ---------------------------------------------------------------------------
# Routes racine hors /api (moniteurs d'infra : Render, UptimeRobot...)
# ---------------------------------------------------------------------------
@app.api_route("/", methods=["GET", "HEAD"])
async def app_root():
    return {"message": "Kojo API - Connecting Mali & Senegal", "status": "running"}


# Ceci reflète /api/health ci-dessus ; garder les deux en phase si la logique
# change. Méthodes déclarées explicitement (GET + HEAD) pour la même raison.
@app.api_route("/health", methods=["GET", "HEAD"])
async def root_health_check():
    db_available = await is_database_available()

    return {
        "status": "healthy" if db_available else "degraded",
        "timestamp": datetime.now(timezone.utc),
        "database": "connected" if db_available else "unavailable",
        "version": "1.0.0"
    }


# Favicon & racine — cette API ne sert pas de frontend, mais les navigateurs/
# bots/moniteurs pingent GET /favicon.ico et GET / par défaut. Sans handler
# explicite, ce sont des 404 bruyants dans les logs Render. Un 204 (no
# content) pour le favicon garde les logs propres (correctif standard).
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


app.include_router(api_router)

# Serve uploaded files under /api prefix for proper Kubernetes ingress routing
# Le dossier doit exister AVANT le mount, car StaticFiles() vérifie sa présence
# immédiatement au chargement du module (avant même l'événement de démarrage
# de l'app) - sur un déploiement Render tout frais / après un git-filter-repo,
# le dossier n'existe plus dans le repo cloné, donc on le (re)crée ici.
os.makedirs("uploads", exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="uploads")

# ---------------------------------------------------------------------------
# CORS Configuration optimized for West Africa
# ---------------------------------------------------------------------------
WEST_AFRICA_ORIGINS = [
    "http://localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1:3000",
    "https://kojo-work.preview.emergentagent.com",
]

# Get additional origins from environment
env_origins = [origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip()]
allowed_origins = WEST_AFRICA_ORIGINS + env_origins

# Support public Vercel deployments and common development/private network origins.
# Exact origins from CORS_ORIGINS remain supported via allow_origins.
TRUSTED_HOSTS = build_trusted_hosts()
# Activé par défaut désormais: build_trusted_hosts() couvre déjà localhost,
# *.onrender.com, *.vercel.app et toute origine dérivée de FRONTEND_APP_URL /
# BACKEND_PUBLIC_URL / CORS_ORIGINS / TRUSTED_HOSTS, donc le risque de casser
# l'auth Render/Vercel est faible. Garde-fou de secours: mettre
# DISABLE_TRUSTED_HOST_MIDDLEWARE=true sur Render pour revenir à l'ancien
# comportement (désactivé) sans toucher au code, en cas de souci imprévu.
ENABLE_TRUSTED_HOST_MIDDLEWARE = os.environ.get('DISABLE_TRUSTED_HOST_MIDDLEWARE', '').strip().lower() not in {'1', 'true', 'yes', 'on'}
# VERCEL_PROJECT_NAME (recommandé): si défini, restreint le CORS aux seules
# preview/production deployments DU PROJET Vercel de Kojo
# (ex: kojo-frontend-*.vercel.app), au lieu d'accepter N'IMPORTE QUEL
# sous-domaine *.vercel.app - y compris ceux d'un projet Vercel gratuit
# créé par un tiers. allow_credentials=True + un motif aussi large que
# *.vercel.app est une surface d'attaque évitable. Tant que la variable
# n'est pas configurée sur Render, on retombe sur l'ancien motif large
# (pas de régression fonctionnelle immédiate) mais un avertissement est loggé.
_vercel_project_name = os.environ.get('VERCEL_PROJECT_NAME', '').strip()
if _vercel_project_name:
    _vercel_origin_pattern = rf"^https://{re.escape(_vercel_project_name)}(-[a-z0-9-]+)?\.vercel\.app$"
else:
    _vercel_origin_pattern = r"^https://.*\.vercel\.app$"
    logger.warning(
        "⚠️ VERCEL_PROJECT_NAME non défini - CORS accepte tout sous-domaine "
        "*.vercel.app (pas seulement ceux du projet Kojo). Définir "
        "VERCEL_PROJECT_NAME sur Render pour restreindre correctement."
    )

allowed_origin_regex = (
    _vercel_origin_pattern
    + r"|^http://localhost(:\d+)?$"
    r"|^https://localhost(:\d+)?$"
    r"|^http://127\.0\.0\.1(:\d+)?$"
    r"|^http://192\.168\.\d+\.\d+(:\d+)?$"
    r"|^http://10\.\d+\.\d+\.\d+(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=[
        "Accept",
        "Accept-Language",
        "Content-Language",
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-CSRFToken",
        "Cache-Control"
    ],
    expose_headers=["Content-Range", "X-Content-Range"],
    max_age=86400,
)

# Trusted Host Middleware can break Render/Vercel auth flows when platform hostnames rotate.
# Keep it opt-in via environment flag so production can enable it deliberately.
if ENABLE_TRUSTED_HOST_MIDDLEWARE:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=TRUSTED_HOSTS
    )

# Middlewares de sécurité + rate-limiting (ordre d'empilement : le dernier
# add_middleware est le plus externe).
app.add_middleware(WestAfricaSecurityMiddleware)
app.add_middleware(RateLimitMiddleware)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """
    Gestionnaire de cycle de vie de l'application (remplace les anciens
    @app.on_event('startup') / @app.on_event('shutdown') dépréciés depuis
    FastAPI 0.93 / Starlette 0.27). Tout ce qui est avant le `yield` s'exécute
    au démarrage, tout ce qui est après au shutdown.
    """
    # ---- STARTUP ----
    logger.info("🚀 Démarrage de l'API Kojo...")

    try:
        await ensure_owner_exists()
    except Exception as exc:
        logger.error(f"⚠️ ensure_owner_exists() a échoué, démarrage poursuivi quand même: {exc}")

    try:
        await create_database_indexes()
    except Exception as exc:
        logger.error(f"⚠️ create_database_indexes() a échoué, démarrage poursuivi quand même: {exc}")

    Path("uploads").mkdir(exist_ok=True)
    logger.info("📁 Dossier uploads créé/vérifié")

    asyncio.create_task(_rate_limit_cleanup_loop())
    logger.info("✅ API Kojo prête!")

    yield  # l'application tourne ici

    # ---- SHUTDOWN ----
    client.close()


# Exports utilisés par les tests (tests/conftest.py) et par uvicorn
__all__ = ["app", "api_router", "db", "request_counts",
           "hash_email_otp", "generate_email_otp_code"]
