# -*- coding: utf-8 -*-
"""Plafond des tentatives de connexion par RÉSEAU — et pas par adresse IP.

POURQUOI CE MODULE

Le verrou de `kojo_login_guard` compte l'attaque du point de vue du COMPTE
visé. Il ne voit rien d'une attaque qui change de compte à chaque essai (le
« password spraying ») : huit échecs répartis sur huit comptes ne verrouillent
personne. Le rate-limiter, lui, ne connaît que des ADRESSES IP — or en Afrique
de l'Ouest, Orange, Sonatel et Wave partagent une poignée d'IP publiques entre
des milliers d'abonnés (CGNAT) : une limite par IP punit des voisins qui n'ont
rien fait, tandis qu'une attaque répartie sur mille IP ne la touche jamais.

Le bon objet n'est donc ni le compte seul, ni l'IP seule : c'est le RÉSEAU, au
sens de l'agrégat d'adresses qu'un opérateur fait sortir ensemble. Ce module
plafonne les ÉCHECS de connexion par réseau (/24 en IPv4, /64 en IPv6), et
seulement les échecs : une connexion qui réussit n'est jamais refusée à cause
des autres.

TROIS RÈGLES, ET POURQUOI CHACUNE

  1. CE QUI EST COMPTÉ, CE SONT LES ÉCHECS. Compter les requêtes punirait un
     réseau dont les abonnés se connectent beaucoup ; compter les échecs décrit
     exactement ce qu'est une attaque par dictionnaire.
  2. UN EMAIL INCONNU COMPTE AUSSI. Sinon le plafond ne verrait pas le
     « spraying » qui teste des adresses au hasard — et un compteur qui ne
     compterait que les comptes existants deviendrait, par son 429, un moyen de
     savoir lesquels existent.
  3. AU SEUIL, LE RÉSEAU PASSE AU GOUTTE-À-GOUTTE, il n'est pas bloqué. Une
     seule tentative est admise toutes les `SONDAGE_SECONDS` secondes ; les
     autres reçoivent 429 + `Retry-After`. C'est ce qui distingue ce plafond du
     verrou de COMPTE : un compte verrouillé refuse même le bon mot de passe
     (c'est sa raison d'être), alors qu'un VOISIN du même réseau doit pouvoir se
     connecter. Le prix d'une attaque est donc borné à une tentative toutes les
     cinq secondes, et aucun voisin n'attend plus que ces cinq secondes.

CE QUI EST ASSUMÉ

Une tentative « sonde » peut réussir : c'est le but. Un attaquant qui possède
déjà un identifiant valide sur ce réseau garde donc ce que le verrou de compte
lui laisserait de toute façon — et un succès ne remet PAS le compteur réseau à
zéro, sinon il suffirait d'un identifiant valide pour repartir à zéro.

STOCKAGE

Redis quand `REDIS_URL` est posé (compteur partagé par tous les workers, TTL
naturel), sinon la mémoire du process — même choix, et même limite, que le
rate-limiter : en production sans Redis le dépôt tourne à UN process
(`kojo_settings` refuse `WEB_CONCURRENCY > 1`), donc le compteur est exact.
Aucune collection Mongo : un compteur de 15 minutes n'est pas un état à
conserver, l'écrire en base aurait exigé sa ligne RGPD et sa règle de
conservation (cf. la même décision dans `kojo_login_guard`).

Une panne du compteur n'empêche JAMAIS de se connecter : la lecture échouée
laisse passer (le verrou de compte reste appliqué), l'écriture échouée est
comptée et journalisée.
"""
import ipaddress
import time
from typing import Dict, List

from kojo_settings import logger

# ── Les bornes, écrites une fois ────────────────────────────────────────────
# Échecs admis par réseau et par fenêtre AVANT le goutte-à-goutte. Un opérateur
# ouest-africain fait sortir des milliers d'abonnés derrière un même /24 : à
# 0,5 % de connexions ratées sur 5 000 abonnés, une heure chargée produit une
# trentaine d'échecs seulement. 120 laisse donc passer une journée normale
# (fautes de frappe comprises) tout en restant très en dessous de ce qu'exige
# un dictionnaire — et il est délibérément plus GRAND que `SEUIL_ECHECS` du
# verrou de compte, parce qu'il compte des milliers de personnes à la fois.
SEUIL_ECHECS = 120
# Fenêtre d'observation : au-delà, les échecs anciens ne comptent plus.
FENETRE_MINUTES = 15
# Cadence du goutte-à-goutte une fois le seuil atteint : c'est le temps MAXIMAL
# qu'un voisin peut attendre avant de pouvoir se connecter.
SONDAGE_SECONDS = 5

# Longueur maximale d'une clé de repli (une IP illisible n'est pas un identifiant
# libre : sans borne, un en-tête forgé ferait grossir le dictionnaire mémoire).
LONGUEUR_MAX_CLE = 64
# Garde-fou anti-DoS mémoire, comme `RATE_LIMIT_MAX_TRACKED_KEYS`.
MAX_RESEAUX = 20_000

# ── État mémoire (repli, et mode par défaut sans Redis) ─────────────────────
_echecs: Dict[str, List[float]] = {}
_sondages: Dict[str, float] = {}
_stats = {"replis": 0, "derniere_panne": None}
_dernier_log = 0.0


def reseau_de(ip: str) -> str:
    """Réseau d'une adresse : /24 en IPv4, /64 en IPv6.

    L'agrégat est ce qui rend la règle applicable en CGNAT : une IP publique
    partagée par un opérateur appartient à SON réseau, et ses voisins avec
    elle. Une adresse illisible n'est PAS fondue dans un seau commun (un seul
    en-tête mal formé ne doit pas faire porter les fautes de tous) : elle garde
    sa propre clé, bornée en longueur.
    """
    brut = (ip or "").strip()
    if not brut:
        return "reseau:inconnu"
    # `X-Forwarded-For` porte des adresses nues, mais un test ou un proxy local
    # peut laisser « 1.2.3.4:5678 » ou « [::1] ».
    candidat = brut.strip("[]")
    if candidat.count(":") == 1 and "." in candidat:
        candidat = candidat.split(":", 1)[0]
    try:
        adresse = ipaddress.ip_address(candidat)
    except ValueError:
        return "reseau:" + brut[:LONGUEUR_MAX_CLE]
    # IPv4 mappée en IPv6 (::ffff:1.2.3.4) : c'est la MÊME source qu'en IPv4.
    mappee = getattr(adresse, "ipv4_mapped", None)
    if mappee is not None:
        adresse = mappee
    prefixe = 24 if adresse.version == 4 else 64
    return str(ipaddress.ip_network(f"{adresse}/{prefixe}", strict=False))


def _fenetre_seconds() -> int:
    return FENETRE_MINUTES * 60


def _noter_repli(exc: Exception) -> None:
    """Compte et journalise un repli mémoire, au plus une fois par minute.

    Un Redis en panne ne doit ni spammer le journal à chaque requête, ni passer
    inaperçu : même arbitrage que le rate-limiter.
    """
    global _dernier_log
    _stats["replis"] += 1
    _stats["derniere_panne"] = time.time()
    maintenant = time.monotonic()
    if maintenant - _dernier_log < 60:
        return
    _dernier_log = maintenant
    logger.warning(
        f"⚠️ Plafond de connexion par réseau : compteur Redis indisponible ({exc}), "
        "repli mémoire (par process)"
    )


def stats() -> Dict[str, object]:
    """Relevé du repli (une panne silencieuse serait indiscernable d'un plafond)."""
    return dict(_stats)


# ── Voie mémoire ────────────────────────────────────────────────────────────
def _recent(reseau: str) -> List[float]:
    seuil = time.time() - _fenetre_seconds()
    recents = [quand for quand in _echecs.get(reseau, []) if quand > seuil]
    if recents:
        _echecs[reseau] = recents
    else:
        _echecs.pop(reseau, None)
    return recents


def _purger_memoire() -> None:
    """Borne le dictionnaire : une clé de repli ne doit pas être une fuite."""
    seuil = time.time() - _fenetre_seconds()
    for cle in [c for c, v in _echecs.items() if not v or max(v) <= seuil]:
        _echecs.pop(cle, None)
    if len(_echecs) > MAX_RESEAUX:
        # Un compteur de 15 minutes est JETABLE : le vider vaut mieux que
        # laisser une attaque le faire grossir sans fin.
        _echecs.clear()
        logger.warning("⚠️ Plafond de connexion par réseau : compteurs mémoire purgés (plafond atteint)")


def _echecs_memoire(reseau: str) -> int:
    return len(_recent(reseau))


def _enregistrer_memoire(reseau: str) -> int:
    recents = _recent(reseau)
    recents.append(time.time())
    _echecs[reseau] = recents
    if len(_echecs) > MAX_RESEAUX:
        _purger_memoire()
    return len(recents)


def _prendre_sondage_memoire(reseau: str) -> bool:
    maintenant = time.time()
    dernier = _sondages.get(reseau)
    if dernier is not None and maintenant - dernier < SONDAGE_SECONDS:
        return False
    _sondages[reseau] = maintenant
    if len(_sondages) > MAX_RESEAUX:
        _sondages.clear()
    return True


def _secondes_sondage_memoire(reseau: str) -> int:
    dernier = _sondages.get(reseau)
    if dernier is None:
        return 0
    reste = SONDAGE_SECONDS - (time.time() - dernier)
    return max(1, int(reste + 0.999)) if reste > 0 else 0


# ── Voie Redis (partagée entre workers) ─────────────────────────────────────
async def _client():
    """Client Redis actif, ou None (pas de `REDIS_URL`, ou Redis injoignable)."""
    from kojo_rate_limit import _get_redis_client

    return await _get_redis_client()


def _cle(reseau: str) -> str:
    return f"kojo:login:reseau:{reseau}"


def _cle_sondage(reseau: str) -> str:
    return f"kojo:login:reseau:sondage:{reseau}"


async def _echecs_redis(client, reseau: str) -> int:
    maintenant = time.time()
    cle = _cle(reseau)
    pipe = client.pipeline()
    pipe.zremrangebyscore(cle, 0, maintenant - _fenetre_seconds())
    pipe.zcard(cle)
    resultats = await pipe.execute()
    return int(resultats[1])


async def _enregistrer_redis(client, reseau: str) -> int:
    maintenant = time.time()
    cle = _cle(reseau)
    # Un membre par échec : l'horodatage sert de score, et un suffixe aléatoire
    # évite qu'une même milliseconde écrase un échec déjà compté (deux
    # tentatives simultanées doivent en compter DEUX).
    membre = f"{maintenant}:{time.monotonic_ns()}"
    pipe = client.pipeline()
    pipe.zremrangebyscore(cle, 0, maintenant - _fenetre_seconds())
    pipe.zadd(cle, {membre: maintenant})
    pipe.zcard(cle)
    pipe.expire(cle, _fenetre_seconds() + 60)
    resultats = await pipe.execute()
    return int(resultats[2])


# ── API du module ───────────────────────────────────────────────────────────
async def echecs(reseau: str) -> int:
    """Échecs de ce réseau dans la fenêtre courante (lecture seule)."""
    client = await _client()
    if client is None:
        return _echecs_memoire(reseau)
    try:
        return await _echecs_redis(client, reseau)
    except Exception as exc:  # une panne de compteur ne refuse jamais une connexion
        _noter_repli(exc)
        return _echecs_memoire(reseau)


async def enregistrer_echec(reseau: str) -> int:
    """Compte un échec pour ce réseau et rend le total de la fenêtre.

    Un succès ne remet PAS le compteur à zéro : un attaquant qui possède un
    identifiant valide ne doit pas pouvoir effacer la trace de ses essais.
    """
    client = await _client()
    try:
        total = (
            await _enregistrer_redis(client, reseau)
            if client is not None
            else _enregistrer_memoire(reseau)
        )
    except Exception as exc:
        _noter_repli(exc)
        total = _enregistrer_memoire(reseau)
    if total == SEUIL_ECHECS:
        # Le franchissement est DIT une fois par fenêtre : c'est le seul
        # moment où l'on peut encore agir (bloquer une campagne en cours).
        logger.warning(
            f"🚨 Connexions : le réseau {reseau} atteint {SEUIL_ECHECS} échecs en "
            f"{FENETRE_MINUTES} min — passage au goutte-à-goutte "
            f"(1 tentative / {SONDAGE_SECONDS} s)"
        )
    return total


async def prendre_sondage(reseau: str) -> bool:
    """Réserve la tentative « sonde » du réseau, ou rend False si elle est prise.

    Atomique des deux côtés : `SET ... NX EX` côté Redis, et aucune attente
    entre la lecture et l'écriture côté mémoire (la boucle d'événements ne peut
    pas intercaler deux requêtes dans une section sans `await`).
    """
    client = await _client()
    if client is None:
        return _prendre_sondage_memoire(reseau)
    try:
        return bool(
            await client.set(_cle_sondage(reseau), str(time.time()), nx=True, ex=SONDAGE_SECONDS)
        )
    except Exception as exc:
        _noter_repli(exc)
        return _prendre_sondage_memoire(reseau)


async def secondes_avant_sondage(reseau: str) -> int:
    """Secondes à attendre avant la prochaine sonde (0 = aucune en cours)."""
    client = await _client()
    if client is None:
        return _secondes_sondage_memoire(reseau)
    try:
        ttl = int(await client.ttl(_cle_sondage(reseau)))
    except Exception as exc:
        _noter_repli(exc)
        return _secondes_sondage_memoire(reseau)
    if ttl < 0:
        return 0
    return max(1, ttl)


def oublier_tout() -> None:
    """Vide l'état mémoire — réservé aux tests et au redémarrage d'un process."""
    _echecs.clear()
    _sondages.clear()
