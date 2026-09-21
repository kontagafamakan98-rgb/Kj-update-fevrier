# -*- coding: utf-8 -*-
"""Middlewares ASGI : en-tetes de securite (et CSRF) puis rate-limiting.

Ils s'executent sur CHAQUE requete. Les isoler rend visible l'ordre dans
lequel `server.py` les monte.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from fastapi import Request, status
from kojo_settings import APP_VERSION, CSRF_COOKIE_NAME, get_security_headers_for_path
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from kojo_network import get_client_ip
from kojo_rate_limit import get_rate_limit_bucket, rate_limit_check

class WestAfricaSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        for header, value in get_security_headers_for_path(request.url.path).items():
            response.headers[header] = value

        response.headers["X-Kojo-Region"] = "west-africa"
        response.headers["X-Kojo-Version"] = APP_VERSION
        # Après le premier login, le navigateur cross-origin ne peut pas lire
        # le cookie CSRF. Ré-émettre sa valeur dans un header CORS exposé
        # permet au frontend de conserver le double-submit sans exposer la
        # session httpOnly.
        #
        # IMPORTANT : si le route handler a déjà posé l'en-tête, on ne le
        # remplace PAS. Cas réel : la rotation de jeton sur /auth/me appelle
        # set_auth_cookies qui pose un NOUVEAU cookie kojo_csrf et met
        # l'en-tête à cette valeur fraîche — mais le cookie envoyé DANS la
        # requête (lu ici) est encore l'ANCIEN. Écraser l'en-tête avec
        # l'ancienne valeur donnerait au client header=ancien CSRF,
        # cookie=nouveau → 403 « Validation CSRF échouée » sur la première
        # mutation après la rotation (double-submit header ≠ cookie).
        if not response.headers.get("X-Kojo-CSRFToken"):
            csrf_token = request.cookies.get(CSRF_COOKIE_NAME)
            if csrf_token:
                response.headers["X-Kojo-CSRFToken"] = csrf_token
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
            # Un endpoint spécifique (ex: /sitemap.xml, /robots.txt, ou la
            # liste publique /jobs qui se met en cache 60s) a déjà posé un
            # Cache-Control précis : on respecte la valeur métier au lieu
            # d'écraser avec le défaut générique ci-dessous.
            if not response.headers.get("Cache-Control"):
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
