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
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.cors import CORSMiddleware

from kojo_core import (
    RateLimitMiddleware,
    WestAfricaSecurityMiddleware,
    _rate_limit_cleanup_loop,
    build_trusted_hosts,
    client,
    cloudinary_health_probe,
    create_database_indexes,
    db,
    ensure_owner_exists,
    is_database_available,
    request_counts,
)
from kojo_email import brevo_health_probe, generate_email_otp_code, hash_email_otp
from kojo_payments import (
    init_paydunya_circuit,
    paydunya_circuit_state,
    refresh_paydunya_circuit_from_db,
)
from kojo_scheduler import payout_stuck_sweeper_loop
from kojo_settings import APP_ENV, APP_VERSION, FRONTEND_APP_URL, logger


# ---------------------------------------------------------------------------
# Sentry (monitoring d'erreurs, OPTIONNEL — activé si SENTRY_DSN est défini)
# ---------------------------------------------------------------------------
def _init_sentry():
    dsn = os.environ.get('SENTRY_DSN', '').strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=dsn,
            environment=APP_ENV,
            traces_sample_rate=0.1,
            # Ne jamais envoyer de PII (emails, téléphones) à Sentry par défaut
            send_default_pii=False,
        )
        logger.info("✅ Sentry activé (backend)")
    except Exception as exc:  # pragma: no cover - dépend de la config serveur
        logger.warning(f"⚠️ Sentry non initialisé (backend): {exc}")


_init_sentry()

# Routers par domaine (chacun exporte `router`)
from kojo_routers_auth import router as auth_router
from kojo_routers_geo import router as geo_router
from kojo_routers_jobs import router as jobs_router
from kojo_routers_messages import router as messages_router
from kojo_routers_notifications import router as notifications_router
from kojo_routers_owner import router as owner_router
from kojo_routers_payments import router as payments_router
from kojo_routers_public import router as public_router
from kojo_routers_reviews import router as reviews_router
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


async def _health_payload() -> dict:
    """Payload partagé des health checks (/api/health et /health).

    Une seule source de vérité pour la version (APP_VERSION) et l'état DB :
    les deux routes ci-dessous l'appellent, plus de dérive possible entre
    /api/health et /health.

    L'état du circuit breaker GLOBAL PayDunya est exposé ici (et non seulement
    dans le dashboard owner) pour que les moniteurs d'infra et l'alerting
    tiers détectent une panne PayDunya SANS attendre le dashboard. Refresh
    préalable : l'état est partagé entre les workers. NB : `status` reste
    piloté par la DB — une panne PayDunya ne rend pas l'API « degraded »
    (les moniteurs ne redémarrent pas l'app à tort), le champ
    paydunya_circuit.state porte l'info.
    """
    db_available = await is_database_available()
    await refresh_paydunya_circuit_from_db()
    circuit = paydunya_circuit_state()
    return {
        "status": "healthy" if db_available else "degraded",
        "timestamp": datetime.now(timezone.utc),
        "database": "connected" if db_available else "unavailable",
        "version": APP_VERSION,
        "paydunya_circuit": {
            "state": circuit["state"],
            "consecutive_failures": circuit["consecutive_failures"],
            "failure_threshold": circuit["failure_threshold"],
            "remaining_cooldown_seconds": int(circuit["remaining_cooldown_seconds"]),
        },
    }


@api_router.get("/health")
async def health_check():
    return await _health_payload()


# Inclusion des routers par domaine
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(support_router)
api_router.include_router(notifications_router)
api_router.include_router(jobs_router)
api_router.include_router(messages_router)
api_router.include_router(geo_router)
api_router.include_router(payments_router)
api_router.include_router(reviews_router)
api_router.include_router(owner_router)
api_router.include_router(public_router)


# ---------------------------------------------------------------------------
# Routes racine hors /api (moniteurs d'infra : Render, UptimeRobot...)
# ---------------------------------------------------------------------------
@app.api_route("/", methods=["GET", "HEAD"])
async def app_root():
    """Racine de l'API pour les moniteurs et la découverte.

    Returns:
        dict: {message, status: "running"}.
    """
    return {"message": "Kojo API - Connecting Mali & Senegal", "status": "running"}


# Même payload que /api/health via _health_payload() — plus de dérive possible.
# Méthodes déclarées explicitement (GET + HEAD) pour les moniteurs d'infra.
@app.api_route("/health", methods=["GET", "HEAD"])
async def root_health_check():
    """Health check d'infra (Render/UptimeRobot).

    Returns:
        dict: {status, timestamp, database, version, paydunya_circuit} — voir
        _health_payload().
    """
    return await _health_payload()


async def _paydunya_monitor_payload() -> dict:
    """État du circuit breaker GLOBAL PayDunya pour les moniteurs d'infra
    (UptimeRobot, Render...). Refresh préalable depuis MongoDB : l'état est
    partagé entre les workers — un moniteur qui interroge un worker voit un
    circuit ouvert par un autre SANS que ce worker ait re-brûlé le seuil.

    Sémantique du statut HTTP :
    - 200 : circuit closed OU half_open (cooldown écoulé, une sonde est
      autorisée — PayDunya peut redevenir joignable, plus de fail fast).
    - 503 : circuit OPEN (fail fast actif — aucun appel réseau pendant le
      cooldown) : le propriétaire et les moniteurs sont alertés.

    Contrairement à /health (piloté par la DB, statut toujours « healthy »),
    cet endpoint est la SONDE dédiée à l'alerte PayDunya : un 503 déclenche
    les alertes UptimeRobot/Render sans faire redémarrer l'app (les moniteurs
    ne redémarrent pas sur 503, ils alertent).
    """
    await refresh_paydunya_circuit_from_db()
    circuit = paydunya_circuit_state()
    payload = {
        "service": "paydunya",
        "circuit": "open" if circuit["state"] == "open" else "ok",
        "paydunya_circuit": {
            "state": circuit["state"],
            "consecutive_failures": circuit["consecutive_failures"],
            "failure_threshold": circuit["failure_threshold"],
            "remaining_cooldown_seconds": int(circuit["remaining_cooldown_seconds"]),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return payload, circuit["state"]


# Sonde dédiée à l'état du circuit breaker PayDunya pour UptimeRobot/Render :
# 200 si PayDunya est opérationnel (ou en demi-ouverture = sonde autorisée),
# 503 si le circuit est OUVERT (panne fournisseur en cours, fail fast actif).
# Hors /api pour être directement pointable par les moniteurs d'infra.
@app.api_route("/monitor/paydunya", methods=["GET", "HEAD"])
async def monitor_paydunya():
    """Sonde PayDunya pour UptimeRobot/Render : 200 si le circuit est
    closed/half_open, 503 s'il est OUVERT (fail fast actif).

    Returns:
        dict: {service, circuit, paydunya_circuit, timestamp} — 503 quand
        circuit == "open".
    """
    payload, state = await _paydunya_monitor_payload()
    if state == "open":
        return JSONResponse(status_code=503, content=payload)
    return payload


async def _external_provider_monitor(probe, service: str):
    """Contrat commun /monitor/<service> pour les fournisseurs externes
    (Brevo, Cloudinary) : 200 quand le service répond, 503 sinon.

    Les sondes sont SYNC (requests / SDK cloudinary) et potentiellement
    lentes en cas de panne → exécutées dans un thread (asyncio.to_thread)
    pour ne pas bloquer l'event loop. Chaque sonde a son propre cache TTL
    interne (60 s) : les moniteurs qui interrogent toutes les 30-60 s ne
    martèlent pas le fournisseur.
    """
    result = await asyncio.to_thread(probe)
    payload = {
        "service": service,
        "circuit": "ok" if result.get("ok") else "down",
        "configured": result.get("configured", True),
        "detail": result.get("detail", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if not result.get("ok"):
        return JSONResponse(status_code=503, content=payload)
    return payload


# Sonde Brevo (email OTP, réinitialisation de mot de passe) : 200 si l'API
# répond, 503 sinon (config manquante, transport, HTTP erreur).
@app.api_route("/monitor/brevo", methods=["GET", "HEAD"])
async def monitor_brevo():
    """Sonde Brevo (email) : 200 si l'API répond, 503 sinon (config manquante,
    transport, HTTP erreur).

    Returns:
        dict: {service, circuit, configured, detail, timestamp} — 503 quand
        circuit == "down".
    """
    return await _external_provider_monitor(brevo_health_probe, "brevo")


# Sonde Cloudinary (photos de profil, portfolio) : 200 si l'Admin API répond
# au ping officiel, 503 sinon (config manquante, transport).
@app.api_route("/monitor/cloudinary", methods=["GET", "HEAD"])
async def monitor_cloudinary():
    """Sonde Cloudinary (photos) : 200 si l'Admin API répond au ping officiel,
    503 sinon (config manquante, transport).

    Returns:
        dict: {service, circuit, configured, detail, timestamp} — 503 quand
        circuit == "down".
    """
    return await _external_provider_monitor(cloudinary_health_probe, "cloudinary")


# Favicon & racine — cette API ne sert pas de frontend, mais les navigateurs/
# bots/moniteurs pingent GET /favicon.ico et GET / par défaut. Sans handler
# explicite, ce sont des 404 bruyants dans les logs Render. Un 204 (no
# content) pour le favicon garde les logs propres (correctif standard).
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Répond 204 (no content) aux pings de favicon des navigateurs/bots pour
    garder les logs propres (aucune forme de retour JSON)."""
    return Response(status_code=204)


app.include_router(api_router)

# ---------------------------------------------------------------------------
# CORS Configuration optimized for West Africa
# ---------------------------------------------------------------------------
WEST_AFRICA_ORIGINS = [
    "http://localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1:3000",
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
# *.vercel.app est une surface d'attaque évitable.
#
# Ordre de résolution :
#   1. VERCEL_PROJECT_NAME (explicite, recommandé)
#   2. FRONTEND_APP_URL s'il pointe vers *.vercel.app (dérivation automatique)
#   3. Hors production : ancien motif large *.vercel.app + avertissement
#   4. Production sans rien : FAIL-CLOSED (aucun sous-domaine *.vercel.app
#      accepté) plutôt que d'exposer un CORS credentialed ouvert — un
#      message d'erreur explicite indique la variable à définir.
_vercel_project_name = os.environ.get('VERCEL_PROJECT_NAME', '').strip()
if _vercel_project_name:
    _vercel_origin_pattern = rf"^https://{re.escape(_vercel_project_name)}(-[a-z0-9-]+)?\.vercel\.app$"
    logger.info(f"✅ CORS Vercel restreint au projet '{_vercel_project_name}'")
else:
    _frontend_netloc = ""
    if FRONTEND_APP_URL:
        try:
            _frontend_netloc = urlparse(FRONTEND_APP_URL).netloc or ""
        except ValueError:
            _frontend_netloc = ""
    if _frontend_netloc.endswith(".vercel.app"):
        _vercel_base = _frontend_netloc[: -len(".vercel.app")]
        _vercel_origin_pattern = rf"^https://{re.escape(_vercel_base)}(-[a-z0-9-]+)?\.vercel\.app$"
        logger.info(f"✅ CORS Vercel dérivé de FRONTEND_APP_URL ({_frontend_netloc})")
    elif not _is_prod:
        _vercel_origin_pattern = r"^https://.*\.vercel\.app$"
        logger.warning(
            "⚠️ VERCEL_PROJECT_NAME non défini - CORS accepte tout sous-domaine "
            "*.vercel.app (mode non-production uniquement). Définir "
            "VERCEL_PROJECT_NAME sur Render pour restreindre correctement."
        )
    else:
        # Production : refuser plutôt que d'ouvrir un CORS credentialed large.
        _vercel_origin_pattern = r"^(?!x)x$"
        logger.error(
            "🚨 CORS production : VERCEL_PROJECT_NAME non défini et FRONTEND_APP_URL "
            "ne pointe pas vers *.vercel.app → sous-domaines Vercel REFUSÉS "
            "(fail-closed). Définir VERCEL_PROJECT_NAME sur Render pour rétablir "
            "l'accès du frontend."
        )

# Les IP privées LAN (192.168.x / 10.x) ne sont autorisées qu'hors production :
# en prod elles élargiraient inutilement la surface CORS credentialed (réseau
# d'entreprise, VPN, réseau privé de plateforme hébergée).
_private_lan_pattern = (
    r"|^http://192\.168\.\d+\.\d+(:\d+)?$"
    r"|^http://10\.\d+\.\d+\.\d+(:\d+)?$"
) if not _is_prod else ""

allowed_origin_regex = (
    _vercel_origin_pattern
    + r"|^http://localhost(:\d+)?$"
    r"|^https://localhost(:\d+)?$"
    r"|^http://127\.0\.0\.1(:\d+)?$"
    + _private_lan_pattern
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
    expose_headers=["Content-Range", "X-Content-Range", "X-Kojo-CSRFToken"],
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

    # Circuit breaker GLOBAL PayDunya : recharge l'état persisté en MongoDB
    # (survit aux redéploiements, partagé entre les workers) et capture la
    # boucle principale pour les écritures thread-safe.
    try:
        await init_paydunya_circuit()
    except Exception as exc:
        logger.error(f"⚠️ init_paydunya_circuit() a échoué, démarrage poursuivi quand même: {exc}")

    # Tâches de fond stockées pour être annulées proprement au shutdown (évite
    # le warning "Task was destroyed but it is pending" et coupe la boucle).
    rate_limit_task = asyncio.create_task(_rate_limit_cleanup_loop())
    # Surveille les décaissements bloqués (releasing/refunding) : re-vérifie
    # PayDunya et alerte le propriétaire au-delà du seuil (kojo_scheduler).
    payout_sweeper_task = asyncio.create_task(payout_stuck_sweeper_loop())
    logger.info("✅ API Kojo prête!")

    yield  # l'application tourne ici

    # ---- SHUTDOWN ----
    rate_limit_task.cancel()
    payout_sweeper_task.cancel()
    try:
        await asyncio.gather(rate_limit_task, payout_sweeper_task)
    except asyncio.CancelledError:
        pass
    client.close()


# Exports utilisés par les tests (tests/conftest.py) et par uvicorn
__all__ = ["app", "api_router", "db", "request_counts",
           "hash_email_otp", "generate_email_otp_code"]
