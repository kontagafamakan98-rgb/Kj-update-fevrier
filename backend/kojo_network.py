# -*- coding: utf-8 -*-
"""Reseau : IP du client, hotes de confiance et origines CORS autorisees.

Ces fonctions decident ce que le serveur considere comme SA provenance
(en-tetes de proxy, domaine public, origines du navigateur). Une erreur ici se
paie en securite : elle doit se lire sans traverser 1 500 lignes.

Extrait de `kojo_core`, qui n'en garde que la facade : le nom continue d'y
etre servi (`from kojo_core import X`) pour ses importeurs. La surface
publique de la facade est figee par `tests/test_core_surface.py`.
"""
from fastapi import Request
from kojo_settings import BACKEND_PUBLIC_URL, FRONTEND_APP_URL
from typing import Dict, List, Optional
from urllib.parse import urlparse
import os

def get_client_ip(request: Request) -> str:
    """IP du client pour le rate-limiting.

    SECURITE : on prend la DERNIÈRE entrée de X-Forwarded-For, pas la
    première. Ce header est contrôlable par le client : derrière un proxy
    de confiance (Render/Fly), la vraie IP est APPENDÉE à la fin de la
    chaîne, donc la première entrée peut être falsifiée à volonté
    (X-Forwarded-For: 1.2.3.4) — ce qui permettait de contourner le
    rate-limiting en changeant d'IP à chaque requête. La dernière entrée
    est celle ajoutée par le proxy et n'est pas modifiable par le client
    (le proxy écrase/ajoute). Sans header, on retombe sur l'IP de la
    connexion directe (dev local, pas de proxy).
    """
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[-1].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
def extract_host_from_url(raw_url: str) -> Optional[str]:
    """Extrait le hostname d'une URL, en tolérant l'absence de schéma.

    Retourne le hostname (ex: 'api.kojoforafrica.cc.cd') ou None si l'entrée est
    vide/blank ou que l'URL est invalide (urlparse ne trouve pas de hostname) —
    les appelants (build_trusted_hosts) doivent ignorer silencieusement None.
    """
    if not raw_url:
        return None
    candidate = raw_url.strip()
    if not candidate:
        return None
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    return parsed.hostname
def build_trusted_hosts() -> List[str]:
    hosts = {
        "localhost",
        "127.0.0.1",
        "*.vercel.app",
        "*.onrender.com",
        "onrender.com",
        # Fly.io : le Host des health checks (et du trafic interne) est un
        # nom DNS interne *.internal ; le trafic public arrive via le proxy
        # Fly sur *.fly.dev / *.flycast.internal. Ces motifs rendent le
        # TrustedHostMiddleware sûr à activer sur Fly SANS dépendre de la
        # variable TRUSTED_HOSTS (défaut robuste, surchargable via l'env).
        "*.internal",
        "*.flycast.internal",
        "*.fly.dev",
    }

    render_external_host = os.environ.get('RENDER_EXTERNAL_HOSTNAME', '').strip()
    raw_candidates = [FRONTEND_APP_URL, BACKEND_PUBLIC_URL, render_external_host]
    raw_candidates.extend(origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip())
    raw_candidates.extend(host.strip() for host in os.environ.get('TRUSTED_HOSTS', '').split(',') if host.strip())

    for candidate in raw_candidates:
        host = extract_host_from_url(candidate)
        if host:
            hosts.add(host)

    return sorted(hosts)
# Origines de DÉVELOPPEMENT (vite/`npm start` sur la machine du développeur).
# Elles restent dans `allow_origins` quel que soit l'environnement — c'est le
# comportement historique, et un navigateur distant ne peut pas usurper une
# origine `localhost`.
WEST_AFRICA_ORIGINS = [
    "http://localhost:3000",
    "https://localhost:3000",
    "http://127.0.0.1:3000",
]
def normalize_origin(value: str) -> Optional[str]:
    """Origine CORS normalisée (`https://host`), ou None si inutilisable.

    Un slash final ne matche JAMAIS l'en-tête `Origin` d'un navigateur :
    `CORS_ORIGINS=https://kojo.example/` configurait donc une origine qui ne
    correspondait à rien, sans aucun signal. On le supprime plutôt que de
    laisser une panne silencieuse. Une valeur sans schéma est lue en `https`.
    """
    candidate = (value or "").strip().rstrip("/")
    if not candidate:
        return None
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    scheme, _, rest = candidate.partition("://")
    if scheme not in {"http", "https"} or not rest or "/" in rest:
        return None
    return candidate
def build_allowed_origins(frontend_url: Optional[str] = None, cors_value: Optional[str] = None,
                          env: Optional[Dict[str, str]] = None) -> List[str]:
    """Origines EXACTES autorisées par le middleware CORS.

    `FRONTEND_APP_URL` en fait partie. Elle ne l'était pas : la liste valait
    `WEST_AFRICA_ORIGINS + CORS_ORIGINS`, donc l'adresse canonique du frontend
    n'était prise en compte que si quelqu'un l'avait recopiée dans
    `CORS_ORIGINS`. Tant que le frontend vivait sous `*.vercel.app`, le motif
    Vercel (`allow_origin_regex`) le couvrait — le trou restait invisible.
    Le 18/09/2026 le frontend est passé sur `https://kojoforafrica.cc.cd` :
    plus de motif qui matche, plus d'origine exacte déclarée, et tous les
    appels portant un en-tête personnalisé (statistiques, géolocalisation) ont
    été bloqués par le préflight — `400` « Disallowed CORS origin », sans
    aucune erreur serveur.

    Args:
        frontend_url: surcharge de `FRONTEND_APP_URL` (tests).
        cors_value: surcharge de `CORS_ORIGINS` (tests).
        env: environnement à lire au lieu de `os.environ` (tests).

    Returns:
        Liste ordonnée sans doublon ; les entrées inutilisables sont ignorées.
    """
    env = os.environ if env is None else env
    frontend = FRONTEND_APP_URL if frontend_url is None else frontend_url
    cors_raw = env.get("CORS_ORIGINS", "") if cors_value is None else cors_value

    candidates = list(WEST_AFRICA_ORIGINS) + [frontend] + str(cors_raw or "").split(",")
    origins: List[str] = []
    for candidate in candidates:
        origin = normalize_origin(candidate)
        if origin and origin not in origins:
            origins.append(origin)
    return origins
