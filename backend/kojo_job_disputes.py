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

# États de `job.dispute`. Ils décrivent le DÉSACCORD, pas la mission.
OUVERT = "open"
RETIRE = "withdrawn"
TRANCHE = "resolved"
EXPIRE = "expired"

# Décision TENTÉE, argent NON bougé : le propriétaire a tranché, le chemin de
# paiement a refusé (ou n'a rien pu faire), et rien n'a été versé ni remboursé.
# Refermer le désaccord dans cet état-ci serait le silence que le litige tracé
# existe pour fermer : la fiche dirait « tranché », les notifications diraient
# « versé », et le compte n'aurait rien reçu.
ECHEC = "decision_failed"

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


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


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
