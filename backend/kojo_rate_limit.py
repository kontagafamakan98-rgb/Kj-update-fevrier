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
from datetime import datetime, timezone
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
            "⚠️ Rate-limiter: package 'redis' non installé. 'redis>=5.0.0' est "
            "DÉJÀ déclaré dans requirements.txt : l'installation vient de "
            "requirements.lock (empreintes). Régénérer le lock "
            "(scripts/maj_lock_requirements.py) puis réinstaller avec "
            "`pip install --require-hashes -r requirements.lock` pour activer le "
            "mode Redis partagé. Fallback sur compteur en mémoire."
        )
        return None
    except Exception as e:
        logger.warning(f"⚠️ Rate-limiter: connexion Redis échouée ({e}), fallback mémoire.")
        return None
_redis_client = _try_init_redis()
_using_redis = _redis_client is not None

# ── État du repli : ce qui permet de DIRE qu'une panne a eu lieu ───────────
_ALERTE_PANNE_INTERVALLE_SECONDS = 3600
_rate_limit_stats: Dict[str, Any] = {
    "replis": 0,              # nombre de bascules Redis → mémoire
    "en_memoire": False,      # vrai tant que la panne n'est pas levée
    "derniere_panne": None,   # horodatage ISO de la dernière bascule
    "alerte_envoyee_le": None,
}


def rate_limit_stats() -> Dict[str, Any]:
    """Relevé lisible du repli (console owner, sondes) : un repli silencieux
    serait indiscernable d'un rate-limit qui fonctionne."""
    return dict(_rate_limit_stats)


def rate_limit_en_redis() -> bool:
    """Le limiteur partage-t-il ses compteurs par Redis EN CE MOMENT ?

    Distinct de `rate_limit_stats()["en_memoire"]`, et c'est la raison d'être
    de cet accesseur : `en_memoire` dit qu'un REPLI a eu lieu, celui-ci dit où
    en sont les compteurs. Déployé sans `REDIS_URL`, aucun repli n'a eu lieu et
    les limites sont pourtant comptées PAR PROCESS — une sonde qui lit
    `en_memoire` seul croirait le partage actif.
    """
    return _using_redis


def _basculer_en_memoire(exc: Exception) -> None:
    """Redis est tombé : oublie le client, compte la panne, alerte une fois.

    Idempotent et sans I/O dans le chemin de la requête : l'alerte est
    planifiée sur la boucle, jamais attendue ici.
    """
    global _redis_client, _using_redis, _redis_retry_after
    premier_incident = _rate_limit_stats["en_memoire"] is False
    _redis_client = None
    _using_redis = False
    # Ré-init paresseuse : au plus une tentative par minute, pour ne pas
    # marteler un Redis en panne à chaque requête.
    _redis_retry_after = time.monotonic() + 60
    _rate_limit_stats["en_memoire"] = True
    _rate_limit_stats["replis"] += 1
    _rate_limit_stats["derniere_panne"] = datetime.now(timezone.utc).isoformat()
    if premier_incident:
        logger.error(
            "🚨 Rate-limiter : Redis injoignable (%s) — bascule sur le compteur "
            "MÉMOIRE (par process). Les limites restent appliquées, mais "
            "multiples par le nombre de workers tant que la panne dure.",
            exc,
        )
    else:
        logger.warning(f"⚠️ Rate-limiter : Redis toujours indisponible ({exc}), repli mémoire")
    _alerter_proprietaire_une_fois()


def _alerter_proprietaire_une_fois() -> None:
    """Prévient le propriétaire (au plus une fois par heure) qu'un repli a lieu.

    Best-effort, et planifié : la requête qui a découvert la panne ne doit ni
    attendre une écriture en base ni échouer parce que la notification a raté.
    """
    maintenant = time.time()
    derniere = _rate_limit_stats["alerte_envoyee_le"]
    if derniere is not None and (maintenant - derniere) < _ALERTE_PANNE_INTERVALLE_SECONDS:
        return
    _rate_limit_stats["alerte_envoyee_le"] = maintenant
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # hors boucle (script, test sync) : le log suffit
    loop.create_task(_notifier_repli_rate_limit())


async def _notifier_repli_rate_limit() -> None:
    """Notification in-app au compte propriétaire, jamais bloquante."""
    try:
        # Imports tardifs : ce module est chargé TRÈS tôt (middlewares), et
        # tirer la couche notifications à l'import créerait un cycle avec la
        # base — le repli ne doit pas pouvoir empêcher le serveur de démarrer.
        from kojo_core import resolve_owner_id
        from kojo_models import NotificationType
        from kojo_shared import notify_user_localized

        owner_id = await resolve_owner_id()
        if not owner_id:
            return
        await notify_user_localized(
            user_id=owner_id,
            key="owner_rate_limit_repli_memoire",
            notif_type=NotificationType.GENERAL,
            related_id="rate-limit",
            related_type="rate_limit",
            replis=_rate_limit_stats["replis"],
        )
    except Exception as exc:  # une alerte ratée n'affecte jamais la requête
        logger.warning(f"⚠️ Notification de repli rate-limit échouée: {exc}")
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
        # Redis indisponible pendant la vérification. « Laisser passer » n'est
        # PAS un repli : c'était supprimer toutes les limites (OTP, login,
        # support, robot IA) pendant toute la panne, sans un mot. Le repli
        # mémoire prend le relais POUR DE VRAI, sur CETTE requête :
        #   • on oublie le client Redis (sinon `rate_limit_check` rappelle la
        #     voie Redis à chaque requête et ne retombe jamais en mémoire) ;
        #   • la ré-init paresseuse de `_get_redis_client` retentera au plus
        #     une fois par minute, donc une panne passagère se répare seule ;
        #   • la panne est COMPTÉE et alerte le propriétaire une fois.
        _basculer_en_memoire(exc)
        return _rate_limit_check_memory(client_ip, max_requests, window_minutes)
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
    if path.startswith("/api/auth/login"):
        # CONNEXION : 300 / 5 min par IP, et non 20. Vingt requêtes pour cinq
        # minutes, c'est une limite pour UNE personne — or en CGNAT ouest-
        # africain une seule IP publique porte des milliers d'abonnés d'un
        # opérateur : 20 punissait donc des voisins qui n'avaient rien fait.
        # Cette borne reste un garde-fou de DÉBIT brut (elle ne laisse pas une
        # source unique marteler la route) ; le plafond qui décrit l'ATTAQUE
        # est celui de `kojo_login_reseau` : 120 échecs / 15 min par /24, puis
        # goutte-à-goutte. Pour que cette règle soit ATTEIGNABLE, le bucket doit
        # laisser passer au moins `SEUIL_ECHECS` requêtes (garde :
        # tests/test_login_reseau.py).
        return ("auth-login", 300, 5)
    if path.startswith("/api/auth/register"):
        # INSCRIPTION : la borne serrée reste. C'est là qu'on CRÉE des comptes,
        # donc un abus ne se mesure pas en échecs de mot de passe mais en
        # comptes créés — le plafond par réseau ne le verrait pas.
        return ("auth-session", 20, 5)
    if path.startswith("/api/messages"):
        # Envoi de messages : 60 POST/min/IP (les GET/HEAD/OPTIONS de
        # lecture/polling sont exemptés, voir RateLimitMiddleware)
        return ("messages", 60, 1)
    if path.startswith("/api/support/whatsapp/webhook"):
        # Webhook WhatsApp (Kapso) : anonyme par nature, et le fournisseur
        # RE-LIVRE une requête dont il n'a pas lu la réponse, parfois GROUPÉE
        # (enveloppe `batch`). Un bucket serré ferait perdre des messages
        # légitimes au premier pic — et une réponse perdue ne se rejoue pas
        # côté client, sur un canal sans historique. 120/min laisse passer une
        # rafale groupée tout en rendant l'amplification inintéressante ; la
        # borne de fond est ailleurs (idempotence par `provider_message_id`,
        # signature HMAC, budget IA de la journée). Règle AVANT le préfixe
        # `/api/support`, qui appliquerait 10/5 min.
        return ("support-whatsapp", 120, 1)
    if path.startswith("/api/support/robot/chat"):
        # Assistant IA : un message = un appel MODÈLE payant, mais la
        # conversation a besoin d'aller vite (l'utilisateur enchaîne les tours).
        # 20 POST/5min/IP est le plafond de coût ; la règle est testée AVANT le
        # préfixe /api/support, qui refuserait 10 messages en 5 minutes.
        return ("support-robot", 20, 5)
    if path.startswith("/api/support"):
        # Tickets support (création publique) : 10 POST/5min/IP
        return ("support", 10, 5)
    if path.startswith("/api/owner"):
        return ("owner", 30, 1)
    # Les DEUX webhooks de paiement, et eux seuls (préfixes exacts : un
    # `GET /api/payments/my` ne doit pas tomber dans un bucket de 120/min).
    # Ces routes sont anonymes par nature et déclenchaient un appel sortant
    # PayDunya à chaque requête : c'est le seul endroit où un tiers choisit
    # combien d'appels le serveur fait. 120/min/IP laisse passer une rafale
    # légitime de callbacks tout en rendant l'amplification inintéressante ;
    # les bornes de fond (paiement déjà confirmé, cache 15 s) sont dans
    # `kojo_routers_payments.paydunya_payment_ipn`.
    if path.startswith("/api/payments/ipn/") or path.startswith("/api/payments/disburse-ipn"):
        return ("payments-ipn", 120, 1)
    return ("general-api", 240, 1)
request_counts: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_MAX_TRACKED_KEYS = 50_000  # garde-fou anti-DoS mémoire
