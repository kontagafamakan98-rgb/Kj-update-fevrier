# -*- coding: utf-8 -*-
"""LES ERREURS QUI N'ÉTAIENT REMONTÉES NULLE PART (02/11/2026).

MESURÉ LE 02/11/2026 : `/health` publiait `sentry: {state: "inactif"}` — sans
`SENTRY_DSN`, une exception non rattrapée ne laissait qu'une ligne dans les
journaux Fly, et *personne* ne la lisait. Le site pouvait rendre 500 à un
visiteur pendant une journée sans qu'aucune sonde ne le voie : les sondes
demandent les routes qui répondent, jamais celles qui cassent.

CE QUE CE MODULE AJOUTE, SANS COMPTE EXTERNE. Sentry reste ce qu'il est
(facultatif, une clé à poser — `kojo_sentry`) ; en attendant, le serveur COMPTE
ses propres erreurs, en mémoire, et les publie à deux endroits que des sondes
lisent déjà :

  * `/health` → bloc `erreurs` (`state`, `total`, `derniere_at`, `classe`,
    `famille`, `classes`, `portee`, `depuis`) ;
  * `/metrics` → `kojo_erreurs_serveur_total` et
    `kojo_erreurs_serveur_derniere_timestamp_seconds`.

CE QUI EST COMPTÉ, ET CE QUI NE L'EST PAS. Une seule chose : une exception qui
traverse le serveur sans être rattrapée, donc un 500 que Starlette fabrique
parce que le code a levé. Les 5xx DÉCLARÉS ne sont pas des erreurs et ne sont
pas comptés : le 503 de `/monitor` quand un fournisseur est down, un refus de
capacité, une base indisponible annoncée — ces réponses-là disent un ÉTAT, et
les compter ferait rougir la sonde pour un fait déjà publié ailleurs. C'est la
différence entre « le serveur a échoué » et « le serveur a répondu non ».

CE QUI N'EST JAMAIS PUBLIÉ : le message de l'exception (il peut recopier un
e-mail, un jeton, un corps de requête — `/health` est une réponse PUBLIQUE),
l'URL complète avec son identifiant, la trace. On publie le NOM de la classe
(`TypeError`), la FAMILLE de route (`/api/jobs`, sans identifiant — les deux
premiers segments seulement), le nombre par classe et la date de la dernière.
De quoi ouvrir le journal Fly en sachant quoi chercher, et rien de plus.

PORTÉE, ÉCRITE DANS LA RÉPONSE. Les compteurs vivent dans le PROCESS : ils
repartent à zéro à chaque déploiement ou redémarrage. Un `total: 0` veut donc
dire « aucune erreur depuis le démarrage », jamais « aucune erreur depuis
toujours » — la nuance est dans `portee`, et `depuis` donne l'heure du
démarrage pour que le lecteur puisse la vérifier lui-même.
"""
import time
from datetime import datetime, timezone
from typing import Optional

# Combien de classes sont nommées. Au-delà, le reste est agrégé : une réponse
# de santé PUBLIQUE n'a pas à dresser un inventaire illimité de ce qui casse.
MAX_CLASSES = 5

PORTEE = (
    "depuis le demarrage de ce processus : les compteurs repartent a zero a "
    "chaque deploiement ou redemarrage, donc 0 veut dire « aucune erreur depuis "
    "ce demarrage », jamais « aucune erreur depuis toujours »"
)

# Classe(s) nommée(s) quand le nom d'une exception ne dit rien d'exploitable.
CLASSE_INCONNUE = "Exception"

# L'état du process. Remis à zéro au démarrage (import) et par `reinitialiser`.
_etat = {
    "demarrage_at": None,
    "demarrage_epoch": 0.0,
    "total": 0,
    "classes": {},
    "derniere_at": None,
    "derniere_epoch": 0.0,
    "derniere_classe": None,
    "derniere_famille": None,
}


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _horodater_demarrage() -> None:
    """Pose l'heure de démarrage une seule fois : un import ne se rejoue pas."""
    if _etat["demarrage_at"] is None:
        instant = _maintenant()
        _etat["demarrage_at"] = instant.isoformat()
        _etat["demarrage_epoch"] = instant.timestamp()


def reinitialiser() -> None:
    """Remet les compteurs à zéro (tests, et redémarrage simulé)."""
    _etat.update(
        demarrage_at=None,
        demarrage_epoch=0.0,
        total=0,
        classes={},
        derniere_at=None,
        derniere_epoch=0.0,
        derniere_classe=None,
        derniere_famille=None,
    )
    _horodater_demarrage()


def famille(chemin: Optional[str]) -> str:
    """La famille d'une route, JAMAIS l'URL complète.

    Deux segments suffisent à nommer le sous-système (`/api/jobs`,
    `/api/payments`) sans transporter l'identifiant d'une mission ou d'un
    profil : `/api/jobs/6f3a…` se lit `/api/jobs`. Ce qui ne commence pas par
    `/` n'est pas une route — on ne publie alors rien de deviné.
    """
    morceaux = [m for m in str(chemin or "").split("/") if m]
    if not morceaux:
        return "/"
    return "/" + "/".join(morceaux[:2])


def _nom_classe(exception: BaseException) -> str:
    """Le nom de la classe, ou un nom neutre — jamais le message."""
    nom = type(exception).__name__
    return nom if isinstance(nom, str) and nom.strip() else CLASSE_INCONNUE


def enregistrer(exception: BaseException, chemin: Optional[str] = None) -> dict:
    """Compte une exception non rattrapée. Appelé par le middleware, jamais par
    le code métier : une erreur comptée deux fois vaudrait deux erreurs."""
    _horodater_demarrage()
    classe = _nom_classe(exception)
    instant = _maintenant()

    _etat["total"] += 1
    _etat["classes"][classe] = _etat["classes"].get(classe, 0) + 1
    _etat["derniere_at"] = instant.isoformat()
    _etat["derniere_epoch"] = instant.timestamp()
    _etat["derniere_classe"] = classe
    _etat["derniere_famille"] = famille(chemin)
    return diagnostic()


def diagnostic() -> dict:
    """Ce que `/health` publie. Aucune donnée d'exception, aucune URL."""
    _horodater_demarrage()
    classes = sorted(
        _etat["classes"].items(), key=lambda paire: (-paire[1], paire[0])
    )
    nommees = [{"classe": nom, "total": nombre} for nom, nombre in classes[:MAX_CLASSES]]
    reste = sum(nombre for _, nombre in classes[MAX_CLASSES:])
    if reste:
        # « autres » n'est pas une classe d'exception : c'est le reste agrégé,
        # et son motif est écrit dans la réponse pour qu'on ne le confonde pas
        # avec un `OtherError` qui existerait vraiment.
        nommees.append({"classe": "autres", "total": reste})

    return {
        # `ok` ne veut dire qu'une chose : aucune exception non rattrapée depuis
        # le démarrage. Un silence n'est donc pas un vert — c'est un compte à
        # zéro, et `depuis` dit sur quelle durée il porte.
        "state": "ok" if _etat["total"] == 0 else "echec",
        "total": _etat["total"],
        "derniere_at": _etat["derniere_at"],
        "derniere_epoch": int(_etat["derniere_epoch"]) if _etat["derniere_epoch"] else 0,
        "classe": _etat["derniere_classe"],
        "famille": _etat["derniere_famille"],
        "classes": nommees,
        "depuis": _etat["demarrage_at"],
        "portee": PORTEE,
    }


class ErreursServeurMiddleware:
    """Compte l'exception, PUIS la relance : Starlette rend son 500 comme avant.

    Rien n'est avalé ici. Un middleware qui attraperait l'exception sans la
    relancer changerait la réponse servie — ce module observe, il ne répare pas.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        try:
            await self.app(scope, receive, send)
        except Exception as exception:  # noqa: BLE001 — on compte TOUT, puis on relance
            try:
                enregistrer(exception, scope.get("path"))
            except Exception:  # noqa: BLE001 — compter ne doit jamais masquer l'erreur
                pass
            raise
