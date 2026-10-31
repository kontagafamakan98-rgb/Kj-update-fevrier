# -*- coding: utf-8 -*-
"""Sentry (monitoring d'erreurs) — l'état qui REMONTE, publié par /health.

CE QUE CE MODULE FERME (31/10/2026). Sentry était « optionnel et invérifiable
d'ici », et deux audits de suite l'ont écrit : `SENTRY_DSN` absent = aucune
remontée d'erreur, aucun signe visible, rien ne casse — donc *personne* ne
pouvait distinguer « le monitoring tourne » de « le monitoring n'a jamais été
configuré » sans ouvrir les secrets Fly. Pire : quand le DSN était présent mais
que `sentry_sdk.init()` levait (DSN expiré, paquet absent, option invalide), le
`except` d'origine journalisait l'exception et continuait — le serveur se
déclarait en bonne santé en n'envoyant plus une seule erreur.

Le bloc `sentry` de `/health` publie donc trois faits classés, et JAMAIS la
donnée sensible :

  * `configured` — les erreurs REMONTENT-elles ? (`True` seulement si le DSN est
    présent **et** que l'initialisation a réussi) ;
  * `state` — `ok` / `inactif` (DSN absent) / `echec` (DSN présent, init
    refusée) : trois états, parce que « pas de monitoring voulu » et « monitoring
    cassé » n'appellent pas le même remède ;
  * `motif` — la cause actionnable, écrite une fois par état.

CE QUI N'EST JAMAIS PUBLIÉ : le DSN, sa clé publique, son hôte d'ingestion et
son identifiant de projet. `/health` est une réponse PUBLIQUE (n'importe qui
peut la lire, et un DSN permet d'envoyer de faux événements dans le projet) ;
la cause classée suffit à choisir entre « poser `SENTRY_DSN` » et « renouveler
le DSN », et c'est tout ce qu'un diagnostic demande. Le motif ne cite donc que
le NOM de la variable, jamais sa valeur — et le message d'une exception
d'initialisation n'est pas propagé non plus : `sentry_sdk` y recopie le DSN.

L'état est PAR PROCESS et posé à l'import du serveur (`initialiser()`), comme le
diagnostic du gateway IA (`kojo_ai_gateway`) : un redémarrage rejoue
l'initialisation, donc un DSN corrigé se lit `ok` sans redéployer de code.
"""
import os

# Le nom de la variable, écrit une fois : les motifs le citent, les tests
# l'attendent, et une valeur recopiée à trois endroits pourrait diverger.
VARIABLE_DSN = "SENTRY_DSN"

# L'état, remis à zéro si le module est rechargé (process neuf).
_etat = {
    "configured": False,
    "state": "inactif",
    "cause": "absent",
    "environment": "",
}

# Ce que chaque cause demande à qui doit RÉPARER. Aucune ne cite le DSN.
MOTIFS = {
    "absent": (
        f"{VARIABLE_DSN} absent : les erreurs du backend ne remontent pas — "
        f"poser le secret (flyctl secrets set {VARIABLE_DSN}=…) si c'est voulu"
    ),
    "initialise": "les erreurs du backend remontent à Sentry",
    "import": (
        "paquet sentry-sdk introuvable : les erreurs ne remontent pas — "
        "vérifier backend/requirements.txt (sentry-sdk y est épinglé)"
    ),
    "refus": (
        "initialisation refusée par sentry-sdk : les erreurs ne remontent pas — "
        f"vérifier la valeur de {VARIABLE_DSN} (DSN expiré ou invalide)"
    ),
}


def _valeur_nette(valeur) -> str:
    """La valeur telle qu'elle doit être LUE, sans jamais être publiée."""
    return str(valeur or "").strip()


def motiver(cause: str) -> str:
    """Le motif d'une cause, ou un motif générique — jamais un secret."""
    return MOTIFS.get(cause, "état de configuration inconnu")


def initialiser(dsn=None, *, environnement: str = "", initialiseur=None) -> dict:
    """Initialise Sentry si `SENTRY_DSN` est posé, et RETIENT le résultat.

    Args:
        dsn: valeur à juger ; `None` = lire `SENTRY_DSN` dans l'environnement.
            Un DSN vide est l'absence, pas une chaîne à initialiser.
        environnement: environnement Sentry (`production`, `staging`) — publié
            tel quel, il ne dit rien de secret.
        initialiseur: `sentry_sdk.init` par défaut ; injectable pour que les
            preuves éprouvent la réussite ET le refus sans le SDK installé.

    Returns:
        L'état retenu, identique à ce que `diagnostic()` publiera.
    """
    from kojo_settings import APP_ENV

    valeur = _valeur_nette(os.environ.get(VARIABLE_DSN) if dsn is None else dsn)
    _etat["environment"] = _valeur_nette(environnement) or _valeur_nette(APP_ENV)

    if not valeur:
        # L'ABSENCE est un état, pas une erreur : le site fonctionne sans
        # Sentry, et /health doit le dire sans faire croire à une panne.
        _etat.update(configured=False, state="inactif", cause="absent")
        return dict(_etat)

    # L'initialiseur INJECTÉ dispense de l'import, et c'est ce qui rend les
    # preuves honnêtes : un cas qui met en scène un DSN accepté ou refusé doit
    # lire `ok` / `echec`, pas `import`, sur une machine où `sentry-sdk` n'est
    # pas installé. L'absence du paquet ne se mesure donc que sur le chemin
    # RÉEL (aucun initialiseur fourni), celui qu'emprunte le serveur.
    if initialiseur is None:
        try:
            import sentry_sdk
        except ImportError:
            _etat.update(configured=False, state="echec", cause="import")
            return dict(_etat)
        initialiseur = sentry_sdk.init

    try:
        initialiseur(
            dsn=valeur,
            environment=_etat["environment"],
            traces_sample_rate=0.1,
            # Ne jamais envoyer de PII (emails, téléphones) à Sentry.
            send_default_pii=False,
        )
    except Exception:
        # Le message de l'exception N'EST PAS propagé : `sentry_sdk` y recopie
        # le DSN dans plusieurs cas (URL malformée, projet inconnu).
        _etat.update(configured=False, state="echec", cause="refus")
        return dict(_etat)

    _etat.update(configured=True, state="ok", cause="initialise")
    return dict(_etat)


def diagnostic() -> dict:
    """Le bloc public de `/health` — quatre faits, aucun secret.

    Returns:
        dict: `configured`, `state`, `motif`, `environment`. Le motif est
        DÉRIVÉ de la cause au moment de la lecture, pour qu'un état posé par une
        autre version du module ne puisse pas publier une phrase périmée.
    """
    return {
        "configured": bool(_etat["configured"]),
        "state": _etat["state"],
        "motif": motiver(_etat["cause"]),
        "environment": _etat["environment"],
    }


def reinitialiser() -> None:
    """Remet l'état à zéro (redémarrage simulé par les preuves)."""
    _etat.update(configured=False, state="inactif", cause="absent", environment="")
