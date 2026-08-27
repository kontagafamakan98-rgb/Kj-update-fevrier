# -*- coding: utf-8 -*-
"""Validateurs de format des variables d'environnement (stdlib uniquement).

Module léger SANS effets de bord (pas de dotenv, pas de cloudinary, pas de
logging) — contrairement à kojo_settings.py qui exécute cloudinary.config()
et load_dotenv à l'import. Ce module est importable dans des contextes
dépendance-free : le script d'audit Fly (.github/scripts/check-fly-env-drift.py)
et la CI, qui n'installent pas les dépendances backend.

kojo_settings.py ré-exporte ces fonctions (API publique inchangée) — les
tests existants (test_env_url_validation.py, test_vapid_sub_claim.py)
continuent d'importer depuis kojo_settings.
"""


def validate_https_url(url_value, label="URL"):
    """Valide une URL publique : schéma https://, sans espace, sans slash final.

    Appliquée aux variables d'URL d'infrastructure (BACKEND_PUBLIC_URL,
    FRONTEND_APP_URL, GOOGLE_REDIRECT_URI...). Un slash final sur
    BACKEND_PUBLIC_URL casserait la construction des URLs de callback
    (ex. IPN PayDunya) en produisant un double slash ; une valeur
    http:// ou avec espace est toujours une erreur de configuration.

    Retourne l'URL normalisée (sans slash final) si valide, sinon lève
    ValueError avec un message actionnable.
    """
    if not isinstance(url_value, str) or not url_value.strip():
        raise ValueError(f"{label} invalide : vide. Doit être une URL https:// (ex. https://kojo.app).")
    url = url_value.strip()

    if " " in url or "\t" in url:
        raise ValueError(f"{label} invalide : «{url}» contient un espace.")

    if not url.lower().startswith("https://"):
        raise ValueError(
            f"{label} invalide : «{url}» doit commencer par https:// "
            "(http:// et les autres schémas sont interdits en production)."
        )

    host = url[len("https://"):]
    if not host or host.startswith("/") or host.startswith("."):
        raise ValueError(f"{label} invalide : «{url}» — https:// doit être suivi d'un host (ex. https://kojo.app).")

    return url.rstrip("/")


def validate_cors_origins(cors_value):
    """Valide CORS_ORIGINS : liste CSV d'origines https, sans slash final,
    sans localhost, sans espace ni entrée vide.

    CORS_ORIGINS alimente allow_origins (server.py) et build_trusted_hosts
    (kojo_core.py). Une entrée avec slash final ou un espace ne matcherait
    jamais l'en-tête Origin du navigateur (silencieusement), un localhost/
    127.0.0.1 en production élargit inutilement la surface CORS, et une
    entrée vide (double virgule) casse l'analyse CSV.

    Retourne la liste normalisée des origines (chaque entrée sans slash
    final) si valide, sinon lève ValueError avec la ou les entrées fautives.
    """
    if not isinstance(cors_value, str):
        raise ValueError("CORS_ORIGINS invalide : doit être une chaîne CSV d'origines https://.")

    # Variable non définie (vide) : valide — aucune origine d'env, le CORS
    # s'appuie alors sur les défauts du code (WEST_AFRICA_ORIGINS).
    if not cors_value.strip():
        return []

    errors = []
    origins = []
    for raw in cors_value.split(","):
        entry = raw.strip()
        if not entry:
            errors.append("entrée vide (double virgule ou virgule finale)")
            continue
        try:
            origins.append(validate_https_url(entry, "CORS_ORIGINS"))
        except ValueError as exc:
            errors.append(str(exc))
        if "localhost" in entry or "127.0.0.1" in entry:
            errors.append(f"CORS_ORIGINS : «{entry}» — localhost/127.0.0.1 interdit en production")

    if errors:
        raise ValueError(
            "CORS_ORIGINS invalide — " + " ; ".join(sorted(set(errors)))
        )
    return origins


def validate_vapid_sub_claim(sub_claim):
    """Valide le claim `sub` VAPID conformément au RFC 8292.

    Le RFC 8292 (§4.2) exige que `sub` soit un URI de contact de type
    `mailto:` (RFC 6068) OU `https:` (RFC 2818) — jamais autre chose, et
    jamais d'espace. Régression historique : `VAPID_CLAIMS_EMAIL` avait été
    configurée sur Fly avec un espace après le deux-points
    ("mailto: kojoapp98@gmail.com") — le claim `sub` devenait invalide et les
    push providers (Mozilla, Google) rejetaient l'authentification VAPID
    avec un 401/403, sans erreur visible côté backend.

    Règles appliquées :
    - vide / pas une chaîne → invalide ;
    - doit commencer par `mailto:` ou `https://` (insensible à la casse pour
      le schéma) ;
    - AUCUN espace (le schéma est collé à sa valeur : "mailto:contact@..."
      et non "mailto: contact@...") ;
    - pour `mailto:` : adresse non vide avec un `@` après le préfixe ;
    - pour `https:` : au moins un caractère de host après `https://`.

    Retourne l'URI normalisée (chaîne) si valide, sinon lève ValueError
    avec un message actionnable pour la CI et l'ops.
    """
    if not isinstance(sub_claim, str) or not sub_claim.strip():
        raise ValueError(
            "VAPID sub invalide : vide. Le claim `sub` (RFC 8292) doit être un URI "
            "mailto: (ex. mailto:kojoapp98@gmail.com) ou https: (ex. https://kojo.app/contact)."
        )
    sub = sub_claim.strip()

    if " " in sub or "\t" in sub:
        raise ValueError(
            f"VAPID sub invalide : «{sub}» contient un espace. Le RFC 8292 exige un URI "
            "sans espace — notamment PAS d'espace après le deux-points de mailto: "
            "(ex. «mailto:kojoapp98@gmail.com», jamais «mailto: kojoapp98@gmail.com»)."
        )

    lowered = sub.lower()
    if lowered.startswith("mailto:"):
        address = sub[len("mailto:"):]
        # Adresse : exactement un @, avec local-part ET domaine non vides.
        parts = address.split("@")
        if len(parts) != 2 or not parts[0] or not parts[1]:
            raise ValueError(
                f"VAPID sub invalide : «{sub}» — mailto: doit contenir une adresse email "
                "valide (ex. mailto:kojoapp98@gmail.com)."
            )
        return sub

    if lowered.startswith("https://"):
        host = sub[len("https://"):]
        if not host:
            raise ValueError(
                f"VAPID sub invalide : «{sub}» — https:// doit être suivi d'un host "
                "(ex. https://kojo.app/contact)."
            )
        return sub

    raise ValueError(
        f"VAPID sub invalide : «{sub}» — le RFC 8292 exige un URI commençant par "
        "mailto: ou https:// (reçu un autre schéma ou une URL http:// non autorisée)."
    )


def validate_trusted_hosts(hosts_value, label="TRUSTED_HOSTS"):
    """Valide TRUSTED_HOSTS : CSV d'hôtes de confiance pour le
    TrustedHostMiddleware (Starlette), consommé par build_trusted_hosts()
    (kojo_core.py) via extract_host_from_url().

    Chaque entrée peut être :
    - un nom d'hôte simple (ex. `kojo-backend.fly.dev`) ;
    - un motif joker `*.domaine` (ex. `*.internal`, `*.flycast.internal` —
      requis pour le trafic interne Fly des health checks) ;
    - une URL complète (le host en est extrait, ex. `https://api.kojo.app`).

    Règles : pas d'espace, pas d'entrée vide (double virgule / virgule
    finale), chaque entrée doit produire un host non vide après extraction.
    Un domaine personnalisé type `api.kojo.app` doit être ajouté ICI (et
    dans CORS_ORIGINS) pour que le middleware ne le rejette pas en 400.

    Retourne la liste normalisée des entrées, sinon lève ValueError.
    """
    if not isinstance(hosts_value, str):
        raise ValueError(f"{label} invalide : doit être une chaîne CSV d'hôtes (ex. '*.internal,api.kojo.app').")

    # Variable non définie (vide) : valide — build_trusted_hosts() fournit
    # les défauts (localhost, *.vercel.app, *.fly.dev, *.internal...).
    if not hosts_value.strip():
        return []

    errors = []
    hosts = []
    for raw in hosts_value.split(","):
        entry = raw.strip()
        if not entry:
            errors.append("entrée vide (double virgule ou virgule finale)")
            continue
        if " " in entry or "\t" in entry:
            errors.append(f"«{entry}» contient un espace")
            continue
        # `*.domaine` : le joker est un motif Starlette valide, pas une URL.
        if entry.startswith("*."):
            host = entry[2:]
            if not host or "/" in host:
                errors.append(f"«{entry}» — joker `*.` doit être suivi d'un domaine (ex. *.internal)")
                continue
            hosts.append(entry)
            continue
        # Hôte simple ou URL complète (extrait le host, sans http:// nu).
        lowered = entry.lower()
        if "://" in entry:
            try:
                hosts.append(validate_https_url(entry, label))
            except ValueError as exc:
                errors.append(str(exc))
            continue
        if lowered.startswith("http://"):
            errors.append(f"«{entry}» — http:// interdit en production (https:// ou host nu)")
            continue
        # Host nu : au moins un caractère, sans chemin ni port mal formé.
        if "/" in entry or "@" in entry:
            errors.append(f"«{entry}» — host nu invalide (chemin ou @ non autorisés)")
            continue
        if "." not in entry:
            errors.append(f"«{entry}» — host sans point douteux (hôte court, ex. localhost, ignoré)")
            continue
        hosts.append(entry)

    if errors:
        raise ValueError(f"{label} invalide — " + " ; ".join(sorted(set(errors))))
    return hosts


def validate_redis_url(redis_value, label="REDIS_URL"):
    """Valide REDIS_URL : URI redis:// ou rediss:// (TLS) pour le rate-limiter
    partagé (kojo_core._try_init_redis → redis.asyncio.from_url).

    REDIS_URL est OPTIONNELLE : vide → rate-limiting en mémoire par process
    (limites × N workers, non partagées — warning au boot en prod, pas un
    blocage). Si définie, elle doit être une URI redis:// ou rediss:// sans
    espace, avec un hôte (et éventuellement un port, mot de passe, base).

    Retourne l'URI normalisée (strippée) si valide, sinon lève ValueError.
    """
    if not isinstance(redis_value, str):
        raise ValueError(f"{label} invalide : doit être une URI redis:// ou rediss://.")
    value = redis_value.strip()
    if not value:
        return ""
    if " " in value or "\t" in value:
        raise ValueError(f"{label} invalide : «{value}» contient un espace.")
    lowered = value.lower()
    if not (lowered.startswith("redis://") or lowered.startswith("rediss://")):
        raise ValueError(
            f"{label} invalide : «{value}» doit commencer par redis:// ou rediss:// "
            "(TLS). Ex. redis://default:<password>@<host>:6379/0."
        )
    rest = value.split("://", 1)[1]
    if not rest or "@" in rest and not rest.split("@", 1)[1]:
        raise ValueError(f"{label} invalide : «{value}» — hôte manquant après le schéma.")
    host = rest.split("@", 1)[-1]
    if not host:
        raise ValueError(f"{label} invalide : «{value}» — hôte manquant.")
    return value


def validate_mongo_url(mongo_value, label="MONGO_URL"):
    """Valide MONGO_URL : URI mongodb:// ou mongodb+srv:// (Atlas) pour
    AsyncIOMotorClient (kojo_core.py). MONGO_URL est OBLIGATOIRE — sans elle
    le backend lève ValueError au boot ; une URL mal formée échoue à la
    connexion (cf. SWITCHOVER_CHECKLIST.md : mongodb+srv:// → Atlas).

    Règles : non vide, schéma mongodb:// ou mongodb+srv://, sans espace,
    avec un hôte non vide. Retourne l'URI normalisée, sinon lève ValueError.
    """
    if not isinstance(mongo_value, str) or not mongo_value.strip():
        raise ValueError(
            f"{label} invalide : vide. Obligatoire — URI mongodb:// ou mongodb+srv:// "
            "(ex. mongodb+srv://cluster.mongodb.net/kojo_db)."
        )
    value = mongo_value.strip()
    if " " in value or "\t" in value:
        raise ValueError(f"{label} invalide : «{value}» contient un espace.")
    lowered = value.lower()
    if not (lowered.startswith("mongodb://") or lowered.startswith("mongodb+srv://")):
        raise ValueError(
            f"{label} invalide : «{value}» doit commencer par mongodb:// ou "
            "mongodb+srv:// (Atlas)."
        )
    rest = value.split("://", 1)[1]
    host = rest.split("@", 1)[-1] if "@" in rest else rest
    # Host = jusqu'au premier / (base) ou : (port). Doit être non vide.
    host = host.split("/", 1)[0].split("?", 1)[0]
    if not host:
        raise ValueError(f"{label} invalide : «{value}» — hôte manquant après le schéma.")
    return value
