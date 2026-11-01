# -*- coding: utf-8 -*-
"""Configuration centrale de Kojo : environnement, logging, secrets,
constantes et en-têtes de sécurité."""

import logging
import logging.handlers
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
import cloudinary

# LA RECONFIGURATION DES FLUX PASSE EN PREMIER, AVANT TOUT `print`.
#
# Elle vivait plus bas, juste après l'avertissement pywebpush — donc le premier
# message du module s'imprimait dans l'encodage de la CONSOLE (cp1252 sur un
# Windows redirecté), pas dans celui que le module venait d'installer. Mesuré le
# 01/11/2026 : `PYTHONIOENCODING=cp1252` + pywebpush absent rendent l'import
# impossible (`UnicodeEncodeError: 'charmap' codec can't encode character
# '\u26a0'`), donc les 2 399 tests tombent en erreur de collecte sur une machine
# où le paquet n'est pas installé — la CI, dont les captures sont en UTF-8, ne le
# voit jamais. Un module importé par tout le backend ne peut pas dépendre de
# l'encodage du terminal qui l'importe.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _avertir(texte):
    """Avertissement de DÉMARRAGE : il ne doit JAMAIS empêcher l'import.

    La reconfiguration ci-dessus couvre le cas courant, mais elle peut échouer
    (`stream` sans `reconfigure`, sortie remplacée par un harnais) — et un
    caractère hors de l'encodage de la console lève alors `UnicodeEncodeError`
    AVANT que le journal existe. Le repli ASCII perd une icône, jamais le
    démarrage : c'est le seul comportement acceptable pour un message qui
    s'imprime avant que quoi que ce soit soit configurable.
    """
    try:
        print(texte)
    except UnicodeEncodeError:
        print(texte.encode("ascii", "replace").decode("ascii"))


# Web Push (VAPID) - Sans Firebase
# Détection de disponibilité SANS importer de noms inutilisés (l'usage réel
# de pywebpush vit dans kojo_shared.py). find_spec évite un ImportError au
# module importé mais jamais utilisé ici.
try:
    import importlib.util as _importlib_util
    WEBPUSH_AVAILABLE = _importlib_util.find_spec("pywebpush") is not None
except Exception:
    WEBPUSH_AVAILABLE = False
if not WEBPUSH_AVAILABLE:
    # logger n'est pas encore initialisé ici — on utilise _avertir()
    # Le message sera répété via logger une fois le logging configuré.
    _avertir("⚠️ pywebpush non installé - notifications push désactivées")

# Journal rotatif : chemin ABSOLU, JAMAIS dans l'arbre du dépôt.
#
# Le chemin était relatif (`'kojo_backend.log'`), donc résolu contre le
# répertoire courant : lancé depuis backend/ il déposait 10 Mo × 6 dans l'arbre
# du dépôt, et une suite de tests en laissait un de plus à chaque exécution
# (constaté le 19/09/2026 : 3,5 Mo dans backend/ et 178 Ko à la racine). Un
# fichier de journal n'est pas un livrable, et rien ici ne le relit : `fly logs`
# lit la sortie standard.
#
# KOJO_LOG_FILE décide, sinon le répertoire temporaire du système (hors dépôt) :
#   KOJO_LOG_FILE non défini (auto) → temporaire du système, rien sous pytest
#   KOJO_LOG_FILE=/chemin/absolu   → ce fichier (valeur explicite, même en test)
#   KOJO_LOG_FILE=stdout|off|0|""  → aucun fichier, sortie standard seule
#
# Sous pytest, "auto" désactive le fichier : la suite n'écrit plus rien, et un
# verrou Windows laissé par un RotatingFileHandler tué ne peut plus bloquer le
# run suivant (constaté le 19/09/2026 : 83 s → 496 s).
_VALEURS_SANS_FICHIER = ("", "0", "off", "false", "none", "stdout")


def chemin_du_journal(environ=None, en_test=None):
    """Chemin ABSOLU du journal rotatif, ou None si l'écriture fichier est
    désactivée. Le résultat ne dépend PAS du répertoire courant — c'est
    exactement ce qui déposait des dizaines de mégaoctets dans l'arbre.

    `environ` et `en_test` sont injectables pour que la règle soit vérifiable
    sans manipuler l'environnement du processus ni l'état de `sys.modules`.
    """
    environ = os.environ if environ is None else environ
    if en_test is None:
        en_test = "pytest" in sys.modules
    # La variable est lue par son NOM littéral : c'est la forme que
    # `.github/scripts/check-fly-env-drift.py` sait reconnaître comme optionnelle
    # (défaut de repli non vide), et elle se lit sans détour.
    brut = str(environ.get("KOJO_LOG_FILE", "auto")).strip()
    if brut.lower() in _VALEURS_SANS_FICHIER:
        return None
    if brut.lower() == "auto":
        if en_test:
            return None
        return Path(tempfile.gettempdir()).resolve() / "kojo" / "kojo_backend.log"
    return Path(brut).expanduser().resolve()


def _handlers_de_journal(chemin):
    """Les sorties de journalisation. Une destination non inscriptible ne doit
    JAMAIS empêcher le démarrage : on retombe alors sur la sortie standard."""
    handlers = [logging.StreamHandler(sys.stdout)]
    if chemin is None:
        return handlers
    try:
        chemin.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.handlers.RotatingFileHandler(
            str(chemin),
            maxBytes=10*1024*1024,
            backupCount=5,
            encoding='utf-8'
        ))
    except OSError as exc:
        _avertir("⚠️ journal fichier indisponible (%s) — sortie standard seule" % exc)
    return handlers


# Résolu une fois, au chargement : ce que le processus écrit réellement.
JOURNAL_FILE = chemin_du_journal()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=_handlers_de_journal(JOURNAL_FILE),
)
logger = logging.getLogger("kojo_backend")

# Maintenant que le logger est prêt, on peut réémettre le warning pywebpush
if not WEBPUSH_AVAILABLE:
    logger.warning("⚠️ pywebpush non installé - notifications push désactivées")

# Silence noisy /favicon.ico (and other junk) requests from uvicorn's access
# log entirely - browsers, bots and health checks hit this path constantly
# even though this backend has no favicon to serve, and it clutters the logs.
class _IgnoreNoisyPathsFilter(logging.Filter):
    _IGNORED_SUBSTRINGS = ("/favicon.ico",)

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not any(path in message for path in self._IGNORED_SUBSTRINGS)

logging.getLogger("uvicorn.access").addFilter(_IgnoreNoisyPathsFilter())

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
cloudinary.config(secure=True)



APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()

# Version de l'API — source unique de vérité : health checks (/health,
# /api/health) et en-tête X-Kojo-Version. À bumper ensemble, jamais ailleurs.
# 1.0.2 : modèle User étendu (skills/bio exposés par /auth/me, PR #3).
APP_VERSION = "1.0.2"

# RÉVISION SERVIE — la réponse à « quel commit tourne réellement ? ».
#
# Pourquoi une seconde donnée, alors qu'APP_VERSION existe déjà : APP_VERSION est
# une version PRODUIT, bumpée à la main quand on y pense ; elle ne dit donc jamais
# si le backend servi correspond au commit poussé. Un `main` vert pouvait signifier
# deux choses opposées (« le backend déployé est celui de ce commit » et « le
# déploiement a été sauté, le service tourne la version précédente ») sans qu'aucun
# job ne puisse les distinguer.
#
# La valeur est INJECTÉE AU BUILD (`--build-arg KOJO_GIT_SHA=<sha>`, cf.
# backend/Dockerfile et le job deploy-fly) : elle décrit l'image, pas le runtime,
# donc elle ne peut pas mentir sur ce qui a été construit. Vide en local et dans
# les tests (aucune image n'a été construite) → « inconnue » est publié, et le
# garde backend/scripts/check_deployed_revision.py refuse cette réponse : c'est
# exactement le cas « le service servi n'est pas traçable ».
APP_REVISION = os.environ.get("KOJO_GIT_SHA", "").strip()

_env_jwt_secret = os.environ.get('JWT_SECRET', '').strip()

if _env_jwt_secret:
    JWT_SECRET = _env_jwt_secret
elif APP_ENV in ("production", "prod"):
    # Fail fast and loud rather than silently issuing tokens that won't
    # validate after the next restart or on a different worker.
    raise RuntimeError(
        "JWT_SECRET environment variable is not set. Refusing to start in "
        "production with an auto-generated secret, since that would silently "
        "invalidate all user sessions on every restart/deploy and break auth "
        "across multiple worker processes. Set JWT_SECRET on Fly.io (a long "
        "random string) and redeploy."
    )
else:
    # Local/dev only: stable fallback so tokens survive local restarts.
    JWT_SECRET = 'kojo-dev-only-insecure-secret-do-not-use-in-prod'
    logger.warning(
        "⚠️ JWT_SECRET not set - using an insecure fixed dev secret. "
        "This is only acceptable outside production (APP_ENV=%s).", APP_ENV
    )

JWT_ALGORITHM = "HS256"

JWT_EXPIRATION_HOURS = 24

# --- Durées de conservation des données ---------------------------------
# Ces deux durées vivaient en clair, chacune à un seul endroit : 90 jours dans
# l'index TTL de kojo_core, 48 h dans le corps de la création d'un paiement.
# Elles sont nommées ici pour que kojo_retention.py les CITE au lieu de les
# recopier, et que la politique publiée (PRIVACY.md) en dérive au lieu de
# répéter un chiffre que personne ne relirait. Voir kojo_retention.py.
NOTIFICATION_RETENTION_DAYS = 90

# Délai laissé à un checkout resté `pending` (client parti, IPN perdu) avant
# que l'index TTL partiel ne supprime le document.
PAYMENT_PENDING_EXPIRY_HOURS = 48

# Compte SUPPRIMÉ : la suppression n'efface pas le document, elle l'ANONYMISE
# (les paiements le référencent, cf. kojo_routers_users). Il doit donc finir par
# disparaître au lieu de rester indéfiniment. Le délai court à partir de la
# suppression et couvre la fenêtre où un litige de paiement ou une réclamation
# peut encore désigner ce compte par son identifiant interne.
DELETED_ACCOUNT_RETENTION_DAYS = 90

# Ticket support : nom, téléphone, email et message en TEXTE LIBRE — le
# document le plus identifiant du dépôt, et celui dont personne ne relit la
# valeur. Le délai court à partir de la CRÉATION (un ticket jamais traité doit
# disparaître comme les autres, sinon la collection n'est bornée par rien).
SUPPORT_TICKET_RETENTION_DAYS = 365

# Message : il appartient aux DEUX parties d'une mission, donc il survit à la
# suppression d'un compte et sert de trace quand un désaccord arrive longtemps
# après la mission. Le délai court à partir de l'envoi.
MESSAGE_RETENTION_DAYS = 730

# Fait de livraison d'un email (rebond, plainte, livraison réussie) : c'est une
# TRACE de diagnostic — « pourquoi cette personne n'a-t-elle rien reçu ? » —
# et elle porte l'adresse du destinataire. Elle est donc bornée : ce qui
# gouverne durablement l'envoi n'est pas le journal, c'est la suppression
# (`email_suppressions`), qui ne périme pas et se lève sur décision.
EMAIL_DELIVERY_EVENT_RETENTION_DAYS = 90

# Fréquence du passage de purge (minutes). L'index TTL reste la garantie de
# fond ; ce balayage applique les mêmes règles côté application et les rend
# observables. Une fois par jour suffit largement.
RETENTION_SWEEP_INTERVAL_MINUTES = int(os.environ.get('RETENTION_SWEEP_INTERVAL_MINUTES', '1440'))

# Fréquence de l'auto-alerte du fournisseur email ACTIF (minutes) : le backend
# juge lui-même, avec la sonde de `/monitor/email`, le fournisseur qu'un envoi
# utiliserait MAINTENANT, et prévient le propriétaire UNE SEULE FOIS PAR PANNE
# (kojo_scheduler.email_provider_auto_alert_once). Quinze minutes : assez court
# pour qu'une clé révoquée soit vue avant que les utilisateurs réclament leur
# code, assez long pour ne pas marteler l'API du fournisseur (la sonde a déjà
# son cache TTL de 60 s). Ce réglage ne remplace PAS la sonde externe du dépôt
# (`backend/scripts/check_health_probe.py`, cron 06:30) : il la double.
EMAIL_HEALTH_ALERT_INTERVAL_MINUTES = int(os.environ.get('EMAIL_HEALTH_ALERT_INTERVAL_MINUTES', '15'))

# Fréquence du résumé d'alertes emploi (minutes). Une heure : c'est un RÉSUMÉ
# (kojo_job_alerts.passage_digest), pas un envoi par publication — dix missions
# dans l'heure font un email, et une veille qui écrirait à chaque annonce serait
# indiscernable d'un spam. Le bail `job_alert_digest` empêche N machines Fly de
# résumer N fois.
JOB_ALERT_DIGEST_INTERVAL_MINUTES = int(os.environ.get('JOB_ALERT_DIGEST_INTERVAL_MINUTES', '60'))

# --- Vérification email (OTP) ---
_env_email_otp_secret = os.environ.get('EMAIL_OTP_SECRET', '').strip()
if _env_email_otp_secret:
    EMAIL_OTP_SECRET = _env_email_otp_secret
elif APP_ENV in ("production", "prod"):
    # Fail fast en prod : les jetons de vérification email ne doivent pas
    # dépendre d'une clé partagée/fallback silencieux qui changerait selon
    # la configuration JWT d'un environnement à l'autre.
    raise RuntimeError(
        "EMAIL_OTP_SECRET environment variable is not set. Refusing to start "
        "in production because email-verification tokens would otherwise rely "
        "on a silent fallback. Set EMAIL_OTP_SECRET on Fly.io and redeploy."
    )
else:
    # Dev/local uniquement : fallback stable sur JWT_SECRET pour survivre aux
    # redémarrages locaux (comportement historique conservé hors prod).
    EMAIL_OTP_SECRET = JWT_SECRET
    logger.warning(
        "⚠️ EMAIL_OTP_SECRET not set - falling back to JWT_SECRET. "
        "This is only acceptable outside production (APP_ENV=%s).", APP_ENV
    )
EMAIL_OTP_EXPIRY_MINUTES = int(os.environ.get('EMAIL_OTP_EXPIRY_MINUTES', '10'))

EMAIL_OTP_MAX_ATTEMPTS = int(os.environ.get('EMAIL_OTP_MAX_ATTEMPTS', '5'))

PAYMENT_COMMISSION_RATE = float(os.environ.get('PAYMENT_COMMISSION_RATE', '0.14'))

# --- Séquestre à DEUX TEMPS (`kojo_job_completion.py`) ---
# Le travailleur déclare la mission terminée (note + photos), le client valide,
# et à défaut de validation le séquestre est libéré AUTOMATIQUEMENT après ce
# délai. Sans lui, un client injoignable laissait le travailleur impayé
# indéfiniment : le seul chemin de libération était un clic du client.
# Le seuil se LIT ici (et se surcharge par variable d'environnement) ; il n'est
# recopié nulle part ailleurs.
COMPLETION_AUTO_RELEASE_DAYS = int(os.environ.get('COMPLETION_AUTO_RELEASE_DAYS', '7'))
COMPLETION_SWEEP_INTERVAL_MINUTES = int(
    os.environ.get('COMPLETION_SWEEP_INTERVAL_MINUTES', '60')
)

if COMPLETION_AUTO_RELEASE_DAYS < 1:
    raise RuntimeError(
        f"COMPLETION_AUTO_RELEASE_DAYS={COMPLETION_AUTO_RELEASE_DAYS} : un délai "
        "nul ou négatif libérerait le séquestre avant que le client puisse "
        "valider. La borne basse est 1 jour."
    )
if not 1 <= COMPLETION_SWEEP_INTERVAL_MINUTES <= 1440:
    raise RuntimeError(
        f"COMPLETION_SWEEP_INTERVAL_MINUTES={COMPLETION_SWEEP_INTERVAL_MINUTES} : "
        "le balayage doit tourner au moins une fois par jour (1..1440 minutes)."
    )

# --- Litige tracé (`kojo_job_disputes.py`) ---
# Un désaccord entre le client et le travailleur a désormais un ÉTAT, une
# ÉCHÉANCE et une DÉCISION du propriétaire, au lieu d'un ticket support sans
# trace. Tant qu'un litige est OUVERT, l'argent ne part pas : ni la validation
# du client, ni la libération automatique ne le versent, sinon la contestation
# ne protégerait rien. L'échéance est la FENÊTRE D'ARBITRAGE : passée sans
# décision, le désaccord se referme et la règle ordinaire reprend (le silence
# prolongé favorise le travailleur, comme `COMPLETION_AUTO_RELEASE_DAYS`) —
# une fenêtre sans conséquence serait une fenêtre décorative.
LITIGE_DECISION_DAYS = int(os.environ.get('LITIGE_DECISION_DAYS', '5'))
LITIGE_SWEEP_INTERVAL_MINUTES = int(
    os.environ.get('LITIGE_SWEEP_INTERVAL_MINUTES', '60')
)

if LITIGE_DECISION_DAYS < 1:
    raise RuntimeError(
        f"LITIGE_DECISION_DAYS={LITIGE_DECISION_DAYS} : une fenêtre d'arbitrage "
        "nulle ou négative refermerait le litige avant que le propriétaire "
        "puisse le lire. La borne basse est 1 jour."
    )
if not 1 <= LITIGE_SWEEP_INTERVAL_MINUTES <= 1440:
    raise RuntimeError(
        f"LITIGE_SWEEP_INTERVAL_MINUTES={LITIGE_SWEEP_INTERVAL_MINUTES} : "
        "le balayage des échéances doit tourner au moins une fois par jour "
        "(1..1440 minutes)."
    )

# --- Alerte « litiges tranchés SANS réponse » (kojo_scheduler) ---
# La file d'arbitrage dit ce qui reste à faire ; elle ne dit pas si l'arbitre
# tranche SANS avoir lu l'autre partie. `mesures_arbitrage` publie ce chiffre à
# la demande, dans la file — mais personne ne le regarde s'il ne vient pas à
# lui. Ce passage compare la part sur une FENÊTRE GLISSANTE au seuil ci-dessous
# et prévient le propriétaire UNE FOIS PAR DÉPASSEMENT (le retour sous le seuil
# réarme, comme le rétablissement du fournisseur email).
#
# Fenêtre 90 jours : sous le PLANCHER de mesure (10 décisions) un taux n'est
# pas publié, et un marché qui tranche quelques litiges par mois atteindrait
# rarement ce plancher sur 30 jours — mesurer sur 90 évite de publier « trop peu
# de litiges » à perpétuité. Le seuil est une PART (0..1), pas un pourcentage.
LITIGE_SANS_REPONSE_SEUIL = float(os.environ.get('LITIGE_SANS_REPONSE_SEUIL', '0.5'))
LITIGE_SANS_REPONSE_FENETRE_JOURS = int(
    os.environ.get('LITIGE_SANS_REPONSE_FENETRE_JOURS', '90')
)
# Fréquence du jugement (minutes). Quotidien : un arbitrage ne change pas
# d'heure en heure, et le passage relit l'historique des décisions.
LITIGE_ALERTE_INTERVAL_MINUTES = int(
    os.environ.get('LITIGE_ALERTE_INTERVAL_MINUTES', '1440')
)

if not 0 < LITIGE_SANS_REPONSE_SEUIL < 1:
    raise RuntimeError(
        f"LITIGE_SANS_REPONSE_SEUIL={LITIGE_SANS_REPONSE_SEUIL} : le seuil est "
        "une PART strictement entre 0 et 1. À 1 il ne serait jamais dépassé "
        "(une alerte qui ne peut pas partir), à 0 il partirait sur la première "
        "décision un peu malheureuse."
    )
if not 1 <= LITIGE_SANS_REPONSE_FENETRE_JOURS <= 3650:
    raise RuntimeError(
        f"LITIGE_SANS_REPONSE_FENETRE_JOURS={LITIGE_SANS_REPONSE_FENETRE_JOURS} : "
        "la fenêtre doit couvrir au moins un jour et au plus dix ans."
    )
if not 1 <= LITIGE_ALERTE_INTERVAL_MINUTES <= 1440:
    raise RuntimeError(
        f"LITIGE_ALERTE_INTERVAL_MINUTES={LITIGE_ALERTE_INTERVAL_MINUTES} : "
        "le jugement doit tourner au moins une fois par jour (1..1440 minutes)."
    )

# --- Alerte « place de marché VIDE » (kojo_scheduler) ---
# Le 23/10/2026 la production comptait ZÉRO mission ouverte sans qu'aucun
# tableau de bord ne le dise : les sondes de SEO ont rendu des PRÉMISSES pendant
# onze jours, et le chiffre ne vivait que sur `/metrics` — que personne n'ouvre.
# Une place de marché qui ne publie plus rien est un incident d'exploitation, au
# même titre qu'un fournisseur email muet ; il doit venir au propriétaire.
#
# La mesure est une DURÉE, pas un instant : un marché peut rester vide une heure
# entre deux missions sans que rien ne soit cassé, et une alerte qui partirait
# là s'apprendrait à être ignorée (le rouge permanent de F9).
# `MARCHE_VIDE_ALERTE_HEURES` borne donc la CONTINUITÉ du vide, mesurée depuis
# `vide_depuis` — un état EN BASE, pour qu'un redémarrage ou un déploiement ne
# remette pas le chronomètre à zéro (sinon une instance redéployée chaque jour
# ne franchirait jamais le seuil).
#
# Défaut 24 h : le temps qu'un jour ouvré passe, et exactement la durée que
# `METRIQUES.md` annonce pour l'alerte de la jauge `kojo_missions_ouvertes`.
# 0 n'est pas accepté : taire l'alerte se fait en réglant une durée longue, pas
# en l'éteignant d'un zéro dont personne ne se souviendrait.
MARCHE_VIDE_ALERTE_HEURES = int(os.environ.get('MARCHE_VIDE_ALERTE_HEURES', '24'))
MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES = int(
    os.environ.get('MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES', '60')
)

if not 1 <= MARCHE_VIDE_ALERTE_HEURES <= 720:
    raise RuntimeError(
        f"MARCHE_VIDE_ALERTE_HEURES={MARCHE_VIDE_ALERTE_HEURES} : la durée doit "
        "couvrir au moins une heure et au plus trente jours (1..720). À 0 "
        "l'alerte ne pourrait pas partir, et une alerte qui ne peut pas partir "
        "n'existe pas."
    )
if not 1 <= MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES <= 1440:
    raise RuntimeError(
        f"MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES={MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES} "
        ": le jugement doit tourner au moins une fois par jour (1..1440 minutes)."
    )

# --- Alerte « missions ouvertes SANS AUCUNE proposition » (kojo_scheduler) ---
# L'alerte « marché vide » dit que l'OFFRE a disparu ; celle-ci dit que l'offre
# est là et que PERSONNE n'a répondu. Une mission publiée depuis trois jours sans
# une seule candidature n'est pas un détail : elle est mal datée, trop chère,
# invisible — ou dans une ville où aucun travailleur n'est inscrit. Ce sont
# quatre corrections différentes, et aucune n'est visible sur un tableau de bord
# qui ne compte que des missions.
#
# Le seuil est une ANCIENNETÉ (jours) : en dessous, une mission sans proposition
# est une mission qui vient de paraître. 1..90 jours.
MISSIONS_SANS_PROPOSITION_JOURS = int(
    os.environ.get('MISSIONS_SANS_PROPOSITION_JOURS', '3')
)
# Cadence du jugement (minutes). Toutes les six heures : la file grossit lentement,
# et relire les propositions plus souvent ne changerait rien.
MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES = int(
    os.environ.get('MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES', '360')
)

if not 1 <= MISSIONS_SANS_PROPOSITION_JOURS <= 90:
    raise RuntimeError(
        f"MISSIONS_SANS_PROPOSITION_JOURS={MISSIONS_SANS_PROPOSITION_JOURS} : "
        "l'ancienneté doit couvrir au moins un jour et au plus 90 jours. À 0, "
        "toute mission publiée à l'instant serait déjà « sans réponse »."
    )
if not 1 <= MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES <= 1440:
    raise RuntimeError(
        f"MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES="
        f"{MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES} : le jugement doit "
        "tourner au moins une fois par jour (1..1440 minutes)."
    )

# --- Relance du CLIENT dont la mission ne reçoit aucune candidature ---
# L'alerte propriétaire dit que la place ne se remplit pas ; celle-ci parle à la
# seule personne qui peut corriger CETTE mission : son client (prix, date,
# quartier). Quelques HEURES, pas trois jours : passé une nuit sans candidature,
# la mission est encore visible et corrigeable ; à trois jours, la relance
# arrive sur une annonce morte. Une relance par mission, marquée sur la mission.
# 1..168 heures (une semaine).
CLIENT_SANS_PROPOSITION_HEURES = int(
    os.environ.get('CLIENT_SANS_PROPOSITION_HEURES', '6')
)
# Cadence du jugement (minutes) : toutes les heures, une mission peut franchir
# le seuil à tout moment et le client doit l'apprendre le jour même.
CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES = int(
    os.environ.get('CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES', '60')
)

if not 1 <= CLIENT_SANS_PROPOSITION_HEURES <= 168:
    raise RuntimeError(
        f"CLIENT_SANS_PROPOSITION_HEURES={CLIENT_SANS_PROPOSITION_HEURES} : le "
        "seuil doit couvrir au moins une heure et au plus une semaine "
        "(1..168). À 0, toute mission publiée à l'instant relancerait son "
        "client."
    )
if not 1 <= CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES <= 1440:
    raise RuntimeError(
        f"CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES="
        f"{CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES} : le jugement doit "
        "tourner au moins une fois par jour (1..1440 minutes)."
    )

# Récompense de parrainage (FCFA) créditée quand le filleul termine sa
# PREMIÈRE mission : une part au parrain, une part au filleul.
REFERRAL_SPONSOR_REWARD = float(os.environ.get('REFERRAL_SPONSOR_REWARD', '500'))
REFERRAL_FILLEUL_REWARD = float(os.environ.get('REFERRAL_FILLEUL_REWARD', '500'))

# Bonus de BIENVENUE (FCFA) crédité dès l'inscription quand le code de
# parrainage est appliqué : une part au parrain, une part à l'invité.
REFERRAL_WELCOME_SPONSOR_REWARD = float(os.environ.get('REFERRAL_WELCOME_SPONSOR_REWARD', '250'))
REFERRAL_WELCOME_FILLEUL_REWARD = float(os.environ.get('REFERRAL_WELCOME_FILLEUL_REWARD', '250'))

# --- Session par cookie httpOnly (auth web, protection XSS) ---
# Le JWT vit dans un cookie httpOnly (invisible pour JavaScript) en plus du
# mode historique "Authorization: Bearer" (mobile/Capacitor, intégrations).
# Le frontend web (Vercel) appelle le backend (Fly) en CROSS-SITE : un cookie
# cross-site exige SameSite=None + Secure. En dev local (même origine
# localhost), SameSite=Lax suffit et fonctionne en HTTP.
_IS_PROD_ENV = APP_ENV in ("production", "prod")

# --- Rate-limiter partagé : Redis obligatoire dès qu'il y a plusieurs workers ---
# Sans Redis, le rate-limit vit dans la mémoire de chaque process : avec
# WEB_CONCURRENCY > 1 (Dockerfile : `uvicorn --workers`), chaque limite est
# multipliée par N et n'est jamais partagée. Une limite fausse est une garantie
# fausse, donc en production on refuse de démarrer plutôt que de la servir.
# Hors prod, le fallback mémoire reste le comportement de développement.
WEB_CONCURRENCY = int((os.environ.get('WEB_CONCURRENCY', '1') or '1').strip())

if _IS_PROD_ENV and WEB_CONCURRENCY > 1 and not os.environ.get('REDIS_URL', '').strip():
    raise RuntimeError(
        f"WEB_CONCURRENCY={WEB_CONCURRENCY} sans REDIS_URL en production : le "
        "rate-limiting serait en mémoire par process, donc multiplié par "
        "WEB_CONCURRENCY et non partagé. Définir REDIS_URL (rediss://) ou "
        "ramener WEB_CONCURRENCY à 1, puis redéployer."
    )

AUTH_COOKIE_NAME = os.environ.get('AUTH_COOKIE_NAME', 'kojo_session').strip()

CSRF_COOKIE_NAME = os.environ.get('CSRF_COOKIE_NAME', 'kojo_csrf').strip()

AUTH_COOKIE_SAMESITE = os.environ.get(
    'AUTH_COOKIE_SAMESITE', 'none' if _IS_PROD_ENV else 'lax'
).strip().lower()

AUTH_COOKIE_SECURE = os.environ.get(
    'AUTH_COOKIE_SECURE', 'true' if _IS_PROD_ENV else 'false'
).strip().lower() in {'1', 'true', 'yes', 'on'}

# Durée du cookie alignée sur le JWT (24h) : le cookie expire avec le token.
AUTH_COOKIE_MAX_AGE = JWT_EXPIRATION_HOURS * 3600

# --- Sweeper des décaissements bloqués (tâche de fond, kojo_scheduler) ---
# Un versement/remboursement resté incertain (releasing/refunding — l'IPN n'a
# pas tranché) au-delà de ce seuil déclenche une alerte au propriétaire.
PAYOUT_ALERT_THRESHOLD_HOURS = float(os.environ.get('PAYOUT_ALERT_THRESHOLD_HOURS', '24'))

# Rotation à fenêtre glissante du jeton de session : /auth/me émet un jeton
# frais quand il reste moins de ce seuil (secondes) avant expiration (défaut
# 6 h = 25 % de la fenêtre de 24 h) — l'utilisateur actif n'est plus
# déconnecté chaque 24 h. Borne la frappe de jetons : ~1 rotation par session
# et par jour.
AUTH_TOKEN_ROTATION_THRESHOLD_SECONDS = int(os.environ.get('AUTH_TOKEN_ROTATION_THRESHOLD_SECONDS', str(6 * 3600)))

# Escalade : après la première alerte (24 h), un rappel est renvoyé si le
# décaissement est TOUJOURS bloqué au-delà de ce délai (PayDunya injoignable
# plusieurs jours ne doit pas rester silencieux). owner_payout_alerted_at est
# décalé à chaque rappel → rappel périodique espacé, pas de spam.
PAYOUT_ALERT_REMINDER_DAYS = int(os.environ.get('PAYOUT_ALERT_REMINDER_DAYS', '3'))

# Fréquence du passage de re-vérification PayDunya (minutes).
PAYOUT_SWEEPER_INTERVAL_MINUTES = int(os.environ.get('PAYOUT_SWEEPER_INTERVAL_MINUTES', '60'))

# --- Circuit breaker GLOBAL PayDunya ---
# Si l'API PayDunya devient injoignable (échecs RÉSEAU consécutifs : timeout,
# connexion refusée, réponse non-JSON), le circuit s'ouvre : tous les appels
# sortants échouent IMMÉDIATEMENT (fail fast) pendant la période de repos, au
# lieu de marteler une API down avec des timeouts de 30 s. Protège tous les
# flux : checkout (création de facture), re-vérification des décaissements
# (sweeper + polling /payments/status), IPN disburse, remboursements et
# retraits. Un échec MÉTIER (response_code != '00', ex. montant refusé)
# n'ouvre PAS le circuit : c'est un refus de la requête, pas une panne.
PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get('PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD', '5'))
PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS = int(os.environ.get('PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS', str(2 * 3600)))

# --- Google Sign-In (SSO) ---
# Flux serveur : le frontend reçoit un code d'autorisation Google (PKCE) et
# le backend l'échange contre un id_token, dont il vérifie la signature et
# l'audience (client_id). GOOGLE_CLIENT_ID est aussi utilisé côté frontend
# (bouton Google Identity Services).
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '').strip()

GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '').strip()

# URL de callback déclarée dans la console Google Cloud (OAuth 2.0 Client IDs).
# Pour Vercel : https://kojoforafrica.cc.cd/auth/google/callback
# Pour le dev local : http://localhost:3000/auth/google/callback
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', '').strip()

# Endpoints Google (tokeninfo pour la vérification de l'id_token).
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Les comptes créés via Google n'ont pas de mot de passe : ils se connectent
# uniquement via Google. On ne peut PAS les laisser se connecter avec le flux
# email/mot-de-passe (aucun hash stocké).
GOOGLE_AUTH_ENABLED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

PAYDUNYA_MODE = os.environ.get('PAYDUNYA_MODE', 'test').strip().lower()

PAYDUNYA_MASTER_KEY = os.environ.get('PAYDUNYA_MASTER_KEY', '').strip()

PAYDUNYA_PRIVATE_KEY = os.environ.get('PAYDUNYA_PRIVATE_KEY', '').strip()

PAYDUNYA_TOKEN = os.environ.get('PAYDUNYA_TOKEN', '').strip()

PAYDUNYA_STORE_NAME = os.environ.get('PAYDUNYA_STORE_NAME', 'KOJO')

# API de décaissement PayDunya (versements aux travailleurs)
PAYDUNYA_DISBURSE_BASE_URL = "https://app.paydunya.com/api/v2/disburse"

FRONTEND_APP_URL = os.environ.get('FRONTEND_APP_URL', '').rstrip('/')

BACKEND_PUBLIC_URL = os.environ.get('BACKEND_PUBLIC_URL', '').rstrip('/')

# ── BACKEND_PUBLIC_URL : OBLIGATOIRE dès que les paiements sont branchés ───
# Elle ne sert pas à l'API : elle sert à PayDunya, qui doit nous RAPPELER. Sans
# elle, `build_payment_callback_url` rendait une URL RELATIVE
# (`/api/payments/ipn/paydunya`) : le fournisseur recevait une callback
# inutilisable, l'IPN n'arrivait jamais, et le paiement n'était plus confirmé
# que par le polling du client — une panne silencieuse, visible seulement sur
# les paiements qui n'aboutissent pas.
#
# Le validateur existait (`kojo_env_validators.validate_https_url`) mais
# l'application ne l'appelait jamais : seuls la CI et le script de dérive Fly
# s'en servaient. Il est donc BRANCHÉ ici, avec le même parti pris que
# JWT_SECRET (refus de démarrer plutôt que servir une configuration fausse) —
# la production porte déjà la variable, la sonde de dérive Fly l'exige.
if BACKEND_PUBLIC_URL:
    from kojo_env_validators import validate_https_url as _validate_https_url

    try:
        BACKEND_PUBLIC_URL = _validate_https_url(BACKEND_PUBLIC_URL, "BACKEND_PUBLIC_URL")
    except ValueError as exc:
        raise RuntimeError(
            f"BACKEND_PUBLIC_URL mal formée : {exc} Corrigez le secret Fly "
            "(https://api.kojoforafrica.cc.cd, sans slash final) puis redéployez."
        )
elif APP_ENV in ("production", "prod") and PAYDUNYA_MASTER_KEY and PAYDUNYA_PRIVATE_KEY and PAYDUNYA_TOKEN:
    raise RuntimeError(
        "BACKEND_PUBLIC_URL n'est pas définie alors que PayDunya est configuré : "
        "les callbacks IPN partiraient en URL relative, PayDunya ne pourrait pas "
        "nous rappeler, et un paiement ne serait plus confirmé que par le polling "
        "du client. Définir BACKEND_PUBLIC_URL sur Fly.io (secret) puis redéployer."
    )

EMAIL_OTP_RESEND_COOLDOWN_SECONDS = int(os.environ.get('EMAIL_OTP_RESEND_COOLDOWN_SECONDS', '60'))

EMAIL_VERIFICATION_TOKEN_MINUTES = int(os.environ.get('EMAIL_VERIFICATION_TOKEN_MINUTES', '30'))

GMAIL_CLIENT_ID = os.environ.get('GMAIL_CLIENT_ID', '').strip()

GMAIL_CLIENT_SECRET = os.environ.get('GMAIL_CLIENT_SECRET', '').strip()

GMAIL_REFRESH_TOKEN = os.environ.get('GMAIL_REFRESH_TOKEN', '').strip()

GMAIL_SENDER_EMAIL = os.environ.get('GMAIL_SENDER_EMAIL', '').strip()

GMAIL_SENDER_NAME = os.environ.get('GMAIL_SENDER_NAME', 'KOJO').strip() or 'KOJO'

GMAIL_TOKEN_REFRESH_RETRIES = max(1, int(os.environ.get('GMAIL_TOKEN_REFRESH_RETRIES', '3')))

GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS = max(0.5, float(os.environ.get('GMAIL_TOKEN_REFRESH_BACKOFF_SECONDS', '1')))

GMAIL_ACCESS_TOKEN_SAFETY_SECONDS = max(30, int(os.environ.get('GMAIL_ACCESS_TOKEN_SAFETY_SECONDS', '60')))

GMAIL_ACCESS_TOKEN_CACHE: Dict[str, Any] = {"access_token": "", "expires_at": 0.0}

# Fournisseur email actif : 'brevo' (défaut) | 'resend' | 'gmail' | 'none'.
# Cette valeur décide de TOUS les envois (OTP, reçus, alertes owner) : voir
# kojo_email.send_email_via_active_provider.
EMAIL_PROVIDER = os.environ.get('EMAIL_PROVIDER', 'brevo').strip().lower()

BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '').strip()

BREVO_SENDER_EMAIL = os.environ.get('BREVO_SENDER_EMAIL', '').strip()

BREVO_SENDER_NAME = os.environ.get('BREVO_SENDER_NAME', 'KOJO').strip() or 'KOJO'

PASSWORD_RESET_FROM_EMAIL = os.environ.get('PASSWORD_RESET_FROM_EMAIL', BREVO_SENDER_EMAIL).strip() or BREVO_SENDER_EMAIL

# Boîte qui reçoit les RÉPONSES des utilisateurs. L'expéditeur transactionnel
# est une adresse DU DOMAINE (noreply@…), qui n'a pas de boîte : sans Reply-To,
# une réponse à un reçu de paiement rebondit. Défaut = adresse de contact
# RÉELLE, même règle que VAPID_CLAIMS_EMAIL (un placeholder passerait le
# contrôle de format tout en étant inutilisable). Vide = aucun Reply-To.
BREVO_REPLY_TO_EMAIL = os.environ.get('BREVO_REPLY_TO_EMAIL', 'kojoapp98@gmail.com').strip()

BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

# Resend (https://resend.com) — fournisseur alternatif, API REST.
# La clé `re_…` doit être un secret d'exécution (backend/.env en local, secrets
# Fly en production), jamais une valeur de build : dans du code frontend elle
# finirait dans le bundle servi à tous les visiteurs.
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '').strip()

# Expéditeur Resend. Il doit appartenir à un domaine VÉRIFIÉ chez Resend
# (SPF/DKIM), sinon Resend n'accepte que les envois vers l'adresse du compte
# — `onboarding@resend.dev` est l'expéditeur de TEST, pas de production.
RESEND_SENDER_EMAIL = os.environ.get('RESEND_SENDER_EMAIL', '').strip()

RESEND_SENDER_NAME = os.environ.get('RESEND_SENDER_NAME', 'KOJO').strip() or 'KOJO'

# Même règle que BREVO_REPLY_TO_EMAIL : l'expéditeur du domaine n'a pas de
# boîte, donc sans Reply-To une réponse à un email KOJO rebondit. Défaut =
# la même boîte lue (les deux fournisseurs partagent la réponse).
RESEND_REPLY_TO_EMAIL = os.environ.get('RESEND_REPLY_TO_EMAIL', BREVO_REPLY_TO_EMAIL).strip()

RESEND_API_URL = 'https://api.resend.com/emails'

# Webhook Resend (rebonds, plaintes) : Resend publie ses faits de livraison sur
# une URL déclarée dans son tableau de bord, signés par un secret Svix
# (`whsec_…`) — les en-têtes `svix-id`, `svix-timestamp`, `svix-signature`.
#
# OPTIONNELLE, et son absence DÉSACTIVE l'ingestion au lieu de l'assouplir :
# sans secret, la route ne peut pas distinguer Resend d'un inconnu qui
# annoncerait « cette adresse a rebondi ». Supprimer une adresse sur la parole
# du premier venu ferait taire les emails d'un tiers ; la route refuse donc
# (503) et le dit, et le reste du backend démarre sans elle.
RESEND_WEBHOOK_SECRET = os.environ.get('RESEND_WEBHOOK_SECRET', '').strip()

# Fenêtre de FRAÎCHEUR d'une signature de webhook (secondes). Une signature
# porte un horodatage : sans borne, une requête signée capturée une fois se
# rejoue à jamais. 300 s est la tolérance des bibliothèques Svix officielles.
EMAIL_WEBHOOK_TOLERANCE_SECONDS = max(
    30, int(os.environ.get('EMAIL_WEBHOOK_TOLERANCE_SECONDS', '300'))
)

# Rebonds TRANSITOIRES consécutifs (boîte pleine, serveur momentanément
# injoignable) avant d'alerter le propriétaire : ils ne suppriment pas
# l'adresse — la boîte existe —, mais une série qui dure est exactement
# l'échec silencieux qu'on veut arrêter. Alerte à chaque multiple du seuil.
EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD = max(
    1, int(os.environ.get('EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD', '3'))
)

GMAIL_DEPRECATED_NOTICE = 'Gmail OAuth disabled in favor of Brevo'

VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '').strip()

VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '').strip()

# Défaut = adresse de contact RÉELLE (cf. DEPLOY_FLYIO.md et .env.example).
# Un placeholder du genre 'mailto:kojo@example.com' passait le validateur de
# format tout en étant inutilisable : si la variable disparaissait de Fly, le
# backend démarrait sans bruit avec un claim `sub` que Mozilla/Google rejettent
# (401/403 sur l'authentification VAPID) — la panne silencieuse que le
# validateur existe pour empêcher. Le défaut doit donc être une adresse qui
# fonctionne vraiment, et rester aligné sur les références du dépôt
# (verrouillé par tests/test_vapid_sub_claim.py::TestReferencesProd).
VAPID_CLAIMS_EMAIL = os.environ.get('VAPID_CLAIMS_EMAIL', 'mailto:kojoapp98@gmail.com').strip()

# Jeton de l'endpoint Prometheus (`/metrics`, kojo_metrics). OPTIONNEL, et VIDE
# par défaut DÉLIBÉRÉMENT : sans jeton la route refuse (503 nommée) au lieu de
# publier la topologie interne. Le laisser vide n'empêche pas le backend de
# démarrer — c'est un choix d'exploitation (collecte active ou non), pas un
# secret requis au boot (voir OPTIONAL_KEYS de check-fly-env-drift.py).
# Comparé en temps constant, et lu à CHAQUE requête (pas de valeur figée).
METRICS_TOKEN = os.environ.get('METRICS_TOKEN', '').strip()

# Validateurs de format des variables d'env — extraits dans
# kojo_env_validators.py (module stdlib-only, importable sans dépendances
# lourdes : utilisé par le script d'audit Fly .github/scripts/check-fly-env-
# drift.py en CI, qui n'installe pas les dépendances backend). Ré-exportés
# ici pour préserver l'API publique (tests, server.py).
from kojo_env_validators import (  # noqa: E402,F401
    validate_cors_origins,
    validate_https_url,
    validate_mongo_url,
    validate_redis_url,
    validate_trusted_hosts,
    validate_vapid_sub_claim,
)


DEFAULT_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # Une réponse d'API n'a rien à faire dans un <img>, un <script> ou un
    # <iframe> d'un autre site : sans cette politique, un tiers peut charger
    # une réponse JSON comme ressource et la lire par effet de bord (mesure de
    # taille, attaques par oracle). `same-site` garde les documents pré-rendus
    # et le frontend (même site, sous-domaines distincts) fonctionnels.
    "Cross-Origin-Resource-Policy": "same-site",
    # Ferme les politiques cross-domain de Flash/PDF héritées : aucun client
    # légitime du site n'en a besoin, et leur défaut est permissif.
    "X-Permitted-Cross-Domain-Policies": "none",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://res.cloudinary.com; connect-src 'self' https://api.cloudinary.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

DOCS_SECURITY_HEADERS = {
    **DEFAULT_SECURITY_HEADERS,
    "Content-Security-Policy": "default-src 'self' https://cdn.jsdelivr.net https://fastapi.tiangolo.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com https://cdn.jsdelivr.net; connect-src 'self'; font-src 'self' https://cdn.jsdelivr.net data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
}

def get_security_headers_for_path(path: str) -> dict:
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi.json"):
        return DOCS_SECURITY_HEADERS
    return DEFAULT_SECURITY_HEADERS

OWNER_EMAIL = os.environ.get('OWNER_EMAIL', '').strip()

# Alias legacy (même valeur que OWNER_EMAIL) — centralisé ici pour que les
# routers utilisent la constante au lieu de lire os.environ directement.
FAMAKAN_OWNER_EMAIL = os.environ.get('FAMAKAN_OWNER_EMAIL', '').strip() or OWNER_EMAIL

# Repli neutre : la résolution du propriétaire passe d'abord par OWNER_EMAIL.
# Ne jamais y remettre un identifiant personnel.
OWNER_USER_ID = os.environ.get('OWNER_USER_ID', 'kojo-owner').strip() or 'kojo-owner'

OWNER_INITIAL_PASSWORD = os.environ.get('OWNER_INITIAL_PASSWORD', '').strip()

# --- Assistant IA (Neon AI Gateway) ---------------------------------------
# Le gateway vit DANS la branche Neon et expose un endpoint compatible OpenAI :
# l'hôte de branche (sans chemin) reçoit `/v1/chat/completions`. Neon n'injecte
# que ces deux variables (jamais OPENAI_API_KEY) : `NEON_AI_GATEWAY_BASE_URL`
# est l'hôte du gateway de la branche, `NEON_AI_GATEWAY_TOKEN` le jeton Neon.
#
# OPTIONNELLES : sans elles, l'assistant IA est DÉSACTIVÉ (is_configured() est
# faux, la route répond 503) et /support retombe sur le questionnaire. Le
# backend démarre donc sans elles — c'est un défaut de repli, pas un secret
# requis (voir OPTIONAL_KEYS de .github/scripts/check-fly-env-drift.py).
# Le slash final est retiré ici : sinon `…/v1` deviendrait `…//v1`.
AI_GATEWAY_BASE_URL = os.environ.get('NEON_AI_GATEWAY_BASE_URL', '').strip().rstrip('/')
AI_GATEWAY_TOKEN = os.environ.get('NEON_AI_GATEWAY_TOKEN', '').strip()
# Identifiant de catalogue du modèle (`GET /v1/models` du gateway) : le gateway
# route selon ce seul champ, donc changer de fournisseur ne touche PAS le code.
#
# LE DÉFAUT A ÉTÉ MESURÉ, plus supposé (27/10/2026), depuis la machine de
# production, contre le catalogue réel (464 modèles) :
#   • `claude-haiku-4-5` (l'ancien défaut) → **400 « is not a valid model ID »** :
#     une production sans `NEON_AI_GATEWAY_MODEL` n'aurait jamais répondu ;
#   • `recursive/flint-v1.0:free` (le modèle GRATUIT configuré en production) →
#     429 par intermittence, « temporarily rate-limited upstream » ;
#   • `openai/gpt-oss-20b` et `qwen/qwen3.7-flash` → 200 avec un corps VIDE
#     (donc 502 « réponse vide » côté route) ;
#   • `mistralai/mistral-nemo` → **200 en 0,6 s**, réponse française fluide,
#     ~0,029 $ par million de jetons d'entrée.
# C'est ce dernier qui devient le défaut : un modèle payant bon marché répond
# toujours, là où un modèle libre se met en file. Le plafond de dépense
# (`kojo_ai_budget`) borne la facture, pas ce réglage.
AI_GATEWAY_MODEL = os.environ.get('NEON_AI_GATEWAY_MODEL', 'mistralai/mistral-nemo').strip()
# Un appel modèle est facturé et plus lent qu'une requête interne : borne
# explicite, pour qu'un gateway lent ne bloque pas un worker indéfiniment.
AI_GATEWAY_TIMEOUT_SECONDS = int(os.environ.get('NEON_AI_GATEWAY_TIMEOUT_SECONDS', '30'))

# Budget de l'assistant : le plafond de DÉPENSE, par jour UTC et pour tout le
# service (voir kojo_ai_budget.py). La limite de débit (20 POST / 5 min / IP,
# kojo_rate_limit) borne le débit, pas la facture : une attaque répartie ou un
# pic la traverse, et chaque tour est facturé. Ces deux compteurs sont donc
# GLOBAUX, et lus à chaque demande — un assistant qui coûte plus qu'il ne rend
# service doit s'arrêter tout seul, sans déploiement.
#
# Défauts : 200 appels et 250 000 caractères de prompt par jour. À 2 000 jetons
# de réponse au plus par appel (le défaut de `chat_completion`, raisonnement
# compris) et un prompt borné
# à 16 tours de 2 000 caractères par le modèle d'entrée, c'est la borne qu'on
# accepte de payer quotidiennement pour une fonctionnalité facultative ; la
# baisser est un choix d'exploitation, la monter un choix budgétaire.
AI_GATEWAY_DAILY_CALLS = int(os.environ.get('NEON_AI_GATEWAY_DAILY_CALLS', '200'))
AI_GATEWAY_DAILY_PROMPT_CHARS = int(
    os.environ.get('NEON_AI_GATEWAY_DAILY_PROMPT_CHARS', '250000')
)

# Combien de temps le compteur d'une journée reste en base. Il ne porte aucune
# identité (deux nombres et une date), il n'existe que pour constater la dépense
# passée — donc une règle de conservation, appliquée par la base comme les
# autres (kojo_retention.RETENTION_RULES, publiée par PRIVACY.md).
AI_USAGE_RETENTION_DAYS = int(os.environ.get('AI_USAGE_RETENTION_DAYS', '90'))

# ── Support WhatsApp (Kapso) ────────────────────────────────────────────────
# Le support reçoit aussi les messages WhatsApp. Kapso (kapso.ai) relaie l'API
# WhatsApp Business : le webhook arrive en `POST /api/support/whatsapp/webhook`,
# signé en HMAC-SHA256 du corps BRUT (`X-Webhook-Signature`, hexadécimal), et la
# réponse part en `POST {base}/{version}/{phone_number_id}/messages` avec la clé
# en `X-API-Key` (cf. backend/kojo_whatsapp.py, qui porte tout le contrat).
#
# Les variables sont OPTIONNELLES et leur absence ne casse pas le démarrage :
#   • sans `KAPSO_WEBHOOK_SECRET`, la route répond 503 — l'ingestion est
#     DÉSACTIVÉE, jamais permissive (même posture que le webhook email) ;
#   • sans `KAPSO_API_KEY` ou `KAPSO_PHONE_NUMBER_ID`, un message reçu est
#     enregistré et ESCALADÉ en ticket au lieu d'être acquitté : on ne laisse
#     pas croire à un client qu'on lui a répondu.
#
# `KAPSO_API_BASE_URL` et `KAPSO_API_VERSION` n'existent que pour épingler le
# dialecte Meta (`v24.0`) et pointer une pile de test locale.
KAPSO_API_KEY = os.environ.get('KAPSO_API_KEY', '').strip()
KAPSO_PHONE_NUMBER_ID = os.environ.get('KAPSO_PHONE_NUMBER_ID', '').strip()
KAPSO_WEBHOOK_SECRET = os.environ.get('KAPSO_WEBHOOK_SECRET', '').strip()
KAPSO_API_BASE_URL = os.environ.get(
    'KAPSO_API_BASE_URL', 'https://api.kapso.ai/meta/whatsapp'
).strip().rstrip('/')
KAPSO_API_VERSION = os.environ.get('KAPSO_API_VERSION', 'v24.0').strip()
KAPSO_TIMEOUT_SECONDS = int(os.environ.get('KAPSO_TIMEOUT_SECONDS', '10'))

# Combien de tours précédents de la conversation sont redonnés au modèle. Un
# message WhatsApp est court, mais sans contexte l'assistant repose la même
# question à chaque message — et chaque tour est FACTURÉ (kojo_ai_budget), donc
# la fenêtre est bornée. 0 = aucune mémoire (le modèle ne voit que le message).
WHATSAPP_CONTEXT_MESSAGES = max(0, int(os.environ.get('WHATSAPP_CONTEXT_MESSAGES', '6')))

# Combien de temps une conversation WhatsApp reste en base : elle sert de
# contexte à l'assistant et de trace à l'escalade. Publiée par PRIVACY.md.
WHATSAPP_MESSAGE_RETENTION_DAYS = int(
    os.environ.get('WHATSAPP_MESSAGE_RETENTION_DAYS', '90')
)
