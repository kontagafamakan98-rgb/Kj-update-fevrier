# -*- coding: utf-8 -*-
"""Paliers de commission — le prix de Kojo n'est plus un seul taux.

POURQUOI CE MODULE. `get_effective_commission_rate()` rend UN taux, réglable
en base, appliqué à tout le monde. C'était juste tant que la place était vide ;
c'est un frein dès la première mission réelle, pour deux raisons mesurables :

  * un travailleur qui n'a encore JAMAIS été payé sur Kojo compare 14 % à un
    bouche-à-oreille gratuit. Le premier versement est l'argument qui le fait
    rester, et il ne coûte rien à la plateforme : il n'y a rien à prendre ;
  * un travailleur qui en est à sa quinzième mission, lui, a une raison de
    rester (sa réputation est ici) et peut payer un taux réduit plutôt que le
    taux de croisière — sans quoi il organise son contournement.

Trois paliers, donc, résolus par le NOMBRE DE MISSIONS TERMINÉES du travailleur
(comptées, jamais recopiées dans son document : un compteur dénormalisé dérive
au premier litige tranché en remboursement) :

  * `lancement`  — les premières missions, à taux réduit (0 % par défaut) ;
  * `standard`   — le taux de croisière, celui de `PAYMENT_COMMISSION_RATE` ;
  * `recurrent`  — au-delà d'un seuil, un taux plus bas (8 % par défaut).

CE QUI N'EST PAS CODÉ ICI : les VALEURS. Un taux est une décision commerciale,
pas une constante de programme : la configuration vit dans `db.settings`
(`type = "commission_paliers"`), se lit par le propriétaire, et s'écrit par la
route `POST /owner/commission-paliers`. Les défauts ci-dessous ne sont que le
point de départ proposé — et les paliers sont DÉSACTIVÉS par défaut, parce
qu'activer une remise commerciale ne doit pas être l'effet de bord d'un
déploiement.

CE QUI GOUVERNE LA LECTURE : la résolution ne doit JAMAIS empêcher un paiement.
Une base injoignable, un document illisible ou une valeur hors bornes retombent
sur le taux standard effectif (celui d'avant ce module), et le motif est
retourné à l'appelant — un repli silencieux serait un prix qui change sans que
personne ne sache pourquoi.

Le taux retenu est FIGÉ sur le paiement (`commission_rate`, `commission_tier`)
au moment du devis payé : un changement de palier après coup ne réécrit pas une
facture déjà émise, et les statistiques du propriétaire continuent d'additionner
ce qui a réellement été encaissé.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from kojo_core import db
from kojo_settings import logger

# Les trois paliers, nommés une fois : ils sortent sur le paiement, dans le
# devis et dans les réponses du propriétaire — trois surfaces qui doivent dire
# le même mot.
PALIER_LANCEMENT = "lancement"
PALIER_STANDARD = "standard"
PALIER_RECURRENT = "recurrent"

PALIERS = (PALIER_LANCEMENT, PALIER_STANDARD, PALIER_RECURRENT)

# Le document de configuration. Un seul, sans identifiant libre : deux
# configurations concurrentes donneraient deux prix pour la même mission.
TYPE_CONFIG = "commission_paliers"

# Défauts PROPOSÉS (jamais appliqués tant que `actif` est faux) : le barème
# du plan de lancement. `lancement_missions = 3` couvre les trois premières
# missions terminées ; `recurrent_missions = 10` laisse sept missions au taux
# standard avant la remise de fidélité.
DEFAUTS: Dict[str, Any] = {
    "actif": False,
    "lancement_missions": 3,
    "lancement_taux_percent": 0.0,
    "recurrent_missions": 10,
    "recurrent_taux_percent": 8.0,
}

# Bornes de saisie. Le plafond de 50 % est celui de la route historique
# (`update-commission-settings`) : au-delà, une faute de frappe (14 saisi pour
# 1,4) ne se rattrape plus sur les paiements déjà partis.
TAUX_MAX_PERCENT = 50.0
MISSIONS_MAX = 1000

MOTIF_DESACTIVES = "paliers_desactives"
MOTIF_LANCEMENT = "lancement"
MOTIF_STANDARD = "standard"
MOTIF_RECURRENT = "recurrent"
MOTIF_SANS_TRAVAILLEUR = "travailleur_inconnu"
MOTIF_LECTURE_IMPOSSIBLE = "lecture_impossible"


def _nombre(valeur, defaut: float) -> float:
    """Flottant fini, ou le défaut — une valeur illisible ne devient pas 0."""
    try:
        resultat = float(valeur)
    except (TypeError, ValueError):
        return float(defaut)
    if resultat != resultat or resultat in (float("inf"), float("-inf")):
        return float(defaut)
    return resultat


def _entier(valeur, defaut: int) -> int:
    try:
        return int(valeur)
    except (TypeError, ValueError):
        return int(defaut)


def normaliser(payload: Optional[dict]) -> Dict[str, Any]:
    """Valide une configuration et la rend au format stocké.

    Lève `ValueError` avec un message en français : c'est ce que la route
    propriétaire renvoie en 400, et un refus qui nomme le champ fautif est la
    seule façon qu'une saisie fausse ne passe pas pour un réglage.

    Une valeur ABSENTE garde le défaut ; une valeur PRÉSENTE mais invalide est
    refusée au lieu d'être réparée en silence — corriger 60 en 50 ferait croire
    au propriétaire que son taux est appliqué.
    """
    payload = payload or {}

    actif = payload.get("actif", DEFAUTS["actif"])
    if not isinstance(actif, bool):
        raise ValueError("actif doit être un booléen")

    lancement_missions = _entier(
        payload.get("lancement_missions", DEFAUTS["lancement_missions"]),
        DEFAUTS["lancement_missions"],
    )
    if not 0 <= lancement_missions <= MISSIONS_MAX:
        raise ValueError(f"lancement_missions doit être entre 0 et {MISSIONS_MAX}")

    recurrent_missions = _entier(
        payload.get("recurrent_missions", DEFAUTS["recurrent_missions"]),
        DEFAUTS["recurrent_missions"],
    )
    if not 1 <= recurrent_missions <= MISSIONS_MAX:
        raise ValueError(f"recurrent_missions doit être entre 1 et {MISSIONS_MAX}")
    if recurrent_missions <= lancement_missions:
        # Deux paliers qui se chevauchent rendraient la résolution dépendante
        # de l'ordre des `if` — c'est-à-dire d'un détail d'implémentation.
        raise ValueError("recurrent_missions doit être supérieur à lancement_missions")

    lancement_taux = _nombre(
        payload.get("lancement_taux_percent", DEFAUTS["lancement_taux_percent"]),
        DEFAUTS["lancement_taux_percent"],
    )
    recurrent_taux = _nombre(
        payload.get("recurrent_taux_percent", DEFAUTS["recurrent_taux_percent"]),
        DEFAUTS["recurrent_taux_percent"],
    )
    for nom, taux in (
        ("lancement_taux_percent", lancement_taux),
        ("recurrent_taux_percent", recurrent_taux),
    ):
        if not 0 <= taux <= TAUX_MAX_PERCENT:
            raise ValueError(f"{nom} doit être entre 0 et {TAUX_MAX_PERCENT:g}")

    return {
        "actif": actif,
        "lancement_missions": lancement_missions,
        "lancement_taux_percent": round(lancement_taux, 2),
        "recurrent_missions": recurrent_missions,
        "recurrent_taux_percent": round(recurrent_taux, 2),
    }


def _depuis_document(document: Optional[dict]) -> Dict[str, Any]:
    """Configuration lue d'un document Mongo, champ par champ, ou les défauts.

    Une valeur stockée invalide est REMPLACÉE par le défaut du champ et
    journalisée — elle ne fait pas échouer la résolution : un paiement ne
    s'arrête pas parce qu'un réglage commercial est mal saisi.
    """
    if not document:
        return dict(DEFAUTS)

    try:
        return normaliser({
            "actif": document.get("actif", DEFAUTS["actif"]),
            "lancement_missions": document.get("lancement_missions", DEFAUTS["lancement_missions"]),
            "lancement_taux_percent": document.get(
                "lancement_taux_percent", DEFAUTS["lancement_taux_percent"]
            ),
            "recurrent_missions": document.get("recurrent_missions", DEFAUTS["recurrent_missions"]),
            "recurrent_taux_percent": document.get(
                "recurrent_taux_percent", DEFAUTS["recurrent_taux_percent"]
            ),
        })
    except ValueError as exc:
        logger.warning(
            "⚠️ Paliers de commission illisibles en base (%s), repli sur les défauts", exc
        )
        return dict(DEFAUTS)


async def configuration() -> Dict[str, Any]:
    """Configuration effective des paliers — jamais une exception.

    Renvoie les défauts si la lecture échoue : c'est une lecture de PRIX, pas
    une écriture, et un incident Mongo ne doit pas rendre un devis impossible.
    """
    try:
        document = await db.settings.find_one({"type": TYPE_CONFIG})
    except Exception as exc:  # pragma: no cover - dépend du client Mongo
        logger.warning("⚠️ Lecture des paliers de commission impossible : %s", exc)
        return dict(DEFAUTS)
    return _depuis_document(document)


async def enregistrer(payload: Optional[dict]) -> Dict[str, Any]:
    """Écrit la configuration (upsert sur `type`), et la rend relue.

    La relecture n'est pas décorative : elle rend ce qui est RÉELLEMENT stocké,
    donc ce que la prochaine résolution appliquera.
    """
    configuration_valide = normaliser(payload)
    document = {
        "type": TYPE_CONFIG,
        **configuration_valide,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.settings.update_one(
        {"type": TYPE_CONFIG}, {"$set": document}, upsert=True
    )
    return configuration_valide


async def missions_terminees(worker_id: Optional[str]) -> int:
    """Missions TERMINÉES du travailleur — un compteur, pas son document.

    Le filtre est celui de la vue publique (`assigned_worker_id` + `status`),
    pour que le palier et le profil public comptent la même chose. Une mission
    supprimée ne compte pas : elle n'a pas eu lieu.
    """
    identifiant = str(worker_id or "").strip()
    if not identifiant:
        return 0
    try:
        return int(
            await db.jobs.count_documents(
                {
                    "assigned_worker_id": identifiant,
                    "status": "completed",
                    "deleted": {"$ne": True},
                }
            )
        )
    except Exception as exc:  # pragma: no cover - dépend du client Mongo
        logger.warning("⚠️ Comptage des missions pour le palier impossible : %s", exc)
        return 0


async def resoudre_taux(worker_id: Optional[str]) -> Dict[str, Any]:
    """Le taux APPLICABLE à ce travailleur, avec son palier et son motif.

    Returns:
        dict: {taux (décimal), palier, motif, missions_terminees,
        taux_standard (décimal)}. `taux_standard` est toujours rendu : l'écran
        qui affiche « 0 % (lancement) » a besoin de dire à côté de quoi c'est
        une remise.
    """
    # Import LOCAL : `kojo_payments` importera ce module pour le devis et le
    # checkout, et un import de module à module au chargement formerait un
    # cycle. Le taux standard reste l'UNIQUE propriétaire de sa résolution
    # (db.settings `commission` puis env), il n'est pas recopié ici.
    from kojo_payments import get_effective_commission_rate

    try:
        taux_standard = float(await get_effective_commission_rate())
    except Exception as exc:  # pragma: no cover - repli de repli
        logger.warning("⚠️ Taux de commission standard illisible : %s", exc)
        taux_standard = 0.0

    config = await configuration()
    complet = await missions_terminees(worker_id)

    if not config.get("actif"):
        return {
            "taux": taux_standard,
            "palier": PALIER_STANDARD,
            "motif": MOTIF_DESACTIVES,
            "missions_terminees": complet,
            "taux_standard": taux_standard,
        }

    if not str(worker_id or "").strip():
        return {
            "taux": taux_standard,
            "palier": PALIER_STANDARD,
            "motif": MOTIF_SANS_TRAVAILLEUR,
            "missions_terminees": complet,
            "taux_standard": taux_standard,
        }

    if config["lancement_missions"] and complet < config["lancement_missions"]:
        return {
            "taux": config["lancement_taux_percent"] / 100.0,
            "palier": PALIER_LANCEMENT,
            "motif": MOTIF_LANCEMENT,
            "missions_terminees": complet,
            "taux_standard": taux_standard,
        }

    if complet >= config["recurrent_missions"]:
        return {
            "taux": config["recurrent_taux_percent"] / 100.0,
            "palier": PALIER_RECURRENT,
            "motif": MOTIF_RECURRENT,
            "missions_terminees": complet,
            "taux_standard": taux_standard,
        }

    return {
        "taux": taux_standard,
        "palier": PALIER_STANDARD,
        "motif": MOTIF_STANDARD,
        "missions_terminees": complet,
        "taux_standard": taux_standard,
    }
