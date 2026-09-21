# -*- coding: utf-8 -*-
"""Facade de l'infrastructure partagee : elle ne fait que COMPOSER.

CE MODULE A ETE DECOUPE (21/09/2026). Voici l'etat qui en resulte, pour que la
prochaine passe n'ait pas a le redecouvrir :

  * `kojo_db`          la connexion MongoDB, le nom `db`, les index ;
  * `kojo_cloudinary`  televersements et sonde Cloudinary ;
  * `kojo_rate_limit`  Redis/memoire, fenetres et politique par route ;
  * `kojo_network`     IP du client, hotes de confiance, origines CORS ;
  * `kojo_auth_core`   jeton, CSRF, cookies, hachage, `get_current_user` ;
  * `kojo_middlewares` les deux middlewares ASGI ;
  * `kojo_owner`       le compte proprietaire et l'acces reserve ;
  * `kojo_validation`  validation, assainissement, masquage, refus journalise.

POURQUOI IL EXISTE ENCORE

Ses importeurs font `from kojo_core import ...` : ce module est leur porte
d'entree et doit rester une facade SANS logique. Un nom ajoute ici vient
forcement d'un des modules ci-dessus.

CE QUI GARANTIT QUE RIEN N'A CHANGE

`tests/test_core_surface.py` fige la surface (noms, nature, signature) DERIVEE
des importeurs eux-memes, et `tests/test_core_db_seam.py` verifie que le nom
`db` n'a qu'une source : celle que les tests remplacent.

L'ORDRE DES IMPORTS EST CELUI DES DEPENDANCES : `kojo_db` ne depend d'aucun
autre, `kojo_owner` depend de `kojo_db` et de `kojo_auth_core`. Aucun module
extrait n'importe `kojo_core` (ce serait un cycle).
"""

import cloudinary

from kojo_settings import OWNER_EMAIL, OWNER_USER_ID
from kojo_db import client, create_database_indexes, db, is_database_available
from kojo_cloudinary import (
    CLOUDINARY_HEALTH_CACHE_TTL_SECONDS,
    _cloudinary_health_cache,
    cloudinary_health_probe,
    upload_image_to_cloudinary,
    upload_profile_photo_to_cloudinary,
)
from kojo_rate_limit import (
    RATE_LIMIT_MAX_TRACKED_KEYS,
    _rate_limit_cleanup_loop,
    _try_init_redis,
    get_rate_limit_bucket,
    rate_limit_check,
    request_counts,
)
from kojo_network import (
    WEST_AFRICA_ORIGINS,
    build_allowed_origins,
    build_trusted_hosts,
    extract_host_from_url,
    get_client_ip,
    normalize_origin,
)
from kojo_auth_core import (
    clear_auth_cookies,
    create_access_token,
    get_current_user,
    get_current_user_optional,
    hash_password,
    is_token_revoked,
    revoke_token,
    security,
    set_auth_cookies,
    verify_password,
)
from kojo_middlewares import RateLimitMiddleware, WestAfricaSecurityMiddleware
from kojo_owner import ensure_owner_exists, get_owner_account, resolve_owner_id, verify_owner_access
from kojo_validation import (
    ALL_PREFIXES_70_99,
    COTE_DIVOIRE_ALL_MOBILE_PREFIXES,
    KOJO_PRIORITY_COUNTRIES,
    is_valid_image_content,
    log_and_raise_http_exception,
    luhn_check,
    mask_bank_account_info,
    mask_bank_card,
    sanitize_email,
    sanitize_input_string,
    validate_bank_account,
    validate_bank_card,
    validate_orange_money_number,
    validate_payment_accounts,
    validate_wave_number,
)

# `__all__` n'est pas une seconde liste a tenir : pyflakes refuse un nom
# qui n'est pas importe (nom non defini dans `__all__`) et refuse un
# import qui n'y figure pas (import inutilise). Les deux doivent donc
# dire exactement la meme chose, sous peine de rouge.
__all__ = [
    "ALL_PREFIXES_70_99",
    "CLOUDINARY_HEALTH_CACHE_TTL_SECONDS",
    "COTE_DIVOIRE_ALL_MOBILE_PREFIXES",
    "KOJO_PRIORITY_COUNTRIES",
    "OWNER_EMAIL",
    "OWNER_USER_ID",
    "RATE_LIMIT_MAX_TRACKED_KEYS",
    "RateLimitMiddleware",
    "WEST_AFRICA_ORIGINS",
    "WestAfricaSecurityMiddleware",
    "_cloudinary_health_cache",
    "_rate_limit_cleanup_loop",
    "_try_init_redis",
    "build_allowed_origins",
    "build_trusted_hosts",
    "clear_auth_cookies",
    "client",
    "cloudinary",
    "cloudinary_health_probe",
    "create_access_token",
    "create_database_indexes",
    "db",
    "ensure_owner_exists",
    "extract_host_from_url",
    "get_client_ip",
    "get_current_user",
    "get_current_user_optional",
    "get_owner_account",
    "get_rate_limit_bucket",
    "hash_password",
    "is_database_available",
    "is_token_revoked",
    "is_valid_image_content",
    "log_and_raise_http_exception",
    "luhn_check",
    "mask_bank_account_info",
    "mask_bank_card",
    "normalize_origin",
    "rate_limit_check",
    "request_counts",
    "resolve_owner_id",
    "revoke_token",
    "sanitize_email",
    "sanitize_input_string",
    "security",
    "set_auth_cookies",
    "upload_image_to_cloudinary",
    "upload_profile_photo_to_cloudinary",
    "validate_bank_account",
    "validate_bank_card",
    "validate_orange_money_number",
    "validate_payment_accounts",
    "validate_wave_number",
    "verify_owner_access",
    "verify_password",
]
