# -*- coding: utf-8 -*-
"""Politique de l'assistant support — propriétaire UNIQUE des instructions.

Deux canaux parlent au même assistant : la page `/support`
(`kojo_routers_support.robot_chat`) et WhatsApp (`kojo_whatsapp`). Écrire les
règles deux fois les ferait diverger au premier correctif — un canal refuserait
un remboursement, l'autre le promettrait, et personne ne verrait l'écart
puisqu'il ne se lit qu'en comparant deux fichiers. Ce module porte donc UNE
politique ; le canal ne change que ce qui doit changer :

  * sur WhatsApp, le client n'a pas CHOISI de langue (il écrit ce qu'il parle),
    donc l'assistant suit son dernier message au lieu d'une langue déclarée ;
  * sur WhatsApp, il n'y a ni formulaire ni bouton à ouvrir : quand un humain
    doit reprendre, l'assistant le dit dans sa réponse.

Le marqueur vit ici pour la même raison : c'est un mot du protocole avec le
modèle, pas une constante d'une route. Il voyage DANS le texte (un modèle qui
« oublie » un outil ne casse donc rien) et le serveur le RETIRE avant d'envoyer
la réponse au client — seul `ticket_suggested`/`escalade` reste visible.
"""

from kojo_models import Language

TICKET_MARKER = "[KOJO_TICKET]"

LANGUAGE_NAMES = {
    Language.FRENCH: "français",
    Language.ENGLISH: "anglais",
    Language.WOLOF: "wolof",
    Language.BAMBARA: "bambara",
    Language.MOORE: "mooré",
}

# La consigne de langue libre : le message WhatsApp ne porte aucune préférence,
# et demander « dans quelle langue ? » coûterait un tour facturé pour une
# information que le message contient déjà.
CONSIGNE_LANGUE_LIBRE = (
    "Le client n'a pas déclaré de langue : réponds dans celle de son dernier "
    "message (français, anglais, wolof, bambara ou mooré), sans le lui demander."
)

CONSIGNE_SANS_FORMULAIRE = (
    "Le message arrive par WhatsApp : tu ne peux ouvrir aucun formulaire et le "
    "client n'a pas de bouton à cliquer. Si un humain doit reprendre, dis-le "
    "simplement dans ta réponse."
)


def robot_system_prompt(
    language: Language = Language.FRENCH,
    *,
    detecter_la_langue: bool = False,
    canal: str = "web",
) -> str:
    """Instructions de l'assistant, dans la langue du visiteur (ou la sienne).

    Écrit côté SERVEUR (jamais reçu du client) : c'est la politique de
    l'assistant — périmètre, ton, et l'interdiction d'inventer une donnée de
    compte — donc ce qu'un visiteur ne doit pas pouvoir réécrire.

    Args:
        language: la langue déclarée par le client (page /support).
        detecter_la_langue: True quand le canal ne transporte pas de préférence
            (WhatsApp) : le modèle suit alors la langue du message.
        canal: `"web"` ou `"whatsapp"` ; seul le second ajoute la consigne
            « pas de formulaire ». Un canal inconnu n'ajoute rien plutôt que de
            refuser : la politique, elle, est la même.

    Returns:
        str: le prompt système complet, marqueur d'escalade compris.
    """
    if detecter_la_langue:
        langue = CONSIGNE_LANGUE_LIBRE
    else:
        langue = LANGUAGE_NAMES.get(language, "français")

    consignes = (
        "Tu es l'assistant support de Kojo, une plateforme ouest-africaine qui met en "
        "relation des clients et des travailleurs (Sénégal, Mali, Côte d'Ivoire, "
        "Burkina Faso). Langue de réponse : " + langue + "\n"
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
        "sais pas, propose de transmettre la demande à l'équipe et termine ta "
        "réponse par " + TICKET_MARKER + " (seul, à la fin).\n"
        "- Hors sujet (insultes, sujets sans rapport avec Kojo) : refuse poliment "
        "et ramène la conversation au support Kojo."
    )
    if canal == "whatsapp":
        consignes += "\n" + CONSIGNE_SANS_FORMULAIRE
    return consignes
