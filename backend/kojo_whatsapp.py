# -*- coding: utf-8 -*-
"""Support WhatsApp — Kapso entre, l'assistant répond, un humain reprend au besoin.

Le produit n'avait qu'un support : le formulaire de `/support`. Une personne qui
écrit sur le numéro WhatsApp de Kojo, elle, n'obtenait rien. Ce module branche ce
canal de bout en bout :

  * INGESTION — `POST /api/support/whatsapp/webhook` reçoit les messages que
    Kapso relaie (API WhatsApp Business). L'endpoint est public et non
    authentifié, comme les IPN PayDunya et le webhook email : sa seule preuve
    d'identité est la SIGNATURE HMAC-SHA256 du corps BRUT
    (`X-Webhook-Signature`, hexadécimal). Sans elle, n'importe qui ferait
    répondre le numéro de Kojo à n'importe qui, aux frais du propriétaire.

  * RÉPONSE — l'assistant de `/support` répond (même politique, même budget :
    `kojo_support_assistant`, `kojo_ai_budget`), dans la langue du client, avec
    les derniers tours de CETTE conversation comme contexte.

  * ESCALADE — quand l'assistant estime qu'un humain doit reprendre (marqueur
    `[KOJO_TICKET]`), quand le budget de la journée est atteint, quand l'IA est
    en panne, ou quand l'envoi est désactivé, un TICKET est ouvert
    (`kojo_support_tickets`) : la demande entre dans la file que le propriétaire
    lit déjà. Rien n'est promis au client en échange.

Cinq décisions, avec leur coût, écrites pour ne pas les redécouvrir :

  * IDEMPOTENCE par `provider_message_id`. Le fournisseur re-livre une requête
    dont il n'a pas lu la réponse ; sans cette clé, une re-livraison ferait
    répondre deux fois, sur un canal où l'on ne peut pas effacer. La clé est
    UNIQUE en base (index de `kojo_db`) et relue avant d'écrire.
  * PAS DE FENÊTRE TEMPORELLE sur la signature, parce que Kapso n'en documente
    pas : le rejeu est neutralisé par l'idempotence ci-dessus (rejouer un
    message déjà traité ne renvoie rien de plus), pas par une horloge inventée.
  * Une réponse qui n'a pas pu PARTIR n'est pas un succès. Une panne PASSAGÈRE
    (réseau, 5xx) répond 502 pour que le fournisseur re-livre ; un refus
    DÉFINITIF (4xx) ne se répare pas en re-livrant, donc il ESCALADE vers un
    humain au lieu de repayer un appel au modèle. Dans les deux cas le statut
    du message dit `echec` : le client, lui, n'a rien reçu.
  * Sans `KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`, on n'acquitte PAS : le message
    est enregistré et escaladé (`non_envoye`). Faire croire au client qu'on lui
    a répondu serait pire que de ne pas avoir de WhatsApp.
  * La conversation est CONSERVÉE (bornée, `WHATSAPP_MESSAGE_RETENTION_DAYS`)
    pour deux raisons qui n'en font qu'une : le contexte de l'assistant et la
    trace de l'escalade. Elle est rattachée à un compte quand le numéro en
    désigne un (chiffres identiques), donc elle suit l'export et la suppression
    (`USER_DATA_SOURCES`) ; un numéro inconnu de Kojo n'a pas de compte, et le
    document périme par sa règle.

Ce que ce module NE fait pas, écrit : ni boutons, ni gabarits de message
(WhatsApp les facture et les fait valider), ni médias entrants au-delà d'un refus
poli, ni groupe (le numéro répond à une personne).
"""
import asyncio
import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from kojo_ai_budget import MOTIF_COMPTEUR, caracteres_de_prompt, reserver
from kojo_ai_gateway import AiGatewayError, chat_completion, is_configured as ia_configuree
from kojo_core import db
from kojo_settings import (
    KAPSO_API_BASE_URL,
    KAPSO_API_KEY,
    KAPSO_API_VERSION,
    KAPSO_PHONE_NUMBER_ID,
    KAPSO_TIMEOUT_SECONDS,
    KAPSO_WEBHOOK_SECRET,
    WHATSAPP_CONTEXT_MESSAGES,
    logger,
)
from kojo_support_assistant import TICKET_MARKER, robot_system_prompt
from kojo_support_tickets import ouvrir_ticket

# Le seul événement qui déclenche une réponse. Les autres (statuts de livraison,
# mises à jour de conversation) sont acquittés en le NOMMANT : refuser ce qu'on
# ignore ferait re-livrer indéfiniment un fait qui ne nous concerne pas.
EVENEMENT_MESSAGE = "whatsapp.message.received"

# Longueur maximale d'un message WhatsApp sortant (4096 selon Meta). Tronquer
# est préférable à un refus du fournisseur : la réponse est déjà écrite.
LONGUEUR_MAX_TEXTE = 4096

# Longueur d'un tour redonné au modèle : c'est aussi la borne du budget de
# caractères (`kojo_ai_budget`), qui compte le prompt entier.
LONGUEUR_MAX_CONTEXTE = 2000

# Un statut TERMINAL ne se rejoue pas : le fournisseur peut re-livrer, le client
# ne doit pas recevoir deux fois la même réponse. `echec` n'en est pas un —
# justement pour que la re-livraison répare un envoi raté.
STATUTS_TERMINAUX = ("traite", "escalade", "non_envoye", "ignore")

# La collection est nommée en CLAIR à chaque usage (`db.whatsapp_messages`) :
# le garde qui exige que toute collection du backend soit classée pour l'export
# RGPD (tests/test_data_export.py) lit `db.<nom>.` — une constante rendrait la
# nouvelle collection invisible à ce contrôle, donc non classée sans que rien ne
# le dise.

# Réponses de repli, en FRANÇAIS ET EN ANGLAIS : quand on ne peut pas appeler le
# modèle, on ne sait pas dans quelle langue le client a écrit, et laisser une
# personne sans accusé de réception est pire qu'un message bilingue.
REPONSE_ESCALADE = (
    "Merci pour votre message. Une personne de l'équipe Kojo vous répond ici au "
    "plus vite.\n\nThank you for your message. A Kojo team member will reply "
    "here shortly."
)
REPONSE_NON_TEXTE = (
    "Merci ! Pour que nous puissions vous aider, écrivez-nous votre demande en "
    "texte.\n\nPlease send your request as a text message so we can help."
)


class WebhookRefuse(Exception):
    """Un refus d'ingestion, avec son motif et le statut HTTP qui le dit."""

    def __init__(self, motif: str, statut: int = 400):
        super().__init__(motif)
        self.motif = motif
        self.statut = statut


class KapsoError(RuntimeError):
    """Un envoi qui n'a pas abouti. Le message d'erreur ne porte jamais la clé.

    `transitoire` distingue deux pannes qui n'appellent PAS la même réponse :
    une panne réseau ou un 5xx se répare en re-livrant (502 pour que le
    fournisseur rejoue), tandis qu'un 4xx (destinataire invalide, charge utile
    refusée) se reproduira à l'identique — re-livrer repaierait un appel au
    modèle sans jamais rien envoyer, donc on escalade vers un humain.
    """

    def __init__(self, motif: str, *, transitoire: bool = True):
        super().__init__(motif)
        self.transitoire = transitoire


# ── Configuration ───────────────────────────────────────────────────────────


def est_configure() -> bool:
    """L'envoi est-il configuré (clé + numéro émetteur) ?"""
    return bool(KAPSO_API_KEY and KAPSO_PHONE_NUMBER_ID)


# ── Signature ───────────────────────────────────────────────────────────────


def _entete(entetes, nom: str) -> str:
    """La valeur d'un en-tête, insensible à la casse (dict ou Headers)."""
    valeur = entetes.get(nom)
    if valeur:
        return str(valeur).strip()
    cible = nom.lower()
    for cle, brute in (entetes.items() if hasattr(entetes, "items") else ()):
        if str(cle).lower() == cible:
            return str(brute).strip()
    return ""


def verifier_signature(corps: bytes, entetes) -> None:
    """Vérifie que la requête vient de Kapso, ou lève `WebhookRefuse`.

    Trois précisions qui ont chacune un mode d'échec réel :

      * le corps est celui REÇU, en octets — re-sérialiser le JSON ne signerait
        plus la même chose, donc une requête légitime serait refusée ;
      * la comparaison est en temps constant (`hmac.compare_digest`) : une
        comparaison naïve laisse mesurer la signature octet par octet ;
      * un secret ABSENT n'est pas un refus silencieux mais un 503 nommé : sans
        lui la signature ne peut pas être vérifiée, donc l'ingestion est
        DÉSACTIVÉE plutôt que permissive (le backend démarre quand même).

    Aucune fenêtre temporelle n'est appliquée : Kapso n'en documente pas, et le
    rejeu est déjà neutralisé par l'idempotence du message
    (`provider_message_id`), qui est la propriété qu'on veut vraiment.
    """
    secret = (KAPSO_WEBHOOK_SECRET or "").strip()
    if not secret:
        raise WebhookRefuse(
            "webhook WhatsApp désactivé : KAPSO_WEBHOOK_SECRET n'est pas configuré — "
            "sans secret la signature ne peut pas être vérifiée, et répondre sur la "
            "parole du premier venu ferait payer le propriétaire pour des messages "
            "qu'il n'a pas demandés (poser le secret du webhook Kapso, puis redéployer)",
            statut=503,
        )

    signature_recue = _entete(entetes, "X-Webhook-Signature")
    if not signature_recue:
        raise WebhookRefuse(
            "en-tête X-Webhook-Signature absent : la requête ne prouve pas qu'elle "
            "vient de Kapso",
            statut=401,
        )

    attendu = hmac.new(secret.encode("utf-8"), corps, hashlib.sha256).hexdigest()
    # Certains relais préfixent la valeur (`sha256=`) : la retirer ne compare pas
    # deux choses différentes, elle compare la MÊME empreinte écrite autrement.
    recue = signature_recue.lower()
    if recue.startswith("sha256="):
        recue = recue[len("sha256="):]
    if not hmac.compare_digest(recue.strip(), attendu):
        raise WebhookRefuse(
            "signature invalide : la requête ne vient pas de Kapso (ou le secret "
            "configuré n'est pas celui de ce webhook)",
            statut=401,
        )


# ── Lecture de la charge utile ──────────────────────────────────────────────


def evenement_de(payload: Any, entetes=None) -> str:
    """Le nom de l'événement : l'en-tête d'abord, le corps ensuite.

    Kapso documente l'en-tête `X-Webhook-Event` ; `event` dans le corps est
    accepté parce qu'un relais peut le recopier, et un nom d'événement lu dans
    le corps vaut mieux qu'un webhook ignoré pour un en-tête perdu.
    """
    entete = _entete(entetes or {}, "X-Webhook-Event")
    if entete:
        return entete
    if isinstance(payload, dict):
        return str(payload.get("event") or "").strip()
    return ""


def _donnees(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Le bloc utile : `data` quand il existe, la charge utile sinon."""
    donnees = payload.get("data")
    return donnees if isinstance(donnees, dict) else payload


def _chiffres(valeur: Any) -> str:
    """Le numéro réduit à ses chiffres (« +221 77 123 45 67 » → « 221771234567 »)."""
    return "".join(caractere for caractere in str(valeur or "") if caractere.isdigit())


def _identite(
    message: Dict[str, Any], conversation: Dict[str, Any], kapso: Dict[str, Any]
) -> str:
    """De quoi joindre l'expéditeur : son numéro en chiffres, sinon son identité.

    Kapso documente explicitement les messages SANS numéro (identité
    `business_scoped_user_id`, `from_user_id`, `username`) : s'en tenir au
    numéro laisserait ces clients sans réponse. L'identité de repli est rendue
    TELLE QUELLE — c'est elle que le fournisseur attend dans `to`.
    """
    chiffres = _chiffres(
        message.get("from")
        or conversation.get("phone_number")
        or kapso.get("phone_number")
        or ""
    )
    if chiffres:
        return chiffres
    return str(
        message.get("from_user_id")
        or conversation.get("business_scoped_user_id")
        or conversation.get("username")
        or ""
    ).strip()


def _texte_du_message(message: Dict[str, Any]) -> str:
    """Le corps d'un message texte, que le fournisseur dise `body` ou `text`."""
    bloc = message.get("text")
    if isinstance(bloc, dict):
        return str(bloc.get("body") or bloc.get("text") or "").strip()
    if isinstance(bloc, str):
        return bloc.strip()
    return ""


def message_entrant(payload: Any) -> Optional[Dict[str, Any]]:
    """Le message à traiter, ou `None` s'il n'appelle aucune réponse.

    `None` n'est pas un refus : c'est notre propre message qui revient (écho de
    direction `outbound`), ou une charge utile qu'on sait lire et qui ne demande
    rien. Lève `WebhookRefuse` quand une charge utile DEVRAIT être lisible et ne
    l'est pas — la taire serait la surface aveugle que ce module ferme.
    """
    if not isinstance(payload, dict):
        raise WebhookRefuse("charge utile sans objet JSON", statut=400)

    donnees = _donnees(payload)
    message = donnees.get("message")
    if not isinstance(message, dict):
        raise WebhookRefuse(
            "charge utile sans « message » : rien à lire (événement %r)"
            % (str(payload.get("event") or "?")),
            statut=400,
        )

    kapso = message.get("kapso") if isinstance(message.get("kapso"), dict) else {}
    conversation = donnees.get("conversation") if isinstance(donnees.get("conversation"), dict) else {}

    direction = str(kapso.get("direction") or message.get("direction") or "").strip().lower()
    if direction and direction != "inbound":
        # Écho de NOS réponses : le webhook reçoit aussi ce que le numéro envoie.
        # Répondre à cela ferait parler le numéro à lui-même.
        return None
    if kapso.get("passive") is True:
        # Numéro partagé : un AUTRE agent (Meta Business Agent) traite déjà ce
        # message. Répondre lui ferait produire deux réponses au client.
        return None

    identifiant = str(
        message.get("id") or kapso.get("message_id") or kapso.get("id") or ""
    ).strip()
    if not identifiant:
        raise WebhookRefuse(
            "message sans identifiant (« message.id ») : sans lui, une re-livraison "
            "du fournisseur ferait répondre deux fois",
            statut=400,
        )

    expediteur = _identite(message, conversation, kapso)
    if not expediteur:
        raise WebhookRefuse(
            "message sans expéditeur identifiable (ni numéro, ni identité "
            "business-scoped) : aucune conversation à joindre",
            statut=400,
        )

    type_message = str(message.get("type") or "text").strip().lower()
    texte = _texte_du_message(message) if type_message == "text" else ""
    if not texte and type_message != "text":
        # Les médias n'ont pas de `text`, mais Kapso en donne une représentation
        # textuelle (`message.kapso.content`) : la garder évite un ticket vide.
        texte = str(kapso.get("content") or "").strip()
    return {
        "provider_message_id": identifiant,
        # `phone` porte l'IDENTITÉ WhatsApp du contact : le numéro en chiffres
        # quand Meta en envoie un, sinon son identité business-scoped (BSUID) —
        # Meta peut livrer un message sans numéro, et refuser ces messages
        # laisserait des clients sans réponse.
        "phone": expediteur,
        "conversation": expediteur,
        "from_name": str(conversation.get("contact_name") or "").strip(),
        "type_message": type_message,
        "texte": texte,
    }


# ── Compte rattaché (export / suppression) ──────────────────────────────────


async def compte_du_numero(numero: str) -> Optional[str]:
    """L'identifiant du compte dont le téléphone EST ce numéro, sinon None.

    Deux formes seulement sont essayées — les chiffres et `+` suivi des chiffres
    — parce que ce sont les deux écritures que le dépôt produit ; deviner
    l'indicatif d'un pays absent rattacherait la conversation au hasard, et une
    conversation rattachée au mauvais compte se supprimerait avec lui.
    """
    chiffres = _chiffres(numero)
    if len(chiffres) < 8:
        # Identité business-scoped (BSUID) : aucun numéro à comparer.
        return None
    for forme in (chiffres, "+" + chiffres):
        compte = await db.users.find_one({"phone": forme}, {"id": 1})
        if compte and compte.get("id"):
            return str(compte["id"])
    return None


# ── Envoi ───────────────────────────────────────────────────────────────────


def envoyer_texte(destinataire: str, texte: str) -> Dict[str, Any]:
    """Envoie un message texte par Kapso. Lève `KapsoError` si l'envoi échoue.

    SYNCHRONE (`requests`), appelé hors de l'event loop : un fournisseur lent ne
    doit pas bloquer les autres requêtes du worker.
    """
    if not est_configure():
        raise KapsoError(
            "envoi WhatsApp non configuré : KAPSO_API_KEY et KAPSO_PHONE_NUMBER_ID "
            "sont requis"
        )
    url = f"{KAPSO_API_BASE_URL}/{KAPSO_API_VERSION}/{KAPSO_PHONE_NUMBER_ID}/messages"
    charge = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        # Les chiffres quand c'en est un, l'identité telle quelle sinon
        # (business-scoped user id) : `_chiffres` viderait un BSUID.
        "to": _chiffres(destinataire) or destinataire,
        "type": "text",
        "text": {"body": (texte or "")[:LONGUEUR_MAX_TEXTE]},
    }
    try:
        reponse = requests.post(
            url,
            json=charge,
            headers={
                "X-API-Key": KAPSO_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=KAPSO_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        # Le message d'une exception `requests` contient l'URL, jamais l'en-tête
        # `X-API-Key` : la clé ne sort donc pas dans les journaux.
        raise KapsoError(f"Kapso injoignable : {exc}", transitoire=True) from exc

    if reponse.status_code not in (200, 201):
        raise KapsoError(
            "Kapso a refusé l'envoi (HTTP %d) : %s"
            % (reponse.status_code, (reponse.text or "")[:200]),
            # 5xx = le fournisseur est en panne (re-livrer a du sens) ; 4xx =
            # la requête elle-même est refusée (elle le sera encore).
            transitoire=reponse.status_code >= 500,
        )
    try:
        return reponse.json()
    except ValueError:
        return {}


# ── Conversation ────────────────────────────────────────────────────────────


async def _contexte(conversation: str, identifiant: str) -> List[Dict[str, str]]:
    """Les derniers tours de la conversation, du plus ancien au plus récent.

    La lecture est BORNÉE (`WHATSAPP_CONTEXT_MESSAGES`) : le prompt est facturé,
    et une conversation peut durer des jours. Le message courant est exclu — il
    est ajouté par l'appelant, à sa place.
    """
    if WHATSAPP_CONTEXT_MESSAGES <= 0:
        return []
    curseur = (
        db.whatsapp_messages
        .find({"conversation": conversation})
        .sort("created_at", -1)
        .limit(WHATSAPP_CONTEXT_MESSAGES * 2)  # entrées ET sorties
    )
    documents = [document async for document in curseur]
    tours: List[Dict[str, str]] = []
    for document in reversed(documents):
        if str(document.get("provider_message_id") or "") == identifiant:
            continue
        texte = str(document.get("texte") or "").strip()
        if not texte:
            continue
        tours.append({
            "role": "user" if document.get("direction") == "in" else "assistant",
            "content": texte[:LONGUEUR_MAX_CONTEXTE],
        })
    return tours[-WHATSAPP_CONTEXT_MESSAGES:] if tours else []


async def _enregistrer(document: Dict[str, Any], maintenant: datetime) -> bool:
    """Écrit un message. Rend False si l'identifiant fournisseur est déjà connu.

    L'index UNIQUE est la garantie en production ; la lecture préalable couvre le
    cas courant sans en dépendre (même arbitrage que le journal des emails).
    """
    if document.get("provider_message_id"):
        existant = await db.whatsapp_messages.find_one(
            {"provider_message_id": document["provider_message_id"]}
        )
        if existant is not None:
            return False
    document.setdefault("id", str(uuid.uuid4()))
    document["created_at"] = maintenant
    await db.whatsapp_messages.insert_one(document)
    return True


async def _maj(identifiant: str, champs: Dict[str, Any]) -> None:
    await db.whatsapp_messages.update_one(
        {"provider_message_id": identifiant}, {"$set": dict(champs)}
    )


async def _ouvrir_ticket(
    ticket_id: Optional[str], message: Dict[str, Any], user_id: Optional[str]
) -> str:
    """Le ticket de cette conversation — celui qui existe, ou un nouveau.

    Rend l'identifiant sans en créer un second quand il existe déjà : une
    re-livraison ne doit pas doubler la file d'arbitrage de l'équipe.
    """
    if ticket_id:
        return ticket_id
    ticket = await ouvrir_ticket(
        full_name=message["from_name"] or "Contact WhatsApp",
        phone=message["phone"],
        reason="Support WhatsApp",
        message=message["texte"] or f"(message {message['type_message']} non textuel)",
        channel="whatsapp",
        user_id=user_id,
    )
    return ticket.id


async def _composer(texte: str, conversation: str, identifiant: str) -> Dict[str, Any]:
    """La réponse de l'assistant, et la raison pour laquelle un humain reprend.

    Trois issues, toutes explicites : une réponse du modèle, une ESCALADE (le
    modèle la demande, le budget est atteint, ou l'IA est en panne). Le repli ne
    promet rien d'autre que « une personne vous répond ».
    """
    if not ia_configuree():
        return {"reponse": REPONSE_ESCALADE, "escalade": True, "motif": "ia_desactivee"}

    messages = [{
        "role": "system",
        "content": robot_system_prompt(detecter_la_langue=True, canal="whatsapp"),
    }]
    messages += await _contexte(conversation, identifiant)
    messages.append({"role": "user", "content": texte[:LONGUEUR_MAX_CONTEXTE]})

    # Le budget se juge sur le prompt RÉEL (instructions du serveur comprises),
    # et la réservation est prise AVANT l'appel : compter après coup laisserait
    # passer la dépense qu'on veut borner.
    budget = await reserver(caracteres_de_prompt(messages))
    if not budget.autorisee:
        motif = "budget_indisponible" if budget.motif == MOTIF_COMPTEUR else "budget_atteint"
        return {"reponse": REPONSE_ESCALADE, "escalade": True, "motif": motif}

    try:
        texte_modele = await asyncio.to_thread(chat_completion, messages)
    except AiGatewayError as exc:
        logger.warning(f"⚠️ Assistant WhatsApp : {exc}")
        return {"reponse": REPONSE_ESCALADE, "escalade": True, "motif": "ia_en_panne"}

    escalade = TICKET_MARKER in texte_modele
    return {
        "reponse": texte_modele.replace(TICKET_MARKER, "").strip() or REPONSE_ESCALADE,
        "escalade": escalade,
        "motif": "assistant" if escalade else "reponse",
    }


# ── Traitement d'un message ─────────────────────────────────────────────────


async def traiter_message(
    message: Dict[str, Any], *, maintenant: Optional[datetime] = None
) -> Dict[str, Any]:
    """Répond à UN message entrant, et rend ce qui s'est passé.

    Le retour est ce que la route publie : `status` (`ok`, `ignore`,
    `deja_traite`), `statut` du message, `escalade`, `motif`, `ticket_id`
    éventuel. Aucun texte de conversation n'y figure : la réponse du webhook
    peut être journalisée côté fournisseur.
    """
    instant = maintenant or datetime.now(timezone.utc)
    identifiant = message["provider_message_id"]
    conversation = message["conversation"]

    existant = await db.whatsapp_messages.find_one({"provider_message_id": identifiant})
    if existant and existant.get("statut") in STATUTS_TERMINAUX:
        return {
            "status": "deja_traite",
            "statut": existant.get("statut"),
            "escalade": existant.get("statut") == "escalade",
            "motif": existant.get("motif") or "",
            "ticket_id": existant.get("ticket_id"),
        }

    user_id = existant.get("user_id") if existant else None
    if existant is None:
        user_id = await compte_du_numero(message["phone"])
        await _enregistrer(
            {
                "provider_message_id": identifiant,
                "conversation": conversation,
                "phone": message["phone"],
                "from_name": message["from_name"],
                "direction": "in",
                "type": message["type_message"],
                "texte": message["texte"],
                "user_id": user_id,
                "statut": "recu",
                "motif": "",
            },
            instant,
        )

    # Un média n'est pas une demande lisible : on le dit, sans mobiliser un
    # humain ni payer un appel au modèle.
    if message["type_message"] != "text" or not message["texte"]:
        reponse, escalade, motif = REPONSE_NON_TEXTE, False, "media"
    else:
        resultat = await _composer(message["texte"], conversation, identifiant)
        reponse, escalade, motif = resultat["reponse"], resultat["escalade"], resultat["motif"]

    # Un envoi IMPOSSIBLE n'est pas une réponse : si la conversation ne peut pas
    # être servie (clé absente), un humain doit la voir, même quand l'assistant
    # avait sa réponse. Sinon le client écrit dans le vide.
    if not est_configure():
        escalade = True

    # Le ticket est ouvert AVANT l'envoi : une re-livraison après un envoi raté
    # retrouve celui qui existe déjà (identifiant écrit sur le message) au lieu
    # d'en créer un second.
    ticket_id = existant.get("ticket_id") if existant else None
    if escalade:
        ticket_id = await _ouvrir_ticket(ticket_id, message, user_id)

    statut, motif_envoi = ("escalade" if escalade else "traite"), ""
    if not est_configure():
        statut, motif_envoi = "non_envoye", "envoi_desactive"
        logger.warning(
            "⚠️ WhatsApp : KAPSO_API_KEY/KAPSO_PHONE_NUMBER_ID absents — message de "
            "%s enregistré et escaladé, mais AUCUNE réponse envoyée",
            message["phone"],
        )
    else:
        try:
            await asyncio.to_thread(envoyer_texte, message["phone"], reponse)
        except KapsoError as exc:
            logger.warning(f"⚠️ WhatsApp : envoi impossible — {exc}")
            if exc.transitoire:
                # Panne passagère : la re-livraison du fournisseur réparera, et
                # un ticket ouvert maintenant solliciterait un humain pour un
                # message qui va recevoir sa réponse.
                await _maj(
                    identifiant, {"statut": "echec", "motif": motif, "ticket_id": ticket_id}
                )
                raise
            # Refus DÉFINITIF (4xx) : re-livrer repaierait un appel au modèle
            # sans jamais rien envoyer. On escalade, et la route acquitte.
            ticket_id = await _ouvrir_ticket(ticket_id, message, user_id)
            escalade = True
            statut, motif_envoi = "echec", "envoi_refuse_definitif"

    await _maj(
        identifiant,
        {"statut": statut, "motif": motif, "ticket_id": ticket_id, "repondu_le": instant},
    )
    # La réponse entre dans la conversation : c'est le contexte des messages
    # suivants, et la trace de ce que le client a réellement reçu.
    await _enregistrer(
        {
            "provider_message_id": f"out:{identifiant}",
            "conversation": conversation,
            "phone": message["phone"],
            "from_name": "",
            "direction": "out",
            "type": "text",
            "texte": reponse,
            "user_id": user_id,
            "statut": statut,
            "motif": motif,
            "reponse_a": identifiant,
            "ticket_id": ticket_id,
        },
        instant,
    )

    return {
        "status": "ok",
        "statut": statut,
        "escalade": escalade,
        "motif": motif,
        "ticket_id": ticket_id,
        "envoi": motif_envoi or "ok",
    }


async def traiter_evenement(
    payload: Any,
    evenement: str,
    *,
    maintenant: Optional[datetime] = None,
    entetes=None,
) -> Dict[str, Any]:
    """Traite un webhook complet : événement, enveloppe, puis le message.

    Un événement que nous ne suivons pas est ACQUITTÉ en le nommant (le
    fournisseur ne doit pas re-livrer ce qui ne nous concerne pas) ; une charge
    utile illisible est REFUSÉE en la nommant (`WebhookRefuse`).
    """
    if evenement != EVENEMENT_MESSAGE:
        logger.info("ℹ️ Webhook WhatsApp ignoré (événement non suivi) : %s", evenement or "?")
        return {"status": "ignore", "event": evenement}

    # Une enveloppe groupée porte plusieurs messages : `batch` vaut `true` et
    # les charges utiles sont dans `data` (ou l'en-tête `X-Webhook-Batch`
    # l'annonce). Chacun est traité pour lui-même, et le bilan les compte au
    # lieu d'en perdre — l'ignorer rendrait aveugle le mode « buffering ».
    if isinstance(payload, dict) and isinstance(payload.get("data"), list) and (
        payload.get("batch") is True
        or str(_entete(entetes, "X-Webhook-Batch")).lower() == "true"
    ):
        bilans = []
        for element in payload["data"]:
            if not isinstance(element, dict):
                continue
            nom = str(element.get("event") or evenement)
            bilans.append(await traiter_evenement(element, nom, maintenant=maintenant))
        return {"status": "ok", "batch": bilans}

    message = message_entrant(payload)
    if message is None:
        return {"status": "ignore", "event": evenement, "motif": "echo ou sans message"}
    return await traiter_message(message, maintenant=maintenant)
