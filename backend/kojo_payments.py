# -*- coding: utf-8 -*-
"""Intégration PayDunya : canaux, factures, statuts, décaissements."""

import re
import time
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
    PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS,
    PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD,
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


# --- Circuit breaker GLOBAL PayDunya ---
# Si l'API PayDunya devient INJOIGNABLE (échecs réseau consécutifs : timeout,
# connexion refusée, réponse non-JSON), le circuit s'OUVRE : tous les appels
# sortants échouent IMMÉDIATEMENT (fail fast, ~0 ms) pendant la période de
# repos, au lieu de marteler une API down avec des timeouts de 30 s (qui
# gelaient l'event loop sur les flux asynchrones). Protège TOUS les flux :
# checkout (création de facture), re-vérification des décaissements (sweeper
# + polling /payments/status), IPN disburse, remboursements et retraits.
# Après le cooldown, un seul appel de sonde (half-open) décide de la
# réouverture (closed) ou de la prolongation (open). Un échec MÉTIER
# (response_code != '00', ex. montant refusé) n'ouvre PAS le circuit : c'est
# un refus de la requête, pas une panne fournisseur.
_paydunya_circuit = {
    "state": "closed",          # closed | open | half_open (effectif)
    "consecutive_failures": 0,
    "opened_at": 0.0,           # time.time() au moment de l'ouverture
}


def paydunya_circuit_state() -> dict:
    """État EFFECTIF du circuit breaker (lecture logs / métriques / owner).
    Le passage open → half_open (cooldown écoulé, UN appel de sonde autorisé)
    est calculé ici pour rester déterministe sans timer."""
    now = time.time()
    state = _paydunya_circuit["state"]
    remaining = 0.0
    if state == "open":
        remaining = _paydunya_circuit["opened_at"] + PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS - now
        if remaining <= 0:
            state = "half_open"
            remaining = 0.0
    return {
        "state": state,
        "consecutive_failures": _paydunya_circuit["consecutive_failures"],
        "failure_threshold": PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD,
        "cooldown_seconds": PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS,
        "remaining_cooldown_seconds": max(0.0, remaining),
    }


def is_paydunya_circuit_open() -> bool:
    """Vrai quand le circuit est OUVERT (fail fast — aucun appel réseau)."""
    return paydunya_circuit_state()["state"] == "open"


def _circuit_record_success() -> None:
    _paydunya_circuit.update({"state": "closed", "consecutive_failures": 0, "opened_at": 0.0})


def _circuit_record_failure() -> None:
    _paydunya_circuit["consecutive_failures"] += 1
    if _paydunya_circuit["consecutive_failures"] >= PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD:
        _paydunya_circuit["state"] = "open"
        _paydunya_circuit["opened_at"] = time.time()
        logger.error(
            f"🚨 Circuit breaker PayDunya OUVERT : {PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD} échecs réseau "
            f"consécutifs — appels PayDunya suspendus "
            f"{PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS // 3600} h (fail fast)."
        )


def _paydunya_call(method: str, url: str, *, json: Optional[Dict[str, Any]] = None, timeout: int = 30) -> Dict[str, Any]:
    """Appel HTTP PayDunya protégé par le circuit breaker GLOBAL (point unique
    de toutes les requêtes sortantes : checkout, confirm, get-invoice,
    submit-invoice, check-status).

    - Circuit OPEN → requests.ConnectionError immédiate (fail fast, ~0 ms) :
      tous les appelants la convertissent en 502 SANS toucher le réseau — le
      checkout, l'IPN disburse et le sweeper ne martèlent plus une API down
      et ne gèlent plus l'event loop sur des timeouts de 30 s.
    - Échec RÉSEAU (RequestException / réponse non-JSON) → compté ; au-delà du
      seuil, le circuit passe OPEN pour la durée du cooldown.
    - Réussite HTTP (y compris response_code != '00', refus MÉTIER) → circuit
      refermé : le fournisseur répond, ce n'est pas une panne.
    """
    if is_paydunya_circuit_open():
        raise requests.ConnectionError(
            "PayDunya circuit breaker ouvert — appels suspendus "
            f"{PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS // 3600} h (fail fast)"
        )
    try:
        response = requests.request(method, url, headers=get_paydunya_headers(), json=json, timeout=timeout)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        _circuit_record_failure()
        raise
    _circuit_record_success()
    return data

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

# Champs fournisseur/payloads bruts JAMAIS exposés via l'API : ils peuvent
# contenir des données client (email, téléphone), du texte d'erreur interne
# ou des jetons PayDunya. Les endpoints /payments/status/* et /payments/my
# renvoient le statut métier (status, payout_status, montants...), pas ces
# détails bruts — le serveur les lit toujours depuis la base (IPN, recheck).
PROVIDER_SENSITIVE_FIELDS = {
    "provider_confirm_payload",
    "provider_response_text",
    "disburse_token",
    "disburse_provider_response",
    "disburse_verified_payload",
    "disburse_callback_payload",
    "disburse_error",
}


def serialize_payment_record(record: Dict[str, Any]) -> Dict[str, Any]:
    serialized = dict(record)
    serialized.pop('_id', None)
    for field in PROVIDER_SENSITIVE_FIELDS:
        serialized.pop(field, None)
    return serialized

def create_paydunya_invoice(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas configuré sur le serveur")

    endpoint = f"{get_paydunya_base_url()}/checkout-invoice/create"
    try:
        data = _paydunya_call("POST", endpoint, json=payload)
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
        return _paydunya_call("GET", endpoint)
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
        data = _paydunya_call("POST", f"{PAYDUNYA_DISBURSE_BASE_URL}/get-invoice", json=payload)
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
        data = _paydunya_call("POST", f"{PAYDUNYA_DISBURSE_BASE_URL}/submit-invoice", json=payload)
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
        return _paydunya_call(
            "POST",
            f"{PAYDUNYA_DISBURSE_BASE_URL}/check-status",
            json={"disburse_invoice": disburse_token},
        )
    except (requests.RequestException, ValueError) as exc:
        logger.error(f"PayDunya disburse check-status error: {exc}")
        raise HTTPException(status_code=502, detail="Impossible de vérifier le statut du versement PayDunya")
