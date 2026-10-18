#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Serveur de CHARGE : le vrai `server.app`, une base EN MÉMOIRE à latence simulée.

Pourquoi ce montage plutôt qu'un MongoDB réel : la question posée est « combien
de requêtes par seconde tient ce backend, et où casse-t-il », pas « quel est le
débit d'Atlas ». Une base en mémoire dont chaque opération coûte
`--latence-ms` isole la COUCHE APPLICATIVE (middlewares, auth, validation
Pydantic, sérialisation, event loop) — exactement ce que le nombre de machines
Fly décide — et laisse varier un seul paramètre à la fois.

Ce que ce serveur NE mesure PAS, et qui est nommé dans `backend/SCALING.md` :
le débit de MongoDB (index, disque, connexions), celui du réseau, et la
politique de rate-limiting (désactivée ici : c'est un contrôle, pas une
capacité ; ses seuils sont commentés dans le rapport).

Le remplacement de `kojo_db.db` doit précéder l'import de `kojo_core` : les
modules font `from kojo_core import db`, donc ils lient le NOM à l'import et
remplacer l'attribut plus tard ne les atteindrait plus.

BUS : le banc peut brancher le bus temps réel sur un serveur pub/sub EN
MÉMOIRE (`--bus memoire`), qui porte le protocole de `redis.asyncio` mais
AUCUN réseau. Il mesure donc le coût du PRODUIT (encodage, dépôt, tâche de
publication, réception, décodage, contrôle d'origine) et jamais l'aller-retour
de Redis — c'est écrit tel quel dans `backend/SCALING.md` §5. Sans `--bus`, le
fan-out reste strictement local, comme en production sans `REDIS_URL`.

Deux routes de BANC sont ajoutées à l'application mesurée :
  * `POST /_mesure/publier {user_id, evenements}` → `kojo_live.publish` ;
  * `GET /_mesure/bus` → `bus_actif()` + `bus_stats()` + flux ouverts, pour
    qu'un relevé qui n'a rien publié ne puisse pas se lire comme un vert.

Exemple :
    python scripts/charge/serveur_mesure.py --port 8990 --users 40000
    python scripts/charge/serveur_mesure.py --port 8990 --bus memoire
"""
import argparse
import asyncio
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Environnement de mesure, posé AVANT tout import applicatif : les modules
# lisent ces variables à l'import (kojo_settings, kojo_db).
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017/kojo_mesure")
os.environ.setdefault("DB_NAME", "kojo_mesure")
os.environ["KOJO_LOG_FILE"] = "off"
os.environ.setdefault("DISABLE_TRUSTED_HOST_MIDDLEWARE", "true")
os.environ.setdefault("OWNER_EMAIL", "")
os.environ.setdefault("OWNER_INITIAL_PASSWORD", "")

import kojo_db  # noqa: E402  (après le posé de l'environnement)

# --------------------------------------------------------------------------
# Base en mémoire, latence injectée par opération
# --------------------------------------------------------------------------
LATENCE_S = 0.001


class _Curseur:
    """Curseur Motor paresseux : la latence est payée à la LECTURE (`to_list`)."""

    def __init__(self, curseur, latence):
        self._c = curseur
        self._latence = latence

    def sort(self, *args, **kwargs):
        self._c = self._c.sort(*args, **kwargs)
        return self

    def skip(self, *args, **kwargs):
        self._c = self._c.skip(*args, **kwargs)
        return self

    def limit(self, *args, **kwargs):
        self._c = self._c.limit(*args, **kwargs)
        return self

    async def to_list(self, length=None):
        await asyncio.sleep(self._latence)
        return await self._c.to_list(length)

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self._c.__anext__()


class _Collection:
    def __init__(self, reelle, latence):
        self._r = reelle
        self._latence = latence

    async def _appel(self, nom, *args, **kwargs):
        await asyncio.sleep(self._latence)
        return await getattr(self._r, nom)(*args, **kwargs)

    def find(self, *args, **kwargs):
        return _Curseur(self._r.find(*args, **kwargs), self._latence)

    def aggregate(self, *args, **kwargs):
        return _Curseur(self._r.aggregate(*args, **kwargs), self._latence)

    async def find_one(self, *a, **k):
        return await self._appel("find_one", *a, **k)

    async def find_one_and_update(self, *a, **k):
        return await self._appel("find_one_and_update", *a, **k)

    async def find_one_and_delete(self, *a, **k):
        return await self._appel("find_one_and_delete", *a, **k)

    async def count_documents(self, *a, **k):
        return await self._appel("count_documents", *a, **k)

    async def estimated_document_count(self, *a, **k):
        return await self._appel("estimated_document_count", *a, **k)

    async def distinct(self, *a, **k):
        return await self._appel("distinct", *a, **k)

    async def insert_one(self, *a, **k):
        return await self._appel("insert_one", *a, **k)

    async def insert_many(self, *a, **k):
        return await self._appel("insert_many", *a, **k)

    async def update_one(self, *a, **k):
        return await self._appel("update_one", *a, **k)

    async def update_many(self, *a, **k):
        return await self._appel("update_many", *a, **k)

    async def replace_one(self, *a, **k):
        return await self._appel("replace_one", *a, **k)

    async def delete_one(self, *a, **k):
        return await self._appel("delete_one", *a, **k)

    async def delete_many(self, *a, **k):
        return await self._appel("delete_many", *a, **k)

    async def create_index(self, *a, **k):
        return await self._appel("create_index", *a, **k)

    async def bulk_write(self, *a, **k):
        return await self._appel("bulk_write", *a, **k)

    def __getattr__(self, nom):
        return getattr(self._r, nom)


def _haute_resolution_temporelle():
    """Windows arrondit `asyncio.sleep` au tic de l'horloge (~15,6 ms).

    Sans cela, une latence simulée de 1 ms coûterait 15,6 ms par opération et
    la mesure ne dirait plus rien de l'application. `timeBeginPeriod(1)`
    ramène le tic à 1 ms — c'est un réglage de BANC, jamais du serveur livré.
    """
    if sys.platform == "win32":
        import ctypes

        try:
            ctypes.WinDLL("winmm").timeBeginPeriod(1)
        except OSError as exc:  # pragma: no cover - dépend de l'hôte
            print(f"⚠️ Résolution temporelle non ajustée : {exc}", flush=True)


class BaseEnMemoire:
    """Base Motor-en-mémoire dont chaque opération coûte une latence réseau."""

    def __init__(self, reelle, latence):
        self._r = reelle
        self._latence = latence
        self._collections = {}

    def __getattr__(self, nom):
        if nom.startswith("_"):
            raise AttributeError(nom)
        if nom not in self._collections:
            self._collections[nom] = _Collection(self._r[nom], self._latence)
        return self._collections[nom]

    def __getitem__(self, nom):
        return getattr(self, nom)

    async def command(self, *a, **k):
        await asyncio.sleep(self._latence)
        return {"ok": 1}


# --------------------------------------------------------------------------
# Jeu de données
# --------------------------------------------------------------------------
def _utilisateur(i: int, mot_de_passe_hache: str) -> dict:
    return {
        "id": f"u{i}",
        "email": f"user{i}@mesure.kojo",
        "password_hash": mot_de_passe_hache,
        "first_name": "Awa",
        "last_name": "Traore",
        "phone": "+221771234567",
        "user_type": "worker" if i % 3 else "client",
        "country": "senegal",
        "preferred_language": "fr",
        "legal_documents_accepted": True,
        "legal_documents_version": "v1.0.0-2024",
        "is_verified": True,
        "email_verified": True,
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "skills": ["plomberie", "electricite"],
        "bio": "Artisan depuis dix ans.",
        "rating": 4.5,
        "total_reviews": 12,
    }


def _job(i: int) -> dict:
    cree = datetime(2026, 9, 1, tzinfo=timezone.utc) + timedelta(minutes=i)
    return {
        "id": f"job-{i}",
        "client_id": f"u{i % 1000}",
        "title": f"Reparation plomberie urgente {i}",
        "description": "Fuite d'eau sous l'evier de la cuisine, intervention rapide demandee.",
        "category": "plomberie",
        "budget_min": 10000.0,
        "budget_max": 30000.0,
        "location": {"address": "Dakar Plateau, Senegal"},
        "country": "senegal",
        "status": "open",
        "required_skills": ["plomberie"],
        "posted_at": cree,
        "created_at": cree,
        "deleted": False,
    }


def _notification(i: int, user_id: str) -> dict:
    return {
        "id": f"n{i}",
        "user_id": user_id,
        "type": "general",
        "title": "Nouvelle proposition",
        "message": "Un travailleur a propose ses services pour votre mission.",
        "is_read": i % 4 == 0,
        "created_at": datetime(2026, 9, 20, tzinfo=timezone.utc) + timedelta(minutes=i),
        "related_id": f"job-{i % 500}",
        "related_type": "job",
    }


async def amorcer(base, nb_users: int, nb_jobs: int, nb_notifications: int):
    """Insère le jeu de données SANS latence (hors mesure).

    bcrypt est appelé DIRECTEMENT ici, jamais via `kojo_auth_core` : importer
    ce module avant le remplacement de `kojo_db.db` lierait le nom `db` à la
    vraie connexion Motor, et l'authentification de la mesure irait frapper
    une base injoignable.
    """
    import bcrypt

    hache = bcrypt.hashpw(b"password123", bcrypt.gensalt()).decode("utf-8")
    await base.users.insert_many([_utilisateur(i, hache) for i in range(nb_users)])
    await base.jobs.insert_many([_job(i) for i in range(nb_jobs)])
    await base.notifications.insert_many(
        [_notification(i, f"u{i % nb_users}") for i in range(nb_notifications)]
    )
    await base.settings.insert_one({"type": "commission", "rate": 0.14})


# --------------------------------------------------------------------------
# Patches : lentilles et bruit
# --------------------------------------------------------------------------
class _ReponseFactice:
    ok = True
    status_code = 200
    text = '{"ok": true}'

    def json(self):
        return {"ok": True}


class _RequestsLent:
    """Double de `requests` : chaque POST prend `lenteur` SECONDES, en CPU."""

    RequestException = Exception

    def __init__(self, lenteur: float):
        self.lenteur = lenteur

    def post(self, *args, **kwargs):
        time.sleep(self.lenteur)
        return _ReponseFactice()

    def get(self, *args, **kwargs):
        time.sleep(self.lenteur)
        return _ReponseFactice()


async def _sans_effet(*args, **kwargs):
    return None


async def _boucle_inactive(*args, **kwargs):
    await asyncio.Event().wait()


# --------------------------------------------------------------------------
# Bus temps réel de BANC (serveur pub/sub en mémoire)
# --------------------------------------------------------------------------
class _PubSubMemoire:
    """L'abonnement d'un process : la file du canal, et un arrêt propre."""

    def __init__(self, bus: "BusEnMemoire"):
        self._bus = bus
        self._file = None
        self._ferme = False

    async def subscribe(self, canal):
        self._file = self._bus.abonner(canal)

    async def listen(self):
        while not self._ferme:
            message = await self._file.get()
            if message is None:
                return
            yield {"type": "message", "data": message}

    async def aclose(self):
        if not self._ferme and self._file is not None:
            self._ferme = True
            self._file.put_nowait(None)


class BusEnMemoire:
    """Un Redis pub/sub SANS réseau : le protocole, jamais l'aller-retour.

    Ce qu'il paie est exactement ce que le produit ajoute : `json.dumps` de
    l'enveloppe, le dépôt dans la file de publication, le réveil de la tâche de
    publication, la réception et `json.loads`. Ce qu'il ne paie pas : le RTT de
    Redis (0,3 à 1 ms en local, davantage entre zones), qui n'est donc PAS dans
    les chiffres publiés.
    """

    def __init__(self):
        self._abonnes = {}

    def abonner(self, canal):
        return self._abonnes.setdefault(canal, asyncio.Queue())

    async def publish(self, canal, charge):
        file = self._abonnes.get(canal)
        if file is None:
            return 0
        file.put_nowait(charge)
        return 1

    def pubsub(self):
        return _PubSubMemoire(self)

    async def aclose(self):
        return None


def _brancher_bus(app, bus):
    """Démarre le bus DANS la boucle du serveur, autour du lifespan livré.

    Le lifespan de `server` démarre et arrête déjà le bus (sans `REDIS_URL`, il
    ne branche rien) : on l'enveloppe pour brancher le double de banc juste
    après, et le couper juste avant.
    """
    import kojo_live

    originale = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(application):
        async with originale(application):
            await kojo_live.start_bus(client=bus)
            # Le bus de banc n'est pas un Redis : il ne porte pas le registre
            # du plafond PARTAGÉ. On le DÉBRANCHE au lieu de lui faire lever
            # une exception à chaque flux — le plafond local décide, et les
            # chiffres publiés ne prétendent pas mesurer le partage.
            kojo_live.brancher_partage(None)
            try:
                yield
            finally:
                await kojo_live.stop_bus()

    app.router.lifespan_context = _lifespan
    return app


def construire_app(lenteur_email: float = 0.0):
    import kojo_rate_limit

    # Le rate-limiting est un CONTRÔLE (anti-abus), pas une capacité : ici il
    # ne ferait que transformer des 429 en mesures fausses (le bucket
    # `/api/auth/email` vaut 12 requêtes / 5 min / IP, et tout le banc vient de
    # 127.0.0.1). Il est mesuré séparément, par lecture de sa politique —
    # cf. `backend/SCALING.md`, section « Ce qui casse avant le CPU ».
    async def _toujours_autorise(*args, **kwargs):
        return True

    kojo_rate_limit.rate_limit_check = _toujours_autorise

    import kojo_core  # noqa: F401  (importe APRÈS le remplacement de kojo_db.db)
    import server

    # Démarrage : les index sont créés par le vrai Mongo en production, et les
    # boucles de fond ajouteraient un bruit non mesuré.
    server.create_database_indexes = _sans_effet
    server.ensure_owner_exists = _sans_effet
    server.init_paydunya_circuit = _sans_effet
    server._rate_limit_cleanup_loop = _boucle_inactive
    server.payout_stuck_sweeper_loop = _boucle_inactive
    server.retention_purge_loop = _boucle_inactive
    server.email_provider_alert_loop = _boucle_inactive

    if lenteur_email > 0:
        import kojo_email

        # `backend/.env` peut poser EMAIL_PROVIDER=none (mode local, aucun
        # envoi) : sans cette résolution forcée, la route OTP rendrait la main
        # avant tout appel réseau et la mesure ne verrait aucun blocage.
        kojo_email.active_email_provider = lambda: ("brevo", None)
        kojo_email.brevo_is_configured = lambda: True
        kojo_email.requests = _RequestsLent(lenteur_email)

    return server.app


def main():
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--port", type=int, default=8990)
    parseur.add_argument("--users", type=int, default=40_000)
    parseur.add_argument("--jobs", type=int, default=2_000)
    parseur.add_argument("--notifications", type=int, default=100_000)
    parseur.add_argument("--latence-ms", type=float, default=1.0)
    parseur.add_argument(
        "--lenteur-email",
        type=float,
        default=0.0,
        help="secondes de blocage par envoi d'email (simule un fournisseur lent)",
    )
    parseur.add_argument(
        "--bus",
        choices=("aucun", "memoire"),
        default="aucun",
        help="bus temps réel : aucun (fan-out local, défaut) ou memoire (serveur "
        "pub/sub sans réseau — mesure le coût du PRODUIT, pas le RTT de Redis)",
    )
    args = parseur.parse_args()

    global LATENCE_S
    LATENCE_S = max(0.0, args.latence_ms) / 1000.0
    _haute_resolution_temporelle()

    from mongomock_motor import AsyncMongoMockClient

    concrete = AsyncMongoMockClient()["kojo_mesure"]
    print(f"⏳ Amorçage : {args.users} users, {args.jobs} jobs, "
          f"{args.notifications} notifications…", flush=True)
    debut = time.perf_counter()
    asyncio.run(amorcer(concrete, args.users, args.jobs, args.notifications))
    print(f"✅ Amorçage en {time.perf_counter() - debut:.1f}s", flush=True)

    kojo_db.db = BaseEnMemoire(concrete, LATENCE_S)

    async def _disponible():
        return True

    kojo_db.is_database_available = _disponible

    app = construire_app(lenteur_email=args.lenteur_email)

    # Routes de BANC : elles n'existent pas dans le produit livré. Elles sont
    # ajoutées ICI pour que la charge publiée passe exactement par le chemin
    # des routes réelles (`kojo_live.publish`), et pour qu'un relevé puisse
    # prouver que le bus a réellement publié (sinon un zéro se lirait comme un
    # « coût nul » alors qu'il ne mesurerait rien).
    import kojo_live

    @app.post("/_mesure/publier")
    async def _mesure_publier(payload: dict):
        user_id = str(payload.get("user_id") or "")
        evenements = max(0, int(payload.get("evenements", 1)))
        for index in range(evenements):
            kojo_live.publish(
                user_id,
                "notification",
                {"notification": {"id": f"mesure-{time.perf_counter_ns()}-{index}"}},
            )
        return {
            "publies": evenements,
            "flux": kojo_live.active_streams_for(user_id),
        }

    @app.get("/_mesure/bus")
    async def _mesure_bus():
        return {
            "actif": kojo_live.bus_actif(),
            "flux": kojo_live.active_streams(),
            **kojo_live.bus_stats(),
        }

    if args.bus == "memoire":
        _brancher_bus(app, BusEnMemoire())
        print("🔌 Bus temps réel : serveur pub/sub EN MÉMOIRE (aucun réseau)", flush=True)

    import uvicorn

    print(
        f"🚀 Mesure sur http://127.0.0.1:{args.port} — latence DB simulée "
        f"{args.latence_ms:.1f} ms/op, lenteur email {args.lenteur_email:.2f}s",
        flush=True,
    )
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
