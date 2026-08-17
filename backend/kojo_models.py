# -*- coding: utf-8 -*-
"""Modèles Pydantic et énumérations de l'API Kojo."""

import re
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from kojo_settings import OWNER_EMAIL

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
    COTE_DIVOIRE = "cote_divoire"  # 🇨🇮 Pays prioritaire - Abidjan hub économique
    BURKINA_FASO = "burkina_faso"  # 🇧🇫 Pays prioritaire - Ouagadougou

# ---------------------------------------------------------------------------
# Règles téléphone par pays (4 pays prioritaires Kojo).
# La Côte d'Ivoire accepte aussi le nouveau format à 10 chiffres (01-09...).
# ---------------------------------------------------------------------------
WA_PHONE_RULES = {
    "221": {
        "name": "Sénégal", "local_min": 8, "local_max": 9,
        "prefixes": [str(i) for i in range(70, 100)] + ['65', '66', '67', '68', '58', '59', '48', '49', '51', '52', '33', '75', '76'],
    },
    "223": {
        "name": "Mali", "local_min": 8, "local_max": 9,
        "prefixes": [str(i) for i in range(70, 100)] + ['65', '66', '67', '68', '58', '59', '48', '49', '51', '52', '33', '75', '76'],
    },
    "226": {
        "name": "Burkina Faso", "local_min": 8, "local_max": 9,
        "prefixes": [str(i) for i in range(70, 100)] + ['65', '66', '67', '68', '58', '59', '48', '49', '51', '52', '33', '75', '76'],
    },
    "225": {
        "name": "Côte d'Ivoire", "local_min": 8, "local_max": 10,
        "prefixes": ['01', '05', '07', '08', '09'] + [str(i).zfill(2) for i in range(40, 60)] + [str(i) for i in range(70, 100)],
    },
}


def validate_west_africa_phone(phone: str) -> str:
    """Valide un numéro de téléphone des 4 pays prioritaires Kojo.

    Retourne le numéro nettoyé (format international '+...'). Lève ValueError
    avec un message français lisible par l'utilisateur.
    """
    if not phone:
        raise ValueError("Le numéro de téléphone est requis")

    clean_phone = re.sub(r'[\s\-\(\)]', '', phone)
    if not clean_phone.startswith('+'):
        raise ValueError("Le numéro de téléphone doit commencer par +")

    digits_only = ''.join(filter(str.isdigit, clean_phone))
    for code, rules in WA_PHONE_RULES.items():
        if digits_only.startswith(code):
            local = digits_only[len(code):]
            if not (rules["local_min"] <= len(local) <= rules["local_max"]):
                raise ValueError(
                    f"Numéro +{code} doit contenir {rules['local_min']}-{rules['local_max']} "
                    f"chiffres après l'indicatif pays"
                )
            if len(local) >= 2 and local[:2] not in rules["prefixes"]:
                raise ValueError(f"Préfixe opérateur {local[:2]} non supporté pour +{code}")
            return clean_phone

    raise ValueError(
        "Seuls les numéros du Sénégal (+221), Mali (+223), Côte d'Ivoire (+225) "
        "et Burkina Faso (+226) sont supportés"
    )


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
    legal_documents_accepted: bool = Field(default=False)
    legal_documents_accepted_at: Optional[datetime] = None
    legal_documents_version: Optional[str] = Field(default=None, max_length=120)
    
    is_owner: bool = False

    @model_validator(mode='after')
    def compute_is_owner(self):
        """
        Determine reel du statut owner : par email, la meme methode utilisee
        partout ailleurs dans ce backend (voir verify_owner_access). On ne se
        fie pas a un champ "is_owner" ou "user_type" potentiellement absent/
        obsolete en base pour les comptes crees avant l'introduction de ce
        systeme.
        Migré de @validator(always=True) V1 → @model_validator(mode='after') V2.
        """
        if not self.email or not OWNER_EMAIL:
            self.is_owner = False
        else:
            self.is_owner = str(self.email).strip().lower() == OWNER_EMAIL.strip().lower()
        return self

    @field_validator('phone')
    @classmethod
    def validate_phone(cls, v):
        """Nettoie et valide le numéro de téléphone pour l'Afrique de l'Ouest"""
        return validate_west_africa_phone(v)
    profile_photo: Optional[str] = Field(None, max_length=500)  # URL length limit
    is_verified: bool = False
    email_verified: bool = False
    email_verified_at: Optional[datetime] = None
    # Parrainage : code unique à partager (invitation), et code du parrain
    # saisi à l'inscription (référence croisée, pas de crédit monétaire auto).
    referral_code: Optional[str] = Field(None, max_length=40)
    referred_by: Optional[str] = Field(None, max_length=40)
    payment_accounts: Optional[dict] = Field(None)  # Payment methods dict
    payment_accounts_count: int = Field(default=0, ge=0, le=10)  # Non-negative, max 10
    rating: float = Field(default=0.0, ge=0.0, le=5.0)  # Rating between 0-5
    total_reviews: int = Field(default=0, ge=0)  # Non-negative
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class WorkerProfile(BaseModel):
    user_id: str
    specialties: List[str] = Field(default=[], max_length=10)  # Max 10 specialties
    experience_years: int = Field(default=0, ge=0, le=50)  # 0-50 years experience

    cv_file: Optional[str] = Field(None, max_length=500)  # File path length limit
    portfolio_images: List[str] = Field(default=[], max_length=10)  # Max 10 portfolio images
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
    country: Optional[str] = None
    status: JobStatus = JobStatus.OPEN
    required_skills: List[str] = Field(default=[], max_length=20)  # Max 20 skills
    estimated_duration: Optional[str] = Field(None, max_length=100)  # Duration string limit
    posted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    deadline: Optional[datetime] = None
    assigned_worker_id: Optional[str] = None
    accepted_proposal_id: Optional[str] = None
    shared_location: Optional[dict] = None  # Position GPS partagee au travailleur lors de l'acceptation
    # Nouvelles informations pour mécaniciens avec validation
    mechanic_must_bring_parts: bool = False
    mechanic_must_bring_tools: bool = False  
    parts_and_tools_notes: Optional[str] = Field(None, max_length=1000)  # Notes length limit
    
    # Validation custom pour budget cohérent
    @field_validator('budget_max')
    @classmethod
    def budget_max_must_be_greater_than_min(cls, v, info):
        if 'budget_min' in info.data and v < info.data['budget_min']:
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
    # Rattache optionnellement le message à un job précis, pour permettre au
    # frontend de distinguer plusieurs échanges avec la même personne selon
    # la mission concernée (le fil complet reste consultable sur /messages,
    # ce champ ne sert qu'au filtrage contextuel depuis la page d'un job).
    job_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    read: bool = False
    # Horodatage de lecture (accusé de réception « Lu ») — défini quand le
    # destinataire ouvre la conversation et que read passe à True.
    read_at: Optional[datetime] = None

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

class Review(BaseModel):
    """Avis / note laissé par un participant sur l'autre partie d'une mission terminée."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    reviewer_id: str
    reviewee_id: str
    rating: int = Field(ge=1, le=5)  # 1-5 étoiles
    comment: Optional[str] = Field(None, max_length=1000)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5, description="Note de 1 à 5 étoiles")
    comment: Optional[str] = Field(None, max_length=1000, description="Commentaire optionnel (max 1000 caractères)")


class PushToken(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    push_token: str = Field(min_length=10, max_length=500)  # Expo push token length
    device_type: str = Field(min_length=2, max_length=50)  # ios, android, web
    device_id: Optional[str] = Field(None, max_length=200)  # Optional device identifier
    active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SupportTicketStatus(str, Enum):
    NEW = "Nouveau"
    IN_PROGRESS = "En cours"
    RESOLVED = "Résolu"

class SupportTicketCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone: str = Field(min_length=6, max_length=30, pattern=r'^\+?[0-9\s\-\.]{6,20}$')
    email: EmailStr
    reason: str = Field(min_length=2, max_length=150)
    message: str = Field(min_length=5, max_length=3000)
    channel: str = Field(default="robot", pattern=r'^(robot|direct)$')

class SupportTicket(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    full_name: str
    phone: str
    email: EmailStr
    reason: str
    message: str
    channel: str = "robot"
    status: SupportTicketStatus = SupportTicketStatus.NEW
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SupportTicketStatusUpdate(BaseModel):
    status: SupportTicketStatus

class NotificationType(str, Enum):
    PROPOSAL_RECEIVED   = "proposal_received"    # Client : nouvelle proposition
    PROPOSAL_ACCEPTED   = "proposal_accepted"    # Worker : proposition acceptée
    JOB_IN_PROGRESS     = "job_in_progress"      # Worker : mission démarrée
    PAYMENT_RECEIVED    = "payment_received"     # Worker : paiement reçu
    PAYMENT_CONFIRMED   = "payment_confirmed"    # Client : paiement confirmé
    JOB_COMPLETED       = "job_completed"        # Client + Worker : mission terminée
    NEW_MESSAGE         = "new_message"          # Message reçu
    GENERAL             = "general"              # Notification générique

class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str = Field(max_length=200)
    body: str = Field(max_length=500)
    type: NotificationType = NotificationType.GENERAL
    related_id: Optional[str] = None        # job_id ou message_id
    related_type: Optional[str] = None      # "job", "message", etc.
    is_read: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MarkReadRequest(BaseModel):
    notification_ids: Optional[List[str]] = None  # None = marquer tout

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72, description="Mot de passe (6-72 caractères — limite bcrypt de 72 octets)")
    first_name: str = Field(min_length=2, max_length=50)
    last_name: str = Field(min_length=2, max_length=50)
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language
    legal_documents_accepted: bool = Field(..., description="Acceptation obligatoire de la Politique de confidentialité et des conditions d’utilisation")
    legal_documents_accepted_at: Optional[datetime] = None
    legal_documents_version: str = Field(min_length=5, max_length=120)
    
    @field_validator('password')
    @classmethod
    def password_must_be_strong(cls, v):
        if not v or len(v.strip()) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v
    
    @field_validator('legal_documents_accepted')
    @classmethod
    def legal_documents_must_be_accepted(cls, v):
        if v is not True:
            raise ValueError("L'acceptation de la Politique de confidentialité et des conditions d’utilisation est obligatoire")
        return v

class PaymentAccount(BaseModel):
    orange_money: Optional[str] = None     # Numéro de téléphone Orange Money
    wave: Optional[str] = None            # Numéro de téléphone Wave  
    bank_account: Optional[dict] = None   # Informations complètes de compte bancaire

class UserWithPayment(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72, description="Mot de passe (6-72 caractères — limite bcrypt de 72 octets)")
    first_name: str = Field(min_length=2, max_length=50)
    last_name: str = Field(min_length=2, max_length=50)
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language
    legal_documents_accepted: bool = Field(..., description="Acceptation obligatoire de la Politique de confidentialité et des conditions d’utilisation")
    legal_documents_accepted_at: Optional[datetime] = None
    legal_documents_version: str = Field(min_length=5, max_length=120)
    payment_accounts: PaymentAccount
    email_verification_token: Optional[str] = None
    # Code de parrainage saisi à l'inscription (via ?ref= dans l'URL)
    referral_code: Optional[str] = Field(None, max_length=40)
    
    @field_validator('password')
    @classmethod
    def password_must_be_strong(cls, v):
        if not v or len(v.strip()) < 6:
            raise ValueError('Le mot de passe doit contenir au moins 6 caractères')
        return v

    @field_validator('legal_documents_accepted')
    @classmethod
    def legal_documents_must_be_accepted(cls, v):
        if v is not True:
            raise ValueError("L'acceptation de la Politique de confidentialité et des conditions d’utilisation est obligatoire")
        return v
    # Informations spécifiques aux travailleurs (optionnelles)
    worker_specialties: Optional[List[str]] = None
    worker_experience_years: Optional[int] = None

    # Photo de profil optionnelle pour tous
    profile_photo_base64: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    # Plafond généreux (128) : garde-fou anti-DoS mémoire, sans casser les
    # comptes hérités créés avant le plafond d'inscription à 72 caractères.
    password: str = Field(max_length=128)

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
    # 72 = limite bcrypt (au-delà, le hash tronque silencieusement)
    new_password: str = Field(min_length=6, max_length=72)

    @field_validator('new_password')
    @classmethod
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
    required_skills: List[str] = Field(default=[], max_length=20)
    estimated_duration: Optional[str] = Field(None, max_length=100)
    deadline: Optional[datetime] = None
    # Nouvelles informations pour mécaniciens avec validation
    mechanic_must_bring_parts: bool = False
    mechanic_must_bring_tools: bool = False
    parts_and_tools_notes: Optional[str] = Field(None, max_length=1000)
    
    @field_validator('budget_max')
    @classmethod
    def budget_max_must_be_greater_than_min(cls, v, info):
        if 'budget_min' in info.data and v < info.data['budget_min']:
            raise ValueError('budget_max must be greater than or equal to budget_min')
        return v

class ProposalCreate(BaseModel):
    proposed_amount: float = Field(gt=0.0, le=10000000.0)
    estimated_completion_time: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=10, max_length=2000)

class MessageCreate(BaseModel):
    receiver_id: str
    content: str = Field(min_length=1, max_length=5000)
    # Optionnel: le frontend l'envoie déjà depuis la page d'un job
    # (sendProposalConversationMessage) mais ce champ était jusqu'ici
    # silencieusement ignoré par Pydantic, ce qui cassait complètement le
    # filtrage par job côté JobDetails.js (le panneau de discussion
    # affichait 0 message, tout le temps).
    job_id: Optional[str] = None

class PushTokenCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    push_token: str = Field(min_length=10, max_length=500)
    device_type: str = Field(min_length=2, max_length=50, pattern=r'^(ios|android|web)$')
    device_id: Optional[str] = Field(None, max_length=200)
