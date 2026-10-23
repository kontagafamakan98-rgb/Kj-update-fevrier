# -*- coding: utf-8 -*-
"""Ouverture d'un ticket support — propriétaire UNIQUE de la création.

Trois chemins ouvrent un ticket : le formulaire de `/support` (canal `robot` ou
`direct`) et l'escalade WhatsApp (`kojo_whatsapp`, canal `whatsapp`). La création
écrit le document ET prévient le propriétaire (notification in-app + email,
best-effort) ; l'écrire deux fois ferait qu'un canal oublierait l'alerte — et un
ticket que personne ne lit n'est pas un ticket, c'est une ligne en base.

L'email est FACULTATIF (`SupportTicket.email` est `Optional`) parce qu'un
contact WhatsApp n'en donne pas : son identité, c'est son numéro. Le formulaire
web, lui, continue de l'EXIGER — la contrainte vit dans `SupportTicketCreate`,
le modèle de la route publique, pas ici.

Rien de tout ceci n'est critique pour la réponse au client : une notification
qui échoue est JOURNALISÉE et n'empêche pas le ticket d'exister, sinon l'échec
d'un canal interne rendrait le support muet.
"""
from typing import Optional

from kojo_core import db, resolve_owner_id
from kojo_email import send_email_via_active_provider
from kojo_models import NotificationType, SupportTicket
from kojo_settings import OWNER_EMAIL, OWNER_USER_ID, logger
from kojo_shared import notify_user_localized


async def ouvrir_ticket(
    *,
    full_name: str,
    phone: str,
    reason: str,
    message: str,
    channel: str = "robot",
    email: Optional[str] = None,
    user_id: Optional[str] = None,
) -> SupportTicket:
    """Crée un ticket de support et prévient le propriétaire.

    Args:
        full_name: nom donné par le demandeur (ou son profil WhatsApp).
        phone: numéro joignable, tel que fourni (jamais normalisé ici : c'est la
            trace, pas une clé de recherche).
        reason: motif court, affiché en tête du ticket.
        message: la demande, telle que la personne l'a écrite.
        channel: `robot`, `direct` ou `whatsapp` — ce que l'écran d'admin
            affiche pour dire d'où vient la demande.
        email: adresse si le canal en porte une (formulaire web).
        user_id: compte Kojo reconnu, quand il y en a un (le contact WhatsApp
            peut être un utilisateur, résolu par son numéro).

    Returns:
        SupportTicket: le document écrit, `id` compris.
    """
    ticket = SupportTicket(
        full_name=full_name.strip(),
        phone=phone.strip(),
        email=email,
        reason=reason.strip(),
        message=message.strip(),
        channel=channel,
        user_id=user_id,
    )
    await db.support_tickets.insert_one(ticket.model_dump())

    # Notifier le propriétaire (in-app + email, best-effort) : sans ça, aucun
    # canal ne signalait l'arrivée d'un ticket (l'équipe devait poller).
    if OWNER_EMAIL or OWNER_USER_ID:
        try:
            # Résolution du compte owner RÉEL par email (source de vérité) : en
            # prod, l'id du compte ne correspond pas au secret OWNER_USER_ID —
            # cibler le secret envoyait la notification à un id fantôme (perdue).
            owner_id = await resolve_owner_id() or OWNER_USER_ID
            if owner_id:
                await notify_user_localized(
                    user_id=owner_id,
                    key="new_ticket_support",
                    notif_type=NotificationType.GENERAL,
                    ticket_text=f"{ticket.full_name} — {ticket.reason} : {ticket.message[:120]}",
                )
        except Exception as exc:
            logger.warning(f"⚠️ Notification owner ticket échouée: {exc}")

    if OWNER_EMAIL:
        try:
            await send_email_via_active_provider(
                OWNER_EMAIL,
                f"KOJO — Nouveau ticket support ({ticket.reason})",
                f"De: {ticket.full_name}\nCanal: {ticket.channel}\n"
                f"Email: {ticket.email or '(aucun)'}\n"
                f"Téléphone: {ticket.phone}\n\n{ticket.message}",
            )
        except Exception as exc:
            logger.warning(f"⚠️ Email owner ticket échoué: {exc}")

    return ticket
