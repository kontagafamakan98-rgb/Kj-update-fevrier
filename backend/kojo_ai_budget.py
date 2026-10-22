# -*- coding: utf-8 -*-
"""Budget de l'assistant IA — le plafond qui borne la FACTURE, pas le débit.

`kojo_rate_limit` limite l'assistant à 20 POST / 5 min / IP. C'est un plafond de
DÉBIT : une attaque répartie sur mille IP, ou simplement un pic d'usage, le
traverse sans le voir — et chaque tour est facturé par le gateway. Le seul objet
qui décrit la dépense est le TOTAL de la journée, donc il est compté ici, pour
tout le service.

Trois décisions, avec ce que chacune coûte :

  * DEUX compteurs, `appels` et `caracteres`. Le second est la moitié qu'un
    plafond d'appels ne voit pas : seize tours de 2 000 caractères envoyés au
    modèle coûtent bien plus que seize questions courtes, et `max_tokens` ne
    borne que la RÉPONSE. Le nombre de caractères est le proxy que ce dépôt peut
    mesurer sans tokenizer ni accès à la facture.
  * Le compteur vit en BASE (document `ai_usage`, `_id` = jour UTC), pas en
    mémoire : un redémarrage, un second process ou un déploiement ne remettent
    pas la facture à zéro. La réservation est un COMPARE-AND-SWAP : on relit
    l'état, on refuse s'il est plein, et on n'incrémente que si l'état n'a pas
    bougé (filtre d'ÉGALITÉ sur les deux compteurs). Deux requêtes simultanées
    ne franchissent donc pas la dernière unité ensemble : la seconde voit son
    filtre ne plus correspondre, relit, et refuse.
    Pourquoi une égalité et non un `$lt` dans le filtre : un `$lt` est correct
    chez Mongo, mais la doublure du dépôt (`tests/conftest.py`) n'a pas le même
    upsert — elle recopie les clauses non-égalitaires dans le document inséré,
    puis refuse l'`$inc` qui tombe sur un dictionnaire. Plutôt que d'enseigner à
    la doublure un comportement qu'elle ne simule pas, la réservation se lit en
    CAS, identique dans les deux moteurs, et se prouve sans supposer l'upsert
    parfait.
  * Un compteur INJOIGNABLE refuse l'appel. C'est le choix INVERSE du
    rate-limiter, qui a un repli mémoire : ici, « laisser passer » signifierait
    dépenser sans plafond, sur une fonctionnalité FACULTATIVE dont le repli est
    le formulaire de support. Le refus est NOMMÉ (503), journalisé, et le
    formulaire reste à l'écran.

Ce que le plafond NE borne pas, écrit pour ne pas le croire plus fort qu'il
n'est : un tour peut franchir la dernière unité de CARACTÈRES — l'état est
comparé avant l'incrément — donc une journée peut dépasser le plafond d'un seul
prompt, au plus seize messages de 2 000 caractères plus les instructions du
serveur. Deux tours de dépassement sont impossibles : après le premier, le
compteur est au-dessus du plafond et toute demande suivante est refusée. Le
nombre d'APPELS, lui, ne dépasse jamais le plafond.

Une réservation PRISE puis perdue par un échec du gateway (502) est CONSERVÉE :
le prestataire a pu facturer l'appel, et deviner le contraire ferait dépendre le
plafond d'une heuristique. La conséquence est bornée — un échec consomme au plus
un tour — et elle est préférable à un compteur qui rembourse sur parole.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from kojo_core import db
from kojo_settings import (
    AI_GATEWAY_DAILY_CALLS,
    AI_GATEWAY_DAILY_PROMPT_CHARS,
    logger,
)

# Le jour est UTC : une journée « locale » dépendrait du fuseau du serveur, donc
# changerait de définition en changeant de région de déploiement.
FORMAT_JOUR = "%Y-%m-%d"

# Une réservation peut perdre une course (deux visiteurs à la même seconde) et
# relire. Trois tours suffisent : au-delà, la contention n'est plus un hasard,
# et insister coûterait plus que refuser.
ESSAIS_MAX = 3

# Motifs de refus. Ils sont DISTINCTS parce que le client ne reçoit pas le même
# statut : un plafond est un 429 (réessayer demain), un compteur en panne un 503
# (le service ne peut pas juger maintenant) — et le second n'est pas la faute du
# visiteur.
MOTIF_PLAFOND = "plafond"
MOTIF_COMPTEUR = "compteur"


def _plancher(valeur: int) -> int:
    """Un plafond nul ou négatif vaut 1, jamais 0.

    Zéro fermerait l'assistant sans le dire, alors qu'il a un interrupteur
    explicite (l'absence de jeton, voir `kojo_ai_gateway.is_configured`). Une
    valeur mal saisie doit donc borner très bas, pas éteindre en silence.
    """
    return max(1, int(valeur))


# Les deux plafonds, lus UNE fois : c'est `kojo_settings` qui porte le défaut, et
# un test peut les abaisser sans toucher au reste.
PLAFOND_APPELS = _plancher(AI_GATEWAY_DAILY_CALLS)
PLAFOND_CARACTERES = _plancher(AI_GATEWAY_DAILY_PROMPT_CHARS)


@dataclass(frozen=True)
class Reservation:
    """Le verdict du compteur, et de quoi le dire au client.

    `retry_after` est en secondes : le temps restant avant le prochain jour UTC,
    c'est-à-dire l'instant où le plafond repart à zéro.
    """

    autorisee: bool
    motif: str = ""
    # L'état du compteur au moment du verdict — ce que le journal et un futur
    # écran d'exploitation pourront lire, sans relire la base pour le dire.
    appels: int = 0
    caracteres: int = 0
    retry_after: int = 0


def jour_utc(maintenant: datetime = None) -> str:
    """L'identifiant du jour UTC courant, `AAAA-MM-JJ`."""
    maintenant = maintenant or datetime.now(timezone.utc)
    return maintenant.strftime(FORMAT_JOUR)


def debut_du_jour(maintenant: datetime = None) -> datetime:
    """Minuit UTC du jour courant — la date que la règle de conservation lit.

    L'index TTL ne mord que sur un champ DATE (cf. `kojo_retention`) : `_id`
    porte le jour sous forme de texte, pour l'atomicité, et c'est CE champ-ci
    qui fait expirer le document.
    """
    maintenant = maintenant or datetime.now(timezone.utc)
    return maintenant.replace(hour=0, minute=0, second=0, microsecond=0)


def secondes_avant_le_jour_suivant(maintenant: datetime = None) -> int:
    """Secondes avant minuit UTC — la valeur d'un `Retry-After` honnête."""
    maintenant = maintenant or datetime.now(timezone.utc)
    suivant = debut_du_jour(maintenant) + timedelta(days=1)
    return max(0, int((suivant - maintenant).total_seconds()))


def caracteres_de_prompt(messages) -> int:
    """Le coût d'ENTRÉE d'un appel : la somme des tours envoyés au modèle.

    Le prompt système compte (il part à chaque appel) ; un contenu non textuel
    ne compte pour zéro plutôt que de lever — un refus de comptage ne doit pas
    devenir une panne de l'assistant.
    """
    total = 0
    for message in messages or ():
        contenu = message.get("content") if isinstance(message, dict) else None
        total += len(contenu) if isinstance(contenu, str) else 0
    return total


def _a_ecrit(resultat) -> bool:
    """Le pilote a-t-il réellement incrémenté le document ?

    `matched_count` est LU, jamais supposé : un MagicMock fabriquerait un
    attribut véridique, et une réservation accordée sur une écriture qui n'a pas
    eu lieu serait exactement le trou que ce module ferme. Zéro signifie que le
    filtre d'égalité ne correspond plus — quelqu'un a réservé entre-temps.
    """
    return int(getattr(resultat, "matched_count", 0) or 0) > 0


def _refus(motif: str, maintenant: datetime, appels: int = 0, caracteres: int = 0) -> Reservation:
    return Reservation(
        autorisee=False,
        motif=motif,
        appels=appels,
        caracteres=caracteres,
        retry_after=secondes_avant_le_jour_suivant(maintenant),
    )


async def reserver(caracteres: int) -> Reservation:
    """Réserve un appel AVANT de le payer, ou refuse en nommant la cause.

    À appeler entre la construction du prompt et l'appel au modèle : compter
    après coup laisserait passer la dépense qu'on cherche à borner.

    Args:
        caracteres: taille du prompt qui va partir (`caracteres_de_prompt`).

    Returns:
        Reservation: `autorisee` faux avec `motif` = `plafond` (429 côté route)
        ou `compteur` (503 : le budget ne peut pas être jugé).
    """
    demandes = max(1, int(caracteres))
    maintenant = datetime.now(timezone.utc)
    jour = jour_utc(maintenant)

    for _ in range(ESSAIS_MAX):
        try:
            document = await db.ai_usage.find_one({"_id": jour})
        except Exception as exc:  # noqa: BLE001 — la cause décide du refus, pas le type
            return _compteur_indisponible(jour, exc, maintenant)

        if document is None:
            # Premier appel de la journée : l'insertion est elle-même le verrou
            # (`_id` unique). Si une autre requête l'a créée entre-temps, on
            # relit et on reprend le chemin de mise à jour.
            try:
                await db.ai_usage.insert_one({
                    "_id": jour,
                    "jour_debut": debut_du_jour(maintenant),
                    "cree_le": maintenant,
                    "maj_le": maintenant,
                    "appels": 1,
                    "caracteres": demandes,
                })
                return _autorisee(maintenant, demandes)
            except Exception:  # noqa: BLE001 — doublon (course) ou base injoignable
                continue

        appels = int(document.get("appels") or 0)
        caracteres_jour = int(document.get("caracteres") or 0)
        if appels >= PLAFOND_APPELS or caracteres_jour >= PLAFOND_CARACTERES:
            logger.warning(
                f"⛔ Assistant IA : plafond du jour atteint ({jour} : "
                f"{appels}/{PLAFOND_APPELS} appels, "
                f"{caracteres_jour}/{PLAFOND_CARACTERES} caractères)"
            )
            return _refus(MOTIF_PLAFOND, maintenant, appels, caracteres_jour)

        try:
            resultat = await db.ai_usage.update_one(
                {"_id": jour, "appels": appels, "caracteres": caracteres_jour},
                {
                    "$inc": {"appels": 1, "caracteres": demandes},
                    "$set": {"maj_le": maintenant},
                },
            )
        except Exception as exc:  # noqa: BLE001
            return _compteur_indisponible(jour, exc, maintenant)

        if _a_ecrit(resultat):
            return _autorisee(maintenant, demandes)
        # Le filtre d'égalité ne correspond plus : quelqu'un a réservé entre
        # notre lecture et notre écriture. On relit — le plafond sera peut-être
        # atteint, et c'est la relecture qui le dira.

    # Trois tours perdus : la contention n'est plus un hasard. Refuser plutôt
    # que de laisser passer un appel qui n'est pas compté.
    logger.warning(f"⚠️ Assistant IA : compteur en contention pour {jour} — appel refusé")
    return _refus(MOTIF_COMPTEUR, maintenant)


def _autorisee(maintenant: datetime, demandes: int) -> Reservation:
    return Reservation(
        autorisee=True,
        appels=1,
        caracteres=demandes,
        retry_after=secondes_avant_le_jour_suivant(maintenant),
    )


def _compteur_indisponible(jour: str, exc: Exception, maintenant: datetime) -> Reservation:
    """Un compteur muet refuse l'appel, et le DIT (503 côté route).

    C'est le choix inverse du rate-limiter, qui a un repli mémoire : ici,
    « laisser passer » signifierait dépenser sans plafond sur une
    fonctionnalité FACULTATIVE dont le repli est le formulaire de support.
    """
    logger.warning(
        f"⚠️ Assistant IA : compteur indisponible ({type(exc).__name__}) — appel refusé ({jour})"
    )
    return _refus(MOTIF_COMPTEUR, maintenant)
