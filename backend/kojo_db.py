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
import kojo_index_declares as index_declares
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
async def _backfill_geo_jobs():
    """Recopie `location.latitude/longitude` dans le point GeoJSON `geo`.

    Best-effort, borné, non bloquant : la recherche par rayon ne voit que
    `geo`, et des missions d'avant cette fonctionnalité n'en portent pas.
    """
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


async def create_database_indexes():
    """Crée (ou RÉPARE) chaque index DÉCLARÉ — un `try` PAR index.

    POURQUOI UN `try` PAR INDEX (mesuré le 27/10/2026) : la version d'avant
    enveloppait les ~70 créations dans un seul `try`. Le sixième index échouait
    (`google_sub` en `unique`+`sparse` face aux `null` écrits par
    l'inscription), et les 66 suivants n'étaient JAMAIS créés — index texte de
    la recherche, `2dsphere` du tri par distance, TTL de conservation compris.
    L'échec partait dans un `logger.warning` à chaque démarrage, et le repli
    `$regex` de la recherche répondait 200 sans que rien ne signale la lenteur.

    Un index en échec ne doit plus emporter les autres, et le RÉSUMÉ doit être
    lisible une fois par démarrage : combien sont conformes, lesquels ont été
    remplacés, lesquels ont échoué. `scripts/check_index_db.py` juge la même
    déclaration côté production — la sonde et la création lisent la MÊME liste.
    """
    if not await is_database_available():
        logger.warning("⚠️ Skipping MongoDB index creation because the database is unavailable.")
        return

    declares = index_declares.declarations()
    crees = 0
    remplaces = []
    echecs = []

    for declare in declares:
        collection = str(declare["collection"])
        nom = index_declares.nom(declare)
        try:
            await db[collection].create_index(declare["cle"], **declare["options"])
            crees += 1
            continue
        except Exception as exc:  # noqa: BLE001 - l'échec d'un index ne vaut pas les autres
            if not index_declares.conflit_d_options(exc):
                echecs.append((collection, nom, exc))
                logger.error(f"❌ Index {collection}.{nom} NON créé : {exc}")
                continue

        # Même nom, AUTRES options : c'est l'état que laisse un index dont la
        # règle a changé (le `google_sub` unique+sparse d'avant). Un index
        # périmé n'est pas un index : il ne porte pas la contrainte annoncée.
        # Un retrait, UNE reprise — jamais une boucle, jamais un retrait en aveugle
        # (seul un conflit d'options 85/86 y mène ; un 11000 est un doublon réel).
        try:
            await db[collection].drop_index(nom)
            await db[collection].create_index(declare["cle"], **declare["options"])
            crees += 1
            remplaces.append(f"{collection}.{nom}")
            logger.warning(
                f"⚠️ Index {collection}.{nom} REMPLACÉ : il existait avec d'autres "
                "options que celles déclarées."
            )
        except Exception as seconde:
            echecs.append((collection, nom, seconde))
            logger.error(f"❌ Index {collection}.{nom} NON remplacé : {seconde}")

    await _backfill_geo_jobs()

    resume = f"Index MongoDB : {crees}/{len(declares)} conformes"
    if remplaces:
        resume += f", {len(remplaces)} remplacé(s)"
    if echecs:
        resume += f", {len(echecs)} ÉCHEC(S)"
        logger.error(resume)
        logger.error(
            "Index en échec (la sonde `scripts/check_index_db.py` les nomme aussi) : "
            + ", ".join(f"{collection}.{nom}" for collection, nom, _ in echecs)
        )
    else:
        logger.info("✅ " + resume)


