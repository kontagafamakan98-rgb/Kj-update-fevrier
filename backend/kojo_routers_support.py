import asyncio
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from kojo_ai_budget import MOTIF_COMPTEUR, caracteres_de_prompt, reserver
from kojo_ai_gateway import AiGatewayError, chat_completion, is_configured
from kojo_core import db
from kojo_email import send_email_via_active_provider
from kojo_models import (
    Language, NotificationType, RobotChatRequest, SupportTicket, SupportTicketCreate,
    SupportTicketStatusUpdate,
)
from kojo_core import (
    resolve_owner_id,
    verify_owner_access,
)
from kojo_settings import AI_GATEWAY_MODEL, OWNER_EMAIL, OWNER_USER_ID, logger
from kojo_shared import notify_user_localized
from kojo_identifiants import dump_stable, identifiant_query

router = APIRouter()


# ── Assistant IA de /support ─────────────────────────────────────────────────
# Marqueur que le modèle ajoute quand il estime qu'une demande doit être
# déposée. Il voyage DANS le texte (donc un modèle qui « oublie » l'outil ne
# casse rien) et le serveur le RETIRE avant de répondre : le navigateur ne voit
# jamais la mécanique, seulement `ticket_suggested`. Même principe que le
# marqueur `[KOJO_JOB:…]` des messages, retiré côté frontend.
TICKET_MARKER = "[KOJO_TICKET]"

LANGUAGE_NAMES = {
    Language.FRENCH: "français",
    Language.ENGLISH: "anglais",
    Language.WOLOF: "wolof",
    Language.BAMBARA: "bambara",
    Language.MOORE: "mooré",
}


def robot_system_prompt(language: Language) -> str:
    """Instructions de l'assistant de /support, dans la langue du visiteur.

    Écrit côté SERVEUR (jamais reçu du client) : c'est la politique de
    l'assistant — périmètre, ton, et l'interdiction d'inventer une donnée de
    compte — donc ce qu'un visiteur ne doit pas pouvoir réécrire.
    """
    langue = LANGUAGE_NAMES.get(language, "français")
    return (
        "Tu es l'assistant support de Kojo, une plateforme ouest-africaine qui met en "
        "relation des clients et des travailleurs (Sénégal, Mali, Côte d'Ivoire, "
        "Burkina Faso). Tu réponds dans cette langue : " + langue + ".\n"
        "Règles :\n"
        "- Réponses courtes et concrètes (120 mots maximum), sans jargon.\n"
        "- Les paiements passent par Orange Money, Wave ou carte bancaire ; Kojo "
        "prélève une commission sur chaque mission. Ne donne JAMAIS de montant pour "
        "un cas précis : tu n'as accès à aucun compte.\n"
        "- Tu n'as accès à AUCUNE donnée de compte : ni solde, ni paiement, ni "
        "mission, ni identité. Ne prétends jamais le contraire et n'invente rien.\n"
        "- Tu ne promets ni remboursement, ni déblocage, ni délai : ce sont des "
        "décisions humaines.\n"
        "- Si la demande dépend d'un compte ou d'un paiement précis, ou si tu ne "
        "sais pas, propose de déposer une demande de support et termine ta réponse "
        "par " + TICKET_MARKER + " (seul, à la fin).\n"
        "- Hors sujet (insultes, sujets sans rapport avec Kojo) : refuse poliment "
        "et ramène la conversation au support Kojo."
    )


class SupportTicketStatusLookup(BaseModel):
    """Interrogation publique du statut d'un ticket par SON CRÉATEUR :
    ticket_id (secret de session renvoyé à la création) + email saisi.
    L'email ne peut pas être deviné par énumération (combiné à un uuid),
    donc voir le statut d'un ticket ne permet pas de voir ceux des autres."""
    ticket_id: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)


@router.post("/support/robot/chat")
async def robot_chat(payload: RobotChatRequest):
    """Répond à une question posée à l'assistant de /support (assistant IA).

    Le prompt système, le modèle et le jeton vivent côté serveur : le client
    n'envoie que l'historique de la conversation, et ne peut donc pas réécrire
    la politique de l'assistant (le rôle `system` est refusé par le modèle
    `RobotChatMessage`).

    Le plafond de DÉPENSE est vérifié AVANT l'appel (`kojo_ai_budget`) : la
    limite par IP borne le débit, pas la facture. Un plafond atteint répond 429
    avec `Retry-After` (prochain jour UTC), un compteur injoignable 503 — dans
    les deux cas le message nomme le formulaire, qui reste le seul chemin
    garanti.

    Returns:
        dict: {reply, ticket_suggested, model} — `reply` est le texte du modèle,
            `ticket_suggested` dit si l'assistant recommande de déposer une
            demande de support (marqueur retiré du texte), `model` nomme le
            modèle qui a répondu (les journaux et le diagnostic en ont besoin,
            jamais le jeton ni l'hôte).
    """
    if not is_configured():
        # Pas de jeton/hôte : l'assistant est DÉSACTIVÉ, et le dire (503) laisse
        # /support retomber sur le questionnaire au lieu d'afficher une panne.
        raise HTTPException(
            status_code=503,
            detail="Assistant momentanément indisponible. Utilisez le formulaire de demande.",
        )

    messages = [{"role": "system", "content": robot_system_prompt(payload.language)}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    # Le budget se juge sur le prompt RÉEL (instructions du serveur comprises),
    # et la réservation est prise AVANT l'appel : compter après coup laisserait
    # passer la dépense qu'on veut borner.
    budget = await reserver(caracteres_de_prompt(messages))
    if not budget.autorisee:
        if budget.motif == MOTIF_COMPTEUR:
            # Panne du compteur : on ne peut pas affirmer que l'appel est
            # budgété, et une fonctionnalité facultative ne dépense pas à
            # l'aveugle. Le formulaire reste à l'écran.
            raise HTTPException(
                status_code=503,
                detail="Assistant momentanément indisponible. Utilisez le formulaire de demande.",
            )
        # `bucket` est le champ que le rate-limiter publie déjà sur SES 429 :
        # le client distingue donc un plafond de dépense (journée entière) d'une
        # limite de débit (20 / 5 min, qui se relâche seule) sans lire un texte
        # traduit ni deviner. Confondre les deux fermerait la saisie pour la
        # journée alors que la limite de débit sera passée dans cinq minutes.
        return JSONResponse(
            status_code=429,
            content={
                "detail": (
                    "L'assistant a atteint son plafond de dépense pour aujourd'hui. "
                    "Déposez une demande de support : une personne vous répondra."
                ),
                "bucket": "ai-budget",
            },
            headers={"Retry-After": str(budget.retry_after)},
        )

    try:
        # SYNCHRONE (requests) : hors de l'event loop, sinon un gateway lent
        # bloquerait toutes les autres requêtes du worker.
        texte = await asyncio.to_thread(chat_completion, messages)
    except AiGatewayError as exc:
        logger.warning(f"⚠️ Assistant support : {exc}")
        raise HTTPException(
            status_code=502,
            detail="L'assistant n'a pas pu répondre. Réessayez ou déposez une demande.",
        )

    ticket_suggested = TICKET_MARKER in texte
    return {
        "reply": texte.replace(TICKET_MARKER, "").strip(),
        "ticket_suggested": ticket_suggested,
        "model": AI_GATEWAY_MODEL,
    }


@router.post("/support/tickets/status")
async def get_support_ticket_status(payload: SupportTicketStatusLookup):
    """Permet à l'expéditeur d'un ticket de suivre son statut (l'endpoint
    GET /support/tickets est réservé au propriétaire). Ne renvoie que le
    statut et les métadonnées — pas la conversation complète.

    Returns:
        dict: {ticket_id, status, reason, created_at, updated_at, message}.
    """
    ticket = await db.support_tickets.find_one({**identifiant_query(payload.ticket_id)})
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
            await send_email_via_active_provider(
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
    return [dump_stable(SupportTicket, t) for t in tickets]

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
        {**identifiant_query(ticket_id)},
        {"$set": {
            "status": status_update.status.value,
            "updated_at": datetime.now(timezone.utc)
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande de support introuvable")
    updated = await db.support_tickets.find_one({**identifiant_query(ticket_id)})
    return dump_stable(SupportTicket, updated)
