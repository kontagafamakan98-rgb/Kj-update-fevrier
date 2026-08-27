# -*- coding: utf-8 -*-
"""Configuration centrale de Kojo : environnement, logging, secrets,
constantes et en-têtes de sécurité."""

import logging
import logging.handlers
import os
import sys
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
import cloudinary

# Web Push (VAPID) - Sans Firebase
# Détection de disponibilité SANS importer de noms inutilisés (l'usage réel
# de pywebpush vit dans kojo_shared.py). find_spec évite un ImportError au
# module importé mais jamais utilisé ici.
try:
    import importlib.util as _importlib_util
    WEBPUSH_AVAILABLE = _importlib_util.find_spec("pywebpush") is not None
except Exception:
    WEBPUSH_AVAILABLE = False
if not WEBPUSH_AVAILABLE:
    # logger n'est pas encore initialisé ici — on utilise print()
    # Le message sera répété via logger une fois le logging configuré.
    print("⚠️ pywebpush non installé - notifications push désactivées")

# Configure logging for West Africa production
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.handlers.RotatingFileHandler(
            'kojo_backend.log',
            maxBytes=10*1024*1024,
            backupCount=5,
            encoding='utf-8'
        )
    ]
)
logger = logging.getLogger("kojo_backend")

# Maintenant que le logger est prêt, on peut réémettre le warning pywebpush
if not WEBPUSH_AVAILABLE:
    logger.warning("⚠️ pywebpush non installé - notifications push désactivées")

# Silence noisy /favicon.ico (and other junk) requests from uvicorn's access
# log entirely - browsers, bots and health checks hit this path constantly
# even though this backend has no favicon to serve, and it clutters the logs.
class _IgnoreNoisyPathsFilter(logging.Filter):
    _IGNORED_SUBSTRINGS = ("/favicon.ico",)

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not any(path in message for path in self._IGNORED_SUBSTRINGS)

logging.getLogger("uvicorn.access").addFilter(_IgnoreNoisyPathsFilter())

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
cloudinary.config(secure=True)



APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()

# Version de l'API — source unique de vérité : health checks (/health,
# /api/health) et en-tête X-Kojo-Version. À bumper ensemble, jamais ailleurs.
# 1.0.2 : modèle User étendu (skills/bio exposés par /auth/me, PR #3).
APP_VERSION = "1.0.2"

_env_jwt_secret = os.environ.get('JWT_SECRET', '').strip()

if _env_jwt_secret:
    JWT_SECRET = _env_jwt_secret
elif APP_ENV in ("production", "prod"):
    # Fail fast and loud rather than silently issuing tokens that won't
    # validate after the next restart or on a different worker.
    raise RuntimeError(
        "JWT_SECRET environment variable is not set. Refusing to start in "
        "production with an auto-generated secret, since that would silently "
        "invalidate all user sessions on every restart/deploy and break auth "
        "across multiple worker processes. Set JWT_SECRET on Fly.io (a long "
        "random string) and redeploy."
    )
else:
    # Local/dev only: stable fallback so tokens survive local restarts.
    JWT_SECRET = 'kojo-dev-only-insecure-secret-do-not-use-in-prod'
    logger.warning(
        "⚠️ JWT_SECRET not set - using an insecure fixed dev secret. "
        "This is only acceptable outside production (APP_ENV=%s).", APP_ENV
    )

JWT_ALGORITHM = "HS256"

JWT_EXPIRATION_HOURS = 24

# --- Vérification email (OTP) ---
_env_email_otp_secret = os.environ.get('EMAIL_OTP_SECRET', '').strip()
if _env_email_otp_secret:
    EMAIL_OTP_SECRET = _env_email_otp_secret
elif APP_ENV in ("production", "prod"):
    # Fail fast en prod : les jetons de vérification email ne doivent pas
    # dépendre d'une clé partagée/fallback silencieux qui changerait selon
    # la configuration JWT d'un environnement à l'autre.
    raise RuntimeError(
        "EMAIL_OTP_SECRET environment variable is not set. Refusing to start "
        "in production because email-verification tokens would otherwise rely "
        "on a silent fallback. Set EMAIL_OTP_SECRET on Fly.io and redeploy."
    )
else:
    # Dev/local uniquement : fallback stable sur JWT_SECRET pour survivre aux
    # redémarrages locaux (comportement historique conservé hors prod).
    EMAIL_OTP_SECRET = JWT_SECRET
    logger.warning(
        "⚠️ EMAIL_OTP_SECRET not set - falling back to JWT_SECRET. "
        "This is only acceptable outside production (APP_ENV=%s).", APP_ENV
    )
EMAIL_OTP_EXPIRY_MINUTES = int(os.environ.get('EMAIL_OTP_EXPIRY_MINUTES', '10'))

EMAIL_OTP_MAX_ATTEMPTS = int(os.environ.get('EMAIL_OTP_MAX_ATTEMPTS', '5'))

PAYMENT_COMMISSION_RATE = float(os.environ.get('PAYMENT_COMMISSION_RATE', '0.14'))

# Récompense de parrainage (FCFA) créditée quand le filleul termine sa
# PREMIÈRE mission : une part au parrain, une part au filleul.
REFERRAL_SPONSOR_REWARD = float(os.environ.get('REFERRAL_SPONSOR_REWARD', '500'))
REFERRAL_FILLEUL_REWARD = float(os.environ.get('REFERRAL_FILLEUL_REWARD', '500'))

# Bonus de BIENVENUE (FCFA) crédité dès l'inscription quand le code de
# parrainage est appliqué : une part au parrain, une part à l'invité.
REFERRAL_WELCOME_SPONSOR_REWARD = float(os.environ.get('REFERRAL_WELCOME_SPONSOR_REWARD', '250'))
REFERRAL_WELCOME_FILLEUL_REWARD = float(os.environ.get('REFERRAL_WELCOME_FILLEUL_REWARD', '250'))

# --- Session par cookie httpOnly (auth web, protection XSS) ---
# Le JWT vit dans un cookie httpOnly (invisible pour JavaScript) en plus du
# mode historique "Authorization: Bearer" (mobile/Capacitor, intégrations).
# Le frontend web (Vercel) appelle le backend (Fly) en CROSS-SITE : un cookie
# cross-site exige SameSite=None + Secure. En dev local (même origine
# localhost), SameSite=Lax suffit et fonctionne en HTTP.
_IS_PROD_ENV = APP_ENV in ("production", "prod")

AUTH_COOKIE_NAME = os.environ.get('AUTH_COOKIE_NAME', 'kojo_session').strip()

CSRF_COOKIE_NAME = os.environ.get('CSRF_COOKIE_NAME', 'kojo_csrf').strip()

AUTH_COOKIE_SAMESITE = os.environ.get(
    'AUTH_COOKIE_SAMESITE', 'none' if _IS_PROD_ENV else 'lax'
).strip().lower()

AUTH_COOKIE_SECURE = os.environ.get(
    'AUTH_COOKIE_SECURE', 'true' if _IS_PROD_ENV else 'false'
).strip().lower() in {'1', 'true', 'yes', 'on'}

# Durée du cookie alignée sur le JWT (24h) : le cookie expire avec le token.
AUTH_COOKIE_MAX_AGE = JWT_EXPIRATION_HOURS * 3600

# --- Sweeper des décaissements bloqués (tâche de fond, kojo_scheduler) ---
# Un versement/remboursement resté incertain (releasing/refunding — l'IPN n'a
# pas tranché) au-delà de ce seuil déclenche une alerte au propriétaire.
PAYOUT_ALERT_THRESHOLD_HOURS = float(os.environ.get('PAYOUT_ALERT_THRESHOLD_HOURS', '24'))

# Rotation à fenêtre glissante du jeton de session : /auth/me émet un jeton
# frais quand il reste moins de ce seuil (secondes) avant expiration (défaut
# 6 h = 25 % de la fenêtre de 24 h) — l'utilisateur actif n'est plus
# déconnecté chaque 24 h. Borne la frappe de jetons : ~1 rotation par session
# et par jour.
AUTH_TOKEN_ROTATION_THRESHOLD_SECONDS = int(os.environ.get('AUTH_TOKEN_ROTATION_THRESHOLD_SECONDS', str(6 * 3600)))

# Escalade : après la première alerte (24 h), un rappel est renvoyé si le
# décaissement est TOUJOURS bloqué au-delà de ce délai (PayDunya injoignable
# plusieurs jours ne doit pas rester silencieux). owner_payout_alerted_at est
# décalé à chaque rappel → rappel périodique espacé, pas de spam.
PAYOUT_ALERT_REMINDER_DAYS = int(os.environ.get('PAYOUT_ALERT_REMINDER_DAYS', '3'))

# Fréquence du passage de re-vérification PayDunya (minutes).
PAYOUT_SWEEPER_INTERVAL_MINUTES = int(os.environ.get('PAYOUT_SWEEPER_INTERVAL_MINUTES', '60'))

# --- Circuit breaker GLOBAL PayDunya ---
# Si l'API PayDunya devient injoignable (échecs RÉSEAU consécutifs : timeout,
# connexion refusée, réponse non-JSON), le circuit s'ouvre : tous les appels
# sortants échouent IMMÉDIATEMENT (fail fast) pendant la période de repos, au
# lieu de marteler une API down avec des timeouts de 30 s. Protège tous les
# flux : checkout (création de facture), re-vérification des décaissements
# (sweeper + polling /payments/status), IPN disburse, remboursements et
# retraits. Un échec MÉTIER (response_code != '00', ex. montant refusé)
# n'ouvre PAS le circuit : c'est un refus de la requête, pas une panne.
PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get('PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD', '5'))
PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS = int(os.environ.get('PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS', str(2 * 3600)))

# --- Google Sign-In (SSO) ---
# Flux serveur : le frontend reçoit un code d'autorisation Google (PKCE) et
# le backend l'échange contre un id_token, dont il vérifie la signature et
# l'audience (client_id). GOOGLE_CLIENT_ID est aussi utilisé côté frontend
# (bouton Google Identity Services).
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()

GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()

# URL de callback déclarée dans la console Google Cloud (OAuth 2.0 Client IDs).
# Pour Vercel : https://kj-update-fevrier.vercel.app/auth/google/callback
# Pour le dev local : http://localhost:3000/auth/google/callback
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', '').strip()

# Endpoints Google (tokeninfo pour la vérification de l'id_token).
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Les comptes créés via Google n'ont pas de mot de passe : ils se connectent
# uniquement via Google. On ne peut PAS les laisser se connecter avec le flux
# email/mot-de-passe (aucun hash stocké).
GOOGLE_AUTH_ENABLED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

PAYDUNYA_MODE = os.environ.get('PAYDUNYA_MODE', 'test').strip().lower()

PAYDUNYA_MASTER_KEY = os.environ.get('PAYDUNYA_MASTER_KEY', '').strip()

PAYDUNYA_PRIVATE_KEY = os.environ.get('PAYDUNYA_PRIVATE_KEY', '').strip()

PAYDUNYA_TOKEN = os.environ.get('PAYDUNYA_TOKEN', '').strip()

PAYDUNYA_STORE_NAME = os.environ.get('PAYDUNYA_STORE_NAME', 'KOJO')

# API de décaissement PayDunya (versements aux travailleurs)
PAYDUNYA_DISBURSE_BASE_URL = "https://app.paydunya.com/api/v2/disburse"

FRONTEND_APP_URL = os.environ.get('FRONTEND_APP_URL', '').rstrip('/')

BACKEND_PUBLIC_URL = os.environ.get('BACKEND_PUBLIC_URL', '').rstrip('/')

EMAIL_OTP_RESEND_COOLDOWN_SECONDS = int(os.environ.get('EMAIL_OTP_RESEND_COOLDOWN_SECONDS', '60'))

EMAIL_VERIFICATION_TOKEN_MINUTES = int(os.environ.get('EMAIL_VERIFICATION_TOKEN_MINUTES', '30'))

GMAIL_CLIENT_ID = os.environ.get('GMAIL_CLIENT_ID', '').strip()

GMAIL_CLIENT_SECRET = os.environ.get('GMAIL_CLIENT_SECRET', '').strip()

GMAIL_REFRESH_TOKEN = os.environ.get('GMAIL_REFRESH_TOKEN', '').strip()

GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL', '').strip()

GMAIL_SENDER_NAME = os.environ.get('GMAIL_SENDER_NAME', 'KOJO').strip() or 'KOJO'

GMAIL_TOKEN_REFRESH_RETRIES = max(1, int(os.environ.get('GMAIL_TOKEN_REFRESH_RETRIES', '3')))

GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS = max(0.5, float(os.environ.get('GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS', '1')))

GMAIL_ACCESS_TOKEN_SAFETY_SECONDS = max(30, int(os.environ.get('GMAIL_ACCESS_TOKEN_SAFETY_SECONDS', '60')))

GMAIL_ACCESS_TOKEN_CACHE: Dict[str, Any] = {"access_token": "", "expires_at": 0.0}

EMAIL_PROVIDER = os.environ.get('EMAIL_PROVIDER', 'brevo').strip().lower()

BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '').strip()

BREVO_SENDER_EMAIL = os.environ.get('BREVO_SENDER_EMAIL', '').strip()

BREVO_SENDER_NAME = os.environ.get('BREVO_SENDER_NAME', 'KOJO').strip() or 'KOJO'

PASSWORD_RESET_FROM_EMAIL = os.environ.get('PASSWORD_RESET_FROM_EMAIL', BREVO_SENDER_EMAIL).strip() or BREVO_SENDER_EMAIL

BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

GMAIL_DEPRECATED_NOTICE = 'Gmail OAuth disabled in favor of Brevo'

VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '').strip()

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '').strip()

VAPID_CLAIMS_EMAIL = os.environ.get('VAPID_CLAIMS_EMAIL', 'mailto:kojo@example.com').strip()

DEFAULT_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com; connect-src 'self' https://api.cloudinary.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

DOCS_SECURITY_HEADERS = {
    **DEFAULT_SECURITY_HEADERS,
    "Content-Security-Policy": "default-src 'self' https://cdn.jsdelivr.net https://fastapi.tiangolo.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; connect-src 'self'; font-src 'self' https://cdn.jsdelivr.net data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

def get_security_headers_for_path(path: str) -> dict:
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi.json"):
        return DOCS_SECURITY_HEADERS
    return DEFAULT_SECURITY_HEADERS

OWNER_EMAIL = os.environ.get('OWNER_EMAIL', '').strip()

# Alias legacy (même valeur que OWNER_EMAIL) — centralisé ici pour que les
# routers utilisent la constante au lieu de lire os.environ directement.
FAMAKAN_OWNER_EMAIL = os.environ.get('FAMAKAN_OWNER_EMAIL', '').strip() or OWNER_EMAIL

OWNER_USER_ID = os.environ.get('OWNER_USER_ID', 'famakan_kontaga_master_2024').strip() or 'famakan_kontaga_master_2024'

OWNER_INITIAL_PASSWORD = os.environ.get('OWNER_INITIAL_PASSWORD', '').strip()
