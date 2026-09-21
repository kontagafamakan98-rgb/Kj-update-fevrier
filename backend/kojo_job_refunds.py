# -*- coding: utf-8 -*-
"""Remboursement PayDunya d'un paiement de mission — un seul propriétaire.

Extrait de `kojo_routers_jobs.py` sans changement de comportement. Trois
appelants : la suppression d'une mission, la suppression de compte
(`kojo_routers_users`) et l'administration (`kojo_routers_owner`). Il vivait
dans le routeur des missions, qui ne l'appelait qu'une fois sur trois.
"""
from datetime import datetime, timezone

from fastapi import HTTPException

import kojo_job_effects as effets
from kojo_core import db
from kojo_payments import (
    build_disburse_callback_url, get_paydunya_withdraw_mode, strip_country_code_for_disburse,
)
from kojo_settings import logger


async def execute_paydunya_refund(payment_record: dict) -> str:
    """Exécute le remboursement d'un paiement séquestré vers le compte mobile
    money du payeur (Orange Money en priorité, sinon Wave). Retourne le statut
    final : "refunded", "refunding" ou "refund_failed".

    Appelée par delete_job (annulation d'une mission payée) et par l'endpoint
    owner de relance (kojo_routers_owner.retry_payment_refund). Le verrou CAS
    (held/release_failed/refund_failed → refunding) est posé PAR LES APPELANTS
    avant l'appel — cette fonction n'exécute que le versement et les mises à
    jour de statut.

    Anti double-remboursement :
    - Un échec EXPLICITE (get-invoice refusé, réponse négative au submit) →
      "refund_failed" : PayDunya n'a rien exécuté, une relance est sûre.
    - Une réponse INCERTAINE (exception réseau pendant le submit) →
      "refunding" : PayDunya a peut-être exécuté le versement ; seule l'IPN
      ou un check-status pourra trancher. Marquer un échec définitif ici
      permettrait une relance → double remboursement.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    payer = await db.users.find_one({"id": payment_record.get("payer_id")})
    payer_accounts = (payer or {}).get("payment_accounts") or {}
    refund_method = None
    refund_phone = None
    if payer_accounts.get("orange_money"):
        refund_method, refund_phone = "orange_money", payer_accounts["orange_money"]
    elif payer_accounts.get("wave"):
        refund_method, refund_phone = "wave", payer_accounts["wave"]

    if not refund_method or not refund_phone:
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refund_failed", {"payout_failure_reason": "Le client n'a pas de compte Orange Money ou Wave configuré", "updated_at": now_iso})
        )
        return "refund_failed"

    try:
        withdraw_mode = get_paydunya_withdraw_mode(
            refund_method, (payer or {}).get("country")
        )
        account_alias = strip_country_code_for_disburse(refund_phone)
        invoice = effets.create_paydunya_disburse_invoice(
            account_alias=account_alias,
            amount=payment_record.get("amount") or 0,
            withdraw_mode=withdraw_mode,
            callback_url=build_disburse_callback_url(),
        )
        disburse_token = invoice.get("disburse_token")
    except HTTPException as exc:
        # get-invoice REFUSÉ : PayDunya n'a rien exécuté → échec sûr, relançable.
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refund_failed", {"payout_failure_reason": str(exc.detail), "updated_at": now_iso})
        )
        return "refund_failed"
    except Exception as exc:
        logger.error(f"⚠️ Erreur inattendue lors de la préparation du remboursement: {exc}")
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refund_failed", {"payout_failure_reason": "Erreur inattendue lors de la préparation du remboursement", "updated_at": now_iso})
        )
        return "refund_failed"

    # Token persisté AVANT le submit : si le submit lève (timeout réseau), le
    # paiement reste identifiable et confirmable via l'IPN ou un check-status.
    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "disburse_token": disburse_token,
            "payout_kind": "refund",
            "updated_at": now_iso,
        }}
    )

    try:
        submit_result = effets.submit_paydunya_disburse_invoice(
            disburse_token,
            disburse_id=f"refund_{payment_record['id']}",
        )
    except Exception as exc:
        # Réponse INCERTAINE : on reste "refunding" (à confirmer par l'IPN ou
        # check-status) plutôt que "refund_failed" — voir docstring.
        logger.error(f"⚠️ Réponse incertaine du submit PayDunya (remboursement): {exc}")
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refunding", {"disburse_error": f"Réponse incertaine du submit: {exc}", "updated_at": now_iso})
        )
        return "refunding"

    provider_status = str(
        submit_result.get("status")
        or ("success" if str(submit_result.get("response_code")) == "00" else "failed")
    ).strip().lower()

    await db.payments.update_one(
        {"id": payment_record["id"]},
        {"$set": {
            "disburse_provider_response": submit_result,
            "updated_at": now_iso,
        }}
    )

    if provider_status == "success":
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refunded")
        )
        return "refunded"
    if provider_status == "pending":
        await db.payments.update_one(
            {"id": payment_record["id"]},
            effets.maj_sequestre("refunding")
        )
        return "refunding"

    await db.payments.update_one(
        {"id": payment_record["id"]},
        effets.maj_sequestre("refund_failed", {"payout_failure_reason": submit_result.get("response_text") or "Échec du remboursement PayDunya"})
    )
    return "refund_failed"
