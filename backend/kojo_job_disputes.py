# -*- coding: utf-8 -*-
"""Litige tracé : un désaccord a un ÉTAT, une ÉCHÉANCE et une DÉCISION.

LE TROU QUE CE MODULE FERME

Le séquestre à deux temps (`kojo_job_completion`) avait réglé le client
silencieux. Il n'avait rien réglé du client qui CONTESTE : la seule voie était
un ticket support, sans état, sans échéance et sans trace — et l'échéance de
libération automatique payait le travailleur sans qu'aucun arbitre ait lu le
désaccord. Un litige déclaré et un client injoignable produisaient donc le même
geste, ce qui est exactement l'inverse de ce qu'un désaccord demande.

CE QUI EXISTE MAINTENANT

  1. une partie OUVRE un litige (`POST /jobs/{id}/dispute`) : motif obligatoire,
     échéance d'arbitrage posée, l'autre partie ET le propriétaire prévenus ;
  2. tant qu'il est OUVERT, l'argent ne bouge pas : ni la validation du client,
     ni la libération automatique ne versent (les deux chemins passent par
     `litige_bloquant`) — une contestation qui n'empêche pas le versement ne
     protège rien ;
  3. l'AUTRE partie répond, UNE fois (`POST /jobs/{id}/dispute/response`) : une
     POSITION (`release_worker` ou `refund_client`, le vocabulaire de la
     décision) et une note bornée. Sans elle, l'arbitre ne lisait qu'un son de
     cloche : la version de celui qui conteste ;
  4. la partie qui a ouvert peut le RETIRER (accord retrouvé) ;
  5. le PROPRIÉTAIRE tranche (`POST /owner/missions/{id}/litige/decision`) :
     verser le travailleur ou rembourser le client, sur les DEUX versions. Une
     décision qui n'aboutit PAS (séquestre introuvable, décaissement refusé,
     argent déjà en route) ne referme rien : l'état devient `decision_failed`,
     l'essai est journalisé avec son CODE d'échec, et la décision peut être
     RELANCÉE — refermer le désaccord sur un versement qui n'a pas eu lieu
     laisserait les deux parties avec une décision sans argent ;
  6. l'ÉCHÉANCE fait foi : passée sans décision, le litige se referme et la
     règle ordinaire reprend (le silence prolongé favorise le travailleur, comme
     `COMPLETION_AUTO_RELEASE_DAYS`). Une fenêtre d'arbitrage sans conséquence
     serait une fenêtre décorative.

CE QUI N'EST PAS DUPLIQUÉ

Le versement a UN propriétaire (`kojo_job_completion.liberer_sequestre`), le
remboursement aussi (`kojo_job_refunds.execute_paydunya_refund`) : la décision
du propriétaire les APPELLE, elle ne réimplémente ni le verrou CAS, ni l'anti
double-versement, ni l'IPN. La seule chose que ce module possède, c'est l'état
du désaccord et son journal.

CE QUI EST ASSUMÉ

- Un litige ne crée pas un statut de mission : la mission reste `in_progress`
  jusqu'à ce que l'argent parte.
- Une décision de remboursement ferme la mission en `cancelled` (l'argent est
  revenu au client) ; une décision de versement la clôture par le chemin
  normal (`completed`).
- Le motif d'un litige n'entre JAMAIS dans `business_events` : le journal ne
  garde que des faits énumérés (`decision`, `paiement`, `echeance`, `position`),
  parce qu'un motif est écrit par une partie et peut porter un nom ou une
  adresse. La note de réponse, écrite par l'autre partie, est de la même
  nature : seule la POSITION qu'elle demande entre au journal.
- Une réponse est UNIQUE et non modifiable : une partie qui pourrait réécrire sa
  version après avoir lu celle de l'autre (ou la décision qui se prépare)
  transformerait l'arbitrage en négociation, et le journal en brouillon.
- Un `decision_failed` GELE encore l'argent, sans échéance : l'alternative était
  de payer l'autre partie que le propriétaire n'a pas choisie. Le prix est dit :
  si personne ne relance, le séquestre reste retenu — c'est pourquoi l'essai
  rate figure en TÊTE de la file d'arbitrage, avec son remède, et non quelque
  part dans l'historique.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

import kojo_job_effects as effets
from kojo_business_events import enregistrer_evenement
from kojo_core import db
from kojo_identifiants import identifiant_job_query, identifiant_query
from kojo_job_completion import liberer_sequestre
from kojo_job_refunds import execute_paydunya_refund
from kojo_models import JobStatus, NotificationType
from kojo_settings import LITIGE_DECISION_DAYS, OWNER_USER_ID, logger
# Les MESURES de l'arbitrage vivent dans leur PROPRE module (27/10/2026) :
# 419 lignes de comptes, de délais et de taux cohabitaient avec le code qui
# fait partir de l'argent, et un correctif sur une échéance devait relire la
# mauvaise moitié pour trouver la bonne. Le découpage ne change AUCUN
# appelant : les noms sont réexportés ici, parce que `kojo_scheduler` et
# `kojo_routers_owner` les importent depuis ce module. `_maintenant` est
# importé pour la même raison : une seule horloge pour les échéances et pour
# les fenêtres de mesure.
from kojo_mesures_arbitrage import (  # noqa: F401 — réexport assumé, cf. ci-dessus
    FENETRES_MESURES,
    MAX_MESURES,
    PLANCHER_MESURE,
    _maintenant,
    mesure_sans_reponse,
    mesures_arbitrage,
)

# Les ÉTATS eux-mêmes vivent dans `kojo_litige_etats` (27/10/2026) : les
# mesures d'arbitrage les lisent aussi, et leur faire importer le module qui
# fait partir de l'argent aurait recréé le mélange que ce découpage défait.
# Une seule définition, aucun comportement.
from kojo_litige_etats import ECHEC, EXPIRE, OUVERT, RETIRE, TRANCHE  # noqa: E402

# États de `job.dispute`. Ils décrivent le DÉSACCORD, pas la mission.

# Décision TENTÉE, argent NON bougé : le propriétaire a tranché, le chemin de
# paiement a refusé (ou n'a rien pu faire), et rien n'a été versé ni remboursé.
# Refermer le désaccord dans cet état-ci serait le silence que le litige tracé
# existe pour fermer : la fiche dirait « tranché », les notifications diraient
# « versé », et le compte n'aurait rien reçu.

# Les deux états qui gèlent l'argent. `expired` est une fenêtre refermée SANS
# décision : la règle ordinaire reprend, sinon un propriétaire injoignable
# bloquerait le paiement pour toujours — le trou que tout ce séquestre ferme.
# `decision_failed` gèle : une décision de REMBOURSER qui n'a pas abouti ne doit
# pas être défaite par la libération automatique, qui verserait l'autre partie.
ETATS_BLOQUANTS = (OUVERT, ECHEC)

# Codes d'échec d'une décision. Ce sont des FAITS énumérés (ils entrent dans
# `business_events` et dans la file d'arbitrage), jamais la phrase du
# fournisseur : elle peut porter un compte ou un message libre.
ECHEC_SEQUESTRE_INTROUVABLE = "sequestre_introuvable"
ECHEC_DEJA_EN_MOUVEMENT = "deja_en_mouvement"
ECHEC_VERSEMENT_REFUSE = "versement_refuse"
ECHEC_REMBOURSEMENT_REFUSE = "remboursement_refuse"

# Ce que chaque code demande au propriétaire : une décision d'échec sans remède
# nommé serait une trace qu'on relit sans savoir quoi en faire.
REMEDES_ECHEC = {
    ECHEC_SEQUESTRE_INTROUVABLE: "Aucun paiement séquestré à mouvementer sur cette mission : vérifier le paiement, puis relancer.",
    ECHEC_DEJA_EN_MOUVEMENT: "L'argent de cette mission est déjà en route : attendre la confirmation (IPN ou vérification de statut) avant de relancer.",
    ECHEC_VERSEMENT_REFUSE: "Le versement au travailleur a été refusé (compte de décaissement ou fournisseur) : corriger la cause, puis relancer la décision.",
    ECHEC_REMBOURSEMENT_REFUSE: "Le remboursement du client a été refusé (compte de décaissement ou fournisseur) : corriger la cause, puis relancer la décision.",
}

DECISION_VERSER = "release_worker"
DECISION_REMBOURSER = "refund_client"
DECISIONS = (DECISION_VERSER, DECISION_REMBOURSER)

# Bornes de la note de réponse : les mêmes que le motif. Le motif dit ce que
# l'ouvreur reproche, la note ce que l'autre partie oppose ; les deux se lisent
# CÔTE À CÔTE pour trancher, donc les deux se bornent pareil.
NOTE_MIN = 20
NOTE_MAX = 1000

# Un passage borné : un arriéré de mille litiges ne doit pas tenir la boucle.
MAX_LITIGES_PAR_PASSAGE = 50


def _date_fr(valeur_iso: Optional[str]) -> str:
    """Date lisible d'une échéance (`JJ/MM/AAAA`), jamais un ISO brut dans un
    message destiné à un utilisateur."""
    if not valeur_iso:
        return ""
    try:
        return datetime.fromisoformat(str(valeur_iso)).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return str(valeur_iso)


def etat_litige(job: dict) -> Optional[str]:
    return ((job or {}).get("dispute") or {}).get("state")


def litige_bloquant(job: dict) -> bool:
    """Vrai quand l'argent ne doit PAS bouger tant que le désaccord vit.

    Appelé par les deux chemins qui versent (validation du client, libération
    automatique). Une seule définition : deux copies finiraient par diverger, et
    c'est le versement qui paierait la divergence.
    """
    return etat_litige(job) in ETATS_BLOQUANTS


def _role(acteur_id: str, job: dict) -> Optional[str]:
    if str(job.get("client_id") or "") == str(acteur_id):
        return "client"
    if str(job.get("assigned_worker_id") or "") == str(acteur_id):
        return "worker"
    return None


async def _notifier_owner(cle: str, **contexte) -> None:
    """Prévient le PROPRIÉTAIRE, résolu par email (`kojo_owner.resolve_owner_id`).

    Sans compte propriétaire résolu, le fait reste dans le journal de la mission
    et dans la file d'arbitrage (`GET /owner/litiges`) : on ne perd pas le
    litige, on perd seulement le push — et c'est écrit.
    """
    try:
        from kojo_owner import resolve_owner_id

        # Le compte owner se résout par EMAIL ; le repli sur l'identifiant
        # configuré est celui que les autres appelants appliquent déjà.
        owner_id = await resolve_owner_id() or (OWNER_USER_ID or None)
        if not owner_id:
            logger.warning("⚠️ Litige: aucun compte propriétaire résolu, pas de notification owner.")
            return
    except Exception as exc:  # noqa: BLE001 - une notification ne bloque pas le litige
        logger.error(f"⚠️ Litige: résolution du propriétaire impossible: {exc}")
        return

    asyncio.create_task(effets.notify_user_localized(
        user_id=owner_id,
        key=cle,
        notif_type=NotificationType.GENERAL,
        related_id=contexte.get("job_id"),
        related_type="job",
        # `job_id` reste dans l'interpolation : le corps de l'alerte cite la
        # route exacte du journal de CETTE mission.
        **contexte,
    ))


async def ouvrir_litige(job: dict, *, acteur_id: str, motif: str) -> dict:
    """Ouvre un litige sur une mission en cours, et GÈLE le paiement.

    Lève HTTPException :
      * 403 si l'appelant n'est ni le client ni le travailleur attribué ;
      * 400 si la mission n'est pas en cours, ou n'a pas de travailleur ;
      * 409 si un litige est déjà ouvert.
    """
    job_id = job.get("id")
    role = _role(acteur_id, job)
    if role is None:
        raise HTTPException(status_code=403, detail="Seuls le client et le travailleur attribué peuvent ouvrir un litige")

    if job.get("status") == JobStatus.COMPLETED.value:
        raise HTTPException(status_code=409, detail="Cette mission est déjà réglée : un litige ne peut plus être ouvert")
    if job.get("status") != JobStatus.IN_PROGRESS.value:
        raise HTTPException(status_code=400, detail="Un litige ne s'ouvre que sur une mission en cours")
    if not job.get("assigned_worker_id"):
        raise HTTPException(status_code=400, detail="Aucun travailleur attribué à cette mission")

    if litige_bloquant(job):
        raise HTTPException(status_code=409, detail="Un litige est déjà ouvert sur cette mission")

    maintenant = _maintenant()
    echeance = maintenant + timedelta(days=LITIGE_DECISION_DAYS)
    dispute = {
        "state": OUVERT,
        "reason": motif,
        "opened_by": acteur_id,
        "opened_by_role": role,
        "opened_at": maintenant.isoformat(),
        "decision_deadline_at": echeance.isoformat(),
        "expired_at": None,
        "resolved_at": None,
        "decision": None,
        "decision_note": None,
        "decided_by": None,
        "payment_outcome": None,
        "withdrawn_at": None,
    }

    # CAS sur `dispute.state` : deux ouvertures concurrentes (double clic) ne
    # doivent pas produire deux litiges ni deux jalons.
    resultat = await db.jobs.update_one(
        {
            **identifiant_job_query(job_id),
            "dispute.state": {"$ne": OUVERT},
        },
        {"$set": {"dispute": dispute}},
    )
    if resultat.matched_count == 0:
        raise HTTPException(status_code=409, detail="Un litige est déjà ouvert sur cette mission")

    await enregistrer_evenement(
        "mission_dispute_opened",
        f"mission_dispute_opened:{job_id}:{dispute['opened_at']}",
        user_id=acteur_id,
        job_id=job_id,
        details={"echeance": dispute["decision_deadline_at"]},
    )

    autre_partie = job.get("client_id") if role == "worker" else job.get("assigned_worker_id")
    cle_autre = "dispute_opened_client" if role == "worker" else "dispute_opened_worker"
    if autre_partie:
        asyncio.create_task(effets.notify_user_localized(
            user_id=autre_partie,
            key=cle_autre,
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            job_title=job.get("title") or "",
            date=_date_fr(dispute["decision_deadline_at"]),
        ))
    await _notifier_owner(
        "dispute_opened_owner",
        job_id=job_id,
        job_title=job.get("title") or "",
        date=_date_fr(dispute["decision_deadline_at"]),
    )

    return {
        "message": "Litige ouvert. Le paiement est gelé jusqu'à la décision du propriétaire.",
        "dispute": dispute,
    }


async def retirer_litige(job: dict, *, acteur_id: str) -> dict:
    """La partie qui a OUVERT le litige le retire (accord retrouvé).

    Seul l'ouvreur peut le retirer : laisser l'autre partie débloquer l'argent
    reviendrait à donner au débiteur la clé du séquestre.

    Lève 403 (pas l'ouvreur), 409 (aucun litige ouvert).
    """
    if not litige_bloquant(job):
        raise HTTPException(status_code=409, detail="Aucun litige ouvert sur cette mission")

    dispute = job.get("dispute") or {}
    if str(dispute.get("opened_by") or "") != str(acteur_id):
        raise HTTPException(status_code=403, detail="Seule la partie qui a ouvert le litige peut le retirer")

    job_id = job.get("id")
    maintenant = _maintenant().isoformat()
    resultat = await db.jobs.update_one(
        {**identifiant_job_query(job_id), "dispute.state": OUVERT},
        {"$set": {"dispute.state": RETIRE, "dispute.withdrawn_at": maintenant}},
    )
    if resultat.matched_count == 0:
        raise HTTPException(status_code=409, detail="Ce litige n'est plus ouvert")

    await enregistrer_evenement(
        "mission_dispute_withdrawn",
        f"mission_dispute_withdrawn:{job_id}:{maintenant}",
        user_id=acteur_id,
        job_id=job_id,
    )

    autre_partie = (
        job.get("assigned_worker_id")
        if str(dispute.get("opened_by")) == str(job.get("client_id"))
        else job.get("client_id")
    )
    if autre_partie:
        asyncio.create_task(effets.notify_user_localized(
            user_id=autre_partie,
            key="dispute_withdrawn",
            notif_type=NotificationType.GENERAL,
            related_id=job_id,
            related_type="job",
            job_title=job.get("title") or "",
        ))

    return {
        "message": "Litige retiré. Le paiement suit à nouveau la règle ordinaire.",
        "dispute": {**dispute, "state": RETIRE, "withdrawn_at": maintenant},
    }


async def repondre_litige(job: dict, *, acteur_id: str, position: str, note: str) -> dict:
    """L'AUTRE partie oppose sa version, une seule fois, avec sa POSITION.

    Lève HTTPException :
      * 403 si l'appelant n'est pas une partie, ou s'il est celui qui a OUVERT
        le litige (sa version, c'est le motif — il l'a déjà écrite) ;
      * 409 si aucun litige n'est ouvert, ou si une réponse existe déjà.

    La position emploie le vocabulaire de la DÉCISION (`release_worker`,
    `refund_client`) : l'arbitre lit ainsi ce que chaque côté DEMANDE dans les
    termes exacts de ce qu'il devra choisir, sans une troisième nomenclature.
    """
    role = _role(acteur_id, job)
    if role is None:
        raise HTTPException(status_code=403, detail="Seuls le client et le travailleur attribué peuvent répondre au litige")

    if position not in DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Position inconnue : {position!r} (attendu : {' ou '.join(DECISIONS)})",
        )

    if not litige_bloquant(job):
        raise HTTPException(status_code=409, detail="Aucun litige ouvert sur cette mission")

    dispute = job.get("dispute") or {}
    if str(dispute.get("opened_by") or "") == str(acteur_id):
        raise HTTPException(
            status_code=403,
            detail="La partie qui a ouvert le litige s'est déjà exprimée par son motif : c'est à l'autre partie de répondre",
        )
    if dispute.get("response"):
        raise HTTPException(status_code=409, detail="Une réponse a déjà été enregistrée pour ce litige")

    job_id = job.get("id")
    reponse = {
        "position": position,
        "note": note,
        "author_id": acteur_id,
        "author_role": role,
        "responded_at": _maintenant().isoformat(),
    }

    # CAS sur la réponse ABSENTE : deux envois concurrents (double clic) ne
    # doivent pas produire deux versions ni deux jalons. Filtre d'ÉGALITÉ sur
    # `null` (le document n'a pas de clé, Mongo l'égale à null), jamais un
    # `$exists` : la règle reste la même que pour les autres verrous.
    resultat = await db.jobs.update_one(
        {
            **identifiant_job_query(job_id),
            "dispute.state": OUVERT,
            "dispute.response": None,
        },
        {"$set": {"dispute.response": reponse}},
    )
    if resultat.matched_count == 0:
        raise HTTPException(status_code=409, detail="Une réponse a déjà été enregistrée pour ce litige")

    await enregistrer_evenement(
        "mission_dispute_answered",
        f"mission_dispute_answered:{job_id}",
        user_id=acteur_id,
        job_id=job_id,
        details={"position": position},
    )

    # Le propriétaire est prévenu : c'est MAINTENANT qu'il a les deux versions
    # sous les yeux, donc le moment où la file d'arbitrage devient actionnable.
    await _notifier_owner(
        "dispute_answered_owner",
        job_id=job_id,
        job_title=job.get("title") or "",
    )

    return {
        "message": "Réponse enregistrée. Le propriétaire tranchera sur les deux versions.",
        "dispute": {**dispute, "response": reponse},
    }


def _verifier_decision(decision: str) -> None:
    if decision not in DECISIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Décision inconnue : {decision!r} (attendu : {' ou '.join(DECISIONS)})",
        )


# Issues qui PROUVENT que l'argent a bougé (ou est parti et sera tranché par
# l'IPN). Tout le reste est un échec : une décision qui ne peut pas prouver le
# versement ne se referme pas comme si elle l'avait obtenu.
_VERSEMENTS_ABOUTIS = ("released", "releasing")
_REMBOURSEMENTS_ABOUTIS = ("refunded", "refunding")


def _echec_de_decision(decision: str, paiement: str) -> Optional[str]:
    """Code d'échec d'une tentative de décision, ou `None` si l'argent a bougé."""
    if decision == DECISION_VERSER:
        return None if paiement in _VERSEMENTS_ABOUTIS else ECHEC_VERSEMENT_REFUSE
    return None if paiement in _REMBOURSEMENTS_ABOUTIS else ECHEC_REMBOURSEMENT_REFUSE


async def _raison_de_l_echec(job_id: str) -> str:
    """Motif LISIBLE du chemin de paiement (compte absent, refus fournisseur)."""
    paiement = await db.payments.find_one(
        {"job_id": job_id, "status": "completed"}, sort=[("created_at", -1)]
    )
    return str((paiement or {}).get("payout_failure_reason") or "")


async def _tracer_decision_echouee(
    job: dict, *, owner_id: str, decision: str, echec: str, paiement: Optional[str] = None
) -> None:
    """Trace l'essai SANS refermer le désaccord.

    L'état `decision_failed` est BLOQUANT et reste dans la file d'arbitrage :
    une décision de rembourser qui n'a pas abouti ne doit pas être défaite par la
    libération automatique, qui verserait le travailleur entre-temps.

    Le document ne reçoit NI `decision` NI `decision_note` : le litige voyage
    avec la mission et ses parties peuvent le lire, or une décision non exécutée
    n'a rien à leur annoncer. La tentative et son code d'échec suffisent à
    l'action (relancer), et le JALON — côté propriétaire — garde la décision.
    """
    job_id = job.get("id")
    instant = _maintenant().isoformat()
    maj = {
        "dispute.state": ECHEC,
        "dispute.decision_failure": echec,
        "dispute.decision_attempted_at": instant,
    }
    if paiement:
        maj["dispute.payment_outcome"] = paiement
    await db.jobs.update_one(
        {
            **identifiant_job_query(job_id),
            "dispute.state": {"$in": [OUVERT, EXPIRE, ECHEC]},
        },
        {"$set": maj},
    )

    details = {"decision": decision, "echec": echec}
    if paiement:
        details["paiement"] = paiement
    await enregistrer_evenement(
        "mission_dispute_decision_failed",
        # La clé porte l'instant : une relance qui échoue encore est un SECOND
        # fait, pas le même événement rejoué.
        f"mission_dispute_decision_failed:{job_id}:{instant}",
        user_id=owner_id,
        job_id=job_id,
        details=details,
    )


async def _verser_travailleur(job: dict, *, owner_id: str) -> tuple[str, str]:
    """Décision « verser le travailleur » : passe par l'UNIQUE libération."""
    resultat = await liberer_sequestre(job, acteur_id=owner_id)
    payout_status = resultat.get("payout_status") or ""

    # Une déclaration qui existait devient « validée » : l'argent est parti sur
    # décision, pas sur validation du client. Sans cette écriture, l'écran
    # continuerait d'afficher « en attente de validation » sur une mission payée.
    # Seulement si le versement a ABOUTI : confirmer une déclaration sur un refus
    # ferait dire « validé » à une mission dont le compte n'a rien reçu.
    if payout_status in _VERSEMENTS_ABOUTIS and (job.get("completion") or {}).get("state") == "marked":
        await db.jobs.update_one(
            {**identifiant_job_query(job.get("id"))},
            {"$set": {
                "completion.state": "confirmed",
                "completion.confirmed_at": _maintenant().isoformat(),
            }},
        )
    return payout_status, resultat.get("message") or ""


async def _rembourser_client(job: dict, *, owner_id: str) -> tuple[str, float]:
    """Décision « rembourser le client » : passe par l'UNIQUE remboursement.

    Le verrou CAS (`held`/`release_failed`/`refund_failed` → `refunding`) est
    posé ICI, comme le font les autres appelants de `execute_paydunya_refund`
    (annulation de mission, suppression de compte, relance propriétaire).
    """
    job_id = job.get("id")
    payment_record = await db.payments.find_one(
        {"job_id": job_id, "status": "completed"}, sort=[("created_at", -1)]
    )
    if not payment_record:
        raise HTTPException(
            status_code=400,
            detail="Aucun paiement séquestré à rembourser sur cette mission.",
        )

    payout_status = payment_record.get("payout_status") or "held"
    if payout_status in ("released", "releasing", "refunding", "refunded"):
        raise HTTPException(
            status_code=409,
            detail=f"L'argent de cette mission est déjà en mouvement ({payout_status}) : décision impossible.",
        )

    maintenant = _maintenant().isoformat()
    verrou = await db.payments.update_one(
        {**identifiant_query(payment_record["id"]), "payout_status": payout_status},
        effets.maj_sequestre("refunding", {"payout_kind": "refund", "updated_at": maintenant}),
    )
    if verrou.matched_count == 0:
        raise HTTPException(status_code=409, detail="Un remboursement est déjà en cours pour cette mission")

    issue = await execute_paydunya_refund(payment_record)

    await db.jobs.update_one(
        {**identifiant_job_query(job_id)},
        {"$set": {
            "status": JobStatus.CANCELLED.value,
            "cancelled_at": maintenant,
            "cancelled_by": owner_id,
        }},
    )
    return issue, float(payment_record.get("amount") or 0)


async def decider_litige(
    job: dict, *, owner_id: str, decision: str, note: str
) -> dict:
    """Le propriétaire TRANCHE : verse le travailleur ou rembourse le client.

    Autorisé tant que le litige est `open`, `expired` ou `decision_failed` ET
    que l'argent n'a pas déjà bougé : une fenêtre refermée n'interdit pas de
    rattraper un versement qui n'a pas eu lieu, elle interdit seulement d'en
    inventer un second — et un essai qui a échoué est précisément un versement
    qui n'a pas eu lieu, donc il se relance.

    Une décision n'est enregistrée comme TRANCHEE que si l'argent a bougé (ou
    est en route) ; sinon `_tracer_decision_echouee` laisse le désaccord vivant
    avec son code d'échec, et rien n'est annoncé aux parties.
    """
    _verifier_decision(decision)

    etat = etat_litige(job)
    if etat not in (OUVERT, EXPIRE, ECHEC):
        raise HTTPException(status_code=409, detail="Aucun litige à trancher sur cette mission")

    job_id = job.get("id")
    # Une mission close après un échec de VERSEMENT n'est pas « réglée » : c'est
    # exactement l'état que la relance doit reprendre. Le refus de payer a
    # clôturé la mission administrativement, pas soldé le séquestre, et
    # `liberer_sequestre` accepte ce cas précis (`release_failed`).
    if job.get("status") == JobStatus.COMPLETED.value and etat != ECHEC:
        raise HTTPException(status_code=409, detail="Cette mission est déjà réglée : plus rien à trancher")

    montant = 0.0
    message_paiement = ""
    try:
        if decision == DECISION_VERSER:
            paiement, message_paiement = await _verser_travailleur(job, owner_id=owner_id)
        else:
            paiement, montant = await _rembourser_client(job, owner_id=owner_id)
    except HTTPException as exc:
        # Refus AVANT tout mouvement d'argent (séquestre introuvable, paiement
        # déjà en route, mission close autrement) : rien n'est tranché, mais
        # l'essai laisse une trace actionnable. Un refus sans trace se relisait
        # comme « je n'ai jamais essayé », et le désaccord restait dans la file
        # sans que rien ne dise pourquoi la décision ne passait pas.
        echec = ECHEC_DEJA_EN_MOUVEMENT if exc.status_code == 409 else ECHEC_SEQUESTRE_INTROUVABLE
        await _tracer_decision_echouee(
            job, owner_id=owner_id, decision=decision, echec=echec
        )
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"{exc.detail} {REMEDES_ECHEC[echec]}",
        ) from exc

    echec = _echec_de_decision(decision, paiement)
    if echec:
        # Le chemin de paiement a RÉPONDU (refus sûr), mais rien n'est parti.
        # La décision n'est pas enregistrée comme tranchée : on garde le fait,
        # le code d'échec et le remède, et la porte reste ouverte à la relance.
        await _tracer_decision_echouee(
            job, owner_id=owner_id, decision=decision, echec=echec, paiement=paiement
        )
        raison = await _raison_de_l_echec(job_id) or message_paiement
        logger.warning(
            "⚠️ Litige %s : décision %s NON exécutée (%s, %s)",
            job_id, decision, echec, paiement,
        )
        return {
            "message": " ".join(
                partie for partie in (REMEDES_ECHEC[echec], raison) if partie
            ),
            "decision": decision,
            "payment_outcome": paiement,
            "dispute_state": ECHEC,
            "echec": echec,
            "relance": True,
        }

    maintenant = _maintenant().isoformat()
    await db.jobs.update_one(
        {**identifiant_job_query(job_id), "dispute.state": {"$in": [OUVERT, EXPIRE, ECHEC]}},
        {
            "$set": {
                "dispute.state": TRANCHE,
                "dispute.decision": decision,
                "dispute.decision_note": note,
                "dispute.decided_by": owner_id,
                "dispute.resolved_at": maintenant,
                "dispute.payment_outcome": paiement,
            },
            # Une RELANCE qui aboutit efface l'échec précédent de l'état courant :
            # la fiche dit « tranché », pas « tranché mais un jour échoué ». La
            # tentative ratée reste dans le journal, qui est son lieu.
            "$unset": {"dispute.decision_failure": "", "dispute.decision_attempted_at": ""},
        },
    )

    await enregistrer_evenement(
        "mission_dispute_decided",
        f"mission_dispute_decided:{job_id}",
        user_id=owner_id,
        job_id=job_id,
        details={"decision": decision, "paiement": paiement},
    )

    client_id = job.get("client_id")
    worker_id = job.get("assigned_worker_id")
    if decision == DECISION_VERSER:
        if client_id:
            asyncio.create_task(effets.notify_user_localized(
                user_id=client_id,
                key="dispute_paid_client",
                notif_type=NotificationType.JOB_COMPLETED,
                related_id=job_id,
                related_type="job",
                job_title=job.get("title") or "",
            ))
        # Le travailleur est prévenu par `liberer_sequestre` (payment_sent_worker) :
        # deux notifications pour un seul fait se liraient comme deux versements.
    else:
        # Statuts de remboursement NON définitifs : les clés existantes de
        # l'annulation disent exactement le fait (mission annulée + remboursement
        # en cours ou en échec). Les dupliquer créerait deux vérités pour un
        # même message.
        cle = {
            "refunding": "mission_cancelled_client_refunding",
            "refund_failed": "mission_cancelled_client_refund_failed",
        }.get(paiement, "dispute_refunded_client")
        if client_id:
            asyncio.create_task(effets.notify_user_localized(
                user_id=client_id,
                key=cle,
                notif_type=NotificationType.GENERAL,
                related_id=job_id,
                related_type="job",
                job_title=job.get("title") or "",
                amount=montant,
            ))
        if worker_id:
            asyncio.create_task(effets.notify_user_localized(
                user_id=worker_id,
                key="dispute_refunded_worker",
                notif_type=NotificationType.GENERAL,
                related_id=job_id,
                related_type="job",
                job_title=job.get("title") or "",
            ))

    # L'issue EN COURS n'est pas un versement : `releasing` et `refunding`
    # attendent encore l'IPN ou la vérification de statut. Dire « versé » ici
    # ferait mentir l'écran du propriétaire sur un fait qu'il ne peut pas
    # vérifier — la même classe de mensonge que refermer une décision échouée.
    if decision == DECISION_VERSER:
        message = (
            "Litige tranché : le versement au travailleur est en cours de traitement."
            if paiement == "releasing"
            else "Litige tranché : le paiement a été versé au travailleur."
        )
    else:
        message = (
            "Litige tranché : le remboursement du client est en cours de traitement."
            if paiement == "refunding"
            else "Litige tranché : le client a été remboursé."
        )

    return {
        "message": message,
        "decision": decision,
        "payment_outcome": paiement,
        "dispute_state": TRANCHE,
    }


async def passage_litiges_expires(now: Optional[datetime] = None) -> dict:
    """Un passage : referme les litiges dont la fenêtre d'arbitrage est passée.

    Le seuil est comparé comme une CHAÎNE ISO UTC, dans le même format que
    `decision_deadline_at` : deux formats ne se comparent pas, et un balayage
    qui ne trouve jamais rien aurait l'air d'un balayage au repos.

    Aucun argent ne bouge ici. L'échéance ne décide pas à la place du
    propriétaire : elle CONSTATE que personne n'a tranché, referme la fenêtre et
    rend la main à la règle ordinaire (l'échéance de libération automatique,
    qui ne gèle plus). Le fait est journalisé, et le propriétaire est prévenu —
    un désaccord qui expire en silence serait le silence d'avant.
    """
    instant = (now or _maintenant()).astimezone(timezone.utc).isoformat()
    en_attente = await db.jobs.find({
        "dispute.state": OUVERT,
        "dispute.decision_deadline_at": {"$lte": instant},
        "deleted": {"$ne": True},
    }).to_list(MAX_LITIGES_PAR_PASSAGE)

    resume = {"due": len(en_attente), "expired": 0, "skipped": 0}
    for job in en_attente:
        job_id = job.get("id")
        maintenant = _maintenant().isoformat()
        resultat = await db.jobs.update_one(
            {**identifiant_job_query(job_id), "dispute.state": OUVERT},
            {"$set": {"dispute.state": EXPIRE, "dispute.expired_at": maintenant}},
        )
        if resultat.matched_count == 0:
            # Tranché ou retiré entre la lecture et l'écriture : le passage
            # suivant ne le reverra pas, et rien n'est écrit.
            resume["skipped"] += 1
            continue

        await enregistrer_evenement(
            "mission_dispute_expired",
            f"mission_dispute_expired:{job_id}",
            user_id=job.get("dispute", {}).get("opened_by") or job.get("client_id"),
            job_id=job_id,
            details={"echeance": job.get("dispute", {}).get("decision_deadline_at") or ""},
        )

        for destinataire in (job.get("client_id"), job.get("assigned_worker_id")):
            if destinataire:
                asyncio.create_task(effets.notify_user_localized(
                    user_id=destinataire,
                    key="dispute_expired",
                    notif_type=NotificationType.GENERAL,
                    related_id=job_id,
                    related_type="job",
                    job_title=job.get("title") or "",
                ))
        await _notifier_owner(
            "dispute_expired_owner",
            job_id=job_id,
            job_title=job.get("title") or "",
        )
        resume["expired"] += 1

    if resume["expired"] or resume["skipped"]:
        logger.info(f"⚖️ Litiges échus: {resume}")
    return resume


async def litiges_du_job(job_id: str) -> Optional[dict]:
    """Litige courant d'une mission, pour la lecture propriétaire."""
    job = await db.jobs.find_one(
        {**identifiant_job_query(job_id), "deleted": {"$ne": True}},
        {"dispute": 1, "title": 1, "status": 1, "client_id": 1, "assigned_worker_id": 1, "id": 1, "job_id": 1, "_id": 1},
    )
    if not job:
        return None
    return job


async def file_arbitrage(*, etats: Optional[list] = None, limite: int = 100) -> list:
    """Litiges à trancher, la fenêtre la plus proche de sa fin d'abord.

    L'ordre est celui du travail du propriétaire, pas celui de la base : une
    décision qui a ÉCHOUÉ passe d'abord (elle a un remède nommé et l'argent est
    gelé), puis un litige non tranché dont l'échéance approche, avant un litige
    déjà refermé. La file est le remède à la cécité de l'échéance — et à celle
    d'une décision qui n'a rien payé.
    """
    filtre = {"dispute.state": {"$in": etats or [ECHEC, OUVERT, EXPIRE], "$exists": True}}
    litiges = await db.jobs.find(filtre, {"dispute": 1, "title": 1, "status": 1, "id": 1, "job_id": 1, "client_id": 1, "assigned_worker_id": 1, "_id": 1}).to_list(limite)
    return sorted(
        litiges,
        key=lambda job: (
            0 if (job.get("dispute") or {}).get("state") == ECHEC else 1,
            (job.get("dispute") or {}).get("decision_deadline_at") or "9999",
        ),
    )


__all__ = [
    "OUVERT",
    "RETIRE",
    "TRANCHE",
    "EXPIRE",
    "ETATS_BLOQUANTS",
    "ECHEC",
    "REMEDES_ECHEC",
    "PLANCHER_MESURE",
    "FENETRES_MESURES",
    "mesures_arbitrage",
    "mesure_sans_reponse",
    "DECISION_VERSER",
    "DECISION_REMBOURSER",
    "DECISIONS",
    "litige_bloquant",
    "etat_litige",
    "ouvrir_litige",
    "repondre_litige",
    "retirer_litige",
    "decider_litige",
    "passage_litiges_expires",
    "litiges_du_job",
    "file_arbitrage",
]
