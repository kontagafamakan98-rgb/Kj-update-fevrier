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

from kojo_core import db, resolve_owner_id
from kojo_email import send_email_via_brevo_api
from kojo_models import NotificationType
from kojo_settings import (
    OWNER_EMAIL,
    OWNER_USER_ID,
    PAYOUT_ALERT_REMINDER_DAYS,
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
# Circuit breaker GLOBAL PayDunya (kojo_payments) : quand il est OUVERT, les
# re-vérifications sont SUSPENDUES (elles échoueraient de toute façon en fail
# fast) — on ne martèle pas une API down — mais l'escalade continue.
from kojo_payments import paydunya_circuit_state

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

    # Circuit breaker GLOBAL PayDunya : quand il est OUVERT, on ne lance AUCUNE
    # re-vérification (chaque check-status échouerait en fail fast ~0 ms) — on
    # évite même la boucle de per-payment inutile. L'escalade (étape 2) reste
    # active : le propriétaire doit savoir que les décaissements restent
    # incertains pendant la panne PayDunya.
    circuit = paydunya_circuit_state()
    circuit_open = circuit["state"] == "open"
    if circuit_open:
        logger.warning(
            f"🔌 Sweeper décaissements bloqués: circuit breaker PayDunya OUVERT — "
            f"re-vérifications suspendues (cooldown restant ~"
            f"{int(circuit['remaining_cooldown_seconds'] // 3600)} h), escalade maintenue."
        )

    for payment in payments:
        payment_id = payment.get("id")
        if not payment_id:
            continue

        # 1) Re-vérification PayDunya : si l'IPN n'est jamais arrivée, le
        #    check-status peut trancher (success → released/refunded, échec →
        #    release_failed/refund_failed). Un échec de vérification (réseau,
        #    PayDunya non configuré) laisse le record inchangé → traité comme
        #    toujours incertain ci-dessous. SUSPENDUE quand le circuit est
        #    ouvert (fail fast systématique — on ne martèle pas une API down).
        if circuit_open:
            updated = payment
        else:
            summary["rechecked"] += 1
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

        # 2) Toujours incertain : alerte au propriétaire si le blocage dépasse
        #    le seuil, puis RAPPEL périodique tant que le blocage dure
        #    (escalade — PayDunya injoignable plusieurs jours ne doit pas
        #    rester silencieux après la première alerte). owner_payout_alerted_at
        #    est décalé à chaque rappel → rappel espacé, pas de spam.
        summary["stuck"] += 1
        alerted_at = _parse_payment_ts(current.get("owner_payout_alerted_at"))
        stuck_for = _stuck_for(current, now)
        if alerted_at is not None:
            if now - alerted_at < timedelta(days=PAYOUT_ALERT_REMINDER_DAYS):
                continue
        elif stuck_for is None or stuck_for < timedelta(hours=PAYOUT_ALERT_THRESHOLD_HOURS):
            continue

        amount = int(current.get("amount", 0) or 0)
        hours_stuck = int(stuck_for.total_seconds() // 3600)
        is_reminder = alerted_at is not None
        # Résolution du compte owner RÉEL par email (source de vérité) : en
        # prod, l'id du compte ne correspond pas au secret OWNER_USER_ID (id
        # fantôme) et les notifications ciblées par le secret étaient perdues.
        owner_id = await resolve_owner_id() or OWNER_USER_ID
        await notify_user_localized(
            user_id=owner_id,
            key="owner_payout_stuck_alert",
            notif_type=NotificationType.GENERAL,
            related_id=payment_id,
            related_type="payment",
            payment_id=payment_id,
            amount=amount,
            status=current_status,
            hours=hours_stuck,
        )
        # Fallback EMAIL : le compte owner n'a aucun push token web enregistré
        # en prod → la notification in-app/push peut ne jamais être vue. L'email
        # Brevo (best-effort, comme les tickets support) garantit que l'alerte
        # atteint Famakan dans tous les cas.
        if OWNER_EMAIL:
            try:
                subject = (
                    "KOJO — Décaissement toujours bloqué (rappel)"
                    if is_reminder
                    else "KOJO — Alerte décaissement bloqué"
                )
                send_email_via_brevo_api(
                    OWNER_EMAIL,
                    subject,
                    f"Un décaissement reste bloqué depuis plus de {PAYOUT_ALERT_THRESHOLD_HOURS} h.\n"
                    f"Paiement : {payment_id}\n"
                    f"Montant : {amount} FCFA\n"
                    f"Statut : {current_status}\n"
                    f"Bloqué depuis : {hours_stuck} h\n\n"
                    f"Consultez /api/owner/stuck-payouts pour le détail et /owner/retry-refund "
                    f"pour relancer un remboursement.",
                )
            except Exception as exc:
                logger.warning(f"⚠️ Email alerte owner échoué: {exc}")
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
