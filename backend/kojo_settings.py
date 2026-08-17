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
APP_VERSION = "1.0.1"

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
        "across multiple worker processes. Set JWT_SECRET on Render (a long "
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
        "on a silent fallback. Set EMAIL_OTP_SECRET on Render and redeploy."
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
