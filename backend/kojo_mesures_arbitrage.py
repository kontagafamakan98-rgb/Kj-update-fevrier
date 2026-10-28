# -*- coding: utf-8 -*-
"""MESURES DE L'ARBITRAGE — ce que l'arbitre ne peut pas voir en regardant SA file.

Pourquoi ces 419 lignes vivent dans un module à part
----------------------------------------------------
Elles ont grandi dans `kojo_job_disputes`, au milieu du module qui DÉCIDE d'un
litige : ouvrir, répondre, retirer, trancher, verser, rembourser. Deux natures
de code y cohabitaient donc — celui qui fait PARTIR DE L'ARGENT et celui qui
COMPTE des délais —, et le module dépassait les 1 200 lignes (mesuré le
27/10/2026). Le coût n'était pas la longueur : au premier correctif sur une
échéance, il fallait relire la mauvaise moitié pour trouver la bonne, et une
mesure qui se trompe ne se voit pas (`_taux` rend `None` sous le plancher, par
dessein), alors qu'une décision qui se trompe vide un séquestre.

Ce module ne décide de RIEN. Il lit l'historique des missions qui portent un
`dispute` et publie des comptes, des délais et des taux. Ses appelants sont la
vue propriétaire (`kojo_routers_owner`) et la relance du planificateur
(`kojo_scheduler`) ; `kojo_job_disputes` les RÉEXPÉDIE, pour qu'aucun appelant
n'ait eu à changer d'import lors du découpage.

Trois règles que ce module tient, et qui se lisent dans ses tests
------------------------------------------------------------------
  * PLANCHER : un taux sur trois litiges est du bruit. Sous `PLANCHER_MESURE`,
    les COMPTES restent publiés (ils sont vrais) et les taux valent `None` —
    l'écran dit « trop peu de litiges », il n'affiche pas un 100 %.
  * BORNE : au-delà de `MAX_MESURES` la lecture est TRONQUÉE et le dit
    (`tronque`) ; une mesure bornée qui se tairait se lirait comme complète.
  * FENÊTRES DÉCLARÉES (`FENETRES_MESURES`) : une fenêtre choisie à la lecture
    rendrait deux mesures incomparables, et un historique long ne dit pas la
    même chose qu'un trimestre.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from kojo_core import db
from kojo_litige_etats import ECHEC, EXPIRE, OUVERT, RETIRE, TRANCHE


def _maintenant() -> datetime:
    """L'instant de la mesure, en UTC.

    Une seule définition pour les mesures ET pour la machine à états du litige
    (`kojo_job_disputes` l'importe d'ici) : deux horloges dans le même dossier
    finiraient par diverger d'une seconde, et cette seconde-là est exactement
    celle qui fait basculer une échéance dans une fenêtre de mesure.
    """
    return datetime.now(timezone.utc)

# MESURES DE L'ARBITRAGE — ce que l'arbitre ne peut pas voir en regardant SA file.
#
# La file dit ce qui reste à faire. Elle ne dit pas si le désaccord trouve sa
# réponse À TEMPS, ni si l'arbitre tranche sans avoir lu l'autre partie, ni
# combien de temps il met — trois questions qui se répondent sur l'HISTORIQUE des
# litiges, jamais sur un seul. Les chiffres sont donc calculés à la demande sur
# les missions qui portent un `dispute`, et publiés là où le propriétaire
# travaille.
#
# PLANCHER : un taux sur trois litiges est du bruit, pas une mesure. Sous
# `PLANCHER_MESURE`, les COMPTES restent publiés (ils sont vrais) et les taux
# valent None — l'écran dit « trop peu de litiges », il n'affiche pas un 100 %.
PLANCHER_MESURE = 10

# Borne de lecture : au-delà, la vue est TRONQUÉE et le dit (`tronque`). Une
# mesure bornée qui se tairait se lirait comme une mesure complète.
MAX_MESURES = 5000

# Les fenêtres que la vue publie, DÉCLARÉES. Une fenêtre choisie à la lecture
# (paramètre libre) rendrait deux mesures incomparables d'un écran à l'autre, et
# un historique long ne dit pas la même chose qu'un trimestre : l'un juge la
# santé actuelle, l'autre ce que l'arbitrage a fait depuis le début.
FENETRES_MESURES = (30, 90)


def _instant(valeur) -> Optional[datetime]:
    """Horodatage ISO d'un litige, ou None s'il est absent/illisible.

    Un `None` n'est jamais remplacé par « maintenant » : une date pourrie
    deviendrait un délai de zéro et flatterait la mesure.
    """
    if not valeur:
        return None
    try:
        return datetime.fromisoformat(str(valeur))
    except (TypeError, ValueError):
        return None


def _heures(secondes: float) -> float:
    return round(secondes / 3600.0, 1)


def _taux(numerateur: int, denominateur: int) -> Optional[float]:
    if denominateur < PLANCHER_MESURE:
        return None
    return round(numerateur / denominateur, 3)


def _conscient(instant: Optional[datetime]) -> Optional[datetime]:
    """Date naïve lue en UTC, date consciente laissée telle quelle."""
    if instant is None or instant.tzinfo is not None:
        return instant
    return instant.replace(tzinfo=timezone.utc)


def _resume_delais(delais: list, incoherents: int) -> dict:
    """Médiane, moyenne et pire d'une liste de délais (en secondes).

    Une liste vide ne devient pas zéro : `n = 0` et des valeurs `None` disent
    qu'aucun délai n'a été mesuré.
    """
    delais = sorted(delais)
    if not delais:
        return {
            "n": 0,
            "mediane_heures": None,
            "moyenne_heures": None,
            "max_heures": None,
            "incoherents": incoherents,
        }
    milieu = len(delais) // 2
    mediane = (
        delais[milieu]
        if len(delais) % 2
        else (delais[milieu - 1] + delais[milieu]) / 2
    )
    return {
        "n": len(delais),
        "mediane_heures": _heures(mediane),
        "moyenne_heures": _heures(sum(delais) / len(delais)),
        "max_heures": _heures(delais[-1]),
        "incoherents": incoherents,
    }


def _mesures_sur_fenetre(jobs: list, jours: int, maintenant: datetime) -> dict:
    """Les mêmes mesures, bornées à une PÉRIODE — deux ancrages distincts.

    Une DÉCISION appartient à la période où elle a été prise (`resolved_at`) ;
    une RÉPONSE à celle où elle est arrivée (`responded_at`). Les deux blocs
    sont donc indépendants : une réponse d'hier dans un litige tranché il y a
    deux mois compte dans les réponses du mois, et pas dans ses décisions —
    c'est ce qui distingue la santé actuelle de l'historique.

    Les exclusions de `mesure_sans_reponse` sont reprises telles quelles : une
    date illisible, future ou hors fenêtre est COMPTÉE, jamais recasée. Une
    réponse datée illisible compte « avec réponse » — la partie a répondu, la
    date manque, et la compter absente gonflerait le chiffre surveillé.
    """
    if maintenant.tzinfo is None:
        maintenant = maintenant.replace(tzinfo=timezone.utc)
    depuis = maintenant - timedelta(days=jours)
    decisions = {
        "total": 0,
        "sans_reponse": 0,
        "avec_reponse": 0,
        "reponse_illisible": 0,
        "hors_fenetre": 0,
        "date_illisible": 0,
        "date_future": 0,
    }
    reponses = {
        "total": 0,
        "avant_echeance": 0,
        "apres_echeance": 0,
        "echeance_illisible": 0,
        "reponse_illisible": 0,
        "hors_fenetre": 0,
        "date_illisible": 0,
        "date_future": 0,
    }
    delais = []
    incoherents = 0

    for job in jobs:
        dispute = job.get("dispute") or {}
        reponse = dispute.get("response") or {}
        instant_reponse = _conscient(_instant(reponse.get("responded_at")))

        if reponse:
            if instant_reponse is None:
                reponses["reponse_illisible"] += 1
            elif instant_reponse > maintenant:
                reponses["date_future"] += 1
            elif instant_reponse < depuis:
                reponses["hors_fenetre"] += 1
            else:
                reponses["total"] += 1
                echeance = _conscient(_instant(dispute.get("decision_deadline_at")))
                if echeance is None:
                    reponses["echeance_illisible"] += 1
                elif instant_reponse <= echeance:
                    reponses["avant_echeance"] += 1
                else:
                    reponses["apres_echeance"] += 1

        if dispute.get("state") != TRANCHE:
            continue
        decision_le = _conscient(_instant(dispute.get("resolved_at")))
        if decision_le is None:
            decisions["date_illisible"] += 1
            continue
        if decision_le > maintenant:
            decisions["date_future"] += 1
            continue
        if decision_le < depuis:
            decisions["hors_fenetre"] += 1
            continue

        decisions["total"] += 1
        if not reponse:
            decisions["sans_reponse"] += 1
        elif instant_reponse is None:
            decisions["avec_reponse"] += 1
            decisions["reponse_illisible"] += 1
        else:
            decisions["avec_reponse"] += 1
            ecart = (decision_le - instant_reponse).total_seconds()
            if ecart < 0:
                # Décision ANTÉRIEURE à la réponse : la donnée se contredit, et
                # un délai négatif tirerait la médiane.
                incoherents += 1
            else:
                delais.append(ecart)

    return {
        "fenetre_jours": jours,
        "depuis": depuis.isoformat(),
        "decisions": {
            **decisions,
            "taux_sans_reponse": _taux(decisions["sans_reponse"], decisions["total"]),
        },
        "reponses": {
            **reponses,
            "taux_avant_echeance": _taux(reponses["avant_echeance"], reponses["total"]),
        },
        "delai_reponse_decision": _resume_delais(delais, incoherents),
    }


async def mesures_arbitrage(limite: int = MAX_MESURES) -> dict:
    """Mesure l'arbitrage sur l'HISTORIQUE des litiges.

    Trois questions, trois réponses MESURÉES :
      1. combien de litiges reçoivent une réponse AVANT leur échéance
         (`response.responded_at` ≤ `decision_deadline_at`) ;
      2. combien de litiges sont TRANCHÉS sans qu'aucune réponse n'existe —
         l'arbitre a décidé sur une seule version ;
      3. quel délai sépare la réponse de la décision (médiane, moyenne, pire).

    Rien n'est inventé : les dénominateurs sont publiés avec les taux, les taux
    valent `None` sous `PLANCHER_MESURE`, une date illisible est COMPTÉE au lieu
    de devenir « maintenant » (`incoherents`, `echeance_illisible`), et une
    lecture bornée dit qu'elle l'est (`tronque`).

    Le bloc `fenetres` rend les MÊMES trois questions sur `FENETRES_MESURES`
    (30 et 90 jours) : l'historique entier mélange une décision d'il y a six
    mois et celle d'hier, donc il ne dit pas si l'arbitrage va mieux.
    """
    maintenant = _maintenant()
    filtre = {"dispute.opened_at": {"$exists": True}, "deleted": {"$ne": True}}
    jobs = await db.jobs.find(
        filtre, {"dispute": 1, "id": 1, "job_id": 1, "_id": 0}
    ).to_list(limite)
    total = await db.jobs.count_documents(filtre)

    etats = {OUVERT: 0, EXPIRE: 0, TRANCHE: 0, RETIRE: 0, ECHEC: 0}
    avec_reponse = 0
    avant_echeance = 0
    apres_echeance = 0
    echeance_illisible = 0
    # Une réponse SANS date lisible n'est ni « à temps » ni « absente » : la
    # compter comme absente gonflerait le nombre de décisions prises sans lire
    # l'autre partie, c'est-à-dire exactement ce que cette mesure surveille.
    reponse_illisible = 0
    tranches = 0
    tranches_sans_reponse = 0
    tranches_avec_reponse = 0
    delais = []
    incoherents = 0
    ouverture_min = None

    for job in jobs:
        dispute = job.get("dispute") or {}
        etat = dispute.get("state")
        if etat in etats:
            etats[etat] += 1
        else:
            # Un état inconnu ne disparaît pas : il compte à part.
            etats[etat] = etats.get(etat, 0) + 1

        ouverture = _instant(dispute.get("opened_at"))
        if ouverture and (ouverture_min is None or ouverture < ouverture_min):
            ouverture_min = ouverture

        reponse = dispute.get("response") or {}
        instant_reponse = _instant(reponse.get("responded_at"))
        if reponse and not instant_reponse:
            reponse_illisible += 1
        if instant_reponse:
            avec_reponse += 1
            echeance = _instant(dispute.get("decision_deadline_at"))
            if echeance is None:
                echeance_illisible += 1
            else:
                try:
                    if instant_reponse <= echeance:
                        avant_echeance += 1
                    else:
                        apres_echeance += 1
                except TypeError:
                    # Naïf contre conscient : une comparaison impossible ne
                    # devient pas un « à temps ».
                    echeance_illisible += 1

        if etat == TRANCHE:
            tranches += 1
            if not reponse:
                tranches_sans_reponse += 1
            elif instant_reponse:
                tranches_avec_reponse += 1

            decision_le = _instant(dispute.get("resolved_at"))
            if instant_reponse and decision_le:
                try:
                    ecart = (decision_le - instant_reponse).total_seconds()
                except TypeError:
                    incoherents += 1
                else:
                    if ecart < 0:
                        # Décision ANTÉRIEURE à la réponse : la donnée se
                        # contredit, et un délai négatif tirerait la médiane.
                        incoherents += 1
                    else:
                        delais.append(ecart)

    return {
        "mesure_le": maintenant.isoformat(),
        "plancher": PLANCHER_MESURE,
        "depuis": ouverture_min.isoformat() if ouverture_min else None,
        "litiges": {
            "total": total,
            "lus": len(jobs),
            "tronque": total > len(jobs),
        },
        "etats": etats,
        "reponse": {
            "avec_reponse": avec_reponse,
            "avant_echeance": avant_echeance,
            "apres_echeance": apres_echeance,
            "echeance_illisible": echeance_illisible,
            "reponse_illisible": reponse_illisible,
            "taux_avant_echeance": _taux(avant_echeance, avec_reponse),
        },
        "tranches": {
            "total": tranches,
            "sans_reponse": tranches_sans_reponse,
            "avec_reponse": tranches_avec_reponse,
            "taux_sans_reponse": _taux(tranches_sans_reponse, tranches),
        },
        "delai_reponse_decision": _resume_delais(delais, incoherents),
        # Les fenêtres se calculent sur les MÊMES lignes lues : aucune requête
        # de plus, donc deux mesures qui ne peuvent pas porter sur deux vues
        # différentes de la base.
        "fenetres": [_mesures_sur_fenetre(jobs, jours, maintenant) for jours in FENETRES_MESURES],
    }


async def mesure_sans_reponse(
    jours: int, limite: int = MAX_MESURES, maintenant: Optional[datetime] = None
) -> dict:
    """Part des litiges TRANCHÉS sans réponse, sur une FENÊTRE GLISSANTE.

    `mesures_arbitrage` répond sur tout l'historique ; une alerte a besoin d'une
    PÉRIODE, sinon une vieille décision masque un changement récent (ou
    l'inverse). Le filtre porte donc sur `dispute.resolved_at` — l'instant de la
    DÉCISION — et non sur `opened_at` : un litige ouvert il y a six mois et
    tranché hier appartient à la période d'aujourd'hui.

    Trois exclusions, toutes PUBLIÉES, jamais fondues dans le dénominateur :
      • `resolved_at` illisible — on ne sait pas la dater, donc on ne la compte
        ni dans la période ni dans « sans réponse » ;
      • `resolved_at` dans le FUTUR — la donnée se contredit, et la compter
        ferait entrer une décision qui n'a pas eu lieu ;
      • décision antérieure à `depuis` — `hors_fenetre`, et le compte est vrai.

    Une réponse dont la date est illisible n'est PAS une absence de réponse :
    la partie a répondu, c'est sa date qui manque. La compter comme absente
    gonflerait exactement le chiffre que cette mesure surveille.

    Un taux sous `PLANCHER_MESURE` vaut `None` : c'est la même règle que la vue
    de la file, et l'alerte ne part pas sur trois litiges.
    """
    maintenant = maintenant or _maintenant()
    if maintenant.tzinfo is None:
        maintenant = maintenant.replace(tzinfo=timezone.utc)
    depuis = maintenant - timedelta(days=jours)

    filtre = {
        "dispute.state": TRANCHE,
        "dispute.resolved_at": {"$exists": True},
        "deleted": {"$ne": True},
    }
    jobs = await db.jobs.find(filtre, {"dispute": 1, "_id": 0}).to_list(limite)
    total = await db.jobs.count_documents(filtre)

    tranches = 0
    sans_reponse = 0
    avec_reponse = 0
    reponse_illisible = 0
    hors_fenetre = 0
    date_illisible = 0
    date_future = 0

    for job in jobs:
        dispute = job.get("dispute") or {}
        decision_le = _instant(dispute.get("resolved_at"))
        if decision_le is None:
            date_illisible += 1
            continue
        if decision_le.tzinfo is None:
            # Une date naïve est lue en UTC : c'est l'instant que la base
            # conserve, et la comparer telle quelle à une date consciente
            # lèverait un TypeError qui ferait disparaître la décision.
            decision_le = decision_le.replace(tzinfo=timezone.utc)
        if decision_le > maintenant:
            date_future += 1
            continue
        if decision_le < depuis:
            hors_fenetre += 1
            continue

        tranches += 1
        reponse = dispute.get("response") or {}
        if not reponse:
            sans_reponse += 1
        else:
            avec_reponse += 1
            if not _instant(reponse.get("responded_at")):
                reponse_illisible += 1

    taux = None
    if tranches >= PLANCHER_MESURE:
        taux = round(sans_reponse / tranches, 3)

    return {
        "mesure_le": maintenant.isoformat(),
        "fenetre_jours": jours,
        "depuis": depuis.isoformat(),
        "plancher": PLANCHER_MESURE,
        "litiges": {
            "total": total,
            "lus": len(jobs),
            "tronque": total > len(jobs),
        },
        "tranches": {
            "total": tranches,
            "sans_reponse": sans_reponse,
            "avec_reponse": avec_reponse,
            "reponse_illisible": reponse_illisible,
            "taux_sans_reponse": taux,
        },
        "hors_fenetre": hors_fenetre,
        "resolved_at_illisible": date_illisible,
        "resolved_at_futur": date_future,
    }


__all__ = [
    "PLANCHER_MESURE",
    "MAX_MESURES",
    "FENETRES_MESURES",
    "mesures_arbitrage",
    "mesure_sans_reponse",
]
