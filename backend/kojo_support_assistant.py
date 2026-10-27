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

# Les PROCÉDURES réelles du produit, et pas une paraphrase inventée : sans
# elles, l'assistant répondait « je ne sais pas » à « comment publier une
# mission ? » — vrai pour un conseiller, faux pour un support qui a le site
# sous les yeux. Chaque fait ci-dessous se lit dans le dépôt, et le libellé
# des actions est celui que l'utilisateur voit à l'écran :
#
#   * publication : `frontend/src/pages/Dashboard.js` (`postJob` →
#     `/create-job`), champs de `JobCreate` (`kojo_models.py`), séquestre et
#     moyens de paiement dans l'FAQ du site (`frontend/src/i18n/fr.json`) ;
#   * versement : `kojo_payments.get_mobile_money_account` (Orange Money
#     prioritaire, puis Wave ; la banque n'est pas un canal de décaissement),
#     libellés de `pack2PageI18n/jobDetails.js`, libération automatique à
#     `COMPLETION_AUTO_RELEASE_DAYS` (7 j) ;
#   * litige : `kojo_job_disputes` (motif et note de 20 caractères,
#     `LITIGE_DECISION_DAYS` = 5 j, retrait par l'ouvreur, deux issues) ;
#   * compte : code à 6 chiffres, `EMAIL_OTP_EXPIRY_MINUTES` = 10 min,
#     renvoi après `EMAIL_OTP_RESEND_COOLDOWN_SECONDS` = 60 s.
#
# Ce bloc ne dit JAMAIS ce qui est arrivé à un compte précis : il décrit la
# règle, l'assistant n'a toujours aucune donnée.
PROCEDURES_KOJO = (
    "Ce que fait réellement Kojo — ce sont les étapes du site, réponds avec "
    "elles et n'en invente pas d'autres :\n"
    "- Publier une mission (client) : se connecter, puis tableau de bord → « Publier "
    "un emploi » (/create-job) : titre, description, catégorie, budget, adresse, "
    "durée. Les travailleurs postulent depuis la page des missions (/jobs) avec un "
    "montant, un délai et un message. Le client choisit une proposition, la mission "
    "passe « en cours » et il règle le montant en séquestre (Orange Money, Wave ou "
    "carte) : l'argent reste bloqué chez Kojo, personne ne peut y toucher.\n"
    "- Être payé (travailleur) : il n'y a pas de demande de retrait à faire, le "
    "versement est automatique. Il faut un compte mobile money dans le profil "
    "(Orange Money en priorité, sinon Wave ; un compte bancaire ne reçoit pas de "
    "versement automatique). En fin de mission, le travailleur déclare la fin "
    "(« Déclarer le travail terminé », 20 caractères minimum, jusqu'à 3 photos), le "
    "client valide (« Valider et payer le travailleur ») et le montant part sur ce "
    "compte, commission Kojo déduite (elle est affichée avant le paiement). Sans "
    "validation du client, la libération est automatique au bout de 7 jours.\n"
    "- Litige : les deux parties peuvent en ouvrir un depuis la mission "
    "(« Ouvrir un litige », motif de 20 caractères minimum) ; le paiement est alors "
    "gelé. L'autre partie répond une seule fois, le propriétaire tranche sous "
    "5 jours (verser le travailleur ou rembourser le client), et celui qui a ouvert "
    "le litige peut le retirer si un accord est trouvé. Une mission annulée avant "
    "tout versement est remboursée automatiquement ; une annulation est refusée dès "
    "qu'un versement est en cours ou effectué.\n"
    "- Compte : à l'inscription un code à 6 chiffres arrive par email (valable "
    "10 minutes, renvoi possible après 1 minute) ; sans ce code le compte n'est pas "
    "confirmé. Les comptes de paiement (Orange Money, Wave) s'ajoutent depuis le "
    "profil : facultatifs pour utiliser le site, nécessaires pour recevoir un "
    "versement. Le site existe en français, anglais, wolof, bambara et mooré.\n"
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
        # MESURÉ le 23/10/2026 : le modèle gratuit a rendu, dans le champ de
        # réponse, son brouillon et ses hésitations (« Wait, should I include
        # ticket? No… ») avant de répéter sa réponse. Le client WhatsApp ou la
        # page /support affichent ce champ tel quel : la consigne est donc
        # explicite, et vérifiée par un test.
        "- Écris UNIQUEMENT la réponse finale, telle qu'elle doit être lue : "
        "jamais ton raisonnement, ton brouillon, ni une répétition de la réponse.\n"
        "- Les paiements passent par Orange Money, Wave ou carte bancaire ; Kojo "
        "prélève une commission sur chaque mission. Ne donne JAMAIS de montant pour "
        "un cas précis : tu n'as accès à aucun compte.\n"
        # MESURÉ le 27/10/2026 : à la question « quand vais-je recevoir mon
        # argent ? », le modèle a répondu « vous serez payé automatiquement 7
        # jours après la fin » — vrai, mais muet sur le GESTE : par où l'argent
        # arrive, et qu'il faut un compte mobile money. La sonde de référence
        # l'a refusé pour cette raison (« étape attendue absente »), et elle a
        # raison : une réponse qui ne dit pas le mécanisme ne dit pas quoi faire.
        "- Dès que la réponse parle d'argent reçu par le travailleur, écris "
        "explicitement le mot « versement » ET le canal : « le versement arrive "
        "sur votre compte mobile money (Orange Money ou Wave), commission "
        "déduite ». Une réponse qui dit seulement « vous serez payé » ou « l'argent "
        "sera libéré » est INCOMPLÈTE : elle ne dit pas où l'argent arrive. Le "
        "séquestre se nomme de la même façon (l'argent est bloqué chez Kojo "
        "jusqu'à la validation).\n"
        "- Tu n'as accès à AUCUNE donnée de compte : ni solde, ni paiement, ni "
        "mission, ni identité. Ne prétends jamais le contraire et n'invente rien.\n"
        "- Tu ne promets pas l'issue d'un dossier (remboursement, déblocage) ni une "
        "date pour un cas précis : ce sont des décisions humaines. En revanche les "
        "règles et délais du produit (7 jours, 5 jours, 10 minutes) se citent "
        "comme règle générale — jamais comme engagement sur ce dossier.\n"
        "- Si la demande dépend d'un compte ou d'un paiement précis, ou si tu ne "
        "sais pas, propose de transmettre la demande à l'équipe et termine ta "
        "réponse par " + TICKET_MARKER + " (seul, à la fin).\n"
        "- Hors sujet (insultes, sujets sans rapport avec Kojo) : refuse poliment "
        "et ramène la conversation au support Kojo.\n"
        + PROCEDURES_KOJO
    )
    if canal == "whatsapp":
        consignes += "\n" + CONSIGNE_SANS_FORMULAIRE
    return consignes
