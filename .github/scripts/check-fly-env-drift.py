#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check doc↔prod Fly : les variables d'environnement publiées doivent
rester synchronisées avec les références du dépôt.

Les SECRETS Fly ne sont jamais lisibles (digests opaques). Ce check compare
donc ce qui l'est réellement :

  1. [env] de backend/fly.toml  vs  l'environnement réel servi par la machine
     (config.env via l'API Machines) — détecte le DRIFT : un changement de
     fly.toml committé mais jamais redéployé, ou une valeur déployée qui
     diverge de ce qui est documenté.
  2. Présence : chaque secret OBLIGATOIRE (bloc `fly secrets set` de
     DEPLOY_FLYIO.md, sans défaut de repli dans le code) doit avoir un digest
     dans `fly secrets set` — détecte un secret manquant (config incomplète
     avant un déploiement).
  3. DOUBLONS [env]↔secret : une clé présente à la fois dans fly.toml [env]
     ET comme secret est un piège — sur Fly, le secret ÉCRASE [env] au même
     nom, donc modifier fly.toml n'a plus d'effet (drift silencieux).
     Historique : BACKEND_PUBLIC_URL et VERCEL_PROJECT_NAME étaient dupliqués
     (secrets unset le 27/08/2026, fly.toml [env] = source unique).
  4. ORPHELINS : un secret déployé mais référencé nulle part dans le dépôt
     (ni .env.example, ni DEPLOY_FLYIO.md, ni kojo_settings.py) est un secret
     mort ou une config non documentée — retirer ou documenter.
  5. Couverture .env.example : chaque clé du template doit exister sur Fly
     ([env] OU secret), sauf si elle est OPTIONNELLE (défaut de repli dans le
     code, legacy GMAIL, alias) — détecte un secret ajouté au template mais
     jamais posé sur Fly.
  6. (Option) Snapshot commité des digests de secrets NON sensibles : un
     changement de digest d'une valeur censée être stable déclenche une
     alerte (rotation non documentée). Les clés réellement secrètes
     (tokens, clés privées) sont exclues — leur rotation est voulue.
  7. FORMAT des valeurs DÉPLOYÉES : les variables publiques [env] (via
     l'API Machines, lisibles) et les SECRETS (via SSH `flyctl ssh console`
     → printenv, valeurs JAMAIS affichées — masquées dans la sortie) sont
     validées par les validateurs de kojo_env_validators.py (URLs https,
     CORS, VAPID, TRUSTED_HOSTS, REDIS_URL, MONGO_URL). Détecte une valeur
     déployée mal formée (ex. un slash final sur BACKEND_PUBLIC_URL, un
     espace après mailto:, une URI redis:// manquante).

Usage :
    FLY_API_TOKEN=<deploy_token> python .github/scripts/check-fly-env-drift.py
Optionnel :
    FLY_APP=kojo-backend
    KOJO_ROOT=<racine du repo>           (défaut : ../.. par rapport au script)
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

# Validateurs de format — module stdlib-only (kojo_env_validators.py), PAS
# kojo_settings.py (qui exécute cloudinary.config()/load_dotenv à l'import
# et exigerait les dépendances backend). Le script tourne en CI sans deps.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))
try:
    from kojo_env_validators import (
        validate_cors_origins,
        validate_https_url,
        validate_mongo_url,
        validate_redis_url,
        validate_trusted_hosts,
        validate_vapid_sub_claim,
    )
    _VALIDATORS_OK = True
except Exception as exc:  # noqa: BLE001 - module absent = pas de contrôle format
    _VALIDATORS_OK = False
    _VALIDATORS_ERR = str(exc)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("KOJO_ROOT", SCRIPT_DIR.parent.parent)).resolve()
FLY_TOML = REPO_ROOT / "backend" / "fly.toml"
SETTINGS = REPO_ROOT / "backend" / "kojo_settings.py"

FLY_APP = os.environ.get("FLY_APP", "kojo-backend").strip()
API_TOKEN = os.environ.get("FLY_API_TOKEN", "").strip()

# Variables injectées par Fly dans config.env (pas des variables du projet) :
# on les ignore lors de la comparaison doc↔prod.
FLY_INJECTED = {
    "FLY_APP_NAME", "FLY_ALLOC_ID", "FLY_IMAGE_REF", "FLY_MACHINE_ID",
    "FLY_REGION", "FLY_PROCESS_GROUP", "PRIMARY_REGION", "FLY_APP",
    "FLY_MACHINE_VERSION", "FLYER_APP_NAME",
}

# Clés SECRÈTES sensibles : leur digest change à la rotation voulue, on ne
# les inclut PAS dans le snapshot de stabilité (sinon fausses alertes).
SENSITIVE_KEYS = {
    "JWT_SECRET", "EMAIL_OTP_SECRET", "MONGO_URL", "OWNER_INITIAL_PASSWORD",
    "PAYDUNYA_MASTER_KEY", "PAYDUNYA_PRIVATE_KEY", "PAYDUNYA_TOKEN",
    "BREVO_API_KEY", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET",
    "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN",
    "CLOUDINARY_API_SECRET", "VAPID_PRIVATE_KEY", "REDIS_URL",
    "GOOGLE_CLIENT_SECRET", "SENTRY_DSN",
    # Jeton du gateway IA (Neon) : porteur d'accès aux modèles, donc une clé
    # à rotater sans alerte de stabilité.
    "NEON_AI_GATEWAY_TOKEN",
}

# Clés OPTIONNELLES : leur absence sur Fly n'est PAS une divergence — soit le
# code fournit un défaut de repli (BREVO_SENDER_NAME='KOJO', REFERRAL_*,
# EMAIL_OTP_*), soit la fonctionnalité est désactivée sans elles (SENTRY_DSN,
# GMAIL_* legacy déprécié au profit de Brevo, REDIS_URL → mémoire, CORS_ORIGINS
# → défauts du code), soit ce sont des alias (FAMAKAN_OWNER_EMAIL,
# PASSWORD_RESET_FROM_EMAIL, BREVO_REPLY_TO_EMAIL — optionnelle avec un défaut
# non vide dans le code, donc posable sans être exigée).
OPTIONAL_KEYS = {
    "SENTRY_DSN", "PAYMENT_COMMISSION_RATE", "CORS_ORIGINS", "REDIS_URL",
    "BREVO_SENDER_NAME", "BREVO_REPLY_TO_EMAIL",
    "EMAIL_OTP_EXPIRY_MINUTES", "EMAIL_OTP_MAX_ATTEMPTS",
    "EMAIL_OTP_RESEND_COOLDOWN_SECONDS", "EMAIL_VERIFICATION_TOKEN_MINUTES",
    "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN",
    "GMAIL_SENDER_EMAIL", "GMAIL_SENDER_NAME",
    # Resend : fournisseur ALTERNATIF — sans ces variables le backend démarre
    # et envoie par EMAIL_PROVIDER (brevo par défaut, 'none' pour les tests),
    # donc leur absence sur Fly n'est pas une divergence doc↔prod.
    "RESEND_API_KEY", "RESEND_SENDER_EMAIL", "RESEND_SENDER_NAME",
    "RESEND_REPLY_TO_EMAIL",
    # Webhook Resend (rebonds, plaintes) : sans `RESEND_WEBHOOK_SECRET`
    # l'ingestion est DÉSACTIVÉE (la route refuse au lieu de juger un appelant
    # qu'elle ne peut pas authentifier) et le backend démarre ; les deux seuils
    # ont un défaut de repli dans kojo_settings (300 s, 3 rebonds). Leur absence
    # sur Fly n'est donc pas une divergence doc↔prod — mais leur PRÉSENCE est ce
    # qui rend la suppression d'adresses effective.
    "RESEND_WEBHOOK_SECRET", "EMAIL_WEBHOOK_TOLERANCE_SECONDS",
    "EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD",
    "FAMAKAN_OWNER_EMAIL", "PASSWORD_RESET_FROM_EMAIL",
    "REFERRAL_FILLEUL_REWARD", "REFERRAL_SPONSOR_REWARD",
    "REFERRAL_WELCOME_FILLEUL_REWARD", "REFERRAL_WELCOME_SPONSOR_REWARD",
    # Assistant IA de /support : sans ces variables la fonctionnalité est
    # DÉSACTIVÉE (is_configured() est faux, la route répond 503 et la page
    # retombe sur le questionnaire) — le backend démarre sans elles, donc leur
    # absence sur Fly n'est pas une divergence.
    "NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN",
    "NEON_AI_GATEWAY_MODEL", "NEON_AI_GATEWAY_TIMEOUT_SECONDS",
}

# Keys connues mais NON sensibles (valeur vérifiable côté doc). Leur digest
# doit rester STABLE entre déploiements — un changement alerte (rotation).
# Ce snapshot est mis à jour manuellement/dans ce fichier.
NON_SENSITIVE_SNAPSHOT = {
    # rempli lors de la génération du snapshot initial
}

errors = []
checked = []

# Sortie robuste (Windows cp1252) : forcer l'UTF-8 et éviter les glyphes
# non-ASCII qui cassent la console locale. En CI (Linux, utf-8) sans effet.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001 - reconfigure indisponible sur certains repls
    pass


OK = "[OK]"
BAD = "[ERR]"


def fetch_json(url, token):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_fly_toml_env(text):
    """Extrait la table [env] de fly.toml → dict {NOM: valeur_simple}."""
    m = re.search(r"^\[env\]\s*\n(.*?)(?=^\[|\Z)", text, re.M | re.S)
    if not m:
        return {}
    section = m.group(1)
    env = {}
    for line in section.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'\"").strip()
        env[key] = value
    return env


DEPLOY_DOC = REPO_ROOT / "backend" / "DEPLOY_FLYIO.md"
ENV_EXAMPLE = REPO_ROOT / "backend" / ".env.example"


def parse_env_example(text):
    """Extrait les clés=valuers de .env.example → dict {NOM: valeur}.

    Ignore les commentaires (#) et les lignes vides. Les valeurs peuvent
    être vides (template de dev) — seule la PRÉSENCE de la clé compte pour
    la couverture.
    """
    env = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key.isupper():
            continue
        env[key] = value.strip()
    return env


def has_nonempty_default(key):
    """Un secret documenté dans DEPLOY_FLYIO.md n'est RÉELLEMENT obligatoire que
    si le code ne lui fournit pas de valeur par défaut non vide. Ex. :
    BREVO_SENDER_NAME a `os.environ.get('BREVO_SENDER_NAME', 'KOJO')` → optionnel
    (le backend démarre et retombe sur 'KOJO'). À l'inverse MONGO_URL a un
    défaut vide → obligatoire.

    Retourne True si le code définit un défaut non vide pour `key`.
    """
    if not SETTINGS.exists():
        return False
    text = SETTINGS.read_text(encoding="utf-8")
    # Capture le 2e argument de os.environ.get('KEY', '<defaut>').
    pat = re.compile(r"os\.environ\.get\(['\"]" + re.escape(key) + r"['\"],\s*([^)]*)\)")
    m = pat.search(text)
    if not m:
        return False
    default = m.group(1).strip().strip("'\"").strip()
    # Défauts "code" (identifiants, chiffres, expressions) ignorés : un défaut
    # littéral non vide ET non-"code" indique une valeur de repli réelle.
    if not default:
        return False
    if default == key:
        return False
    # Défauts purement numériques / identifiants symboliques (ex. 'KOJO') :
    # un nom de marque/seuil n'est PAS un secret requis.
    if default.isdigit():
        return False
    return True


def required_secrets_from_deploy_doc():
    """Extrait la liste des secrets ACCESSENTIELS depuis le bloc
    `fly secrets set` de backend/DEPLOY_FLYIO.md (source de vérité : chaque
    secret documenté comme obligatoire avant le 1er déploiement).

    Un secret listé dans la doc mais pourvu d'un défaut non vide dans
    le code (ex. BREVO_SENDER_NAME='KOJO') est OPTIONNEL : sa présence n'est
    pas exigée (le backend retombe sur la valeur par défaut). Seuls les
    secrets sans défaut de repli sont réellement requis.

    Retourne un set des NOMS de secrets attendus. Fallback sur
    kojo_settings.py (os.environ.get) si la doc est introuvable.
    """
    if DEPLOY_DOC.exists():
        text = DEPLOY_DOC.read_text(encoding="utf-8")
        # Bloc ```bash  fly secrets set \ ...  ``` → les lignes "KEY=value".
        block = re.search(
            r"fly secrets set\s*\\?[\s\S]*?```", text, re.I
        )
        if block:
            keys = set()
            for name in re.findall(r"([A-Z0-9_]+)\s*=", block.group(0)):
                keys.add(name)
            # On retire celles déjà déclarées dans fly.toml [env] (publiques)
            # et les secrets OPTIONNELS (défaut non vide dans le code).
            fly_toml_env = parse_fly_toml_env(
                FLY_TOML.read_text(encoding="utf-8")
            ) if FLY_TOML.exists() else {}
            keys -= set(fly_toml_env.keys())
            keys = {k for k in keys if not has_nonempty_default(k)}
            if keys:
                return keys
    # Repli : variables lues par le code (forward-compatible si la doc manque).
    # La lecture des NOMS appartient à `_settings_referenced_keys()` (mise en
    # cache, même extraction) : recopier ses deux expressions ici donnerait deux
    # lectures du même fichier à tenir synchronisées, donc deux façons de nommer
    # les clés que le code lit — et un orphelin détecté d'un côté, pas de
    # l'autre. Seul le FILTRE (défaut de repli) distingue ce repli.
    return {k for k in _settings_referenced_keys() if not has_nonempty_default(k)}


def list_fly_secrets(token):
    """Récupère la liste des secrets déployés (digests) via l'API GraphQL/Fly."""
    # L'API REST des secrets n'est pas publique ; on utilise la GraphQL de flyctl.
    # En CI, on appelle le binaire flyctl si disponible.
    import subprocess
    try:
        out = subprocess.run(
            ["flyctl", "secrets", "list", "-a", FLY_APP, "--json"],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, "FLY_API_TOKEN": token},
        ).stdout
        data = json.loads(out)
        result = {}
        for item in data:
            # flyctl renvoie {name,digest,status} en minuscules.
            name = item.get("name") or item.get("Name")
            digest = item.get("digest") or item.get("Digest") or ""
            if name:
                result[name] = digest
        return result
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Impossible de lister les secrets Fly ({FLY_APP}) : {exc}")


def check_public_env(fly_toml_text, live_env):
    expected = parse_fly_toml_env(fly_toml_text)
    injected = set(FLY_INJECTED)
    for key, expected_val in sorted(expected.items()):
        if key in injected:
            checked.append(f"  {OK} {key} (var Fly injecte, ignoree)")
            continue
        live_val = live_env.get(key)
        if live_val is None:
            errors.append(f"[fly.toml {key}] ABSENT du runtime Fly (config pas déployée ?)")
        elif live_val != expected_val:
            errors.append(
                f"[fly.toml {key}] DRIFT : commité={expected_val!r} déployé={live_val!r}"
            )
        else:
            checked.append(f"  {OK} {key} = {expected_val!r}")


def check_secret_presence(required, fly_secrets):
    """Chaque secret OBLIGATOIRE (doc de déploiement) doit avoir un digest sur
    Fly — un secret manquant casserait le backend au prochain boot (ex.
    JWT_SECRET, MONGO_URL, réutilisés dès le démarrage).

    Le snapshot NON-SENSIBLE (stabilité) est vérifié séparément : un digest
    qui change sans mise à jour du snapshot = rotation non documentée.
    """
    for key in sorted(required):
        # Un secret MANQUANT est fatal au boot, même s'il est "sensible"
        # (JWT_SECRET, MONGO_URL...) — SENSITIVE_KEYS ne concerne QUE la
        # stabilité du digest (rotation voulue), jamais la présence.
        if key not in fly_secrets and key not in _fly_toml_env_once():
            errors.append(
                f"[secret {key}] MANQUANT sur Fly — requis par DEPLOY_FLYIO.md, "
                f"le backend ne peut pas démarrer correctement sans lui"
            )
        elif key in fly_secrets:
            checked.append(f"  {OK} {key} present (secret requis)")
    # Un digest snapshot référencé mais absent de Fly → secret supprimé.
    for key in sorted(NON_SENSITIVE_SNAPSHOT):
        if key not in fly_secrets:
            errors.append(
                f"[snapshot {key}] absent du secrets Fly — secret supprimé ?"
            )


def check_duplicates(fly_toml_env, fly_secrets):
    """Une clé présente à la fois dans fly.toml [env] ET comme secret Fly est
    un piège : sur Fly, le secret ÉCRASE [env] au même nom. Modifier fly.toml
    n'a alors plus AUCUN effet sur le runtime (drift silencieux — le secret
    masque la valeur commitée).

    Historique : BACKEND_PUBLIC_URL et VERCEL_PROJECT_NAME étaient dupliqués ;
    les secrets ont été unset le 27/08/2026, fly.toml [env] étant la source
    unique. Ce check empêche la régression.
    """
    for key in sorted(set(fly_toml_env) & set(fly_secrets)):
        errors.append(
            f"[DOUBLON {key}] présent dans fly.toml [env] ET comme secret — "
            f"sur Fly le secret écrase [env] : modifier fly.toml n'a plus "
            f"d'effet (drift silencieux). Unset le secret "
            f"(fly secrets unset {key}) ou retire-le de [env]."
        )


def check_orphan_secrets(fly_secrets, known_keys):
    """Un secret déployé mais référencé NUL PART dans le dépôt est soit un
    secret mort (à retirer), soit une config non documentée (à ajouter aux
    références) — les deux sont des écarts doc↔prod.

    `known_keys` : union des clés de .env.example + DEPLOY_FLYIO.md +
    kojo_settings.py (os.environ.get).
    """
    for key in sorted(set(fly_secrets) - known_keys):
        errors.append(
            f"[ORPHELIN {key}] secret déployé sur Fly mais référencé nulle part "
            f"dans le dépôt (ni .env.example, ni DEPLOY_FLYIO.md, ni "
            f"kojo_settings.py) — le retirer ou le documenter."
        )


def check_env_example_coverage(example_keys, fly_toml_env, fly_secrets):
    """Chaque clé du template .env.example doit exister sur Fly ([env] OU
    secret) — sauf si elle est OPTIONNELLE (défaut de repli dans le code,
    legacy GMAIL, alias). Détecte un secret ajouté au template mais jamais
    posé sur Fly (config incomplète avant un déploiement).
    """
    for key in sorted(example_keys - set(OPTIONAL_KEYS)):
        if key in fly_toml_env or key in fly_secrets:
            checked.append(f"  {OK} {key} couvert ({'[env]' if key in fly_toml_env else 'secret'})")
        else:
            errors.append(
                f"[.env.example {key}] référencé dans le template mais NI [env] "
                f"NI secret sur Fly — le poser (fly secrets set) ou l'ajouter "
                f"à OPTIONAL_KEYS si un défaut de repli existe dans le code."
            )


def _mask(value):
    """Masque une valeur secrète : ne garde que le préfixe du schéma et la
    longueur (ex. 'redis://... [55 car.]'). JAMAIS la valeur complète dans la
    sortie — le script audit peut tourner dans des logs CI publics."""
    if not value:
        return "(vide)"
    prefix = value.split("://", 1)[0] + "://" if "://" in value else ""
    return f"{prefix}[{len(value)} car.]"


def _sanitize_error(msg, value):
    """Les messages d'erreur des validateurs embarquent la valeur fautive
    (ex. «mailto: kojoapp98@gmail.com»). Pour un SECRET, on remplace toute
    occurrence de la valeur par son masque avant de l'afficher — un log CI
    est public."""
    if not value:
        return msg
    return msg.replace(value, _mask(value))


# Format attendu par clé déployée → (validateur, description, accepte_label,
# renvoie_la_valeur). has_label=False pour les validateurs à signature 1
# paramètre (validate_cors_origins, validate_vapid_sub_claim).
# returns_value=True : le validateur renvoie la valeur normalisée (chaîne) —
# si elle diffère de l'entrée, la valeur déployée est NON canonique (le
# runtime ne normalise pas). returns_value=False : validateur qui renvoie une
# liste (cors_origins, trusted_hosts) — seule la levée d'erreur compte.
PUBLIC_FORMAT_CHECKS = {
    "BACKEND_PUBLIC_URL": (validate_https_url, "URL https publique", True, True),
    "FRONTEND_APP_URL": (validate_https_url, "URL https publique", True, True),
    "TRUSTED_HOSTS": (validate_trusted_hosts, "CSV d'hôtes de confiance", True, False),
}

SECRET_FORMAT_CHECKS = {
    "CORS_ORIGINS": (validate_cors_origins, "CSV d'origines https", False, False),
    "REDIS_URL": (validate_redis_url, "URI redis:// ou rediss://", True, True),
    "MONGO_URL": (validate_mongo_url, "URI mongodb:// ou mongodb+srv://", True, True),
    "VAPID_CLAIMS_EMAIL": (validate_vapid_sub_claim, "URI mailto:/https: (RFC 8292)", False, True),
}


def _controler_format(key, value, spec, prefixe, contexte, avant=(), apres=()):
    """Le contrôle de format d'UNE valeur — écrit UNE fois, pour ses trois
    appelants : les variables publiques DÉPLOYÉES, les secrets DÉPLOYÉS (valeurs
    masquées) et les RÉFÉRENCES du dépôt.

    Ce qui est partagé, c'est la RÈGLE et sa sortie : l'appel au validateur, le
    masquage d'une valeur fautive AVANT qu'elle n'atteigne un log de CI public,
    le verdict sur une valeur non normalisée, la ligne conforme. Ce que chaque
    appelant garde, ce sont ses mentions : `avant`/`apres` encadrent la
    description du format attendu dans le verdict conforme (la source pour une
    référence, le masque pour un secret) et `contexte` NOMME la valeur dans une
    divergence.

    Le corps était recopié trois fois (deux boucles déployées, un `_check` de
    références) : un enrichissement ajouté à une seule copie — `_sanitize_error`,
    la phrase « le runtime ne normalise pas » — laissait les deux autres
    fuiter une valeur dans un log public, ou taire une normalisation.

    `spec` : (validateur, description, accepte_label, renvoie_la_valeur), la
    forme des tables ci-dessus ; `renvoie_la_valeur` = le validateur NORMALISE
    la valeur (slash final, espaces externes), donc une valeur rendue différente
    de l'entrée est non canonique — et le runtime, qui ne normalise pas,
    l'emploierait telle quelle (callbacks IPN cassés silencieusement).

    Retourne True quand la valeur est conforme, False quand elle ne l'est pas.
    """
    validator, desc, has_label, returns_value = spec
    try:
        result = validator(value, key) if has_label else validator(value)
    except (ValueError, TypeError) as exc:
        errors.append(f"[{prefixe} {key}] {_sanitize_error(str(exc), value)} — {contexte}")
        return False
    if returns_value and result != value:
        errors.append(
            f"[{prefixe} {key}] NON normalisée : {_mask(value)} → attendu "
            f"{_mask(result)} — {contexte}"
        )
        return False
    checked.append(f"  {OK} {key} {prefixe} OK ({', '.join([*avant, desc, *apres])})")
    return True


def check_deployed_formats(public_env, secret_values):
    """Valide le FORMAT des valeurs DÉPLOYÉES : les variables publiques [env]
    (lues via l'API) et les secrets (lus via SSH, valeurs masquées).

    `secret_values` : dict {NOM: valeur} lu via printenv — les valeurs sont
    transmises au validateur mais JAMAIS affichées (seul le verdict + un
    masque sortent).

    Détecte une valeur déployée mal formée — le pire cas d'erreur de
    config : le code démarre, mais CORS/URLs/VAPID sont cassés silencieusement
    (ex. slash final sur BACKEND_PUBLIC_URL, espace après mailto:).

    Une clé [env] ABSENTE du runtime passe quand même par le validateur (vide) :
    c'est `check_public_env` qui dit « absente du runtime », et ce contrôle-ci ne
    s'y substitue pas.
    """
    for key, spec in sorted(PUBLIC_FORMAT_CHECKS.items()):
        value = public_env.get(key, "")
        _controler_format(key, value, spec, "format", f"valeur déployée={_mask(value)}")

    for key, spec in sorted(SECRET_FORMAT_CHECKS.items()):
        if key not in secret_values:
            continue
        value = secret_values[key]
        _controler_format(
            key, value, spec, "format", f"valeur déployée={_mask(value)}",
            apres=[_mask(value)],
        )


# Clés CRITIQUES dont le format est contrôlé dans les RÉFÉRENCES du dépôt
# (déterministe, sans accès Fly) — même mapping que le check déployé.
REFERENCE_FORMAT_CHECKS = {
    **PUBLIC_FORMAT_CHECKS,
    **SECRET_FORMAT_CHECKS,
}


def check_reference_formats():
    """Valide le FORMAT des variables critiques dans les RÉFÉRENCES du dépôt :
    backend/.env.example, backend/DEPLOY_FLYIO.md et backend/fly.toml [env].

    Déterministe et exécutable SANS accès Fly (pas de token, pas de réseau) :
    c'est le garde-fou de base que la CI peut lancer à chaque push pour
    détecter une régression de format dans les fichiers de référence — un
    CORS_ORIGINS avec slash final, une VAPID_CLAIMS_EMAIL avec espace après
    mailto:, une URL http:// dans fly.toml…

    Règles par source :
    - fly.toml [env]  : TOUTES les valeurs présentes sont validées (c'est la
      config de prod commitée) ;
    - .env.example    : les valeurs VIDE sont ignorées (template de dev, la
      plupart des secrets sont laissés vides) ; les valeurs non vides sont
      validées (ex. VAPID_CLAIMS_EMAIL=mailto:kojoapp98@gmail.com) ;
    - DEPLOY_FLYIO.md : les valeurs du bloc `fly secrets set` (doc à copier
      sur Fly) — extraites par regex, seules les valeurs non vides et non
      placeholder (« ... ») sont validées.

    Détecte une référence du dépôt devenue invalide — le même bug qui, une
    fois copié sur Fly, casserait silencieusement CORS/VAPID/callbacks.
    """
    def _check(key, value, source):
        if key not in REFERENCE_FORMAT_CHECKS:
            return
        if not value:
            return  # vide = template dev / clé absente : rien à valider
        # La source PRÉCÈDE la description dans le verdict : c'est elle qui dit
        # d'où vient la valeur auditée (fly.toml [env], .env.example, doc).
        _controler_format(
            key, value, REFERENCE_FORMAT_CHECKS[key], "référence",
            f"source={source}", avant=[source],
        )

    # 1) fly.toml [env] — config de prod commitée
    if FLY_TOML.exists():
        fly_env = parse_fly_toml_env(FLY_TOML.read_text(encoding="utf-8"))
        for key, value in sorted(fly_env.items()):
            _check(key, value, "fly.toml [env]")

    # 2) .env.example — template DEV : les valeurs vides sont ignorées, et les
    #    valeurs de développement (http://localhost, mongodb://localhost) sont
    #    des PLACEHOLDERS de dev (ex. FRONTEND_APP_URL=http://localhost:3000,
    #    MONGO_URL=mongodb://localhost:27017) — seules les valeurs de type
    #    production (https://, redis://, mongodb+srv://, mailto:…) sont
    #    validées, comme dans test_env_url_validation.py::TestReferencesProd.
    if ENV_EXAMPLE.exists():
        example = parse_env_example(ENV_EXAMPLE.read_text(encoding="utf-8"))
        for key, value in sorted(example.items()):
            if key in ("FRONTEND_APP_URL", "BACKEND_PUBLIC_URL") and value.startswith("http://"):
                continue  # placeholder dev (localhost)
            _check(key, value, ".env.example")

    # 3) DEPLOY_FLYIO.md — bloc `fly secrets set` (doc à copier sur Fly)
    if DEPLOY_DOC.exists():
        doc_text = DEPLOY_DOC.read_text(encoding="utf-8")
        for key, value in re.findall(r"([A-Z][A-Z0-9_]{3,})=(\S+)", doc_text):
            value = value.strip('\"\'')
            if value.startswith("...") or "..." in value:
                continue  # placeholder doc (« ... »)
            _check(key, value, "DEPLOY_FLYIO.md")


def _auditer_references():
    """L'audit des RÉFÉRENCES du dépôt, gardé par la disponibilité des
    validateurs : appelé par le mode `--refs-only` ET par le check complet — les
    références s'auditent sans Fly, donc c'est le seul contrôle qui tourne sur un
    run sans jeton (une PR sans secret).

    Une seule implémentation de cette garde : deux copies divergeraient sur ce
    qu'est « validateurs indisponibles », et celle qui ne remplirait pas `errors`
    rendrait un vert VIDE au lieu d'un refus — le garde aurait l'air de vérifier
    ce qu'il n'a pas lu.
    """
    if _VALIDATORS_OK:
        check_reference_formats()
    else:
        errors.append(f"Validateurs indisponibles : {_VALIDATORS_ERR}")


def _rapport(entete, cesure, message_ok):
    """Le rapport d'une passe et son CODE DE SORTIE — une seule implémentation
    pour les deux modes (`--refs-only` et complet).

    `entete` nomme le périmètre LU, `cesure` nomme le refus quand la liste des
    divergences n'est pas vide, `message_ok` est la phrase du vert.

    Recopier cet épilogue, c'était deux façons de compter les divergences et
    deux façons de rendre 0 — la copie qu'on ne retouche pas le jour où la
    sortie change rendrait vert un rapport non vide.
    """
    print(entete)
    for line in checked:
        print(line)
    if errors:
        print(f"\n{BAD} {len(errors)} {cesure} :")
        for e in errors:
            print("  " + e)
        return 1
    print(f"\n{message_ok}")
    return 0


def read_secrets_via_ssh(keys):
    """Lit les valeurs des secrets déployés via SSH (flyctl ssh console →
    printenv). Les valeurs sont renvoyées au script mais ne sont jamais
    affichées (masquées par l'appelant).

    Retourne {NOM: valeur} pour les clés présentes dans l'environnement de
    la machine. Retourne {} si SSH est indisponible (CI sans clé SSH) — les
    formats secrets sont alors simplement non vérifiés, PAS bloquants.
    """
    import subprocess
    try:
        out = subprocess.run(
            ["flyctl", "ssh", "console", "-a", FLY_APP, "-C",
             f"printenv {' '.join(keys)}"],
            capture_output=True, text=True, timeout=90,
            env={**os.environ, "FLY_API_TOKEN": API_TOKEN},
        )
    except Exception as exc:  # noqa: BLE001
        checked.append(f"  [WARN] SSH indisponible ({exc}) — formats secrets non vérifiés")
        return {}
    # NB : flyctl ssh console sort avec exit=1 après la commande (« Descripteur
    # non valide » sur Windows, EOF côté console) MÊME quand la sortie est
    # correcte. Le signal de réussite est donc la PRÉSENCE de valeurs dans
    # stdout, pas le code de retour.
    values = {}
    lines = out.stdout.splitlines()
    for i, key in enumerate(keys):
        # printenv écrit chaque valeur sur sa propre ligne, dans l'ordre.
        if i < len(lines) and lines[i].strip():
            values[key] = lines[i]
    if not values and out.returncode != 0:
        checked.append("  [WARN] SSH console échoué (aucune valeur lue) — formats secrets non vérifiés")
    return values


_fly_toml_env_cache = None


def _fly_toml_env_once():
    """Met en cache le dict [env] de fly.toml (lu plusieurs fois)."""
    global _fly_toml_env_cache
    if _fly_toml_env_cache is None:
        _fly_toml_env_cache = (
            parse_fly_toml_env(FLY_TOML.read_text(encoding="utf-8"))
            if FLY_TOML.exists() else {}
        )
    return _fly_toml_env_cache


_settings_refs_cache = None


def _settings_referenced_keys():
    """Met en cache l'ensemble des clés lues par kojo_settings.py via
    os.environ.get — utilisées pour détecter les secrets ORPHELINS (déployés
    mais référencés nulle part)."""
    global _settings_refs_cache
    if _settings_refs_cache is None:
        refs = set()
        if SETTINGS.exists():
            text = SETTINGS.read_text(encoding="utf-8")
            for name in re.findall(r"os\.environ\.get\(['\"]([A-Z0-9_]+)['\"]", text):
                refs.add(name)
            for name in re.findall(r"getenv\(['\"]([A-Z0-9_]+)['\"]", text):
                refs.add(name)
        _settings_refs_cache = refs
    return _settings_refs_cache


def check_snapshot(fly_secrets):
    # Si un snapshot est défini, un digest NON-sensible qui change alerte.
    for key in sorted(NON_SENSITIVE_SNAPSHOT):
        if key in SENSITIVE_KEYS:
            continue
        expected_digest = NON_SENSITIVE_SNAPSHOT[key]
        live_digest = fly_secrets.get(key, "")
        if live_digest and live_digest != expected_digest:
            errors.append(
                f"[snapshot {key}] digest CHANGÉ ({expected_digest[:8]} → "
                f"{live_digest[:8]}) — rotation non documentée (mettre à jour "
                f"le snapshot si voulu)"
            )
        elif live_digest:
            checked.append(f"  {OK} {key} digest stable ({live_digest[:8]}...)")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    refs_only = "--refs-only" in argv
    if refs_only and not API_TOKEN:
        # Mode références seules : déterministe, aucun accès Fly requis.
        # Utile en CI (chaque push) et en local pour auditer les fichiers
        # de référence SANS token ni réseau.
        _auditer_references()
        return _rapport(
            f"Audit des RÉFÉRENCES du dépôt (mode --refs-only, app={FLY_APP}) :",
            "divergence(s) de format dans les références",
            "[OK] formats des références du dépôt conformes.",
        )

    if not API_TOKEN:
        print("FLY_API_TOKEN manquant — impossible d'interroger Fly "
              "(ou utiliser --refs-only pour auditer les références seules)")
        return 2

    # 1) fly.toml (référence doc)
    if not FLY_TOML.exists():
        errors.append(f"{FLY_TOML} introuvable")
    else:
        fly_toml_text = FLY_TOML.read_text(encoding="utf-8")

    # 2) Environnement réel (API Machines V1)
    try:
        machines = fetch_json(
            f"https://api.machines.dev/v1/apps/{FLY_APP}/machines", API_TOKEN
        )
    except Exception as exc:  # noqa: BLE001
        errors.append(f"API Machines injoignable : {exc}")
        machines = []

    live_env = {}
    if machines:
        started = [m for m in machines if m.get("state") == "started"]
        target = started[0] if started else machines[0]
        live_env = target.get("config", {}).get("env", {})
        checked.append(f"  {OK} machine {target.get('id','?')} env lue")

    # 3) Comparaison fly.toml vs runtime
    if fly_toml_text:
        check_public_env(fly_toml_text, live_env)

    # 4) Secrets : présences (requis par DEPLOY_FLYIO.md) + snapshot stabilité
    required = required_secrets_from_deploy_doc()
    fly_secrets = {}
    try:
        fly_secrets = list_fly_secrets(API_TOKEN)
        # Les secrets injectés dans config.env par Fly ne sont pas là ; on retire
        # les vars du projet déjà déclarées dans [env] (publiques, sans digest).
        req = set(required)
        for k in _fly_toml_env_once():
            req.discard(k)
        check_secret_presence(req, fly_secrets)
        check_snapshot(fly_secrets)
        checked.append(f"  {OK} {len(fly_secrets)} secrets Fly listes")

        # 4b) DOUBLONS [env]↔secret (le secret écrase [env] sur Fly)
        check_duplicates(_fly_toml_env_once(), fly_secrets)

        # 4c) ORPHELINS : secret déployé mais référencé nulle part
        example_keys = set()
        if ENV_EXAMPLE.exists():
            example_keys = set(parse_env_example(ENV_EXAMPLE.read_text(encoding="utf-8")))
        known = set(example_keys) | set(required) | _settings_referenced_keys()
        check_orphan_secrets(fly_secrets, known)

        # 4d) Couverture .env.example (chaque clé non-optionnelle existe sur Fly)
        if ENV_EXAMPLE.exists():
            check_env_example_coverage(
                example_keys, _fly_toml_env_once(), fly_secrets
            )
    except RuntimeError as exc:
        errors.append(str(exc))

    # 5) FORMAT : références du dépôt (déterministe) PUIS valeurs déployées
    _auditer_references()
    if _VALIDATORS_OK:
        secret_keys = sorted(set(SECRET_FORMAT_CHECKS) & set(fly_secrets))
        secret_values = read_secrets_via_ssh(secret_keys) if secret_keys else {}
        # ── CE CONTRÔLE DIT S'IL A EU LIEU, dans les DEUX cas ──────────────────
        # Les formats des secrets DÉPLOYÉS se lisent via SSH, indisponible dans
        # la CI (pas de clé) : le contrôle peut donc ne rien vérifier. Jusqu'ici
        # le journal ne l'écrivait QUE dans le cas d'exception (`[WARN]`), et
        # jamais quand `flyctl ssh` rendait une sortie vide sans erreur — les
        # trois derniers pushs de `main` (relevés le 12/10/2026) ne portent ni
        # `[OK]` ni `[WARN]` à ce sujet, donc un lecteur du run ne pouvait pas
        # distinguer « vérifié » de « sauté ». Un contrôle dont on ne peut pas
        # savoir s'il a eu lieu n'est pas un contrôle : les deux issues sont
        # maintenant nommées, et l'absence de verdict se lit comme telle.
        # (Angle mort assumé F4 de CI-COVERAGE.md : ce n'est toujours pas un
        # gate — le rendre bloquant exigerait une clé SSH sur le runner.)
        if secret_keys and not secret_values:
            checked.append(
                f"  [AUCUN VERDICT] formats des {len(secret_keys)} secret(s) déployés NON "
                "vérifiés (SSH indisponible) — ce contrôle n'a pas eu lieu"
            )
        elif secret_values:
            checked.append(
                f"  [OK] formats des {len(secret_values)} secret(s) déployés vérifiés "
                "(valeurs masquées)"
            )
        check_deployed_formats(live_env, secret_values)

    # 6) Rapport
    return _rapport(
        f"Check doc<->prod Fly (app={FLY_APP}) :",
        "divergence(s)",
        "[OK] fly.toml et secrets Fly synchronises avec les references du depot.",
    )


if __name__ == "__main__":
    sys.exit(main())