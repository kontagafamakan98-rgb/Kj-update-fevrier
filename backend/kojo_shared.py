# -*- coding: utf-8 -*-
"""Helpers transverses aux routers : notifications (base + push web) et
envoi conditionnel de l'adresse de la mission au travailleur."""

import asyncio
import json as _json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional


from kojo_core import db
from kojo_models import Message, Notification, NotificationType
from kojo_settings import (
    VAPID_CLAIMS_EMAIL,
    VAPID_PRIVATE_KEY,
    VAPID_PUBLIC_KEY,
    WEBPUSH_AVAILABLE,
    logger,
)
from pywebpush import webpush, WebPushException

async def store_notification(
    user_id: str,
    title: str,
    body: str,
    notif_type: NotificationType = NotificationType.GENERAL,
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
) -> Notification:
    """Persiste une notification en base et retourne l'objet créé."""
    notif = Notification(
        user_id=user_id,
        title=title,
        body=body,
        type=notif_type,
        related_id=related_id,
        related_type=related_type,
    )
    await db.notifications.insert_one(notif.model_dump())
    return notif

async def send_web_push_to_user(user_id: str, title: str, body: str, data: Optional[dict] = None):
    """Envoie une notification Web Push à tous les appareils actifs d'un utilisateur."""
    if not WEBPUSH_AVAILABLE:
        logger.debug("pywebpush non disponible, push ignoré")
        return

    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        logger.debug("Clés VAPID non configurées, push ignoré")
        return

    tokens = await db.push_tokens.find(
        {"user_id": user_id, "active": True, "device_type": "web"}
    ).to_list(length=None)

    if not tokens:
        return

    payload_dict = {"title": title, "body": body}
    if data:
        payload_dict["data"] = data
    payload_str = _json.dumps(payload_dict, ensure_ascii=False)

    failed_token_ids = []
    for token_doc in tokens:
        subscription_info = token_doc.get("push_token")
        if not subscription_info:
            continue

        # Le push_token pour le web est stocké comme une chaîne JSON
        # représentant l'objet PushSubscription (endpoint + keys)
        if isinstance(subscription_info, str):
            try:
                subscription_info = _json.loads(subscription_info)
            except Exception:
                logger.warning(f"Token push invalide pour user {user_id}, ignoré")
                failed_token_ids.append(token_doc["id"])
                continue

        try:
            webpush(
                subscription_info=subscription_info,
                data=payload_str,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={
                    "sub": VAPID_CLAIMS_EMAIL,
                    "exp": int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp()),
                },
            )
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None) if exc.response else None
            if status_code in (404, 410):
                # Token expiré / révoqué par le navigateur
                failed_token_ids.append(token_doc["id"])
                logger.info(f"Token push expiré pour user {user_id}, désactivé")
            else:
                logger.warning(f"WebPushException pour user {user_id}: {exc}")
        except Exception as exc:
            logger.warning(f"Erreur push pour user {user_id}: {exc}")

    # Désactiver les tokens expirés
    for tid in failed_token_ids:
        await db.push_tokens.update_one(
            {"id": tid},
            {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}}
        )

async def notify_user(
    user_id: str,
    title: str,
    body: str,
    notif_type: NotificationType = NotificationType.GENERAL,
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
    push_data: Optional[dict] = None,
):
    """
    Fonction principale : stocke la notification en base ET envoie le push Web.
    Silencieuse en cas d'erreur pour ne jamais bloquer un flux métier.
    """
    try:
        await store_notification(
            user_id=user_id,
            title=title,
            body=body,
            notif_type=notif_type,
            related_id=related_id,
            related_type=related_type,
        )
    except Exception as exc:
        logger.error(f"Erreur stockage notification pour {user_id}: {exc}")

    try:
        await send_web_push_to_user(
            user_id=user_id,
            title=title,
            body=body,
            data=push_data or ({"job_id": related_id} if related_id else None),
        )
    except Exception as exc:
        logger.error(f"Erreur envoi push pour {user_id}: {exc}")

_ADDRESS_MSG: Dict[str, Dict[str, str]] = {
    "fr": {
        "accepted_with_address": "\u2705 Votre proposition a \u00e9t\u00e9 accept\u00e9e pour \u00ab {title} \u00bb.\n\ud83d\udccd Adresse du chantier : {address}",
        "accepted_with_gps":     "\u2705 Votre proposition a \u00e9t\u00e9 accept\u00e9e pour \u00ab {title} \u00bb.\n\ud83d\udccd Position GPS du client : {maps_url}",
        "payment_done_address":  "\ud83d\udcb0 Paiement confirm\u00e9 pour \u00ab {title} \u00bb.\n\ud83d\udccd Adresse du chantier : {address}",
        "payment_done_gps":      "\ud83d\udcb0 Paiement confirm\u00e9 pour \u00ab {title} \u00bb.\n\ud83d\udccd Position GPS du client : {maps_url}",
        "wait_payment":          "\u23f3 Votre proposition pour \u00ab {title} \u00bb a bien \u00e9t\u00e9 accept\u00e9e, mais le paiement du client n'a pas encore \u00e9t\u00e9 effectu\u00e9. L'adresse vous sera communiqu\u00e9e automatiquement d\u00e8s que le paiement sera confirm\u00e9.",
    },
    "en": {
        "accepted_with_address": "\u2705 Your proposal was accepted for \u00ab {title} \u00bb.\n\ud83d\udccd Job address: {address}",
        "accepted_with_gps":     "\u2705 Your proposal was accepted for \u00ab {title} \u00bb.\n\ud83d\udccd Client GPS location: {maps_url}",
        "payment_done_address":  "\ud83d\udcb0 Payment confirmed for \u00ab {title} \u00bb.\n\ud83d\udccd Job address: {address}",
        "payment_done_gps":      "\ud83d\udcb0 Payment confirmed for \u00ab {title} \u00bb.\n\ud83d\udccd Client GPS location: {maps_url}",
        "wait_payment":          "\u23f3 Your proposal for \u00ab {title} \u00bb has been accepted, but the client has not yet completed the payment. The job address will be sent to you automatically once payment is confirmed.",
    },
    "wo": {
        "accepted_with_address": "\u2705 Y\u00e9gg na ci kow \u00ab {title} \u00bb.\n\ud83d\udccd Aadreesa bopp bii: {address}",
        "accepted_with_gps":     "\u2705 Y\u00e9gg na ci kow \u00ab {title} \u00bb.\n\ud83d\udccd Dem xam ci carte bi: {maps_url}",
        "payment_done_address":  "\ud83d\udcb0 Ligg\u00e9eyukaay bi dafay d\u00ebkk \u00ab {title} \u00bb.\n\ud83d\udccd Aadreesa bopp bii: {address}",
        "payment_done_gps":      "\ud83d\udcb0 Ligg\u00e9eyukaay bi dafay d\u00ebkk \u00ab {title} \u00bb.\n\ud83d\udccd Dem xam ci carte bi: {maps_url}",
        "wait_payment":          "\u23f3 B\u00ebgg\u00ebl bi ak \u00ab {title} \u00bb y\u00e9gg na, waaye jaamu gu customer bii dafa s\u00e0nni. Aadreesa bi dinañu la y\u00f3nnee d\u00ebgg rekk jant bi payer bi dafa yokku.",
    },
    "bm": {
        "accepted_with_address": "\u2705 I latig\u025b ye ka sigi \u00ab {title} \u00bb kan.\n\ud83d\udccd Liganbo y\u0254r\u0254 \u0254: {address}",
        "accepted_with_gps":     "\u2705 I latig\u025b ye ka sigi \u00ab {title} \u00bb kan.\n\ud83d\udccd Customer GPS y\u0254r\u0254: {maps_url}",
        "payment_done_address":  "\ud83d\udcb0 Sarabu ka k\u025b \u00ab {title} \u00bb k\u0254f\u025b.\n\ud83d\udccd Liganbo y\u0254r\u0254 \u0254: {address}",
        "payment_done_gps":      "\ud83d\udcb0 Sarabu ka k\u025b \u00ab {title} \u00bb k\u0254f\u025b.\n\ud83d\udccd Customer GPS y\u0254r\u0254: {maps_url}",
        "wait_payment":          "\u23f3 I latig\u025bra \u00ab {title} \u00bb kan, nga customer ma saraba t\u025b k\u025b fo. Liganbo y\u0254r\u0254 \u0254 b\u025bna i g\u025bn sarabu ka s\u0254r\u0254.",
    },
    "mos": {
        "accepted_with_address": "\u2705 Y wilg n bees n \u00ab {title} \u00bb.\n\ud83d\udccd Liggdi t\u1ebd\u014bgo: {address}",
        "accepted_with_gps":     "\u2705 Y wilg n bees n \u00ab {title} \u00bb.\n\ud83d\udccd Client GPS t\u1ebd\u014bgo: {maps_url}",
        "payment_done_address":  "\ud83d\udcb0 Cobd-k\u00e3ab paas la \u00ab {title} \u00bb.\n\ud83d\udccd Liggdi t\u1ebd\u014bgo: {address}",
        "payment_done_gps":      "\ud83d\udcb0 Cobd-k\u00e3ab paas la \u00ab {title} \u00bb.\n\ud83d\udccd Client GPS t\u1ebd\u014bgo: {maps_url}",
        "wait_payment":          "\u23f3 Y wilg bees la \u00ab {title} \u00bb zugu, la b\u00e3an n client soab n k\u00f5 cobd-k\u00e3ab. T\u1ebd\u014bgo la n t\u0169 ne fo n cobd-k\u00e3ab paasame.",
    },
}

def _get_address_msg(lang: str, key: str, **kwargs) -> str:
    texts = _ADDRESS_MSG.get(lang) or _ADDRESS_MSG["fr"]
    template = texts.get(key) or _ADDRESS_MSG["fr"][key]
    return template.format(**kwargs)

async def _dispatch_address_to_worker(
    job: Dict[str, Any],
    worker_id: str,
    sender_id: str,
    phase: str = "accepted",
) -> None:
    """Envoie l'adresse au travailleur dans sa langue (sans doublon)."""
    if job.get("shared_address_sent"):
        return

    worker_doc = await db.users.find_one({"id": worker_id}, {"preferred_language": 1})
    lang = (worker_doc or {}).get("preferred_language") or "fr"
    if lang not in _ADDRESS_MSG:
        lang = "fr"

    job_title = job.get("title") or "la mission"
    job_location = job.get("location") or {}
    shared_location = job.get("shared_location")
    address_text = (
        job_location.get("fullAddress")
        or job_location.get("address")
        or job_location.get("text")
    )

    if shared_location and shared_location.get("maps_url"):
        msg_key = "accepted_with_gps" if phase == "accepted" else "payment_done_gps"
        content = _get_address_msg(lang, msg_key, title=job_title,
                                   maps_url=shared_location["maps_url"])
    elif address_text:
        msg_key = "accepted_with_address" if phase == "accepted" else "payment_done_address"
        content = _get_address_msg(lang, msg_key, title=job_title, address=address_text)
    else:
        return  # pas d'adresse disponible

    conversation_id = f"{min(sender_id, worker_id)}_{max(sender_id, worker_id)}"
    try:
        await db.messages.insert_one(Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            receiver_id=worker_id,
            content=content,
            job_id=job.get("id"),
        ).model_dump())
        await db.jobs.update_one(
            {"id": job.get("id")},
            {"$set": {"shared_address_sent": True}}
        )
        asyncio.create_task(notify_user(
            user_id=worker_id,
            title="📍 Adresse du chantier reçue",
            body=f"L'adresse de « {job_title} » vous a été envoyée.",
            notif_type=NotificationType.GENERAL,
            related_id=job.get("id"),
            related_type="job",
        ))
    except Exception as exc:
        logger.error(f"⚠️ Échec envoi adresse au travailleur: {exc}")

async def _send_payment_pending_to_worker(
    job: Dict[str, Any],
    worker_id: str,
    sender_id: str,
) -> None:
    """Notifie le travailleur dans sa langue que le paiement est en attente."""
    worker_doc = await db.users.find_one({"id": worker_id}, {"preferred_language": 1})
    lang = (worker_doc or {}).get("preferred_language") or "fr"
    if lang not in _ADDRESS_MSG:
        lang = "fr"

    job_title = job.get("title") or "la mission"
    content = _get_address_msg(lang, "wait_payment", title=job_title)
    conversation_id = f"{min(sender_id, worker_id)}_{max(sender_id, worker_id)}"
    try:
        await db.messages.insert_one(Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            receiver_id=worker_id,
            content=content,
            job_id=job.get("id"),
        ).model_dump())
    except Exception as exc:
        logger.error(f"⚠️ Échec envoi message attente paiement: {exc}")
