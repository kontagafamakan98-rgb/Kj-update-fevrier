import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from kojo_ai_budget import MOTIF_COMPTEUR, caracteres_de_prompt, reserver
from kojo_ai_gateway import AiGatewayError, chat_completion, is_configured
from kojo_core import db
from kojo_models import (
    RobotChatRequest, SupportTicket, SupportTicketCreate, SupportTicketStatusUpdate,
)
from kojo_core import (
    verify_owner_access,
)
from kojo_settings import AI_GATEWAY_MODEL, logger
from kojo_identifiants import dump_stable, identifiant_query
# La politique de l'assistant vit dans UN module (`kojo_support_assistant`) :
# WhatsApp parle au même assistant, et deux copies des règles divergeraient au
# premier correctif.
from kojo_support_assistant import TICKET_MARKER, robot_system_prompt
# L'ouverture d'un ticket a un propriétaire unique : le formulaire web et
# l'escalade WhatsApp passent par lui (création + alerte propriétaire).
from kojo_support_tickets import ouvrir_ticket
from kojo_whatsapp import (
    KapsoError,
    WebhookRefuse,
    evenement_de,
    traiter_evenement,
    verifier_signature,
)

router = APIRouter()

# Le webhook WhatsApp : public, non authentifié (comme les IPN PayDunya et le
# webhook email). Sa seule preuve d'identité est la signature de la requête.
CHEMIN_WHATSAPP = "/support/whatsapp/webhook"


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

    La création et l'alerte vivent dans `kojo_support_tickets.ouvrir_ticket` :
    l'escalade WhatsApp ouvre un ticket par le même chemin, donc l'alerte ne
    peut pas exister d'un côté et manquer de l'autre.

    Returns:
        dict: {message, ticket_id}.
    """
    ticket = await ouvrir_ticket(
        full_name=ticket_data.full_name,
        phone=ticket_data.phone,
        email=ticket_data.email,
        reason=ticket_data.reason,
        message=ticket_data.message,
        channel=ticket_data.channel,
    )

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


# ── Support WhatsApp (Kapso) ────────────────────────────────────────────────
# Pourquoi public et non authentifié : c'est un WEBHOOK, comme les IPN
# PayDunya et le webhook email. Il ne peut donc pas porter de session, et sa
# seule preuve d'identité est la signature calculée sur le corps reçu.
#
# Les trois refus, nommés : secret absent → 503 (ingestion DÉSACTIVÉE, jamais
# permissive), signature absente ou invalide → 401, charge utile illisible →
# 400. Un événement non suivi est acquitté (200) en le nommant : refuser ce
# qu'on ignore ferait re-livrer indéfiniment un fait qui ne nous concerne pas.
#
# Un envoi qui échoue répond 502 : le fournisseur re-livre, la conversation est
# reprise, et le client finit par recevoir sa réponse. Un 200 sur un envoi raté
# serait un acquittement mensonger — le message serait perdu en silence.
def _refus_whatsapp(refus: WebhookRefuse) -> HTTPException:
    """Un refus d'ingestion, publié avec son MOTIF (jamais un code seul)."""
    logger.warning("⚠️ Webhook WhatsApp refusé : %s", refus.motif)
    return HTTPException(
        status_code=refus.statut,
        detail={"status": "refuse", "motif": refus.motif},
    )


@router.post(CHEMIN_WHATSAPP)
async def whatsapp_webhook(request: Request) -> Dict[str, Any]:
    """Reçoit les messages WhatsApp relayés par Kapso et y répond.

    L'assistant répond dans la langue du client (même politique et même budget
    que `/support/robot/chat`) ; quand un humain doit reprendre, un ticket est
    ouvert par `kojo_support_tickets` et le propriétaire est prévenu.

    Les octets BRUTS sont lus avant tout parsing : la signature porte sur ce qui
    a été reçu, donc re-sérialiser le JSON la ferait échouer sur une requête
    légitime.

    Returns:
        dict: {status, statut, escalade, motif, ticket_id, envoi} — le bilan du
        message, sans son texte (la réponse du webhook peut être journalisée
        côté fournisseur).

    Raises:
        HTTPException: 503 (secret absent), 401 (signature), 400 (charge utile),
            502 (réponse qui n'a pas pu partir).
    """
    corps = await request.body()

    try:
        verifier_signature(corps, request.headers)
    except WebhookRefuse as refus:
        raise _refus_whatsapp(refus)

    try:
        payload = json.loads(corps.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"status": "refuse", "motif": "corps illisible (JSON attendu) : %s" % exc},
        )

    evenement = evenement_de(payload, request.headers)
    try:
        return await traiter_evenement(payload, evenement, entetes=request.headers)
    except WebhookRefuse as refus:
        raise _refus_whatsapp(refus)
    except KapsoError as exc:
        logger.warning("⚠️ WhatsApp : réponse non envoyée — %s", exc)
        raise HTTPException(
            status_code=502,
            detail={"status": "echec", "motif": str(exc)},
        )
