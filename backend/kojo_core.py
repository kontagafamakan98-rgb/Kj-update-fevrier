# -*- coding: utf-8 -*-
"""Infrastructure partagée : connexion MongoDB, index, rate-limiting,
middlewares de sécurité, dépendances d'authentification et helpers."""

import asyncio
import hmac
import os
import secrets
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import bcrypt
import jwt
from cloudinary import uploader as cloudinary_uploader
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import ValidationError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from kojo_models import PaymentAccount, User, WA_PHONE_RULES
from kojo_settings import (
    APP_ENV,
    APP_VERSION,
    AUTH_COOKIE_MAX_AGE,
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_SAMESITE,
    AUTH_COOKIE_SECURE,
    BACKEND_PUBLIC_URL,
    CSRF_COOKIE_NAME,
    FRONTEND_APP_URL,
    JWT_ALGORITHM,
    JWT_EXPIRATION_HOURS,
    JWT_SECRET,
    OWNER_EMAIL,
    OWNER_INITIAL_PASSWORD,
    OWNER_USER_ID,
    get_security_headers_for_path,
    logger,
)

try:
    mongo_url = os.environ.get('MONGO_URL')
    if not mongo_url:
        raise ValueError("MONGO_URL environment variable is required")
    
    db_name = os.environ.get('DB_NAME', 'kojo_db')  # Default fallback
    if not db_name:
        raise ValueError("DB_NAME environment variable is required")

    client = AsyncIOMotorClient(
        mongo_url,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=5000,
    )
    db = client[db_name]

    # Test connection on startup
    logger.info(f"✅ MongoDB connected to: {db_name}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    raise



def upload_image_to_cloudinary(file_obj, user_identifier: str, folder: str, public_prefix: str):
    """Upload générique Cloudinary avec format auto (WebP/AVIF) pour le réseau
    mobile ouest-africain. `folder` : sous-dossier Cloudinary ;
    `public_prefix` : préfixe du public_id."""
    result = cloudinary_uploader.upload(
        file_obj,
        folder=folder,
        public_id=f"{public_prefix}_{user_identifier}_{uuid.uuid4().hex}",
        resource_type="image",
        # Optimisation bande passante : Cloudinary convertit/redimensionne et
        # sert le meilleur format (WebP/AVIF) selon le navigateur.
        transformation=[{"fetch_format": "auto", "quality": "auto"}],
    )
    return {
        "photo_url": result.get("secure_url") or result.get("url"),
        "public_id": result.get("public_id")
    }


def upload_profile_photo_to_cloudinary(file_obj, user_identifier: str):
    return upload_image_to_cloudinary(
        file_obj, user_identifier, "kojo/profile_photos", "profile"
    )

async def is_database_available() -> bool:
    """Return True when MongoDB is reachable, otherwise False."""
    try:
        await db.command("ping")
        return True
    except Exception as e:
        logger.warning(f"⚠️ MongoDB unavailable: {e}")
        return False

async def create_database_indexes():
    """Create indexes on frequently queried fields for better performance"""
    if not await is_database_available():
        logger.warning("⚠️ Skipping MongoDB index creation because the database is unavailable.")
        return

    try:
        # Users collection indexes
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.users.create_index("user_type")
        await db.users.create_index("country")
        await db.users.create_index([("email", 1), ("password_hash", 1)])
        # Comptes SSO Google : un sub Google est lié à AU PLUS UN compte Kojo.
        # Sparse : les comptes mot-de-passe n'ont pas de google_sub et ne
        # doivent pas être contraints par cet index.
        await db.users.create_index("google_sub", unique=True, sparse=True)
        
        # Jobs collection indexes
        await db.jobs.create_index("id", unique=True)
        await db.jobs.create_index("client_id")
        await db.jobs.create_index("status")
        await db.jobs.create_index("category")
        await db.jobs.create_index("country")
        await db.jobs.create_index([("status", 1), ("category", 1)])
        await db.jobs.create_index([("created_at", -1)])  # For sorting by date
        # Géospatial : recherche par rayon (GET /jobs?lat=&lng=&radius_km=)
        await db.jobs.create_index([("geo", "2dsphere")])

        # Backfill best-effort des jobs existants : certains ont des
        # coordonnées dans location.latitude/longitude mais pas de point
        # GeoJSON (ajouté à la création depuis cette fonctionnalité). On les
        # met à jour pour que la recherche par rayon fonctionne sur les
        # données historiques. Borné et non bloquant.
        try:
            cursor = db.jobs.find(
                {"geo": {"$exists": False}, "location.latitude": {"$ne": None}, "location.longitude": {"$ne": None}},
                {"_id": 0, "id": 1, "location": 1},
            ).limit(500)
            async for job_doc in cursor:
                loc = job_doc.get("location") or {}
                try:
                    lat = float(loc.get("latitude"))
                    lng = float(loc.get("longitude"))
                    if lat is not None and lng is not None:
                        await db.jobs.update_one(
                            {"id": job_doc.get("id")},
                            {"$set": {"geo": {"type": "Point", "coordinates": [lng, lat]}}},
                        )
                except (TypeError, ValueError):
                    continue
        except Exception as exc:
            logger.warning(f"⚠️ Backfill geo jobs impossible: {exc}")
        
        # Proposals collection indexes — sur la VRAIE collection job_proposals
        # (l'ancienne "proposals" n'est plus utilisée par aucun code ; les
        # index y étaient créés à tort, laissant job_proposals sans index).
        await db.job_proposals.create_index("id", unique=True)
        await db.job_proposals.create_index("job_id")
        await db.job_proposals.create_index("worker_id")
        await db.job_proposals.create_index([("job_id", 1), ("worker_id", 1)])
        
        # Messages collection indexes
        # NOTE: les index précédents portaient sur "job_id" et "created_at",
        # deux champs qui n'existent pas sur le modèle Message (id,
        # conversation_id, sender_id, receiver_id, content, timestamp, read)
        # - ces index ne servaient donc à rien. "conversation_id", lui,
        # est utilisé dans quasiment toutes les requêtes messages et n'était
        # pas indexé du tout (full collection scan à chaque conversation
        # ouverte).
        await db.messages.create_index("id", unique=True)
        await db.messages.create_index([("sender_id", 1), ("receiver_id", 1)])
        await db.messages.create_index([("conversation_id", 1), ("timestamp", 1)])
        await db.messages.create_index([("timestamp", -1)])
        await db.messages.create_index("job_id")
        
        # Commissions collection indexes
        await db.commissions.create_index("id", unique=True)
        await db.commissions.create_index("job_id")
        await db.commissions.create_index("worker_id")
        await db.commissions.create_index("status")
        await db.commissions.create_index([("created_at", -1)])

        # Payments collection indexes
        await db.payments.create_index("id", unique=True)
        await db.payments.create_index("job_id")
        await db.payments.create_index("payer_id")
        await db.payments.create_index("receiver_id")
        await db.payments.create_index("status")
        await db.payments.create_index("invoice_token", sparse=True)
        await db.payments.create_index([("created_at", -1)])

        # Email OTP collection indexes
        await db.email_otps.create_index([("email", 1), ("purpose", 1)], unique=True)
        await db.email_otps.create_index("expires_at", expireAfterSeconds=0)
        await db.email_otps.create_index([("created_at", -1)])

        # Notifications collection indexes
        await db.notifications.create_index("id", unique=True)
        await db.notifications.create_index("user_id")
        await db.notifications.create_index([("user_id", 1), ("is_read", 1)])
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        # TTL : suppression automatique des notifications après 90 jours
        await db.notifications.create_index("created_at", expireAfterSeconds=90 * 24 * 3600)

        # Reviews (avis) collection indexes
        await db.reviews.create_index("id", unique=True)
        await db.reviews.create_index("job_id")
        await db.reviews.create_index("reviewee_id")
        await db.reviews.create_index([("job_id", 1), ("reviewer_id", 1)], unique=True)
        await db.reviews.create_index([("created_at", -1)])

        # Push tokens collection indexes
        await db.push_tokens.create_index("id", unique=True)
        await db.push_tokens.create_index("user_id")
        await db.push_tokens.create_index([("user_id", 1), ("active", 1)])

        # TTL index: Mongo purge automatiquement les tokens révoqués une fois
        # leur date d'expiration naturelle (expire_at) atteinte - la collection
        # de révocation reste donc de taille bornée sans job de nettoyage manuel.
        await db.revoked_tokens.create_index("jti", unique=True)
        await db.revoked_tokens.create_index("expire_at", expireAfterSeconds=0)

        logger.info("✅ MongoDB indexes created successfully")
    except Exception as e:
        logger.warning(f"⚠️ Error creating indexes (may already exist): {e}")

def _try_init_redis() -> Optional[Any]:
    """Tente de connecter Redis si REDIS_URL est défini. Retourne le client
    ou None (fallback mémoire) sans jamais lever d'exception."""
    redis_url = os.environ.get('REDIS_URL', '').strip()
    if not redis_url:
        return None
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(
            redis_url,
            encoding='utf-8',
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        logger.info("✅ Rate-limiter: mode Redis partagé activé (multi-workers safe)")
        return client
    except ImportError:
        logger.warning(
            "⚠️ Rate-limiter: package 'redis' non installé (pip install redis). "
            "Ajoutez 'redis>=5.0.0' à requirements.txt pour activer le mode "
            "Redis partagé. Fallback sur compteur en mémoire."
        )
        return None
    except Exception as e:
        logger.warning(f"⚠️ Rate-limiter: connexion Redis échouée ({e}), fallback mémoire.")
        return None

_redis_client = _try_init_redis()

_using_redis = _redis_client is not None

# Garde-fou anti-boucle : si Redis est down au boot, on ne ré-essaie pas à
# chaque requête (ça spammerait un Redis en panne), mais on ré-essaie au plus
# une fois par minute via _get_redis_client().
_redis_retry_after = 0.0

if _redis_client is None and APP_ENV in ("production", "prod"):
    # Sans Redis, le rate-limiting est en mémoire et PAR PROCESS : avec N
    # workers uvicorn, les limites réelles sont multipliées par N et ne sont
    # pas partagées. Ce n'est pas bloquant au lancement, mais c'est un écart
    # à connaître et à corriger (définir REDIS_URL sur Render).
    logger.warning(
        "⚠️ REDIS_URL non défini en production : le rate-limiting est en mémoire, "
        "par process uvicorn (limites effectives multipliées par le nombre de "
        "workers, non partagées). Définir REDIS_URL (ex: Render Redis) pour un "
        "rate-limiting partagé multi-workers."
    )

async def _get_redis_client() -> Optional[Any]:
    """Retourne le client Redis actif, en ré-essayant paresseusement s'il a
    échoué au boot (REDIS_URL posé mais connexion momentanément indisponible).
    Sans cette ré-init, un Redis down au démarrage laissait le rate-limiter en
    mémoire pour TOUTE la vie du process, même après le retour de Redis —
    l'écart multi-workers aurait persisté jusqu'au prochain redéploiement."""
    global _redis_client, _using_redis, _redis_retry_after
    if _redis_client is not None:
        return _redis_client
    if not os.environ.get('REDIS_URL', '').strip():
        return None
    now = time.monotonic()
    if now < _redis_retry_after:
        return None
    _redis_retry_after = now + 60  # au plus une tentative par minute
    client = _try_init_redis()
    if client is not None:
        _redis_client = client
        _using_redis = True
        logger.info("✅ Rate-limiter: Redis re-connecté (mode partagé repassé actif)")
    return _redis_client

async def rate_limit_check(client_ip: str, max_requests: int = 100, window_minutes: int = 1) -> bool:
    """Vérifie le rate limiting. Utilise Redis si disponible (ré-init
    paresseuse si nécessaire), sinon mémoire."""
    if await _get_redis_client() is not None:
        return await _rate_limit_check_redis(client_ip, max_requests, window_minutes)
    return _rate_limit_check_memory(client_ip, max_requests, window_minutes)

async def _rate_limit_check_redis(client_ip: str, max_requests: int, window_minutes: int) -> bool:
    """Rate limiting via Redis (sliding window, partagé entre tous les workers)."""
    try:
        window_seconds = window_minutes * 60
        key = f"rl:{client_ip}:{window_minutes}m"
        now = time.time()
        pipe = _redis_client.pipeline()
        # Sliding window : on supprime les timestamps anciens, on ajoute le
        # nouveau, et on compte combien il en reste dans la fenêtre courante.
        pipe.zremrangebyscore(key, 0, now - window_seconds)
        pipe.zcard(key)
        pipe.zadd(key, {str(now): now})
        pipe.expire(key, window_seconds + 10)
        results = await pipe.execute()
        current_count = results[1]
        return current_count < max_requests
    except Exception as exc:
        # Redis indisponible pendant la vérification : on laisse passer
        # (fail-open) plutôt que de bloquer tous les utilisateurs. Le
        # fallback mémoire prend le relais pour les requêtes suivantes si
        # Redis reste down.
        logger.warning(f"⚠️ Rate-limit Redis check échoué: {exc}, fail-open")
        return True

def _rate_limit_check_memory(client_ip: str, max_requests: int, window_minutes: int) -> bool:
    """Rate limiting en mémoire (par process, comportement original)."""
    now = time.time()
    window_start = now - (window_minutes * 60)

    recent = [t for t in request_counts.get(client_ip, []) if t > window_start]

    if len(recent) >= max_requests:
        request_counts[client_ip] = recent
        return False

    recent.append(now)
    request_counts[client_ip] = recent

    if len(request_counts) > RATE_LIMIT_MAX_TRACKED_KEYS:
        _purge_stale_rate_limit_entries(max_age_seconds=300)

    return True

def _purge_stale_rate_limit_entries(max_age_seconds: int = 3600) -> int:
    """Supprime du dict mémoire les clés expirées. No-op si Redis est actif."""
    if _using_redis:
        return 0
    now = time.time()
    cutoff = now - max_age_seconds
    stale_keys = [
        key for key, timestamps in request_counts.items()
        if not timestamps or max(timestamps) < cutoff
    ]
    for key in stale_keys:
        del request_counts[key]
    return len(stale_keys)

async def _rate_limit_cleanup_loop():
    """Tâche de fond: purge les entrées mémoire inactives (no-op si Redis)."""
    while True:
        try:
            await asyncio.sleep(600)
            removed = _purge_stale_rate_limit_entries(max_age_seconds=3600)
            if removed:
                logger.info(f"🧹 Rate-limit cleanup: {removed} entrées inactives purgées")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"⚠️ Erreur cleanup rate-limit: {e}")

def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"

def extract_host_from_url(raw_url: str) -> Optional[str]:
    if not raw_url:
        return None
    candidate = raw_url.strip()
    if not candidate:
        return None
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    return parsed.hostname

def build_trusted_hosts() -> List[str]:
    hosts = {
        "localhost",
        "127.0.0.1",
        "*.vercel.app",
        "*.onrender.com",
        "onrender.com",
        # Fly.io : le Host des health checks (et du trafic interne) est un
        # nom DNS interne *.internal ; le trafic public arrive via le proxy
        # Fly sur *.fly.dev / *.flycast.internal. Ces motifs rendent le
        # TrustedHostMiddleware sûr à activer sur Fly SANS dépendre de la
        # variable TRUSTED_HOSTS (défaut robuste, surchargable via l'env).
        "*.internal",
        "*.flycast.internal",
        "*.fly.dev",
    }

    render_external_host = os.environ.get('RENDER_EXTERNAL_HOSTNAME', '').strip()
    raw_candidates = [FRONTEND_APP_URL, BACKEND_PUBLIC_URL, render_external_host]
    raw_candidates.extend(origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip())
    raw_candidates.extend(host.strip() for host in os.environ.get('TRUSTED_HOSTS', '').split(',') if host.strip())

    for candidate in raw_candidates:
        host = extract_host_from_url(candidate)
        if host:
            hosts.add(host)

    return sorted(hosts)

def get_rate_limit_bucket(path: str) -> tuple[str, int, int]:
    if path.startswith("/api/auth/email/") or path.startswith("/api/auth/password/"):
        return ("auth-otp", 12, 5)
    if path.startswith("/api/auth/login") or path.startswith("/api/auth/register"):
        return ("auth-session", 20, 5)
    if path.startswith("/api/messages"):
        # Envoi de messages : 60 POST/min/IP (les GET/HEAD/OPTIONS de
        # lecture/polling sont exemptés, voir RateLimitMiddleware)
        return ("messages", 60, 1)
    if path.startswith("/api/support"):
        # Tickets support (création publique) : 10 POST/5min/IP
        return ("support", 10, 5)
    if path.startswith("/api/owner"):
        return ("owner", 30, 1)
    return ("general-api", 240, 1)

security = HTTPBearer(auto_error=False)

# --- Authentification dual-mode : Authorization: Bearer OU cookie httpOnly ---
# Le JWT vit désormais aussi dans un cookie httpOnly (invisible pour
# JavaScript → protection XSS). Le mode header historique reste (mobile /
# Capacitor / intégrations / tests). Les routes n'ont rien à changer :
# get_current_user et verify_owner_access lisent l'un ou l'autre.
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _iter_auth_tokens(request: Request, credentials: Optional[HTTPAuthorizationCredentials]):
    """Sources de token candidates, dans l'ordre : header Authorization:
    Bearer puis cookie httpOnly kojo_session.

    Le header est essayé en premier (mobile / Capacitor / intégrations /
    tests), mais un token STALE laissé dans le web storage par une ancienne
    version du frontend ne doit PAS faire échouer une session cookie valide :
    on retombe sur le cookie si le header ne décode pas (bug réel : 401
    « Invalid token » sur GET /users/payment-accounts alors que l'utilisateur
    était bien connecté via son cookie de session)."""
    if credentials is not None and credentials.credentials:
        yield ("header", credentials.credentials)
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie_token:
        yield ("cookie", cookie_token)


async def _decode_auth_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
    *,
    expired_detail: str,
    invalid_detail: str,
) -> dict:
    """Décode le premier token valide (header Bearer puis cookie httpOnly) et
    retourne son payload. Lève HTTPException 401 si aucune source n'est valide.

    CSRF : une requête authentifiée PAR COOKIE sur une méthode non sûre
    (POST/PUT/PATCH/DELETE) doit présenter un jeton X-CSRFToken correspondant
    au cookie CSRF (double-submit — le navigateur envoie le cookie de session
    automatiquement, même depuis un site tiers). Les requêtes authentifiées
    par header Bearer (mobile/legacy) sont exemptes (pas de cookies
    ambiants)."""
    candidates = list(_iter_auth_tokens(request, credentials))
    if not candidates:
        raise HTTPException(status_code=401, detail="Non authentifié")

    last_error: Optional[Exception] = None
    for source, token in candidates:
        try:
            if request.method not in _SAFE_METHODS and source == "cookie":
                _verify_csrf(request)
            return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except HTTPException:
            raise
        except jwt.ExpiredSignatureError as exc:
            last_error = exc
        except jwt.InvalidTokenError as exc:
            last_error = exc

    if isinstance(last_error, jwt.ExpiredSignatureError):
        raise HTTPException(status_code=401, detail=expired_detail)
    raise HTTPException(status_code=401, detail=invalid_detail)


def _verify_csrf(request: Request) -> None:
    """Protection CSRF (double-submit) pour les requêtes authentifiées PAR
    COOKIE sur méthodes non sûres. Le navigateur envoie automatiquement le
    cookie de session sur toute requête vers le backend (y compris forgée
    depuis un site tiers) : un cookie CSRF lisible par JS doit alors être
    ré-écho dans l'en-tête X-CSRFToken. Les requêtes authentifiées PAR HEADER
    (Authorization: Bearer, ex: mobile) n'ont pas de cookies ambients → pas
    de CSRF, pas de vérification."""
    header_token = request.headers.get("X-CSRFToken", "").strip()
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "").strip()
    if (
        not header_token
        or not cookie_token
        or not hmac.compare_digest(header_token, cookie_token)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Validation CSRF échouée. Jeton manquant ou invalide.",
        )


def set_auth_cookies(response: Response, access_token: str) -> None:
    """Pose le cookie de session httpOnly + un cookie CSRF lisible par JS
    (valeur aléatoire, validée côté serveur sur les mutations via en-tête
    X-CSRFToken). À appeler sur login / register."""
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=access_token,
        max_age=AUTH_COOKIE_MAX_AGE,
        expires=AUTH_COOKIE_MAX_AGE,
        path="/",
        domain=None,
        secure=AUTH_COOKIE_SECURE,
        httponly=True,
        samesite=AUTH_COOKIE_SAMESITE,
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        max_age=AUTH_COOKIE_MAX_AGE,
        expires=AUTH_COOKIE_MAX_AGE,
        path="/",
        domain=None,
        secure=AUTH_COOKIE_SECURE,
        httponly=False,
        samesite=AUTH_COOKIE_SAMESITE,
    )


def clear_auth_cookies(response: Response) -> None:
    """Retire les cookies de session + CSRF (logout)."""
    for name in (AUTH_COOKIE_NAME, CSRF_COOKIE_NAME):
        response.delete_cookie(
            key=name,
            path="/",
            domain=None,
            secure=AUTH_COOKIE_SECURE,
            samesite=AUTH_COOKIE_SAMESITE,
            httponly=(name == AUTH_COOKIE_NAME),
        )

class WestAfricaSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        for header, value in get_security_headers_for_path(request.url.path).items():
            response.headers[header] = value

        response.headers["X-Kojo-Region"] = "west-africa"
        response.headers["X-Kojo-Version"] = APP_VERSION
        # Vary inclut Cookie : les réponses authentifiées dépendent du
        # cookie de session httpOnly — un cache intermédiaire ne doit pas
        # servir la réponse d'un utilisateur à un autre.
        response.headers["Vary"] = "Origin, Authorization, Cookie, Accept-Encoding"

        path = request.url.path
        has_auth_header = bool(request.headers.get("authorization"))
        sensitive_prefixes = ("/api/auth", "/api/users/profile", "/api/messages", "/api/owner")

        if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi.json"):
            response.headers["Cache-Control"] = "no-store"
        elif path.startswith("/api"):
            is_sensitive = any(path.startswith(prefix) for prefix in sensitive_prefixes)
            if has_auth_header or is_sensitive or request.method not in {"GET", "HEAD", "OPTIONS"}:
                response.headers["Cache-Control"] = "private, no-store"
            else:
                response.headers["Cache-Control"] = "public, max-age=120, stale-while-revalidate=60"

        return response

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)

        bucket_name, max_requests, window_minutes = get_rate_limit_bucket(path)

        # Atténuation CGNAT (Afrique de l'Ouest) : Orange/Sonatel/Wave partagent
        # une poignée d'IP publiques entre des milliers d'utilisateurs. Les
        # requêtes GET/HEAD/OPTIONS (navigation, listes, détails) sont en
        # lecture seule et peu coûteuses : on ne les compte PAS dans le bucket
        # général pour éviter de faux 429 massifs. Les buckets critiques
        # (auth, owner) continuent de compter TOUTES les méthodes.
        if bucket_name in ("general-api", "messages") and request.method in {"GET", "HEAD", "OPTIONS"}:
            return await call_next(request)

        client_ip = get_client_ip(request)
        scoped_client = f"{client_ip}:{bucket_name}"

        if not await rate_limit_check(scoped_client, max_requests=max_requests, window_minutes=window_minutes):
            retry_after = window_minutes * 60
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Trop de requêtes. Réessayez dans un instant.",
                    "bucket": bucket_name
                },
                headers={"Retry-After": str(retry_after)}
            )

        return await call_next(request)

async def verify_owner_access(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Vérifie que seul le propriétaire peut accéder aux fonctionnalités sensibles.
    Dual-mode header/cookie (cf. get_current_user). Les mutations via cookie
    exigent un jeton CSRF valide."""
    try:
        payload = await _decode_auth_token(
            request,
            credentials,
            expired_detail="Token expiré",
            invalid_detail="Token invalide",
        )
        user_id = payload.get("sub")
        email = payload.get("email")

        if await is_token_revoked(payload.get("jti")):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token révoqué")

        # Vérification stricte: seul Famakan Kontaga Master a accès
        if user_id != OWNER_USER_ID or email != OWNER_EMAIL:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
            )
        
        # Récupérer les données utilisateur depuis la DB
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Propriétaire non trouvé"
            )
            
        return user
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expiré"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide"
        )

async def ensure_owner_exists():
    """Crée le compte propriétaire s'il n'existe pas déjà et si les secrets requis sont fournis."""
    if not await is_database_available():
        logger.warning("⚠️ Skipping owner bootstrap because MongoDB is unavailable.")
        return

    if not OWNER_EMAIL:
        logger.warning("⚠️ OWNER_EMAIL non défini: création automatique du compte owner désactivée.")
        return

    existing_owner = await db.users.find_one({"$or": [{"id": OWNER_USER_ID}, {"email": OWNER_EMAIL}]})
    if existing_owner:
        logger.info(f"✅ Compte owner existe déjà: {OWNER_EMAIL}")
        return

    if not OWNER_INITIAL_PASSWORD:
        logger.warning("⚠️ Compte owner absent et OWNER_INITIAL_PASSWORD non défini: aucune création automatique effectuée.")
        return

    if len(OWNER_INITIAL_PASSWORD) < 12:
        logger.warning("⚠️ OWNER_INITIAL_PASSWORD trop court (minimum 12 caractères): création automatique du compte owner refusée.")
        return

    hashed_password = bcrypt.hashpw(OWNER_INITIAL_PASSWORD.encode('utf-8'), bcrypt.gensalt())

    owner_data = {
        "id": OWNER_USER_ID,
        "email": OWNER_EMAIL,
        "password_hash": hashed_password.decode('utf-8'),
        "first_name": "Famakan",
        "last_name": "Kontaga Master",
        "user_type": "owner",
        "phone": "+223701234567",
        "country": "mali",
        "preferred_language": "fr",
        "profile_photo": None,
        "is_verified": True,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "is_owner": True,
        "permissions": [
            "commission_access",
            "debug_access",
            "admin_access",
            "full_dashboard_access",
            "mobile_test_access",
            "photo_debug_access"
        ]
    }

    # Ce bootstrap ne doit JAMAIS faire planter le démarrage de l'application.
    # Si l'insertion échoue (ex: doublon d'email/id détecté par un index unique
    # malgré le contrôle ci-dessus, condition de course, etc.), on logue
    # l'erreur et on continue le démarrage normalement.
    try:
        await db.users.insert_one(owner_data)
        logger.info(f"✅ Compte owner créé: {OWNER_EMAIL}")
        logger.warning("⚠️ Changez OWNER_INITIAL_PASSWORD après la première connexion et retirez-le ensuite du fichier .env.")
    except Exception as exc:
        logger.error(f"⚠️ Création automatique du compte owner ignorée (compte probablement déjà existant sous un autre id): {exc}")

def validate_payment_accounts(payment_accounts: PaymentAccount, user_type: str) -> dict:
    """Valide les comptes de paiement selon le type d'utilisateur"""
    
    # Compter le nombre de comptes liés
    linked_accounts = 0
    account_details = {}
    
    if payment_accounts.orange_money:
        if not validate_orange_money_number(payment_accounts.orange_money):
            raise HTTPException(status_code=400, detail="Numéro Orange Money invalide")
        linked_accounts += 1
        account_details['orange_money'] = payment_accounts.orange_money
    
    if payment_accounts.wave:
        if not validate_wave_number(payment_accounts.wave):
            raise HTTPException(status_code=400, detail="Numéro Wave invalide")
        linked_accounts += 1
        account_details['wave'] = payment_accounts.wave
    
    if payment_accounts.bank_account:
        if not validate_bank_account(payment_accounts.bank_account):
            raise HTTPException(status_code=400, detail="Informations de compte bancaire invalides")
        linked_accounts += 1
        account_details['bank_account'] = mask_bank_account_info(payment_accounts.bank_account)
    
    # Validation selon le type d'utilisateur
    if user_type == "client":
        if linked_accounts < 1:
            raise HTTPException(
                status_code=400, 
                detail="Les clients doivent lier au moins 1 moyen de paiement (Orange Money, Wave ou Compte bancaire)"
            )
    elif user_type == "worker":
        if linked_accounts < 2:
            raise HTTPException(
                status_code=400,
                detail="Les travailleurs doivent lier au minimum 2 moyens de paiement sur 3 disponibles (Orange Money, Wave, Compte bancaire)"
            )
    
    return {
        "linked_accounts_count": linked_accounts,
        "account_details": account_details,
        "is_verified": True
    }

ALL_PREFIXES_70_99 = [str(i) for i in range(70, 100)]

COTE_DIVOIRE_ALL_MOBILE_PREFIXES = (
    ['01', '05', '07', '08', '09'] +  # Nouveaux préfixes 10 chiffres
    [str(i).zfill(2) for i in range(40, 60)] +  # MTN 40-59
    [str(i) for i in range(70, 100)]  # Orange 70-99
)

KOJO_PRIORITY_COUNTRIES = {
    # Sénégal (+221) - Pays principal
    '221': {
        'country': 'Sénégal',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Sénégal - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Sénégal - tous préfixes 70-99
        'other_operators': ['76', '75', '33'],  # Tigo, Expresso
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Mali (+223) - Pays prioritaire  
    '223': {
        'country': 'Mali',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Mali - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Mali - tous préfixes 70-99
        'other_operators': ['65', '66', '67', '68'],  # Malitel
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Côte d'Ivoire (+225) - Pays prioritaire avec tous les préfixes mobiles
    '225': {
        'country': "Côte d'Ivoire", 
        'orange_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Orange + tous préfixes mobiles CI
        'wave_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Wave + tous préfixes mobiles CI
        'other_operators': ['58', '59', '48', '49'],  # MTN
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Burkina Faso (+226) - Pays prioritaire
    '226': {
        'country': 'Burkina Faso',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Burkina Faso - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Burkina Faso - tous préfixes 70-99
        'other_operators': ['70', '71', '51', '52'],  # Telmob
        'currency': 'FCFA',
        'primary_language': 'français'
    }
}

def _phone_local_digits_valid(country_code: str, local_digits: str) -> bool:
    """Longueur du numéro local selon le pays (CI : 8-10, autres : 8-9)."""
    rules = WA_PHONE_RULES.get(country_code)
    if not rules:
        return False
    return rules["local_min"] <= len(local_digits) <= rules["local_max"]


def validate_orange_money_number(number: str) -> bool:
    """Valide un numéro Orange Money avec précision par pays"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Orange Money number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        logger.debug(f"Orange Money validation - Original: {number}, Cleaned: {clean_number}")
        
        country_code = clean_number[:3]
        local_digits = clean_number[len(country_code):]
        operator_prefix = local_digits[:2]
        logger.debug(f"Orange Money validation - Country: {country_code}, Prefix: {operator_prefix}")
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Orange Money not supported for country code: {country_code}")
            return False

        # Longueur locale selon le pays (la Côte d'Ivoire utilise aussi le
        # nouveau format à 10 chiffres : +225 + 10 chiffres = 13 au total).
        if not _phone_local_digits_valid(country_code, local_digits):
            logger.info(f"Orange Money number length invalid: {len(clean_number)} digits for {clean_number}")
            return False
            
        # Vérification sécurisée des préfixes
        country_data = KOJO_PRIORITY_COUNTRIES.get(country_code, {})
        valid_prefixes = country_data.get('orange_prefixes', [])
        
        if not valid_prefixes:
            logger.error(f"No Orange Money prefixes defined for country {country_code}")
            return False
            
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Orange Money prefix {operator_prefix} for country {country_code}. Valid: {valid_prefixes[:5]}...")
        else:
            logger.info(f"✅ Valid Orange Money number validated for {country_data.get('country', country_code)}")
            
        return is_valid
        
    except KeyError as e:
        logger.error(f"KeyError in Orange Money validation: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error validating Orange Money number: {e}")
        return False

def validate_wave_number(number: str) -> bool:
    """Valide un numéro Wave - 4 pays prioritaires Kojo"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Wave number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        
        country_code = clean_number[:3]
        local_digits = clean_number[len(country_code):]
        operator_prefix = local_digits[:2]
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Wave not supported for country code: {country_code}")
            return False

        # Longueur locale selon le pays (CI : nouveau format 10 chiffres)
        if not _phone_local_digits_valid(country_code, local_digits):
            logger.info(f"Wave number length invalid: {len(clean_number)} digits")
            return False
            
        valid_prefixes = KOJO_PRIORITY_COUNTRIES[country_code]['wave_prefixes']
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Wave prefix {operator_prefix} for country {country_code}")
        else:
            logger.info(f"Valid Wave number validated for {KOJO_PRIORITY_COUNTRIES[country_code]['country']}")
            
        return is_valid
        
    except Exception as e:
        logger.error(f"Error validating Wave number: {e}")
        return False

def validate_bank_card(card_number: str) -> bool:
    """Valide basiquement un numéro de carte bancaire"""
    # Supprimer les espaces et tirets
    clean_card = ''.join(filter(str.isdigit, card_number))
    
    # Vérifier la longueur (16 chiffres généralement)
    if len(clean_card) not in [15, 16]:
        return False
    
    # Algorithme de Luhn simplifié
    return luhn_check(clean_card)

def luhn_check(card_number: str) -> bool:
    """Algorithme de Luhn pour validation carte bancaire"""
    def digits_of(n):
        return [int(d) for d in str(n)]
    
    digits = digits_of(card_number)
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum(digits_of(d*2))
    return checksum % 10 == 0

def mask_bank_card(card_number: str) -> str:
    """Masque le numéro de carte bancaire"""
    clean_card = ''.join(filter(str.isdigit, card_number))
    if len(clean_card) >= 16:
        return f"****-****-****-{clean_card[-4:]}"
    elif len(clean_card) >= 15:
        return f"****-****-***-{clean_card[-4:]}"
    return "****-****-****"

def validate_bank_account(bank_account: dict) -> bool:
    """Valide les informations de compte bancaire"""
    if not isinstance(bank_account, dict):
        return False
    
    # Vérifier les champs obligatoires
    required_fields = ["account_number", "bank_name", "account_holder"]
    for field in required_fields:
        if not bank_account.get(field):
            return False
    
    # Valider le numéro de compte (au moins 8 chiffres)
    account_number = ''.join(filter(str.isdigit, bank_account["account_number"]))
    if len(account_number) < 8:
        return False
    
    # Valider le nom de la banque (au moins 3 caractères)
    if len(bank_account["bank_name"].strip()) < 3:
        return False
    
    # Valider le nom du titulaire (au moins 2 caractères)
    if len(bank_account["account_holder"].strip()) < 2:
        return False
    
    return True

def is_valid_image_content(data: bytes) -> bool:
    """Vérifie les magic bytes d'une image (JPEG/PNG/GIF/WebP).

    Le content-type envoyé par le client est spoofable ; vérifier la signature
    réelle du fichier évite de stocker/envoyer n'importe quel contenu vers
    Cloudinary (coût/DoS).
    """
    if not isinstance(data, (bytes, bytearray)) or len(data) < 12:
        return False
    data = bytes(data)
    return (
        data.startswith(b'\xff\xd8\xff')                  # JPEG
        or data.startswith(b'\x89PNG\r\n\x1a\n')          # PNG
        or data.startswith(b'GIF87a')
        or data.startswith(b'GIF89a')
        or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')  # WebP
    )


def mask_bank_account_info(bank_account: dict) -> dict:
    """Masque les informations sensibles du compte bancaire"""
    if not isinstance(bank_account, dict):
        return {}
    
    masked_account = bank_account.copy()
    
    # Masquer le numéro de compte
    account_number = bank_account.get("account_number", "")
    clean_account = ''.join(filter(str.isdigit, account_number))
    if len(clean_account) >= 8:
        masked_account["account_number"] = f"****{clean_account[-4:]}"
    else:
        masked_account["account_number"] = "****"
    
    # Garder les autres informations non sensibles
    return {
        "account_number": masked_account["account_number"],
        "bank_name": bank_account.get("bank_name", ""),
        "account_holder": bank_account.get("account_holder", ""),
        "bank_code": bank_account.get("bank_code", ""),
        "branch": bank_account.get("branch", "")
    }

def log_and_raise_http_exception(status_code: int, detail: str, logger_instance=None):
    """Enregistre l'erreur et lève une HTTPException de manière centralisée"""
    if logger_instance is None:
        logger_instance = logger
    
    logger_instance.error(f"HTTP {status_code}: {detail}")
    raise HTTPException(status_code=status_code, detail=detail)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: Optional[str]) -> bool:
    """Vérifie un mot de passe bcrypt. hashed=None (compte SSO Google, sans
    mot de passe) → False proprement (le login classique est refusé), au lieu
    d'un AttributeError qui remonterait en 500."""
    if not hashed:
        return False
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def sanitize_email(email: str) -> str:
    """Nettoie une adresse email (minuscules, espaces, caractères de contrôle).

    PAS de détection d'"injection SQL" ici : la base est MongoDB (pas de SQL),
    et EmailStr valide déjà le format côté Pydantic. Les anciens filtres de
    mots-clés SQL (SELECT, UNION, OR…) rejetaient des emails légitimes
    (ex: union@example.com) sans aucun bénéfice de sécurité — ils ont été
    retirés.
    """
    if not email:
        raise ValueError("Email cannot be empty")

    clean = email.strip().lower()
    if len(clean) > 254:
        raise ValueError("Email too long")

    if any(ord(char) < 32 for char in clean):
        raise ValueError("Email contains invalid characters")

    return clean

def sanitize_input_string(input_str: str, field_name: str = "field") -> str:
    """Sanitize general string inputs"""
    if not input_str:
        return ""
    
    # Remove control characters
    sanitized = ''.join(char for char in input_str if ord(char) >= 32 or char in '\n\t')
    
    # Limit length to prevent buffer overflow attacks
    if len(sanitized) > 1000:
        raise ValueError(f"{field_name} is too long (max 1000 characters)")
    
    return sanitized.strip()

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    # jti = identifiant unique du token, nécessaire pour pouvoir le révoquer
    # individuellement (ex: au logout) sans invalider tous les autres tokens
    # de l'utilisateur ni changer JWT_SECRET.
    to_encode.update({"exp": expire, "jti": str(uuid.uuid4())})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

async def revoke_token(jti: str, expire_at: datetime):
    """Ajoute un token à la liste noire jusqu'à sa date d'expiration naturelle."""
    if not jti:
        return
    try:
        await db.revoked_tokens.update_one(
            {"jti": jti},
            {"$set": {"jti": jti, "expire_at": expire_at, "revoked_at": datetime.now(timezone.utc)}},
            upsert=True
        )
    except Exception as e:
        logger.error(f"⚠️ Impossible d'enregistrer la révocation du token: {e}")

async def is_token_revoked(jti: Optional[str]) -> bool:
    if not jti:
        return False
    try:
        revoked = await db.revoked_tokens.find_one({"jti": jti}, {"_id": 1})
        return revoked is not None
    except Exception as e:
        # En cas de panne de la vérification de révocation, on choisit de ne
        # PAS bloquer tous les utilisateurs (fail-open) - la vérification de
        # signature/expiration JWT reste, elle, toujours appliquée.
        logger.error(f"⚠️ Erreur vérification révocation token: {e}")
        return False

request_counts: Dict[str, List[float]] = defaultdict(list)

RATE_LIMIT_MAX_TRACKED_KEYS = 50_000  # garde-fou anti-DoS mémoire

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    try:
        payload = await _decode_auth_token(
            request,
            credentials,
            expired_detail="Token expired",
            invalid_detail="Invalid token",
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        if await is_token_revoked(payload.get("jti")):
            raise HTTPException(status_code=401, detail="Token revoked")

        user = await db.users.find_one({"id": user_id})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        try:
            return User(**user)
        except ValidationError as exc:
            # Un document utilisateur legacy/corrompu qui ne valide plus le
            # modèle User (téléphone invalide, champ manquant...) ne doit pas
            # faire planter le serveur en 500 sur CHAQUE endpoint authentifié
            # (le login fonctionnerait, mais /auth/me et tout le reste
            # échoueraient en cascade). On renvoie un 401 clair : le compte
            # nécessite une intervention support plutôt qu'une erreur serveur
            # sans issue pour l'utilisateur.
            logger.error(f"⚠️ Document utilisateur invalide (id={user_id}): {exc}")
            raise HTTPException(
                status_code=401,
                detail="Compte utilisateur invalide. Veuillez contacter le support."
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
