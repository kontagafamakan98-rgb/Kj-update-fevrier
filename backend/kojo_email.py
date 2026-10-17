# -*- coding: utf-8 -*-
"""Service email : OTP, jetons de vérification, fournisseurs Brevo/Resend/Gmail.

Un seul point décide du fournisseur : `send_email_via_active_provider`, piloté
par EMAIL_PROVIDER. Les trois envois directs (OTP, alertes owner) passent par
lui — un commutateur qui n'en déplacerait que la moitié laisserait l'autre
moitié dépendre d'une clé Brevo qu'on vient de retirer.
"""

import base64
import hashlib
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import List, Optional

import jwt
import requests
from fastapi import HTTPException

from kojo_core import db
from kojo_settings import (
    BREVO_API_KEY,
    BREVO_API_URL,
    BREVO_REPLY_TO_EMAIL,
    BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME,
    EMAIL_OTP_EXPIRY_MINUTES,
    EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    EMAIL_OTP_SECRET,
    EMAIL_PROVIDER,
    EMAIL_VERIFICATION_TOKEN_MINUTES,
    GMAIL_ACCESS_TOKEN_CACHE,
    GMAIL_ACCESS_TOKEN_SAFETY_SECONDS,
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN,
    GMAIL_SENDER_EMAIL,
    GMAIL_SENDER_NAME,
    GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS,
    GMAIL_TOKEN_REFRESH_RETRIES,
    JWT_ALGORITHM,
    PASSWORD_RESET_FROM_EMAIL,
    RESEND_API_KEY,
    RESEND_API_URL,
    RESEND_REPLY_TO_EMAIL,
    RESEND_SENDER_EMAIL,
    RESEND_SENDER_NAME,
    logger,
)
from kojo_email_suppressions import adresse_supprimee


def gmail_is_configured() -> bool:
    return all([
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        GMAIL_REFRESH_TOKEN,
        GMAIL_SENDER_EMAIL
    ])

def get_missing_gmail_env_vars() -> List[str]:
    missing = []
    if not GMAIL_CLIENT_ID:
        missing.append("GMAIL_CLIENT_ID")
    if not GMAIL_CLIENT_SECRET:
        missing.append("GMAIL_CLIENT_SECRET")
    if not GMAIL_REFRESH_TOKEN:
        missing.append("GMAIL_REFRESH_TOKEN")
    if not GMAIL_SENDER_EMAIL:
        missing.append("GMAIL_SENDER_EMAIL")
    return missing

def generate_email_otp_code(length: int = 6) -> str:
    return ''.join(secrets.choice('0123456789') for _ in range(length))

def hash_email_otp(email: str, purpose: str, otp_code: str) -> str:
    payload = f"{EMAIL_OTP_SECRET}:{purpose}:{email.lower().strip()}:{otp_code}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def mask_email_address(email: str) -> str:
    if '@' not in email:
        return email
    local, domain = email.split('@', 1)
    masked_local = local[:2] + ('*' * max(1, len(local) - 2)) if len(local) > 2 else local[0] + '*'
    domain_name, *domain_parts = domain.split('.')
    masked_domain = domain_name[:1] + ('*' * max(1, len(domain_name) - 1))
    return f"{masked_local}@{'.'.join([masked_domain] + domain_parts)}"

def create_email_verification_token(email: str, purpose: str = "signup") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=EMAIL_VERIFICATION_TOKEN_MINUTES)
    payload = {
        "sub": email.lower().strip(),
        "purpose": purpose,
        "type": "email_verification",
        # jti : identifiant unique permettant de révoquer le jeton après usage
        # (inscription ou réinitialisation de mot de passe) pour empêcher
        # toute relecture dans sa fenêtre de validité.
        "jti": str(uuid.uuid4()),
        "exp": expire
    }
    return jwt.encode(payload, EMAIL_OTP_SECRET, algorithm=JWT_ALGORITHM)

def verify_email_verification_token(token: str, email: str, purpose: str = "signup") -> dict:
    try:
        payload = jwt.decode(token, EMAIL_OTP_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "email_verification":
            raise HTTPException(status_code=401, detail="Jeton de vérification invalide")
        if payload.get("sub") != email.lower().strip():
            raise HTTPException(status_code=401, detail="Jeton de vérification non valide pour cet email")
        if payload.get("purpose") != purpose:
            raise HTTPException(status_code=401, detail="Jeton de vérification non valide pour cette opération")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="La vérification email a expiré. Veuillez demander un nouveau code.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Jeton de vérification email invalide")

def invalidate_gmail_access_token_cache():
    GMAIL_ACCESS_TOKEN_CACHE["access_token"] = ""
    GMAIL_ACCESS_TOKEN_CACHE["expires_at"] = 0.0

def get_gmail_access_token(force_refresh: bool = False) -> str:
    now_ts = time.time()
    cached_token = GMAIL_ACCESS_TOKEN_CACHE.get("access_token", "")
    cached_expires_at = float(GMAIL_ACCESS_TOKEN_CACHE.get("expires_at", 0.0) or 0.0)

    if cached_token and not force_refresh and now_ts < (cached_expires_at - GMAIL_ACCESS_TOKEN_SAFETY_SECONDS):
        return cached_token

    last_error = ""

    for attempt in range(1, GMAIL_TOKEN_REFRESH_RETRIES + 1):
        try:
            token_response = requests.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": GMAIL_CLIENT_ID,
                    "client_secret": GMAIL_CLIENT_SECRET,
                    "refresh_token": GMAIL_REFRESH_TOKEN,
                    "grant_type": "refresh_token"
                },
                timeout=15
            )

            if token_response.ok:
                token_payload = token_response.json()
                access_token = token_payload.get("access_token")
                expires_in = int(token_payload.get("expires_in") or 3600)
                if access_token:
                    GMAIL_ACCESS_TOKEN_CACHE["access_token"] = access_token
                    GMAIL_ACCESS_TOKEN_CACHE["expires_at"] = time.time() + max(300, expires_in)
                    return access_token
                last_error = "Réponse OAuth Gmail invalide: access_token manquant"
            else:
                last_error = token_response.text or f"HTTP {token_response.status_code}"
        except requests.RequestException as exc:
            last_error = str(exc)

        if attempt < GMAIL_TOKEN_REFRESH_RETRIES:
            sleep_seconds = GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS * attempt
            logger.warning(
                "⚠️ Gmail token refresh attempt %s/%s failed, retrying in %.1fs",
                attempt,
                GMAIL_TOKEN_REFRESH_RETRIES,
                sleep_seconds
            )
            time.sleep(sleep_seconds)

    invalidate_gmail_access_token_cache()
    logger.error("❌ Gmail token refresh failed after %s attempts: %s", GMAIL_TOKEN_REFRESH_RETRIES, last_error)
    raise HTTPException(status_code=502, detail="Impossible d'obtenir un accès Gmail après plusieurs tentatives. Vérifiez la configuration OAuth Google sur Render.")

def brevo_is_configured() -> bool:
    return all([
        BREVO_API_KEY,
        BREVO_SENDER_EMAIL,
    ])


def resend_is_configured() -> bool:
    return all([
        RESEND_API_KEY,
        RESEND_SENDER_EMAIL,
    ])


# --- Sonde de santé Brevo (moniteur d'infra /monitor/brevo) ---
# Endpoint read-only et léger de l'API Brevo (compte/plan), appelé à chaque
# passage du moniteur. Cache TTL court : UptimeRobot/Render peuvent interroger
# toutes les 30-60 s, on ne martèle pas Brevo pour autant.
BREVO_ACCOUNT_API_URL = "https://api.brevo.com/v3/account"
BREVO_HEALTH_CACHE_TTL_SECONDS = 60
_brevo_health_cache = {}  # {"at": float, "result": dict}


def brevo_health_probe() -> dict:
    """Sonde l'API Brevo (GET /v3/account) pour le moniteur /monitor/brevo.

    Retourne {"ok": bool, "configured": bool, "detail": str} — jamais
    d'exception. Le résultat est mis en cache TTL (60 s) pour ne pas marteler
    Brevo quand le moniteur interroge fréquemment.
    """
    now = time.time()
    cached = _brevo_health_cache.get("result")
    if cached and (now - cached["at"]) < BREVO_HEALTH_CACHE_TTL_SECONDS:
        return cached["result"]

    if not brevo_is_configured():
        result = {
            "ok": False,
            "configured": False,
            "detail": "Brevo non configuré (BREVO_API_KEY / BREVO_SENDER_EMAIL)",
        }
    else:
        try:
            probe_response = requests.get(
                BREVO_ACCOUNT_API_URL,
                headers={"accept": "application/json", "api-key": BREVO_API_KEY},
                timeout=5,
            )
            ok = probe_response.ok
            result = {
                "ok": ok,
                "configured": True,
                "detail": f"HTTP {probe_response.status_code}" if ok else f"HTTP {probe_response.status_code}: {probe_response.text[:120]}",
            }
        except requests.RequestException as exc:
            result = {
                "ok": False,
                "configured": True,
                "detail": f"Transport Brevo indisponible: {exc}",
            }

    _brevo_health_cache["result"] = {"at": now, "result": result}
    return result


# --- Sonde de santé du fournisseur email ACTIF (/monitor/email) -------------
#
# `/monitor/brevo` juge Brevo, qui n'est peut-être plus celui qui envoie. Cette
# sonde juge le fournisseur qu'un envoi utiliserait MAINTENANT, et elle le
# NOMME dans son payload : un vert qui ne dit pas qui a été jugé ne prouve
# rien. Deux modes d'échec, et ce sont eux qu'on veut constater avant un
# utilisateur :
#
#   * MUET — configuration incomplète, transport injoignable, HTTP d'erreur,
#     `EMAIL_PROVIDER=none` (aucun envoi du tout), ou un nom de fournisseur
#     inconnu (le point de règle retombe sur Brevo ; la sonde le dit au lieu de
#     laisser la faute de frappe invisible) ;
#   * MAL CONFIGURÉ — la clé répond mais l'EXPÉDITEUR n'est pas utilisable :
#     chez Resend, un domaine non vérifié n'autorise l'envoi qu'à l'adresse du
#     compte, donc tous les vrais destinataires échouent ; chez Brevo, un
#     expéditeur `active: false` ; chez Gmail, un refresh token révoqué.
#
# Le repli sur Brevo est celui du point de règle, et c'est pour cela qu'il vit
# ici : une sonde qui résoudrait le fournisseur autrement jugerait une règle
# que les envois ne suivent pas.
KNOWN_EMAIL_PROVIDERS = ("brevo", "resend", "gmail", "none")
EMAIL_HEALTH_CACHE_TTL_SECONDS = 60
# Un seul cache, mais INDEXÉ par fournisseur : changer EMAIL_PROVIDER ne doit
# pas servir le verdict du précédent.
_email_health_cache = {}  # {"at": float, "provider": str, "result": dict}

RESEND_DOMAINS_API_URL = "https://api.resend.com/domains"
BREVO_SENDERS_API_URL = "https://api.brevo.com/v3/senders"
EMAIL_HEALTH_TIMEOUT_SECONDS = 5


def active_email_provider():
    """Le fournisseur qu'un envoi utiliserait maintenant, et le repli NOMMÉ.

    Returns:
        tuple: (provider, note) — `note` est vide quand EMAIL_PROVIDER est
        reconnu, et nomme le repli quand il ne l'est pas (le point de règle
        retombe alors sur Brevo, comme avant).
    """
    brut = (EMAIL_PROVIDER or "brevo").strip().lower()
    if brut in KNOWN_EMAIL_PROVIDERS:
        return brut, ""
    return "brevo", (
        "EMAIL_PROVIDER=%r inconnu : repli sur brevo (comportement du point de règle)"
        % brut
    )


def _domain_of(email: str) -> str:
    """Le domaine d'une adresse, en minuscules ("" si ce n'en est pas une)."""
    return email.rsplit("@", 1)[-1].strip().lower() if "@" in (email or "") else ""


def _resend_domain_sendable(entree: dict):
    """Un domaine Resend autorise-t-il l'envoi ? (bool, raison lisible).

    `verified` est le statut documenté du domaine entièrement vérifié. La
    capacité `sending` est lue EN PLUS parce que `partially_verified` peut
    laisser l'envoi activé : juger sur le seul statut rendrait rouge un
    domaine qui envoie.
    """
    statut = str(entree.get("status") or "").strip().lower()
    capacites = entree.get("capabilities") or {}
    envoi = str(capacites.get("sending") or "").strip().lower()
    if statut == "verified":
        return True, "domaine vérifié"
    if envoi == "enabled":
        return True, "statut %r mais capacité d'envoi activée" % statut
    return False, "statut %r, capacité d'envoi %r" % (statut, envoi or "inconnue")


def _resend_probe_result() -> dict:
    """Resend : la clé répond-elle, et l'expéditeur peut-il écrire à autrui ?"""
    if not resend_is_configured():
        missing = ", ".join(get_missing_resend_env_vars())
        return {
            "ok": False,
            "configured": False,
            "detail": "Resend non configuré (%s)" % missing,
        }

    if not _domain_of(RESEND_SENDER_EMAIL):
        return {
            "ok": False,
            "configured": False,
            "detail": "RESEND_SENDER_EMAIL n'est pas une adresse : aucun domaine à vérifier",
        }

    try:
        reponse = requests.get(
            RESEND_DOMAINS_API_URL,
            headers={
                "Authorization": "Bearer %s" % RESEND_API_KEY,
                "accept": "application/json",
                # Resend refuse (403, erreur 1010) un appel sans User-Agent ;
                # requests en pose un, mais le nommer évite d'en dépendre.
                "User-Agent": "kojo-monitor/1.0",
            },
            timeout=EMAIL_HEALTH_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "configured": True,
            "detail": "Transport Resend indisponible: %s" % exc,
        }

    if reponse.status_code in (401, 403):
        corps = (reponse.text or "")[:200]
        # Une clé `sending_access` est LÉGITIME : elle prouve seulement que
        # Resend l'accepte, pas que le domaine soit vérifié. Un vert muet
        # serait un faux verdict — le détail dit ce qui n'a PAS été jugé.
        if "restricted" in corps.lower():
            return {
                "ok": True,
                "configured": True,
                "detail": (
                    "HTTP %s : clé restreinte à l'envoi — expéditeur NON JUGÉ "
                    "(GET /domains refuse la lecture avec ce scope)"
                    % reponse.status_code
                ),
            }
        return {
            "ok": False,
            "configured": True,
            "detail": "Resend a refusé la clé (HTTP %s)" % reponse.status_code,
        }

    if not reponse.ok:
        return {
            "ok": False,
            "configured": True,
            "detail": "HTTP %s: %s" % (reponse.status_code, (reponse.text or "")[:120]),
        }

    try:
        charge = reponse.json()
    except ValueError:
        return {
            "ok": False,
            "configured": True,
            "detail": "Réponse Resend illisible (pas du JSON)",
        }

    domaines = charge.get("data") if isinstance(charge, dict) else None
    if not isinstance(domaines, list):
        return {
            "ok": False,
            "configured": True,
            "detail": "Réponse Resend sans liste `data` : domaine non jugé",
        }

    domaine = _domain_of(RESEND_SENDER_EMAIL)
    entree = next(
        (
            item for item in domaines
            if isinstance(item, dict)
            and str(item.get("name") or "").strip().lower() == domaine
        ),
        None,
    )
    if entree is None:
        return {
            "ok": False,
            "configured": True,
            "detail": (
                "expéditeur inutilisable : domaine « %s » absent de Resend — sans "
                "domaine vérifié, seuls les envois vers l'adresse du compte partent"
                % domaine
            ),
        }

    envoyable, raison = _resend_domain_sendable(entree)
    if not envoyable:
        return {
            "ok": False,
            "configured": True,
            "detail": "expéditeur inutilisable : domaine « %s » %s" % (domaine, raison),
        }
    return {
        "ok": True,
        "configured": True,
        "detail": "HTTP %s, domaine « %s » %s" % (reponse.status_code, domaine, raison),
    }


def _brevo_probe_result() -> dict:
    """Brevo : la clé répond-elle, et l'expéditeur d'envoi est-il actif ?

    On sonde l'expéditeur RÉELLEMENT utilisé par l'envoi,
    `PASSWORD_RESET_FROM_EMAIL or BREVO_SENDER_EMAIL`, et pas la variable de
    configuration : les deux peuvent diverger, et c'est l'adresse qui part qui
    décide si le message arrive.
    """
    if not brevo_is_configured():
        missing = ", ".join(get_missing_brevo_env_vars())
        return {
            "ok": False,
            "configured": False,
            "detail": "Brevo non configuré (%s)" % missing,
        }

    expediteur = (PASSWORD_RESET_FROM_EMAIL or BREVO_SENDER_EMAIL).strip()
    try:
        reponse = requests.get(
            BREVO_SENDERS_API_URL,
            headers={"accept": "application/json", "api-key": BREVO_API_KEY},
            timeout=EMAIL_HEALTH_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        return {
            "ok": False,
            "configured": True,
            "detail": "Transport Brevo indisponible: %s" % exc,
        }

    if reponse.status_code in (401, 403):
        return {
            "ok": False,
            "configured": True,
            "detail": "Brevo a refusé la clé (HTTP %s)" % reponse.status_code,
        }

    if not reponse.ok:
        return {
            "ok": False,
            "configured": True,
            "detail": "HTTP %s: %s" % (reponse.status_code, (reponse.text or "")[:120]),
        }

    try:
        charge = reponse.json()
    except ValueError:
        return {
            "ok": False,
            "configured": True,
            "detail": "Réponse Brevo illisible (pas du JSON)",
        }

    expediteurs = charge.get("senders") if isinstance(charge, dict) else None
    if not isinstance(expediteurs, list):
        return {
            "ok": False,
            "configured": True,
            "detail": "Réponse Brevo sans liste `senders` : expéditeur non jugé",
        }

    entree = next(
        (
            item for item in expediteurs
            if isinstance(item, dict)
            and str(item.get("email") or "").strip().lower() == expediteur.lower()
        ),
        None,
    )
    if entree is None:
        return {
            "ok": False,
            "configured": True,
            "detail": "expéditeur inutilisable : « %s » absent de la liste Brevo" % expediteur,
        }
    if not entree.get("active"):
        return {
            "ok": False,
            "configured": True,
            "detail": "expéditeur inutilisable : « %s » inactif (active: false)" % expediteur,
        }
    return {
        "ok": True,
        "configured": True,
        "detail": "HTTP %s, expéditeur « %s » actif" % (reponse.status_code, expediteur),
    }


def _gmail_probe_result() -> dict:
    """Gmail : le refresh token OAuth donne-t-il encore un jeton d'accès ?

    C'est le mode d'échec réel de ce fournisseur (révocation, changement de
    mot de passe du compte) : la config est complète, l'envoi échoue quand
    même. `get_gmail_access_token` lève une HTTPException 502 après ses
    tentatives — la sonde la nomme au lieu de la propager.
    """
    if not gmail_is_configured():
        missing = ", ".join(get_missing_gmail_env_vars())
        return {
            "ok": False,
            "configured": False,
            "detail": "Gmail non configuré (%s)" % missing,
        }

    try:
        jeton = get_gmail_access_token()
    except HTTPException as exc:
        return {
            "ok": False,
            "configured": True,
            "detail": "Jeton Gmail refusé: %s" % (exc.detail,),
        }
    except requests.RequestException as exc:
        return {
            "ok": False,
            "configured": True,
            "detail": "Transport Gmail indisponible: %s" % exc,
        }
    except Exception as exc:  # pragma: no cover - filet : une sonde ne lève pas
        return {
            "ok": False,
            "configured": True,
            "detail": "Jeton Gmail indisponible: %s" % exc,
        }

    if not jeton:
        return {
            "ok": False,
            "configured": True,
            "detail": "Jeton Gmail vide : OAuth n'a rien rendu",
        }
    return {"ok": True, "configured": True, "detail": "OAuth Gmail: jeton obtenu"}


def active_email_provider_health_probe() -> dict:
    """Sonde du fournisseur email ACTIF, pour /monitor/email et /monitor.

    Rend un dict `{ok, configured, detail, provider[, provider_note]}` — jamais
    d'exception, comme les autres sondes d'infra. Le résultat est mis en cache
    TTL (60 s) PAR FOURNISSEUR : le moniteur interroge toutes les 30-60 s, on
    ne martèle pas l'API pour autant.

    Returns:
        dict: verdict nommé du fournisseur actif, avec `provider` (qui a été
        jugé) et `provider_note` (repli, le cas échéant).
    """
    provider, note = active_email_provider()
    now = time.time()

    if (
        _email_health_cache.get("provider") == provider
        and (now - _email_health_cache.get("at", 0.0)) < EMAIL_HEALTH_CACHE_TTL_SECONDS
    ):
        resultat = dict(_email_health_cache["result"])
    else:
        if provider == "resend":
            resultat = _resend_probe_result()
        elif provider == "gmail":
            resultat = _gmail_probe_result()
        elif provider == "none":
            resultat = {
                "ok": False,
                "configured": False,
                "detail": (
                    "EMAIL_PROVIDER=none : aucun fournisseur actif, aucun email ne "
                    "part (mode test/local ; en production, personne ne reçoit son code)"
                ),
            }
        else:
            resultat = _brevo_probe_result()
        _email_health_cache.update({"at": now, "provider": provider, "result": resultat})
        resultat = dict(resultat)

    resultat["provider"] = provider
    if note:
        resultat["provider_note"] = note
    return resultat


def get_missing_brevo_env_vars() -> List[str]:
    missing = []
    if not BREVO_API_KEY:
        missing.append('BREVO_API_KEY')
    if not BREVO_SENDER_EMAIL:
        missing.append('BREVO_SENDER_EMAIL')
    return missing

def send_email_via_brevo_api(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    if not brevo_is_configured():
        missing = ', '.join(get_missing_brevo_env_vars())
        raise HTTPException(status_code=503, detail=f"Configuration Brevo incomplète: {missing}")

    sender_email = PASSWORD_RESET_FROM_EMAIL or BREVO_SENDER_EMAIL
    payload = {
        'sender': {
            'email': sender_email,
            'name': BREVO_SENDER_NAME,
        },
        'to': [
            {
                'email': to_email,
            }
        ],
        'subject': subject,
        'htmlContent': html_body or f'<pre>{text_body}</pre>',
        'textContent': text_body,
    }

    # Réponses : l'expéditeur du domaine n'a pas de boîte. Le garde `if` évite
    # un replyTo à valeur vide, que Brevo rejetterait (400) — donc une panne
    # d'envoi provoquée par une variable effacée.
    if BREVO_REPLY_TO_EMAIL:
        payload['replyTo'] = {'email': BREVO_REPLY_TO_EMAIL, 'name': BREVO_SENDER_NAME}

    try:
        brevo_response = requests.post(
            BREVO_API_URL,
            headers={
                'accept': 'application/json',
                'content-type': 'application/json',
                'api-key': BREVO_API_KEY,
            },
            json=payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.error('❌ Brevo send transport error: %s', exc)
        raise HTTPException(status_code=502, detail='Transport Brevo indisponible. Réessayez dans un instant.')

    if not brevo_response.ok:
        logger.error('❌ Brevo send failed: %s', brevo_response.text)
        raise HTTPException(status_code=502, detail="Échec d'envoi Brevo. Vérifiez BREVO_API_KEY et l'expéditeur sur Render.")

    return brevo_response.json()

def get_missing_resend_env_vars() -> List[str]:
    missing = []
    if not RESEND_API_KEY:
        missing.append('RESEND_API_KEY')
    if not RESEND_SENDER_EMAIL:
        missing.append('RESEND_SENDER_EMAIL')
    return missing


def send_email_via_resend_api(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    """Envoie un email par l'API Resend (POST /emails, clé `Bearer re_…`).

    Appel REST direct (`requests`), comme Brevo : aucune dépendance SDK à tenir,
    et le même contrat d'erreur que les autres fournisseurs — 503 quand la
    configuration manque (en nommant les variables), 502 quand Resend refuse.

    L'expéditeur porte un nom d'affichage (« KOJO <noreply@…> ») : Resend
    l'accepte dans ce format, et sans lui la boîte du destinataire afficherait
    l'adresse nue. Le `reply_to` n'est posé QUE s'il est non vide — Resend
    rejette une valeur vide, donc une variable effacée deviendrait une panne
    d'envoi au lieu d'un simple repli (même garde que Brevo).
    """
    if not resend_is_configured():
        missing = ', '.join(get_missing_resend_env_vars())
        raise HTTPException(status_code=503, detail=f"Configuration Resend incomplète: {missing}")

    payload = {
        'from': f"{RESEND_SENDER_NAME} <{RESEND_SENDER_EMAIL}>",
        'to': [to_email],
        'subject': subject,
        'html': html_body or f'<pre>{text_body}</pre>',
        'text': text_body,
    }
    if RESEND_REPLY_TO_EMAIL:
        payload['reply_to'] = RESEND_REPLY_TO_EMAIL

    try:
        resend_response = requests.post(
            RESEND_API_URL,
            headers={
                'Authorization': f'Bearer {RESEND_API_KEY}',
                'Content-Type': 'application/json',
            },
            json=payload,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.error('❌ Resend send transport error: %s', exc)
        raise HTTPException(status_code=502, detail='Transport Resend indisponible. Réessayez dans un instant.')

    if resend_response.status_code in (401, 403):
        # Deux causes distinctes derrière le même refus : clé invalide, ou
        # domaine non vérifié (Resend n'autorise alors QUE l'adresse du compte).
        # Le dire ici évite de chercher côté DNS ce qui est côté clé.
        logger.error('❌ Resend a refusé la clé ou l\'expéditeur: HTTP %s', resend_response.status_code)
        raise HTTPException(
            status_code=502,
            detail="Resend a refusé l'envoi : vérifiez RESEND_API_KEY et que le domaine de RESEND_SENDER_EMAIL "
                   "est vérifié (sans domaine vérifié, Resend n'écrit qu'à l'adresse du compte).",
        )

    if not resend_response.ok:
        logger.error('❌ Resend send failed: HTTP %s %s', resend_response.status_code, resend_response.text[:200])
        raise HTTPException(status_code=502, detail="Échec d'envoi Resend. Vérifiez RESEND_API_KEY et l'expéditeur.")

    return resend_response.json()


def send_email_via_gmail_api(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    if not gmail_is_configured():
        missing = ', '.join(get_missing_gmail_env_vars())
        raise HTTPException(status_code=503, detail=f"Configuration Gmail incomplète: {missing}")

    if html_body:
        message = MIMEMultipart('alternative')
        message.attach(MIMEText(text_body, 'plain', 'utf-8'))
        message.attach(MIMEText(html_body, 'html', 'utf-8'))
    else:
        message = MIMEText(text_body, 'plain', 'utf-8')

    message['to'] = to_email
    message['from'] = formataddr((GMAIL_SENDER_NAME, GMAIL_SENDER_EMAIL))
    message['subject'] = subject

    raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')

    def perform_send(access_token: str):
        return requests.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json={"raw": raw_message},
            timeout=20
        )

    try:
        gmail_response = perform_send(get_gmail_access_token())
    except requests.RequestException as exc:
        logger.error("❌ Gmail send transport error: %s", exc)
        raise HTTPException(status_code=502, detail="Transport Gmail indisponible. Réessayez dans un instant.")

    if gmail_response.status_code in (401, 403):
        logger.warning("⚠️ Gmail send rejected cached token, forcing refresh")
        invalidate_gmail_access_token_cache()
        try:
            gmail_response = perform_send(get_gmail_access_token(force_refresh=True))
        except requests.RequestException as exc:
            logger.error("❌ Gmail retry transport error: %s", exc)
            raise HTTPException(status_code=502, detail="Transport Gmail indisponible. Réessayez dans un instant.")

    if not gmail_response.ok:
        logger.error(f"❌ Gmail send failed: {gmail_response.text}")
        raise HTTPException(status_code=502, detail="Échec d'envoi Gmail. Vérifiez le compte expéditeur, les scopes OAuth et le refresh token sur Render.")

    return gmail_response.json()

async def send_email_via_active_provider(to_email: str, subject: str, text_body: str, html_body: Optional[str] = None):
    """Envoie via le fournisseur ACTIF (EMAIL_PROVIDER) — un seul point de règle.

    Raison d'être : le choix du fournisseur vivait dans la seule branche OTP,
    tandis que les alertes owner (circuit breaker PayDunya, ticket support,
    décaissement bloqué) appelaient Brevo en dur. Passer EMAIL_PROVIDER=resend
    laissait donc la moitié des emails sur Brevo — et comme ces alertes sont
    best-effort (try/except + warning), retirer la clé Brevo les faisait taire
    sans que rien ne rougisse.

    Elle porte AUSSI le second invariant de l'envoi, et c'est pour cela qu'elle
    est devenue ASYNCHRONE : l'adresse est d'abord confrontée aux adresses
    RETENUES (kojo_email_suppressions, alimenté par les webhooks de rebonds et
    de plaintes du fournisseur). Une adresse retenue ne reçoit plus rien —
    l'appel est journalisé en warning, jamais silencieux, et None est rendu
    pour que l'appelant sache qu'aucun envoi n'a eu lieu. Le filtre vit ICI, au
    point par lequel passent tous les envois produits : le placer chez chaque
    appelant laisserait le prochain envoi ajouté en dehors.

    EMAIL_PROVIDER=none n'envoie rien (mode test/local, l'appelant conserve le
    code ou la trace), un fournisseur inconnu retombe sur Brevo — comportement
    d'avant, pour qu'une valeur mal orthographiée n'éteigne pas les emails.
    """
    retenue = await adresse_supprimee(to_email)
    if retenue:
        logger.warning(
            "⏭️ Envoi annulé : adresse retenue (%s) — %s. La lever si elle est de "
            "nouveau joignable (POST /api/owner/email-suppressions/lever).",
            (retenue.get("motif") or "?"),
            mask_email_address(to_email),
        )
        return None

    # Le fournisseur est résolu par `active_email_provider`, partagé avec la
    # sonde /monitor/email : deux résolutions divergentes feraient juger par la
    # sonde un fournisseur que les envois ne suivent pas.
    provider, provider_note = active_email_provider()
    if provider_note:
        logger.warning("⚠️ %s", provider_note)
    if provider == 'none':
        logger.info(
            "ℹ️ EMAIL_PROVIDER=none: envoi d'email désactivé (destinataire=%s)",
            mask_email_address(to_email),
        )
        return None
    if provider == 'gmail':
        return send_email_via_gmail_api(to_email, subject, text_body, html_body)
    if provider == 'resend':
        return send_email_via_resend_api(to_email, subject, text_body, html_body)
    return send_email_via_brevo_api(to_email, subject, text_body, html_body)


def build_email_otp_email(purpose: str, otp_code: str) -> dict:
    if purpose == "password_reset":
        subject = "Réinitialisation du mot de passe KOJO"
        text_body = (
            f"Bonjour,\n\n"
            f"Voici votre code KOJO pour réinitialiser votre mot de passe : {otp_code}\n\n"
            f"Ce code expire dans {EMAIL_OTP_EXPIRY_MINUTES} minutes.\n"
            f"Ne partagez jamais ce code avec qui que ce soit.\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\n"
            f"Équipe KOJO"
        )
        html_body = f"""
        <div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#eff6ff;border:1px solid #93c5fd;border-radius:16px;\">
          <div style=\"text-align:center;margin-bottom:24px;\">
            <div style=\"display:inline-block;background:#2563eb;color:#ffffff;border-radius:999px;padding:14px 18px;font-weight:700;font-size:20px;\">KOJO</div>
          </div>
          <h2 style=\"color:#1d4ed8;margin-bottom:8px;\">Réinitialisation de votre mot de passe</h2>
          <p style=\"color:#1e3a8a;font-size:15px;line-height:1.6;\">Utilisez ce code pour définir un nouveau mot de passe KOJO.</p>
          <div style=\"margin:24px 0;padding:20px;background:#ffffff;border:1px dashed #60a5fa;border-radius:12px;text-align:center;\">
            <div style=\"font-size:34px;letter-spacing:8px;font-weight:700;color:#2563eb;\">{otp_code}</div>
          </div>
          <p style=\"color:#1e3a8a;font-size:14px;line-height:1.6;\">Ce code expire dans <strong>{EMAIL_OTP_EXPIRY_MINUTES} minutes</strong>.</p>
          <p style=\"color:#1e3a8a;font-size:14px;line-height:1.6;\">Ne partagez jamais ce code. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <p style=\"color:#1d4ed8;font-size:13px;margin-top:24px;\">Équipe KOJO</p>
        </div>
        """
    else:
        subject = "Votre code de vérification KOJO"
        text_body = (
            f"Bonjour,\n\n"
            f"Voici votre code de vérification KOJO : {otp_code}\n\n"
            f"Ce code expire dans {EMAIL_OTP_EXPIRY_MINUTES} minutes.\n"
            f"Ne partagez jamais ce code avec qui que ce soit.\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.\n\n"
            f"Équipe KOJO"
        )
        html_body = f"""
        <div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff7ed;border:1px solid #fdba74;border-radius:16px;\">
          <div style=\"text-align:center;margin-bottom:24px;\">
            <div style=\"display:inline-block;background:#ea580c;color:#ffffff;border-radius:999px;padding:14px 18px;font-weight:700;font-size:20px;\">KOJO</div>
          </div>
          <h2 style=\"color:#9a3412;margin-bottom:8px;\">Vérification de votre email</h2>
          <p style=\"color:#7c2d12;font-size:15px;line-height:1.6;\">Voici votre code de vérification KOJO.</p>
          <div style=\"margin:24px 0;padding:20px;background:#ffffff;border:1px dashed #fb923c;border-radius:12px;text-align:center;\">
            <div style=\"font-size:34px;letter-spacing:8px;font-weight:700;color:#ea580c;\">{otp_code}</div>
          </div>
          <p style=\"color:#7c2d12;font-size:14px;line-height:1.6;\">Ce code expire dans <strong>{EMAIL_OTP_EXPIRY_MINUTES} minutes</strong>.</p>
          <p style=\"color:#7c2d12;font-size:14px;line-height:1.6;\">Ne partagez jamais ce code. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
          <p style=\"color:#9a3412;font-size:13px;margin-top:24px;\">Équipe KOJO</p>
        </div>
        """

    return {
        "subject": subject,
        "text_body": text_body,
        "html_body": html_body
    }

async def issue_email_otp(email: str, purpose: str = "signup") -> dict:
    now = datetime.now(timezone.utc)
    existing_otp = await db.email_otps.find_one({"email": email, "purpose": purpose})

    if existing_otp and existing_otp.get("last_sent_at"):
        last_sent_at = existing_otp["last_sent_at"]
        if last_sent_at.tzinfo is None:
            last_sent_at = last_sent_at.replace(tzinfo=timezone.utc)

        elapsed = (now - last_sent_at).total_seconds()
        if elapsed < EMAIL_OTP_RESEND_COOLDOWN_SECONDS:
            remaining = max(1, int(EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsed + 0.999))
            raise HTTPException(
                status_code=429,
                detail=f"Veuillez patienter {remaining}s avant de renvoyer un autre code.",
                headers={"Retry-After": str(remaining)}
            )

    # Adresse RETENUE (rebond définitif ou plainte) : on refuse AVANT de
    # fabriquer un code, et on le DIT. Le filtre du point d'envoi suffirait à ne
    # rien envoyer, mais l'appelant annoncerait alors un code envoyé que
    # personne ne recevra — l'utilisateur attendrait devant son écran. Ici, le
    # refus est nommé, et l'état est celui d'une vraie erreur : il ne se
    # répare pas en réessayant.
    retenue = await adresse_supprimee(email)
    if retenue:
        motif = retenue.get("motif") or "?"
        logger.warning(
            "🚫 OTP refusé : adresse %s retenue (%s)", mask_email_address(email), motif
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "Cette adresse email est injoignable : nos messages ont rebondi ou ont "
                "été signalés comme indésirables, donc nous ne lui écrivons plus. "
                "Écrivez à kojoapp98@gmail.com pour la réactiver, ou utilisez une "
                "autre adresse."
            ),
        )

    otp_code = generate_email_otp_code()
    otp_hash = hash_email_otp(email, purpose, otp_code)
    expires_at = now + timedelta(minutes=EMAIL_OTP_EXPIRY_MINUTES)
    email_content = build_email_otp_email(purpose, otp_code)
    # Le choix du fournisseur n'est PAS décidé ici : le point de règle est
    # send_email_via_active_provider, partagé avec les alertes owner — et c'est
    # lui qui porte aussi le filtre des adresses retenues.
    await send_email_via_active_provider(
        email, email_content["subject"], email_content["text_body"], email_content["html_body"]
    )

    await db.email_otps.update_one(
        {"email": email, "purpose": purpose},
        {
            "$set": {
                "otp_hash": otp_hash,
                "attempt_count": 0,
                "verified_at": None,
                "last_sent_at": now,
                "expires_at": expires_at,
                "updated_at": now,
                "status": "pending"
            },
            "$setOnInsert": {
                "created_at": now
            },
            "$inc": {
                "send_count": 1
            }
        },
        upsert=True
    )

    return {
        "message": "Code de vérification envoyé par email.",
        "masked_email": mask_email_address(email),
        "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
        "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    }
