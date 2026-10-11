"""Événements métier : journal append-only des jalons d'une mission.

Quatre faits, un document chacun : mission créée, proposition acceptée,
paiement confirmé, mission terminée. Un événement ne porte que son type, sa
date, le compte concerné (`user_id`, le client de la mission ou le payeur) et
des identifiants (job, proposition, paiement) : aucune donnée personnelle,
aucun montant. `user_id` permet à l'export RGPD de rendre le journal du compte.

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
    {"mission_created", "proposal_accepted", "payment_confirmed", "mission_completed"}
)


async def enregistrer_evenement(
    type_evenement: str,
    cle: str,
    *,
    user_id: str,
    job_id: Optional[str] = None,
    proposal_id: Optional[str] = None,
    payment_id: Optional[str] = None,
) -> bool:
    """Ajoute un événement au journal. Renvoie True s'il est nouveau, False s'il existait déjà.

    Lève ValueError sur un type inconnu : c'est une erreur de programmation, pas
    une défaillance d'écriture, et elle doit se voir en test.
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
    try:
        await db.business_events.insert_one(document)
    except DuplicateKeyError:
        return False
    except Exception:
        logger.exception("Échec d'écriture de l'événement métier %s (%s)", type_evenement, cle)
        return False
    return True
