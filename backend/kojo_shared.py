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
        "accepted_with_address": "\u2705 Votre proposition a \u00e9t\u00e9 accept\u00e9e pour \u00ab {title} \u00bb.\n\U0001f4cd Adresse du chantier : {address}",
        "accepted_with_gps":     "\u2705 Votre proposition a \u00e9t\u00e9 accept\u00e9e pour \u00ab {title} \u00bb.\n\U0001f4cd Position GPS du client : {maps_url}",
        "payment_done_address":  "\U0001f4b0 Paiement confirm\u00e9 pour \u00ab {title} \u00bb.\n\U0001f4cd Adresse du chantier : {address}",
        "payment_done_gps":      "\U0001f4b0 Paiement confirm\u00e9 pour \u00ab {title} \u00bb.\n\U0001f4cd Position GPS du client : {maps_url}",
        "wait_payment":          "\u23f3 Votre proposition pour \u00ab {title} \u00bb a bien \u00e9t\u00e9 accept\u00e9e, mais le paiement du client n'a pas encore \u00e9t\u00e9 effectu\u00e9. L'adresse vous sera communiqu\u00e9e automatiquement d\u00e8s que le paiement sera confirm\u00e9.",
    },
    "en": {
        "accepted_with_address": "\u2705 Your proposal was accepted for \u00ab {title} \u00bb.\n\U0001f4cd Job address: {address}",
        "accepted_with_gps":     "\u2705 Your proposal was accepted for \u00ab {title} \u00bb.\n\U0001f4cd Client GPS location: {maps_url}",
        "payment_done_address":  "\U0001f4b0 Payment confirmed for \u00ab {title} \u00bb.\n\U0001f4cd Job address: {address}",
        "payment_done_gps":      "\U0001f4b0 Payment confirmed for \u00ab {title} \u00bb.\n\U0001f4cd Client GPS location: {maps_url}",
        "wait_payment":          "\u23f3 Your proposal for \u00ab {title} \u00bb has been accepted, but the client has not yet completed the payment. The job address will be sent to you automatically once payment is confirmed.",
    },
    "wo": {
        "accepted_with_address": "\u2705 Y\u00e9gg na ci kow \u00ab {title} \u00bb.\n\U0001f4cd Aadreesa bopp bii: {address}",
        "accepted_with_gps":     "\u2705 Y\u00e9gg na ci kow \u00ab {title} \u00bb.\n\U0001f4cd Dem xam ci carte bi: {maps_url}",
        "payment_done_address":  "\U0001f4b0 Ligg\u00e9eyukaay bi dafay d\u00ebkk \u00ab {title} \u00bb.\n\U0001f4cd Aadreesa bopp bii: {address}",
        "payment_done_gps":      "\U0001f4b0 Ligg\u00e9eyukaay bi dafay d\u00ebkk \u00ab {title} \u00bb.\n\U0001f4cd Dem xam ci carte bi: {maps_url}",
        "wait_payment":          "\u23f3 B\u00ebgg\u00ebl bi ak \u00ab {title} \u00bb y\u00e9gg na, waaye jaamu gu customer bii dafa s\u00e0nni. Aadreesa bi dinañu la y\u00f3nnee d\u00ebgg rekk jant bi payer bi dafa yokku.",
    },
    "bm": {
        "accepted_with_address": "\u2705 I latig\u025b ye ka sigi \u00ab {title} \u00bb kan.\n\U0001f4cd Liganbo y\u0254r\u0254 \u0254: {address}",
        "accepted_with_gps":     "\u2705 I latig\u025b ye ka sigi \u00ab {title} \u00bb kan.\n\U0001f4cd Customer GPS y\u0254r\u0254: {maps_url}",
        "payment_done_address":  "\U0001f4b0 Sarabu ka k\u025b \u00ab {title} \u00bb k\u0254f\u025b.\n\U0001f4cd Liganbo y\u0254r\u0254 \u0254: {address}",
        "payment_done_gps":      "\U0001f4b0 Sarabu ka k\u025b \u00ab {title} \u00bb k\u0254f\u025b.\n\U0001f4cd Customer GPS y\u0254r\u0254: {maps_url}",
        "wait_payment":          "\u23f3 I latig\u025bra \u00ab {title} \u00bb kan, nga customer ma saraba t\u025b k\u025b fo. Liganbo y\u0254r\u0254 \u0254 b\u025bna i g\u025bn sarabu ka s\u0254r\u0254.",
    },
    "mos": {
        "accepted_with_address": "\u2705 Y wilg n bees n \u00ab {title} \u00bb.\n\U0001f4cd Liggdi t\u1ebd\u014bgo: {address}",
        "accepted_with_gps":     "\u2705 Y wilg n bees n \u00ab {title} \u00bb.\n\U0001f4cd Client GPS t\u1ebd\u014bgo: {maps_url}",
        "payment_done_address":  "\U0001f4b0 Cobd-k\u00e3ab paas la \u00ab {title} \u00bb.\n\U0001f4cd Liggdi t\u1ebd\u014bgo: {address}",
        "payment_done_gps":      "\U0001f4b0 Cobd-k\u00e3ab paas la \u00ab {title} \u00bb.\n\U0001f4cd Client GPS t\u1ebd\u014bgo: {maps_url}",
        "wait_payment":          "\u23f3 Y wilg bees la \u00ab {title} \u00bb zugu, la b\u00e3an n client soab n k\u00f5 cobd-k\u00e3ab. T\u1ebd\u014bgo la n t\u0169 ne fo n cobd-k\u00e3ab paasame.",
    },
}

def _get_address_msg(lang: str, key: str, **kwargs) -> str:
    texts = _ADDRESS_MSG.get(lang) or _ADDRESS_MSG["fr"]
    template = texts.get(key) or _ADDRESS_MSG["fr"][key]
    return template.format(**kwargs)

# ---------------------------------------------------------------------------
# Notifications utilisateur : titres + corps traduits dans la langue préférée
# du destinataire (preferred_language). Placeholders {job_title}, {amount},
# {worker_name}, {client_name}, {rating}, {ticket_text}…
# ---------------------------------------------------------------------------
_NOTIF_MSG: Dict[str, Dict[str, Dict[str, str]]] = {
    "fr": {
        "bonus_filleul_first_mission": {"title": "🎁 Bonus de parrainage débloqué", "body": "Votre première mission « {job_title} » est terminée : +{amount} FCFA de bonus vous ont été crédités."},
        "bonus_sponsor_first_mission": {"title": "🎁 Votre filleul a terminé sa première mission", "body": "« {job_title} » est terminée : +{amount} FCFA de récompense de parrainage crédités."},
        "new_job_matching": {"title": "🔔 Nouveau job dans votre domaine", "body": "{job_title}"},
        "mission_cancelled_client_refunded": {"title": "Mission annulée", "body": "Votre paiement de {amount} FCFA pour « {job_title} » a été intégralement remboursé."},
        "mission_cancelled_client_refunding": {"title": "Mission annulée", "body": "Votre remboursement de {amount} FCFA pour « {job_title} » est en cours de traitement."},
        "mission_cancelled_client_refund_failed": {"title": "Mission annulée", "body": "Mission annulée, mais le remboursement automatique a échoué : contactez le support pour un remboursement manuel."},
        "mission_cancelled_client": {"title": "Mission annulée", "body": "La mission « {job_title} » a été annulée."},
        "mission_cancelled_worker": {"title": "Mission annulée", "body": "La mission « {job_title} » a été annulée par le client."},
        "proposal_received": {"title": "Nouvelle proposition reçue", "body": "{worker_name} a soumis une proposition pour « {job_title} »"},
        "proposal_accepted": {"title": "Proposition acceptée ! 🎉", "body": "{client_name} a accepté votre proposition pour « {job_title} »"},
        "payment_sent_worker": {"title": "Mission terminée — Paiement en route 💰", "body": "Votre paiement de {amount} FCFA pour « {job_title} » a été envoyé."},
        "payment_releasing_worker": {"title": "Mission terminée — Paiement en route 💰", "body": "Votre paiement de {amount} FCFA pour « {job_title} » est en cours de traitement."},
        "payment_manual_worker": {"title": "Mission terminée — Paiement en route 💰", "body": "Mission « {job_title} » terminée. Versement à traiter manuellement."},
        "mission_closed": {"title": "Mission clôturée ✅", "body": "La mission « {job_title} » a été marquée comme terminée."},
        "refund_confirmed": {"title": "Remboursement confirmé ✅", "body": "Votre remboursement de {amount} FCFA a été confirmé par PayDunya."},
        "refund_failed": {"title": "Remboursement en échec ⚠️", "body": "Le remboursement automatique a échoué : contactez le support pour un remboursement manuel."},
        "payment_confirmed_client": {"title": "Paiement confirmé ✅", "body": "Votre paiement de {amount} FCFA pour « {job_title} » a bien été reçu."},
        "payment_received_worker": {"title": "Paiement sécurisé 🔒", "body": "Le client a payé {amount} FCFA pour « {job_title} ». Fonds sécurisés jusqu'à la fin de la mission."},
        "new_review": {"title": "Nouvel avis reçu ⭐", "body": "Vous avez reçu une note de {rating}/5 sur « {job_title} »."},
        "referral_withdraw_success": {"title": "💰 Retrait de récompenses confirmé", "body": "Vos {amount} FCFA de récompenses de parrainage ont été envoyés sur votre compte mobile money."},
        "referral_withdraw_pending": {"title": "💰 Retrait de récompenses en cours", "body": "Votre retrait de {amount} FCFA est en cours de traitement. Vous serez notifié à la confirmation."},
        "referral_withdraw_failed": {"title": "⚠️ Retrait de récompenses en échec", "body": "Votre retrait de {amount} FCFA a échoué. Le montant est toujours sur votre solde, réessayez."},
        "new_ticket_support": {"title": "Nouveau ticket support", "body": "{ticket_text}"},
        "address_dispatched": {"title": "📍 Adresse du chantier reçue", "body": "L'adresse de « {job_title} » vous a été envoyée."},
    },
    "en": {
        "bonus_filleul_first_mission": {"title": "🎁 Referral bonus unlocked", "body": "Your first job « {job_title} » is complete: +{amount} FCFA bonus credited to you."},
        "bonus_sponsor_first_mission": {"title": "🎁 Your referral completed their first job", "body": "« {job_title} » is complete: +{amount} FCFA referral reward credited."},
        "new_job_matching": {"title": "🔔 New job in your field", "body": "{job_title}"},
        "mission_cancelled_client_refunded": {"title": "Job cancelled", "body": "Your payment of {amount} FCFA for « {job_title} » has been fully refunded."},
        "mission_cancelled_client_refunding": {"title": "Job cancelled", "body": "Your refund of {amount} FCFA for « {job_title} » is being processed."},
        "mission_cancelled_client_refund_failed": {"title": "Job cancelled", "body": "Job cancelled, but the automatic refund failed: contact support for a manual refund."},
        "mission_cancelled_client": {"title": "Job cancelled", "body": "The job « {job_title} » has been cancelled."},
        "mission_cancelled_worker": {"title": "Job cancelled", "body": "The job « {job_title} » was cancelled by the client."},
        "proposal_received": {"title": "New proposal received", "body": "{worker_name} submitted a proposal for « {job_title} »"},
        "proposal_accepted": {"title": "Proposal accepted! 🎉", "body": "{client_name} accepted your proposal for « {job_title} »"},
        "payment_sent_worker": {"title": "Job completed — Payment on the way 💰", "body": "Your payment of {amount} FCFA for « {job_title} » has been sent."},
        "payment_releasing_worker": {"title": "Job completed — Payment on the way 💰", "body": "Your payment of {amount} FCFA for « {job_title} » is being processed."},
        "payment_manual_worker": {"title": "Job completed — Payment on the way 💰", "body": "Job « {job_title} » completed. Payout to be handled manually."},
        "mission_closed": {"title": "Job closed ✅", "body": "The job « {job_title} » has been marked as completed."},
        "refund_confirmed": {"title": "Refund confirmed ✅", "body": "Your refund of {amount} FCFA has been confirmed by PayDunya."},
        "refund_failed": {"title": "Refund failed ⚠️", "body": "The automatic refund failed: contact support for a manual refund."},
        "payment_confirmed_client": {"title": "Payment confirmed ✅", "body": "Your payment of {amount} FCFA for « {job_title} » has been received."},
        "payment_received_worker": {"title": "Secure payment 🔒", "body": "The client paid {amount} FCFA for « {job_title} ». Funds are secured until the job is completed."},
        "new_review": {"title": "New review received ⭐", "body": "You received a rating of {rating}/5 on « {job_title} »."},
        "referral_withdraw_success": {"title": "💰 Referral rewards withdrawn", "body": "Your {amount} FCFA referral rewards have been sent to your mobile money account."},
        "referral_withdraw_pending": {"title": "💰 Referral withdrawal in progress", "body": "Your {amount} FCFA withdrawal is being processed. You will be notified once confirmed."},
        "referral_withdraw_failed": {"title": "⚠️ Referral withdrawal failed", "body": "Your {amount} FCFA withdrawal failed. The amount is still on your balance, please retry."},
        "new_ticket_support": {"title": "New support ticket", "body": "{ticket_text}"},
        "address_dispatched": {"title": "📍 Job address received", "body": "The address for « {job_title} » has been sent to you."},
    },
    "wo": {
        "bonus_filleul_first_mission": {"title": "🎁 Bonus bu parrainage bi", "body": "Sa njëkk liggéey « {job_title} » mujj na: +{amount} FCFA bonus ñu la jox."},
        "bonus_sponsor_first_mission": {"title": "🎁 Sa filleul mujj na ci sa njëkk liggéey", "body": "« {job_title} » mujj na: +{amount} FCFA récompense ñu la jox."},
        "new_job_matching": {"title": "🔔 Liggéey bu bees ci sa yoon", "body": "{job_title}"},
        "mission_cancelled_client_refunded": {"title": "Mission biy dindi", "body": "Sa paay bu {amount} FCFA ci « {job_title} » ñu ko dëbbal."},
        "mission_cancelled_client_refunding": {"title": "Mission biy dindi", "body": "Sa dëbbal bu {amount} FCFA ci « {job_title} » moo ngi ci yoon."},
        "mission_cancelled_client_refund_failed": {"title": "Mission biy dindi", "body": "Mission bi dindi na, waaye dëbbal bi amul: wacc support bi ngir dëbbal bu loxo."},
        "mission_cancelled_client": {"title": "Mission biy dindi", "body": "Mission bi « {job_title} » dindi na."},
        "mission_cancelled_worker": {"title": "Mission biy dindi", "body": "Mission bi « {job_title} » client bi dindi ko."},
        "proposal_received": {"title": "Proposition bu bees", "body": "{worker_name} jox na proposition ci « {job_title} »"},
        "proposal_accepted": {"title": "Proposition jàpp nañu ko! 🎉", "body": "{client_name} jàpp na sa proposition ci « {job_title} »"},
        "payment_sent_worker": {"title": "Liggéey bi mujj na — Paay moo ngi yoon 💰", "body": "Sa paay bu {amount} FCFA ci « {job_title} » ñu ko yónnee."},
        "payment_releasing_worker": {"title": "Liggéey bi mujj na — Paay moo ngi yoon 💰", "body": "Sa paay bu {amount} FCFA ci « {job_title} » moo ngi ci yoon."},
        "payment_manual_worker": {"title": "Liggéey bi mujj na — Paay moo ngi yoon 💰", "body": "Liggéey bi « {job_title} » mujj na. Paay bi ñu koy def ci loxo."},
        "mission_closed": {"title": "Liggéey bi dëkk na ✅", "body": "Liggéey bi « {job_title} » ñu ko def bu mujj."},
        "refund_confirmed": {"title": "Dëbbal bi dëgg na ✅", "body": "Sa dëbbal bu {amount} FCFA PayDunya ko dëgg na."},
        "refund_failed": {"title": "Dëbbal bi amul ⚠️", "body": "Dëbbal bi amul: wacc support bi ngir dëbbal bu loxo."},
        "payment_confirmed_client": {"title": "Paay bi dëgg na ✅", "body": "Sa paay bu {amount} FCFA ci « {job_title} » ñu ko jàpp."},
        "payment_received_worker": {"title": "Paay bi am na sécurité 🔒", "body": "Client bi fay na {amount} FCFA ci « {job_title} ». Xaalis bi am na sécurité ba mission bi mujj."},
        "new_review": {"title": "Avis bu bees ⭐", "body": "Ñu la jox naat bu {rating}/5 ci « {job_title} »."},
        "referral_withdraw_success": {"title": "💰 Récompense yi ñu génn", "body": "Sa récompense bu {amount} FCFA ñu koy yónnee ci sa konte mobile money."},
        "referral_withdraw_pending": {"title": "💰 Génn bu récompense bi moo ngi ci yoon", "body": "Sa génn bu {amount} FCFA moo ngi ci yoon. Ñu lay xibaar bu ko ñu def."},
        "referral_withdraw_failed": {"title": "⚠️ Génn bi fexeewul", "body": "Sa génn bu {amount} FCFA fexeewul. Xaalis bi dafay ci sa solde, gay naa indi ci."},
        "new_ticket_support": {"title": "Ticket support bu bees", "body": "{ticket_text}"},
        "address_dispatched": {"title": "📍 Aadreesu mission bi ñu jox", "body": "Aadrees bi ci « {job_title} » ñu la ko yónnee."},
    },
    "bm": {
        "bonus_filleul_first_mission": {"title": "🎁 Bonus parrainage bɔlen", "body": "I ka baara fɔlɔ « {job_title} » dafara: +{amount} FCFA bonus bɛ i ka konti la."},
        "bonus_sponsor_first_mission": {"title": "🎁 I ka filleul dafara a ka baara fɔlɔ", "body": "« {job_title} » dafara: +{amount} FCFA récompense bɛ i ka konti la."},
        "new_job_matching": {"title": "🔔 Baara kura i ka yɔrɔ la", "body": "{job_title}"},
        "mission_cancelled_client_refunded": {"title": "Baara banna", "body": "I ka wari {amount} FCFA « {job_title} » kɔnɔ, a sɛgɛnen bɛ i ma."},
        "mission_cancelled_client_refunding": {"title": "Baara banna", "body": "I ka sɛgɛnli {amount} FCFA « {job_title} » kɔnɔ bɛ taa."},
        "mission_cancelled_client_refund_failed": {"title": "Baara banna", "body": "Baara banna, nka automatique sɛgɛnli ma kɛ: support dɛmɛ ɲini sɛgɛnli ma kɛ."},
        "mission_cancelled_client": {"title": "Baara banna", "body": "Baara « {job_title} » banna."},
        "mission_cancelled_worker": {"title": "Baara banna", "body": "Baara « {job_title} » client banna a la."},
        "proposal_received": {"title": "Proposition kura donna", "body": "{worker_name} ka proposition ci « {job_title} » kan"},
        "proposal_accepted": {"title": "Proposition sɔnnen! 🎉", "body": "{client_name} sɔnna i ka proposition « {job_title} » kan"},
        "payment_sent_worker": {"title": "Baara dafara — Wari bɛ na 💰", "body": "I ka wari {amount} FCFA « {job_title} » kɔnɔ, a cira."},
        "payment_releasing_worker": {"title": "Baara dafara — Wari bɛ na 💰", "body": "I ka wari {amount} FCFA « {job_title} » kɔnɔ bɛ taa."},
        "payment_manual_worker": {"title": "Baara dafara — Wari bɛ na 💰", "body": "Baara « {job_title} » dafara. Wari kɛli bɛ kɛ ni lɔgɔkɛla dɛmɛ ye."},
        "mission_closed": {"title": "Baara dafalen ✅", "body": "Baara « {job_title} » dafara."},
        "refund_confirmed": {"title": "Sɛgɛnli dafalen ✅", "body": "I ka sɛgɛnli {amount} FCFA PayDunya dafara a la."},
        "refund_failed": {"title": "Sɛgɛnli ma kɛ ⚠️", "body": "Automatique sɛgɛnli ma kɛ: support dɛmɛ ɲini."},
        "payment_confirmed_client": {"title": "Wari dafalen ✅", "body": "I ka wari {amount} FCFA « {job_title} » kɔnɔ donna."},
        "payment_received_worker": {"title": "Wari sɛgɛsɛgɛnen 🔒", "body": "Client fayara {amount} FCFA « {job_title} » kɔnɔ. Wari bɛ sɛgɛsɛgɛn fo baara ka dafɔ."},
        "new_review": {"title": "Avis kura ⭐", "body": "I ye {rating}/5 sɔrɔ « {job_title} » kan."},
        "referral_withdraw_success": {"title": "💰 Récompense bɔli", "body": "I ka récompense {amount} FCFA cira i ka mobile money konti la."},
        "referral_withdraw_pending": {"title": "💰 Récompense bɔli bɛ taa", "body": "I ka bɔli {amount} FCFA bɛ taa. Bɛna fɔ i ye ni a baara ye."},
        "referral_withdraw_failed": {"title": "⚠️ Récompense bɔli tɛna kɛ", "body": "I ka bɔli {amount} FCFA tɛna kɛ. Wari bɛ i ka konti la, kɔsɛbɛ i ka ɲini."},
        "new_ticket_support": {"title": "Ticket support kura", "body": "{ticket_text}"},
        "address_dispatched": {"title": "📍 Baara yɔrɔ donnen", "body": "Baara « {job_title} » ka yɔrɔ ci i ma."},
    },
    "mos": {
        "bonus_filleul_first_mission": {"title": "🎁 Parrainage bonus", "body": "F tʋʋm rẽgenga « {job_title} » sɑɑme: +{amount} FCFA bonus b tʋm ne fo."},
        "bonus_sponsor_first_mission": {"title": "🎁 F filleul sɑɑm a rẽgeng tʋʋm", "body": "« {job_title} » sɑɑme: +{amount} FCFA sɩd n kõo fo."},
        "new_job_matching": {"title": "🔔 Tʋʋm paalle f yĩngre", "body": "{job_title}"},
        "mission_cancelled_client_refunded": {"title": "Tʋʋm yãaga", "body": "F ligdi {amount} FCFA « {job_title} » yĩngre, b lebsa-la f nengẽ."},
        "mission_cancelled_client_refunding": {"title": "Tʋʋm yãaga", "body": "F lebsg {amount} FCFA « {job_title} » yĩngre b tʋmda."},
        "mission_cancelled_client_refund_failed": {"title": "Tʋʋm yãaga", "body": "Tʋʋmã yãaga, la bɑɑs n lebsg ka tõog: tall support n na n lebs f ligdi."},
        "mission_cancelled_client": {"title": "Tʋʋm yãaga", "body": "Tʋʋmã « {job_title} » yãagame."},
        "mission_cancelled_worker": {"title": "Tʋʋm yãaga", "body": "Tʋʋmã « {job_title} » daabã n yãag n yã."},
        "proposal_received": {"title": "Proposition paalle", "body": "{worker_name} tʋma proposition « {job_title} » zugu"},
        "proposal_accepted": {"title": "B reɛg f proposition! 🎉", "body": "{client_name} reɛga f proposition « {job_title} » zugu"},
        "payment_sent_worker": {"title": "Tʋʋm sɑɑme — Ligdi be sorẽ 💰", "body": "B tʋma f ligdi {amount} FCFA « {job_title} » yĩngre."},
        "payment_releasing_worker": {"title": "Tʋʋm sɑɑme — Ligdi be sorẽ 💰", "body": "B tʋmda f ligdi {amount} FCFA « {job_title} » yĩngre."},
        "payment_manual_worker": {"title": "Tʋʋm sɑɑme — Ligdi be sorẽ 💰", "body": "Tʋʋmã « {job_title} » sɑɑme. B na n kõ f ligdi ne nusẽ."},
        "mission_closed": {"title": "Tʋʋm sɑɑme ✅", "body": "Tʋʋmã « {job_title} » b sɑɑm n yã."},
        "refund_confirmed": {"title": "Lebsg sɑɑme ✅", "body": "B sɑɑma f lebsg {amount} FCFA ne PayDunya."},
        "refund_failed": {"title": "Lebsg ka tõoge ⚠️", "body": "Lebsg ka tõoge: tall support n na n lebs f ligdi."},
        "payment_confirmed_client": {"title": "Ligdi sɑɑme ✅", "body": "B sɑɑma f ligdi {amount} FCFA « {job_title} » yĩngre."},
        "payment_received_worker": {"title": "Ligdi bãngre 🔒", "body": "Daabã kõo {amount} FCFA « {job_title} » yĩngre. Ligdi be bãngre n tɩ tʋʋmã sɑɑ."},
        "new_review": {"title": "N yãɑɑr paalle ⭐", "body": "F yãa nɑɑsgo {rating}/5 « {job_title} » zugu."},
        "referral_withdraw_success": {"title": "💰 Récompense yit n yi", "body": "B tʋma f récompense {amount} FCFA f mobile money kont pʋgẽ."},
        "referral_withdraw_pending": {"title": "💰 Récompense yit n be sorẽ", "body": "F yit {amount} FCFA be sorẽ. B na n kõ f kibar tɩ b sɑɑme."},
        "referral_withdraw_failed": {"title": "⚠️ Récompense yit n sɑɑm ne paoogo", "body": "F yit {amount} FCFA sɑɑm ne paoogo. Ligdã be f solde zugu, lebs n maan."},
        "new_ticket_support": {"title": "Support ticket paalle", "body": "{ticket_text}"},
        "address_dispatched": {"title": "📍 Tʋʋm zĩigã", "body": "Zĩig ning « {job_title} » yĩngre b tʋma ne fo."},
    },
}


def _interpolate(template: str, **kwargs) -> str:
    """Interpolation simple {cle} → valeur (sans casser sur les accolades libres)."""
    if not kwargs:
        return template
    result = template
    for name, value in kwargs.items():
        result = result.replace("{" + name + "}", str(value))
    return result


def _get_notif_msgs(lang: str, key: str, **kwargs) -> tuple:
    """Retourne (titre, corps) traduits pour une clé de notification."""
    texts = _NOTIF_MSG.get(lang) or _NOTIF_MSG["fr"]
    entry = texts.get(key) or _NOTIF_MSG["fr"][key]
    return (
        _interpolate(entry["title"], **kwargs),
        _interpolate(entry["body"], **kwargs),
    )


async def get_user_language(user_id: str) -> str:
    """Langue préférée d'un utilisateur (défaut: fr)."""
    try:
        user_doc = await db.users.find_one({"id": user_id}, {"preferred_language": 1})
    except Exception:
        user_doc = None
    lang = (user_doc or {}).get("preferred_language") or "fr"
    return lang if lang in _NOTIF_MSG else "fr"


async def notify_user_localized(
    user_id: str,
    key: str,
    notif_type: NotificationType = NotificationType.GENERAL,
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
    push_data: Optional[dict] = None,
    **kwargs,
):
    """
    Comme notify_user, mais le titre et le corps sont traduits dans la langue
    préférée du destinataire (clé de _NOTIF_MSG, placeholders {…} en kwargs).
    """
    lang = await get_user_language(user_id)
    title, body = _get_notif_msgs(lang, key, **kwargs)
    await notify_user(
        user_id=user_id,
        title=title,
        body=body,
        notif_type=notif_type,
        related_id=related_id,
        related_type=related_type,
        push_data=push_data,
    )


async def apply_referral_payout_confirmed(payment_record: dict) -> None:
    """Applique la confirmation d'un retrait de récompenses de parrainage
    (payout_kind == "referral") : décrémente le solde du travailleur, trace
    le retrait dans son historique et lève le verrou anti double-retrait.

    Idempotent (flag referral_balance_applied posé sur l'enregistrement de
    paiement) — appelé quand le décaissement passe "released", que ce soit
    de façon synchrone (submit-invoice "success") ou asynchrone (IPN disburse
    ou check-status). Point unique de vérité du solde de récompenses."""
    payment = await db.payments.find_one({"id": payment_record.get("id")})
    if not payment:
        return
    if payment.get("payout_kind") != "referral" or payment.get("payout_status") != "released":
        return
    if payment.get("referral_balance_applied"):
        return

    user_id = payment.get("payer_id")
    amount = int(payment.get("amount", 0) or 0)
    if not user_id or amount <= 0:
        return

    user = await db.users.find_one({"id": user_id}, {"referral_reward_balance": 1})
    if not user:
        return
    current_balance = float(user.get("referral_reward_balance") or 0)
    new_balance = max(0.0, current_balance - amount)

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "referral_reward_balance": new_balance,
                "referral_withdrawal_in_progress": False,
                "updated_at": datetime.now(timezone.utc),
            },
            "$push": {"referral_rewards": {
                "type": "withdrawal",
                "amount": -amount,
                "payment_id": payment.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
        },
    )
    await db.payments.update_one(
        {"id": payment["id"]},
        {"$set": {"referral_balance_applied": True}},
    )
    asyncio.create_task(notify_user_localized(
        user_id=user_id,
        key="referral_withdraw_success",
        notif_type=NotificationType.GENERAL,
        amount=amount,
    ))

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
        asyncio.create_task(notify_user_localized(
            user_id=worker_id,
            key="address_dispatched",
            notif_type=NotificationType.GENERAL,
            related_id=job.get("id"),
            related_type="job",
            job_title=job_title,
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
