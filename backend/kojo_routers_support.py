from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from kojo_core import db
from kojo_models import (
    SupportTicket, SupportTicketCreate, SupportTicketStatusUpdate,
)
from kojo_core import (
    verify_owner_access,
)

router = APIRouter()

@router.post("/support/tickets")
async def create_support_ticket(ticket_data: SupportTicketCreate):
    ticket = SupportTicket(
        full_name=ticket_data.full_name.strip(),
        phone=ticket_data.phone.strip(),
        email=ticket_data.email,
        reason=ticket_data.reason.strip(),
        message=ticket_data.message.strip(),
        channel=ticket_data.channel,
    )
    await db.support_tickets.insert_one(ticket.model_dump())
    return {
        "message": "Merci, votre demande a bien été envoyée. Notre équipe vous répondra dans les meilleurs délais.",
        "ticket_id": ticket.id,
    }

@router.get("/support/tickets")
async def list_support_tickets(
    status_filter: Optional[str] = None,
    owner_user = Depends(verify_owner_access)
):
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
