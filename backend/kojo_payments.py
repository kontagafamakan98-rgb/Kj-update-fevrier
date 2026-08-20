# -*- coding: utf-8 -*-
"""Intégration PayDunya : canaux, factures, statuts, décaissements."""

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests
from fastapi import HTTPException

from kojo_core import db
from kojo_settings import (
    BACKEND_PUBLIC_URL,
    FRONTEND_APP_URL,
    PAYDUNYA_MASTER_KEY,
    PAYDUNYA_MODE,
    PAYDUNYA_PRIVATE_KEY,
    PAYDUNYA_TOKEN,
    PAYDUNYA_DISBURSE_BASE_URL,
    PAYMENT_COMMISSION_RATE,
    logger,
)

PAYDUNYA_CHANNELS = {
    "orange_money": {
        "senegal": "orange-money-senegal",
        "mali": "orange-money-mali",
        "burkina_faso": "orange-money-burkina",
        "cote_divoire": "orange-money-ci"
    },
    "wave": {
        "senegal": "wave-senegal",
        "cote_divoire": "wave-ci"
    },
    "bank_card": {
        "default": "card"
    }
}

def normalize_payment_country(country: Optional[str]) -> str:
    value = (country or 'senegal').strip().lower()
    aliases = {
        'senegal': 'senegal',
        'sénégal': 'senegal',
        'mali': 'mali',
        'burkina': 'burkina_faso',
        'burkina-faso': 'burkina_faso',
        'burkina faso': 'burkina_faso',
        'burkina_faso': 'burkina_faso',
        'ivory coast': 'cote_divoire',
        'cote divoire': 'cote_divoire',
        "côte d'ivoire": 'cote_divoire',
        "cote d'ivoire": 'cote_divoire',
        'cote_d_ivoire': 'cote_divoire',
        'ivory_coast': 'cote_divoire'
    }
    return aliases.get(value, value.replace('-', '_').replace(' ', '_'))

def is_paydunya_configured() -> bool:
    return bool(PAYDUNYA_MASTER_KEY and PAYDUNYA_PRIVATE_KEY and PAYDUNYA_TOKEN)

def get_paydunya_base_url() -> str:
    if PAYDUNYA_MODE == 'live':
        return 'https://app.paydunya.com/api/v1'
    return 'https://app.paydunya.com/sandbox-api/v1'

def get_paydunya_headers() -> Dict[str, str]:
    return {
        'Content-Type': 'application/json',
        'PAYDUNYA-MASTER-KEY': PAYDUNYA_MASTER_KEY,
        'PAYDUNYA-PRIVATE-KEY': PAYDUNYA_PRIVATE_KEY,
        'PAYDUNYA-TOKEN': PAYDUNYA_TOKEN,
    }

async def get_effective_commission_rate() -> float:
    """Taux de commission EFFECTIF : db.settings (type=commission) s'il existe,
    sinon la constante d'environnement PAYMENT_COMMISSION_RATE.

    Le taux stocké en base est un POURCENTAGE (ex: 14 = 14%), la constante
    env est un décimal (ex: 0.14). Fail-safe : si la lecture DB échoue ou
    que la valeur est invalide, on retombe sur l'env.
    """
    try:
        doc = await db.settings.find_one({"type": "commission"})
        if doc and doc.get("commission_rate") is not None:
            rate_percent = float(doc["commission_rate"])
            if 0 <= rate_percent <= 50:
                return rate_percent / 100.0
            logger.warning(f"⚠️ Taux de commission en base invalide ({rate_percent}), repli env")
    except Exception as exc:
        logger.warning(f"⚠️ Lecture du taux de commission en base impossible, repli env: {exc}")
    return float(PAYMENT_COMMISSION_RATE)


def calculate_payment_breakdown(amount: float, commission_rate: Optional[float] = None) -> Dict[str, Any]:
    rate = commission_rate if commission_rate is not None else float(PAYMENT_COMMISSION_RATE)
    commission_amount = round(amount * rate)
    worker_amount = round(amount - commission_amount)
    return {
        'total_amount': round(amount),
        'commission_amount': commission_amount,
        'worker_amount': worker_amount,
        'commission_rate': round(rate * 100, 2)
    }

def get_paydunya_channel(payment_method: str, country: Optional[str]) -> str:
    payment_method = str(payment_method)
    normalized_country = normalize_payment_country(country)
    country_map = PAYDUNYA_CHANNELS.get(payment_method, {})

    if payment_method == 'bank_card':
        return country_map.get('default', 'card')

    channel = country_map.get(normalized_country)
    if channel:
        return channel

    supported = ', '.join(sorted(country_map.keys())) or 'none'
    raise HTTPException(
        status_code=400,
        detail=f"Méthode {payment_method} non disponible pour {normalized_country}. Pays supportés: {supported}"
    )

def build_checkout_redirect_url(fallback_path: str, explicit_url: Optional[str] = None) -> str:
    """URL de retour PayDunya.

    SECURITE : un explicit_url fourni par le client n'est accepté que s'il
    est relatif (chemin de l'app) ou s'il pointe vers l'origine du frontend
    (FRONTEND_APP_URL). Tout autre domaine (site de phishing) est rejeté et
    on retombe sur le fallback, pour éviter la redirection ouverte après
    paiement.
    """
    if explicit_url and explicit_url.strip():
        candidate = explicit_url.strip()
        if candidate.startswith('/'):
            return candidate
        try:
            parsed = urlparse(candidate)
            if parsed.scheme in ('http', 'https') and parsed.netloc:
                if FRONTEND_APP_URL and parsed.netloc == urlparse(FRONTEND_APP_URL).netloc:
                    return candidate
            # Protocoles non-http(s) (javascript:, data:...) : rejetés
        except ValueError:
            pass
    if FRONTEND_APP_URL:
        return f"{FRONTEND_APP_URL}{fallback_path}"
    return fallback_path

def build_payment_callback_url() -> str:
    if BACKEND_PUBLIC_URL:
        return f"{BACKEND_PUBLIC_URL}/api/payments/ipn/paydunya"
    return '/api/payments/ipn/paydunya'

def build_disburse_callback_url() -> str:
    if BACKEND_PUBLIC_URL:
        return f"{BACKEND_PUBLIC_URL}/api/payments/disburse-ipn"
    return '/api/payments/disburse-ipn'

def serialize_payment_record(record: Dict[str, Any]) -> Dict[str, Any]:
    serialized = dict(record)
    serialized.pop('_id', None)
    return serialized

def create_paydunya_invoice(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    endpoint = f"{get_paydunya_base_url()}/checkout-invoice/create"
    try:
        response = requests.post(endpoint, headers=get_paydunya_headers(), json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        logger.error(f"PayDunya create invoice error: {exc}")
        raise HTTPException(status_code=502, detail='Impossible de créer la session de paiement PayDunya')

    if str(data.get('response_code')) != '00':
        logger.error(f"PayDunya create invoice failed: {data}")
        response_text = data.get('response_text') or ''
        # Traduit les messages d'erreur PayDunya courants en messages
        # lisibles par l'utilisateur (plutôt que des messages techniques anglais).
        if 'Minimum checkout amount' in response_text or 'Total Amount' in response_text:
            user_message = "Le montant est trop faible pour être traité par PayDunya (minimum 200 FCFA)."
        elif 'Invalid' in response_text:
            user_message = "Données de paiement invalides. Vérifiez les informations et réessayez."
        elif response_text:
            user_message = f"Paiement refusé : {response_text}"
        else:
            user_message = "Création de paiement refusée par PayDunya."
        raise HTTPException(status_code=400, detail=user_message)

    return data

def confirm_paydunya_invoice(invoice_token: str) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    endpoint = f"{get_paydunya_base_url()}/checkout-invoice/confirm/{invoice_token}"
    try:
        response = requests.get(endpoint, headers=get_paydunya_headers(), timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        logger.error(f"PayDunya confirm invoice error: {exc}")
        raise HTTPException(status_code=502, detail='Impossible de vérifier le statut du paiement PayDunya')

def map_paydunya_status(raw_status: Optional[str]) -> str:
    normalized = str(raw_status or '').strip().lower()
    mapping = {
        'pending': 'pending',
        'created': 'pending',
        'completed': 'completed',
        'success': 'completed',
        'cancelled': 'cancelled',
        'canceled': 'cancelled',
        'failed': 'failed'
    }
    return mapping.get(normalized, 'pending')

async def sync_payment_status_with_paydunya(payment_record: Dict[str, Any]) -> Dict[str, Any]:
    invoice_token = payment_record.get('invoice_token')
    if not invoice_token or not is_paydunya_configured():
        return payment_record

    payload = confirm_paydunya_invoice(invoice_token)
    invoice_data = payload.get('invoice', {}) if isinstance(payload, dict) else {}
    provider_status = invoice_data.get('status') or payload.get('status')
    local_status = map_paydunya_status(provider_status)

    update_fields = {
        'status': local_status,
        'provider_status': provider_status,
        'provider_confirm_payload': payload,
        'updated_at': datetime.now(timezone.utc).isoformat()
    }

    if local_status == 'completed' and not payment_record.get('completed_at'):
        update_fields['completed_at'] = datetime.now(timezone.utc).isoformat()
        # payout_status suit l'etat du versement au TRAVAILLEUR, separement du
        # statut de la collecte. Initialise seulement s'il n'a jamais ete
        # defini, pour ne pas ecraser 'released'/'releasing' en cas de
        # reconfirmation d'un paiement deja traite plus loin dans le flux.
        if not payment_record.get('payout_status'):
            update_fields['payout_status'] = 'held'

    await db.payments.update_one({'id': payment_record['id']}, {'$set': update_fields})
    latest = await db.payments.find_one({'id': payment_record['id']})
    return latest or payment_record

def get_mobile_money_account(payment_accounts: Optional[Dict]) -> tuple:
    """Retourne (méthode, numéro) du compte mobile money à utiliser pour un
    décaissement PayDunya : Orange Money en priorité, sinon Wave (le compte
    bancaire n'est pas un mode de décaissement automatique supporté).

    Convention partagée par les versements travailleurs, les remboursements
    et les retraits de récompenses de parrainage."""
    accounts = payment_accounts or {}
    if accounts.get("orange_money"):
        return "orange_money", accounts["orange_money"]
    if accounts.get("wave"):
        return "wave", accounts["wave"]
    return None, None


def get_paydunya_withdraw_mode(payment_method: str, country: Optional[str]) -> str:
    """Reutilise exactement le meme mapping canal que la collecte : les
    valeurs (ex: 'orange-money-mali', 'wave-senegal') sont identiques cote
    PayDunya pour encaisser ET decaisser."""
    return get_paydunya_channel(payment_method, country)

def strip_country_code_for_disburse(phone: Optional[str]) -> str:
    """PayDunya attend le numero beneficiaire SANS indicatif pays pour le
    decaissement (ex: '771111111', pas '+221771111111')."""
    if not phone:
        return ""
    digits = re.sub(r'\D', '', str(phone))
    # Indicatifs des 4 pays prioritaires Kojo (Senegal, Mali, Burkina, CI)
    for code in ('221', '223', '226', '225'):
        if digits.startswith(code) and len(digits) > len(code):
            return digits[len(code):]
    # Deja sans indicatif, ou indicatif non reconnu : on renvoie tel quel
    return digits

def create_paydunya_disburse_invoice(account_alias: str, amount: float, withdraw_mode: str, callback_url: str) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    payload = {
        "account_alias": account_alias,
        "amount": round(amount),
        "withdraw_mode": withdraw_mode,
        "callback_url": callback_url,
    }
    try:
        response = requests.post(
            f"{PAYDUNYA_DISBURSE_BASE_URL}/get-invoice",
            headers=get_paydunya_headers(),
            json=payload,
            timeout=30
        )
        data = response.json()
    except requests.RequestException as exc:
        logger.error(f"PayDunya disburse get-invoice error: {exc}")
        raise HTTPException(status_code=502, detail="Impossible de préparer le versement PayDunya")
    except ValueError:
        logger.error("PayDunya disburse get-invoice: reponse non-JSON")
        raise HTTPException(status_code=502, detail="Réponse invalide de PayDunya lors de la préparation du versement")

    if str(data.get('response_code')) != '00' or not data.get('disburse_token'):
        logger.error(f"PayDunya disburse get-invoice failed: {data}")
        raise HTTPException(status_code=502, detail=data.get('response_text') or "Préparation du versement refusée par PayDunya")

    return data

def submit_paydunya_disburse_invoice(disburse_token: str, disburse_id: Optional[str] = None) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    payload = {"disburse_invoice": disburse_token}
    if disburse_id:
        payload["disburse_id"] = disburse_id

    try:
        response = requests.post(
            f"{PAYDUNYA_DISBURSE_BASE_URL}/submit-invoice",
            headers=get_paydunya_headers(),
            json=payload,
            timeout=30
        )
        data = response.json()
    except requests.RequestException as exc:
        logger.error(f"PayDunya disburse submit-invoice error: {exc}")
        raise HTTPException(status_code=502, detail="Impossible d'exécuter le versement PayDunya")
    except ValueError:
        logger.error("PayDunya disburse submit-invoice: reponse non-JSON")
        raise HTTPException(status_code=502, detail="Réponse invalide de PayDunya lors du versement")

    return data

def check_paydunya_disburse_status(disburse_token: str) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    try:
        response = requests.post(
            f"{PAYDUNYA_DISBURSE_BASE_URL}/check-status",
            headers=get_paydunya_headers(),
            json={"disburse_invoice": disburse_token},
            timeout=30
        )
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.error(f"PayDunya disburse check-status error: {exc}")
        raise HTTPException(status_code=502, detail="Impossible de vérifier le statut du versement PayDunya")
