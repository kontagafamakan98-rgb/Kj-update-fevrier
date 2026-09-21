# -*- coding: utf-8 -*-
"""Connexion MongoDB, sonde de disponibilite et creation des index.

Ce module possede LE nom `db` : c'est ici que le client Motor est cree et que
les tests posent leur doublure (`tests/conftest.py` patche `kojo_db.db` AVANT
que quiconque lie le nom). Depuis le decoupage de `kojo_core`, c'est la seule
source : chaque module qui parle a la base importe `db` d'ici.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from kojo_retention import RETENTION_RULES
from kojo_settings import logger
from motor.motor_asyncio import AsyncIOMotorClient
import os

try:
    mongo_url = os.environ.get('MONGO_URL')
    if not mongo_url:
        raise ValueError("MONGO_URL environment variable is required")
    
    db_name = os.environ.get('DB_NAME', 'kojo_db')  # Default fallback
    if not db_name:
        raise ValueError("DB_NAME environment variable is required")

    client = AsyncIOMotorClient(
        mongo_url,
        serverSelectionTimeoutMS=30000,
        connectTimeoutMS=30000,
        socketTimeoutMS=30000,
    )
    db = client[db_name]

    # Test connection on startup
    logger.info(f"✅ MongoDB connected to: {db_name}")
except Exception as e:
    logger.error(f"❌ MongoDB connection failed: {e}")
    raise
async def is_database_available() -> bool:
    """Return True when MongoDB is reachable, otherwise False."""
    try:
        await db.command("ping")
        return True
    except Exception as e:
        logger.warning(f"⚠️ MongoDB unavailable: {e}")
        return False
async def create_database_indexes():
    """Create indexes on frequently queried fields for better performance"""
    if not await is_database_available():
        logger.warning("⚠️ Skipping MongoDB index creation because the database is unavailable.")
        return

    try:
        # Users collection indexes
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.users.create_index("user_type")
        await db.users.create_index("country")
        await db.users.create_index([("email", 1), ("password_hash", 1)])
        # Comptes SSO Google : un sub Google est lié à AU PLUS UN compte Kojo.
        # Sparse : les comptes mot-de-passe n'ont pas de google_sub et ne
        # doivent pas être contraints par cet index.
        await db.users.create_index("google_sub", unique=True, sparse=True)
        
        # Jobs collection indexes
        await db.jobs.create_index("id", unique=True)
        await db.jobs.create_index("client_id")
        await db.jobs.create_index("status")
        await db.jobs.create_index("category")
        await db.jobs.create_index("country")
        await db.jobs.create_index([("status", 1), ("category", 1)])
        await db.jobs.create_index([("status", 1), ("created_at", -1)])
        await db.jobs.create_index([("created_at", -1)])  # For sorting by date
        # Géospatial : recherche par rayon (GET /jobs?lat=&lng=&radius_km=)
        await db.jobs.create_index([("geo", "2dsphere")])

        # Backfill best-effort des jobs existants : certains ont des
        # coordonnées dans location.latitude/longitude mais pas de point
        # GeoJSON (ajouté à la création depuis cette fonctionnalité). On les
        # met à jour pour que la recherche par rayon fonctionne sur les
        # données historiques. Borné et non bloquant.
        try:
            cursor = db.jobs.find(
                {"geo": {"$exists": False}, "location.latitude": {"$ne": None}, "location.longitude": {"$ne": None}},
                {"_id": 0, "id": 1, "location": 1},
            ).limit(500)
            async for job_doc in cursor:
                loc = job_doc.get("location") or {}
                try:
                    lat = float(loc.get("latitude"))
                    lng = float(loc.get("longitude"))
                    if lat is not None and lng is not None:
                        await db.jobs.update_one(
                            {"id": job_doc.get("id")},
                            {"$set": {"geo": {"type": "Point", "coordinates": [lng, lat]}}},
                        )
                except (TypeError, ValueError):
                    continue
        except Exception as exc:
            logger.warning(f"⚠️ Backfill geo jobs impossible: {exc}")
        
        # Proposals collection indexes — sur la VRAIE collection job_proposals
        # (l'ancienne "proposals" n'est plus utilisée par aucun code ; les
        # index y étaient créés à tort, laissant job_proposals sans index).
        await db.job_proposals.create_index("id", unique=True)
        await db.job_proposals.create_index("job_id")
        await db.job_proposals.create_index("worker_id")
        await db.job_proposals.create_index([("job_id", 1), ("worker_id", 1)])
        
        # Messages collection indexes
        # NOTE: les index précédents portaient sur "job_id" et "created_at",
        # deux champs qui n'existent pas sur le modèle Message (id,
        # conversation_id, sender_id, receiver_id, content, timestamp, read)
        # - ces index ne servaient donc à rien. "conversation_id", lui,
        # est utilisé dans quasiment toutes les requêtes messages et n'était
        # pas indexé du tout (full collection scan à chaque conversation
        # ouverte).
        await db.messages.create_index("id", unique=True)
        await db.messages.create_index([("sender_id", 1), ("receiver_id", 1)])
        await db.messages.create_index([("conversation_id", 1), ("timestamp", 1)])
        await db.messages.create_index([("timestamp", -1)])
        await db.messages.create_index("job_id")
        
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
        # (index TTL des paiements : dans le bloc de conservation plus bas,
        # créé depuis kojo_retention.RETENTION_RULES)

        # Email OTP collection indexes
        await db.email_otps.create_index([("email", 1), ("purpose", 1)], unique=True)
        # (index TTL des codes OTP : bloc de conservation plus bas)
        await db.email_otps.create_index([("created_at", -1)])

        # Notifications collection indexes
        await db.notifications.create_index("id", unique=True)
        await db.notifications.create_index("user_id")
        await db.notifications.create_index([("user_id", 1), ("is_read", 1)])
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        # (index TTL des notifications : bloc de conservation plus bas)

        # Reviews (avis) collection indexes
        await db.reviews.create_index("id", unique=True)
        await db.reviews.create_index("job_id")
        await db.reviews.create_index("reviewee_id")
        await db.reviews.create_index([("job_id", 1), ("reviewer_id", 1)], unique=True)
        await db.reviews.create_index([("created_at", -1)])

        # Push tokens collection indexes
        await db.push_tokens.create_index("id", unique=True)
        await db.push_tokens.create_index("user_id")
        await db.push_tokens.create_index([("user_id", 1), ("active", 1)])

        await db.revoked_tokens.create_index("jti", unique=True)
        # (index TTL des jetons révoqués : bloc de conservation plus bas)

        # --- Index TTL : conservation des données ----------------------------
        # Ces index ne reçoivent plus leur `expireAfterSeconds` écrit à la main
        # ici : la durée ET l'index viennent de kojo_retention.RETENTION_RULES,
        # qui est aussi ce dont PRIVACY.md publie le tableau. Un chiffre écrit
        # des deux côtés finit toujours par diverger ; un garde le refuse
        # désormais (.github/scripts/check-privacy-policy.py).
        for regle in RETENTION_RULES:
            await db[regle.collection].create_index(
                regle.ttl_field, **regle.options_index()
            )

        logger.info("✅ MongoDB indexes created successfully")
    except Exception as e:
        logger.warning(f"⚠️ Error creating indexes (may already exist): {e}")
