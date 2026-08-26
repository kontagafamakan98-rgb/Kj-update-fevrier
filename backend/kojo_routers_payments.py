import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Request

from kojo_core import db
from kojo_models import (
    NotificationType, PaymentCheckoutRequest, PaymentQuoteRequest,
    User,
)
from kojo_settings import (
    FAMAKAN_OWNER_EMAIL,
    OWNER_EMAIL,
    PAYDUNYA_MODE,
    PAYDUNYA_STORE_NAME,
    logger,
)
from kojo_core import (
    get_current_user,
)
from kojo_shared import (
    apply_referral_payout_confirmed, notify_user_localized, _dispatch_address_to_worker,
)
from kojo_payments import (
    PAYDUNYA_CHANNELS,
    build_checkout_redirect_url, build_payment_callback_url,
    calculate_payment_breakdown, check_paydunya_disburse_status,
    create_paydunya_invoice, get_effective_commission_rate,
    get_paydunya_channel, is_paydunya_configured,
    normalize_payment_country, serialize_payment_record,
    sync_payment_status_with_paydunya,
)

router = APIRouter()


def _append_query_param(url: str, key: str, value: str) -> str:
    """Ajoute un paramètre de requête à une URL sans écraser les existants."""
    if not url:
        return url
    try:
        parts = urlparse(url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query[key] = value
        return urlunparse(parts._replace(query=urlencode(query)))
    except ValueError:
        return url


# Cache court du statut re-vérifié auprès de PayDunya : chaque GET
# /payments/status/* déclenche un appel sortant coûteux — on ne le refait
# pas plus d'une fois toutes les 15 s par paiement (les transitions réelles
# sont de toute façon poussées par l'IPN).
PAYMENT_STATUS_CACHE_TTL_SECONDS = 15
_payment_status_cache: dict = {}


def _get_cached_payment_status(payment_id: str):
    cached = _payment_status_cache.get(payment_id)
    if cached and (time.time() - cached["at"]) < PAYMENT_STATUS_CACHE_TTL_SECONDS:
        return cached["record"]
    return None


def _cache_payment_status(payment_id: str, record: dict):
    now = time.time()
    _payment_status_cache[payment_id] = {"at": now, "record": record}
    # Garde-fou : purge les entrées expirées si le cache grossit trop
    if len(_payment_status_cache) > 2000:
        expired = [pid for pid, entry in _payment_status_cache.items() if now - entry["at"] > PAYMENT_STATUS_CACHE_TTL_SECONDS]
        for pid in expired:
            _payment_status_cache.pop(pid, None)


async def _notify_refund_transition(payment_record: dict, previous_status, new_status):
    """Notifie le client quand un remboursement en attente est tranché par
    PayDunya (confirmé ou en échec). Utilisé par l'IPN disburse ET par la
    re-vérification à la demande — les notifications envoyées au moment de
    l'annulation ne couvrent que le départ, pas la confirmation finale."""
    if payment_record.get("payout_kind") != "refund":
        return
    if new_status == previous_status or new_status not in ("refunded", "refund_failed"):
        return
    if new_status == "refunded" and previous_status not in ("refunding", "refund_failed"):
        return
    refund_amount = int(payment_record.get("amount", 0) or 0)
    if new_status == "refunded":
        refund_key = "refund_confirmed"
    else:
        refund_key = "refund_failed"
    asyncio.create_task(notify_user_localized(
        user_id=payment_record.get("payer_id"),
        key=refund_key,
        notif_type=NotificationType.GENERAL,
        related_id=payment_record.get("job_id") or None,
        related_type="job" if payment_record.get("job_id") else None,
        amount=refund_amount,
    ))


# Intervalle minimum entre deux re-vérifications PayDunya du MÊME décaissement
# en attente (le GET /payments/status peut être pollé par le frontend).
DISBURSE_RECHECK_INTERVAL_SECONDS = 60
_disburse_recheck_at: dict = {}

# BACKOFF quand PayDunya est INJOIGNABLE : on ne martèle pas une API down.
# Après un échec, le cooldown double à chaque échec consécutif du même
# paiement (1 h, 2 h, 4 h… plafonné à 6 h) et se réinitialise dès qu'un
# check réussit. Sans ça, un sweep horaire + un polling /payments/status
# re-tentaient chaque paiement bloqué indéfiniment (spam réseau + logs).
DISBURSE_RECHECK_BACKOFF_BASE_SECONDS = 60 * 60
DISBURSE_RECHECK_BACKOFF_MAX_SECONDS = 6 * 3600
_disburse_recheck_failures: dict = {}


async def _maybe_recheck_disburse_status(payment_record: dict) -> dict:
    """Best-effort : re-vérifie auprès de PayDunya le statut d'un décaissement
    en attente (refunding/releasing). L'IPN peut ne jamais arriver (callback
    manquant, erreur réseau) : sans cette relance, un remboursement ou un
    versement "en cours" resterait bloqué indéfiniment côté suivi.

    Même mapping que l'IPN disburse (payout_kind == "refund" → statuts
    refunded/refunding/refund_failed, sinon released/releasing/release_failed).
    Retourne le record éventuellement mis à jour."""
    payout_status = payment_record.get("payout_status")
    if payout_status not in ("refunding", "releasing"):
        return payment_record
    payment_id = payment_record.get("id")
    if not payment_id:
        return payment_record

    now = time.time()
    # Purge des traces in-memory expirées (garde-fou anti-fuite : le polling
    # /payments/status peut référencer des milliers de paiements au fil du
    # temps, on ne garde que les entrées de la fenêtre de backoff max).
    if len(_disburse_recheck_at) > 2000:
        cutoff = now - DISBURSE_RECHECK_BACKOFF_MAX_SECONDS
        stale = [pid for pid, ts in _disburse_recheck_at.items() if ts < cutoff]
        for pid in stale:
            _disburse_recheck_at.pop(pid, None)
            _disburse_recheck_failures.pop(pid, None)

    failures = _disburse_recheck_failures.get(payment_id, 0)
    if failures:
        backoff = min(
            DISBURSE_RECHECK_BACKOFF_BASE_SECONDS * (2 ** (failures - 1)),
            DISBURSE_RECHECK_BACKOFF_MAX_SECONDS,
        )
        if now - _disburse_recheck_at.get(payment_id, 0) < backoff:
            return payment_record
    elif _disburse_recheck_at.get(payment_id, 0) > now - DISBURSE_RECHECK_INTERVAL_SECONDS:
        return payment_record
    _disburse_recheck_at[payment_id] = now

    disburse_token = payment_record.get("disburse_token")
    if not disburse_token:
        return payment_record
    try:
        # check_paydunya_disburse_status est SYNCHRONE (requests, timeout
        # 30 s) : on le sort de l'event loop via to_thread, sinon N paiements
        # bloqués × 30 s de timeout gelaient toute l'API quand PayDunya est
        # injoignable.
        check_result = await asyncio.to_thread(
            check_paydunya_disburse_status, disburse_token
        )
    except Exception as exc:
        # Échec (PayDunya down / réseau) : on compte l'échec pour allonger le
        # backoff du prochain retry de CE paiement.
        _disburse_recheck_failures[payment_id] = failures + 1
        logger.warning(f"⚠️ Re-vérification décaissement impossible: {exc}")
        return payment_record

    # Le check a répondu (même "pending") : backoff réinitialisé.
    _disburse_recheck_failures.pop(payment_id, None)

    provider_status = str(
        check_result.get("status")
        or ("success" if str(check_result.get("response_code")) == "00" else "")
    ).strip().lower()
    if not provider_status:
        return payment_record

    is_refund = payment_record.get("payout_kind") == "refund"
    if provider_status == "success":
        new_status = "refunded" if is_refund else "released"
    elif provider_status == "pending":
        new_status = "refunding" if is_refund else "releasing"
    else:
        new_status = "refund_failed" if is_refund else "release_failed"

    if new_status == payout_status:
        return payment_record

    await db.payments.update_one(
        {"id": payment_id},
        {"$set": {
            "payout_status": new_status,
            "disburse_verified_payload": check_result,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    updated = await db.payments.find_one({"id": payment_id})
    if updated:
        await _notify_refund_transition(payment_record, payout_status, new_status)
        # Retrait de récompenses confirmé par check-status → décrémenter le solde
        # et lever le verrou anti double-retrait (point unique kojo_shared).
        await apply_referral_payout_confirmed(updated)
        return updated
    return payment_record


@router.post('/payments/disburse-ipn')
async def paydunya_disburse_ipn(request: Request):
    """Callback asynchrone PayDunya pour confirmer le statut final d'un
    versement (utile notamment quand submit-invoice a renvoye 'pending').

    SECURITE: comme pour l'IPN de collecte, on ne fait pas confiance au
    statut envoyé dans le payload du callback - on reconfirme auprès de
    PayDunya via check-status, en utilisant le disburse_token retrouvé côté
    serveur (jamais celui du payload) pour identifier quel enregistrement
    mettre à jour.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    disburse_token_hint = payload.get('token') or payload.get('disburse_invoice')
    if not disburse_token_hint:
        return {'status': 'ignored'}

    payment_record = await db.payments.find_one({'disburse_token': disburse_token_hint})
    if not payment_record:
        return {'status': 'ignored'}

    # Le disburse_token utilisé pour la vérification vient TOUJOURS de
    # l'enregistrement trouvé en base, pas du payload reçu.
    real_disburse_token = payment_record.get('disburse_token')
    try:
        # Synchrone (requests) : to_thread pour ne pas bloquer l'event loop.
        check_result = await asyncio.to_thread(
            check_paydunya_disburse_status, real_disburse_token
        )
    except Exception as exc:
        logger.error(f"⚠️ Échec de vérification IPN décaissement PayDunya: {exc}")
        return {'status': 'error', 'detail': 'verification failed'}

    # Meme convention de parsing que submit_paydunya_disburse_invoice (deja
    # utilisee ailleurs dans ce fichier pour cette meme famille d'API PayDunya).
    provider_status = str(
        check_result.get("status")
        or ("success" if str(check_result.get("response_code")) == "00" else "")
    ).strip().lower()

    # Le meme endpoint IPN sert au versement TRAVAILLEUR et au REMBOURSEMENT
    # client (meme API de decaissement PayDunya) : le mapping de statut doit
    # dependre de payout_kind, sinon un remboursement en attente confirme ici
    # serait marque 'released' (verse au travailleur) au lieu de 'refunded'.
    is_refund = payment_record.get("payout_kind") == "refund"
    if provider_status == 'success':
        payout_status = 'refunded' if is_refund else 'released'
    elif provider_status == 'pending':
        payout_status = 'refunding' if is_refund else 'releasing'
    elif provider_status:
        payout_status = 'refund_failed' if is_refund else 'release_failed'
    else:
        # Reponse PayDunya inattendue/non concluante: on ne change rien
        # plutot que de deviner, un prochain check-status/IPN confirmera.
        return {'status': 'inconclusive'}

    previous_payout_status = payment_record.get('payout_status')
    await db.payments.update_one(
        {'id': payment_record['id']},
        {'$set': {
            'payout_status': payout_status,
            'disburse_callback_payload': payload,
            'disburse_verified_payload': check_result,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }}
    )

    # Notifier le client quand l'IPN tranche un remboursement en attente
    # (les notifications de l'annulation ne couvrent que le depart).
    await _notify_refund_transition(payment_record, previous_payout_status, payout_status)

    # Retrait de récompenses confirmé par l'IPN → décrémenter le solde du
    # travailleur et lever le verrou anti double-retrait (point unique
    # kojo_shared.apply_referral_payout_confirmed, idempotent).
    updated_record = await db.payments.find_one({'id': payment_record['id']})
    if updated_record:
        await apply_referral_payout_confirmed(updated_record)

    return {'status': 'ok'}

@router.get('/payments/config')
async def get_real_payments_config():
    return {
        'provider': 'paydunya',
        'configured': is_paydunya_configured(),
        'mode': PAYDUNYA_MODE,
        'commission_rate_percent': round((await get_effective_commission_rate()) * 100, 2),
        'supported_channels': {
            'orange_money': list(PAYDUNYA_CHANNELS['orange_money'].keys()),
            'wave': list(PAYDUNYA_CHANNELS['wave'].keys()),
            'bank_card': ['all']
        }
    }

@router.post('/payments/quote')
async def get_payment_quote(request: PaymentQuoteRequest):
    channel = get_paydunya_channel(request.payment_method.value, request.country)
    rate = await get_effective_commission_rate()
    breakdown = calculate_payment_breakdown(request.amount, rate)
    return {
        'provider': 'paydunya',
        'configured': is_paydunya_configured(),
        'channel': channel,
        'country': normalize_payment_country(request.country),
        'payment_method': request.payment_method.value,
        **breakdown
    }

@router.post('/payments/checkout')
async def create_real_payment_checkout(request: PaymentCheckoutRequest, current_user: User = Depends(get_current_user)):
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas encore configuré en production")

    # SECURITE: le montant, le job et le travailleur ne sont plus pris tels
    # quels depuis la requête client (n'importe quel utilisateur pouvait
    # auparavant envoyer un montant arbitraire, sans rapport avec le prix
    # réellement convenu sur la mission). Un paiement doit être RATTACHÉ à
    # une mission (job_id obligatoire) : un paiement "libre" n'aurait ni
    # destinataire, ni escrow, ni chemin de versement — l'argent serait
    # collecté sans suite possible.
    if not request.job_id:
        raise HTTPException(
            status_code=400,
            detail="Un paiement doit être rattaché à une mission. Ouvrez la mission depuis la liste des emplois pour la payer."
        )

    resolved_amount = request.amount
    resolved_worker_id = request.worker_id or ''

    job = await db.jobs.find_one({"id": request.job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Mission introuvable")

    # Idempotence : un paiement PENDING déjà existant pour (job, payeur)
    # est renvoyé tel quel (même facture) au lieu d'en créer un second —
    # protège d'un double-clic ou d'un retry réseau qui créait 2 factures.
    existing_pending = await db.payments.find_one({
        "job_id": request.job_id,
        "payer_id": current_user.id,
        "status": "pending",
    })
    if existing_pending and existing_pending.get("checkout_url"):
        breakdown = calculate_payment_breakdown(existing_pending.get("amount") or 0, await get_effective_commission_rate())
        return {
            "status": "success",
            "provider": "paydunya",
            "payment_id": existing_pending["id"],
            "invoice_token": existing_pending.get("invoice_token"),
            "checkout_url": existing_pending.get("checkout_url"),
            "payment_method": existing_pending.get("payment_method"),
            "channel": existing_pending.get("provider_channel"),
            "reused": True,
            **breakdown
        }

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if job.get("client_id") != current_user.id and not is_owner_user:
        raise HTTPException(status_code=403, detail="Seul le client de l'origine de cette mission peut lancer son paiement")

    assigned_worker_id = job.get("assigned_worker_id")
    if not assigned_worker_id:
        raise HTTPException(status_code=400, detail="Aucun travailleur n'a encore été attribué à cette mission")
    resolved_worker_id = assigned_worker_id

    accepted_proposal_id = job.get("accepted_proposal_id")
    accepted_proposal = (
        await db.job_proposals.find_one({"id": accepted_proposal_id, "job_id": request.job_id})
        if accepted_proposal_id else None
    )
    # Supporte les deux noms de champ utilisés selon les versions :
    # "proposed_amount" (nouveau) et "amount" (ancien format).
    proposal_amount = None
    if accepted_proposal:
        raw = accepted_proposal.get("proposed_amount") or accepted_proposal.get("amount")
        if raw:
            try:
                proposal_amount = float(raw)
            except (TypeError, ValueError):
                pass

    if proposal_amount and proposal_amount > 0:
        resolved_amount = proposal_amount
    elif job.get("budget_max") or job.get("budget_min"):
        # Filet de sécurité : pas de proposition trouvée ou montant invalide →
        # on utilise le budget du job plutôt que l'input client.
        resolved_amount = float(job.get("budget_max") or job.get("budget_min"))
    elif resolved_amount and resolved_amount >= 200:
        # Dernier recours : le frontend a passé un montant valide, on l'accepte
        # uniquement s'il est >= 200 FCFA (minimum PayDunya).
        pass
    else:
        raise HTTPException(status_code=400, detail="Impossible de déterminer le montant à payer pour cette mission. Vérifiez que la proposition a bien un montant.")

    normalized_country = normalize_payment_country(request.country or current_user.country)
    channel = get_paydunya_channel(request.payment_method.value, normalized_country)
    rate = await get_effective_commission_rate()
    breakdown = calculate_payment_breakdown(resolved_amount, rate)

    # Validation du montant minimum PayDunya (200 FCFA) AVANT de créer
    # l'enregistrement en base et d'appeler l'API — évite de créer un
    # payment_record "pending" orphelin qu'on ne pourra jamais compléter,
    # et renvoie un 400 lisible au lieu d'un 502 cryptique.
    PAYDUNYA_MINIMUM_AMOUNT = 200
    if round(resolved_amount) < PAYDUNYA_MINIMUM_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Le montant minimum pour un paiement est de {PAYDUNYA_MINIMUM_AMOUNT} FCFA "
                   f"(montant envoyé : {round(resolved_amount)} FCFA)."
        )

    payment_record = {
        'id': str(uuid.uuid4()),
        'job_id': request.job_id,
        'payer_id': current_user.id,
        'receiver_id': resolved_worker_id,
        'amount': round(resolved_amount),
        'payment_method': request.payment_method.value,
        'status': 'pending',
        'country': normalized_country,
        'provider': 'paydunya',
        'provider_channel': channel,
        'commission_amount': breakdown['commission_amount'],
        'worker_amount': breakdown['worker_amount'],
        'idempotency_key': request.idempotency_key or None,
        # TTL : les factures PENDING jamais terminées sont purgées par
        # l'index expireAfterSeconds après 48h (voir kojo_core).
        'expires_at': (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(),
        'created_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }

    await db.payments.insert_one(payment_record)

    return_url = build_checkout_redirect_url(f"/payment?payment_id={payment_record['id']}", request.return_url)
    cancel_url = build_checkout_redirect_url(f"/payment?payment_id={payment_record['id']}&cancelled=1", request.cancel_url)

    # UX : même quand le frontend fournit un return_url/cancel_url explicite
    # (ex: `${origin}/payment`), on y ajoute payment_id (+ cancelled) pour
    # que la page /payment puisse afficher le statut au retour de PayDunya.
    # Sans ça, le return_url explicite écrasait l'identifiant ajouté par le
    # backend et l'utilisateur atterrissait sur une page vide de statut.
    return_url = _append_query_param(return_url, "payment_id", payment_record["id"])
    cancel_url = _append_query_param(cancel_url, "payment_id", payment_record["id"])
    if request.cancel_url:
        cancel_url = _append_query_param(cancel_url, "cancelled", "1")

    callback_url = build_payment_callback_url()

    # Phone du customer PayDunya : le champ phone du User peut être vide pour
    # un compte créé via Google (SSO — Google ne fournit pas de numéro). On
    # retombe alors sur le numéro de son compte mobile money (orange_money ou
    # wave) : PayDunya exige un numéro pour le customer, et le client vérifié
    # a forcément un compte mobile money lié.
    customer_phone = (current_user.phone or "").strip()
    if not customer_phone:
        accounts = (current_user.payment_accounts or {})
        customer_phone = str(
            accounts.get("orange_money") or accounts.get("wave") or ""
        ).strip()

    payload = {
        'invoice': {
            'total_amount': payment_record['amount'],
            'description': f"Paiement KOJO {payment_record['id']}",
            'channels': [channel],
            'customer': {
                'name': f"{current_user.first_name} {current_user.last_name}".strip(),
                'email': current_user.email,
                'phone': customer_phone
            }
        },
        'store': {
            'name': PAYDUNYA_STORE_NAME
        },
        'actions': {
            'cancel_url': cancel_url,
            'return_url': return_url,
            'callback_url': callback_url
        },
        'custom_data': {
            'payment_id': payment_record['id'],
            'job_id': payment_record['job_id'],
            'worker_id': payment_record['receiver_id'],
            'payer_id': payment_record['payer_id'],
            'selected_method': payment_record['payment_method']
        }
    }

    invoice_data = create_paydunya_invoice(payload)
    invoice_token = invoice_data.get('token')
    checkout_url = invoice_data.get('response_text')

    await db.payments.update_one(
        {'id': payment_record['id']},
        {'$set': {
            'invoice_token': invoice_token,
            'checkout_url': checkout_url,
            'provider_response_code': invoice_data.get('response_code'),
            'provider_response_text': invoice_data.get('response_text'),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }}
    )

    return {
        'status': 'success',
        'provider': 'paydunya',
        'payment_id': payment_record['id'],
        'invoice_token': invoice_token,
        'checkout_url': checkout_url,
        'payment_method': payment_record['payment_method'],
        'channel': channel,
        **breakdown
    }

@router.get('/payments/status/{payment_id}')
async def get_payment_status(payment_id: str, current_user: User = Depends(get_current_user)):
    payment_record = await db.payments.find_one({'id': payment_id})
    if not payment_record:
        raise HTTPException(status_code=404, detail='Paiement introuvable')

    if current_user.id not in {payment_record.get('payer_id'), payment_record.get('receiver_id')} and current_user.email != FAMAKAN_OWNER_EMAIL:
        raise HTTPException(status_code=403, detail='Accès interdit à ce paiement')

    cached_record = _get_cached_payment_status(payment_record['id'])
    if cached_record is not None:
        payment_record = cached_record
    else:
        payment_record = await sync_payment_status_with_paydunya(payment_record)
        _cache_payment_status(payment_record['id'], payment_record)

    # Relance des décaissements en attente : l'IPN peut ne jamais arriver
    # (callback manquant), on re-vérifie donc le statut à la demande.
    payment_record = await _maybe_recheck_disburse_status(payment_record)
    if payment_record is not cached_record:
        _cache_payment_status(payment_record['id'], payment_record)
    return serialize_payment_record(payment_record)

@router.get('/payments/status/token/{invoice_token}')
async def get_payment_status_by_token(invoice_token: str, current_user: User = Depends(get_current_user)):
    payment_record = await db.payments.find_one({'invoice_token': invoice_token})
    if not payment_record:
        raise HTTPException(status_code=404, detail='Paiement introuvable')

    if current_user.id not in {payment_record.get('payer_id'), payment_record.get('receiver_id')} and current_user.email != FAMAKAN_OWNER_EMAIL:
        raise HTTPException(status_code=403, detail='Accès interdit à ce paiement')

    cached_record = _get_cached_payment_status(payment_record['id'])
    if cached_record is not None:
        payment_record = cached_record
    else:
        payment_record = await sync_payment_status_with_paydunya(payment_record)
        _cache_payment_status(payment_record['id'], payment_record)

    # Relance des décaissements en attente : l'IPN peut ne jamais arriver
    # (callback manquant), on re-vérifie donc le statut à la demande.
    payment_record = await _maybe_recheck_disburse_status(payment_record)
    if payment_record is not cached_record:
        _cache_payment_status(payment_record['id'], payment_record)
    return serialize_payment_record(payment_record)

@router.get('/payments/my')
async def get_my_payments(current_user: User = Depends(get_current_user)):
    cursor = db.payments.find({'$or': [{'payer_id': current_user.id}, {'receiver_id': current_user.id}]}).sort('created_at', -1).limit(50)
    payments = [serialize_payment_record(item) async for item in cursor]
    return {'payments': payments}

@router.post('/payments/ipn/paydunya')
async def paydunya_payment_ipn(request: Request):
    """
    Callback IPN PayDunya (endpoint public, non authentifié - c'est le
    fonctionnement normal d'un webhook).

    SECURITE: on ne fait JAMAIS confiance au statut envoyé dans le payload
    reçu ici - n'importe qui connaissant/obtenant un payment_id ou
    invoice_token (ex: le payeur lui-même, à qui ces valeurs sont
    légitimement renvoyées lors du checkout) pourrait sinon forger une
    requête déclarant un paiement "completed" sans jamais avoir payé, ce
    qui débloquerait ensuite un vrai décaissement vers le travailleur.
    Le payload ne sert donc qu'à IDENTIFIER quel paiement re-vérifier ; le
    statut réel est systématiquement reconfirmé auprès de l'API PayDunya
    elle-même via sync_payment_status_with_paydunya(), à partir du
    invoice_token stocké côté serveur (jamais celui du payload).
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    invoice_data = payload.get('invoice', {}) if isinstance(payload, dict) else {}
    custom_data = payload.get('custom_data', {}) if isinstance(payload, dict) else {}
    payment_id = custom_data.get('payment_id') or payload.get('payment_id')
    invoice_token_hint = invoice_data.get('token') or payload.get('token')

    query = {'id': payment_id} if payment_id else ({'invoice_token': invoice_token_hint} if invoice_token_hint else None)
    payment_record = await db.payments.find_one(query) if query else None
    if not payment_record:
        return {'status': 'ignored'}

    previous_status = payment_record.get('status')

    try:
        payment_record = await sync_payment_status_with_paydunya(payment_record)
    except Exception as exc:
        logger.error(f"⚠️ Échec de vérification IPN PayDunya auprès du serveur: {exc}")
        return {'status': 'error', 'detail': 'verification failed'}

    local_status = payment_record.get('status')

    # Notifications push seulement lors de la transition VERS completed, pas
    # à chaque IPN en double (PayDunya peut renvoyer plusieurs callbacks
    # pour le même événement).
    if local_status == 'completed' and previous_status != 'completed':
        job_id_for_notif = payment_record.get('job_id') or ''
        amount_for_notif = int(payment_record.get('amount', 0) or 0)
        payer_id = payment_record.get('payer_id')
        receiver_id = payment_record.get('receiver_id')

        # Récupérer le titre du job si disponible
        job_title = "la mission"
        if job_id_for_notif:
            job_doc = await db.jobs.find_one({"id": job_id_for_notif}, {"title": 1})
            if job_doc:
                job_title = job_doc.get("title", "la mission")

        if payer_id:
            asyncio.create_task(notify_user_localized(
                user_id=payer_id,
                key="payment_confirmed_client",
                notif_type=NotificationType.PAYMENT_CONFIRMED,
                related_id=job_id_for_notif or None,
                related_type="job" if job_id_for_notif else None,
                job_title=job_title,
                amount=amount_for_notif,
            ))
        if receiver_id:
            asyncio.create_task(notify_user_localized(
                user_id=receiver_id,
                key="payment_received_worker",
                notif_type=NotificationType.PAYMENT_RECEIVED,
                related_id=job_id_for_notif or None,
                related_type="job" if job_id_for_notif else None,
                job_title=job_title,
                amount=amount_for_notif,
            ))

        # Envoi automatique de l'adresse au travailleur après confirmation du
        # paiement. Si la proposition avait déjà été acceptée avant le paiement,
        # le travailleur a reçu un message "veuillez attendre le paiement" — ici
        # on lui envoie maintenant l'adresse réelle du chantier dans sa langue.
        if job_id_for_notif and receiver_id:
            job_doc_full = await db.jobs.find_one({"id": job_id_for_notif})
            if job_doc_full and job_doc_full.get("assigned_worker_id") == receiver_id:
                payer_doc = await db.users.find_one({"id": payer_id}, {"id": 1}) if payer_id else None
                dispatch_sender = (payer_doc or {}).get("id") or payer_id or receiver_id
                await _dispatch_address_to_worker(
                    job=job_doc_full,
                    worker_id=receiver_id,
                    sender_id=dispatch_sender,
                    phase="payment_done",
                )

    return {'status': 'ok'}
