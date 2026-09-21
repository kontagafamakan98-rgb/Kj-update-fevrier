# -*- coding: utf-8 -*-
"""Rate-limiting : compteur Redis partage, repli memoire par process, et la
politique de fenetre par route.

Deux modes cohabitent (Redis quand `REDIS_URL` est pose, memoire sinon) et le
choix doit rester lisible en un endroit : c'est cette politique qui decide ce
qu'une limite vaut reellement en production multi-workers.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from collections import defaultdict
from kojo_settings import APP_ENV, logger
from typing import Any, Dict, List, Optional
import asyncio
import os
import time

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
request_counts: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_MAX_TRACKED_KEYS = 50_000  # garde-fou anti-DoS mémoire
