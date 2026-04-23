from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, Request, Response, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import logging.handlers
import sys
import re
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, validator, ValidationError
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
from enum import Enum
import shutil
import base64
import io
import cloudinary
from cloudinary import uploader as cloudinary_uploader
import requests
import secrets
import hashlib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr

# Configure logging for West Africa production
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.handlers.RotatingFileHandler(
            'kojo_backend.log',
            maxBytes=10*1024*1024,
            backupCount=5
        )
    ]
)
logger = logging.getLogger("kojo_backend")

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
cloudinary.config(secure=True)
def upload_profile_photo_to_cloudinary(file_obj, user_identifier: str):
    result = cloudinary_uploader.upload(
        file_obj,
        folder="kojo/profile_photos",
        public_id=f"profile_{user_identifier}_{uuid.uuid4().hex}",
        resource_type="image"
    )
    return {
        "photo_url": result.get("secure_url") or result.get("url"),
        "public_id": result.get("public_id")
    }

# MongoDB connection - Enhanced error handling
try:
    mongo_url = os.environ.get('MONGO_URL')
    if not mongo_url:
        raise ValueError("MONGO_URL environment variable is required")
    
    db_name = os.environ.get('DB_NAME', 'kojo_db')  # Default fallback
    if not db_name:
        raise ValueError("DB_NAME environment variable is required")
    
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    
    # Test connection on startup
    logger.info(f"✅ MongoDB connected to: {db_name}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    raise

# MongoDB Indexes for Performance (West Africa optimization)
async def create_database_indexes():
    """Create indexes on frequently queried fields for better performance"""
    try:
        # Users collection indexes
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.users.create_index("user_type")
        await db.users.create_index("country")
        await db.users.create_index([("email", 1), ("password_hash", 1)])
        
        # Jobs collection indexes
        await db.jobs.create_index("id", unique=True)
        await db.jobs.create_index("client_id")
        await db.jobs.create_index("status")
        await db.jobs.create_index("category")
        await db.jobs.create_index("country")
        await db.jobs.create_index([("status", 1), ("category", 1)])
        await db.jobs.create_index([("created_at", -1)])  # For sorting by date
        
        # Proposals collection indexes
        await db.proposals.create_index("id", unique=True)
        await db.proposals.create_index("job_id")
        await db.proposals.create_index("worker_id")
        await db.proposals.create_index([("job_id", 1), ("worker_id", 1)])
        
        # Messages collection indexes
        await db.messages.create_index("id", unique=True)
        await db.messages.create_index("job_id")
        await db.messages.create_index([("sender_id", 1), ("receiver_id", 1)])
        await db.messages.create_index([("created_at", -1)])
        
        # Commissions collection indexes
        await db.commissions.create_index("id", unique=True)
        await db.commissions.create_index("job_id")
        await db.commissions.create_index("worker_id")
        await db.commissions.create_index("status")
        await db.commissions.create_index([("created_at", -1)])

        # Payments collection indexes
        await db.payments.create_index("id", unique=True)
        await db.payments.create_index("job_id")
        await db.payments.create_index("payer_id")
        await db.payments.create_index("receiver_id")
        await db.payments.create_index("status")
        await db.payments.create_index("invoice_token", sparse=True)
        await db.payments.create_index([("created_at", -1)])

        # Email OTP collection indexes
        await db.email_otps.create_index([("email", 1), ("purpose", 1)], unique=True)
        await db.email_otps.create_index("expires_at", expireAfterSeconds=0)
        await db.email_otps.create_index([("created_at", -1)])
        
        logger.info("✅ MongoDB indexes created successfully")
    except Exception as e:
        logger.warning(f"⚠️ Error creating indexes (may already exist): {e}")

# JWT Settings - Enhanced Security
JWT_SECRET = os.environ.get('JWT_SECRET', 'kojo-prod-secret-2025-afrique-ouest-' + str(uuid.uuid4()))
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24
JWT_REFRESH_EXPIRATION_DAYS = 7

# Gmail OTP settings
EMAIL_OTP_SECRET = os.environ.get('EMAIL_OTP_SECRET', JWT_SECRET)
EMAIL_OTP_EXPIRY_MINUTES = int(os.environ.get('EMAIL_OTP_EXPIRY_MINUTES', '10'))
EMAIL_OTP_MAX_ATTEMPTS = int(os.environ.get('EMAIL_OTP_MAX_ATTEMPTS', '5'))

# Real payment gateway settings (Pack 2)
PAYMENT_COMMISSION_RATE = float(os.environ.get('PAYMENT_COMMISSION_RATE', '0.14'))
PAYDUNYA_MODE = os.environ.get('PAYDUNYA_MODE', 'test').strip().lower()
PAYDUNYA_MASTER_KEY = os.environ.get('PAYDUNYA_MASTER_KEY', '').strip()
PAYDUNYA_PRIVATE_KEY = os.environ.get('PAYDUNYA_PRIVATE_KEY', '').strip()
PAYDUNYA_TOKEN = os.environ.get('PAYDUNYA_TOKEN', '').strip()
PAYDUNYA_STORE_NAME = os.environ.get('PAYDUNYA_STORE_NAME', 'KOJO')
FRONTEND_APP_URL = os.environ.get('FRONTEND_APP_URL', '').rstrip('/')
BACKEND_PUBLIC_URL = os.environ.get('BACKEND_PUBLIC_URL', '').rstrip('/')
EMAIL_OTP_RESEND_COOLDOWN_SECONDS = int(os.environ.get('EMAIL_OTP_RESEND_COOLDOWN_SECONDS', '60'))
EMAIL_VERIFICATION_TOKEN_MINUTES = int(os.environ.get('EMAIL_VERIFICATION_TOKEN_MINUTES', '30'))
GMAIL_CLIENT_ID = os.environ.get('GMAIL_CLIENT_ID', '').strip()
GMAIL_CLIENT_SECRET = os.environ.get('GMAIL_CLIENT_SECRET', '').strip()
GMAIL_REFRESH_TOKEN = os.environ.get('GMAIL_REFRESH_TOKEN', '').strip()
GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL', '').strip()
GMAIL_SENDER_NAME = os.environ.get('GMAIL_SENDER_NAME', 'KOJO').strip() or 'KOJO'

# Security Headers for West Africa
DEFAULT_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

DOCS_SECURITY_HEADERS = {
    **DEFAULT_SECURITY_HEADERS,
    "Content-Security-Policy": "default-src 'self' https://cdn.jsdelivr.net https://fastapi.tiangolo.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; connect-src 'self'; font-src 'self' https://cdn.jsdelivr.net data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

def get_security_headers_for_path(path: str) -> dict:
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi.json"):
        return DOCS_SECURITY_HEADERS
    return DEFAULT_SECURITY_HEADERS

# Owner/Admin configuration - SEUL FAMAKAN KONTAGA MASTER A ACCÈS
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', '').strip()
OWNER_USER_ID = os.environ.get('OWNER_USER_ID', 'famakan_kontaga_master_2024').strip() or 'famakan_kontaga_master_2024'
OWNER_INITIAL_PASSWORD = os.environ.get('OWNER_INITIAL_PASSWORD', '').strip()

# Create the main app without a prefix
app = FastAPI(title="Kojo API", description="Service/Worker Platform for Mali & Senegal")

# Middleware pour compression gzip (optimisation réseaux lents Afrique de l'Ouest)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Rate limiting simple pour protection (West Africa specific)
from collections import defaultdict
import time

# Stockage simple en mémoire pour rate limiting
request_counts = defaultdict(list)

def rate_limit_check(client_ip: str, max_requests: int = 100, window_minutes: int = 1) -> bool:
    """Vérification simple du rate limiting"""
    now = time.time()
    window_start = now - (window_minutes * 60)
    
    # Nettoyer les anciennes entrées
    request_counts[client_ip] = [req_time for req_time in request_counts[client_ip] if req_time > window_start]
    
    # Vérifier si la limite est dépassée
    if len(request_counts[client_ip]) >= max_requests:
        return False
    
    # Ajouter la requête actuelle
    request_counts[client_ip].append(now)
    return True

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Custom Security Middleware for West Africa
class WestAfricaSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        for header, value in get_security_headers_for_path(request.url.path).items():
            response.headers[header] = value

        response.headers["X-Kojo-Region"] = "west-africa"
        response.headers["X-Kojo-Version"] = "1.0.0"

        if request.url.path.startswith("/docs") or request.url.path.startswith("/redoc"):
            response.headers["Cache-Control"] = "no-store"
        elif request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "public, max-age=300"  # 5 minutes cache

        return response

# Fonction pour vérifier si l'utilisateur est le propriétaire
async def verify_owner_access(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Vérifie que seul le propriétaire peut accéder aux fonctionnalités sensibles"""
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")
        
        # Vérification stricte: seul Famakan Kontaga Master a accès
        if user_id != OWNER_USER_ID or email != OWNER_EMAIL:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès interdit: Fonctionnalité réservée à Famakan Kontaga Master uniquement"
            )
        
        # Récupérer les données utilisateur depuis la DB
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Propriétaire non trouvé"
            )
            
        return user
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expiré"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide"
        )

# Fonction pour créer le compte propriétaire s'il n'existe pas
async def ensure_owner_exists():
    """Crée le compte propriétaire s'il n'existe pas déjà et si les secrets requis sont fournis."""
    if not OWNER_EMAIL:
        logger.warning("⚠️ OWNER_EMAIL non défini: création automatique du compte owner désactivée.")
        return

    existing_owner = await db.users.find_one({"id": OWNER_USER_ID})
    if existing_owner:
        logger.info(f"✅ Compte owner existe déjà: {OWNER_EMAIL}")
        return

    if not OWNER_INITIAL_PASSWORD:
        logger.warning("⚠️ Compte owner absent et OWNER_INITIAL_PASSWORD non défini: aucune création automatique effectuée.")
        return

    if len(OWNER_INITIAL_PASSWORD) < 12:
        logger.warning("⚠️ OWNER_INITIAL_PASSWORD trop court (minimum 12 caractères): création automatique du compte owner refusée.")
        return

    hashed_password = bcrypt.hashpw(OWNER_INITIAL_PASSWORD.encode('utf-8'), bcrypt.gensalt())

    owner_data = {
        "id": OWNER_USER_ID,
        "email": OWNER_EMAIL,
        "password_hash": hashed_password.decode('utf-8'),
        "first_name": "Famakan",
        "last_name": "Kontaga Master",
        "user_type": "owner",
        "phone": "+223701234567",
        "country": "mali",
        "preferred_language": "fr",
        "profile_photo": None,
        "is_verified": True,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "is_owner": True,
        "permissions": [
            "commission_access",
            "debug_access",
            "admin_access",
            "full_dashboard_access",
            "mobile_test_access",
            "photo_debug_access"
        ]
    }

    await db.users.insert_one(owner_data)
    logger.info(f"✅ Compte owner créé: {OWNER_EMAIL}")
    logger.warning("⚠️ Changez OWNER_INITIAL_PASSWORD après la première connexion et retirez-le ensuite du fichier .env.")

# Enums
class UserType(str, Enum):
    CLIENT = "client"
    WORKER = "worker"
    OWNER = "owner"

class JobStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress" 
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class PaymentMethod(str, Enum):
    ORANGE_MONEY = "orange_money"  
    WAVE = "wave"
    BANK_ACCOUNT = "bank_account"

class Language(str, Enum):
    FRENCH = "fr"
    ENGLISH = "en"
    WOLOF = "wo"
    BAMBARA = "bm"
    MOORE = "mos"  # Mooré - Langue principale du Burkina Faso

class Country(str, Enum):
    """4 pays prioritaires pour le lancement de Kojo"""
    SENEGAL = "senegal"      # 🇸🇳 Pays principal - Dakar hub tech
    MALI = "mali"            # 🇲🇱 Pays prioritaire - Bamako  
    IVORY_COAST = "ivory_coast"  # 🇨🇮 Pays prioritaire - Abidjan hub économique
    BURKINA_FASO = "burkina_faso"  # 🇧🇫 Pays prioritaire - Ouagadougou

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str = Field(min_length=60, max_length=100)  # bcrypt hash length
    first_name: str = Field(min_length=2, max_length=50, pattern=r'^[a-zA-ZÀ-ÿ\s\-\'0-9_\.]+$', description="Prénom")
    last_name: str = Field(min_length=2, max_length=50, pattern=r'^[a-zA-ZÀ-ÿ\s\-\'0-9_\.]+$', description="Nom de famille")
    phone: str = Field(description="Numéro de téléphone international")
    user_type: UserType
    country: Country
    preferred_language: Language
    
    @validator('phone')
    def validate_phone(cls, v):
        """Nettoie et valide le numéro de téléphone pour l'Afrique de l'Ouest"""
        if not v:
            raise ValueError("Le numéro de téléphone est requis")
        
        # Nettoyer le numéro - supprimer espaces, tirets, parenthèses
        clean_phone = re.sub(r'[\s\-\(\)]', '', v)
        
        # Vérifier le format international de base
        if not clean_phone.startswith('+'):
            raise ValueError("Le numéro de téléphone doit commencer par +")
        
        # Extraire les chiffres seulement
        digits_only = ''.join(filter(str.isdigit, clean_phone))
        
        # Vérifier que c'est un pays ouest-africain supporté
        west_african_codes = ['221', '223', '225', '226']  # Sénégal, Mali, Côte d'Ivoire, Burkina Faso
        
        valid_country = False
        for code in west_african_codes:
            if digits_only.startswith(code):
                valid_country = True
                # Vérifier la longueur totale (code pays + numéro)
                if len(digits_only) < 11 or len(digits_only) > 12:
                    raise ValueError(f"Numéro {code} doit contenir 8-9 chiffres après l'indicatif pays")
                
                # Vérifier que le préfixe opérateur est valide (70-99 pour Orange/Wave)
                if len(digits_only) >= 5:
                    operator_prefix = digits_only[3:5]
                    if not (70 <= int(operator_prefix) <= 99):
                        # Autoriser aussi quelques autres préfixes connus
                        other_valid = ['65', '66', '67', '68', '58', '59', '48', '49', '51', '52', '33', '75', '76']
                        if operator_prefix not in other_valid:
                            raise ValueError(f"Préfixe opérateur {operator_prefix} non supporté pour +{code}")
                break
        
        if not valid_country:
            raise ValueError("Seuls les numéros du Sénégal (+221), Mali (+223), Côte d'Ivoire (+225) et Burkina Faso (+226) sont supportés")
        
        return clean_phone
    profile_photo: Optional[str] = Field(None, max_length=500)  # URL length limit
    is_verified: bool = False
    email_verified: bool = False
    email_verified_at: Optional[datetime] = None
    payment_accounts: Optional[dict] = Field(None)  # Payment methods dict
    payment_accounts_count: int = Field(default=0, ge=0, le=10)  # Non-negative, max 10
    rating: float = Field(default=0.0, ge=0.0, le=5.0)  # Rating between 0-5
    total_reviews: int = Field(default=0, ge=0)  # Non-negative
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class WorkerProfile(BaseModel):
    user_id: str
    specialties: List[str] = Field(default=[], max_items=10)  # Max 10 specialties
    experience_years: int = Field(default=0, ge=0, le=50)  # 0-50 years experience

    cv_file: Optional[str] = Field(None, max_length=500)  # File path length limit
    portfolio_images: List[str] = Field(default=[], max_items=10)  # Max 10 portfolio images
    availability: bool = True
    description: Optional[str] = Field(None, max_length=1000)  # Description length limit
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: str
    title: str = Field(min_length=5, max_length=200)  # Title length constraints
    description: str = Field(min_length=20, max_length=5000)  # Description constraints
    category: str = Field(min_length=3, max_length=50)  # Category constraints
    budget_min: float = Field(ge=0.0, le=10000000.0)  # Min 0, max 10M FCFA
    budget_max: float = Field(ge=0.0, le=10000000.0)  # Min 0, max 10M FCFA
    location: dict = Field(...)  # Location structure
    status: JobStatus = JobStatus.OPEN
    required_skills: List[str] = Field(default=[], max_items=20)  # Max 20 skills
    estimated_duration: Optional[str] = Field(None, max_length=100)  # Duration string limit
    posted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deadline: Optional[datetime] = None
    assigned_worker_id: Optional[str] = None
    # Nouvelles informations pour mécaniciens avec validation
    mechanic_must_bring_parts: bool = False
    mechanic_must_bring_tools: bool = False  
    parts_and_tools_notes: Optional[str] = Field(None, max_length=1000)  # Notes length limit
    
    # Validation custom pour budget cohérent
    @validator('budget_max')
    def budget_max_must_be_greater_than_min(cls, v, values):
        if 'budget_min' in values and v < values['budget_min']:
            raise ValueError('budget_max must be greater than or equal to budget_min')
        return v

class JobProposal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    worker_id: str
    proposed_amount: float = Field(ge=0.0, le=10000000.0)  # Valid amount range
    estimated_completion_time: str = Field(min_length=1, max_length=100)  # Time estimate
    message: str = Field(min_length=10, max_length=2000)  # Proposal message
    status: str = Field(default="pending", pattern=r'^(pending|accepted|rejected)$')  # Valid statuses only
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    sender_id: str
    receiver_id: str
    content: str = Field(min_length=1, max_length=5000)  # Message content limits
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    read: bool = False

class PaymentStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed" 
    FAILED = "failed"
    CANCELLED = "cancelled"

class Payment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    payer_id: str
    receiver_id: str
    amount: float = Field(gt=0.0, le=10000000.0)  # Positive amount, max 10M FCFA
    payment_method: PaymentMethod
    transaction_id: Optional[str] = Field(None, max_length=200)  # Transaction ID limit
    status: PaymentStatus = PaymentStatus.PENDING  # Use enum for better validation
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PaymentQuoteRequest(BaseModel):
    amount: float = Field(gt=0.0, le=10000000.0)
    payment_method: PaymentMethod
    country: Optional[str] = Field(default='senegal', max_length=50)
    worker_id: Optional[str] = Field(default=None, max_length=100)
    job_id: Optional[str] = Field(default=None, max_length=100)

class PaymentCheckoutRequest(PaymentQuoteRequest):
    return_url: Optional[str] = Field(default=None, max_length=500)
    cancel_url: Optional[str] = Field(default=None, max_length=500)

class PushToken(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    push_token: str = Field(min_length=10, max_length=500)  # Expo push token length
    device_type: str = Field(min_length=2, max_length=50)  # ios, android, web
    device_id: Optional[str] = Field(None, max_length=200)  # Optional device identifier
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Request/Response Models
# Pattern pour détecter les tentatives d'injection SQL
SQL_INJECTION_PATTERN = re.compile(r"['\";#\-\-]|(/\*)|(\*/)|(\bOR\b)|(\bAND\b)|(\bUNION\b)|(\bSELECT\b)|(\bDROP\b)|(\bINSERT\b)|(\bDELETE\b)|(\bUPDATE\b)", re.IGNORECASE)

def validate_no_sql_injection(value: str, field_name: str) -> str:
    """Valider qu'une chaîne ne contient pas de caractères d'injection SQL"""
    if SQL_INJECTION_PATTERN.search(value):
        raise ValueError(f"Le champ {field_name} contient des caractères non autorisés")
    return value

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100, description="Mot de passe (minimum 6 caractères)")
    first_name: str = Field(min_length=2, max_length=50)
    last_name: str = Field(min_length=2, max_length=50)
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language
    
    @validator('password')
    def password_must_be_strong(cls, v):
        if not v or len(v.strip()) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v
    
    @validator('email')
    def email_no_injection(cls, v):
        # Vérifier que l'email ne contient pas de tentatives d'injection
        email_str = str(v)
        if SQL_INJECTION_PATTERN.search(email_str):
            raise ValueError("L'adresse email contient des caractères non autorisés")
        return v
    
    @validator('first_name', 'last_name')
    def names_no_injection(cls, v):
        if SQL_INJECTION_PATTERN.search(v):
            raise ValueError("Le nom contient des caractères non autorisés")
        return v

class PaymentAccount(BaseModel):
    orange_money: Optional[str] = None     # Numéro de téléphone Orange Money
    wave: Optional[str] = None            # Numéro de téléphone Wave  
    bank_account: Optional[dict] = None   # Informations complètes de compte bancaire
    # Détails du compte bancaire:
    # {
    #   "account_number": "1234567890",
    #   "bank_name": "Banque Atlantique",
    #   "account_holder": "Nom du titulaire",
    #   "bank_code": "BK001",
    #   "branch": "Dakar Plateau",
    #   "iban": "SN12 K011 2345 6789 0123 4567 89" (optionnel)
    # }

class UserWithPayment(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100, description="Mot de passe (minimum 6 caractères)")
    first_name: str = Field(min_length=2, max_length=50)
    last_name: str = Field(min_length=2, max_length=50)
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language
    payment_accounts: PaymentAccount
    email_verification_token: str = Field(min_length=20, description="Jeton de vérification email")
    
    @validator('password')
    def password_must_be_strong(cls, v):
        if not v or len(v.strip()) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v
    # Informations spécifiques aux travailleurs (optionnelles)
    worker_specialties: Optional[List[str]] = None
    worker_experience_years: Optional[int] = None

    # Photo de profil optionnelle pour tous
    profile_photo_base64: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class EmailOtpRequest(BaseModel):
    email: EmailStr
    purpose: str = Field(default="signup", pattern=r'^(signup|password_reset)$')

class EmailOtpVerifyRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=8, pattern=r'^\d{4,8}$')
    purpose: str = Field(default="signup", pattern=r'^(signup|password_reset)$')

class EmailOtpResendRequest(BaseModel):
    email: EmailStr
    purpose: str = Field(default="signup", pattern=r'^(signup|password_reset)$')

class PasswordResetConfirmRequest(BaseModel):
    email: EmailStr
    verification_token: str = Field(min_length=20)
    new_password: str = Field(min_length=6, max_length=128)

    @validator('new_password')
    def password_must_be_strong(cls, v):
        if not v or len(v.strip()) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v

class JobCreate(BaseModel):
    title: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=20, max_length=5000)
    category: str = Field(min_length=3, max_length=50)
    budget_min: float = Field(ge=0.0, le=10000000.0)
    budget_max: float = Field(ge=0.0, le=10000000.0)
    location: dict = Field(...)
    required_skills: List[str] = Field(default=[], max_items=20)
    estimated_duration: Optional[str] = Field(None, max_length=100)
    deadline: Optional[datetime] = None
    # Nouvelles informations pour mécaniciens avec validation
    mechanic_must_bring_parts: bool = False
    mechanic_must_bring_tools: bool = False
    parts_and_tools_notes: Optional[str] = Field(None, max_length=1000)
    
    @validator('budget_max')
    def budget_max_must_be_greater_than_min(cls, v, values):
        if 'budget_min' in values and v < values['budget_min']:
            raise ValueError('budget_max must be greater than or equal to budget_min')
        return v

class ProposalCreate(BaseModel):
    proposed_amount: float = Field(gt=0.0, le=10000000.0)
    estimated_completion_time: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=10, max_length=2000)

class MessageCreate(BaseModel):
    receiver_id: str
    content: str = Field(min_length=1, max_length=5000)

class PushTokenCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    push_token: str = Field(min_length=10, max_length=500)
    device_type: str = Field(min_length=2, max_length=50, pattern=r'^(ios|android|web)$')
    device_id: Optional[str] = Field(None, max_length=200)

# Utility Functions
# Validation functions
def validate_payment_accounts(payment_accounts: PaymentAccount, user_type: str) -> dict:
    """Valide les comptes de paiement selon le type d'utilisateur"""
    
    # Compter le nombre de comptes liés
    linked_accounts = 0
    account_details = {}
    
    if payment_accounts.orange_money:
        if not validate_orange_money_number(payment_accounts.orange_money):
            raise HTTPException(status_code=400, detail="Numéro Orange Money invalide")
        linked_accounts += 1
        account_details['orange_money'] = payment_accounts.orange_money
    
    if payment_accounts.wave:
        if not validate_wave_number(payment_accounts.wave):
            raise HTTPException(status_code=400, detail="Numéro Wave invalide")
        linked_accounts += 1
        account_details['wave'] = payment_accounts.wave
    
    if payment_accounts.bank_account:
        if not validate_bank_account(payment_accounts.bank_account):
            raise HTTPException(status_code=400, detail="Informations de compte bancaire invalides")
        linked_accounts += 1
        account_details['bank_account'] = mask_bank_account_info(payment_accounts.bank_account)
    
    # Validation selon le type d'utilisateur
    if user_type == "client":
        if linked_accounts < 1:
            raise HTTPException(
                status_code=400, 
                detail="Les clients doivent lier au moins 1 moyen de paiement (Orange Money, Wave ou Compte bancaire)"
            )
    elif user_type == "worker":
        if linked_accounts < 2:
            raise HTTPException(
                status_code=400,
                detail="Les travailleurs doivent lier au minimum 2 moyens de paiement sur 3 disponibles (Orange Money, Wave, Compte bancaire)"
            )
    
    return {
        "linked_accounts_count": linked_accounts,
        "account_details": account_details,
        "is_verified": True
    }

# Préfixes mobiles pour validation Orange Money et Wave
ALL_PREFIXES_70_99 = [str(i) for i in range(70, 100)]

# Côte d'Ivoire a des préfixes spécifiques (01, 05, 07, 08, 09 + 40-59 pour MTN + 70-99 pour Orange)
COTE_DIVOIRE_ALL_MOBILE_PREFIXES = (
    ['01', '05', '07', '08', '09'] +  # Nouveaux préfixes 10 chiffres
    [str(i).zfill(2) for i in range(40, 60)] +  # MTN 40-59
    [str(i) for i in range(70, 100)]  # Orange 70-99
)

# Mobile Number Validation - 4 PAYS PRIORITAIRES KOJO
KOJO_PRIORITY_COUNTRIES = {
    # Sénégal (+221) - Pays principal
    '221': {
        'country': 'Sénégal',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Sénégal - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Sénégal - tous préfixes 70-99
        'other_operators': ['76', '75', '33'],  # Tigo, Expresso
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Mali (+223) - Pays prioritaire  
    '223': {
        'country': 'Mali',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Mali - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Mali - tous préfixes 70-99
        'other_operators': ['65', '66', '67', '68'],  # Malitel
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Côte d'Ivoire (+225) - Pays prioritaire avec tous les préfixes mobiles
    '225': {
        'country': "Côte d'Ivoire", 
        'orange_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Orange + tous préfixes mobiles CI
        'wave_prefixes': COTE_DIVOIRE_ALL_MOBILE_PREFIXES,  # Wave + tous préfixes mobiles CI
        'other_operators': ['58', '59', '48', '49'],  # MTN
        'currency': 'FCFA',
        'primary_language': 'français'
    },
    # Burkina Faso (+226) - Pays prioritaire
    '226': {
        'country': 'Burkina Faso',
        'orange_prefixes': ALL_PREFIXES_70_99,  # Orange Burkina Faso - tous préfixes 70-99
        'wave_prefixes': ALL_PREFIXES_70_99,  # Wave Burkina Faso - tous préfixes 70-99
        'other_operators': ['70', '71', '51', '52'],  # Telmob
        'currency': 'FCFA',
        'primary_language': 'français'
    }
}

def validate_orange_money_number(number: str) -> bool:
    """Valide un numéro Orange Money avec précision par pays"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Orange Money number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        logger.debug(f"Orange Money validation - Original: {number}, Cleaned: {clean_number}")
        
        if len(clean_number) < 11 or len(clean_number) > 12:
            logger.info(f"Orange Money number length invalid: {len(clean_number)} digits for {clean_number}")
            return False
        
        country_code = clean_number[:3]
        operator_prefix = clean_number[3:5]
        logger.debug(f"Orange Money validation - Country: {country_code}, Prefix: {operator_prefix}")
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Orange Money not supported for country code: {country_code}")
            return False
            
        # Vérification sécurisée des préfixes
        country_data = KOJO_PRIORITY_COUNTRIES.get(country_code, {})
        valid_prefixes = country_data.get('orange_prefixes', [])
        
        if not valid_prefixes:
            logger.error(f"No Orange Money prefixes defined for country {country_code}")
            return False
            
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Orange Money prefix {operator_prefix} for country {country_code}. Valid: {valid_prefixes[:5]}...")
        else:
            logger.info(f"✅ Valid Orange Money number validated for {country_data.get('country', country_code)}")
            
        return is_valid
        
    except KeyError as e:
        logger.error(f"KeyError in Orange Money validation: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error validating Orange Money number: {e}")
        return False

def validate_wave_number(number: str) -> bool:
    """Valide un numéro Wave - 4 pays prioritaires Kojo"""
    try:
        if not number or not isinstance(number, str):
            logger.warning(f"Invalid Wave number format: {number}")
            return False
            
        # Nettoyage et validation basique
        clean_number = ''.join(filter(str.isdigit, number.replace('+', '')))
        
        if len(clean_number) < 11 or len(clean_number) > 12:
            logger.info(f"Wave number length invalid: {len(clean_number)} digits")
            return False
        
        country_code = clean_number[:3]
        operator_prefix = clean_number[3:5]
        
        if country_code not in KOJO_PRIORITY_COUNTRIES:
            logger.info(f"Wave not supported for country code: {country_code}")
            return False
            
        valid_prefixes = KOJO_PRIORITY_COUNTRIES[country_code]['wave_prefixes']
        is_valid = operator_prefix in valid_prefixes
        
        if not is_valid:
            logger.info(f"Invalid Wave prefix {operator_prefix} for country {country_code}")
        else:
            logger.info(f"Valid Wave number validated for {KOJO_PRIORITY_COUNTRIES[country_code]['country']}")
            
        return is_valid
        
    except Exception as e:
        logger.error(f"Error validating Wave number: {e}")
        return False

def validate_bank_card(card_number: str) -> bool:
    """Valide basiquement un numéro de carte bancaire"""
    # Supprimer les espaces et tirets
    clean_card = ''.join(filter(str.isdigit, card_number))
    
    # Vérifier la longueur (16 chiffres généralement)
    if len(clean_card) not in [15, 16]:
        return False
    
    # Algorithme de Luhn simplifié
    return luhn_check(clean_card)

def luhn_check(card_number: str) -> bool:
    """Algorithme de Luhn pour validation carte bancaire"""
    def digits_of(n):
        return [int(d) for d in str(n)]
    
    digits = digits_of(card_number)
    odd_digits = digits[-1::-2]
    even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits:
        checksum += sum(digits_of(d*2))
    return checksum % 10 == 0

def mask_bank_card(card_number: str) -> str:
    """Masque le numéro de carte bancaire"""
    clean_card = ''.join(filter(str.isdigit, card_number))
    if len(clean_card) >= 16:
        return f"****-****-****-{clean_card[-4:]}"
    elif len(clean_card) >= 15:
        return f"****-****-***-{clean_card[-4:]}"
    return "****-****-****"

def validate_bank_account(bank_account: dict) -> bool:
    """Valide les informations de compte bancaire"""
    if not isinstance(bank_account, dict):
        return False
    
    # Vérifier les champs obligatoires
    required_fields = ["account_number", "bank_name", "account_holder"]
    for field in required_fields:
        if not bank_account.get(field):
            return False
    
    # Valider le numéro de compte (au moins 8 chiffres)
    account_number = ''.join(filter(str.isdigit, bank_account["account_number"]))
    if len(account_number) < 8:
        return False
    
    # Valider le nom de la banque (au moins 3 caractères)
    if len(bank_account["bank_name"].strip()) < 3:
        return False
    
    # Valider le nom du titulaire (au moins 2 caractères)
    if len(bank_account["account_holder"].strip()) < 2:
        return False
    
    return True

def mask_bank_account_info(bank_account: dict) -> dict:
    """Masque les informations sensibles du compte bancaire"""
    if not isinstance(bank_account, dict):
        return {}
    
    masked_account = bank_account.copy()
    
    # Masquer le numéro de compte
    account_number = bank_account.get("account_number", "")
    clean_account = ''.join(filter(str.isdigit, account_number))
    if len(clean_account) >= 8:
        masked_account["account_number"] = f"****{clean_account[-4:]}"
    else:
        masked_account["account_number"] = "****"
    
    # Garder les autres informations non sensibles
    return {
        "account_number": masked_account["account_number"],
        "bank_name": bank_account.get("bank_name", ""),
        "account_holder": bank_account.get("account_holder", ""),
        "bank_code": bank_account.get("bank_code", ""),
        "branch": bank_account.get("branch", "")
    }
    
def log_and_raise_http_exception(status_code: int, detail: str, logger_instance=None):
    """Enregistre l'erreur et lève une HTTPException de manière centralisée"""
    if logger_instance is None:
        logger_instance = logger
    
    logger_instance.error(f"HTTP {status_code}: {detail}")
    raise HTTPException(status_code=status_code, detail=detail)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def sanitize_email(email: str) -> str:
    """Sanitize email to prevent injection attacks"""
    if not email:
        raise ValueError("Email cannot be empty")
    
    # Remove potentially dangerous characters
    dangerous_chars = ['*', '/', '\\', '$', '{', '}', '[', ']', '(', ')', '#', '&', '|', '<', '>']
    for char in dangerous_chars:
        if char in email:
            raise ValueError(f"Email contains invalid character: {char}")
    
    # Additional check for SQL injection patterns (with word boundaries to avoid false positives)
    # Check for SQL keywords as complete words, not substrings
    import re
    sql_keywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC', 'EXECUTE']
    email_upper = email.upper()
    
    # Check for SQL keywords as standalone words (not part of other words)
    for keyword in sql_keywords:
        if re.search(r'\b' + keyword + r'\b', email_upper):
            raise ValueError(f"Email contains prohibited SQL keyword: {keyword}")
    
    # Check for SQL comment patterns
    if '--' in email or '/*' in email or '*/' in email:
        raise ValueError("Email contains prohibited SQL comment pattern")
    
    return email.lower().strip()

def sanitize_input_string(input_str: str, field_name: str = "field") -> str:
    """Sanitize general string inputs"""
    if not input_str:
        return ""
    
    # Remove control characters
    sanitized = ''.join(char for char in input_str if ord(char) >= 32 or char in '\n\t')
    
    # Limit length to prevent buffer overflow attacks
    if len(sanitized) > 1000:
        raise ValueError(f"{field_name} is too long (max 1000 characters)")
    
    return sanitized.strip()

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

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

def get_gmail_access_token() -> str:
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

    if not token_response.ok:
        logger.error(f"❌ Gmail token refresh failed: {token_response.text}")
        raise HTTPException(status_code=502, detail="Impossible d'obtenir un accès Gmail. Vérifiez la configuration OAuth Google.")

    access_token = token_response.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Réponse OAuth Gmail invalide: access_token manquant")
    return access_token

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
    access_token = get_gmail_access_token()
    gmail_response = requests.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        },
        json={"raw": raw_message},
        timeout=20
    )

    if not gmail_response.ok:
        logger.error(f"❌ Gmail send failed: {gmail_response.text}")
        raise HTTPException(status_code=502, detail="Échec d'envoi Gmail. Vérifiez le compte expéditeur, les scopes OAuth et le refresh token.")

    return gmail_response.json()

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

    otp_code = generate_email_otp_code()
    otp_hash = hash_email_otp(email, purpose, otp_code)
    expires_at = now + timedelta(minutes=EMAIL_OTP_EXPIRY_MINUTES)
    email_content = build_email_otp_email(purpose, otp_code)
    send_email_via_gmail_api(email, email_content["subject"], email_content["text_body"], email_content["html_body"])

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

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"id": user_id})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return User(**user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Authentication Routes
# Authentication Routes
@api_router.post("/auth/email/check-availability")
async def check_signup_email_availability(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    return {
        "email": clean_email,
        "available": existing_user is None,
        "message": "Adresse email disponible" if not existing_user else "Cette adresse email est déjà utilisée"
    }

@api_router.post("/auth/email/send-otp")
async def send_signup_email_otp(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)

    existing_user = await db.users.find_one({"email": clean_email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Cette adresse email est déjà utilisée")

    return await issue_email_otp(clean_email, payload.purpose)

@api_router.post("/auth/email/resend-otp")
async def resend_signup_email_otp(payload: EmailOtpResendRequest):
    clean_email = sanitize_email(payload.email)

    existing_user = await db.users.find_one({"email": clean_email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Cette adresse email est déjà utilisée")

    return await issue_email_otp(clean_email, payload.purpose)

@api_router.post("/auth/email/verify-otp")
async def verify_signup_email_otp(payload: EmailOtpVerifyRequest):
    clean_email = sanitize_email(payload.email)
    now = datetime.now(timezone.utc)

    otp_record = await db.email_otps.find_one({"email": clean_email, "purpose": payload.purpose})
    if not otp_record:
        raise HTTPException(status_code=404, detail="Aucun code OTP actif pour cet email. Demandez un nouveau code.")

    expires_at = otp_record.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if not expires_at or expires_at <= now:
        await db.email_otps.delete_one({"email": clean_email, "purpose": payload.purpose})
        raise HTTPException(status_code=400, detail="Le code a expiré. Demandez un nouveau code.")

    if otp_record.get("attempt_count", 0) >= EMAIL_OTP_MAX_ATTEMPTS:
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": payload.purpose},
            {
                "$set": {
                    "status": "locked",
                    "updated_at": now
                }
            }
        )
        raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")

    candidate_hash = hash_email_otp(clean_email, payload.purpose, payload.otp)
    if candidate_hash != otp_record.get("otp_hash"):
        new_attempt_count = otp_record.get("attempt_count", 0) + 1
        new_status = "locked" if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS else "pending"
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": payload.purpose},
            {
                "$set": {
                    "attempt_count": new_attempt_count,
                    "updated_at": now,
                    "last_attempt_at": now,
                    "status": new_status
                }
            }
        )
        if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")
        remaining = max(0, EMAIL_OTP_MAX_ATTEMPTS - new_attempt_count)
        raise HTTPException(status_code=400, detail=f"Code invalide. Tentatives restantes: {remaining}.")

    verification_token = create_email_verification_token(clean_email, payload.purpose)
    await db.email_otps.update_one(
        {"email": clean_email, "purpose": payload.purpose},
        {
            "$set": {
                "verified_at": now,
                "updated_at": now,
                "status": "verified"
            }
        }
    )

    return {
        "message": "Email vérifié avec succès.",
        "verification_token": verification_token,
        "masked_email": mask_email_address(clean_email),
        "verified": True
    }

@api_router.post("/auth/password/forgot/request")
async def request_password_reset_otp(payload: EmailOtpRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    if not existing_user:
        return {
            "message": "Si cette adresse email existe, un code de réinitialisation a été envoyé.",
            "masked_email": mask_email_address(clean_email),
            "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
            "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        }

    otp_result = await issue_email_otp(clean_email, "password_reset")
    otp_result["message"] = "Si cette adresse email existe, un code de réinitialisation a été envoyé."
    return otp_result

@api_router.post("/auth/password/forgot/resend")
async def resend_password_reset_otp(payload: EmailOtpResendRequest):
    clean_email = sanitize_email(payload.email)
    existing_user = await db.users.find_one({"email": clean_email}, {"_id": 1})

    if not existing_user:
        return {
            "message": "Si cette adresse email existe, un code de réinitialisation a été envoyé.",
            "masked_email": mask_email_address(clean_email),
            "expires_in_seconds": EMAIL_OTP_EXPIRY_MINUTES * 60,
            "cooldown_seconds": EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        }

    otp_result = await issue_email_otp(clean_email, "password_reset")
    otp_result["message"] = "Si cette adresse email existe, un code de réinitialisation a été envoyé."
    return otp_result

@api_router.post("/auth/password/forgot/verify")
async def verify_password_reset_otp(payload: EmailOtpVerifyRequest):
    clean_email = sanitize_email(payload.email)
    now = datetime.now(timezone.utc)

    otp_record = await db.email_otps.find_one({"email": clean_email, "purpose": "password_reset"})
    if not otp_record:
        raise HTTPException(status_code=404, detail="Aucun code actif pour cette adresse email. Demandez un nouveau code.")

    expires_at = otp_record.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if not expires_at or expires_at <= now:
        await db.email_otps.delete_one({"email": clean_email, "purpose": "password_reset"})
        raise HTTPException(status_code=400, detail="Le code a expiré. Demandez un nouveau code.")

    if otp_record.get("attempt_count", 0) >= EMAIL_OTP_MAX_ATTEMPTS:
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": "password_reset"},
            {"$set": {"status": "locked", "updated_at": now}}
        )
        raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")

    candidate_hash = hash_email_otp(clean_email, "password_reset", payload.otp)
    if candidate_hash != otp_record.get("otp_hash"):
        new_attempt_count = otp_record.get("attempt_count", 0) + 1
        new_status = "locked" if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS else "pending"
        await db.email_otps.update_one(
            {"email": clean_email, "purpose": "password_reset"},
            {
                "$set": {
                    "attempt_count": new_attempt_count,
                    "updated_at": now,
                    "last_attempt_at": now,
                    "status": new_status
                }
            }
        )
        if new_attempt_count >= EMAIL_OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Trop de tentatives. Demandez un nouveau code email.")
        remaining = max(0, EMAIL_OTP_MAX_ATTEMPTS - new_attempt_count)
        raise HTTPException(status_code=400, detail=f"Code invalide. Tentatives restantes: {remaining}.")

    verification_token = create_email_verification_token(clean_email, "password_reset")
    await db.email_otps.update_one(
        {"email": clean_email, "purpose": "password_reset"},
        {
            "$set": {
                "verified_at": now,
                "updated_at": now,
                "status": "verified"
            }
        }
    )

    return {
        "message": "Code vérifié avec succès.",
        "verification_token": verification_token,
        "masked_email": mask_email_address(clean_email),
        "verified": True
    }

@api_router.post("/auth/password/reset")
async def reset_password_with_verified_token(payload: PasswordResetConfirmRequest):
    clean_email = sanitize_email(payload.email)
    verify_email_verification_token(payload.verification_token, clean_email, purpose="password_reset")

    user = await db.users.find_one({"email": clean_email})
    if not user:
        raise HTTPException(status_code=404, detail="Adresse email introuvable.")

    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"email": clean_email},
        {
            "$set": {
                "password_hash": hash_password(payload.new_password),
                "updated_at": now
            }
        }
    )
    await db.email_otps.delete_one({"email": clean_email, "purpose": "password_reset"})

    return {
        "message": "Mot de passe réinitialisé avec succès.",
        "email": clean_email,
        "password_reset": True
    }

@api_router.post("/auth/register-verified")
async def register_user_verified(user_data: UserWithPayment):
    """Inscription avec vérification obligatoire des comptes de paiement"""
    
    try:
        # Sanitize email input to prevent injection
        clean_email = sanitize_email(user_data.email)
        verify_email_verification_token(user_data.email_verification_token, clean_email, "signup")
        
        # Check if email already exists
        existing_user = await db.users.find_one({"email": clean_email})
        if existing_user:
            log_and_raise_http_exception(400, "Cette adresse email est déjà utilisée")
        
        # Valider les comptes de paiement selon le type d'utilisateur
        try:
            payment_validation = validate_payment_accounts(user_data.payment_accounts, user_data.user_type)
        except HTTPException as e:
            raise e
        
                # Gérer la photo de profil si fournie
        profile_photo_path = None
        user_id = str(uuid.uuid4())  # Generate user ID first

        if user_data.profile_photo_base64:
            try:
                image_data = base64.b64decode(
                    user_data.profile_photo_base64.split(',')[1]
                    if ',' in user_data.profile_photo_base64
                    else user_data.profile_photo_base64
                )

                upload_result = cloudinary_uploader.upload(
                    io.BytesIO(image_data),
                    folder="kojo/profile_photos",
                    public_id=f"register_{user_id}_{uuid.uuid4().hex}",
                    resource_type="image"
                )

                profile_photo_path = upload_result.get("secure_url") or upload_result.get("url")
                logger.info(f"✅ Photo de profil Cloudinary sauvegardée: {profile_photo_path}")

            except Exception as e:
                logger.warning(f"⚠️ Erreur sauvegarde photo profil Cloudinary: {e}")

        # Create user with payment verification - avec gestion d'erreur complète
        try:
            user = User(
                id=user_id,
                email=clean_email,
                password_hash=hash_password(user_data.password),
                first_name=user_data.first_name,
                last_name=user_data.last_name,
                phone=user_data.phone,
                user_type=user_data.user_type,
                country=user_data.country,
                preferred_language=user_data.preferred_language,
                profile_photo=profile_photo_path,  # Ajouter le chemin de la photo
                is_verified=payment_validation["is_verified"],
                email_verified=True,
                email_verified_at=datetime.now(timezone.utc),
                payment_accounts=payment_validation["account_details"],
                payment_accounts_count=payment_validation["linked_accounts_count"],
                created_at=datetime.now(timezone.utc).isoformat(),
                updated_at=datetime.now(timezone.utc).isoformat()
            )
        except ValidationError as ve:
            # Gestion spécifique des erreurs de validation Pydantic
            validation_errors = []
            for error in ve.errors():
                field = error.get('loc', [''])[0] if error.get('loc') else 'unknown'
                message = error.get('msg', 'Erreur de validation')
                
                # Messages d'erreur en français
                if 'string_too_short' in error.get('type', ''):
                    if field == 'first_name':
                        message = "Le prénom doit contenir au moins 2 caractères"
                    elif field == 'last_name':
                        message = "Le nom de famille doit contenir au moins 2 caractères"
                    else:
                        message = f"Le champ {field} doit contenir au moins 2 caractères"
                elif 'string_pattern_mismatch' in error.get('type', ''):
                    if field in ['first_name', 'last_name']:
                        message = f"Le {field} contient des caractères non autorisés"
                    elif field == 'phone':
                        message = "Le numéro de téléphone n'est pas au bon format"
                    else:
                        message = f"Le format du champ {field} est incorrect"
                
                validation_errors.append(f"{message}")
            
            error_message = "; ".join(validation_errors)
            logger.warning(f"❌ Erreur validation utilisateur: {error_message}")
            log_and_raise_http_exception(422, f"Erreur de validation: {error_message}")
        
        except Exception as e:
            logger.error(f"❌ Erreur création utilisateur: {str(e)}")
            log_and_raise_http_exception(500, "Erreur lors de la création du compte utilisateur")
        
        await db.users.insert_one(user.dict())
        await db.email_otps.delete_one({"email": clean_email, "purpose": "signup"})
        
        # Créer le profil travailleur si c'est un travailleur avec des informations supplémentaires
        worker_profile_created = False
        if user_data.user_type == "worker" and (
            user_data.worker_specialties or 
            user_data.worker_experience_years is not None
        ):
            worker_profile = WorkerProfile(
                user_id=user.id,
                specialties=user_data.worker_specialties or [],
                experience_years=user_data.worker_experience_years or 0,

                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            
            await db.worker_profiles.insert_one(worker_profile.dict())
            worker_profile_created = True
            logger.info(f"✅ Profil travailleur créé pour {user.email}")
        
        # Create access token
        access_token = create_access_token(data={"sub": user.id, "email": user.email})
        
        response_data = {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user.dict(exclude={"password_hash"}),
            "payment_verification": {
                "linked_accounts": payment_validation["linked_accounts_count"],
                "required_minimum": 2 if user_data.user_type == "worker" else 1,
                "is_verified": payment_validation["is_verified"],
                "message": f"Compte vérifié avec {payment_validation['linked_accounts_count']} moyen(s) de paiement lié(s)"
            }
        }
        
        # Ajouter les informations du profil travailleur si créé
        if worker_profile_created:
            response_data["worker_profile"] = {
                "specialties": user_data.worker_specialties or [],
                "experience_years": user_data.worker_experience_years or 0,

            }
        
        return response_data

    except HTTPException:
        # Re-raise HTTPException (comme les erreurs de validation 422)
        raise
    except Exception as e:
        # Gestion globale des erreurs non capturées
        logger.error(f"❌ Erreur inattendue lors de l'inscription: {str(e)}")
        log_and_raise_http_exception(500, "Une erreur inattendue s'est produite lors de l'inscription. Veuillez réessayer.")

@api_router.post("/auth/register")
async def register_user(user_data: UserRegister):
    try:
        # Sanitize email input to prevent injection
        clean_email = sanitize_email(user_data.email)
        
        # Check if user exists
        existing_user = await db.users.find_one({"email": clean_email})
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create new user with sanitized email
        hashed_password = hash_password(user_data.password)
        user_dict = user_data.dict(exclude={"password"})
        user_dict["email"] = clean_email  # Use sanitized email
        user = User(
            **user_dict,
            password_hash=hashed_password
        )
        
        await db.users.insert_one(user.dict())
        
        # Create access token
        access_token = create_access_token(data={"sub": user.id, "email": user.email})
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": user.dict(exclude={"password_hash"})
        }
    
    except ValidationError as e:
        logger.warning(f"❌ Erreur validation utilisateur: {e}")
        # Extraire le premier message d'erreur de validation
        first_error = e.errors()[0]
        field = first_error['loc'][0] if first_error['loc'] else 'field'
        
        if field == 'first_name':
            if 'pattern' in first_error.get('type', ''):
                error_msg = "Le prénom contient des caractères non autorisés"
            else:
                error_msg = "Le prénom doit contenir au moins 2 caractères"
        elif field == 'last_name':
            if 'pattern' in first_error.get('type', ''):
                error_msg = "Le nom de famille contient des caractères non autorisés"
            else:
                error_msg = "Le nom doit contenir au moins 2 caractères"
        elif field == 'email':
            error_msg = "L'adresse email n'est pas valide"
        elif field == 'phone':
            error_msg = "Le numéro de téléphone n'est pas au bon format"
        else:
            error_msg = f"Erreur de validation: {first_error['msg']}"
        
        log_and_raise_http_exception(422, f"Erreur de validation: {error_msg}")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erreur inattendue lors de l'inscription: {str(e)}")
        log_and_raise_http_exception(500, "Une erreur inattendue s'est produite lors de l'inscription. Veuillez réessayer.")

@api_router.post("/auth/login")
async def login_user(credentials: UserLogin):
    try:
        # Sanitize email input
        clean_email = sanitize_email(credentials.email)
        user = await db.users.find_one({"email": clean_email})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={"sub": user["id"], "email": user["email"]})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": User(**user).dict(exclude={"password_hash"})
    }

@api_router.post("/auth/logout")
async def logout_user(current_user: User = Depends(get_current_user)):
    """
    Déconnexion de l'utilisateur.
    Note: Avec JWT, la déconnexion est gérée côté client en supprimant le token.
    Cet endpoint est fourni pour la compatibilité et pour loguer les déconnexions.
    """
    logger.info(f"User {current_user.email} logged out")
    return {"message": "Logout successful", "status": "success"}

# User Routes
@api_router.get("/users/profile")
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user.dict(exclude={"password_hash"})

@api_router.put("/users/profile")
async def update_profile(
    user_data: dict,
    current_user: User = Depends(get_current_user)
):
    # Remove fields that shouldn't be updated via this endpoint
    forbidden_fields = {"id", "email", "password_hash", "created_at"}
    update_data = {k: v for k, v in user_data.items() if k not in forbidden_fields}
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": update_data}
    )
    
    return {"message": "Profile updated successfully"}

# Profile Photo Routes
@api_router.post("/users/profile-photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")

    file_content = await file.read()
    file_size = len(file_content)

    if file_size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")

    try:
        upload_result = upload_profile_photo_to_cloudinary(
            io.BytesIO(file_content),
            str(current_user.id)
        )

        photo_url = upload_result["photo_url"]

        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {"profile_photo": photo_url, "updated_at": datetime.now(timezone.utc)}}
        )

        return {
            "message": "Profile photo uploaded successfully",
            "photo_url": photo_url
        }

    except Exception as e:
        logger.error(f"Erreur upload photo Cloudinary: {e}")
        raise HTTPException(status_code=500, detail=f"Cloudinary upload failed: {str(e)}")

@api_router.get("/users/profile-photo")
async def get_current_user_profile_photo(current_user: User = Depends(get_current_user)):
    """Get current user's profile photo"""
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo found")
    
    return {
        "photo_url": current_user.profile_photo,
        "user_id": current_user.id
    }

@api_router.get("/users/{user_id}/profile-photo")
async def get_user_profile_photo(user_id: str):
    """Get any user's profile photo (public endpoint for shared viewing)"""
    try:
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.get("profile_photo"):
            raise HTTPException(status_code=404, detail="No profile photo found for this user")
        
        return {
            "photo_url": user["profile_photo"],
            "user_id": user_id
        }
    except Exception as e:
        logger.error(f"Error fetching profile photo for user {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@api_router.delete("/users/profile-photo")
async def delete_profile_photo(current_user: User = Depends(get_current_user)):
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo to delete")
    
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"profile_photo": None, "updated_at": datetime.now(timezone.utc)}}
    )
    
    return {"message": "Profile photo deleted successfully"}

# Push Token Routes - For Mobile Notifications
@api_router.post("/users/push-token")
async def register_push_token(
    token_data: PushTokenCreate,
    current_user: User = Depends(get_current_user)
):
    """Register push notification token for mobile app"""
    try:
        logger.info(f"Registering push token for user: {current_user.id}")
        
        # Verify user_id matches current user (security check)
        if token_data.user_id != current_user.id:
            raise HTTPException(
                status_code=403, 
                detail="Cannot register push token for different user"
            )
        
        # Check if token already exists for this user and device
        existing_token = await db.push_tokens.find_one({
            "user_id": current_user.id,
            "device_type": token_data.device_type,
            "device_id": token_data.device_id
        })
        
        if existing_token:
            # Update existing token
            await db.push_tokens.update_one(
                {"id": existing_token["id"]},
                {
                    "$set": {
                        "push_token": token_data.push_token,
                        "active": True,
                        "updated_at": datetime.now(timezone.utc)
                    }
                }
            )
            logger.info(f"Updated existing push token for user: {current_user.id}")
            return {
                "message": "Push token updated successfully",
                "token_id": existing_token["id"],
                "action": "updated"
            }
        else:
            # Create new token
            push_token = PushToken(
                user_id=current_user.id,
                push_token=token_data.push_token,
                device_type=token_data.device_type,
                device_id=token_data.device_id
            )
            
            await db.push_tokens.insert_one(push_token.dict())
            logger.info(f"Created new push token for user: {current_user.id}")
            
            return {
                "message": "Push token registered successfully",
                "token_id": push_token.id,
                "action": "created"
            }
            
    except ValidationError as e:
        logger.error(f"Validation error in push token registration: {e}")
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Error registering push token: {e}")
        raise HTTPException(status_code=500, detail="Failed to register push token")

@api_router.get("/users/push-tokens")
async def get_user_push_tokens(current_user: User = Depends(get_current_user)):
    """Get all push tokens for current user"""
    try:
        tokens = await db.push_tokens.find(
            {"user_id": current_user.id, "active": True}
        ).to_list(length=None)
        
        return {
            "tokens": [
                {
                    "id": token["id"],
                    "device_type": token["device_type"], 
                    "device_id": token.get("device_id"),
                    "created_at": token["created_at"],
                    "updated_at": token["updated_at"]
                } 
                for token in tokens
            ],
            "count": len(tokens)
        }
    except Exception as e:
        logger.error(f"Error getting push tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to get push tokens")

@api_router.delete("/users/push-token/{token_id}")
async def delete_push_token(
    token_id: str,
    current_user: User = Depends(get_current_user)
):
    """Delete/deactivate a push token"""
    try:
        # Find token and verify ownership
        token = await db.push_tokens.find_one({"id": token_id, "user_id": current_user.id})
        if not token:
            raise HTTPException(status_code=404, detail="Push token not found")
        
        # Deactivate token instead of deleting (for audit trail)
        await db.push_tokens.update_one(
            {"id": token_id},
            {
                "$set": {
                    "active": False,
                    "updated_at": datetime.now(timezone.utc)
                }
            }
        )
        
        logger.info(f"Deactivated push token {token_id} for user: {current_user.id}")
        return {"message": "Push token deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting push token: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete push token")

# Worker Profile Routes
@api_router.post("/workers/profile")
async def create_worker_profile(
    profile_data: WorkerProfile,
    current_user: User = Depends(get_current_user)
):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can create worker profiles")
    
    profile_data.user_id = current_user.id
    await db.worker_profiles.insert_one(profile_data.dict())
    return {"message": "Worker profile created successfully"}

@api_router.get("/workers/profile")
async def get_worker_profile(current_user: User = Depends(get_current_user)):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Access denied")
    
    profile = await db.worker_profiles.find_one({"user_id": current_user.id})
    if not profile:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    
    return WorkerProfile(**profile)

# Job Routes
@api_router.post("/jobs", response_model=Job)
async def create_job(
    job_data: JobCreate,
    current_user: User = Depends(get_current_user)
):
    try:
        if current_user.user_type != UserType.CLIENT:
            raise HTTPException(status_code=403, detail="Only clients can create jobs")
        
        # Additional validation
        if job_data.budget_min > job_data.budget_max:
            raise HTTPException(status_code=400, detail="budget_min cannot be greater than budget_max")
        
        job = Job(**job_data.dict(), client_id=current_user.id)
        result = await db.jobs.insert_one(job.dict())
        
        if not result.inserted_id:
            raise HTTPException(status_code=500, detail="Failed to create job")
            
        logger.info(f"✅ Job created successfully: {job.id} by user {current_user.id}")
        return job
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to create job: {e}")
        raise HTTPException(status_code=500, detail="Internal server error creating job")

@api_router.get("/jobs", response_model=List[Job])
async def get_jobs(
    status: Optional[JobStatus] = None,
    category: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user)
):
    try:
        query = {}
        if status:
            query["status"] = status
        if category:
            query["category"] = category
        
        jobs = await db.jobs.find(query).sort("posted_at", -1).to_list(limit)
        
        logger.info(f"✅ Retrieved {len(jobs)} jobs for user {current_user.id}")
        return [Job(**job) for job in jobs]
        
    except Exception as e:
        logger.error(f"❌ Failed to retrieve jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving jobs")

@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return Job(**job)

# Job Proposal Routes
@api_router.post("/jobs/{job_id}/proposals")
async def create_proposal(
    job_id: str,
    proposal_data: ProposalCreate,
    current_user: User = Depends(get_current_user)
):
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(status_code=403, detail="Only workers can create proposals")
    
    # Check if job exists
    job = await db.jobs.find_one({"id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Check if worker already proposed
    existing_proposal = await db.job_proposals.find_one({
        "job_id": job_id,
        "worker_id": current_user.id
    })
    if existing_proposal:
        raise HTTPException(status_code=400, detail="You have already proposed for this job")
    
    proposal = JobProposal(
        **proposal_data.dict(),
        job_id=job_id,
        worker_id=current_user.id
    )
    
    await db.job_proposals.insert_one(proposal.dict())
    return {"message": "Proposal submitted successfully"}

@api_router.get("/jobs/{job_id}/proposals")
async def get_job_proposals(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    # Check if user is the job owner
    job = await db.jobs.find_one({"id": job_id, "client_id": current_user.id})
    if not job:
        raise HTTPException(status_code=403, detail="Access denied")
    
    proposals = await db.job_proposals.find({"job_id": job_id}).to_list(100)
    return [JobProposal(**proposal) for proposal in proposals]

# Messaging Routes
@api_router.post("/messages")
async def send_message(
    message_data: MessageCreate,
    current_user: User = Depends(get_current_user)
):
    # Generate conversation ID
    conversation_id = f"{min(current_user.id, message_data.receiver_id)}_{max(current_user.id, message_data.receiver_id)}"
    
    message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        receiver_id=message_data.receiver_id,
        content=message_data.content
    )
    
    await db.messages.insert_one(message.dict())
    return {"message": "Message sent successfully"}

@api_router.get("/messages")
async def get_all_messages(current_user: User = Depends(get_current_user)):
    """Récupérer tous les messages de l'utilisateur connecté"""
    messages = await db.messages.find({
        "$or": [
            {"sender_id": current_user.id},
            {"receiver_id": current_user.id}
        ]
    }, {"_id": 0}).sort("created_at", -1).to_list(100)
    return messages

@api_router.get("/messages/conversations")
async def get_conversations(current_user: User = Depends(get_current_user)):
    # Get unique conversation partners
    pipeline = [
        {"$match": {
            "$or": [
                {"sender_id": current_user.id},
                {"receiver_id": current_user.id}
            ]
        }},
        {"$group": {
            "_id": "$conversation_id",
            "last_message": {"$last": "$content"},
            "last_timestamp": {"$last": "$timestamp"}
        }},
        {"$sort": {"last_timestamp": -1}}
    ]
    
    conversations = await db.messages.aggregate(pipeline).to_list(100)
    return conversations

@api_router.get("/messages/{conversation_id}")
async def get_conversation_messages(
    conversation_id: str,
    current_user: User = Depends(get_current_user)
):
    # Verify user is part of conversation
    if current_user.id not in conversation_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    messages = await db.messages.find({
        "conversation_id": conversation_id
    }).sort("timestamp", 1).to_list(100)
    
    return [Message(**message) for message in messages]

# Basic health check routes
@api_router.get("/")
async def root():
    return {"message": "Kojo API - Connecting Mali & Senegal", "status": "running"}

@api_router.get("/health")
async def health_check():
    try:
        # Test database connection
        await db.users.count_documents({})
        
        return {
            "status": "healthy", 
            "timestamp": datetime.now(timezone.utc),
            "database": "connected",
            "version": "1.0.0",
            "environment": "production"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Service unavailable")

# ============================================
# GÉOLOCALISATION - Détection automatique du pays
# ============================================

# Données des pays d'Afrique de l'Ouest supportés
WEST_AFRICA_COUNTRIES = {
    "senegal": {
        "code": "senegal",
        "name": "Sénégal",
        "nameFrench": "Sénégal",
        "nameEnglish": "Senegal",
        "flag": "🇸🇳",
        "phonePrefix": "+221",
        "phonePrefixes": ["+221"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Dakar",
        "languages": ["fr", "wo"],
        "primaryLanguage": "fr",
        "localLanguage": "wo",
        "timezone": "Africa/Dakar",
        "coordinates": {"lat": 14.6928, "lng": -17.4467}
    },
    "mali": {
        "code": "mali",
        "name": "Mali",
        "nameFrench": "Mali",
        "nameEnglish": "Mali",
        "flag": "🇲🇱",
        "phonePrefix": "+223",
        "phonePrefixes": ["+223"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Bamako",
        "languages": ["fr", "bm"],
        "primaryLanguage": "fr",
        "localLanguage": "bm",
        "timezone": "Africa/Bamako",
        "coordinates": {"lat": 12.6392, "lng": -8.0029}
    },
    "burkina_faso": {
        "code": "burkina_faso",
        "name": "Burkina Faso",
        "nameFrench": "Burkina Faso",
        "nameEnglish": "Burkina Faso",
        "flag": "🇧🇫",
        "phonePrefix": "+226",
        "phonePrefixes": ["+226"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Ouagadougou",
        "languages": ["fr", "mos"],
        "primaryLanguage": "fr",
        "localLanguage": "mos",
        "timezone": "Africa/Ouagadougou",
        "coordinates": {"lat": 12.3714, "lng": -1.5197}
    },
    "cote_divoire": {
        "code": "cote_divoire",
        "name": "Côte d'Ivoire",
        "nameFrench": "Côte d'Ivoire",
        "nameEnglish": "Ivory Coast",
        "flag": "🇨🇮",
        "phonePrefix": "+225",
        "phonePrefixes": ["+225"],
        "currency": "XOF",
        "currencySymbol": "FCFA",
        "capital": "Abidjan",
        "languages": ["fr", "en"],
        "primaryLanguage": "fr",
        "localLanguage": "fr",
        "timezone": "Africa/Abidjan",
        "coordinates": {"lat": 5.3600, "lng": -4.0083}
    }
}

# Mapping des IP ranges vers les pays (simplifiée - en production, utiliser une base GeoIP)
IP_COUNTRY_HINTS = {
    # Sénégal ISPs
    "41.82.": "senegal", "41.83.": "senegal", "196.1.": "senegal", "196.206.": "senegal",
    # Mali ISPs
    "41.73.": "mali", "217.64.": "mali", "196.200.": "mali",
    # Burkina Faso ISPs
    "41.78.": "burkina_faso", "196.28.": "burkina_faso", "41.203.": "burkina_faso",
    # Côte d'Ivoire ISPs
    "41.66.": "cote_divoire", "196.180.": "cote_divoire", "41.207.": "cote_divoire"
}

def detect_country_from_ip(ip_address: str) -> Optional[str]:
    """Détecter le pays à partir de l'adresse IP"""
    if not ip_address or ip_address in ["127.0.0.1", "localhost", "::1"]:
        return None
    
    # Vérifier les préfixes IP connus
    for prefix, country in IP_COUNTRY_HINTS.items():
        if ip_address.startswith(prefix):
            return country
    
    return None

def detect_country_from_phone(phone: str) -> Optional[str]:
    """Détecter le pays à partir du numéro de téléphone"""
    if not phone:
        return None
    
    phone = phone.strip().replace(" ", "")
    
    phone_to_country = {
        "+221": "senegal",
        "+223": "mali",
        "+226": "burkina_faso",
        "+225": "cote_divoire"
    }
    
    for prefix, country in phone_to_country.items():
        if phone.startswith(prefix):
            return country
    
    return None

@api_router.get("/geolocation/detect")
async def detect_geolocation(request: Request, phone: Optional[str] = None):
    """
    Détecter automatiquement le pays de l'utilisateur.
    
    Méthodes de détection (par ordre de priorité):
    1. Numéro de téléphone (si fourni)
    2. Adresse IP
    3. Défaut: Sénégal (hub principal)
    
    Returns:
        - detected: bool - Si la détection a réussi
        - method: str - Méthode utilisée (phone, ip, default)
        - country: dict - Informations complètes du pays
        - supported_countries: list - Liste des pays supportés
    """
    detected_country = None
    detection_method = "default"
    
    # 1. Détection via numéro de téléphone
    if phone:
        detected_country = detect_country_from_phone(phone)
        if detected_country:
            detection_method = "phone"
    
    # 2. Détection via IP
    if not detected_country:
        # Obtenir l'IP du client
        client_ip = request.client.host if request.client else None
        
        # Vérifier les headers de proxy
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            client_ip = real_ip
        
        if client_ip:
            detected_country = detect_country_from_ip(client_ip)
            if detected_country:
                detection_method = "ip"
    
    # 3. Défaut: Sénégal
    if not detected_country:
        detected_country = "senegal"
        detection_method = "default"
    
    country_info = WEST_AFRICA_COUNTRIES.get(detected_country, WEST_AFRICA_COUNTRIES["senegal"])
    
    return {
        "detected": detection_method != "default",
        "method": detection_method,
        "country": country_info,
        "supported_countries": list(WEST_AFRICA_COUNTRIES.values()),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@api_router.get("/geolocation/countries")
async def get_supported_countries():
    """
    Obtenir la liste des pays supportés par Kojo.
    
    Returns:
        - countries: list - Liste complète des pays avec leurs informations
        - total: int - Nombre total de pays
    """
    return {
        "countries": list(WEST_AFRICA_COUNTRIES.values()),
        "total": len(WEST_AFRICA_COUNTRIES),
        "default_country": "senegal"
    }

class PhoneValidationRequest(BaseModel):
    phone: str = Field(..., description="Numéro de téléphone à valider")
    country: Optional[str] = Field(None, description="Code du pays à vérifier (optionnel)")

@api_router.post("/geolocation/validate-phone")
async def validate_phone_for_country(request: PhoneValidationRequest):
    """
    Valider un numéro de téléphone et détecter/vérifier le pays.
    
    Args:
        phone: Numéro de téléphone à valider
        country: Code du pays à vérifier (optionnel)
    
    Returns:
        - valid: bool - Si le numéro est valide
        - detected_country: str - Pays détecté
        - matches_country: bool - Si le numéro correspond au pays spécifié
        - formatted: str - Numéro formaté
    """
    phone = request.phone
    country = request.country
    
    if not phone:
        raise HTTPException(status_code=400, detail="Numéro de téléphone requis")
    
    phone = phone.strip().replace(" ", "").replace("-", "")
    detected = detect_country_from_phone(phone)
    
    # Validation du format
    is_valid = False
    if detected:
        # Vérifier la longueur (préfixe + 8-10 chiffres selon le pays)
        country_info = WEST_AFRICA_COUNTRIES.get(detected)
        if country_info:
            prefix = country_info["phonePrefix"]
            local_number = phone[len(prefix):]
            # Côte d'Ivoire a 10 chiffres, autres pays 8-9
            if detected == "cote_divoire":
                is_valid = len(local_number) >= 8 and len(local_number) <= 10 and local_number.isdigit()
            else:
                is_valid = len(local_number) >= 8 and len(local_number) <= 9 and local_number.isdigit()
    
    matches = True
    if country and detected:
        matches = detected == country
    
    return {
        "valid": is_valid,
        "phone": phone,
        "detected_country": detected,
        "country_info": WEST_AFRICA_COUNTRIES.get(detected) if detected else None,
        "matches_country": matches,
        "formatted": phone if is_valid else None
    }

@api_router.get("/stats")
async def get_system_stats():
    """Statistics endpoint for monitoring"""
    try:
        total_users = await db.users.count_documents({})
        total_jobs = await db.jobs.count_documents({})
        total_workers = await db.users.count_documents({"user_type": "worker"})
        total_clients = await db.users.count_documents({"user_type": "client"})
        
        return {
            "total_users": total_users,
            "total_jobs": total_jobs,
            "total_workers": total_workers,
            "total_clients": total_clients,
            "supported_countries": ["senegal", "mali", "ivory_coast", "burkina_faso"],
            "supported_languages": ["fr", "en", "wo", "bm"],
            "timestamp": datetime.now(timezone.utc)
        }
    except Exception as e:
        logger.error(f"Stats endpoint failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve statistics")

# ============================================================================
# ENDPOINTS PROTÉGÉS PROPRIÉTAIRE - ACCÈS RESTREINT
# ============================================================================


# ============================================================================
# REAL PAYMENTS - PAYDUNYA FOUNDATION (PACK 2)
# ============================================================================

PAYDUNYA_CHANNELS = {
    "orange_money": {
        "senegal": "orange-money-senegal",
        "mali": "orange-money-mali",
        "burkina_faso": "orange-money-burkina",
        "ivory_coast": "orange-money-ci"
    },
    "wave": {
        "senegal": "wave-senegal",
        "ivory_coast": "wave-ci"
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
        'ivory coast': 'ivory_coast',
        'cote divoire': 'ivory_coast',
        "côte d'ivoire": 'ivory_coast',
        "cote d'ivoire": 'ivory_coast',
        'cote_d_ivoire': 'ivory_coast',
        'ivory_coast': 'ivory_coast'
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

def calculate_payment_breakdown(amount: float) -> Dict[str, Any]:
    commission_amount = round(amount * PAYMENT_COMMISSION_RATE)
    worker_amount = round(amount - commission_amount)
    return {
        'total_amount': round(amount),
        'commission_amount': commission_amount,
        'worker_amount': worker_amount,
        'commission_rate': round(PAYMENT_COMMISSION_RATE * 100, 2)
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
    if explicit_url and explicit_url.strip():
        return explicit_url.strip()
    if FRONTEND_APP_URL:
        return f"{FRONTEND_APP_URL}{fallback_path}"
    return fallback_path

def build_payment_callback_url() -> str:
    if BACKEND_PUBLIC_URL:
        return f"{BACKEND_PUBLIC_URL}/api/payments/ipn/paydunya"
    return '/api/payments/ipn/paydunya'

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
        raise HTTPException(status_code=502, detail=data.get('response_text') or 'Création de paiement refusée par PayDunya')

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

    await db.payments.update_one({'id': payment_record['id']}, {'$set': update_fields})
    latest = await db.payments.find_one({'id': payment_record['id']})
    return latest or payment_record

@api_router.get('/payments/config')
async def get_real_payments_config():
    return {
        'provider': 'paydunya',
        'configured': is_paydunya_configured(),
        'mode': PAYDUNYA_MODE,
        'commission_rate_percent': round(PAYMENT_COMMISSION_RATE * 100, 2),
        'supported_channels': {
            'orange_money': list(PAYDUNYA_CHANNELS['orange_money'].keys()),
            'wave': list(PAYDUNYA_CHANNELS['wave'].keys()),
            'bank_card': ['all']
        }
    }

@api_router.post('/payments/quote')
async def get_payment_quote(request: PaymentQuoteRequest):
    channel = get_paydunya_channel(request.payment_method.value, request.country)
    breakdown = calculate_payment_breakdown(request.amount)
    return {
        'provider': 'paydunya',
        'configured': is_paydunya_configured(),
        'channel': channel,
        'country': normalize_payment_country(request.country),
        'payment_method': request.payment_method.value,
        **breakdown
    }

@api_router.post('/payments/checkout')
async def create_real_payment_checkout(request: PaymentCheckoutRequest, current_user: User = Depends(get_current_user)):
    if not is_paydunya_configured():
        raise HTTPException(status_code=503, detail="PayDunya n'est pas encore configuré en production")

    normalized_country = normalize_payment_country(request.country or current_user.country)
    channel = get_paydunya_channel(request.payment_method.value, normalized_country)
    breakdown = calculate_payment_breakdown(request.amount)

    payment_record = {
        'id': str(uuid.uuid4()),
        'job_id': request.job_id or '',
        'payer_id': current_user.id,
        'receiver_id': request.worker_id or '',
        'amount': round(request.amount),
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

    return_url = build_checkout_redirect_url(f"/payment-demo?payment_id={payment_record['id']}", request.return_url)
    cancel_url = build_checkout_redirect_url(f"/payment-demo?payment_id={payment_record['id']}&cancelled=1", request.cancel_url)
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

@api_router.get('/payments/status/{payment_id}')
async def get_payment_status(payment_id: str, current_user: User = Depends(get_current_user)):
    payment_record = await db.payments.find_one({'id': payment_id})
    if not payment_record:
        raise HTTPException(status_code=404, detail='Paiement introuvable')

    if current_user.id not in {payment_record.get('payer_id'), payment_record.get('receiver_id')} and current_user.email != os.environ.get('FAMAKAN_OWNER_EMAIL', '').strip():
        raise HTTPException(status_code=403, detail='Accès interdit à ce paiement')

    payment_record = await sync_payment_status_with_paydunya(payment_record)
    return serialize_payment_record(payment_record)

@api_router.get('/payments/status/token/{invoice_token}')
async def get_payment_status_by_token(invoice_token: str, current_user: User = Depends(get_current_user)):
    payment_record = await db.payments.find_one({'invoice_token': invoice_token})
    if not payment_record:
        raise HTTPException(status_code=404, detail='Paiement introuvable')

    if current_user.id not in {payment_record.get('payer_id'), payment_record.get('receiver_id')} and current_user.email != os.environ.get('FAMAKAN_OWNER_EMAIL', '').strip():
        raise HTTPException(status_code=403, detail='Accès interdit à ce paiement')

    payment_record = await sync_payment_status_with_paydunya(payment_record)
    return serialize_payment_record(payment_record)

@api_router.get('/payments/my')
async def get_my_payments(current_user: User = Depends(get_current_user)):
    cursor = db.payments.find({'$or': [{'payer_id': current_user.id}, {'receiver_id': current_user.id}]}).sort('created_at', -1).limit(50)
    payments = [serialize_payment_record(item) async for item in cursor]
    return {'payments': payments}

@api_router.post('/payments/ipn/paydunya')
async def paydunya_payment_ipn(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    invoice_data = payload.get('invoice', {}) if isinstance(payload, dict) else {}
    custom_data = payload.get('custom_data', {}) if isinstance(payload, dict) else {}
    payment_id = custom_data.get('payment_id') or payload.get('payment_id')
    invoice_token = invoice_data.get('token') or payload.get('token')
    provider_status = invoice_data.get('status') or payload.get('status')

    query = {'id': payment_id} if payment_id else {'invoice_token': invoice_token}
    payment_record = await db.payments.find_one(query) if query else None
    if not payment_record:
        return {'status': 'ignored'}

    local_status = map_paydunya_status(provider_status)
    update_fields = {
        'status': local_status,
        'provider_status': provider_status,
        'provider_callback_payload': payload,
        'updated_at': datetime.now(timezone.utc).isoformat()
    }
    if invoice_token:
        update_fields['invoice_token'] = invoice_token
    if local_status == 'completed':
        update_fields['completed_at'] = datetime.now(timezone.utc).isoformat()

    await db.payments.update_one({'id': payment_record['id']}, {'$set': update_fields})
    return {'status': 'ok'}

async def compute_real_commission_stats() -> Dict[str, Any]:
    completed_payments = [item async for item in db.payments.find({'status': 'completed'}).sort('created_at', -1)]
    now = datetime.now(timezone.utc)
    today = now.date()

    total_transactions = len(completed_payments)
    total_commission_earned = sum(int(item.get('commission_amount', 0) or 0) for item in completed_payments)
    total_volume = sum(int(item.get('amount', 0) or 0) for item in completed_payments)

    daily_commission = 0
    monthly_commission = 0
    method_totals: Dict[str, Dict[str, int]] = {}
    recent_transactions = []

    for item in completed_payments:
        created_raw = item.get('completed_at') or item.get('updated_at') or item.get('created_at')
        try:
            created_dt = datetime.fromisoformat(str(created_raw).replace('Z', '+00:00'))
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
        except Exception:
            created_dt = now

        if created_dt.date() == today:
            daily_commission += int(item.get('commission_amount', 0) or 0)
        if created_dt.year == now.year and created_dt.month == now.month:
            monthly_commission += int(item.get('commission_amount', 0) or 0)

        method = item.get('payment_method', 'unknown')
        bucket = method_totals.setdefault(method, {'volume': 0, 'commission': 0})
        bucket['volume'] += int(item.get('amount', 0) or 0)
        bucket['commission'] += int(item.get('commission_amount', 0) or 0)

        if len(recent_transactions) < 10:
            recent_transactions.append({
                'id': item.get('id'),
                'amount': int(item.get('amount', 0) or 0),
                'commission': int(item.get('commission_amount', 0) or 0),
                'worker_amount': int(item.get('worker_amount', 0) or 0),
                'method': method,
                'paymentMethod': method,
                'date': created_dt.isoformat(),
                'timestamp': created_dt.isoformat()
            })

    top_payment_methods = [
        {'method': method, 'volume': data['volume'], 'commission': data['commission']}
        for method, data in sorted(method_totals.items(), key=lambda item: item[1]['volume'], reverse=True)
    ]

    return {
        'total_transactions': total_transactions,
        'total_commission_earned': total_commission_earned,
        'commission_rate': round(PAYMENT_COMMISSION_RATE * 100),
        'total_volume': total_volume,
        'daily_commission': daily_commission,
        'monthly_commission': monthly_commission,
        'top_payment_methods': top_payment_methods,
        'recent_transactions': recent_transactions
    }

@api_router.get("/owner/commission-stats")
async def get_commission_stats(owner_user = Depends(verify_owner_access)):
    """Statistiques des commissions - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        stats = await compute_real_commission_stats()
        return {
            "status": "success",
            "owner_email": owner_user["email"],
            "stats": stats
        }
    except Exception as e:
        logging.error(f"Error getting commission stats: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@api_router.get("/owner/debug-info")
async def get_debug_info(owner_user = Depends(verify_owner_access)):
    """Informations de debug - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Compter les utilisateurs
        total_users = await db.users.count_documents({})
        clients = await db.users.count_documents({"user_type": "client"})
        workers = await db.users.count_documents({"user_type": "worker"})
        
        # Compter les jobs
        total_jobs = await db.jobs.count_documents({})
        active_jobs = await db.jobs.count_documents({"status": "open"})
        
        debug_info = {
            "system_status": "running",
            "database_connected": True,
            "total_users": total_users,
            "user_breakdown": {
                "clients": clients,
                "workers": workers,
                "owner": 1
            },
            "jobs_stats": {
                "total_jobs": total_jobs,
                "active_jobs": active_jobs
            },
            "server_info": {
                "jwt_algorithm": JWT_ALGORITHM,
                "cors_enabled": True,
                "uploads_enabled": True
            },
            "owner_permissions": owner_user.get("permissions", [])
        }
        
        return {
            "status": "success",
            "debug_info": debug_info,
            "access_level": "OWNER_FULL_ACCESS"
        }
        
    except Exception as e:
        logging.error(f"Error getting debug info: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@api_router.get("/owner/users-management")
async def get_users_management(owner_user = Depends(verify_owner_access)):
    """Gestion des utilisateurs - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Récupérer tous les utilisateurs (sauf le propriétaire)
        users_cursor = db.users.find(
            {"user_type": {"$ne": "owner"}},
            {"password_hash": 0, "_id": 0}  # Exclure les mots de passe et _id
        )
        users = await users_cursor.to_list(length=None)
        
        # Statistiques des utilisateurs
        user_stats = {
            "total_users": len(users),
            "clients": len([u for u in users if u.get("user_type") == "client"]),
            "workers": len([u for u in users if u.get("user_type") == "worker"]),
            "by_country": {}
        }
        
        # Compter par pays
        for user in users:
            country = user.get("country", "unknown")
            user_stats["by_country"][country] = user_stats["by_country"].get(country, 0) + 1
        
        return {
            "status": "success",
            "users": users,
            "stats": user_stats,
            "access_level": "OWNER_FULL_ACCESS"
        }
        
    except Exception as e:
        logging.error(f"Error getting users management: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@api_router.post("/owner/update-commission-settings")
async def update_commission_settings(
    settings: dict,
    owner_user = Depends(verify_owner_access)
):
    """Mettre à jour les paramètres de commission - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Valider les paramètres
        commission_rate = settings.get("commission_rate", 14)
        if not 0 <= commission_rate <= 50:
            raise HTTPException(status_code=400, detail="Taux de commission invalide (0-50%)")
        
        # Sauvegarder les paramètres en base
        await db.settings.update_one(
            {"type": "commission"},
            {
                "$set": {
                    "commission_rate": commission_rate,
                    "owner_accounts": settings.get("owner_accounts", {}),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": owner_user["id"]
                }
            },
            upsert=True
        )
        
        return {
            "status": "success",
            "message": "Paramètres de commission mis à jour",
            "new_settings": settings
        }
        
    except Exception as e:
        logging.error(f"Error updating commission settings: {e}")
        raise HTTPException(status_code=500, detail="Erreur serveur")

@api_router.get("/users/payment-accounts")
async def get_user_payment_accounts(current_user: User = Depends(get_current_user)):
    """Obtenir les comptes de paiement de l'utilisateur connecté"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "user_id": current_user.id,
        "user_type": user_data["user_type"],
        "payment_accounts": user_data.get("payment_accounts", {}),
        "payment_accounts_count": user_data.get("payment_accounts_count", 0),
        "is_verified": user_data.get("is_verified", False),
        "minimum_required": 2 if user_data["user_type"] == "worker" else 1
    }

@api_router.put("/users/payment-accounts")
async def update_user_payment_accounts(
    payment_data: PaymentAccount,
    current_user: User = Depends(get_current_user)
):
    """Mettre à jour les comptes de paiement de l'utilisateur"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Valider les nouveaux comptes de paiement
    try:
        payment_validation = validate_payment_accounts(payment_data, user_data["user_type"])
    except HTTPException as e:
        raise e
    
    # Mettre à jour en base de données
    await db.users.update_one(
        {"id": current_user.id},
        {
            "$set": {
                "payment_accounts": payment_validation["account_details"],
                "payment_accounts_count": payment_validation["linked_accounts_count"],
                "is_verified": payment_validation["is_verified"],
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    return {
        "message": "Comptes de paiement mis à jour avec succès",
        "payment_verification": {
            "linked_accounts": payment_validation["linked_accounts_count"],
            "required_minimum": 2 if user_data["user_type"] == "worker" else 1,
            "is_verified": payment_validation["is_verified"],
            "accounts": payment_validation["account_details"]
        }
    }

@api_router.post("/users/verify-payment-access")
async def verify_payment_access(current_user: User = Depends(get_current_user)):
    """Vérifier si l'utilisateur peut accéder aux fonctionnalités de paiement"""
    
    user_data = await db.users.find_one({"id": current_user.id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    payment_count = user_data.get("payment_accounts_count", 0)
    user_type = user_data["user_type"]
    is_verified = user_data.get("is_verified", False)
    
    # Vérifier les conditions d'accès
    if user_type == "client" and payment_count < 1:
        return {
            "access_granted": False,
            "message": "Les clients doivent lier au moins 1 moyen de paiement",
            "required_minimum": 1,
            "current_count": payment_count,
            "user_type": user_type
        }
    elif user_type == "worker" and payment_count < 2:
        return {
            "access_granted": False,
            "message": "Les travailleurs doivent lier au minimum 2 moyens de paiement",
            "required_minimum": 2,
            "current_count": payment_count,
            "user_type": user_type
        }
    
    return {
        "access_granted": True,
        "message": "Accès autorisé aux fonctionnalités de paiement",
        "is_verified": is_verified,
        "payment_accounts_count": payment_count,
        "user_type": user_type
    }

# ============================================================================

# Include the router in the main app
app.include_router(api_router)

# Serve uploaded files under /api prefix for proper Kubernetes ingress routing
from fastapi.staticfiles import StaticFiles
app.mount("/api/uploads", StaticFiles(directory="uploads"), name="uploads")

# CORS Configuration optimized for West Africa
WEST_AFRICA_ORIGINS = [
    "http://localhost:3000",  # Development
    "https://localhost:3000",  # Development HTTPS
    "http://127.0.0.1:3000",   # Local development
    "https://kojo-work.preview.emergentagent.com",  # Production
    # Add common West African mobile network proxy IPs
    "http://192.168.*",  # Local networks
    "http://10.*",       # Private networks
]

# Get additional origins from environment
env_origins = [origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip()]
allowed_origins = WEST_AFRICA_ORIGINS + env_origins

# Support public Vercel deployments and common development/private network origins.
# Exact origins from CORS_ORIGINS remain supported via allow_origins.
allowed_origin_regex = (
    r"^https://.*\.vercel\.app$"
    r"|^http://localhost(:\d+)?$"
    r"|^https://localhost(:\d+)?$"
    r"|^http://127\.0\.0\.1(:\d+)?$"
    r"|^http://192\.168\.\d+\.\d+(:\d+)?$"
    r"|^http://10\.\d+\.\d+\.\d+(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=[
        "Accept",
        "Accept-Language",
        "Content-Language",
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-CSRFToken",
        "Cache-Control"
    ],
    expose_headers=["Content-Range", "X-Content-Range"],
    max_age=86400,
)

# Trusted Host Middleware for security
app.add_middleware(
    TrustedHostMiddleware, 
    allowed_hosts=["*"]  # In production, specify exact domains
)

# Add custom security middleware
app.add_middleware(WestAfricaSecurityMiddleware)

@app.on_event("startup")
async def startup_event():
    """Initialiser le système au démarrage"""
    logger.info("🚀 Démarrage de l'API Kojo...")
    
    # Créer le compte propriétaire s'il n'existe pas
    await ensure_owner_exists()
    
    # Créer les index MongoDB pour les performances
    await create_database_indexes()
    
    # Créer le dossier uploads
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)
    logger.info("📁 Dossier uploads créé/vérifié")
    
    logger.info("✅ API Kojo prête!")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()