# -*- coding: utf-8 -*-
"""Tâches de fond (scheduler).

Boucle de surveillance des DÉCAISSEMENTS BLOQUÉS : les paiements restés en
statut incertain (`releasing` / `refunding` — l'IPN PayDunya n'a jamais
tranché) sont re-vérifiés auprès de PayDunya à chaque passage. Si un statut
reste incertain au-delà d'un seuil (24 h par défaut), le propriétaire est
alerté une seule fois par paiement.

Le cas d'usage réel : un submit-invoice qui renvoie `pending`, ou une IPN de
callback perdue (réseau, redémarrage) → un versement travailleur ou un
remboursement client peut rester « en cours » indéfiniment côté suivi sans
que personne ne soit notifié. Ce sweeper résout les statuts quand PayDunya
répond, et escalade au propriétaire quand il ne peut pas.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from kojo_core import db
from kojo_models import NotificationType
from kojo_settings import (
    OWNER_USER_ID,
    PAYOUT_ALERT_THRESHOLD_HOURS,
    PAYOUT_SWEEPER_INTERVAL_MINUTES,
    logger,
)
from kojo_shared import notify_user_localized
# Réutilise la re-vérification PayDunya des routers paiements : même mapping
# de statut refund-aware (payout_kind == "refund" → refunded/refunding/
# refund_failed, sinon released/releasing/release_failed), mêmes notifications
# de transition et même application des retraits de récompenses. Point unique
# de vérité du check-status — pas de mapping dupliqué ici.
from kojo_routers_payments import _maybe_recheck_disburse_status

# Statuts « incertains » : PayDunya a peut-être exécuté le décaissement, seul
# un check-status (ou l'IPN) peut trancher.
_STUCK_PAYOUT_STATUSES = ("releasing", "refunding")


def _parse_payment_ts(value) -> Optional[datetime]:
    """Parse un timestamp de paiement (ISO string ou datetime, tz-aware)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _stuck_for(payment: dict, now: datetime) -> Optional[timedelta]:
    """Durée depuis la dernière transition de statut (updated_at, sinon
    created_at). updated_at n'est touché qu'au CHANGEMENT de statut (le
    recheck d'un statut inchangé ne le modifie pas), donc c'est une bonne
    mesure du temps passé en releasing/refunding."""
    for field in ("updated_at", "created_at"):
        ts = _parse_payment_ts(payment.get(field))
        if ts is not None:
            return now - ts
    return None


async def payout_stuck_sweep_once(now: Optional[datetime] = None) -> dict:
    """Un passage du sweeper : re-vérifie tous les décaissements en attente et
    alerte le propriétaire sur ceux bloqués au-delà du seuil.

    Retourne un résumé {rechecked, resolved, stuck, alerted} (testable, et
    loggé à chaque passage non vide).
    """
    now = now or datetime.now(timezone.utc)
    summary = {"rechecked": 0, "resolved": 0, "stuck": 0, "alerted": 0}

    payments = await db.payments.find({
        "payout_status": {"$in": list(_STUCK_PAYOUT_STATUSES)},
    }).to_list(length=500)

    for payment in payments:
        payment_id = payment.get("id")
        if not payment_id:
            continue
        summary["rechecked"] += 1

        # 1) Re-vérification PayDunya : si l'IPN n'est jamais arrivée, le
        #    check-status peut trancher (success → released/refunded, échec →
        #    release_failed/refund_failed). Un échec de vérification (réseau,
        #    PayDunya non configuré) laisse le record inchangé → traité comme
        #    toujours incertain ci-dessous.
        try:
            updated = await _maybe_recheck_disburse_status(payment)
        except Exception as exc:
            logger.warning(
                f"⚠️ Sweeper: re-vérification impossible (payment={payment_id}): {exc}"
            )
            updated = payment

        current = updated or payment
        current_status = current.get("payout_status")
        if current_status not in _STUCK_PAYOUT_STATUSES:
            summary["resolved"] += 1
            continue

        # 2) Toujours incertain : alerte au propriétaire UNE SEULE FOIS par
        #    paiement (champ owner_payout_alerted_at posé à la première
        #    alerte) si le blocage dépasse le seuil.
        summary["stuck"] += 1
        if current.get("owner_payout_alerted_at"):
            continue

        stuck_for = _stuck_for(current, now)
        if stuck_for is None or stuck_for < timedelta(hours=PAYOUT_ALERT_THRESHOLD_HOURS):
            continue

        amount = int(current.get("amount", 0) or 0)
        await notify_user_localized(
            user_id=OWNER_USER_ID,
            key="owner_payout_stuck_alert",
            notif_type=NotificationType.GENERAL,
            related_id=payment_id,
            related_type="payment",
            payment_id=payment_id,
            amount=amount,
            status=current_status,
            hours=int(stuck_for.total_seconds() // 3600),
        )
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"owner_payout_alerted_at": now.isoformat()}},
        )
        summary["alerted"] += 1

    if summary["rechecked"]:
        logger.info(f"🔍 Sweeper décaissements bloqués: {summary}")
    return summary


async def payout_stuck_sweeper_loop():
    """Tâche de fond : re-vérifie périodiquement les décaissements bloqués.

    Même modèle que _rate_limit_cleanup_loop (kojo_core) : boucle infinie,
    sommeil d'abord (pas de rafale de check-status PayDunya au redémarrage),
    annulable proprement au shutdown, erreurs isolées par itération.
    """
    while True:
        try:
            await asyncio.sleep(PAYOUT_SWEEPER_INTERVAL_MINUTES * 60)
            await payout_stuck_sweep_once()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur sweeper décaissements bloqués: {exc}")
