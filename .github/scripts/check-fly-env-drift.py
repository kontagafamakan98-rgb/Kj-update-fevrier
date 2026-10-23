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
  8. BATTEMENT DE CŒUR DÉPLOYÉ : `KOJO_SSE_HEARTBEAT_SECONDS`, s'il est posé
     (secret ou [env]), est jugé contre la fenêtre de silence du CLIENT
     (`frontend/src/config/flux-temps-reel.js`, lue et non recopiée) : deux
     battements doivent tenir dans cette fenêtre, sinon un flux vivant mais
     inactif serait déclaré tombé. Une surcharge ne vit que sur la machine
     déployée : c'est là qu'elle se lit — et ce que le DÉPÔT en déclare se juge
     aussi hors ligne (voir 10 bis).
  9. LES AUTRES RÉGLAGES DE TEMPS DU FLUX, chacun contre SON contrat :
     * le BAIL du registre Redis (`PARTAGE_LEASE_SECONDS`) n'existe pas comme
       variable : il est CALCULÉ depuis le battement déployé par une formule
       lue dans `kojo_live.py`. Le bail calculé doit tolérer un battement
       perdu (`≥ 2 × battement`) et ne pas survivre au verdict du client
       (`≤ fenêtre de silence + un battement`), sinon les places d'un worker
       tué resteraient comptées au plafond du compte ;
     * le REPLI du client (`FALLBACK_POLL_MS`) doit rester moins bavard que le
       sondage qu'il remplace (2 req/min, soit 30 s) et n'avoir qu'UNE valeur
       pour ses deux déclarations (`NotificationContext.js`, `Messages.js`)
       — deux valeurs divergentes sont refusées, pas arbitrées. Cette valeur
       part dans le bundle : ce qui est jugé est la source dont il est bâti,
       et le message le dit.
  10. LES DEUX DÉLAIS DU BUS, ET LEUR CONTRAT COMMUN :
     * le DÉLAI DE RECONNEXION (`KOJO_LIVE_BUS_RECONNECT_SECONDS`) doit rester
       dans [un plancher, UN BATTEMENT] : une reprise immédiate transforme une
       panne de Redis en boucle qui republie sans répit (journal saturé, boucle
       d'événements partagée avec les flux SSE), et au-delà d'un battement un
       Redis revenu n'est pas rejoint avant plusieurs battements — or ce qui
       est publié entre-temps n'est JAMAIS rejoué (pub/sub sans historique) ;
     * la FILE DE PUBLICATION (`KOJO_LIVE_BUS_QUEUE`) doit absorber la rafale
       produite pendant UNE fenêtre de reconnexion, au débit que la file d'un
       abonné dimensionne déjà (`MAX_QUEUE_SIZE` : une notification par
       seconde en rafale), soit `≥ MAX_STREAMS_TOTAL × délai`. Les deux
       réglages se jugent ENSEMBLE : c'est la panne que l'un couvre que
       l'autre doit encaisser.
     Ce MÊME contrat se juge AUSSI HORS LIGNE (`--refs-only`, l'étape de PR
     sans jeton) : sur ce que le DÉPÔT déclare (`fly.toml [env]` et bloc
     `fly secrets set` de DEPLOY_FLYIO.md) et les défauts LUS dans
     `kojo_live.py`. Une file documentée trop petite, une reprise documentée
     au-delà d'un battement ou un défaut de code qui viole la relation sont
     donc vus AVANT le déploiement. Ce que cette passe ne voit pas — une
     surcharge posée en SECRET sur Fly — est DÉCLARÉ, et l'étape en ligne le
     juge.
  10 bis. LES TROIS RÉGLAGES DE TEMPS DU FLUX, JUGÉS HORS LIGNE EUX AUSSI :
     le battement DÉCLARÉ (ou son défaut) contre la fenêtre du client, le bail
     qui en DÉCOULE (donc calculé depuis la valeur déclarée, jamais depuis le
     défaut seul quand une déclaration existe), et le repli du client dans ses
     DEUX déclarations. Le jugement n'est pas réécrit : les mêmes règles sont
     appelées avec les déclarations du dépôt pour source, et le verdict nomme
     l'origine (« DÉCLARÉ »). Une PR qui déclare 30 s de battement, qui allonge
     la formule du bail ou qui aligne le repli sur les 30 s du sondage remplacé
     rougit AVANT la fusion, au lieu d'attendre un déploiement.

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
    # Jeton de l'endpoint Prometheus : un secret qui se rotate, donc hors du
    # snapshot de stabilité (sinon une rotation voulue passerait pour un écart).
    "METRICS_TOKEN",
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
    # Métriques Prometheus : sans `METRICS_TOKEN` le backend démarre et
    # `/metrics` refuse (503 nommée). L'absence sur Fly est donc un choix
    # d'exploitation (collecte éteinte), pas une config incomplète — mais sa
    # PRÉSENCE est ce qui rend la collecte possible (backend/METRIQUES.md).
    "METRICS_TOKEN",
    # Bus temps réel (Redis pub/sub) : les réglages ont un défaut de repli dans
    # `kojo_live` (canal `kojo:live`, tampon de 1000, reprise à 2 s). Le bus lui-même
    # n'existe que si `REDIS_URL` est posé — leur absence sur Fly n'est donc
    # pas une divergence doc↔prod, seulement un réglage laissé au défaut.
    "KOJO_LIVE_BUS_CHANNEL", "KOJO_LIVE_BUS_QUEUE", "KOJO_LIVE_BUS_RECONNECT_SECONDS",
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
    # Support WhatsApp (Kapso) : sans `KAPSO_WEBHOOK_SECRET` l'ingestion est
    # DÉSACTIVÉE (503 nommé), et sans `KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`
    # l'envoi est éteint — le message reçu est alors escaladé en ticket. Le
    # backend démarre dans les trois cas, donc leur absence sur Fly est un
    # choix d'exploitation et non une config incomplète ; leur PRÉSENCE est ce
    # qui rend le support WhatsApp effectif (backend/kojo_whatsapp.py).
    "KAPSO_API_KEY", "KAPSO_PHONE_NUMBER_ID", "KAPSO_WEBHOOK_SECRET",
    "KAPSO_API_BASE_URL", "KAPSO_API_VERSION", "KAPSO_TIMEOUT_SECONDS",
    "WHATSAPP_CONTEXT_MESSAGES", "WHATSAPP_MESSAGE_RETENTION_DAYS",
    "FAMAKAN_OWNER_EMAIL", "PASSWORD_RESET_FROM_EMAIL",
    "REFERRAL_FILLEUL_REWARD", "REFERRAL_SPONSOR_REWARD",
    "REFERRAL_WELCOME_FILLEUL_REWARD", "REFERRAL_WELCOME_SPONSOR_REWARD",
    # Assistant IA de /support : sans ces variables la fonctionnalité est
    # DÉSACTIVÉE (is_configured() est faux, la route répond 503 et la page
    # retombe sur le questionnaire) — le backend démarre sans elles, donc leur
    # absence sur Fly n'est pas une divergence.
    "NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN",
    "NEON_AI_GATEWAY_MODEL", "NEON_AI_GATEWAY_TIMEOUT_SECONDS",
    # Budget de l'assistant (plafond de dépense par jour UTC) : les deux
    # plafonds et la durée de conservation du compteur ont un défaut dans
    # `kojo_settings` (200 appels, 250 000 caractères, 90 jours), donc leur
    # absence sur Fly est un réglage laissé au défaut, pas une config
    # incomplète — et c'est le défaut qui borne la facture.
    "NEON_AI_GATEWAY_DAILY_CALLS", "NEON_AI_GATEWAY_DAILY_PROMPT_CHARS",
    "AI_USAGE_RETENTION_DAYS",
    # Sequestre a deux temps : les deux reglages ont un defaut de repli dans
    # `kojo_settings` (7 jours, balayage horaire) et le delai REFUSE le demarrage
    # sous 1 jour. Leur absence sur Fly n'est donc pas une divergence doc-prod :
    # c'est le defaut qui s'applique, et la valeur est ecrite dans
    # backend/SAUVEGARDES_ATLAS.md (section sequestre) pour qui veut la changer.
    "COMPLETION_AUTO_RELEASE_DAYS", "COMPLETION_SWEEP_INTERVAL_MINUTES",
    # Alerte d'arbitrage (part de decisions prises sans reponse) : le seuil, la
    # fenetre glissante et la cadence de la boucle ont tous un defaut dans
    # `kojo_settings` (0,5 ; 90 jours ; 1 440 min) et les deux premiers sont
    # VALIDES au demarrage (0 < seuil < 1, fenetre entre 1 et 3 650 jours). Leur
    # absence sur Fly est donc un reglage laisse au defaut — le defaut qui
    # declenche l'alerte a 50 % sur 90 jours —, pas une config incomplete.
    "LITIGE_SANS_REPONSE_SEUIL", "LITIGE_SANS_REPONSE_FENETRE_JOURS",
    "LITIGE_ALERTE_INTERVAL_MINUTES",
    # Alerte « place de marche VIDE » : la duree de vide toleree et la cadence
    # de la boucle ont un defaut dans `kojo_settings` (24 h ; 60 min), et la
    # duree est VALIDEE au demarrage (1..720). Leur absence sur Fly est donc un
    # reglage laisse au defaut — celui qui alerte apres une journee sans
    # mission ouverte —, pas une config incomplete.
    "MARCHE_VIDE_ALERTE_HEURES", "MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES",
    # Alerte « missions ouvertes sans aucune proposition » : l'anciennete et la
    # cadence ont un defaut dans `kojo_settings` (3 jours ; 360 min), borne au
    # demarrage. Absence sur Fly = reglage laisse au defaut, pas une config
    # incomplete.
    "MISSIONS_SANS_PROPOSITION_JOURS",
    "MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES",
    # Relance du CLIENT : l'anciennete et la cadence ont un defaut dans
    # `kojo_settings` (6 h ; 60 min), borne au demarrage. Absence sur Fly =
    # reglage laisse au defaut, pas une config incomplete.
    "CLIENT_SANS_PROPOSITION_HEURES",
    "CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES",
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


# ── Le battement de cœur DÉPLOYÉ, jugé contre la fenêtre du CLIENT ──────────
# La surcharge échappait à TOUS les gardes du dépôt :
# `battement-coeur-aligne.test.js` lit le défaut Python, `fly.toml` et la config
# du client — trois sources HORS LIGNE. Poser `KOJO_SSE_HEARTBEAT_SECONDS` en
# secret Fly change le battement RÉEL sans toucher aucune des trois (mesuré le
# 18/10/2026 : une fenêtre client de 15 s contre un battement de 20 s déclarait
# tombé un flux VIVANT mais inactif, donc une reconnexion par flux inactif —
# plus d'allers-retours que le sondage remplacé). Cette règle-ci juge la valeur
# DÉPLOYÉE, là où elle existe : c'est la seule qui compte.
BATTEMENT_KEY = "KOJO_SSE_HEARTBEAT_SECONDS"
FLUX_CONFIG = REPO_ROOT / "frontend" / "src" / "config" / "flux-temps-reel.js"


def contrat_du_client(chemin=None):
    """(battement_ms, fenêtre_ms) du CLIENT, LUS dans sa config — ou None.

    Les trois nombres sont LUS, jamais recopiés : un `45000` écrit ici serait une
    seconde source, et c'est la divergence de deux sources qui a coûté une
    reconnexion par flux inactif. `None` = contrat illisible (fichier absent ou
    export renommé) : l'appelant refuse alors de conclure au lieu de supposer.
    """
    chemin = FLUX_CONFIG if chemin is None else chemin
    try:
        texte = Path(chemin).read_text(encoding="utf-8")
    except OSError:
        return None

    def nombre(nom):
        trouve = re.search(rf"export const {nom}\s*=\s*([\d.]+)\s*;", texte)
        return float(trouve.group(1)) if trouve else None

    battement = nombre("BATTEMENT_SERVEUR_MS")
    toleres = nombre("BATTEMENTS_TOLERES")
    marge = nombre("MARGE_GIGUE_MS")
    if battement is None or toleres is None or marge is None:
        return None
    # La MÊME formule que le client (`SILENCE_TIMEOUT_MS`), appliquée aux nombres
    # lus : le client tolère `toleres` battements manqués, plus une marge de
    # gigue.
    return battement, battement * (toleres + 1) + marge


def check_heartbeat_contract(
    deploye, valeur, contrat=None,
    libelle="DÉPLOYÉ", libelle_valeur="DÉPLOYÉE", source="sur Fly",
):
    """Le battement (déployé OU déclaré) doit tenir DANS la fenêtre du client.

    Invariant jugé : `2 × battement ≤ fenêtre de silence` — celui du garde hors
    ligne (`SILENCE_TIMEOUT_MS >= 2 × BATTEMENT_SERVEUR_MS`) : le client doit
    pouvoir manquer un battement sans condamner un flux vivant.

    Un intervalle n'est pas un secret, contrairement à ce que `SECRET_FORMAT_CHECKS`
    sait masquer : le nommer est ce qui rend le refus actionnable (« 30 s contre
    une fenêtre de 45 s »). Aucune autre valeur déployée n'est jamais citée ici.

    Les trois `libelle*`/`source` portent l'ORIGINE de la valeur : « DÉPLOYÉ »
    quand elle est lue sur la machine (API Machines, SSH), « DÉCLARÉ » quand elle
    est lue dans ce que le dépôt déclare (`fly.toml`, bloc `fly secrets set`).
    Le JUGEMENT est le même code : seule la source change, et la nommer empêche
    de lire un vert hors ligne comme un verdict sur la machine.
    """
    if not deploye:
        checked.append(
            f"  {OK} {BATTEMENT_KEY} non surchargé {source} (défaut du code)"
        )
        return
    if contrat is None:
        errors.append(
            f"[{BATTEMENT_KEY}] surchargé sur Fly, mais le contrat du client est "
            f"ILLISIBLE ({FLUX_CONFIG.name}) — l'écart réel avec la fenêtre de "
            f"silence n'a pas pu être jugé. Rétablir les exports "
            f"BATTEMENT_SERVEUR_MS / BATTEMENTS_TOLERES / MARGE_GIGUE_MS."
        )
        return
    _, fenetre_ms = contrat
    brut = str(valeur or "").strip()
    if not brut:
        # Aveugle, et DIT : la valeur d'un secret se lit par SSH, indisponible
        # dans la CI. Un vert ici serait un vert qui n'a rien mesuré.
        checked.append(
            f"  [AUCUN VERDICT] {BATTEMENT_KEY} {libelle} mais sa valeur est illisible "
            f"(SSH indisponible) — l'écart avec la fenêtre client ({fenetre_ms:g} ms) "
            "n'a pas été jugé"
        )
        return
    try:
        secondes = float(brut)
    except ValueError:
        errors.append(
            f"[{BATTEMENT_KEY}] valeur {libelle_valeur} ILLISIBLE ({len(brut)} car., "
            "attendu un nombre de secondes) — le battement réel n'est pas "
            "connaissable, donc la fenêtre du client ne peut pas le contenir. "
            f"Corriger ou retirer (fly secrets unset {BATTEMENT_KEY})."
        )
        return
    deploye_ms = secondes * 1000
    if deploye_ms <= 0:
        errors.append(
            f"[{BATTEMENT_KEY}] valeur {libelle_valeur} {secondes:g} s : un battement nul ou "
            "négatif ne bat pas — le flux serait muet dès l'ouverture. "
            f"fly secrets unset {BATTEMENT_KEY} pour revenir au défaut du code."
        )
        return
    if deploye_ms * 2 > fenetre_ms:
        errors.append(
            f"[{BATTEMENT_KEY}] battement {libelle} {secondes:g} s : deux battements "
            f"({deploye_ms * 2:g} ms) dépassent la fenêtre de silence du client "
            f"({fenetre_ms:g} ms) — un flux VIVANT mais inactif serait déclaré "
            "tombé, donc une reconnexion par flux inactif. Aligner la fenêtre du "
            "client (frontend/src/config/flux-temps-reel.js) ou retirer la "
            f"surcharge (fly secrets unset {BATTEMENT_KEY})."
        )
        return
    checked.append(
        f"  {OK} {BATTEMENT_KEY} = {secondes:g} s — deux battements "
        f"({deploye_ms * 2:g} ms) tiennent dans la fenêtre client ({fenetre_ms:g} ms)"
    )


# ── LES AUTRES RÉGLAGES DE TEMPS DU FLUX, JUGÉS CONTRE LEUR CONTRAT ─────────
# Le battement n'est pas le seul délai qui décide de la vie d'un flux : le BAIL
# du registre Redis décide QUAND une place se libère, et le REPLI décide à
# quelle cadence le client redemande quand le flux est tombé. Tous deux ont un
# contrat, et aucun des deux n'était jugé — le bail n'existait même pas comme
# valeur déployée, puisqu'il est CALCULÉ depuis le battement.
KOJO_LIVE = REPO_ROOT / "backend" / "kojo_live.py"
BAIL_CONSTANTE = "PARTAGE_LEASE_SECONDS"
# Un flux vivant peut manquer un battement (réseau mobile, proxy lent) : le bail
# est repoussé PAR le battement, donc il doit valoir au moins DEUX intervalles.
# À un intervalle, une seule arrivée tardive expirerait une place VIVANTE et le
# compte admettrait un cinquième flux.
BAIL_RENOUVELLEMENTS = 2

REPLI_CONSTANTE = "FALLBACK_POLL_MS"
# Les DEUX déclarations du repli : notifications et messagerie. Une seule
# valeur, deux consommateurs — c'est cette unanimité qu'on juge, pas l'une des
# deux copies (le batail du 18/10/2026 était justement deux sources qui avaient
# divergé en silence).
REPLI_FICHIERS = (
    REPO_ROOT / "frontend" / "src" / "contexts" / "NotificationContext.js",
    REPO_ROOT / "frontend" / "src" / "pages" / "Messages.js",
)
# Le sondage que le flux REMPLACE : 2 requêtes par minute et par session
# (AGENTS.md, « Temps réel »). Un repli à 30 s ou plus rapide rendrait le
# remplacement inutile — un aller-retour pour un autre.
ANCIEN_SONDAGE_MS = 30000.0


def _nombre_js(texte, constante):
    """Valeur d'une constante JS numérique (`60_000`, `60000`), ou None."""
    trouve = re.search(rf"\bconst\s+{constante}\s*=\s*([\d_.]+)\s*;", texte)
    if not trouve:
        return None
    try:
        return float(trouve.group(1).replace("_", ""))
    except ValueError:
        return None


def bail_depuis_battement(expression):
    """La formule du bail LUE dans le code, rendue comme `f(battement_s)`.

    `None` si la formule n'est pas lisible. L'évaluation est BORNÉE : seuls
    `max`, `min` et `HEARTBEAT_SECONDS` existent, aucun attribut, aucun appel,
    aucun nom du module — une expression qui sort de ce vocabulaire est
    REFUSÉE plutôt que devinée, et le refus dit quoi rétablir.

    Pourquoi évaluer au lieu de recopier : `max(60.0, HEARTBEAT_SECONDS * 3)`
    n'est pas un nombre, c'est une POLITIQUE. La recopier ici en ferait une
    seconde source, et le bail jugé ne serait plus celui que la machine calcule.
    """
    noms = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expression))
    if not noms <= {"max", "min", "HEARTBEAT_SECONDS"}:
        return None
    if re.search(r"[^A-Za-z0-9_.,+*()\s]", expression):
        return None

    def calcul(battement_s):
        try:
            return float(
                eval(  # noqa: S307 - vocabulaire clos, aucun nom hors max/min/battement
                    expression,
                    {"__builtins__": {}},
                    {
                        "HEARTBEAT_SECONDS": float(battement_s),
                        "max": max,
                        "min": min,
                    },
                )
            )
        except Exception:  # noqa: BLE001 - une formule qui ne calcule pas n'est pas un contrat
            return None

    return calcul


def contrats_du_serveur(chemin=None):
    """`(battement par défaut, formule du bail)` LUS dans `kojo_live.py`, ou None.

    Les deux valeurs sont lues, jamais recopiées : un `20` ou un `60.0` écrit
    ici serait une seconde source, et c'est la divergence de deux sources qui a
    coûté une reconnexion par flux inactif (cf. `battement-coeur-aligne.test.js`).
    `None` = lecteur cassé : l'appelant refuse de conclure au lieu de supposer.
    """
    chemin = KOJO_LIVE if chemin is None else chemin
    try:
        texte = Path(chemin).read_text(encoding="utf-8")
    except OSError:
        return None
    defaut = re.search(
        r'HEARTBEAT_SECONDS\s*=\s*float\(\s*os\.environ\.get\(\s*'
        r'"KOJO_SSE_HEARTBEAT_SECONDS"\s*,\s*"([\d.]+)"',
        texte,
    )
    formule = re.search(rf"^{BAIL_CONSTANTE}\s*=\s*(.+)$", texte, re.MULTILINE)
    if not defaut or not formule:
        return None
    bail = bail_depuis_battement(formule.group(1).strip())
    if bail is None:
        return None
    return float(defaut.group(1)), bail


def check_lease_contract(
    deploye, valeur, contrat_client, contrats, libelle="DÉPLOYÉ",
):
    """Le bail CALCULÉ depuis le battement déployé (ou déclaré), jugé contre ses contrats.

    Deux invariants, chacun pour une panne réelle :

      * `bail ≥ 2 × battement` — le bail est repoussé par chaque battement : un
        battement perdu ne doit pas expirer une place VIVANTE, sinon le compte
        admet un cinquième flux pendant que les quatre premiers vivent ;
      * `bail ≤ fenêtre de silence du client + un battement` — un worker tué
        sans `finally` garde ses places jusqu'à expiration : au-delà du moment
        où TOUS ses clients ont renoncé, ces places fantômes refuseraient un
        flux légitime.

    `valeur` est le battement DÉPLOYÉ (brut) : le bail réel en découle, donc le
    juger sur le défaut du code alors qu'une surcharge existe serait juger une
    autre machine. Sans surcharge, c'est le défaut qui décide — et la formule
    est quand même jugée, ce qui attrape une dérive de la formule elle-même.
    """
    if contrats is None:
        errors.append(
            f"[{BAIL_CONSTANTE}] formule ILLISIBLE ({KOJO_LIVE.name}) : le bail réel "
            "n'est pas calculable, donc ses contrats ne sont pas jugés. Rétablir "
            "`HEARTBEAT_SECONDS = float(os.environ.get(\"KOJO_SSE_HEARTBEAT_SECONDS\"...))` "
            f"et `{BAIL_CONSTANTE} = max(..., HEARTBEAT_SECONDS * N)`."
        )
        return
    if contrat_client is None:
        errors.append(
            f"[{BAIL_CONSTANTE}] la fenêtre de silence du client est ILLISIBLE "
            f"({FLUX_CONFIG.name}) : le bail ne peut pas être jugé contre le verdict "
            "du client — aucun verdict n'est rendu."
        )
        return

    _, fenetre_ms = contrat_client
    defaut_s, bail_de = contrats
    brut = str(valeur or "").strip()

    if deploye and not brut:
        # Même angle mort que le battement : le secret se lit par SSH, absent
        # en CI. Le bail dépend de cette valeur, donc il n'est pas calculable —
        # et un bail calculé sur le défaut ne serait pas celui de la machine.
        checked.append(
            f"  [AUCUN VERDICT] {BAIL_CONSTANTE} DÉRIVÉ d'un battement {libelle} dont la "
            "valeur est illisible (SSH indisponible) — le bail réel n'a pas été calculé"
        )
        return

    if deploye:
        try:
            battement_s = float(brut)
        except ValueError:
            errors.append(
                f"[{BAIL_CONSTANTE}] le battement {libelle} est ILLISIBLE : le bail en "
                "découle, donc il n'est pas calculable. Corriger ou retirer la "
                f"surcharge (fly secrets unset {BATTEMENT_KEY})."
            )
            return
        if battement_s <= 0:
            # La règle du battement refuse déjà ce cas : ne pas doubler le bruit.
            return
        origine = f"battement {libelle.lower()} {battement_s:g} s"
    else:
        battement_s = defaut_s
        origine = f"battement par défaut {battement_s:g} s"

    bail_s = bail_de(battement_s)
    if bail_s is None or bail_s <= 0:
        errors.append(
            f"[{BAIL_CONSTANTE}] la formule du bail ne donne pas une valeur exploitable "
            f"pour {origine} — le bail réel n'est pas connaissable."
        )
        return

    if bail_s < BAIL_RENOUVELLEMENTS * battement_s:
        errors.append(
            f"[{BAIL_CONSTANTE}] bail {bail_s:g} s ({origine}) sous "
            f"{BAIL_RENOUVELLEMENTS} × battement "
            f"({BAIL_RENOUVELLEMENTS * battement_s:g} s) : un battement PERDU "
            "expirerait une place VIVANTE, et le compte admettrait un flux de plus. "
            f"Relever {BAIL_CONSTANTE} dans backend/kojo_live.py."
        )
        return

    fenetre_s = fenetre_ms / 1000.0
    if bail_s > fenetre_s + battement_s:
        # Le remède dépend de l'ORIGINE du bail : surchargé, il vient du
        # battement déployé (formule = 3 × battement) ; par défaut, il vient de
        # la formule elle-même. Nommer le mauvais fichier ferait perdre le
        # prochain lecteur.
        remede = (
            f"Retirer la surcharge du battement (fly secrets unset {BATTEMENT_KEY}) : "
            f"le bail en découle."
            if deploye
            else f"Ramener {BAIL_CONSTANTE} dans backend/kojo_live.py."
        )
        errors.append(
            f"[{BAIL_CONSTANTE}] bail {bail_s:g} s ({origine}) au-delà du verdict du "
            f"client ({fenetre_s:g} s) plus un battement ({battement_s:g} s), soit "
            f"{fenetre_s + battement_s:g} s : les "
            "places d'un worker tué resteraient comptées au plafond du compte après "
            f"que tous ses clients ont renoncé, et un flux légitime serait refusé. {remede}"
        )
        return

    checked.append(
        f"  {OK} {BAIL_CONSTANTE} = {bail_s:g} s ({origine}) — au moins "
        f"{BAIL_RENOUVELLEMENTS} × battement "
        f"({BAIL_RENOUVELLEMENTS * battement_s:g} s) et au plus fenêtre client "
        f"+ un battement ({fenetre_s + battement_s:g} s)"
    )


def contrat_du_repli(chemins=None):
    """`(repli_ms, raison)` — le repli lu dans CHAQUE déclaration.

    `(valeur, None)` quand toutes les déclarations s'accordent ; `(None, raison)`
    sinon. L'absence ET la divergence sont des refus : une valeur lue dans un
    fichier puis recopiée dans l'autre est exactement la duplication qui a coûté
    une reconnexion par flux inactif au battement.
    """
    chemins = REPLI_FICHIERS if chemins is None else tuple(chemins)
    trouvees = []
    for chemin in chemins:
        try:
            texte = Path(chemin).read_text(encoding="utf-8")
        except OSError:
            return None, f"{Path(chemin).name} illisible"
        valeur = _nombre_js(texte, REPLI_CONSTANTE)
        if valeur is None:
            return None, f"{Path(chemin).name} ne déclare pas {REPLI_CONSTANTE}"
        trouvees.append((Path(chemin).name, valeur))
    valeurs = {valeur for _, valeur in trouvees}
    if len(valeurs) != 1:
        detail = ", ".join(f"{nom} {valeur:g} ms" for nom, valeur in trouvees)
        return None, f"valeurs DIVERGENTES ({detail})"
    return trouvees[0][1], None


def check_fallback_contract(valeur, raison):
    """Le repli du client, jugé contre le sondage qu'il REMPLACE.

    Ce n'est pas une valeur de Fly : elle part dans le bundle du client, sans
    surcharge d'exécution. Ce qui est jugé est donc la SOURCE dont ce bundle est
    bâti — et le message le dit, pour qu'un vert ici ne se lise pas comme une
    mesure de la machine.

    Contrat : le repli ne doit pas être aussi bavard que les 2 requêtes par
    minute du sondage qu'il remplace. À 60 s il divise la charge par deux ; à
    30 s il ne remplace qu'un aller-retour par un autre.
    """
    if valeur is None:
        errors.append(
            f"[{REPLI_CONSTANTE}] repli NON JUGEABLE : {raison}. Les deux "
            "déclarations doivent porter la MÊME valeur — deux valeurs qui "
            "divergent font deux cadences selon la page ouverte, et aucune ne "
            "peut être jugée contre le sondage remplacé."
        )
        return
    if valeur <= ANCIEN_SONDAGE_MS:
        errors.append(
            f"[{REPLI_CONSTANTE}] repli de {valeur:g} ms : aussi bavard que le sondage "
            f"remplacé ({ANCIEN_SONDAGE_MS:g} ms = 2 req/min par session) — le flux "
            "n'aurait remplacé qu'un aller-retour par un autre. Allonger le repli "
            "dans frontend/src/contexts/NotificationContext.js ET "
            "frontend/src/pages/Messages.js."
        )
        return
    checked.append(
        f"  {OK} {REPLI_CONSTANTE} = {valeur:g} ms — moins bavard que le sondage "
        f"remplacé ({ANCIEN_SONDAGE_MS:g} ms), même valeur dans ses deux "
        "déclarations (valeur du bundle, aucune surcharge d'exécution)"
    )


# ── LE BUS TEMPS RÉEL : DEUX DÉLAIS, UN CONTRAT ─────────────────────────────
# Le battement, le bail et le repli étaient jugés ; les deux réglages du BUS ne
# l'étaient pas, alors que ce sont eux qui décident combien de temps un process
# reste sourd et combien d'événements il peut perdre en attendant. Ils ont un
# défaut dans `kojo_live.py`, donc leur absence sur Fly n'est PAS une divergence
# — mais leur valeur (déployée ou par défaut) peut violer leur contrat.
BUS_RECONNEXION_KEY = "KOJO_LIVE_BUS_RECONNECT_SECONDS"
BUS_FILE_KEY = "KOJO_LIVE_BUS_QUEUE"
# Plancher du délai de reprise : chaque tentative ratée coûte déjà un aller-retour
# (le client Redis porte `socket_timeout=2`), donc la pause est le SEUL frein de
# la boucle. Sous une seconde, une panne devient un incendie de journal — et la
# boucle tourne dans la boucle d'événements qui sert les flux SSE.
BUS_PLANCHER_S = 1.0
# Débit déjà dimensionné pour la file d'UN abonné (`MAX_QUEUE_SIZE` : « une
# notification par seconde pendant une rafale tient largement »). Le bus porte
# une enveloppe par `publish`, donc une rafale qui sert tous les flux du process
# pendant la fenêtre de reconnexion produit jusqu'à `flux_max × délai` enveloppes.
DEBIT_BUS_PAR_FLUX = 1.0


def contrats_du_bus(chemin=None):
    """`(délai de reprise, taille de file, flux max)` LUS dans `kojo_live.py`.

    Les trois sont lus, jamais recopiés : le contrat de la file se CALCULE à
    partir du délai de reprise, et recopier l'un ou l'autre jugerait une autre
    machine que celle qui tourne. `None` = lecteur cassé (constante renommée,
    défaut retiré) : l'appelant refuse de conclure au lieu de supposer.
    """
    chemin = KOJO_LIVE if chemin is None else chemin
    try:
        texte = Path(chemin).read_text(encoding="utf-8")
    except OSError:
        return None

    def defaut(constante, cle, convertisseur):
        trouve = re.search(
            rf"{constante}\s*=\s*{convertisseur}\(\s*os\.environ\.get\(\s*"
            rf'"{cle}"\s*,\s*"([\d.]+)"',
            texte,
        )
        return float(trouve.group(1)) if trouve else None

    delai = defaut("BUS_RECONNECT_SECONDS", BUS_RECONNEXION_KEY, "float")
    file_bus = defaut("BUS_QUEUE_SIZE", BUS_FILE_KEY, "int")
    flux_max = defaut("MAX_STREAMS_TOTAL", "KOJO_SSE_MAX_TOTAL", "int")
    if delai is None or file_bus is None or flux_max is None:
        return None
    return delai, file_bus, flux_max


def _battement_effectif(deploye, valeur, contrats_serveur):
    """Le battement que la machine bat RÉELLEMENT (secondes), ou `None`.

    `None` quand il n'est pas résolvable (déployé illisible ou nul) : la règle
    du bail a déjà refusé ce cas, et la borne haute du bus se déclare alors non
    jugée plutôt que d'être supposée sur le défaut du code.
    """
    if contrats_serveur is None:
        return None
    defaut, _ = contrats_serveur
    if not deploye:
        return defaut
    try:
        battement = float(str(valeur or "").strip())
    except ValueError:
        return None
    return battement if battement > 0 else None


def _delai_effectif(deployes, valeurs, cle, defaut, libelle="DÉPLOYÉE"):
    """`(valeur, origine)` — la valeur déployée si elle existe, sinon le défaut.

    `(None, "ILLISIBLE")` pour une valeur déployée qui n'est pas un nombre : un
    réglage déployé qu'on ne sait pas lire ne retombe PAS sur le défaut du code,
    ce qui jugerait une autre machine en croyant juger celle-ci.

    `libelle` nomme l'ORIGINE dans le verdict : « DÉPLOYÉE » en ligne,
    « DÉCLARÉE » hors ligne. Le même jugement sert les deux passes — seule la
    source diffère, et la nommer est ce qui empêche de lire un vert hors ligne
    comme un verdict sur la machine.
    """
    if deployes.get(cle):
        brut = str(valeurs.get(cle) or "").strip()
        if not brut:
            # Une valeur VIDE dans `[env]` est falsy dans le code
            # (`os.environ.get(...) or défaut`) : le défaut s'applique. Un
            # SECRET muet, lui, ne passe pas ici — le balayage des valeurs
            # illisibles l'a déjà écarté, parce qu'on ne peut pas savoir ce
            # qu'il porte.
            return float(defaut), "défaut du code ([env] vide)"
        try:
            return float(brut), f"valeur {libelle}"
        except ValueError:
            return None, "ILLISIBLE"
    return float(defaut), "défaut du code"


def check_bus_contract(
    battement_deploye, valeur_battement, contrats_serveur, contrats_bus,
    deployes_bus, valeurs_bus, libelle="DÉPLOYÉE",
):
    """Les deux délais du bus, jugés contre LEUR contrat — qui les lie.

    Deux invariants, chacun pour une panne réelle :

      * `BUS_PLANCHER_S ≤ délai ≤ battement` — sous le plancher la reprise est
        une boucle sans frein (journal saturé, boucle d'événements partagée) ;
        au-delà d'un battement, un Redis revenu n'est pas rejoint avant
        plusieurs battements, et les événements publiés entre-temps ne sont
        jamais rejoués : un pub/sub n'a pas d'historique ;
      * `file ≥ MAX_STREAMS_TOTAL × délai × 1 évt/s` — pendant la fenêtre de
        reconnexion, `publish` continue de remplir le tampon. En deçà, la rafale
        déborde et le bus perd ces événements (`bus_stats()['perdus']`) : ils
        restent locaux, donc invisibles des autres workers, sans rejeu.

    Le second invariant est ce qui rend ces deux réglages UN contrat : allonger
    la reconnexion sans agrandir la file déplace la panne, il ne la corrige pas.
    """
    if contrats_bus is None:
        errors.append(
            f"[{BUS_RECONNEXION_KEY}/{BUS_FILE_KEY}] réglages du bus ILLISIBLES "
            f"({KOJO_LIVE.name}) : ni le délai de reprise ni la file ne sont "
            "connaissables, donc leur contrat n'est pas jugé. Rétablir "
            "`BUS_RECONNECT_SECONDS = float(os.environ.get(...))`, "
            "`BUS_QUEUE_SIZE = int(os.environ.get(...))` et un "
            "`MAX_STREAMS_TOTAL` numérique."
        )
        return

    cles = (BUS_RECONNEXION_KEY, BUS_FILE_KEY)
    # `deployes_bus` dit OÙ la valeur vit : `"secret"` (lisible seulement par
    # SSH) ou `"env"` (lisible via l'API). Un secret muet n'a pas de valeur
    # connaissable ; une entrée `[env]` VIDE, elle, laisse le défaut s'appliquer
    # (`os.environ.get(...) or défaut`) et se juge comme tel.
    muettes = [
        cle for cle in cles
        if deployes_bus.get(cle) == "secret" and not str(valeurs_bus.get(cle) or "").strip()
    ]
    if muettes:
        # Même angle mort que le battement : un secret se lit par SSH, absent en
        # CI. Le contrat lie les deux valeurs, donc aucun des deux n'est jugé.
        checked.append(
            f"  [AUCUN VERDICT] {', '.join(muettes)} DÉPLOYÉ(S) mais valeur(s) "
            "illisible(s) (SSH indisponible) — les deux délais du bus ne sont "
            "pas jugés"
        )
        return

    delai_defaut, file_defaut, flux_max = contrats_bus
    delai, origine_delai = _delai_effectif(
        deployes_bus, valeurs_bus, BUS_RECONNEXION_KEY, delai_defaut, libelle
    )
    if delai is None:
        errors.append(
            f"[{BUS_RECONNEXION_KEY}] valeur {libelle} ILLISIBLE : le délai de "
            "reprise n'est pas un nombre, donc la fenêtre que la file doit couvrir "
            "n'est pas calculable. Corriger ou retirer "
            f"(fly secrets unset {BUS_RECONNEXION_KEY})."
        )
        return
    file_bus, origine_file = _delai_effectif(
        deployes_bus, valeurs_bus, BUS_FILE_KEY, file_defaut, libelle
    )
    if file_bus is None:
        errors.append(
            f"[{BUS_FILE_KEY}] valeur {libelle} ILLISIBLE : une taille de file est "
            "un nombre ENTIER d'événements. Corriger ou retirer "
            f"(fly secrets unset {BUS_FILE_KEY})."
        )
        return
    if file_bus != int(file_bus):
        errors.append(
            f"[{BUS_FILE_KEY}] {file_bus:g} : une taille de file est un nombre "
            "ENTIER d'événements — une file décimale ne se crée pas."
        )
        return

    if delai <= 0:
        errors.append(
            f"[{BUS_RECONNEXION_KEY}] {delai:g} s ({origine_delai}) : une reprise "
            "sans répit republie en continu pendant une panne de Redis — journal "
            "saturé, et boucle partagée avec les flux SSE. "
            f"fly secrets unset {BUS_RECONNEXION_KEY} pour revenir au défaut."
        )
        return
    if delai < BUS_PLANCHER_S:
        errors.append(
            f"[{BUS_RECONNEXION_KEY}] {delai:g} s ({origine_delai}) sous le plancher "
            f"{BUS_PLANCHER_S:g} s : chaque tentative ratée coûte déjà un "
            "aller-retour, donc la pause est le seul frein de la boucle — en deçà, "
            "une panne devient un incendie de journal. "
            f"fly secrets unset {BUS_RECONNEXION_KEY} pour revenir au défaut."
        )
        return

    battement = _battement_effectif(battement_deploye, valeur_battement, contrats_serveur)
    if battement is None:
        checked.append(
            f"  [AUCUN VERDICT] borne haute de {BUS_RECONNEXION_KEY} non jugée : "
            "le battement réellement déployé est illisible (SSH indisponible)"
        )
    elif delai > battement:
        errors.append(
            f"[{BUS_RECONNEXION_KEY}] {delai:g} s ({origine_delai}) au-delà d'un "
            f"battement ({battement:g} s) : après un redémarrage de Redis, le "
            "process resterait sourd plusieurs battements — et ce qui est publié "
            "entre-temps n'est JAMAIS rejoué (le pub/sub n'a pas d'historique). "
            f"Ramener {BUS_RECONNEXION_KEY} sous le battement, ou retirer la "
            "surcharge."
        )
        return

    plancher_file = flux_max * delai * DEBIT_BUS_PAR_FLUX
    if file_bus < plancher_file:
        errors.append(
            f"[{BUS_FILE_KEY}] file de {file_bus:g} ({origine_file}) sous "
            f"{plancher_file:g} = {flux_max:g} flux × {delai:g} s × "
            f"{DEBIT_BUS_PAR_FLUX:g} évt/s : la rafale produite pendant UNE "
            "reconnexion déborderait le tampon, et le bus perdrait ces "
            "événements (`bus_stats()['perdus']`) — déjà absents des autres "
            "workers, sans rejeu. Les deux réglages se corrigent ENSEMBLE "
            f"({BUS_FILE_KEY} plus grand, ou {BUS_RECONNEXION_KEY} plus court)."
        )
        return

    borne_haute = (
        f"un battement ({battement:g} s)" if battement is not None else "un battement ILLISIBLE"
    )
    checked.append(
        f"  {OK} {BUS_RECONNEXION_KEY} = {delai:g} s ({origine_delai}) dans "
        f"[{BUS_PLANCHER_S:g} s, {borne_haute}] ; {BUS_FILE_KEY} = {file_bus:g} "
        f"({origine_file}) ≥ {plancher_file:g} = {flux_max:g} flux × {delai:g} s"
    )


# ── LE MÊME CONTRAT, JUGÉ HORS LIGNE ────────────────────────────────────────
# Le contrat n'était jugé qu'avec `FLY_API_TOKEN` : une PR qui pose une file
# trop petite, une reprise au-delà d'un battement, ou qui change un DÉFAUT de
# `kojo_live.py` de sorte que la relation ne tienne plus, partait verte et ne
# rougissait qu'après la fusion — sur `main`, une fois déployée. La règle est
# donc jugée une SECONDE fois SANS réseau, sur ce que le dépôt DÉCLARE et sur
# les défauts qu'il porte : c'est le verdict qu'une PR peut voir.
#
# Ce qui reste hors de portée est DÉCLARÉ, pas supposé : une surcharge posée en
# SECRET sur Fly (`fly secrets set KOJO_LIVE_BUS_QUEUE=…`) ne vit ni dans
# `fly.toml` ni dans la doc. Elle échappe donc à la passe hors ligne — et
# l'étape en ligne, qui lit les secrets déployés, la juge.
DECLARED_KEYS = (BUS_RECONNEXION_KEY, BUS_FILE_KEY, BATTEMENT_KEY)


def declarations_du_bus(chemin_toml=None, chemin_doc=None):
    """`(deployes, valeurs)` : les réglages du bus tels que le DÉPÔT les déclare.

    Deux sources, celles qui décrivent la PRODUCTION : la table `[env]` de
    `fly.toml` (config commitée) et le bloc `fly secrets set` de
    `DEPLOY_FLYIO.md` (la commande que l'exploitation copie). `deployes` porte
    la même forme que la passe en ligne (`"env"` / `"secret"`), pour que le
    JUGEMENT soit le même code.

    Une valeur VIDE ou un placeholder (`…`, `...`) n'est PAS une déclaration :
    le défaut du code s'applique, et c'est lui qui est jugé. Un secret
    documenté l'emporte sur `[env]` — sur Fly le secret écrase `[env]` au même
    nom, et c'est la valeur-là qui tournerait.

    `.env.example` n'est pas lu : c'est un template de DÉVELOPPEMENT, et y
    refuser une valeur locale serait un pré-vol plus sévère que la production.
    """
    chemin_toml = FLY_TOML if chemin_toml is None else chemin_toml
    chemin_doc = DEPLOY_DOC if chemin_doc is None else chemin_doc
    deployes, valeurs = {}, {}

    try:
        env = parse_fly_toml_env(Path(chemin_toml).read_text(encoding="utf-8"))
    except OSError:
        env = {}
    for cle in DECLARED_KEYS:
        # Une entrée `[env]` VIDE laisse le défaut s'appliquer au runtime
        # (`os.environ.get(...) or défaut`) : ce n'est pas une déclaration.
        if env.get(cle):
            deployes[cle] = "env"
            valeurs[cle] = env[cle]

    try:
        doc = Path(chemin_doc).read_text(encoding="utf-8")
    except OSError:
        doc = ""
    # TOUS les blocs `fly secrets set` de la doc, pas seulement le premier :
    # l'exploitation en ajoute au fil des fonctionnalités (webhook, Redis…), et
    # ne lire qu'un bloc rendrait aveugle à la déclaration de droite.
    for bloc in re.finditer(r"fly secrets set[\s\S]*?```", doc, re.I):
        for cle, valeur in re.findall(
            r"([A-Z][A-Z0-9_]{3,})[ \t]*=[ \t]*(\S*)", bloc.group(0)
        ):
            if cle not in DECLARED_KEYS:
                continue
            valeur = valeur.strip().strip("\"'").strip()
            if not valeur or "..." in valeur or "…" in valeur:
                continue  # placeholder ou vide : rien n'est déclaré
            deployes[cle] = "secret"
            valeurs[cle] = valeur

    return deployes, valeurs


def check_contrat_bus_hors_ligne(chemin_bus=None, chemin_toml=None, chemin_doc=None):
    """Le contrat des deux délais du bus, jugé SANS Fly — donc sur une PR.

    Le jugement n'est pas réécrit ici : `check_bus_contract` est appelé avec les
    DÉCLARATIONS du dépôt à la place des valeurs déployées, et le battement
    DÉCLARÉ (ou son défaut) comme borne haute. Une seconde implémentation
    divergerait au premier changement de borne — et c'est la copie qu'on ne
    retouche pas qui rendrait vert un contrat cassé.

    Ce que la passe publie toujours : la portée. Un vert hors ligne n'est pas un
    vert sur la machine, et le dire est ce qui empêche de confondre les deux.
    """
    contrats_bus = contrats_du_bus(chemin_bus)
    contrats_serveur = contrats_du_serveur(chemin_bus)
    if contrats_bus is None:
        # Le refus est prononcé par `check_bus_contract` (lecteurs cassés) :
        # le doubler ici n'ajouterait qu'une seconde ligne pour la même cause.
        check_bus_contract(False, "", contrats_serveur, None, {}, {},
                           libelle="DÉCLARÉE")
        return

    deployes, valeurs = declarations_du_bus(chemin_toml, chemin_doc)
    check_bus_contract(
        BATTEMENT_KEY in deployes, valeurs.get(BATTEMENT_KEY, ""),
        contrats_serveur, contrats_bus, deployes, valeurs, libelle="DÉCLARÉE",
    )
    checked.append(
        "  [DÉCLARÉ] contrat du bus jugé HORS LIGNE sur ce que le dépôt déclare "
        "(`fly.toml [env]`, bloc `fly secrets set` de DEPLOY_FLYIO.md) et les "
        "défauts lus dans kojo_live.py ; une surcharge posée en SECRET sur Fly "
        "n'est pas lisible ici — l'étape en ligne (FLY_API_TOKEN) la juge"
    )


# ── LE BATTEMENT, SON BAIL ET LE REPLI, JUGÉS HORS LIGNE EUX AUSSI ─────────
# Le contrat du bus a reçu sa passe hors ligne le 19/10/2026 ; les trois réglages
# de temps du flux, eux, n'étaient jugés QU'AVEC un jeton Fly. Une PR qui
# déclarait un battement de 30 s (fenêtre client de 45 s), qui changeait la
# formule du bail, ou qui alignait le repli du client sur les 30 s du sondage
# remplacé partait donc verte et ne rougissait qu'après la fusion, une fois
# déployée. Les trois se jugent pourtant SANS réseau : le battement est déclaré
# (`fly.toml [env]` ou bloc `fly secrets set` de la doc) ou prend le défaut lu
# dans `kojo_live.py`, le bail en DÉCOULE, et le repli vit dans le bundle (deux
# déclarations, une seule valeur). Le JUGEMENT est le MÊME que la passe en
# ligne : seule la source change, et le verdict la nomme (« DÉCLARÉ »).
#
# Ce qui reste hors de portée est DÉCLARÉ : une surcharge posée en SECRET sur
# Fly (`fly secrets set KOJO_SSE_HEARTBEAT_SECONDS=30`) ne vit ni dans
# `fly.toml` ni dans la doc — l'étape en ligne, qui la lit, la juge.

def check_temps_du_flux_hors_ligne(
    chemin_flux=None, chemin_bus=None, chemin_toml=None, chemin_doc=None,
    chemins_repli=None,
):
    """Le battement, son bail et le repli du client, jugés SANS Fly (une PR).

    Le jugement n'est pas réécrit ici : `check_heartbeat_contract`,
    `check_lease_contract` et `check_fallback_contract` sont appelés avec les
    DÉCLARATIONS du dépôt à la place des valeurs déployées, et les défauts LUS
    comme origine. Une seconde implémentation divergerait au premier changement
    de borne, et c'est la copie qu'on ne retouche pas qui rendrait vert un
    contrat cassé.

    Le bail est jugé sur le battement DÉCLARÉ, jamais sur le défaut seul :
    `PARTAGE_LEASE_SECONDS` se CALCULE depuis lui, donc une déclaration de 30 s
    allonge le bail à 90 s — et c'est cette machine-là que le contrat juge.

    Ce que la passe publie toujours : la portée. Un vert hors ligne n'est pas un
    vert sur la machine.
    """
    contrat_client = contrat_du_client(chemin_flux)
    contrats_serveur = contrats_du_serveur(chemin_bus)
    deployes, valeurs = declarations_du_bus(chemin_toml, chemin_doc)
    declare = BATTEMENT_KEY in deployes
    valeur = valeurs.get(BATTEMENT_KEY, "")
    check_heartbeat_contract(declare, valeur, contrat_client, libelle="DÉCLARÉ", libelle_valeur="DÉCLARÉE", source="par le dépôt")
    check_lease_contract(declare, valeur, contrat_client, contrats_serveur, libelle="DÉCLARÉ")
    repli, raison_repli = contrat_du_repli(chemins_repli)
    check_fallback_contract(repli, raison_repli)
    checked.append(
        "  [DÉCLARÉ] battement, bail et repli jugés HORS LIGNE sur ce que le dépôt "
        "déclare (`fly.toml [env]`, bloc `fly secrets set` de DEPLOY_FLYIO.md), les "
        "défauts lus dans kojo_live.py et les DEUX déclarations du repli ; une "
        "surcharge posée en SECRET sur Fly n'est pas lisible ici — l'étape en ligne "
        "(FLY_API_TOKEN) la juge"
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


def _auditer_references(contrat_bus_hors_ligne=False):
    """L'audit des RÉFÉRENCES du dépôt, gardé par la disponibilité des
    validateurs : appelé par le mode `--refs-only` ET par le check complet — les
    références s'auditent sans Fly, donc c'est le seul contrôle qui tourne sur un
    run sans jeton (une PR sans secret).

    `contrat_bus_hors_ligne` ajoute le contrat du bus, jugé SANS réseau sur les
    déclarations du dépôt. Le mode complet le passe à `False` : la passe en
    ligne juge les valeurs DÉPLOYÉES, qui sont la même chose plus autoritaires
    qu'une déclaration — deux verdicts pour une seule machine ne feraient que
    doubler les lignes (et les refus).

    Une seule implémentation de cette garde : deux copies divergeraient sur ce
    qu'est « validateurs indisponibles », et celle qui ne remplirait pas `errors`
    rendrait un vert VIDE au lieu d'un refus — le garde aurait l'air de vérifier
    ce qu'il n'a pas lu.
    """
    if _VALIDATORS_OK:
        check_reference_formats()
    else:
        errors.append(f"Validateurs indisponibles : {_VALIDATORS_ERR}")
    if contrat_bus_hors_ligne:
        # Les trois réglages de temps du flux d'abord (le battement porte le
        # bail), puis les deux délais du bus : deux contrats distincts, deux
        # verdicts nommés, un seul passage hors ligne.
        check_temps_du_flux_hors_ligne()
        check_contrat_bus_hors_ligne()


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
        # de référence SANS token ni réseau. Le contrat du bus est jugé ICI
        # aussi : c'est le seul passage qu'une PR voit avant le déploiement.
        _auditer_references(contrat_bus_hors_ligne=True)
        return _rapport(
            f"Audit des RÉFÉRENCES du dépôt (formats + battement/bail/repli + "
            f"contrat du bus, mode --refs-only, app={FLY_APP}) :",
            "divergence(s) de format dans les références ou de contrat des délais "
            "du flux et du bus",
            "[OK] formats des références, délais du flux et contrat du bus "
            "conformes (hors ligne).",
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

    # 4e) BATTEMENT DE CŒUR DÉPLOYÉ : la seule valeur que les gardes hors ligne
    # ne voient pas. La surcharge vit en secret Fly (ou, à tort, dans [env]) :
    # on la lit là où elle est, puis on la juge contre la fenêtre du CLIENT.
    deploye = BATTEMENT_KEY in fly_secrets or BATTEMENT_KEY in live_env
    valeur_battement = live_env.get(BATTEMENT_KEY, "")
    if deploye and not valeur_battement and BATTEMENT_KEY in fly_secrets:
        valeur_battement = read_secrets_via_ssh([BATTEMENT_KEY]).get(BATTEMENT_KEY, "")
    contrat_client = contrat_du_client()
    check_heartbeat_contract(deploye, valeur_battement, contrat_client)

    # 4f) LES AUTRES RÉGLAGES DE TEMPS DU FLUX : le bail du registre Redis
    # (CALCULÉ depuis le battement, donc jamais une clé Fly à lire) et le repli
    # du client (une valeur du bundle, pas de la machine). Chacun a son contrat,
    # et aucun des deux n'était jugé : un bail trop court expire une place
    # vivante, un bail trop long garde les places d'un worker mort, un repli
    # aussi bavard que le sondage remplacé annule le remplacement.
    contrats_serveur = contrats_du_serveur()
    check_lease_contract(deploye, valeur_battement, contrat_client, contrats_serveur)
    valeur_repli, raison_repli = contrat_du_repli()
    check_fallback_contract(valeur_repli, raison_repli)

    # 4g) LES DEUX DÉLAIS DU BUS, jugés ENSEMBLE : le délai de reprise décide
    # combien de temps le process reste sourd, la file de publication doit
    # encaisser ce que cette fenêtre produit. Leurs valeurs se lisent là où
    # elles vivent (runtime [env], secret par SSH), ou à défaut dans le code.
    bus_keys = (BUS_RECONNEXION_KEY, BUS_FILE_KEY)
    deployes_bus = {
        cle: ("secret" if cle in fly_secrets else "env" if cle in live_env else None)
        for cle in bus_keys
    }
    valeurs_bus = {cle: live_env.get(cle, "") for cle in bus_keys}
    muettes = [
        cle for cle in bus_keys if deployes_bus[cle] == "secret" and not valeurs_bus[cle]
    ]
    if muettes:
        valeurs_bus.update(read_secrets_via_ssh(muettes))
    check_bus_contract(
        deploye, valeur_battement, contrats_serveur,
        contrats_du_bus(), deployes_bus, valeurs_bus,
    )

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