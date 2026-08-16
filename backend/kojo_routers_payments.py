import asyncio
import time
import uuid
from datetime import datetime, timezone
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
from kojo_shared import notify_user, _dispatch_address_to_worker
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
        check_result = check_paydunya_disburse_status(real_disburse_token)
    except Exception as exc:
        logger.error(f"⚠️ Échec de vérification IPN décaissement PayDunya: {exc}")
        return {'status': 'error', 'detail': 'verification failed'}

    # Meme convention de parsing que submit_paydunya_disburse_invoice (deja
    # utilisee ailleurs dans ce fichier pour cette meme famille d'API PayDunya).
    provider_status = str(
        check_result.get("status")
        or ("success" if str(check_result.get("response_code")) == "00" else "")
    ).strip().lower()

    if provider_status == 'success':
        payout_status = 'released'
    elif provider_status == 'pending':
        payout_status = 'releasing'
    elif provider_status:
        payout_status = 'release_failed'
    else:
        # Reponse PayDunya inattendue/non concluante: on ne change rien
        # plutot que de deviner, un prochain check-status/IPN confirmera.
        return {'status': 'inconclusive'}

    await db.payments.update_one(
        {'id': payment_record['id']},
        {'$set': {
            'payout_status': payout_status,
            'disburse_callback_payload': payload,
            'disburse_verified_payload': check_result,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }}
    )
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
    # réellement convenu sur la mission). Si un job_id est fourni, tout est
    # dérivé côté serveur à partir du job et de sa proposition acceptée :
    # - seul le client propriétaire du job peut lancer un paiement pour lui
    # - le montant est celui de la proposition acceptée (proposed_amount),
    #   pas une valeur libre envoyée par le front-end
    # - le worker_id est celui réellement assigné à la mission
    job = None
    resolved_amount = request.amount
    resolved_worker_id = request.worker_id or ''

    if request.job_id:
        job = await db.jobs.find_one({"id": request.job_id, "deleted": {"$ne": True}})
        if not job:
            raise HTTPException(status_code=404, detail="Mission introuvable")

        is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
        if job.get("client_id") != current_user.id and not is_owner_user:
            raise HTTPException(status_code=403, detail="Seul le client à l'origine de cette mission peut lancer son paiement")

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
        'job_id': request.job_id or '',
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

    payload = {
        'invoice': {
            'total_amount': payment_record['amount'],
            'description': f"Paiement KOJO {payment_record['id']}",
            'channels': [channel],
            'customer': {
                'name': f"{current_user.first_name} {current_user.last_name}".strip(),
                'email': current_user.email,
                'phone': current_user.phone
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
        return serialize_payment_record(cached_record)

    payment_record = await sync_payment_status_with_paydunya(payment_record)
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
        return serialize_payment_record(cached_record)

    payment_record = await sync_payment_status_with_paydunya(payment_record)
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
            asyncio.create_task(notify_user(
                user_id=payer_id,
                title="Paiement confirmé ✅",
                body=f"Votre paiement de {amount_for_notif} FCFA pour « {job_title} » a bien été reçu.",
                notif_type=NotificationType.PAYMENT_CONFIRMED,
                related_id=job_id_for_notif or None,
                related_type="job" if job_id_for_notif else None,
            ))
        if receiver_id:
            asyncio.create_task(notify_user(
                user_id=receiver_id,
                title="Paiement sécurisé 🔒",
                body=f"Le client a payé {amount_for_notif} FCFA pour « {job_title} ». Fonds sécurisés jusqu'à la fin de la mission.",
                notif_type=NotificationType.PAYMENT_RECEIVED,
                related_id=job_id_for_notif or None,
                related_type="job" if job_id_for_notif else None,
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
