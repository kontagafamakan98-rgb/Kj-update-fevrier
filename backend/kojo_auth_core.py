# -*- coding: utf-8 -*-
"""Authentification : lecture du jeton, CSRF, cookies, hachage, et les
dependances FastAPI (`get_current_user`).

Dual-mode (Bearer OU cookie httpOnly de meme origine) et revocation : tout ce
qui decide QUI parle est ici, et rien d'autre.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from kojo_models import User
from kojo_settings import AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, AUTH_COOKIE_SAMESITE, AUTH_COOKIE_SECURE, CSRF_COOKIE_NAME, JWT_ALGORITHM, JWT_EXPIRATION_HOURS, JWT_SECRET, logger
from pydantic import ValidationError
from typing import Optional
import bcrypt
import hmac
import jwt
import secrets
import uuid
from kojo_db import db
# La modération des comptes ne connaît NI ce module NI la façade : elle ne lit
# que des documents et lève des HTTPException. L'importer ici est donc sans
# cycle, et c'est la seule façon d'appliquer un bannissement sur TOUTE requête
# authentifiée — une garde posée sur quelques routes laisserait les autres.
from kojo_comptes_admin import refuser_si_banni, refuser_si_restreint

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
    # Le frontend Vercel est sur une autre origine que l'API Fly : il ne peut
    # pas lire document.cookie du backend. L'en-tête expose uniquement le
    # jeton CSRF (jamais le cookie httpOnly de session), que le client ré-écho
    # ensuite sur les mutations.
    response.headers["X-Kojo-CSRFToken"] = csrf_token
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
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
def verify_password(password: str, hashed: Optional[str]) -> bool:
    """Vérifie un mot de passe bcrypt. hashed=None (compte SSO Google, sans
    mot de passe) → False proprement (le login classique est refusé), au lieu
    d'un AttributeError qui remonterait en 500."""
    if not hashed:
        return False
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    # jti = identifiant unique du token, nécessaire pour pouvoir le révoquer
    # individuellement (ex: au logout) sans invalider tous les autres tokens
    # de l'utilisateur ni changer JWT_SECRET.
    to_encode.update({"exp": expire, "jti": str(uuid.uuid4())})
    # pwdv = version du mot de passe AU MOMENT de l'émission : get_current_user
    # compare cette valeur à password_version du compte ; si le mot de passe a
    # changé depuis (reset), la version diffère → le jeton est refusé (401),
    # ce qui révoque TOUTES les sessions émises avant le changement.
    # (compat : les anciens jetons sans pwdv valent 0 = version initiale).
    if "pwdv" not in to_encode:
        to_encode["pwdv"] = 0
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
# ── Le repli de la révocation : FAIL-OPEN, MAIS PLUS MUET ────────────────
# Lire la liste noire demande une requête Mongo. Quand elle échoue, on choisit
# de ne pas refuser TOUS les jetons (fail-open) : la signature et l'expiration
# JWT, elles, restent toujours vérifiées, et `get_current_user` lit le compte
# juste après — une base réellement muette fait donc échouer la requête de
# toute façon. Ce qui n'était PAS acceptable, c'est que ce repli soit
# indiscernable d'une vérification réussie : un jeton révoqué (déconnexion,
# réinitialisation de mot de passe) repassait, et rien ne le disait. La panne
# est donc COMPTÉE, horodatée et journalisée en erreur — `revocation_stats()`
# est le relevé qu'une sonde ou la console propriétaire peut lire.
REVOCATION_STATS = {"verifications": 0, "echecs": 0, "dernier_echec": None}


def revocation_stats() -> dict:
    """Relevé du repli de révocation (copie : l'appelant ne peut pas le muter)."""
    return dict(REVOCATION_STATS)


async def is_token_revoked(jti: Optional[str]) -> bool:
    if not jti:
        return False
    try:
        revoked = await db.revoked_tokens.find_one({"jti": jti}, {"_id": 1})
        REVOCATION_STATS["verifications"] += 1
        return revoked is not None
    except Exception as e:
        # Fail-open ASSUMÉ (voir le commentaire ci-dessus) — mais la panne est
        # comptée : sans ce compteur, un jeton révoqué qui repasse pendant une
        # panne de la base laissait zéro trace.
        REVOCATION_STATS["echecs"] += 1
        REVOCATION_STATS["dernier_echec"] = datetime.now(timezone.utc).isoformat()
        logger.error(
            "🚨 Vérification de révocation impossible (%s) : le jeton présenté "
            "est ACCEPTÉ sans contrôle de la liste noire (signature et "
            "expiration restent vérifiées). Relevé : revocation_stats().",
            e,
        )
        return False
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
        if user is None or user.get("deleted"):
            # Compte supprimé (soft delete RGPD) : la session ne peut plus rien
            # faire — même traitement qu'un compte inexistant.
            raise HTTPException(status_code=401, detail="User not found")

        # Mot de passe changé depuis l'émission du jeton (reset) → refuser :
        # le payload pwdv est figé à la création, password_version du compte
        # est incrémentée à chaque changement. (compat : anciens jetons sans
        # pwdv valent 0, identiques à un compte jamais modifié).
        if payload.get("pwdv", 0) != user.get("password_version", 0):
            raise HTTPException(
                status_code=401,
                detail="Session expirée : votre mot de passe a changé, reconnectez-vous."
            )

        # ── MODÉRATION : UN COMPTE BANNI N'EXISTE PLUS POUR L'API ────────────
        # Le bannissement est jugé ICI, sur le document relu à chaque requête :
        # il vaut donc dès la requête suivante, sans révocation de jeton à
        # propager (et un jeton volé ne survit pas à la décision). Le refus est
        # un 403 NOMMÉ, motif compris — un refus muet se relit comme une panne.
        refuser_si_banni(user)
        # Le document est posé sur la requête : la restriction d'écriture
        # (`exiger_compte_actif`) le lit sans relire la base, et une route qui
        # veut savoir ce qui est fermé n'a pas à réimplémenter la règle.
        request.state.compte = user

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
async def exiger_compte_actif(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> User:
    """Dépendance des routes d'ÉCRITURE : refuse un compte restreint.

    Le bannissement, lui, est déjà refusé par `get_current_user` (il ferme
    TOUT). La restriction ne ferme que ce qui engage la plateforme : publier,
    postuler, écrire. Consulter, terminer une mission déjà acceptée et payer
    restent ouverts — fermer le paiement d'une mission en cours bloquerait un
    argent séquestré, ce qui n'est pas une sanction mais une panne.

    Le document du compte est celui que `get_current_user` vient de relire
    (`request.state.compte`) : aucune requête en base de plus, et la décision
    lue est exactement celle qui a servi à ouvrir la session.
    """
    refuser_si_restreint(getattr(request.state, "compte", None) or {})
    return current_user


async def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[User]:
    """Variante de get_current_user qui ne lève PAS de 401 : retourne None
    pour les visiteurs anonymes. Utilisée par les endpoints en LECTURE
    publique (liste des jobs, détail d'un job) dont les mutations restent
    strictement authentifiées."""
    try:
        return await get_current_user(request, credentials)
    except HTTPException as exc:
        if exc.status_code == 401:
            return None
        raise
