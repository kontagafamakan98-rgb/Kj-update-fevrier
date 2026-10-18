# -*- coding: utf-8 -*-
"""Push TEMPS RÉEL (Server-Sent Events) : le sondage devient un événement.

POURQUOI CE MODULE EXISTE

`NotificationContext` interrogeait `/notifications/unread-count` toutes les 30 s
et `/messages` toutes les 5 s (fil ouvert) ou 15 s (liste des conversations).
Mesuré (`SCALING.md`, §5) : jusqu'à **18 requêtes par minute et par session**
pour un utilisateur qui lit ses messages, alors que rien ne change la plupart du
temps. À 4 000 sessions actives, cela représentait 293 rps de sondages — plus
que la capacité d'une machine entière (85 rps).

Ici, le serveur POUSSE : une connexion SSE par session, aucun aller-retour tant
qu'il ne se passe rien. Le compteur de charge ne dépend plus du temps qui passe,
seulement des événements réels (une notification, un message).

CE QUE CE MODULE NE FAIT PAS, ET QUI DOIT ÊTRE DIT

  * **Le fan-out reste en mémoire, et le bus le PROLONGE.** Un événement publié
    est toujours déposé dans les files LOCALES d'abord (aucune I/O, aucun
    `await`) ; s'il y a un `REDIS_URL`, il est ensuite confié à un bus pub/sub
    qu'ÉCOUTE chaque process, qui le redistribue à SES flux. Sans `REDIS_URL`,
    rien ne change : le bus n'existe pas et un événement ne joint que les flux
    de ce process (exact pour un worker, écrit dans `SCALING.md` §5).
    `kojo_settings` refuse déjà `WEB_CONCURRENCY > 1` sans `REDIS_URL` en
    production ; hors production, `start_bus` DIT la perte au lieu de la taire.
  * **Il ne remplace pas la base.** Un flux perdu (reconnexion, plafond atteint)
    se répare en RELISANT l'API : l'événement `ready` porte le compteur exact,
    et `resync` demande au client de recharger. Le push est un accélérateur,
    jamais la source de vérité.
  * **Il ne bloque pas un flux métier.** `publish` est synchrone, ne lève pas et
    ne touche à aucune I/O : une notification qui ne part pas en direct reste
    lisible par l'API (elle est stockée AVANT l'appel).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from collections import defaultdict
from typing import Any, AsyncIterator, Dict, Iterable, List, Optional, Set, Tuple

from fastapi.responses import StreamingResponse

from kojo_settings import logger

# --- Réglages (surchargeables par l'exploitation, valeurs par défaut ici) -----

# Battement de cœur : un commentaire SSE toutes les 20 s. Sans lui, un proxy
# (Fly, Vercel, un opérateur mobile) coupe une connexion silencieuse au bout
# d'une minute, et le client croirait le flux vivant alors qu'il est mort. Le
# battement ne crée AUCUNE requête : c'est le même flux qui écrit une ligne.
HEARTBEAT_SECONDS = float(os.environ.get("KOJO_SSE_HEARTBEAT_SECONDS", "20") or 20)

# Un même compte ouvre normalement UN flux par onglet. Quatre laisse de la marge
# (plusieurs onglets, téléphone + ordinateur) sans qu'un client bogué puisse
# épuiser le plafond global à lui seul.
#
# C'est le plafond du COMPTE, pas celui d'une machine : la présence des flux
# était un état de PROCESS, donc quatre flux par worker — seize derrière quatre
# workers pour un seul compte. Le registre partagé ci-dessous porte cette
# présence dans Redis, et c'est LUI qui décide ; le compte local reste un filet
# quand aucun registre n'est branché.
MAX_STREAMS_PER_USER = int(os.environ.get("KOJO_SSE_MAX_PER_USER", "4") or 4)

# --- Plafond PARTAGÉ (registre Redis) ---------------------------------------
#
# OPTIONNEL, comme le bus : sans Redis — ou si Redis ne répond pas — le plafond
# LOCAL reste seul juge, et un flux n'est JAMAIS refusé pour une panne de Redis.
# Refuser un flux parce que le compteur est muet transformerait une dépendance
# d'accélération en dépendance d'existence.
FLUX_PREFIX = "kojo:live:flux:"
# Bail d'un flux, repoussé à chaque battement de cœur. Un process tué sans
# passer par son `finally` (kill -9, machine perdue) voit donc ses flux expirer
# d'eux-mêmes : sans bail, un worker mort garderait ses places pour toujours.
PARTAGE_LEASE_SECONDS = max(60.0, HEARTBEAT_SECONDS * 3)
# Borne d'attente du registre : il ne doit jamais retarder l'ouverture d'un flux
# de plus que ça. Au-delà, on retombe sur le plafond local.
PARTAGE_TIMEOUT_SECONDS = float(
    os.environ.get("KOJO_LIVE_PARTAGE_TIMEOUT_SECONDS", "1") or 1
)

# Plafond GLOBAL du process. Ce n'est pas la capacité de l'API (une connexion
# SSE ne coûte presque rien) mais une borne explicite, pour que la ressource
# « connexions » reste comptée quelque part : au-delà, le flux répond 503 et le
# client retombe sur le sondage dégradé au lieu de saturer la machine en
# silence. La borne de Fly (`fly.toml`, [services.concurrency]) est plus haute.
MAX_STREAMS_TOTAL = int(os.environ.get("KOJO_SSE_MAX_TOTAL", "1000") or 1000)

# File d'un abonné. Une notification par seconde pendant une rafale tient
# largement ; au-delà, le client est plus lent que le produit et on lui demande
# de RELIRE (événement `resync`) plutôt que de lui faire perdre un événement en
# silence.
MAX_QUEUE_SIZE = 100

# --- Bus partagé (Redis pub/sub) --------------------------------------------
#
# Le fan-out reste EN MÉMOIRE et le bus ne fait que le PROLONGER : c'est ce qui
# permet à un Redis en panne de ne jamais empêcher un flux de recevoir
# l'événement publié dans SON process. `publish` dépose donc toujours
# localement d'abord, puis PROPOSE l'événement au bus (dépôt non bloquant).

# Un seul canal : le fan-out est déjà adressé par `user_id` dans l'enveloppe,
# donc un canal par compte multiplierait les abonnements sans rien filtrer de
# plus (chaque process devrait de toute façon les écouter tous).
BUS_CHANNEL = (os.environ.get("KOJO_LIVE_BUS_CHANNEL", "kojo:live") or "kojo:live").strip()

# Tampon de publication : `publish` y fait un `put_nowait`, donc un Redis lent
# ne bloque JAMAIS une route. Au-delà, l'événement reste LOCAL (le bus le perd,
# pas le produit) et le refus est compté puis nommé dans le journal.
BUS_QUEUE_SIZE = int(os.environ.get("KOJO_LIVE_BUS_QUEUE", "1000") or 1000)

# Reprise de l'abonnement : un Redis qui redémarre ne doit pas laisser le
# process sourd jusqu'au prochain déploiement. Délai court (le bus est un
# accélérateur, pas la source de vérité) mais jamais une boucle serrée.
BUS_RECONNECT_SECONDS = float(
    os.environ.get("KOJO_LIVE_BUS_RECONNECT_SECONDS", "2") or 2
)

SSE_HEADERS = {
    # Aucun cache, aucune transformation : un flux mis en cache rejouerait les
    # événements d'hier, et un proxy qui compresse ou tamponne retiendrait les
    # lignes jusqu'à la fermeture (le flux paraîtrait muet).
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class StreamCapacityExceeded(Exception):
    """Plafond de flux atteint : le client doit se rabattre sur le sondage.

    C'est une réponse NOMMÉE (503 + `Retry-After` côté router), jamais un flux
    vide : un flux accepté puis muet serait indiscernable d'une absence
    d'événements, et le client attendrait indéfiniment.
    """


# --- Abonnés -----------------------------------------------------------------

_flux: Dict[str, Set[asyncio.Queue]] = defaultdict(set)
_total = 0


def active_streams() -> int:
    """Nombre de flux ouverts dans ce process (diagnostic / tests)."""
    return _total


def active_streams_for(user_id: str) -> int:
    """Nombre de flux d'un compte (bornage par compte)."""
    return len(_flux.get(user_id) or ())


def reset_streams() -> None:
    """Vide le registre LOCAL et ses compteurs — réservé aux tests.

    Le registre PARTAGÉ vit dans Redis : il ne se vide pas d'ici (ce serait
    effacer les flux des autres workers). Un cas isole donc le sien avec son
    propre client, et `reset_bus()` débranche celui qu'il a posé.
    """
    global _total
    _flux.clear()
    _total = 0
    for cle in _flux_compteurs:
        _flux_compteurs[cle] = 0


def subscribe(user_id: str) -> asyncio.Queue:
    """Ouvre un flux pour ce compte et rend sa file d'événements.

    Lève `StreamCapacityExceeded` si le compte ou le process est au plafond.
    """
    global _total
    if len(_flux.get(user_id) or ()) >= MAX_STREAMS_PER_USER:
        raise StreamCapacityExceeded(
            "Trop de flux ouverts pour ce compte (%d)" % MAX_STREAMS_PER_USER
        )
    if _total >= MAX_STREAMS_TOTAL:
        raise StreamCapacityExceeded(
            "Trop de flux ouverts sur ce serveur (%d)" % MAX_STREAMS_TOTAL
        )
    queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
    _flux.setdefault(user_id, set()).add(queue)
    _total += 1
    return queue


def unsubscribe(user_id: str, queue: asyncio.Queue) -> None:
    """Ferme un flux. Idempotent : deux appels ne décrémentent qu'une fois."""
    global _total
    files = _flux.get(user_id)
    if not files or queue not in files:
        return
    files.discard(queue)
    _total = max(0, _total - 1)
    if not files:
        _flux.pop(user_id, None)


def publish(user_id: str, event: str, data: Any) -> int:
    """Pousse un événement aux flux OUVERTS de ce compte. Rend le nombre de flux servis.

    Synchrone et silencieux : `put_nowait` sur des files bornées ne fait aucune
    I/O. Un flux dont la file est pleine est jugé en retard — il reçoit
    `resync` (le client relit la source de vérité) au lieu de perdre un
    événement sans le savoir.

    L'ordre est le sujet : le dépôt LOCAL d'abord (il ne peut pas échouer), la
    proposition au bus ENSUITE (elle ne peut pas bloquer). Un bus absent, lent
    ou en panne ne prive donc jamais le process qui publie de son propre flux.
    """
    servis = _deposer_local(user_id, event, data)
    _offrir_au_bus(user_id, event, data)
    return servis


def _deposer_local(user_id: str, event: str, data: Any) -> int:
    """Le fan-out du process : dépose dans les files de CE process, sans I/O."""
    files = _flux.get(user_id)
    if not files:
        return 0
    servis = 0
    for queue in list(files):
        try:
            queue.put_nowait((event, data))
            servis += 1
            continue
        except asyncio.QueueFull:
            pass
        try:
            queue.get_nowait()
            queue.put_nowait(("resync", {"motif": "file_pleine"}))
            servis += 1
        except Exception:  # noqa: BLE001 - un flux en retard ne casse pas l'envoi
            logger.warning("Flux SSE saturé pour %s : resync non déposé", user_id)
    return servis


# --- Bus partagé (Redis pub/sub) --------------------------------------------
#
# Ce que le bus fait, et ce qu'il ne fait pas :
#   * il porte l'événement aux AUTRES process (workers uvicorn, autres
#     machines) ;
#   * il n'est PAS la source de vérité : un événement perdu se répare par une
#     relecture (`ready` recompte, `resync` relit) ;
#   * il ne double pas la livraison : chaque enveloppe porte l'ORIGINE du
#     process qui l'a publiée, et un process ignore son propre écho (il a déjà
#     livré localement au moment du `publish`).

_origine = uuid.uuid4().hex
_bus_client: Any = None
_bus_client_local = False
_bus_file: Optional[asyncio.Queue] = None
_bus_taches: List[asyncio.Task] = []
_bus_actif = False
_bus_compteurs: Dict[str, int] = {
    "publies": 0,
    "recus": 0,
    "echo": 0,
    "illisibles": 0,
    "repli": 0,
    "perdus": 0,
}


def origine_du_processus() -> str:
    """Identité du process dans le bus (diagnostic / tests)."""
    return _origine


def bus_actif() -> bool:
    """Le bus partagé est-il branché dans CE process ?"""
    return _bus_actif


def bus_stats() -> Dict[str, int]:
    """Compteurs du bus : publiés, reçus, échos ignorés, illisibles, replis, perdus."""
    return dict(_bus_compteurs)


def _creer_client_redis() -> Any:
    """Client Redis du bus, ou None. Ne lève jamais : le bus est optionnel."""
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis.asyncio as aioredis
    except ImportError:
        logger.warning(
            "⚠️ Temps réel : package 'redis' absent — bus partagé DÉSACTIVÉ, "
            "le fan-out reste en mémoire par process. Ajouter 'redis>=5.0.0' "
            "à requirements.txt pour l'activer."
        )
        return None
    try:
        return aioredis.from_url(
            url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            health_check_interval=30,
        )
    except Exception as exc:  # noqa: BLE001 - un bus optionnel ne casse pas le boot
        logger.warning("⚠️ Temps réel : client Redis refusé (%s) — bus désactivé.", exc)
        return None


def _signaler_sans_bus() -> None:
    """Dit la perte quand plusieurs workers tournent sans bus, au lieu de la taire."""
    try:
        workers = int((os.environ.get("WEB_CONCURRENCY") or "1").strip() or 1)
    except (TypeError, ValueError):
        workers = 1
    if workers > 1:
        logger.warning(
            "⚠️ Temps réel : %d worker(s) SANS bus partagé (REDIS_URL absent) — "
            "un événement publié dans un worker ne joint que les flux de CE "
            "worker ; les clients concernés se réparent en relisant (resync).",
            workers,
        )


async def start_bus(client: Any = None) -> bool:
    """Branche le bus partagé. Rend False (sans lever) quand il n'y a pas de Redis.

    `client` est injectable : les preuves d'exécution éprouvent le protocole
    (publication, réception, anti-écho, reprise) avec un double, sans exiger un
    serveur Redis dans la CI.
    """
    global _bus_client, _bus_client_local, _bus_file, _bus_actif, _partage_client
    if _bus_actif:
        return True
    if client is None:
        client = _creer_client_redis()
        _bus_client_local = client is not None
    if client is None:
        _signaler_sans_bus()
        return False
    _bus_client = client
    # Le registre du plafond partagé suit le MÊME client : une seconde
    # connexion pour la même adresse ne servirait à rien, et deux clients se
    # fermeraient l'un l'autre au shutdown.
    _partage_client = client
    file = asyncio.Queue(maxsize=BUS_QUEUE_SIZE)
    _bus_file = file
    _bus_taches.extend(
        [
            # La file est passée EN ARGUMENT : si `stop_bus` la déréférence
            # pendant un `await`, la tâche garde la sienne jusqu'à son arrêt.
            asyncio.create_task(_publieur(client, file)),
            asyncio.create_task(_abonnement(client)),
        ]
    )
    _bus_actif = True
    logger.info("✅ Temps réel : bus partagé sur le canal « %s » (REDIS_URL)", BUS_CHANNEL)
    return True


async def stop_bus() -> None:
    """Coupe les deux tâches du bus. Idempotent, et ne lève pas.

    Le client n'est fermé que s'il a été CRÉÉ ici : un client injecté par un
    test (ou par un appelant) garde sa propre durée de vie.
    """
    global _bus_client, _bus_client_local, _bus_file, _bus_actif
    taches, _bus_taches[:] = list(_bus_taches), []
    for tache in taches:
        tache.cancel()
    if taches:
        await asyncio.gather(*taches, return_exceptions=True)
    global _partage_client
    client, local = _bus_client, _bus_client_local
    _bus_client = None
    _bus_client_local = False
    _bus_file = None
    _bus_actif = False
    _partage_client = None
    if local and client is not None:
        try:
            await client.aclose()
        except Exception:  # noqa: BLE001 - fermeture best-effort
            logger.debug("Bus temps réel : fermeture du client Redis incomplète")


def reset_bus() -> None:
    """Remet le bus à zéro sans fermer de client — réservé aux tests.

    Une tâche déjà démarrée n'est PAS annulée ici (`stop_bus` s'en charge) : ce
    reset sert aux fixtures qui isolent les compteurs et l'origine observée.
    """
    global _bus_client, _bus_client_local, _bus_file, _bus_actif, _partage_client
    _bus_client = None
    _bus_client_local = False
    _bus_file = None
    _bus_actif = False
    _partage_client = None
    _bus_taches.clear()
    for cle in _bus_compteurs:
        _bus_compteurs[cle] = 0


def _offrir_au_bus(user_id: str, event: str, data: Any) -> None:
    """Dépose l'événement dans le tampon de publication. Ne bloque pas, ne lève pas."""
    if not _bus_actif or _bus_file is None:
        return
    try:
        _bus_file.put_nowait((user_id, event, data))
    except asyncio.QueueFull:
        _bus_compteurs["perdus"] += 1
        logger.warning(
            "Bus temps réel saturé : l'événement « %s » reste LOCAL "
            "(process %s) et ne sera pas vu des autres workers.",
            event,
            _origine[:8],
        )


async def _publieur(client: Any, file: asyncio.Queue) -> None:
    """Vide le tampon vers le canal partagé, une enveloppe à la fois."""
    while True:
        user_id, event, data = await file.get()
        charge = json.dumps(
            {"o": _origine, "u": user_id, "e": event, "d": data},
            ensure_ascii=False,
            default=str,
            separators=(",", ":"),
        )
        try:
            await client.publish(BUS_CHANNEL, charge)
            _bus_compteurs["publies"] += 1
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - l'événement local est déjà livré
            _bus_compteurs["repli"] += 1
            logger.warning(
                "Bus temps réel injoignable à la publication (%s) : l'événement "
                "reste LOCAL et les autres workers ne le verront pas.",
                exc,
            )
            await asyncio.sleep(BUS_RECONNECT_SECONDS)


async def _abonnement(client: Any) -> None:
    """Écoute le canal partagé et redistribue aux flux LOCAUX de ce process.

    La reprise est une boucle bornée par `BUS_RECONNECT_SECONDS` : un Redis qui
    redémarre ne doit pas rendre le process sourd pour toute sa vie.
    """
    while True:
        pubsub = None
        try:
            pubsub = client.pubsub()
            await pubsub.subscribe(BUS_CHANNEL)
            async for message in pubsub.listen():
                if not message or message.get("type") != "message":
                    continue
                _livrer_enveloppe(message.get("data"))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - l'abonnement se reprend
            _bus_compteurs["repli"] += 1
            logger.warning(
                "Bus temps réel : abonnement interrompu (%s) — reprise dans %.1f s.",
                exc,
                BUS_RECONNECT_SECONDS,
            )
        finally:
            if pubsub is not None:
                try:
                    await pubsub.aclose()
                except Exception:  # noqa: BLE001 - fermeture best-effort
                    pass
        await asyncio.sleep(BUS_RECONNECT_SECONDS)


def _livrer_enveloppe(brut: Any) -> int:
    """Rend une enveloppe du bus aux files locales. Rend le nombre de flux servis.

    Une enveloppe ILLISIBLE est ignorée et comptée : jeter l'exception ferait
    tomber l'abonnement pour un message d'un autre producteur (ou d'une version
    antérieure), c'est-à-dire pour un incident qui ne concerne pas le produit.
    """
    if isinstance(brut, (bytes, bytearray)):
        brut = brut.decode("utf-8", "replace")
    enveloppe = None
    if isinstance(brut, str):
        try:
            enveloppe = json.loads(brut)
        except (TypeError, ValueError):
            enveloppe = None
    if not isinstance(enveloppe, dict):
        _bus_compteurs["illisibles"] += 1
        logger.warning("Bus temps réel : enveloppe illisible ignorée (process %s).", _origine[:8])
        return 0
    user_id, event = enveloppe.get("u"), enveloppe.get("e")
    if not isinstance(user_id, str) or not user_id or not isinstance(event, str) or not event:
        _bus_compteurs["illisibles"] += 1
        logger.warning("Bus temps réel : enveloppe sans destinataire ni événement, ignorée.")
        return 0
    if enveloppe.get("o") == _origine:
        # Mon propre écho : ce process a DÉJÀ livré localement au `publish`.
        # Le livrer une seconde fois doublerait chaque événement.
        _bus_compteurs["echo"] += 1
        return 0
    _bus_compteurs["recus"] += 1
    return _deposer_local(user_id, event, enveloppe.get("d"))


# --- Plafond partagé : la présence des flux, vue de TOUS les workers --------
#
# Les deux scripts sont ATOMIQUES côté Redis. Un `ZCARD` puis un `ZADD` en deux
# allers-retours laisserait deux workers admettre chacun le cinquième flux du
# même compte au même instant : le plafond serait dépassé pile quand il sert.

# Rend -1 si le flux est ADMIS, sinon le nombre de flux déjà présents.
SCRIPT_RESERVER = """
-- kojo:reserver
local cle = KEYS[1]
local maintenant = tonumber(ARGV[1])
local membre = ARGV[2]
local expiration = tonumber(ARGV[3])
local plafond = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', cle, '-inf', maintenant)
redis.call('ZADD', cle, expiration, membre)
local total = redis.call('ZCARD', cle)
if total > plafond then
  redis.call('ZREM', cle, membre)
  return total - 1
end
redis.call('PEXPIRE', cle, tonumber(ARGV[5]))
return -1
"""

# Repousse le bail d'un flux vivant (battement de cœur).
SCRIPT_RAFRAICHIR = """
-- kojo:rafraichir
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
"""

_flux_compteurs: Dict[str, int] = {"reserves": 0, "refus": 0, "repli": 0}
_partage_client: Any = None
_partage_deja_signale = False
# Libérations en vol : une tâche non référencée peut être collectée avant
# d'avoir rendu la place au compte.
_liberations: Set[asyncio.Future] = set()


def partage_stats() -> Dict[str, int]:
    """Compteurs du registre partagé : réservés, refusés, replis locaux."""
    return dict(_flux_compteurs)


def brancher_partage(client: Any) -> None:
    """Branche le registre partagé SEUL (sans le bus) — tests, outils, mesure.

    `start_bus` le branche aussi, sur le MÊME client. Ce point d'entrée existe
    pour qu'un cas puisse éprouver le plafond sans démarrer la publication ni
    l'abonnement.
    """
    global _partage_client
    _partage_client = client


def _cle_flux(user_id: str) -> str:
    return "%s%s" % (FLUX_PREFIX, user_id)


def _membre() -> str:
    """Identité d'un flux : origine du process + identifiant propre.

    L'origine rend le registre LISIBLE (quel worker tient ce flux) ; elle ne
    sert à aucun filtrage, le compte étant déjà l'adresse.
    """
    return "%s:%s" % (_origine[:8], uuid.uuid4().hex)


def _signaler_repli(exc: Exception) -> None:
    """Dit la panne du registre UNE fois par panne, pas à chaque flux."""
    global _partage_deja_signale
    if _partage_deja_signale:
        return
    _partage_deja_signale = True
    logger.warning(
        "⚠️ Plafond de flux : registre partagé injoignable (%s) — le plafond "
        "LOCAL reste seul juge, et aucun flux n'est refusé pour autant.",
        exc,
    )


async def _reserver_flux_partage(user_id: str, membre: str) -> bool:
    """Réserve une place au compte, tous workers confondus. False = refusé.

    Une panne du registre n'est PAS un refus : elle est comptée (`repli`) et le
    plafond local décide seul. Sans Redis configuré, il n'y a rien à partager.
    """
    global _partage_deja_signale
    client = _partage_client
    if client is None:
        return True
    maintenant = int(time.time() * 1000)
    bail_ms = int(PARTAGE_LEASE_SECONDS * 1000)
    try:
        resultat = await asyncio.wait_for(
            client.eval(
                SCRIPT_RESERVER,
                1,
                _cle_flux(user_id),
                maintenant,
                membre,
                maintenant + bail_ms,
                MAX_STREAMS_PER_USER,
                bail_ms * 2,
            ),
            timeout=PARTAGE_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - un registre optionnel ne ferme rien
        _flux_compteurs["repli"] += 1
        _signaler_repli(exc)
        return True
    _partage_deja_signale = False
    if resultat == -1:
        _flux_compteurs["reserves"] += 1
        return True
    _flux_compteurs["refus"] += 1
    return False


async def _rafraichir_flux_partage(user_id: str, membre: str) -> None:
    """Repousse le bail du flux. Silencieux : le flux LOCAL continue, lui."""
    client = _partage_client
    if client is None:
        return
    bail_ms = int(PARTAGE_LEASE_SECONDS * 1000)
    try:
        await asyncio.wait_for(
            client.eval(
                SCRIPT_RAFRAICHIR,
                1,
                _cle_flux(user_id),
                int(time.time() * 1000) + bail_ms,
                membre,
                bail_ms * 2,
            ),
            timeout=PARTAGE_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - le flux local ne dépend pas du bail
        _flux_compteurs["repli"] += 1
        _signaler_repli(exc)


async def _liberer_flux_partage(user_id: str, membre: str) -> None:
    """Retire le flux du registre. Silencieux : le bail l'aurait emporté."""
    client = _partage_client
    if client is None:
        return
    try:
        await asyncio.wait_for(
            client.zrem(_cle_flux(user_id), membre),
            timeout=PARTAGE_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 - l'expiration du bail répare
        _flux_compteurs["repli"] += 1
        _signaler_repli(exc)


async def _liberer_flux_partage_sans_etre_annulee(user_id: str, membre: str) -> None:
    """Libère la place MÊME quand le flux est en train d'être annulé.

    Un client qui ferme son onglet annule la tâche de réponse. Tout `await` du
    `finally` est alors interrompu par le scope d'annulation de Starlette, et la
    place resterait prise jusqu'à l'expiration du bail (60 s) : le compte se
    verrait refuser un flux après avoir simplement fermé un onglet.

    La libération est donc une TÂCHE à part, protégée par `shield` : l'attente
    peut être interrompue, la tâche — qui n'est pas dans le scope annulé — va
    jusqu'au bout. Elle est gardée dans `_liberations` pour qu'aucun ramasse-miettes
    ne l'emporte avant d'avoir rendu la place.
    """
    tache = asyncio.ensure_future(_liberer_flux_partage(user_id, membre))
    _liberations.add(tache)
    tache.add_done_callback(_liberations.discard)
    await asyncio.shield(tache)


# --- Format et flux ----------------------------------------------------------


def sse_frame(event: str, data: Any) -> str:
    """Une trame SSE (`event:` + `data:` JSON + ligne vide finale).

    JSON échappe les retours à la ligne : une `data:` ne peut donc pas contenir
    un saut de ligne qui couperait la trame en deux.
    """
    charge = json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))
    return "event: %s\ndata: %s\n\n" % (event, charge)


async def event_stream(
    user_id: str,
    queue: asyncio.Queue,
    initial: Iterable[Tuple[str, Any]] = (),
    membre: Optional[str] = None,
) -> AsyncIterator[str]:
    """Le corps du flux : événements d'amorçage, puis les événements poussés.

    Le battement de cœur est un COMMENTAIRE SSE (`: keepalive`) : il garde la
    connexion ouverte sans rien annoncer, et ne crée aucune requête.

    La file est TOUJOURS retirée du registre à la sortie (déconnexion, erreur,
    annulation du serveur) : sans ce `finally`, un onglet fermé laisserait un
    abonné fantôme, et le plafond par compte finirait par refuser les vrais. Le
    membre PARTAGÉ (`membre`) est retiré dans le même geste, pour la même
    raison, à l'échelle du COMPTE.
    """
    try:
        for event, data in initial:
            yield sse_frame(event, data)
        while True:
            try:
                event, data = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                # Le bail partagé est repoussé EN MÊME TEMPS que le battement :
                # un flux vivant dont le bail expirerait passerait pour fermé,
                # et le plafond du compte laisserait entrer un flux de trop.
                if membre is not None:
                    await _rafraichir_flux_partage(user_id, membre)
                yield ": keepalive\n\n"
                continue
            yield sse_frame(event, data)
    finally:
        unsubscribe(user_id, queue)
        if membre is not None:
            await _liberer_flux_partage_sans_etre_annulee(user_id, membre)


async def sse_response(
    user_id: str,
    initial: Iterable[Tuple[str, Any]] = (),
) -> StreamingResponse:
    """Réponse SSE pour un compte. Lève `StreamCapacityExceeded` AVANT les en-têtes.

    Deux plafonds, dans cet ordre : le LOCAL (capacité du process), puis le
    PARTAGÉ (le compte, tous workers confondus). L'abonnement est pris ICI (et
    non au premier `next()` du générateur) : un refus de capacité doit être un
    503, pas un flux vide et muet.

    Si le plafond partagé refuse, la place LOCALE est rendue : un refus qui
    laisserait un abonné fantôme compterait pour un autre flux du même compte,
    et le compte se fermerait lui-même.
    """
    queue = subscribe(user_id)
    membre = _membre()
    if not await _reserver_flux_partage(user_id, membre):
        unsubscribe(user_id, queue)
        raise StreamCapacityExceeded(
            "Trop de flux ouverts pour ce compte (%d, tous workers confondus)"
            % MAX_STREAMS_PER_USER
        )
    return StreamingResponse(
        event_stream(user_id, queue, initial, membre=membre),
        media_type="text/event-stream",
        headers=dict(SSE_HEADERS),
    )
