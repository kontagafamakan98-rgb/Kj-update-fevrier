# -*- coding: utf-8 -*-
"""Helpers transverses aux routers : notifications (base + push web) et
envoi conditionnel de l'adresse de la mission au travailleur."""

import asyncio
import json as _json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional


from kojo_core import db
import kojo_live
from kojo_models import Message, Notification, NotificationType
from kojo_settings import (
    VAPID_CLAIMS_EMAIL,
    VAPID_PRIVATE_KEY,
    VAPID_PUBLIC_KEY,
    WEBPUSH_AVAILABLE,
    logger,
)
# pywebpush est OPTIONNEL (WEBPUSH_AVAILABLE dans kojo_settings, détecté via
# find_spec). L'import est donc conditionnel : si le paquet manque, le serveur
# ne doit pas refuser de démarrer — send_web_push_to_user garde déjà un early
# return quand WEBPUSH_AVAILABLE est False.
try:
    from pywebpush import webpush, WebPushException
except ImportError:  # pragma: no cover - dépend de l'installation
    webpush = None
    WebPushException = None

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
    # PUSH TEMPS RÉEL (SSE) : la ligne est stockée AVANT l'annonce, donc un
    # client qui la reçoit peut la marquer lue / la supprimer sans 404. Aucun
    # flux ouvert n'est le cas normal (application fermée) : l'événement est
    # alors simplement déposé dans le vide, et la notification reste lisible
    # par l'API. `publish` ne lève pas et ne fait aucune I/O.
    kojo_live.publish(
        user_id,
        "notification",
        {"notification": notif.model_dump(mode="json")},
    )
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
) -> Optional[Notification]:
    """
    Fonction principale : stocke la notification en base ET envoie le push Web.
    Silencieuse en cas d'erreur pour ne jamais bloquer un flux métier.

    Retourne la notification ÉCRITE, ou `None` quand rien n'a été déposé (destinataire
    supprimé, ou stockage en échec). L'appelant qui doit décider « cette information
    est-elle passée ? » — les alertes emploi le font pour avancer leur fenêtre — lit
    ce retour au lieu de le supposer.

    Garde-fou anti-notification orpheline : un destinataire SUPPRIMÉ
    (deleted=True, compte anonymisé) ne reçoit plus rien. Cas réel (audit
    IPN disburse) : un remboursement initié pendant delete_my_account peut
    rester en vol (refunding) et être tranché APRÈS la suppression du compte
    du payeur → sans ce garde-fou, une notification refunded/refund_failed
    était créée pour un compte fantôme (la cascade de suppression avait déjà
    purgé les notifications existantes). Le statut du paiement, lui, est mis
    à jour indépendamment de cette notification.
    """
    try:
        recipient = await db.users.find_one({"id": user_id}, {"deleted": 1})
        if not recipient or recipient.get("deleted"):
            return
    except Exception:
        # Jamais bloquant : si la vérification échoue, on notifie quand même.
        pass

    notif: Optional[Notification] = None
    try:
        notif = await store_notification(
            user_id=user_id,
            title=title,
            body=body,
            notif_type=notif_type,
            related_id=related_id,
            related_type=related_type,
        )
    except Exception as exc:
        logger.error(f"Erreur stockage notification pour {user_id}: {exc}")

    # L'identifiant SERVEUR voyage avec le push. Sans lui, l'entrée affichée par
    # le centre de notifications à la réception au premier plan porte un
    # identifiant inventé côté client (`local_<horodatage>`) : la supprimer
    # répond 404 et elle reste à l'écran, la marquer lue ne fait rien. Le client
    # ne peut pas deviner l'identifiant d'une ligne qu'il n'a jamais lue.
    charge = dict(push_data or ({"job_id": related_id} if related_id else {}))
    if notif is not None:
        charge["notification_id"] = notif.id

    try:
        await send_web_push_to_user(
            user_id=user_id,
            title=title,
            body=body,
            data=charge or None,
        )
    except Exception as exc:
        logger.error(f"Erreur envoi push pour {user_id}: {exc}")

    return notif

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
        # LITIGE TRACÉ (`kojo_job_disputes`) : le désaccord a un état, une
        # échéance et une décision. Les clés du remboursement (`refunding`,
        # `refund_failed`) ne sont pas dupliquées : la décision de rembourser
        # ANNULE la mission, et `mission_cancelled_client_refunding` /
        # `mission_cancelled_client_refund_failed` disent déjà exactement cela.
        "dispute_opened_client": {"title": "⚖️ Litige ouvert", "body": "Le travailleur a ouvert un litige sur « {job_title} ». Le paiement est gelé : le propriétaire doit trancher avant le {date}."},
        "dispute_opened_worker": {"title": "⚖️ Litige ouvert", "body": "Le client a ouvert un litige sur « {job_title} ». Le paiement est gelé : le propriétaire doit trancher avant le {date}."},
        "dispute_withdrawn": {"title": "Litige retiré", "body": "Le litige sur « {job_title} » a été retiré. La mission reprend son cours normal."},
        "dispute_expired": {"title": "Litige sans décision", "body": "La fenêtre d’arbitrage du litige sur « {job_title} » est passée sans décision : le paiement suit à nouveau la règle ordinaire (un silence prolongé favorise le travailleur)."},
        "dispute_paid_client": {"title": "Litige tranché", "body": "Le propriétaire a tranché le litige sur « {job_title} » : le paiement a été versé au travailleur."},
        "dispute_refunded_client": {"title": "Litige tranché en votre faveur", "body": "Le propriétaire a tranché le litige sur « {job_title} » : le remboursement de {amount} FCFA a été lancé vers votre compte mobile money."},
        "dispute_refunded_worker": {"title": "Litige tranché", "body": "Le propriétaire a tranché le litige sur « {job_title} » : la mission est annulée et le client est remboursé."},
        # Alerte d'EXPLOITATION, fr et en seulement, même raison que
        # `owner_email_provider_down` : elle s'adresse au propriétaire et nomme
        # une route (`/owner/litiges`) ; `_get_notif_msgs` sert déjà le repli
        # français pour une langue qui ne la porte pas. Une traduction
        # approximative en wolof/bambara/mooré vaudrait moins que ce repli.
        "dispute_opened_owner": {"title": "⚖️ Litige à trancher", "body": "Mission « {job_title} » : un litige est ouvert, fenêtre d’arbitrage jusqu’au {date}. File d’arbitrage : GET /owner/litiges."},
        # L'autre partie a répondu : c'est le moment où l'arbitre a les DEUX
        # versions, donc où la file d'arbitrage devient actionnable. La position
        # demandée n'est pas interpolée ici (c'est une valeur technique) : elle
        # se lit dans la file, en clair.
        "dispute_answered_owner": {"title": "⚖️ Litige : l’autre partie a répondu", "body": "Mission « {job_title} » : l’autre partie a répondu au litige. Les deux versions sont lisibles dans la file d’arbitrage : GET /owner/litiges."},
        "dispute_expired_owner": {"title": "⚖️ Litige échu sans décision", "body": "Mission « {job_title} » : la fenêtre d’arbitrage est passée sans décision. Le paiement suit à nouveau la règle ordinaire ; la trace reste dans le journal de la mission (GET /owner/missions/{job_id}/evenements)."},
        "bonus_filleul_first_mission": {"title": "🎁 Bonus de parrainage débloqué", "body": "Votre première mission « {job_title} » est terminée : +{amount} FCFA de bonus vous ont été crédités."},
        "bonus_sponsor_first_mission": {"title": "🎁 Votre filleul a terminé sa première mission", "body": "« {job_title} » est terminée : +{amount} FCFA de récompense de parrainage crédités."},
        "new_job_matching": {"title": "🔔 Nouveau job dans votre domaine", "body": "{job_title}"},
        # Résumé d'une VEILLE (`kojo_job_alerts.passage_digest`) : la même
        # décision que l'email — un message par passage, jamais un par mission.
        # Deux clés parce que l'interpolation ne sait pas accorder : le nombre
        # est dans le titre, et « 1 missions » se verrait.
        "job_alert_digest_one": {"title": "🔔 1 nouvelle mission pour votre alerte", "body": "« {job_title} » correspond à votre veille emploi."},
        "job_alert_digest_many": {"title": "🔔 {count} nouvelles missions pour votre alerte", "body": "{count} missions correspondent à votre veille emploi. La plus récente : « {job_title} »."},
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
        # Séquestre à deux temps : le travailleur a déclaré la fin, le client a
        # {date} pour valider avant que le paiement ne parte tout seul.
        "completion_marked_client": {"title": "Travail déclaré terminé 🔧", "body": "Le travailleur a déclaré la mission « {job_title} » terminée. Validez le paiement ; sans réponse, il sera libéré automatiquement le {date}."},
        "completion_auto_released_worker": {"title": "Paiement libéré automatiquement 💰", "body": "Le client n'a pas validé la mission « {job_title} » sous {days} jours : votre paiement a été libéré automatiquement."},
        "completion_auto_released_client": {"title": "Paiement libéré automatiquement", "body": "La mission « {job_title} » n'a pas été validée sous {days} jours : le paiement séquestré a été libéré au travailleur. Un désaccord se traite via le support."},
        "completion_blocked_client": {"title": "Validation impossible ⚠️", "body": "La mission « {job_title} » a été déclarée terminée, mais aucun paiement séquestré n'a été trouvé : le versement doit être traité manuellement. Contactez le support."},
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
        "owner_payout_stuck_alert": {"title": "🚨 Décaissement bloqué", "body": "Paiement {payment_id} : {amount} FCFA toujours en « {status} » depuis plus de {hours} h. Vérification manuelle requise."},
        # Alerte d'EXPLOITATION, et elle n'existe qu'en fr et en : c'est une
        # phrase d'ingénierie pour le propriétaire (elle nomme des variables
        # d'environnement), et `_get_notif_msgs` sert DÉJÀ le repli français
        # quand une langue n'a pas la clé. Une traduction approximative en
        # wolof/bambara/mooré vaudrait moins que ce repli : sur une panne qui
        # empêche l'envoi des codes de connexion, on publie ce qu'on sait dire.
        "owner_email_provider_down": {"title": "🚨 Fournisseur email muet", "body": "Le fournisseur email actif « {provider} » ne peut plus envoyer ({motif}) : {detail}. Aucun email de Kojo ne part (codes de connexion, réinitialisations). Vérifier EMAIL_PROVIDER, les clés et l'expéditeur, puis /monitor/email."},
        # Alerte d'EXPLOITATION, fr et en seulement, même raison que
        # `owner_email_provider_down` : elle nomme une variable d'environnement
        # et l'état d'un service, et `_get_notif_msgs` sert déjà le repli
        # français pour une langue qui ne la porte pas. Une traduction
        # approximative en wolof/bambara/mooré dirait moins que ce repli.
        "owner_rate_limit_repli_memoire": {"title": "🚨 Rate-limit en repli mémoire", "body": "Redis est injoignable : les limites sont comptées PAR PROCESS depuis {replis} bascule(s). Elles restent appliquées, mais multiples par le nombre de workers tant que la panne dure. Vérifier REDIS_URL et l'état du service Redis."},
        # Alerte d'EXPLOITATION, fr et en seulement, même raison que les deux
        # précédentes : elle nomme des routes du propriétaire et un réglage
        # (`LITIGE_SANS_REPONSE_SEUIL`) ; `_get_notif_msgs` sert déjà le repli
        # français. Une décision prise sans lire l'autre partie est un fait
        # d'arbitrage, pas un message à traduire approximativement.
        "owner_litiges_sans_reponse": {"title": "⚖️ Litiges tranchés sans réponse", "body": "{sans_reponse} des {tranches} litiges tranchés des {jours} derniers jours l'ont été SANS réponse de l'autre partie ({part} %, au-delà du seuil de {seuil} %). L'arbitre a tranché sur une seule version. File d'arbitrage : GET /owner/litiges, mesures : GET /owner/litiges/mesures."},
        # Alerte d'EXPLOITATION, fr et en seulement, même raison que les trois
        # précédentes : elle nomme une route et une série Prometheus ;
        # `_get_notif_msgs` sert déjà le repli français. Une place de marché à
        # zéro mission est un fait d'exploitation — pas un message à traduire
        # approximativement en wolof.
        "owner_marche_vide": {"title": "🚨 Place de marché vide", "body": "Aucune mission OUVERTE en base depuis {duree} h (seuil {heures} h). Les travailleurs n'ont rien à postuler, aucune fiche n'est indexable et le revenu est nul. Vérifier la publication (GET /api/jobs?status=open) et la jauge kojo_missions_ouvertes (/metrics)."},
        # Le complément de la précédente : l'offre est LÀ et personne ne postule.
        # Même raison pour le fr/en seulement : la phrase nomme un seuil de jours
        # et une route, et `_get_notif_msgs` sert déjà le repli français.
        "owner_missions_sans_proposition": {"title": "📭 Missions sans aucune proposition", "body": "{count} mission(s) ouverte(s) sur {total} attendent depuis plus de {jours} jour(s) sans AUCUNE proposition — la plus ancienne depuis {plus_ancienne} jour(s). L'offre existe et personne ne postule : vérifier le prix demandé, la ville et la catégorie (un métier sans travailleur inscrit dans cette ville ne recevra jamais de candidature). Liste : GET /api/jobs?status=open."},
        # Relance du CLIENT — traduite dans SA langue comme les autres
        # notifications utilisateur : elle lui parle de SA mission, et le
        # propriétaire n'a pas à la recevoir.
        "client_mission_sans_proposition": {"title": "👀 Votre mission n'a reçu aucune candidature", "body": "« {job_title} » est publiée depuis {heures} h et n'a encore reçu AUCUNE proposition. Trois leviers, dans l'ordre : le prix (comparez à des missions similaires), la date, et le quartier précis. Une mission sans candidature remonte moins dans les listes que les travailleurs consultent."},
    },
    "en": {
        "dispute_opened_client": {"title": "⚖️ Dispute opened", "body": "The worker opened a dispute on « {job_title} ». The payment is frozen: the owner must decide before {date}."},
        "dispute_opened_worker": {"title": "⚖️ Dispute opened", "body": "The client opened a dispute on « {job_title} ». The payment is frozen: the owner must decide before {date}."},
        "dispute_withdrawn": {"title": "Dispute withdrawn", "body": "The dispute on « {job_title} » was withdrawn. The job is back to its normal course."},
        "dispute_expired": {"title": "Dispute closed without a decision", "body": "The arbitration window for the dispute on « {job_title} » passed without a decision: the payment follows the ordinary rule again (prolonged silence favours the worker)."},
        "dispute_paid_client": {"title": "Dispute decided", "body": "The owner decided the dispute on « {job_title} »: the payment was released to the worker."},
        "dispute_refunded_client": {"title": "Dispute decided in your favour", "body": "The owner decided the dispute on « {job_title} »: the refund of {amount} FCFA has been sent to your mobile money account."},
        "dispute_refunded_worker": {"title": "Dispute decided", "body": "The owner decided the dispute on « {job_title} »: the job is cancelled and the client is refunded."},
        "dispute_opened_owner": {"title": "⚖️ Dispute to arbitrate", "body": "Job « {job_title} »: a dispute is open, arbitration window until {date}. Arbitration queue: GET /owner/litiges."},
        "dispute_answered_owner": {"title": "⚖️ Dispute: the other party answered", "body": "Job « {job_title} »: the other party answered the dispute. Both versions are readable in the arbitration queue: GET /owner/litiges."},
        "dispute_expired_owner": {"title": "⚖️ Dispute expired undecided", "body": "Job « {job_title} »: the arbitration window closed without a decision. The payment follows the ordinary rule again; the trace stays in the job journal (GET /owner/missions/{job_id}/evenements)."},
        "bonus_filleul_first_mission": {"title": "🎁 Referral bonus unlocked", "body": "Your first job « {job_title} » is complete: +{amount} FCFA bonus credited to you."},
        "bonus_sponsor_first_mission": {"title": "🎁 Your referral completed their first job", "body": "« {job_title} » is complete: +{amount} FCFA referral reward credited."},
        "new_job_matching": {"title": "🔔 New job in your field", "body": "{job_title}"},
        "job_alert_digest_one": {"title": "🔔 1 new job for your alert", "body": "« {job_title} » matches your job alert."},
        "job_alert_digest_many": {"title": "🔔 {count} new jobs for your alert", "body": "{count} jobs match your job alert. Most recent: « {job_title} »."},
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
        "completion_marked_client": {"title": "Work declared done 🔧", "body": "The worker declared the job « {job_title} » complete. Validate the payment; without a reply it will be released automatically on {date}."},
        "completion_auto_released_worker": {"title": "Payment released automatically 💰", "body": "The client did not validate the job « {job_title} » within {days} days: your payment was released automatically."},
        "completion_auto_released_client": {"title": "Payment released automatically", "body": "The job « {job_title} » was not validated within {days} days: the escrowed payment was released to the worker. Any disagreement goes through support."},
        "completion_blocked_client": {"title": "Validation impossible ⚠️", "body": "The job « {job_title} » was declared complete, but no escrowed payment was found: the payout needs manual handling. Please contact support."},
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
        "owner_payout_stuck_alert": {"title": "🚨 Stuck payout", "body": "Payment {payment_id}: {amount} FCFA still in « {status} » for over {hours} h. Manual check required."},
        "owner_email_provider_down": {"title": "🚨 Email provider silent", "body": "The active email provider « {provider} » can no longer send ({motif}): {detail}. No Kojo email is going out (login codes, resets). Check EMAIL_PROVIDER, its keys and sender, then /monitor/email."},
        "owner_rate_limit_repli_memoire": {"title": "🚨 Rate limiter fell back to memory", "body": "Redis is unreachable: limits are counted PER PROCESS since {replis} failover(s). They still apply, but multiplied by the number of workers while the outage lasts. Check REDIS_URL and the Redis service."},
        "owner_litiges_sans_reponse": {"title": "⚖️ Disputes decided without a reply", "body": "{sans_reponse} of the {tranches} disputes decided in the last {jours} days were decided WITHOUT any reply from the other party ({part} %, above the {seuil} % threshold). The arbitrator decided on a single version. Arbitration queue: GET /owner/litiges, measures: GET /owner/litiges/mesures."},
        "owner_marche_vide": {"title": "🚨 Empty marketplace", "body": "No OPEN job in the database for {duree} h (threshold {heures} h). Workers have nothing to apply to, no page is indexable and revenue is zero. Check publishing (GET /api/jobs?status=open) and the kojo_missions_ouvertes gauge (/metrics)."},
        "owner_missions_sans_proposition": {"title": "📭 Jobs with no proposal at all", "body": "{count} of {total} open job(s) have waited more than {jours} day(s) with NO proposal at all — the oldest for {plus_ancienne} day(s). The offer exists and nobody applies: check the asking price, the city and the category (a trade with no registered worker in that city will never receive a proposal). Listing: GET /api/jobs?status=open."},
        "client_mission_sans_proposition": {"title": "👀 Your job has received no proposal yet", "body": "« {job_title} » has been published for {heures} h with no proposal at all. Three levers, in order: the price (compare with similar jobs), the date, and the exact neighbourhood. A job with no proposal ranks lower in the lists workers browse."},
    },
    "wo": {
        "dispute_opened_client": {"title": "⚖️ Litige ubbeeku na", "body": "Liggéeykat bi ubbeeku na litige ci « {job_title} ». Fey bi ñu ko taxawal : propriétaire bi wara ko tëg ba {date}."},
        "dispute_opened_worker": {"title": "⚖️ Litige ubbeeku na", "body": "Kliyan bi ubbeeku na litige ci « {job_title} ». Fey bi ñu ko taxawal : propriétaire bi wara ko tëg ba {date}."},
        "dispute_withdrawn": {"title": "Litige bi dindi nañu ko", "body": "Litige bi ci « {job_title} » dindi nañu ko. Mission bi dellu na ci yoonam bu biasa."},
        "dispute_expired": {"title": "Litige bi jeex na te tëguñu ko", "body": "Waxtu tëg bi jeex na te kenn tëgul litige bi ci « {job_title} » : fey bi dellu na ci yoon bi biasa (su kenn waxul, liggéeykat bi moo féey)."},
        "dispute_paid_client": {"title": "Litige bi tëg nañu ko", "body": "Propriétaire bi tëg na litige bi ci « {job_title} » : fey bi jëm na ci liggéeykat bi."},
        "dispute_refunded_client": {"title": "Litige bi tëg nañu ko ci sa wàll", "body": "Propriétaire bi tëg na litige bi ci « {job_title} » : dëbbal bu {amount} FCFA tàmbaliw na ci sa konte mobile money."},
        "dispute_refunded_worker": {"title": "Litige bi tëg nañu ko", "body": "Propriétaire bi tëg na litige bi ci « {job_title} » : mission bi dindi nañu ko te kliyan bi ñu ko dëbbal."},
        "bonus_filleul_first_mission": {"title": "🎁 Bonus bu parrainage bi", "body": "Sa njëkk liggéey « {job_title} » mujj na: +{amount} FCFA bonus ñu la jox."},
        "bonus_sponsor_first_mission": {"title": "🎁 Sa filleul mujj na ci sa njëkk liggéey", "body": "« {job_title} » mujj na: +{amount} FCFA récompense ñu la jox."},
        "new_job_matching": {"title": "🔔 Liggéey bu bees ci sa yoon", "body": "{job_title}"},
        "job_alert_digest_one": {"title": "🔔 1 liggéey bu bees ci sa alerta", "body": "« {job_title} » mel na ni li nga seet."},
        "job_alert_digest_many": {"title": "🔔 {count} liggéey yu bees ci sa alerta", "body": "{count} liggéey ñoo mel ni li nga seet. Bi weesu: « {job_title} »."},
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
        "completion_marked_client": {"title": "Liggéey bi jeex na 🔧", "body": "Liggéeykat bi wax na ne liggéey bi « {job_title} » jeex na. Danga wara dëggal fey bi ; su fekkee ne déggaloo, dina génn boppam ci {date}."},
        "completion_auto_released_worker": {"title": "Fey bi génn na boppam 💰", "body": "Kliyan bi déggalul liggéey bi « {job_title} » ci {days} fan : sa fey bi génn na boppam."},
        "completion_auto_released_client": {"title": "Fey bi génn na boppam", "body": "Liggéey bi « {job_title} » déggaluñu ko ci {days} fan : fey bi ñu ko daan ci liggéeykat bi. Soo bëggee waxtaan, jokk ci support bi."},
        "completion_blocked_client": {"title": "Dëggal du mana dox ⚠️", "body": "Liggéey bi « {job_title} » jeex na, waaye fey bu daanee du am : ñu wara ko saytu ak loxo. Jokk ci support bi."},
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
        "owner_payout_stuck_alert": {"title": "🚨 Paay bi moo xëy", "body": "Paay {payment_id}: {amount} FCFA moo ngi ci « {status} » ci lu gën {hours} waxtu. Xamal ci loxo."},
    },
    "bm": {
        "dispute_opened_client": {"title": "⚖️ Farati dɔnna", "body": "Baarakɛla ye farati dɔn « {job_title} » kan. Sara bɛ dan : owner ka a fɔ ba {date}."},
        "dispute_opened_worker": {"title": "⚖️ Farati dɔnna", "body": "Client ye farati dɔn « {job_title} » kan. Sara bɛ dan : owner ka a fɔ ba {date}."},
        "dispute_withdrawn": {"title": "Farati bɔra", "body": "Farati min tun bɛ « {job_title} » kan, a bɔra. Baara bɛ taa a ka ɲɔgɔn kɔ."},
        "dispute_expired": {"title": "Farati banna kojugu", "body": "Waati banna farati « {job_title} » kan, nga mɔgɔ ma a fɔ : sara bɛ taa a ka ɲɔgɔn kɔ (ni mɔgɔ ma kuma, baarakɛla bɛ sara)."},
        "dispute_paid_client": {"title": "Farati fɔra", "body": "Owner ye farati « {job_title} » kan fɔ : sara taa ra baarakɛla ma."},
        "dispute_refunded_client": {"title": "Farati fɔra i ye", "body": "Owner ye farati « {job_title} » kan fɔ : sɛgɛnli {amount} FCFA bɛ taa i ka mobile money konti la."},
        "dispute_refunded_worker": {"title": "Farati fɔra", "body": "Owner ye farati « {job_title} » kan fɔ : baara banna ka client sɛgɛn."},
        "bonus_filleul_first_mission": {"title": "🎁 Bonus parrainage bɔlen", "body": "I ka baara fɔlɔ « {job_title} » dafara: +{amount} FCFA bonus bɛ i ka konti la."},
        "bonus_sponsor_first_mission": {"title": "🎁 I ka filleul dafara a ka baara fɔlɔ", "body": "« {job_title} » dafara: +{amount} FCFA récompense bɛ i ka konti la."},
        "new_job_matching": {"title": "🔔 Baara kura i ka yɔrɔ la", "body": "{job_title}"},
        "job_alert_digest_one": {"title": "🔔 Baara kura 1 i ka kumaseli kɔnɔ", "body": "« {job_title} » bɛ i ka ɲini kɔnɔ."},
        "job_alert_digest_many": {"title": "🔔 Baara kura {count} i ka kumaseli kɔnɔ", "body": "{count} baara bɛ i ka ɲini kɔnɔ. Laban: « {job_title} »."},
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
        "completion_marked_client": {"title": "Baara dafara kojugu 🔧", "body": "Baarakɛla ye a fɔ baara « {job_title} » dafara. I ka sara danbe ; ni i ma a danbe, a bɛna bɔ a yɛrɛ ma {date}."},
        "completion_auto_released_worker": {"title": "Sara bɔra a yɛrɛ ma 💰", "body": "Kliyan ma baara « {job_title} » danbe tile {days} kɔnɔ : i ka sara bɔra a yɛrɛ ma."},
        "completion_auto_released_client": {"title": "Sara bɔra a yɛrɛ ma", "body": "Baara « {job_title} » ma danbe tile {days} kɔnɔ : sara min tun bɛ dan na, a bɔra baarakɛla ma. Ni farati bɛ, i ka taa support la."},
        "completion_blocked_client": {"title": "Danbe tɛ se ka kɛ ⚠️", "body": "Baara « {job_title} » dafara, nka sara min tun bɛ dan na ma sɔrɔ : a ka kan ka baara ni bolo. I ka taa support la."},
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
        "owner_payout_stuck_alert": {"title": "🚨 Wari bɛ sɛgɛn", "body": "Wari {payment_id}: {amount} FCFA bɛ « {status} » kɔnɔ kabini {hours} wati. Lajɛ ni lɔgɔkɛla bolo ye."},
    },
    "mos": {
        "dispute_opened_client": {"title": "⚖️ Yẽesg pukame", "body": "Tʋʋmdã n kõo yẽesg « {job_title} » zugu. Ligdã kɩtame : ownerã n na n gese n tɩ {date}."},
        "dispute_opened_worker": {"title": "⚖️ Yẽesg pukame", "body": "Clientã n kõo yẽesg « {job_title} » zugu. Ligdã kɩtame : ownerã n na n gese n tɩ {date}."},
        "dispute_withdrawn": {"title": "Yẽesgã yiime", "body": "Yẽesg sẽn da be « {job_title} » zugu yiime. Tʋʋmã leba a sorã zugu."},
        "dispute_expired": {"title": "Yẽesgã sɑɑme ne gese", "body": "Wakatã sɑɑme la b ka yẽesg « {job_title} » zugu gese : ligdã leba sẽn zemsã zugu (sã n ned ka gom, tʋʋmdã n na n paam a ligdi)."},
        "dispute_paid_client": {"title": "B gesa yẽesgã", "body": "Ownerã gesa yẽesgã « {job_title} » zugu : ligdã kẽnga tʋʋmdã nengẽ."},
        "dispute_refunded_client": {"title": "B gesa yẽesgã f yĩnga", "body": "Ownerã gesa yẽesgã « {job_title} » zugu : b sɩnga f lebsg {amount} FCFA f mobile money kont pʋgẽ."},
        "dispute_refunded_worker": {"title": "B gesa yẽesgã", "body": "Ownerã gesa yẽesgã « {job_title} » zugu : tʋʋmã yãagame la b lebsa clientã ligdi."},
        "bonus_filleul_first_mission": {"title": "🎁 Parrainage bonus", "body": "F tʋʋm rẽgenga « {job_title} » sɑɑme: +{amount} FCFA bonus b tʋm ne fo."},
        "bonus_sponsor_first_mission": {"title": "🎁 F filleul sɑɑm a rẽgeng tʋʋm", "body": "« {job_title} » sɑɑme: +{amount} FCFA sɩd n kõo fo."},
        "new_job_matching": {"title": "🔔 Tʋʋm paalle f yĩngre", "body": "{job_title}"},
        "job_alert_digest_one": {"title": "🔔 Tʋʋm paal 1 yãmb kibare pʋgẽ", "body": "« {job_title} » zemsa ne yãmb sẽn baoodã."},
        "job_alert_digest_many": {"title": "🔔 Tʋʋm paall {count} yãmb kibare pʋgẽ", "body": "{count} tʋʋm zemsa ne yãmb sẽn baoodã. A menga: « {job_title} »."},
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
        "completion_marked_client": {"title": "Tʋʋmã sɑɑme 🔧", "body": "Tʋʋmdã wilgame tɩ tʋʋmã « {job_title} » sɑɑme. Yãk-yãka ligdã ; sã n yãkã, a na n yitame a meng nengẽ {date}."},
        "completion_auto_released_worker": {"title": "Ligdã yitame a meng nengẽ 💰", "body": "Clientã ka tʋʋmã « {job_title} » yãk ne {days} raare: f ligdã yitame a meng nengẽ."},
        "completion_auto_released_client": {"title": "Ligdã yitame a meng nengẽ", "body": "Tʋʋmã « {job_title} » ka yãk ne {days} raare: ligdã sẽn da be yĩngrã yitame n kẽng tʋʋmdã nengẽ. Sã n yẽesg be, kẽng support nengẽ."},
        "completion_blocked_client": {"title": "Yãk-yãka tõeeme ⚠️", "body": "Tʋʋmã « {job_title} » sɑɑme, la b ka ligd sẽn da be yĩngrã yãe: b seg n maan a zãrã ne nugsã. Kẽng support nengẽ."},
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
        "owner_payout_stuck_alert": {"title": "🚨 Ligdi sẽn be sᴐ", "body": "Ligdi {payment_id}: {amount} FCFA sẽn be « {status} » sẽn yɩɩd {hours} sᴐɑɑr. Gese ne nusẽ."},
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


# ---------------------------------------------------------------------------
# Nom affiché d'un compte — et comment il cesse de survivre chez l'AUTRE PARTIE
# ---------------------------------------------------------------------------
# `proposal_received` (reçue par le client) et `proposal_accepted` (reçue par le
# travailleur) citent le nom de l'autre partie : le nom est CONSTRUIT à
# l'écriture puis recopié dans le document du destinataire. Une seule
# construction sert donc aux deux écritures ET à l'effacement à la suppression
# du compte — deux constructions divergentes feraient survivre un nom que la
# cascade ne saurait plus retrouver.
NOM_COMPTE_SUPPRIME = "Un compte supprimé"


def nom_affiche(compte: Any) -> str:
    """Nom affiché d'un compte (« Awa Diop »), ou chaîne vide s'il n'en a pas.

    Accepte le document Mongo (dict) comme l'objet du modèle : les deux formes
    circulent dans le dépôt, et l'effacement doit chercher EXACTEMENT ce que
    l'écriture a interpolé.
    """

    def champ(nom: str):
        if isinstance(compte, dict):
            return compte.get(nom)
        return getattr(compte, nom, None)

    morceaux = [str(champ("first_name") or "").strip(), str(champ("last_name") or "").strip()]
    return " ".join(morceau for morceau in morceaux if morceau)


async def retirer_nom_des_notifications_tiers(user_id: str, nom: str) -> int:
    """Retire le nom d'un compte supprimé des notifications des AUTRES.

    Les gabarits de proposition interpolent le nom à l'ÉCRITURE : la copie vit
    donc dans la boîte de l'autre partie, que `delete_many({"user_id": …})` ne
    touche pas. La recherche porte sur le NOM lui-même, pas sur une liste de
    types de notification recopiée : un gabarit qui se mettrait à citer un nom
    demain reste couvert sans qu'on y pense.

    Renvoie le nombre de notifications réécrites (mesuré, jamais supposé).
    """
    nom = (nom or "").strip()
    if not nom:
        return 0
    motif = re.escape(nom)
    filtre = {
        "user_id": {"$ne": user_id},
        "$or": [
            {"title": {"$regex": motif}},
            {"body": {"$regex": motif}},
        ],
    }
    reecrites = 0
    for notification in await db.notifications.find(filtre).to_list(length=None):
        champs = {}
        for champ in ("title", "body"):
            valeur = notification.get(champ)
            if isinstance(valeur, str) and nom in valeur:
                champs[champ] = valeur.replace(nom, NOM_COMPTE_SUPPRIME)
        if champs:
            await db.notifications.update_one(
                {"id": notification["id"]}, {"$set": champs}
            )
            reecrites += 1
    return reecrites


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
    return await notify_user(
        user_id=user_id,
        title=title,
        body=body,
        notif_type=notif_type,
        related_id=related_id,
        related_type=related_type,
        push_data=push_data,
    )


async def apply_referral_payout_confirmed(payment_record: dict) -> None:
    """Applique l'issue d'un retrait de récompenses de parrainage
    (payout_kind == "referral") :
    - "released" : décrémente le solde du travailleur, trace le retrait dans
      son historique, notifie le succès ET lève le verrou anti double-retrait.
    - "release_failed" : PayDunya n'a RIEN exécuté (le solde est intact) → on
      lève juste le verrou pour que le travailleur puisse réessayer, et on
      notifie l'échec. SANS ça, un retrait dont l'échec n'est tranché qu'à
      l'IPN ou au check-status laissait le verrou posé à vie (le succès
      synchrone le lève déjà, mais pas le chemin asynchrone en échec).

    Idempotente (flags referral_balance_applied / referral_lock_released posés
    sur l'enregistrement de paiement) — appelée que le décaissement passe
    "released" de façon synchrone (submit-invoice "success") ou asynchrone
    (IPN disburse ou check-status). Point unique de vérité du solde."""
    payment = await db.payments.find_one({"id": payment_record.get("id")})
    if not payment:
        return
    if payment.get("payout_kind") != "referral":
        return
    payout_status = payment.get("payout_status")

    # --- Succès : décrément du solde + trace + notif (idempotent) ---
    if payout_status == "released":
        # Verrou CAS atomique sur le claim : trois chemins peuvent confirmer
        # le MÉME retrait (submit sync, IPN disburse, recheck status) et se
        # chevaucher en pleine exécution. Sans verrou, deux confirmations
        # quasi simultanées pouvaient lire referral_balance_applied absent
        # toutes les deux, puis DUPLIQUER la trace d'historique (double
        # $push) et la notification de succès. Le update_one conditionnel est
        # atomique : un seul appelant gagne, les autres reçoivent
        # matched_count=0 et s'arrêtent.
        claim = await db.payments.update_one(
            {"id": payment["id"], "referral_balance_applied": {"$ne": True}},
            {"$set": {"referral_balance_applied": True}},
        )
        if claim.matched_count == 0:
            return

        user_id = payment.get("payer_id")
        amount = int(payment.get("amount", 0) or 0)
        if not user_id or amount <= 0:
            return

        # Débit ATOMIQUE ($inc conditionnel) : évite le "lost update" si un
        # crédit de récompense arrive en même temps (le read-modify-write
        # explicite pouvait écraser le gain), et ne débite jamais plus que le
        # solde. Le cas "solde < montant" est anormal (le verrou
        # anti-double-retrait garantit qu'aucun autre retrait n'a pu réduire
        # le solde entre la demande et la confirmation) : on logge et on
        # laisse le flag posé pour ne jamais re-tenter un double débit.
        result = await db.users.update_one(
            {"id": user_id, "referral_reward_balance": {"$gte": amount}},
            {
                "$inc": {"referral_reward_balance": -amount},
                "$set": {
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
        if result.matched_count == 0:
            logger.error(
                f"⚠️ Retrait parrainage payé mais solde insuffisant (user={user_id}, "
                f"payment={payment.get('id')}, amount={amount}) — vérification manuelle requise"
            )
            return
        asyncio.create_task(notify_user_localized(
            user_id=user_id,
            key="referral_withdraw_success",
            notif_type=NotificationType.GENERAL,
            amount=amount,
        ))
        return

    # --- Échec : solde intact, on lève juste le verrou (idempotent) ---
    if payout_status == "release_failed":
        # Même verrou CAS atomique : deux chemins (submit sync / IPN / recheck)
        # peuvent confirmer l'échec en parallèle ; un seul doit lever le
        # verrou et notifier.
        claim = await db.payments.update_one(
            {"id": payment["id"], "referral_lock_released": {"$ne": True}},
            {"$set": {"referral_lock_released": True}},
        )
        if claim.matched_count == 0:
            return
        user_id = payment.get("payer_id")
        if not user_id:
            return
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "referral_withdrawal_in_progress": False,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        amount = int(payment.get("amount", 0) or 0)
        asyncio.create_task(notify_user_localized(
            user_id=user_id,
            key="referral_withdraw_failed",
            notif_type=NotificationType.GENERAL,
            amount=amount,
        ))
        return

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
