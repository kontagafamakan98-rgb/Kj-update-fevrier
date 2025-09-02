from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import jwt
import bcrypt
from enum import Enum
import shutil

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Settings
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Owner/Admin configuration - SEUL FAMAKAN KONTAGA MASTER A ACCÈS
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', 'kontagamakan@gmail.com')  # Email de Famakan Kontaga Master
OWNER_USER_ID = 'famakan_kontaga_master_2024'  # ID unique pour Famakan

# Create the main app without a prefix
app = FastAPI(title="Kojo API", description="Service/Worker Platform for Mali & Senegal")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

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
    """Crée le compte de Famakan Kontaga Master s'il n'existe pas déjà"""
    existing_owner = await db.users.find_one({"id": OWNER_USER_ID})
    
    if not existing_owner:
        # Hasher un mot de passe sécurisé pour Famakan
        default_password = "FamakanKojo2024@Master!"
        hashed_password = bcrypt.hashpw(default_password.encode('utf-8'), bcrypt.gensalt())
        
        owner_data = {
            "id": OWNER_USER_ID,
            "email": OWNER_EMAIL,
            "password_hash": hashed_password.decode('utf-8'),
            "first_name": "Famakan",
            "last_name": "Kontaga Master",
            "user_type": "owner",  # Type spécial pour le propriétaire
            "phone": "+223701234567",  # Mali
            "country": "mali",
            "preferred_language": "fr",
            "profile_photo": None,
            "is_verified": True,
            "rating": 0.0,
            "total_reviews": 0,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
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
        print(f"✅ Compte Famakan Kontaga Master créé: {OWNER_EMAIL}")
        print(f"🔐 Mot de passe: {default_password}")
        print("⚠️  SEUL FAMAKAN KONTAGA MASTER PEUT ACCÉDER AUX FONCTIONNALITÉS SENSIBLES!")
    else:
        print(f"✅ Compte Famakan Kontaga Master existe déjà: {OWNER_EMAIL}")

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

class Language(str, Enum):
    FRENCH = "fr"
    WOLOF = "wo"
    BAMBARA = "bm"

class Country(str, Enum):
    MALI = "mali"
    SENEGAL = "senegal"
    BURKINA_FASO = "burkina_faso"
    IVORY_COAST = "ivory_coast"

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    first_name: str
    last_name: str
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language
    profile_photo: Optional[str] = None
    is_verified: bool = False
    rating: float = 0.0
    total_reviews: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class WorkerProfile(BaseModel):
    user_id: str
    specialties: List[str]
    experience_years: int
    hourly_rate: float
    cv_file: Optional[str] = None
    portfolio_images: List[str] = []
    availability: bool = True
    description: Optional[str] = None

class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_id: str
    title: str
    description: str
    category: str
    budget_min: float
    budget_max: float
    location: dict  # {"address": str, "latitude": float, "longitude": float}
    status: JobStatus = JobStatus.OPEN
    required_skills: List[str] = []
    estimated_duration: Optional[str] = None
    posted_at: datetime = Field(default_factory=datetime.utcnow)
    deadline: Optional[datetime] = None
    assigned_worker_id: Optional[str] = None

class JobProposal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    worker_id: str
    proposed_amount: float
    estimated_completion_time: str
    message: str
    status: str = "pending"  # pending, accepted, rejected
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    sender_id: str
    receiver_id: str
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    read: bool = False

class Payment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    payer_id: str
    receiver_id: str
    amount: float
    payment_method: PaymentMethod
    transaction_id: Optional[str] = None
    status: str = "pending"  # pending, completed, failed
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Request/Response Models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    phone: str
    user_type: UserType
    country: Country
    preferred_language: Language

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class JobCreate(BaseModel):
    title: str
    description: str
    category: str
    budget_min: float
    budget_max: float
    location: dict
    required_skills: List[str] = []
    estimated_duration: Optional[str] = None
    deadline: Optional[datetime] = None

class ProposalCreate(BaseModel):
    proposed_amount: float
    estimated_completion_time: str
    message: str

class MessageCreate(BaseModel):
    receiver_id: str
    content: str

# Utility Functions
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

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
@api_router.post("/auth/register")
async def register_user(user_data: UserRegister):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create new user
    hashed_password = hash_password(user_data.password)
    user = User(
        **user_data.dict(exclude={"password"}),
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

@api_router.post("/auth/login")
async def login_user(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email})
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    access_token = create_access_token(data={"sub": user["id"], "email": user["email"]})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": User(**user).dict(exclude={"password_hash"})
    }

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
    update_data["updated_at"] = datetime.utcnow()
    
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
    # Validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Validate file size (5MB max)
    file_size = 0
    file_content = await file.read()
    file_size = len(file_content)
    
    if file_size > 5 * 1024 * 1024:  # 5MB
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB")
    
    # Create uploads directory if it doesn't exist
    uploads_dir = Path("uploads/profile_photos")
    uploads_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename
    file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{current_user.id}_{int(datetime.utcnow().timestamp())}.{file_extension}"
    file_path = uploads_dir / filename
    
    # Save file
    with open(file_path, "wb") as buffer:
        buffer.write(file_content)
    
    # Update user profile with photo URL
    photo_url = f"/uploads/profile_photos/{filename}"
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"profile_photo": photo_url, "updated_at": datetime.utcnow()}}
    )
    
    return {
        "message": "Profile photo uploaded successfully",
        "photo_url": photo_url,
        "filename": filename
    }

@api_router.get("/users/profile-photo")
async def get_profile_photo(current_user: User = Depends(get_current_user)):
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo found")
    
    return {
        "photo_url": current_user.profile_photo,
        "user_id": current_user.id
    }

@api_router.delete("/users/profile-photo")
async def delete_profile_photo(current_user: User = Depends(get_current_user)):
    if not current_user.profile_photo:
        raise HTTPException(status_code=404, detail="No profile photo to delete")
    
    # Try to delete the physical file
    try:
        file_path = Path(f".{current_user.profile_photo}")
        if file_path.exists():
            file_path.unlink()
    except Exception as e:
        logging.warning(f"Could not delete photo file: {e}")
    
    # Update user profile
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"profile_photo": None, "updated_at": datetime.utcnow()}}
    )
    
    return {"message": "Profile photo deleted successfully"}

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
    if current_user.user_type != UserType.CLIENT:
        raise HTTPException(status_code=403, detail="Only clients can create jobs")
    
    job = Job(**job_data.dict(), client_id=current_user.id)
    await db.jobs.insert_one(job.dict())
    return job

@api_router.get("/jobs", response_model=List[Job])
async def get_jobs(
    status: Optional[JobStatus] = None,
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if category:
        query["category"] = category
    
    jobs = await db.jobs.find(query).sort("posted_at", -1).to_list(100)
    return [Job(**job) for job in jobs]

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
    return {"status": "healthy", "timestamp": datetime.utcnow()}

# ============================================================================
# ENDPOINTS PROTÉGÉS PROPRIÉTAIRE - ACCÈS RESTREINT
# ============================================================================

@api_router.get("/owner/commission-stats")
async def get_commission_stats(owner_user = Depends(verify_owner_access)):
    """Statistiques des commissions - PROPRIÉTAIRE UNIQUEMENT"""
    try:
        # Simuler des statistiques de commission (remplacez par vraies données)
        stats = {
            "total_transactions": 156,
            "total_commission_earned": 2450000,  # En XOF
            "commission_rate": 14,  # 14%
            "total_volume": 17500000,  # Volume total des paiements
            "daily_commission": 35000,
            "monthly_commission": 875000,
            "top_payment_methods": [
                {"method": "orange_money", "volume": 8500000, "commission": 1190000},
                {"method": "wave", "volume": 5200000, "commission": 728000},
                {"method": "bank_card", "volume": 3800000, "commission": 532000}
            ],
            "recent_transactions": [
                {
                    "id": "TXN_001",
                    "amount": 50000,
                    "commission": 7000,
                    "worker_amount": 43000,
                    "method": "orange_money",
                    "date": datetime.utcnow().isoformat()
                }
            ]
        }
        
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
                    "updated_at": datetime.utcnow().isoformat(),
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

# ============================================================================

# Include the router in the main app
app.include_router(api_router)

# Serve uploaded files
from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    """Initialiser le système au démarrage"""
    print("🚀 Démarrage de l'API Kojo...")
    
    # Créer le compte propriétaire s'il n'existe pas
    await ensure_owner_exists()
    
    # Créer le dossier uploads
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)
    print("📁 Dossier uploads créé/vérifié")
    
    print("✅ API Kojo prête!")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()