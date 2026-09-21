# -*- coding: utf-8 -*-
"""Le compte proprietaire : le retrouver, le creer, et reserver l'acces.

`OWNER_EMAIL` et `OWNER_USER_ID` sont LUS ici : c'est donc ce module que les
tests remplacent (`patch("kojo_owner.OWNER_USER_ID")`) quand ils ont besoin
d'un proprietaire connu — ailleurs, le nom ne serait lu par personne.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from kojo_settings import OWNER_EMAIL, OWNER_INITIAL_PASSWORD, OWNER_USER_ID, logger
from typing import Optional
import bcrypt
import jwt
from kojo_auth_core import _decode_auth_token, is_token_revoked, security
from kojo_db import db, is_database_available

async def get_owner_account() -> Optional[dict]:
    """Résout le compte owner RÉEL.

    Source de vérité : l'EMAIL (secret OWNER_EMAIL). En prod, le compte owner
    a été créé avec un id qui ne correspond PAS au secret OWNER_USER_ID, et
    aucun compte ne porte ce secret (id fantôme) — les notifications ciblées
    par le secret étaient donc perdues. On cherche donc d'abord par email,
    puis on retombe sur l'id du secret (compatibilité legacy).

    Retourne None si aucun compte owner n'est trouvé (email ET id absents,
    ou erreur de base) — les appelants doivent alors replier sur
    OWNER_USER_ID / OWNER_EMAIL sans notifier.
    """
    try:
        if OWNER_EMAIL:
            owner = await db.users.find_one({"email": OWNER_EMAIL})
            if owner:
                return owner
        return await db.users.find_one({"id": OWNER_USER_ID})
    except Exception:
        return None
async def resolve_owner_id() -> Optional[str]:
    """Id réel du compte owner (résolu par email), None si introuvable.
    Les appelants doivent replier sur OWNER_USER_ID s'ils reçoivent None."""
    owner = await get_owner_account()
    return (owner or {}).get("id")
async def verify_owner_access(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Vérifie que seul le propriétaire peut accéder aux fonctionnalités sensibles.
    Dual-mode header/cookie (cf. get_current_user). Les mutations via cookie
    exigent un jeton CSRF valide.

    L'identité est résolue par EMAIL (secret OWNER_EMAIL) — source de vérité :
    en prod, l'id du compte owner ne correspond pas forcément au secret
    OWNER_USER_ID (aucun compte ne porte même ce secret). On accepte donc le
    jeton si son email == OWNER_EMAIL ET son id == celui du compte owner
    résolu (repli legacy sur l'id du secret)."""
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

        # Vérification stricte : seul le compte Famakan (par email) a accès.
        if email != OWNER_EMAIL:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
            )

        owner = await get_owner_account()
        owner_id = (owner or {}).get("id")
        if owner_id:
            # Compte owner résolu (email) : le jeton doit être celui de CE compte.
            if user_id != owner_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
                )
            user = owner
        else:
            # Repli legacy : aucun compte owner résolu → comparaison au secret.
            if user_id != OWNER_USER_ID:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
                )
            user = await db.users.find_one({"id": user_id})

        if not user or user.get("deleted"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Propriétaire non trouvé"
            )

        # Mot de passe changé depuis l'émission du jeton → session révoquée
        # (même mécanisme que get_current_user).
        if payload.get("pwdv", 0) != user.get("password_version", 0):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expirée : reconnectez-vous."
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
        # Diagnostic de l'état réel en prod : le compte owner a été créé (par
        # email) avec un id qui ne correspond pas au secret OWNER_USER_ID. On
        # ne change RIEN (changer un id casserait ses références), mais on
        # logue fortement : la résolution owner par email est la source de
        # vérité (get_owner_account / resolve_owner_id).
        if existing_owner.get("email") != OWNER_EMAIL:
            logger.warning(
                f"⚠️ Compte trouvé par id OWNER_USER_ID mais email différent "
                f"({existing_owner.get('email')} != {OWNER_EMAIL}) : ce compte n'est "
                f"PAS le propriétaire — la résolution owner par email échouera."
            )
        elif existing_owner.get("id") != OWNER_USER_ID:
            logger.warning(
                f"⚠️ Compte owner trouvé par email ({OWNER_EMAIL}) mais son id "
                f"({existing_owner.get('id')}) diffère du secret OWNER_USER_ID "
                f"({OWNER_USER_ID}). La résolution owner utilise l'EMAIL comme "
                f"source de vérité (get_owner_account) — notifications et accès "
                f"/api/owner/* ciblent le compte réel."
            )
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
