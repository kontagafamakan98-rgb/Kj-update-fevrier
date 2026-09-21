# -*- coding: utf-8 -*-
"""Televersements d'images et sonde de sante Cloudinary.

Le SDK Cloudinary n'est utilise qu'ici : la sonde (admin API, lecture seule)
et les deux televersements (photo de profil, images de mission). Un module qui
ne fait que des requetes HTTP vers un tiers se teste seul.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from cloudinary import uploader as cloudinary_uploader
import cloudinary
# `cloudinary.api` est un SOUS-MODULE : sans cet import, l'attribut `api`
# n'existe pas sur le paquet, et `cloudinary_health_probe` echoue au moment de
# l'appel (et tout `patch("…cloudinary.api.ping")` echoue des la resolution).
# C'est exactement la ligne qu'un decoupage automatique laisse tomber.
import cloudinary.api
import time
import uuid

# --- Sonde de santé Cloudinary (moniteur d'infra /monitor/cloudinary) ---
# cloudinary.api.ping() est la sonde officielle (Admin API, read-only,
# légère). Cache TTL court : le moniteur peut interroger toutes les 30-60 s,
# on ne martèle pas Cloudinary pour autant. La config globale (cloud_name,
# api_key, api_secret) est lue depuis l'environnement (CLOUDINARY_URL) par le
# SDK à l'import.
CLOUDINARY_HEALTH_CACHE_TTL_SECONDS = 60
_cloudinary_health_cache = {}  # {"at": float, "result": dict}
def cloudinary_health_probe() -> dict:
    """Sonde l'API Cloudinary (ping officiel) pour /monitor/cloudinary.

    Retourne {"ok": bool, "configured": bool, "detail": str} — jamais
    d'exception. Résultat mis en cache TTL (60 s) pour ne pas marteler
    Cloudinary quand le moniteur interroge fréquemment.
    """
    now = time.time()
    cached = _cloudinary_health_cache.get("result")
    if cached and (now - cached["at"]) < CLOUDINARY_HEALTH_CACHE_TTL_SECONDS:
        return cached["result"]

    try:
        cfg = cloudinary.config()
        if not (cfg.cloud_name and cfg.api_key and cfg.api_secret):
            result = {
                "ok": False,
                "configured": False,
                "detail": "Cloudinary non configuré (CLOUDINARY_URL)",
            }
        else:
            ping = cloudinary.api.ping(timeout=5)
            ok = ping.get("status") == "ok"
            result = {
                "ok": ok,
                "configured": True,
                "detail": f"status={ping.get('status')}" if ok else f"Ping inattendu: {ping}",
            }
    except Exception as exc:
        result = {
            "ok": False,
            "configured": True,
            "detail": f"Transport Cloudinary indisponible: {exc}",
        }

    _cloudinary_health_cache["result"] = {"at": now, "result": result}
    return result
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
