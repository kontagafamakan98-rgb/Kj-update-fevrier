from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from kojo_core import db
from kojo_email import send_email_via_brevo_api
from kojo_models import (
    NotificationType, SupportTicket, SupportTicketCreate, SupportTicketStatusUpdate,
)
from kojo_core import (
    resolve_owner_id,
    verify_owner_access,
)
from kojo_settings import OWNER_EMAIL, OWNER_USER_ID, logger
from kojo_shared import notify_user_localized

router = APIRouter()


class SupportTicketStatusLookup(BaseModel):
    """Interrogation publique du statut d'un ticket par SON CRÉATEUR :
    ticket_id (secret de session renvoyé à la création) + email saisi.
    L'email ne peut pas être deviné par énumération (combiné à un uuid),
    donc voir le statut d'un ticket ne permet pas de voir ceux des autres."""
    ticket_id: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)


@router.post("/support/tickets/status")
async def get_support_ticket_status(payload: SupportTicketStatusLookup):
    """Permet à l'expéditeur d'un ticket de suivre son statut (l'endpoint
    GET /support/tickets est réservé au propriétaire). Ne renvoie que le
    statut et les métadonnées — pas la conversation complète.

    Returns:
        dict: {ticket_id, status, reason, created_at, updated_at, message}.
    """
    ticket = await db.support_tickets.find_one({"id": payload.ticket_id})
    if not ticket or str(ticket.get("email") or "").strip().lower() != payload.email.strip().lower():
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    return {
        "ticket_id": ticket.get("id"),
        "status": ticket.get("status"),
        "reason": ticket.get("reason"),
        "created_at": ticket.get("created_at"),
        "updated_at": ticket.get("updated_at"),
        "message": "Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.",
    }


@router.post("/support/tickets")
async def create_support_ticket(ticket_data: SupportTicketCreate):
    """Crée un ticket de support (canal public) et notifie le propriétaire
    (in-app + email Brevo, best-effort).

    Returns:
        dict: {message, ticket_id}.
    """
    ticket = SupportTicket(
        full_name=ticket_data.full_name.strip(),
        phone=ticket_data.phone.strip(),
        email=ticket_data.email,
        reason=ticket_data.reason.strip(),
        message=ticket_data.message.strip(),
        channel=ticket_data.channel,
    )
    await db.support_tickets.insert_one(ticket.model_dump())

    # Notifier le propriétaire (in-app + email, best-effort) : sans ça,
    # aucun canal ne signalait l'arrivée d'un ticket (l'équipe devait poller).
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
                    ticket_text=f"{ticket_data.full_name} — {ticket_data.reason} : {ticket_data.message[:120]}",
                )
        except Exception as exc:
            logger.warning(f"⚠️ Notification owner ticket échouée: {exc}")
    if OWNER_EMAIL:
        try:
            send_email_via_brevo_api(
                OWNER_EMAIL,
                f"KOJO — Nouveau ticket support ({ticket_data.reason})",
                f"De: {ticket_data.full_name}\nEmail: {ticket_data.email}\n"
                f"Téléphone: {ticket_data.phone}\n\n{ticket_data.message}",
            )
        except Exception as exc:
            logger.warning(f"⚠️ Email owner ticket échoué: {exc}")

    return {
        "message": "Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.",
        "ticket_id": ticket.id,
    }

@router.get("/support/tickets")
async def list_support_tickets(
    status_filter: Optional[str] = None,
    owner_user = Depends(verify_owner_access)
):
    """Liste les tickets de support (accès owner), filtrables par statut.

    Returns:
        list[dict]: tickets sérialisés (SupportTicket.model_dump).
    """
    query = {}
    if status_filter:
        query["status"] = status_filter
    tickets = await db.support_tickets.find(query).sort("created_at", -1).to_list(500)
    return [SupportTicket(**t).model_dump() for t in tickets]

@router.patch("/support/tickets/{ticket_id}/status")
async def update_support_ticket_status(
    ticket_id: str,
    status_update: SupportTicketStatusUpdate,
    owner_user = Depends(verify_owner_access)
):
    """Change le statut d'un ticket (accès owner).

    Returns:
        dict: ticket mis à jour (SupportTicket.model_dump).
    """
    result = await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$set": {
            "status": status_update.status.value,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande de support introuvable")
    updated = await db.support_tickets.find_one({"id": ticket_id})
    return SupportTicket(**updated).model_dump()
