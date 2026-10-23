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
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.cors import CORSMiddleware

from kojo_core import (
    RateLimitMiddleware,
    RequestIdMiddleware,
    WestAfricaSecurityMiddleware,
    _rate_limit_cleanup_loop,
    build_allowed_origins,
    build_trusted_hosts,
    client,
    cloudinary_health_probe,
    create_database_indexes,
    db,
    ensure_owner_exists,
    is_database_available,
    request_counts,
)
from kojo_email import (
    active_email_provider_health_probe,
    brevo_health_probe,
    generate_email_otp_code,
    hash_email_otp,
)
from kojo_metrics import (
    CHEMIN as METRICS_PATH,
    CONTENT_TYPE as METRICS_CONTENT_TYPE,
    jeton_attendu as metrics_token_configured,
    jeton_valide as metrics_token_valid,
    rendre as render_metrics,
)
from kojo_payments import (
    init_paydunya_circuit,
    paydunya_circuit_state,
    refresh_paydunya_circuit_from_db,
)
import kojo_live
from kojo_scheduler import (
    completion_auto_release_loop,
    compter_missions_ouvertes,
    email_provider_alert_loop,
    job_alert_digest_loop,
    litige_arbitrage_alert_loop,
    litige_expiry_loop,
    marche_vide_alert_loop,
    missions_sans_proposition_alert_loop,
    payout_stuck_sweeper_loop,
    retention_purge_loop,
)
from kojo_settings import APP_ENV, APP_REVISION, APP_VERSION, FRONTEND_APP_URL, logger


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
# Webhooks email du fournisseur (rebonds, plaintes) : famille « email », une
# route publique non authentifiée dont la seule preuve d'identité est la
# signature de la requête.
from kojo_routers_email import router as email_router
from kojo_routers_geo import router as geo_router
from kojo_routers_jobs import router as jobs_router
from kojo_routers_messages import router as messages_router
from kojo_routers_notifications import router as notifications_router
from kojo_routers_owner import router as owner_router
from kojo_routers_payments import router as payments_router
# Alertes emploi (kojo_job_alerts) : le résumé périodique qui ramène un
# travailleur sur une mission publiée après sa visite.
from kojo_routers_job_alerts import router as job_alerts_router
from kojo_routers_public import router as public_router
from kojo_routers_reviews import router as reviews_router
from kojo_routers_support import router as support_router
from kojo_routers_users import router as users_router
# Profil PUBLIC d'un travailleur : la réputation qu'un client peut lire avant
# de confier une mission (allowlist stricte, voir le module).
from kojo_routers_workers_public import router as workers_public_router

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

    Une seule source de vérité pour la version (APP_VERSION), la RÉVISION
    SERVIE (APP_REVISION) et l'état DB : les deux routes ci-dessous l'appellent,
    plus de dérive possible entre /api/health et /health.

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
        # Le commit dont l'image a été construite (injecté au build par
        # `--build-arg KOJO_GIT_SHA`, cf. kojo_settings.APP_REVISION). Publié ici
        # pour que le déploiement soit VÉRIFIABLE de l'extérieur : le job CI
        # compare cette réponse au commit poussé et rougit sinon.
        "revision": APP_REVISION or "inconnue",
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
api_router.include_router(email_router)
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
# APRÈS `jobs_router` : `/workers/profile` (route authentifiée, déclarée par
# `kojo_routers_jobs_workers`) doit gagner sur `/workers/{worker_id}`. L'ordre
# d'enregistrement décide, et `tests/surface/` fige la surface route par route.
api_router.include_router(workers_public_router)
# Alertes emploi : routes `job-alerts` (lire/régler/couper) et le lien public de
# désinscription. Aucun conflit de chemin avec `jobs_router` — `job-alerts`
# n'est pas un préfixe de `jobs`, et l'ordre n'y change rien.
api_router.include_router(job_alerts_router)


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
    (Brevo, Cloudinary, fournisseur email actif) : 200 quand le service
    répond, 503 sinon.

    Les sondes sont SYNC (requests / SDK cloudinary) et potentiellement
    lentes en cas de panne → exécutées dans un thread (asyncio.to_thread)
    pour ne pas bloquer l'event loop. Chaque sonde a son propre cache TTL
    interne (60 s) : les moniteurs qui interrogent toutes les 30-60 s ne
    martèlent pas le fournisseur.
    """
    result = await asyncio.to_thread(probe)
    payload = {"service": service}
    # Le fournisseur email est le seul dont l'identité dépend d'une variable :
    # sans `provider`, un vert ne dit pas QUI a été jugé — et un moniteur qui
    # croit surveiller Resend pendant que Brevo envoie ne mesure rien.
    if result.get("provider"):
        payload["provider"] = result["provider"]
    if result.get("provider_note"):
        payload["provider_note"] = result["provider_note"]
    payload.update({
        "circuit": "ok" if result.get("ok") else "down",
        "configured": result.get("configured", True),
        "detail": result.get("detail", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
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


# Sonde du fournisseur email ACTIF (EMAIL_PROVIDER) : 200 si sa clé répond et
# que l'expéditeur est réellement utilisable, 503 sinon. `/monitor/brevo` juge
# Brevo — qui n'est peut-être plus celui qui envoie ; un nom de fournisseur
# inconnu retombant sur Brevo, la sonde le nomme dans `provider_note`.
@app.api_route("/monitor/email", methods=["GET", "HEAD"])
async def monitor_email():
    """Sonde email du fournisseur ACTIF : 200 si sa clé répond et que
    l'expéditeur peut écrire à un vrai destinataire, 503 sinon (config
    manquante, transport, clé refusée, expéditeur inutilisable).

    Returns:
        dict: {service, provider, circuit, configured, detail, timestamp}
        (+ provider_note quand le nom configuré est retombé sur Brevo) — 503
        quand circuit == "down".
    """
    return await _external_provider_monitor(active_email_provider_health_probe, "email")


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


async def _composite_monitor_payload() -> tuple[dict, list]:
    """Sonde les fournisseurs externes (PayDunya, email, Brevo, Cloudinary) en
    parallèle et consolide leur état pour l'alerte AGRÉGÉE.

    Chaque fournisseur est évalué avec son contrat habituel :
    - PayDunya   : "down" si le circuit est OPEN (half_open = sonde autorisée),
    - email      : "down" si le fournisseur ACTIF échoue (config manquante,
      transport, clé refusée, expéditeur inutilisable),
    - Brevo/Cloudinary : "down" si la sonde échoue (transport, HTTP erreur,
      config manquante).

    L'entrée `brevo` DISPARAÎT quand Brevo est le fournisseur actif : l'entrée
    `email` le juge alors déjà (et plus finement, jusqu'à l'expéditeur). La
    garder compterait la même panne deux fois, et une panne Brevo isolée
    déclencherait seule le 503 — ce que le seuil existe précisément pour
    éviter.

    Les sondes sync (requests / SDK cloudinary) tournent dans des threads via
    asyncio.gather + to_thread : l'event loop n'est jamais bloqué, et les
    caches TTL 60 s internes de chaque sonde protègent les fournisseurs quand
    le moniteur interroge fréquemment.

    Returns:
        (dict, list): payload consolidé {service, circuit, total, down,
        threshold, providers, timestamp} + liste des fournisseurs down.
    """
    paydunya_payload, paydunya_state = await _paydunya_monitor_payload()
    brevo_result, cloudinary_result, email_result = await asyncio.gather(
        asyncio.to_thread(brevo_health_probe),
        asyncio.to_thread(cloudinary_health_probe),
        asyncio.to_thread(active_email_provider_health_probe),
    )
    providers = {
        "paydunya": {
            "circuit": "open" if paydunya_state == "open" else "ok",
            "configured": True,
            "detail": f"circuit {paydunya_state}",
        },
        "email": {
            "circuit": "ok" if email_result.get("ok") else "down",
            "configured": email_result.get("configured", True),
            "detail": email_result.get("detail", ""),
            "provider": email_result.get("provider", ""),
        },
    }
    # Pas de double comptage : quand Brevo EST le fournisseur actif, l'entrée
    # `email` le couvre déjà. Une même panne comptée deux fois ferait pager une
    # panne isolée, alors que le seuil est fait pour l'ignorer.
    if email_result.get("provider") != "brevo":
        providers["brevo"] = {
            "circuit": "ok" if brevo_result.get("ok") else "down",
            "configured": brevo_result.get("configured", True),
            "detail": brevo_result.get("detail", ""),
        }
    providers["cloudinary"] = {
        "circuit": "ok" if cloudinary_result.get("ok") else "down",
        "configured": cloudinary_result.get("configured", True),
        "detail": cloudinary_result.get("detail", ""),
    }
    down = [name for name, info in providers.items() if info["circuit"] != "ok"]
    payload = {
        "service": "composite",
        "circuit": "degraded" if down else "ok",
        "total": len(providers),
        "down": len(down),
        "providers": providers,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    # Conserve la ligne circuit PayDunya de la sonde dédiée pour le debugging.
    payload["paydunya_circuit"] = paydunya_payload["paydunya_circuit"]
    return payload, down


# Healthcheck composite pour l'alerte AGRÉGÉE : 503 si AU MOINS `threshold`
# fournisseurs externes sont down (défaut 2). UptimeRobot/Render pointent
# cette sonde : un fournisseur isolé qui flappe n'alerte pas, mais une panne
# multi-fournisseurs (ou générale) déclenche immédiatement. Le nombre de
# fournisseurs dépend de la config : l'entrée `brevo` s'efface quand Brevo est
# le fournisseur email ACTIF (l'entrée `email` le couvre), donc `total` vaut 3
# ou 4 et le seuil reste un NOMBRE de pannes, pas une fraction.
@app.api_route("/monitor", methods=["GET", "HEAD"])
async def monitor_composite(
    threshold: int = Query(default=2, ge=1, le=4, description="Nombre de fournisseurs down déclenchant le 503"),
):
    """Healthcheck composite des fournisseurs externes (PayDunya, email actif,
    Brevo, Cloudinary) : 503 si AU MOINS `threshold` d'entre eux sont down
    (défaut 2), 200 sinon. Payload consolidé listant l'état de chaque
    fournisseur — `email` porte le nom du fournisseur réellement jugé.

    Returns:
        dict: {service, circuit, total, down, threshold, providers,
        paydunya_circuit, timestamp} — 503 quand down >= threshold.
    """
    payload, down = await _composite_monitor_payload()
    payload["threshold"] = threshold
    if len(down) >= threshold:
        return JSONResponse(status_code=503, content=payload)
    return payload


# ---------------------------------------------------------------------------
# Métriques Prometheus — protégées, et FERMÉES par défaut
# ---------------------------------------------------------------------------
# Les compteurs servis ici sont ceux que le produit tient DÉJÀ (bus temps réel,
# plafonds et compteurs de flux, repli du rate-limiter, échecs de révocation) :
# aucun n'est mesuré à la demande, et la route ne fait aucune I/O. Elle existe
# pour qu'une dérive lente se voie sur un tableau de bord au lieu d'exiger un
# shell — et elle est PROTÉGÉE parce qu'elle décrit la topologie interne.
#
# Collecte (scrape, secret, cadence) : `backend/METRIQUES.md`. Hors `/api`,
# comme les autres moniteurs d'infra : Prometheus n'a pas de cookie de session,
# et le jeton est la seule preuve d'accès.
@app.api_route(METRICS_PATH, methods=["GET", "HEAD"], include_in_schema=False)
async def metrics_prometheus(authorization: Optional[str] = Header(default=None)):
    """Exposition Prometheus des compteurs internes (bus, flux, rate-limit,
    révocation), réservée au porteur de `METRICS_TOKEN`.

    Raises:
        HTTPException: 503 quand `METRICS_TOKEN` n'est pas posé sur la machine —
            la route refuse au lieu de publier sans jeton ; 401 quand l'en-tête
            manque ou ne porte pas le bon jeton (aucun nom de métrique ne sort).

    Returns:
        Response: `text/plain; version=0.0.4` — une famille par compteur, jamais
        de valeur libre en étiquette.
    """
    if not metrics_token_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Métriques non configurées : poser METRICS_TOKEN sur la machine "
                "(fly secrets set METRICS_TOKEN=…). La route refuse de publier "
                "les compteurs sans jeton."
            ),
        )
    if not metrics_token_valid(authorization):
        raise HTTPException(
            status_code=401,
            detail="Jeton de métriques absent ou invalide",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Le corpus est le SEUL chiffre que la base seule connaît. Il est lu ici
    # (une requête COUNT indexée par scrape, soit une toutes les 30 s) plutôt
    # que dans `kojo_metrics`, qui reste sans I/O. Une lecture en panne n'omet
    # que la jauge : les compteurs mémoire restent publiés, et un 0 inventé
    # ferait passer une panne de base pour une place de marché vide.
    #
    # La RÈGLE du comptage est celle de `kojo_scheduler.compter_missions_ouvertes`,
    # partagée avec l'alerte « marché vide » : deux comptages écrits séparément
    # finiraient par ne plus compter la même chose, et la jauge dirait « vide »
    # pendant que l'alerte se tairait (ou l'inverse).
    corpus = {}
    try:
        corpus["missions_ouvertes"] = await compter_missions_ouvertes()
    except Exception as exc:  # pragma: no cover - dépend du client Mongo
        logger.warning("⚠️ Métriques : comptage des missions ouvertes impossible (%s)", exc)

    return Response(
        content=render_metrics(corpus=corpus),
        media_type=METRICS_CONTENT_TYPE,
        # Des compteurs sont un instantané : un cache intermédiaire servirait
        # une valeur périmée en croyant mesurer le présent.
        headers={"Cache-Control": "no-store"},
    )


# Favicon & racine — cette API ne sert pas de frontend, mais les navigateurs/
# bots/moniteurs pingent GET /favicon.ico et GET / par défaut. Sans handler
# explicite, ce sont des 404 bruyants dans les logs Render. Un 204 (no
# content) pour le favicon garde les logs propres (correctif standard).
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Répond 204 (no content) aux pings de favicon des navigateurs/bots pour
    garder les logs propres (aucune forme de retour JSON).

    Returns:
        Response: 204 No Content, corps vide.
    """
    return Response(status_code=204)


app.include_router(api_router)

# ---------------------------------------------------------------------------
# CORS Configuration optimized for West Africa
# ---------------------------------------------------------------------------
# Support public Vercel deployments and common development/private network origins.
# Exact origins from CORS_ORIGINS remain supported via allow_origins.

# La liste des origines EXACTES est construite par kojo_core.build_allowed_origins() :
# origines de dev + FRONTEND_APP_URL + CORS_ORIGINS. L'adresse canonique du
# frontend ne dépend donc plus de quelqu'un qui l'aurait recopiée dans
# CORS_ORIGINS — c'est précisément ce qui a cassé le 18/09/2026 (domaine propre
# kojoforafrica.cc.cd hors du motif Vercel : aucune origine exacte ne matchait
# plus, donc tout préflight répondait 400 « Disallowed CORS origin »).
allowed_origins = build_allowed_origins()
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
    # `X-Request-ID` est EXPOSÉ : sans ça, le JavaScript ne peut pas le lire
    # (il est là, mais invisible), et un utilisateur qui signale une panne n'a
    # aucun moyen de la nommer.
    # `X-Total-Count` : le nombre de missions du filtre. Sans cette exposition,
    # l'en-tête ARRIVE mais le JavaScript ne peut pas le lire (même règle que
    # `X-Request-ID`), donc la liste ne pourrait pas dire combien elle en a.
    expose_headers=["Content-Range", "X-Content-Range", "X-Kojo-CSRFToken", "X-Request-ID", "X-Total-Count"],
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
# Monté en DERNIER, donc le plus EXTERNE : un 429 du rate-limiter, un refus de
# taille ou une réponse d'erreur reçoivent aussi un identifiant — or ce sont
# exactement les réponses qu'un utilisateur signale au support.
app.add_middleware(RequestIdMiddleware)


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
    # Applique les règles de conservation (kojo_retention) côté application :
    # document de compte supprimé, ticket support, message. L'index TTL reste la
    # garantie de fond ; ce passage est l'étage observable et testable.
    retention_task = asyncio.create_task(retention_purge_loop())
    # AUTO-ALERTE du fournisseur email ACTIF : le backend juge lui-même, avec la
    # sonde de /monitor/email, et prévient le propriétaire UNE FOIS PAR PANNE.
    # La sonde externe du dépôt reste un second témoin, jamais le seul.
    email_alert_task = asyncio.create_task(email_provider_alert_loop())
    # RÉSUMÉ DES ALERTES EMPLOI : c'est le seul chemin de RETOUR du produit —
    # sans lui, une mission publiée ne touche un travailleur que s'il repasse de
    # lui-même sur /jobs. Passage horaire, bail partagé, un email par veille.
    job_alert_task = asyncio.create_task(job_alert_digest_loop())
    # SÉQUESTRE À DEUX TEMPS : libère les missions déclarées terminées que le
    # client n'a pas validées à l'échéance (kojo_job_completion). Sans cette
    # boucle, un client injoignable laissait le travailleur impayé pour toujours.
    completion_task = asyncio.create_task(completion_auto_release_loop())
    # LITIGE TRACÉ : referme les fenêtres d'arbitrage échues (kojo_job_disputes).
    # Sans cette boucle, un désaccord resterait `open` pour toujours et gèlerait
    # le paiement au-delà de la fenêtre annoncée aux parties.
    litige_task = asyncio.create_task(litige_expiry_loop())
    # ARBITRAGE SANS RÉPONSE : prévient le propriétaire quand la part de litiges
    # TRANCHÉS sans réponse de l'autre partie dépasse le seuil sur la fenêtre
    # glissante (kojo_scheduler). La file dit ce qui reste à faire ; cette
    # boucle dit si l'arbitre tranche sans avoir lu les deux versions.
    litige_alerte_task = asyncio.create_task(litige_arbitrage_alert_loop())
    # PLACE DE MARCHÉ VIDE : sans cette boucle, zéro mission ouverte ne se lisait
    # que sur /metrics — un scrape que personne n'ouvre. Le 23/10/2026, il a
    # fallu onze jours de prémisses SEO pour l'apercevoir. Le seuil est une
    # DURÉE (24 h par défaut), pas un instant : un creux entre deux missions
    # n'est pas une panne, une journée entière sans rien à postuler en est une.
    marche_task = asyncio.create_task(marche_vide_alert_loop())
    # MISSIONS SANS PROPOSITION : l'offre est là et personne ne postule. C'est
    # l'autre moitié du diagnostic de liquidité — et elle ne se voit nulle part
    # tant qu'on n'ouvre pas chaque mission une par une.
    sans_proposition_task = asyncio.create_task(
        missions_sans_proposition_alert_loop()
    )
    # BUS TEMPS RÉEL (Redis pub/sub) : le fan-out reste en mémoire, le bus le
    # PROLONGE aux autres workers et machines. Sans REDIS_URL, rien ne change
    # (le process publie et sert ses propres flux) — et `start_bus` DIT la perte
    # quand plusieurs workers tournent sans bus, au lieu de la taire.
    try:
        await kojo_live.start_bus()
    except Exception as exc:  # noqa: BLE001 - un bus optionnel ne bloque pas le boot
        logger.error(f"⚠️ start_bus() a échoué, démarrage poursuivi quand même: {exc}")
    logger.info("✅ API Kojo prête!")

    yield  # l'application tourne ici

    # ---- SHUTDOWN ----
    rate_limit_task.cancel()
    payout_sweeper_task.cancel()
    retention_task.cancel()
    email_alert_task.cancel()
    job_alert_task.cancel()
    completion_task.cancel()
    litige_task.cancel()
    litige_alerte_task.cancel()
    marche_task.cancel()
    sans_proposition_task.cancel()
    try:
        await asyncio.gather(
            rate_limit_task,
            payout_sweeper_task,
            retention_task,
            email_alert_task,
            job_alert_task,
            completion_task,
            litige_task,
            marche_task,
            sans_proposition_task,
            litige_alerte_task,
        )
    except asyncio.CancelledError:
        pass
    # Les flux SSE vivent dans le process : couper le bus ici ferme ses deux
    # tâches AVANT la fermeture du client Mongo, dans le même ordre qu'au boot.
    try:
        await kojo_live.stop_bus()
    except Exception as exc:  # noqa: BLE001 - l'arrêt ne doit pas masquer le reste
        logger.error(f"⚠️ stop_bus() a échoué: {exc}")
    client.close()


# ATTACHEMENT DU CYCLE DE VIE. `app = FastAPI(...)` est construit plus haut,
# AVANT que `lifespan` n'existe (le module est découpé en domaines, et le
# constructeur est en tête) : le cycle de vie doit donc être branché ici, après
# la définition. Sans cette ligne, le démarrage ne fait RIEN — ni index, ni
# planificateurs (décaissements bloqués, conservation, auto-alerte email), ni
# bus temps réel : chaque pièce s'exécute correctement quand on l'appelle, et
# aucune n'est appelée. Mesuré le 18/10/2026 par
# `tests/test_live_bus_deux_workers.py` : le worker répondait sur /api/health
# sans que son bus soit jamais attaché. L'attachement direct est la forme que
# `scripts/charge/serveur_mesure.py` emploie déjà pour ÉTENDRE ce cycle.
app.router.lifespan_context = lifespan


# Exports utilisés par les tests (tests/conftest.py) et par uvicorn
__all__ = ["app", "api_router", "db", "request_counts",
           "hash_email_otp", "generate_email_otp_code"]
