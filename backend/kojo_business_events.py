"""Événements métier : journal append-only des jalons d'une mission.

Treize faits, un document chacun : mission créée, proposition acceptée,
paiement confirmé, mission terminée, les trois jalons du séquestre à deux
temps (fin déclarée par le travailleur, validation client, libération
automatique), et les SIX jalons du LITIGE TRACÉ (ouvert, réponse de l'autre
partie, retiré, tranché, échu, et décision EN ÉCHEC). Un événement ne porte que son type, sa date, le compte concerné
(`user_id`, le client de la mission ou le payeur) et des identifiants (job,
proposition, paiement) : aucune donnée personnelle, aucun montant. `user_id` permet à l'export RGPD de rendre le journal du compte.

`details` est une exception BORNÉE, pour deux besoins : le journal doit dire
POURQUOI l'argent est parti d'un litige (versement au travailleur ou
remboursement du client), et QUELLE POSITION l'autre partie a demandée. Les
clés admises sont ÉNUMÉRÉES (`DETAILS_AUTORISES`) et un champ libre — le motif
ou la note de réponse, écrits par une partie, qui peuvent porter un nom ou un
numéro — n'y entrera jamais : une clé inconnue lève, comme un type inconnu.

Idempotence : `cle` (ex. `payment_confirmed:<payment_id>`) est unique. Une
écriture répétée d'un même jalon — IPN PayDunya en double, fin de mission
écrite à plusieurs endroits — est absorbée par la contrainte d'index et
compte une seule fois.

Une défaillance d'écriture est journalisée et n'interrompt jamais l'action
métier qui l'a déclenchée : le journal enregistre un fait, il ne le conditionne pas.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from kojo_db import db

logger = logging.getLogger(__name__)

TYPES_EVENEMENTS = frozenset(
    {
        "mission_created",
        "proposal_accepted",
        "payment_confirmed",
        "mission_completed",
        # Séquestre à deux temps : la déclaration du travailleur, la validation
        # du client, et la libération automatique quand le client n'a pas
        # répondu. Trois faits distincts, donc trois types — les fusionner
        # rendrait le journal incapable de dire POURQUOI l'argent est parti.
        "mission_completion_marked",
        "mission_completion_confirmed",
        "mission_auto_released",
        # Litige tracé : l'ouverture (qui conteste, et quand la fenêtre se
        # referme), le retrait (l'accord est revenu), la décision (le fait qui
        # débloque l'argent) et l'échéance (personne n'a tranché). Un litige
        # qui ne laisserait que son état dans le document ne dirait pas
        # l'HISTOIRE du désaccord, et c'est l'histoire que le support relit.
        "mission_dispute_opened",
        # La réponse de l'AUTRE partie : le fait que l'arbitre dispose enfin des
        # deux versions. Le journal ne garde que sa POSITION (énumérée), jamais
        # la note — de la même nature que le motif, qui n'y entre pas.
        "mission_dispute_answered",
        "mission_dispute_withdrawn",
        "mission_dispute_decided",
        "mission_dispute_expired",
        # Une décision REFUSÉE par le chemin de paiement (séquestre introuvable,
        # décaissement refusé, argent déjà en route) : le désaccord n'est PAS
        # tranché, mais la tentative est un fait. Sans ce jalon, une décision
        # qui n'a rien payé laissait le journal muet là où le support cherche
        # justement pourquoi la mission est restée bloquée.
        "mission_dispute_decision_failed",
    }
)

# Clés admises dans `details` : des FAITS ÉNUMÉRÉS, jamais une prose. Le motif
# d'un litige est écrit par une partie (donc potentiellement un nom, une
# adresse) ; le journal, lui, doit pouvoir être relu et exporté sans exposer
# cette prose. Une clé absente de cet ensemble est une erreur de programmation.
# `echec` est un CODE énuméré (séquestre introuvable, versement refusé, argent
# déjà en route), jamais la phrase du fournisseur : celle-ci peut porter un nom
# de compte ou un message libre, et le journal se relit et s'exporte.
DETAILS_AUTORISES = frozenset({"decision", "paiement", "echeance", "position", "echec"})
LONGUEUR_MAX_DETAIL = 60


async def enregistrer_evenement(
    type_evenement: str,
    cle: str,
    *,
    user_id: str,
    job_id: Optional[str] = None,
    proposal_id: Optional[str] = None,
    payment_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> bool:
    """Ajoute un événement au journal. Renvoie True s'il est nouveau, False s'il existait déjà.

    Lève ValueError sur un type inconnu ou une clé de `details` non déclarée :
    c'est une erreur de programmation, pas une défaillance d'écriture, et elle
    doit se voir en test.
    """
    if type_evenement not in TYPES_EVENEMENTS:
        raise ValueError(f"type d'événement métier inconnu : {type_evenement!r}")

    document = {
        "id": str(uuid.uuid4()),
        "type": type_evenement,
        "cle": cle,
        "user_id": user_id,
        "job_id": job_id,
        "proposal_id": proposal_id,
        "payment_id": payment_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    # `details` n'est posé QUE s'il y a quelque chose à dire : les événements
    # d'avant le litige gardent exactement leur forme, et un événement sans
    # détail n'ajoute pas une clé vide à relire.
    if details:
        inconnues = set(details) - DETAILS_AUTORISES
        if inconnues:
            raise ValueError(f"clé de détail non déclarée : {sorted(inconnues)!r}")
        document["details"] = {
            str(cle_detail): str(valeur)[:LONGUEUR_MAX_DETAIL]
            for cle_detail, valeur in details.items()
        }
    try:
        await db.business_events.insert_one(document)
    except DuplicateKeyError:
        return False
    except Exception:
        logger.exception("Échec d'écriture de l'événement métier %s (%s)", type_evenement, cle)
        return False
    return True
