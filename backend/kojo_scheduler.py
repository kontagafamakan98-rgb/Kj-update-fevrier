# -*- coding: utf-8 -*-
"""Tâches de fond (scheduler).

Boucle de surveillance des DÉCAISSEMENTS BLOQUÉS : les paiements restés en
statut incertain (`releasing` / `refunding` — l'IPN PayDunya n'a jamais
tranché) sont re-vérifiés auprès de PayDunya à chaque passage. Si un statut
reste incertain au-delà d'un seuil (24 h par défaut), le propriétaire est
alerté une seule fois par paiement.

Le cas d'usage réel : un submit-invoice qui renvoie `pending`, ou une IPN de
callback perdue (réseau, redémarrage) → un versement travailleur ou un
remboursement client peut rester « en cours » indéfiniment côté suivi sans
que personne ne soit notifié. Ce sweeper résout les statuts quand PayDunya
répond, et escalade au propriétaire quand il ne peut pas.

AUTO-ALERTE DU FOURNISSEUR EMAIL (17/10/2026) — la seconde boucle : elle juge
le fournisseur email ACTIF avec la MÊME sonde que `/monitor/email`
(`kojo_email.active_email_provider_health_probe`) et prévient le propriétaire
quand il est MUET, UNE SEULE FOIS PAR PANNE. Ce que ça change : la panne email
n'était connue que par un moniteur EXTERNE (job `backend-health-probe`, cron
06:30) — donc jusqu'à 24 h de silence, et rien du tout si le dépôt ou le
moniteur tombait. Ici le backend se juge lui-même, sur la sonde qui existe
déjà : aucune règle dupliquée, donc aucune divergence possible entre ce qui est
surveillé et ce qui envoie réellement les emails.
"""

import asyncio
import os
import socket
from datetime import datetime, timedelta, timezone
from typing import Optional

from kojo_core import db, resolve_owner_id
from kojo_email import (
    active_email_provider_health_probe,
    send_email_via_active_provider,
)
from kojo_models import NotificationType
# Les durées de conservation ne sont pas recopiées ici : la purge demande à
# chaque règle son filtre (kojo_retention), qui porte aussi l'index TTL.
from kojo_retention import RETENTION_RULES
from kojo_job_alerts import passage_digest
from kojo_identifiants import identifiant_job_query, identifiants_query
from kojo_job_completion import passage_liberations_auto
from kojo_job_disputes import (
    PLANCHER_MESURE,
    mesure_sans_reponse,
    passage_litiges_expires,
)
from kojo_settings import (
    CLIENT_SANS_PROPOSITION_HEURES,
    CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES,
    COMPLETION_SWEEP_INTERVAL_MINUTES,
    EMAIL_HEALTH_ALERT_INTERVAL_MINUTES,
    JOB_ALERT_DIGEST_INTERVAL_MINUTES,
    LITIGE_ALERTE_INTERVAL_MINUTES,
    LITIGE_SANS_REPONSE_FENETRE_JOURS,
    LITIGE_SANS_REPONSE_SEUIL,
    LITIGE_SWEEP_INTERVAL_MINUTES,
    MARCHE_VIDE_ALERTE_HEURES,
    MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES,
    MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES,
    MISSIONS_SANS_PROPOSITION_JOURS,
    OWNER_EMAIL,
    OWNER_USER_ID,
    PAYOUT_ALERT_REMINDER_DAYS,
    PAYOUT_ALERT_THRESHOLD_HOURS,
    PAYOUT_SWEEPER_INTERVAL_MINUTES,
    RETENTION_SWEEP_INTERVAL_MINUTES,
    logger,
)
from kojo_shared import notify_user_localized
# Réutilise la re-vérification PayDunya des routers paiements : même mapping
# de statut refund-aware (payout_kind == "refund" → refunded/refunding/
# refund_failed, sinon released/releasing/release_failed), mêmes notifications
# de transition et même application des retraits de récompenses. Point unique
# de vérité du check-status — pas de mapping dupliqué ici.
from kojo_routers_payments import _maybe_recheck_disburse_status
# Circuit breaker GLOBAL PayDunya (kojo_payments) : quand il est OUVERT, les
# re-vérifications sont SUSPENDUES (elles échoueraient de toute façon en fail
# fast) — on ne martèle pas une API down — mais l'escalade continue.
from kojo_payments import paydunya_circuit_state, refresh_paydunya_circuit_from_db

# Statuts « incertains » : PayDunya a peut-être exécuté le décaissement, seul
# un check-status (ou l'IPN) peut trancher.
_STUCK_PAYOUT_STATUSES = ("releasing", "refunding")


def _parse_payment_ts(value) -> Optional[datetime]:
    """Parse un timestamp de paiement (ISO string ou datetime, tz-aware)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _stuck_for(payment: dict, now: datetime) -> Optional[timedelta]:
    """Durée depuis la dernière transition de statut (updated_at, sinon
    created_at). updated_at n'est touché qu'au CHANGEMENT de statut (le
    recheck d'un statut inchangé ne le modifie pas), donc c'est une bonne
    mesure du temps passé en releasing/refunding."""
    for field in ("updated_at", "created_at"):
        ts = _parse_payment_ts(payment.get(field))
        if ts is not None:
            return now - ts
    return None


async def payout_stuck_sweep_once(now: Optional[datetime] = None) -> dict:
    """Un passage du sweeper : re-vérifie tous les décaissements en attente et
    alerte le propriétaire sur ceux bloqués au-delà du seuil.

    Retourne un résumé {rechecked, resolved, stuck, alerted} (testable, et
    loggé à chaque passage non vide).
    """
    now = now or datetime.now(timezone.utc)
    summary = {"rechecked": 0, "resolved": 0, "stuck": 0, "alerted": 0}

    payments = await db.payments.find({
        "payout_status": {"$in": list(_STUCK_PAYOUT_STATUSES)},
    }).to_list(length=500)

    # Partage inter-workers : on adopte l'état du circuit persisté en base —
    # un AUTRE worker a pu ouvrir le circuit pendant que celui-ci dormait
    # (redéploiement, montée en charge). Sans ce refresh, ce worker
    # re-brûlerait le seuil d'échecs avant de se synchroniser.
    await refresh_paydunya_circuit_from_db()

    # Circuit breaker GLOBAL PayDunya : quand il est OUVERT, on ne lance AUCUNE
    # re-vérification (chaque check-status échouerait en fail fast ~0 ms) — on
    # évite même la boucle de per-payment inutile. L'escalade (étape 2) reste
    # active : le propriétaire doit savoir que les décaissements restent
    # incertains pendant la panne PayDunya.
    circuit = paydunya_circuit_state()
    circuit_open = circuit["state"] == "open"
    if circuit_open:
        logger.warning(
            f"🔌 Sweeper décaissements bloqués: circuit breaker PayDunya OUVERT — "
            f"re-vérifications suspendues (cooldown restant ~"
            f"{int(circuit['remaining_cooldown_seconds'] // 3600)} h), escalade maintenue."
        )

    for payment in payments:
        payment_id = payment.get("id")
        if not payment_id:
            continue

        # 1) Re-vérification PayDunya : si l'IPN n'est jamais arrivée, le
        #    check-status peut trancher (success → released/refunded, échec →
        #    release_failed/refund_failed). Un échec de vérification (réseau,
        #    PayDunya non configuré) laisse le record inchangé → traité comme
        #    toujours incertain ci-dessous. SUSPENDUE quand le circuit est
        #    ouvert (fail fast systématique — on ne martèle pas une API down).
        if circuit_open:
            updated = payment
        else:
            summary["rechecked"] += 1
            try:
                updated = await _maybe_recheck_disburse_status(payment)
            except Exception as exc:
                logger.warning(
                    f"⚠️ Sweeper: re-vérification impossible (payment={payment_id}): {exc}"
                )
                updated = payment

        current = updated or payment
        current_status = current.get("payout_status")
        if current_status not in _STUCK_PAYOUT_STATUSES:
            summary["resolved"] += 1
            continue

        # 2) Toujours incertain : alerte au propriétaire si le blocage dépasse
        #    le seuil, puis RAPPEL périodique tant que le blocage dure
        #    (escalade — PayDunya injoignable plusieurs jours ne doit pas
        #    rester silencieux après la première alerte). owner_payout_alerted_at
        #    est décalé à chaque rappel → rappel espacé, pas de spam.
        summary["stuck"] += 1
        alerted_at = _parse_payment_ts(current.get("owner_payout_alerted_at"))
        stuck_for = _stuck_for(current, now)
        if alerted_at is not None:
            if now - alerted_at < timedelta(days=PAYOUT_ALERT_REMINDER_DAYS):
                continue
        elif stuck_for is None or stuck_for < timedelta(hours=PAYOUT_ALERT_THRESHOLD_HOURS):
            continue

        amount = int(current.get("amount", 0) or 0)
        hours_stuck = int(stuck_for.total_seconds() // 3600)
        is_reminder = alerted_at is not None
        # Résolution du compte owner RÉEL par email (source de vérité) : en
        # prod, l'id du compte ne correspond pas au secret OWNER_USER_ID (id
        # fantôme) et les notifications ciblées par le secret étaient perdues.
        owner_id = await resolve_owner_id() or OWNER_USER_ID
        await notify_user_localized(
            user_id=owner_id,
            key="owner_payout_stuck_alert",
            notif_type=NotificationType.GENERAL,
            related_id=payment_id,
            related_type="payment",
            payment_id=payment_id,
            amount=amount,
            status=current_status,
            hours=hours_stuck,
        )
        # Fallback EMAIL : le compte owner n'a aucun push token web enregistré
        # en prod → la notification in-app/push peut ne jamais être vue. L'email
        # du fournisseur ACTIF (EMAIL_PROVIDER, best-effort comme les tickets
        # support) garantit que l'alerte atteint Famakan dans tous les cas.
        if OWNER_EMAIL:
            try:
                subject = (
                    "KOJO — Décaissement toujours bloqué (rappel)"
                    if is_reminder
                    else "KOJO — Alerte décaissement bloqué"
                )
                await send_email_via_active_provider(
                    OWNER_EMAIL,
                    subject,
                    f"Un décaissement reste bloqué depuis plus de {PAYOUT_ALERT_THRESHOLD_HOURS} h.\n"
                    f"Paiement : {payment_id}\n"
                    f"Montant : {amount} FCFA\n"
                    f"Statut : {current_status}\n"
                    f"Bloqué depuis : {hours_stuck} h\n\n"
                    f"Consultez /api/owner/stuck-payouts pour le détail et /owner/retry-refund "
                    f"pour relancer un remboursement.",
                )
            except Exception as exc:
                logger.warning(f"⚠️ Email alerte owner échoué: {exc}")
        # Traçabilité : owner_payout_alerted_at (fenêtre de rappel) + compteur
        # de RAPPELS déjà envoyés (incrémenté uniquement sur un rappel, pas sur
        # la première alerte) — exposé dans /api/owner/stuck-payouts pour que
        # l'owner sache combien de fois il a été relancé pour ce décaissement.
        alert_update = {"$set": {"owner_payout_alerted_at": now.isoformat()}}
        if is_reminder:
            alert_update["$inc"] = {"owner_payout_reminders_sent": 1}
        await db.payments.update_one({"id": payment_id}, alert_update)
        summary["alerted"] += 1

    if summary["rechecked"]:
        logger.info(f"🔍 Sweeper décaissements bloqués: {summary}")
    return summary


# ---------------------------------------------------------------------------
# Bail de tâche partagé entre instances
# ---------------------------------------------------------------------------
# Chaque instance (worker, machine Fly) lance ses propres boucles de fond. Sans
# coordination, N instances exécutent N fois le sweeper : N check-status PayDunya
# et N alertes au propriétaire pour le même paiement. Un bail par tâche, dans
# `scheduler_leases` (un document par tâche, `_id` = nom) : seule l'instance qui
# l'obtient exécute le passage, les autres le sautent.
#
# Atomicité : la prise de bail est un update conditionnel sur UN document (bail
# échu). Si le document n'existe pas, l'insertion avec le même `_id` échoue pour le
# second arrivant (index `_id` unique, code 11000). Un bail échu est repris par
# la première instance qui réveille la boucle après son échéance : une instance
# qui meurt en cours libère donc la tâche au bout de la durée du bail.
#
# Échec fermé : si la base est injoignable, le passage est SAUTÉ (l'exception
# remonte à la boucle, qui la journalise) plutôt que lancé sans bail.

SCHEDULER_LEASE_COLLECTION = "scheduler_leases"
_DUPLICATE_KEY_CODE = 11000


def scheduler_holder_id() -> str:
    """Identité de cette instance dans le bail : machine Fly si présente, sinon hôte:pid."""
    return os.environ.get("FLY_MACHINE_ID", "").strip() or f"{socket.gethostname()}:{os.getpid()}"


async def acquerir_bail(nom: str, duree: timedelta, *, holder: str, now: Optional[datetime] = None) -> bool:
    """Tente de prendre le bail `nom` pour `duree`. Vrai si cette instance l'obtient."""
    now = now or datetime.now(timezone.utc)
    expire = now + duree
    collection = db[SCHEDULER_LEASE_COLLECTION]
    # 1) Bail existant mais échu : repris atomiquement (filtre conditionnel).
    reprise = await collection.update_one(
        {"_id": nom, "expires_at": {"$lte": now}},
        {"$set": {"holder": holder, "expires_at": expire, "acquired_at": now}},
    )
    if reprise.matched_count:
        return True
    # 2) Aucun bail (premier passage), ou bail encore tenu : l'insertion gagne
    #    seulement si le document n'existe pas ; sinon doublon sur `_id`.
    try:
        await collection.insert_one(
            {"_id": nom, "holder": holder, "expires_at": expire, "acquired_at": now}
        )
    except Exception as exc:
        if getattr(exc, "code", None) == _DUPLICATE_KEY_CODE:
            return False
        raise
    return True


async def executer_si_bail(nom: str, duree: timedelta, travail, *, holder: Optional[str] = None):
    """Lance `travail()` seulement si cette instance détient le bail `nom`.

    Retourne le résultat du passage, ou None quand il est sauté (une autre
    instance l'a pris pour cette période).
    """
    detenteur = holder or scheduler_holder_id()
    if not await acquerir_bail(nom, duree, holder=detenteur):
        logger.debug(f"⏭️ Tâche '{nom}' sautée : bail tenu par une autre instance")
        return None
    return await travail()


async def completion_auto_release_loop():
    """Tâche de fond : libère le séquestre des fins de mission non validées.

    Le travailleur déclare la mission terminée ; si le client ne valide pas
    sous `COMPLETION_AUTO_RELEASE_DAYS`, l'argent doit partir quand même —
    sinon un client injoignable laisse le travailleur impayé indéfiniment.

    Même modèle que les autres boucles : sommeil d'abord (pas de rafale au
    redémarrage), bail partagé entre instances, erreurs isolées par passage.
    La logique de libération vit dans `kojo_job_completion` : cette boucle ne
    fait que décider QUAND elle tourne.
    """
    while True:
        try:
            await asyncio.sleep(COMPLETION_SWEEP_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "completion_auto_release",
                timedelta(minutes=COMPLETION_SWEEP_INTERVAL_MINUTES),
                passage_liberations_auto,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur balayage des libérations automatiques: {exc}")


async def litige_expiry_loop():
    """Tâche de fond : referme les litiges dont la fenêtre d'arbitrage est passée.

    Même modèle que `completion_auto_release_loop` : sommeil d'abord (pas de
    rafale au redémarrage), bail partagé entre instances (sinon N machines
    écriraient N fois le même fait), erreurs isolées par passage.

    Ce que cette boucle ne fait pas, et c'est une décision : elle ne tranche
    PAS le désaccord. Elle CONSTATE que personne n'a tranché, journalise
    l'échéance, prévient le propriétaire et rend la main à la règle
    ordinaire — un balayeur qui déciderait à la place du propriétaire
    déplacerait l'argent sur un silence, pas sur un jugement.
    """
    while True:
        try:
            await asyncio.sleep(LITIGE_SWEEP_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "litige_expiry",
                timedelta(minutes=LITIGE_SWEEP_INTERVAL_MINUTES),
                passage_litiges_expires,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur balayage des litiges échus: {exc}")


async def payout_stuck_sweeper_loop():
    """Tâche de fond : re-vérifie périodiquement les décaissements bloqués.

    Même modèle que _rate_limit_cleanup_loop (kojo_core) : boucle infinie,
    sommeil d'abord (pas de rafale de check-status PayDunya au redémarrage),
    annulable proprement au shutdown, erreurs isolées par itération.
    """
    while True:
        try:
            await asyncio.sleep(PAYOUT_SWEEPER_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "payout_stuck_sweeper",
                timedelta(minutes=PAYOUT_SWEEPER_INTERVAL_MINUTES),
                payout_stuck_sweep_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur sweeper décaissements bloqués: {exc}")


async def retention_purge_once(now: Optional[datetime] = None) -> dict:
    """Un passage de purge : supprime ce que les règles de conservation
    déclarent dû.

    Le filtre vient de `RegleDeConservation.query_de_purge` — la même règle que
    l'index TTL, donc la purge ne peut pas contredire la durée publiée. Un
    échec sur une collection n'empêche pas les autres : borner une collection
    ne doit pas dépendre de l'état d'une autre.

    Retourne {collection: documents supprimés} et ne logge que les passages non
    vides — un log quotidien qui dit « 0 » finit par être ignoré.
    """
    now = now or datetime.now(timezone.utc)
    supprimes = {}
    for regle in RETENTION_RULES:
        try:
            resultat = await db[regle.collection].delete_many(
                regle.query_de_purge(now)
            )
        except Exception as exc:
            logger.warning(f"⚠️ Purge de conservation impossible ({regle.collection}): {exc}")
            continue
        nombre = getattr(resultat, "deleted_count", 0) or 0
        if nombre:
            supprimes[regle.collection] = nombre
    if supprimes:
        logger.info(f"🧹 Purge de conservation: {supprimes}")
    return supprimes


async def retention_purge_loop():
    """Tâche de fond : applique les règles de conservation périodiquement.

    Même modèle que `payout_stuck_sweeper_loop` : sommeil d'abord, annulable
    proprement au shutdown, erreurs isolées par itération. L'index TTL reste la
    garantie de fond (il agit même si cette boucle ne tourne pas) ; ce passage
    est celui qu'un test peut exercer.
    """
    while True:
        try:
            await asyncio.sleep(RETENTION_SWEEP_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "retention_purge",
                timedelta(minutes=RETENTION_SWEEP_INTERVAL_MINUTES),
                retention_purge_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur purge de conservation: {exc}")


# ---------------------------------------------------------------------------
# AUTO-ALERTE DU FOURNISSEUR EMAIL ACTIF
# ---------------------------------------------------------------------------
#
# Ce que ce passage ajoute, et pourquoi il vit ICI plutôt que dans le moniteur
# externe : la panne d'email est celle qui EMPÊCHE de s'en plaindre. Si le
# fournisseur est muet, aucun code de connexion ne part, aucune
# réinitialisation de mot de passe n'arrive — et le seul témoin, jusqu'ici,
# était un job planifié ailleurs (`.github/workflows/backend-health-probe.yml`,
# cron 06:30) qui interroge `/monitor/email`. Deux trous : jusqu'à 24 h de
# silence, et un silence TOTAL le jour où le dépôt, GitHub Actions ou le réseau
# qui porte la sonde tombe (et si le vrai problème EST l'email, personne n'a
# été prévenu par email pour le savoir).
#
# LA SONDE EST RÉUTILISÉE, jamais réécrite : `active_email_provider_health_probe`
# (kojo_email) est celle que sert `/monitor/email`. Une seconde résolution du
# fournisseur actif ferait juger autre chose que ce que les envois suivent — et
# c'est précisément l'erreur que cette famille a déjà payée (voir l'en-tête de
# la sonde). Elle est appelée en `to_thread` comme dans `/monitor` : c'est un
# appel `requests` (5 s de délai), il ne doit pas figer la boucle d'événements.
#
# UNE SEULE ALERTE PAR PANNE, et l'état qui le permet : un document par sujet
# dans `scheduler_alerts` ("état", il ne périme pas — comme les suppressions
# d'email, c'est une décision, pas un journal). `signature` = fournisseur jugé +
# MOTIF, et c'est elle qui dit si la panne est la MÊME :
#   • même signature, santé déjà muette → rien n'est envoyé (la promesse) ;
#   • santé saine puis muette → NOUVELLE panne, nouvelle alerte (le
#     rétablissement ré-arme) ;
#   • motif ou fournisseur qui CHANGE en restant muet → nouvelle panne : c'est
#     un fait neuf pour le propriétaire (« mal configuré » après « muet » n'est
#     pas la même action à mener), et le taire serait perdre le seul signal.

EMAIL_ALERT_COLLECTION = "scheduler_alerts"
_EMAIL_ALERT_SUBJECT = "email_provider"
# Le détail est conservé pour être LU par un humain : c'est une phrase de
# verdict, pas une archive de réponse d'API.
_EMAIL_ALERT_DETAIL_MAX = 300


def _motif_de_panne(verdict: dict) -> str:
    """Le motif, réduit à ce qui décide de la suite.

    « muet » — le fournisseur ne part pas du tout : clés manquantes, transport
    injoignable, HTTP d'erreur, `EMAIL_PROVIDER=none` (ou nom inconnu, que la
    sonde nomme).
    « mal-configure » — il répond mais l'EXPÉDITEUR est inutilisable : domaine
    non vérifié chez Resend, expéditeur inactif chez Brevo, jeton OAuth révoqué
    chez Gmail. Les deux mènent à « aucun email ne part », mais pas à la même
    correction.
    """
    return "mal-configure" if verdict.get("configured") else "muet"


def _signature_de_panne(verdict: dict) -> str:
    """L'identité de la panne : le fournisseur JUGÉ et le motif."""
    return "%s:%s" % (verdict.get("provider") or "inconnu", _motif_de_panne(verdict))


async def email_provider_auto_alert_once(now: Optional[datetime] = None) -> dict:
    """Un passage : juge le fournisseur email ACTIF et alerte s'il est muet.

    Retourne un résumé testable {provider, sante, alertes, retablissements,
    pannes_ignorees} : `alertes` vaut 1 exactement quand une alerte est partie
    sur ce passage, `pannes_ignorees` 1 quand la même panne durait déjà (et
    que rien n'est donc envoyé).
    """
    now = now or datetime.now(timezone.utc)
    # La sonde ne lève jamais (contrat des sondes d'infra) — mais un patch de
    # test pourrait la casser, et la boucle isole déjà ses itérations.
    verdict = await asyncio.to_thread(active_email_provider_health_probe)

    provider = str(verdict.get("provider") or "inconnu")
    ok = bool(verdict.get("ok"))
    configured = bool(verdict.get("configured"))
    detail = str(verdict.get("detail") or "")[:_EMAIL_ALERT_DETAIL_MAX]

    collection = db[EMAIL_ALERT_COLLECTION]
    etat = await collection.find_one({"_id": _EMAIL_ALERT_SUBJECT}) or {}
    resume = {
        "provider": provider,
        "sante": "ok" if ok else "muette",
        "alertes": 0,
        "retablissements": 0,
        "pannes_ignorees": 0,
    }

    # ── Le fournisseur répond : rien à alerter, et on RÉARME ────────────────
    if ok:
        changement = {"sante": "ok", "detail": detail, "derniere_sonde_at": now}
        if etat.get("sante") == "muette":
            # Rétabli : la prochaine panne sera une NOUVELLE panne (donc une
            # nouvelle alerte), et cet instant est écrit — sans quoi une reprise
            # serait indiscernable d'une panne toujours en cours.
            changement["retabli_at"] = now
            resume["retablissements"] = 1
            logger.info(
                "✅ Fournisseur email '%s' de nouveau sain (panne ouverte depuis %s)."
                % (provider, etat.get("panne_depuis") or "inconnu")
            )
        await collection.update_one(
            {"_id": _EMAIL_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        return resume

    # ── Muet : la même panne n'alerte qu'une fois ──────────────────────────
    motif = _motif_de_panne(verdict)
    signature = _signature_de_panne(verdict)
    deja_alertee = etat.get("sante") == "muette" and etat.get("signature") == signature

    changement = {
        "sante": "muette",
        "signature": signature,
        "provider": provider,
        "configured": configured,
        "motif": motif,
        "detail": detail,
        "derniere_sonde_at": now,
    }
    if etat.get("sante") != "muette":
        changement["panne_depuis"] = now

    if deja_alertee:
        await collection.update_one(
            {"_id": _EMAIL_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["pannes_ignorees"] = 1
        logger.debug(
            "Auto-alerte email: panne '%s' déjà signalée (depuis %s) — pas de seconde alerte."
            % (signature, etat.get("panne_depuis") or "inconnu")
        )
        return resume

    # ── Nouvelle panne : une alerte, et par DEUX canaux qui ne dépendent pas
    #    de l'email : la notification in-app (elle marche quand le fournisseur
    #    est muet) et l'email best-effort (il marche quand la panne n'est que
    #    partielle — clé restreinte, expéditeur douteux). Le compte owner n'a
    #    aucun push token web en production : l'un sans l'autre laisserait un
    #    cas sans destinataire.
    owner_id = await resolve_owner_id() or OWNER_USER_ID
    await notify_user_localized(
        user_id=owner_id,
        key="owner_email_provider_down",
        notif_type=NotificationType.GENERAL,
        related_type="email_provider",
        provider=provider,
        motif=motif,
        detail=detail,
    )

    alerte_envoyee = False
    alerte_erreur = ""
    if OWNER_EMAIL:
        try:
            await send_email_via_active_provider(
                OWNER_EMAIL,
                "KOJO — Fournisseur email muet (%s, %s)" % (provider, motif),
                "La sonde du fournisseur email ACTIF a rendu un verdict d'échec.\n"
                "Fournisseur jugé : %s\n"
                "Motif : %s\n"
                "Détail : %s\n\n"
                "Conséquence : aucun email de Kojo ne part (codes de connexion, "
                "réinitialisations de mot de passe, alertes).\n"
                "À vérifier : EMAIL_PROVIDER, les clés du fournisseur et son "
                "EXPÉDITEUR (domaine vérifié chez Resend, expéditeur actif chez "
                "Brevo, jeton OAuth chez Gmail). /monitor/email doit repasser 200.\n"
                "Le rétablissement RÉ-ARME cette alerte : une reprise puis une "
                "nouvelle panne donnera un nouvel email ; la même panne, jamais "
                "deux." % (provider, motif, detail or "(aucun)"),
            )
            alerte_envoyee = True
        except Exception as exc:
            # Le fournisseur est muet : c'est le cas NORMAL où cet email ne part
            # pas. On le DIT (et on l'écrit en base) au lieu de le taire — un
            # envoi qui échoue en silence ferait croire à une alerte reçue.
            alerte_erreur = str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
            logger.warning(
                "⚠️ Auto-alerte email: envoi impossible (le fournisseur est muet) : %s" % exc
            )
    else:
        alerte_erreur = "OWNER_EMAIL non configuré"
        logger.warning(
            "⚠️ Auto-alerte email: OWNER_EMAIL absent — la notification in-app est le seul canal."
        )

    changement["alerte_envoyee_at"] = now
    changement["alerte_envoyee"] = alerte_envoyee
    changement["alerte_erreur"] = alerte_erreur
    await collection.update_one(
        {"_id": _EMAIL_ALERT_SUBJECT}, {"$set": changement}, upsert=True
    )
    resume["alertes"] = 1
    logger.warning(
        "🚨 Auto-alerte email: fournisseur '%s' %s — alerte envoyée (email=%s). Détail: %s"
        % (provider, motif, alerte_envoyee, detail or "(aucun)")
    )
    return resume


async def email_provider_alert_loop():
    """Tâche de fond : juge périodiquement le fournisseur email ACTIF.

    Même modèle que les deux autres boucles : sommeil d'abord (aucune sonde au
    redémarrage, ni à chaque déploiement), annulable proprement au shutdown,
    erreurs isolées par itération, et un BAIL par passage — sans lui, N machines
    Fly sonderaient le fournisseur N fois et pourraient alerter N fois.
    """
    while True:
        try:
            await asyncio.sleep(EMAIL_HEALTH_ALERT_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "email_provider_alert",
                timedelta(minutes=EMAIL_HEALTH_ALERT_INTERVAL_MINUTES),
                email_provider_auto_alert_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur auto-alerte fournisseur email: {exc}")


async def job_alert_digest_loop():
    """Tâche de fond : résume les nouvelles missions aux veilles actives.

    Même modèle que les autres boucles — sommeil d'abord (aucun email au
    redémarrage, ni à chaque déploiement), annulable proprement au shutdown,
    erreurs isolées par itération — et un BAIL : sans lui, N machines Fly
    enverraient N fois le même résumé aux mêmes travailleurs.

    Le travail lui-même vit dans `kojo_job_alerts.passage_digest` : il est
    appelable directement par un test (aucune horloge à attendre).
    """
    while True:
        try:
            await asyncio.sleep(JOB_ALERT_DIGEST_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "job_alert_digest",
                timedelta(minutes=JOB_ALERT_DIGEST_INTERVAL_MINUTES),
                passage_digest,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur résumé alertes emploi: {exc}")


# ---------------------------------------------------------------------------
# ALERTE « LITIGES TRANCHÉS SANS RÉPONSE »
# ---------------------------------------------------------------------------
#
# Ce que cette boucle ajoute, et pourquoi elle n'est pas une seconde mesure :
# `mesures_arbitrage` (et `mesure_sans_reponse`) publient un CHIFFRE à la
# demande, dans la file d'arbitrage — là où le propriétaire travaille, mais
# seulement quand il y vient. Un arbitre qui décide SANS lire l'autre partie ne
# se voit pas dans sa propre file : chaque litige y ressemble à un dossier de
# plus, et le taux reste à 60 % tant que personne ne l'ouvre. Ici, le chiffre
# vient à lui, avec la conséquence nommée.
#
# LE SEUIL ET LA PÉRIODE SE LISENT dans `kojo_settings` (`LITIGE_SANS_REPONSE_*`),
# ils ne sont pas recopiés. La fenêtre est GLISSANTE et se juge sur
# `dispute.resolved_at` : un litige ouvert il y a six mois et tranché hier
# appartient à la période — c'est la DÉCISION qu'on surveille, pas l'ouverture.
#
# UNE SEULE ALERTE PAR DÉPASSEMENT, et l'état qui le permet : un document par
# sujet dans `scheduler_alerts` (`_id` = `litige_arbitrage`, état et non
# journal). La `signature` porte le seuil, la fenêtre ET le plancher : changer
# l'un d'eux change ce qui est mesuré, donc le dépassement est NEUF. Le retour
# SOUS le seuil réarme (`retabli_at`) ; une période trop pauvre pour publier un
# taux (`None`, sous `PLANCHER_MESURE`) n'est PAS un rétablissement — sans
# décisions, il n'y a aucune preuve que l'arbitrage va mieux, et réarmer là
# ferait repartir une alerte à chaque passage qui repasse au-dessus.

LITIGE_ALERT_COLLECTION = "scheduler_alerts"
_LITIGE_ALERT_SUBJECT = "litige_arbitrage"


def _signature_depassement(seuil: float, fenetre_jours: int) -> str:
    """L'identité du dépassement : ce qui a été mesuré, et avec quelle règle."""
    return "sans_reponse:seuil=%s:fenetre=%s:plancher=%s" % (
        seuil,
        fenetre_jours,
        PLANCHER_MESURE,
    )


async def arbitrage_sans_reponse_alert_once(now: Optional[datetime] = None) -> dict:
    """Un passage : mesure la période et alerte si le seuil est DÉPASSÉ.

    Retourne un résumé testable {sante, taux, tranches, sans_reponse, alertes,
    retablissements, alertes_ignorees}. `alertes` vaut 1 exactement quand une
    alerte part sur ce passage ; `alertes_ignorees` 1 quand le même dépassement
    était déjà signalé ; `retablissements` 1 quand un dépassement signalé
    repasse sous le seuil.

    « Dépasse » est STRICT : à la valeur du seuil, la mesure ne dépasse pas —
    et c'est aussi le retour qui réarme.
    """
    now = now or datetime.now(timezone.utc)
    mesure = await mesure_sans_reponse(
        LITIGE_SANS_REPONSE_FENETRE_JOURS, maintenant=now
    )
    tranches = mesure["tranches"]["total"]
    sans_reponse = mesure["tranches"]["sans_reponse"]
    taux = mesure["tranches"]["taux_sans_reponse"]
    signature = _signature_depassement(
        LITIGE_SANS_REPONSE_SEUIL, LITIGE_SANS_REPONSE_FENETRE_JOURS
    )

    collection = db[LITIGE_ALERT_COLLECTION]
    etat = await collection.find_one({"_id": _LITIGE_ALERT_SUBJECT}) or {}
    resume = {
        "sante": "inconnue",
        "taux": taux,
        "tranches": tranches,
        "sans_reponse": sans_reponse,
        "alertes": 0,
        "retablissements": 0,
        "alertes_ignorees": 0,
    }
    commun = {
        "signature": signature,
        "seuil": LITIGE_SANS_REPONSE_SEUIL,
        "fenetre_jours": LITIGE_SANS_REPONSE_FENETRE_JOURS,
        "plancher": PLANCHER_MESURE,
        "taux": taux,
        "tranches": tranches,
        "sans_reponse": sans_reponse,
        "mesure_le": now,
    }

    # ── Pas de taux publiable : ce n'est PAS un rétablissement ──────────────
    if taux is None:
        changement = dict(
            commun,
            sante=etat.get("sante") or "inconnue",
            insuffisant=True,
        )
        await collection.update_one(
            {"_id": _LITIGE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["sante"] = changement["sante"]
        resume["insuffisant"] = 1
        logger.info(
            "⚖️ Alerte arbitrage : %s décision(s) dans la fenêtre, sous le "
            "plancher de %s — aucun taux publié, aucun verdict."
            % (tranches, PLANCHER_MESURE)
        )
        return resume

    # ── Sous (ou à) le seuil : rien à signaler, et on RÉARME ────────────────
    if taux <= LITIGE_SANS_REPONSE_SEUIL:
        changement = dict(commun, sante="saine")
        if etat.get("sante") == "alertee":
            changement["retabli_at"] = now
            resume["retablissements"] = 1
            logger.info(
                "✅ Arbitrage de nouveau sous le seuil (%s <= %s) : "
                "l'alerte est réarmée." % (taux, LITIGE_SANS_REPONSE_SEUIL)
            )
        await collection.update_one(
            {"_id": _LITIGE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["sante"] = "saine"
        return resume

    # ── Dépassement : le MÊME n'alerte qu'une fois ──────────────────────────
    deja_signale = (
        etat.get("sante") == "alertee" and etat.get("signature") == signature
    )
    changement = dict(commun, sante="alertee")
    if deja_signale:
        await collection.update_one(
            {"_id": _LITIGE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["sante"] = "alertee"
        resume["alertes_ignorees"] = 1
        logger.debug(
            "Arbitrage : dépassement déjà signalé (%s %%) — pas de seconde alerte."
            % round(taux * 100)
        )
        return resume

    part = round(taux * 100)
    seuil_pourcent = round(LITIGE_SANS_REPONSE_SEUIL * 100)
    owner_id = await resolve_owner_id() or OWNER_USER_ID
    await notify_user_localized(
        user_id=owner_id,
        key="owner_litiges_sans_reponse",
        notif_type=NotificationType.GENERAL,
        related_type="litige",
        part=part,
        seuil=seuil_pourcent,
        jours=LITIGE_SANS_REPONSE_FENETRE_JOURS,
        tranches=tranches,
        sans_reponse=sans_reponse,
    )

    alerte_envoyee = False
    alerte_erreur = ""
    if OWNER_EMAIL:
        try:
            await send_email_via_active_provider(
                OWNER_EMAIL,
                "KOJO — Arbitrage : %s %% des litiges tranchés sans réponse" % part,
                "Sur les %s litiges TRANCHÉS des %s derniers jours, %s l'ont été "
                "sans qu'aucune réponse de l'autre partie n'existe (%s %%, au-delà "
                "du seuil de %s %%).\n\n"
                "Conséquence : l'arbitre a tranché sur une seule version, et les "
                "décisions ne peuvent pas être relues avec l'autre partie.\n"
                "À vérifier : la file d'arbitrage (GET /api/owner/litiges) et les "
                "mesures (GET /api/owner/litiges/mesures) — délai de décision, "
                "réponses à temps, décisions sans réponse.\n"
                "Le retour sous le seuil RÉ-ARME cette alerte : un nouveau "
                "dépassement donnera un nouvel email ; le même, jamais deux."
                % (
                    tranches,
                    LITIGE_SANS_REPONSE_FENETRE_JOURS,
                    sans_reponse,
                    part,
                    seuil_pourcent,
                ),
            )
            alerte_envoyee = True
        except Exception as exc:
            # L'email est le canal SECONDAIRE (la notification in-app vient de
            # partir) : un échec est écrit, jamais tu — sinon le propriétaire
            # croirait à une alerte reçue.
            alerte_erreur = str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
            logger.warning("⚠️ Email d'alerte arbitrage échoué: %s" % exc)
    else:
        alerte_erreur = "OWNER_EMAIL non configuré"
        logger.warning(
            "⚠️ Alerte arbitrage : OWNER_EMAIL absent — la notification in-app "
            "est le seul canal."
        )

    changement["alertee_at"] = now
    changement["alerte_envoyee"] = alerte_envoyee
    changement["alerte_erreur"] = alerte_erreur
    await collection.update_one(
        {"_id": _LITIGE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
    )
    resume["sante"] = "alertee"
    resume["alertes"] = 1
    logger.warning(
        "🚨 Arbitrage : %s %% des %s litiges tranchés sans réponse (seuil %s %%) "
        "— alerte envoyée (email=%s)." % (part, tranches, seuil_pourcent, alerte_envoyee)
    )
    return resume


async def litige_arbitrage_alert_loop():
    """Tâche de fond : juge périodiquement la part de décisions sans réponse.

    Même modèle que les autres boucles : sommeil d'abord (aucun passage au
    redémarrage, ni à chaque déploiement), annulable proprement au shutdown,
    erreurs isolées par itération, et un BAIL par passage — sans lui, N machines
    Fly jugeraient N fois et pourraient alerter N fois.

    Le travail vit dans `arbitrage_sans_reponse_alert_once` : il est appelable
    directement par un test, sans horloge à attendre.
    """
    while True:
        try:
            await asyncio.sleep(LITIGE_ALERTE_INTERVAL_MINUTES * 60)
            await executer_si_bail(
                "litige_arbitrage_alert",
                timedelta(minutes=LITIGE_ALERTE_INTERVAL_MINUTES),
                arbitrage_sans_reponse_alert_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur alerte arbitrage sans réponse: {exc}")


# ---------------------------------------------------------------------------
# ALERTE « PLACE DE MARCHÉ VIDE »
# ---------------------------------------------------------------------------
#
# Ce que cette boucle ajoute, et pourquoi elle vit ICI plutôt que dans un
# tableau de bord : le 23/10/2026 la production comptait ZÉRO mission ouverte,
# et le fait n'existait que sur `/metrics` — un scrape que personne n'ouvre. Il
# a fallu onze jours de PRÉMISSES dans les sondes de SEO pour s'en apercevoir.
# Une place de marché sans mission n'a rien à faire postuler, aucune fiche à
# indexer et aucun revenu : c'est une panne d'exploitation, et elle se dit.
#
# LA MESURE EST UNE DURÉE, jamais un instant. Un marché peut être vide une
# heure entre deux missions sans que rien ne soit cassé ; alerter là-dessus
# produirait cet avertissement qu'on apprend à ignorer. Le seuil
# (`MARCHE_VIDE_ALERTE_HEURES`) borne la CONTINUITÉ du vide, lue depuis
# `vide_depuis` — un état EN BASE, donc un redémarrage ne remet pas le
# chronomètre à zéro (sans quoi une machine redéployée chaque jour ne
# franchirait jamais le seuil, et l'alerte serait décorative).
#
# LA RÈGLE DU CORPUS EST PARTAGÉE : `compter_missions_ouvertes` est lue par la
# jauge `kojo_missions_ouvertes` de `/metrics` ET par ce passage. Deux comptages
# écrits séparément finiraient par ne plus compter la même chose, et le jour où
# ils divergeraient, la jauge dirait « vide » pendant que l'alerte se tairait.
#
# UNE LECTURE EN PANNE N'EST PAS UN MARCHÉ VIDE : elle est écrite
# (`lecture_erreur`) et n'alerte pas — une panne de base ne doit pas produire
# une alerte sur la mauvaise cause, ni réarmer celle qui court.
#
# UNE SEULE ALERTE PAR ÉPISODE, réarmée par le RETOUR d'une mission ouverte
# (`retabli_at`), comme les deux autres alertes d'exploitation. Un seuil
# modifié est un épisode NEUF : la `signature` le porte.

MARCHE_ALERT_COLLECTION = "scheduler_alerts"
_MARCHE_ALERT_SUBJECT = "marche_vide"


async def compter_missions_ouvertes() -> int:
    """Le corpus OUVERT, selon l'unique règle du produit.

    Publique parce que la jauge `/metrics` s'en sert : une seule définition de
    « mission ouverte » (statut `open`, non supprimée), donc un tableau de bord
    et une alerte qui ne peuvent pas se contredire.
    """
    return int(
        await db.jobs.count_documents({"status": "open", "deleted": {"$ne": True}})
    )


def _signature_marche_vide(heures: int) -> str:
    """L'identité de l'épisode : ce qui a été mesuré, et avec quelle règle."""
    return "marche_vide:heures=%s" % heures


async def marche_vide_alert_once(now: Optional[datetime] = None) -> dict:
    """Un passage : mesure la continuité du vide et alerte au-delà du seuil.

    Retourne un résumé testable {etat, missions_ouvertes, vide_depuis_heures,
    alertes, retablissements, alertes_ignorees} : `alertes` vaut 1 exactement
    quand une alerte est partie sur ce passage, `alertes_ignorees` 1 quand le
    même épisode durait déjà, `retablissements` 1 quand une mission ouverte est
    réapparue.

    Trois états : `saine` (au moins une mission ouverte), `vide` (vide, sous le
    seuil), `alertee` (vide, seuil franchi, alerte partie).
    """
    now = now or datetime.now(timezone.utc)
    collection = db[MARCHE_ALERT_COLLECTION]
    etat = await collection.find_one({"_id": _MARCHE_ALERT_SUBJECT}) or {}
    signature = _signature_marche_vide(MARCHE_VIDE_ALERTE_HEURES)
    resume = {
        "etat": "inconnu",
        "missions_ouvertes": None,
        "vide_depuis_heures": None,
        "alertes": 0,
        "retablissements": 0,
        "alertes_ignorees": 0,
    }

    # ── La lecture avant tout : une panne n'est pas un vide ─────────────────
    try:
        ouvertes = await compter_missions_ouvertes()
    except Exception as exc:
        erreur = str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
        await collection.update_one(
            {"_id": _MARCHE_ALERT_SUBJECT},
            {"$set": {"lecture_erreur": erreur, "derniere_mesure_at": now}},
            upsert=True,
        )
        resume["etat"] = "lecture_impossible"
        resume["lecture_erreur"] = erreur
        logger.warning(
            "⚠️ Alerte marché vide: comptage des missions ouvertes impossible (%s) "
            "— aucun verdict, et l'état en cours n'est pas réarmé." % erreur
        )
        return resume

    resume["missions_ouvertes"] = ouvertes
    commun = {
        "signature": signature,
        "heures": MARCHE_VIDE_ALERTE_HEURES,
        "missions_ouvertes": ouvertes,
        "derniere_mesure_at": now,
        "lecture_erreur": "",
    }

    # ── Des missions ouvertes : la place respire, et on RÉARME ──────────────
    if ouvertes > 0:
        changement = dict(commun, etat="saine", vide_depuis=None)
        if etat.get("etat") in ("vide", "alertee"):
            changement["retabli_at"] = now
            resume["retablissements"] = 1
            logger.info(
                "✅ Place de marché de nouveau pourvue (%s mission(s) ouverte(s)) : "
                "l'alerte 'marché vide' est réarmée." % ouvertes
            )
        await collection.update_one(
            {"_id": _MARCHE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["etat"] = "saine"
        return resume

    # ── Vide : depuis QUAND ? Le chronomètre vit en base ────────────────────
    vide_depuis = _parse_payment_ts(etat.get("vide_depuis"))
    horodatage_illisible = 0
    if etat.get("vide_depuis") is not None and vide_depuis is None:
        # Une date illisible n'est ni « depuis toujours » (elle déclencherait
        # l'alerte sur une donnée qu'on ne sait pas lire) ni « maintenant »
        # (elle remettrait le chronomètre en silence) : elle est COMPTÉE, et le
        # chronomètre repart de cet instant, qui est un fait mesuré.
        horodatage_illisible = 1
        vide_depuis = now
    if vide_depuis is None:
        vide_depuis = now
    duree = now - vide_depuis
    if duree.total_seconds() < 0:
        # Une horloge en arrière (ou un état écrit dans le futur) ne se lit pas
        # comme une longue panne : on repart de maintenant, et le fait est
        # publié dans l'état.
        horodatage_illisible = 1
        vide_depuis = now
        duree = timedelta(0)

    heures_ecoulees = round(duree.total_seconds() / 3600, 1)
    resume["vide_depuis_heures"] = heures_ecoulees
    changement = dict(
        commun,
        vide_depuis=vide_depuis,
        vide_heures=heures_ecoulees,
        horodatage_illisible=horodatage_illisible,
    )

    # ── Sous le seuil : c'est un creux, pas un incident ─────────────────────
    if duree < timedelta(hours=MARCHE_VIDE_ALERTE_HEURES):
        changement["etat"] = "vide"
        await collection.update_one(
            {"_id": _MARCHE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["etat"] = "vide"
        logger.info(
            "📉 Place de marché vide depuis %s h (seuil %s h) — sous le seuil, "
            "aucune alerte." % (heures_ecoulees, MARCHE_VIDE_ALERTE_HEURES)
        )
        return resume

    # ── Seuil franchi : le MÊME épisode n'alerte qu'une fois ────────────────
    deja_signale = (
        etat.get("etat") == "alertee" and etat.get("signature") == signature
    )
    changement["etat"] = "alertee"
    if deja_signale:
        await collection.update_one(
            {"_id": _MARCHE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["etat"] = "alertee"
        resume["alertes_ignorees"] = 1
        logger.debug(
            "Marché vide : épisode déjà signalé (depuis %s) — pas de seconde alerte."
            % (etat.get("vide_depuis") or "inconnu")
        )
        return resume

    owner_id = await resolve_owner_id() or OWNER_USER_ID
    await notify_user_localized(
        user_id=owner_id,
        key="owner_marche_vide",
        notif_type=NotificationType.GENERAL,
        related_type="marche",
        duree=heures_ecoulees,
        heures=MARCHE_VIDE_ALERTE_HEURES,
    )

    alerte_envoyee = False
    alerte_erreur = ""
    if OWNER_EMAIL:
        try:
            await send_email_via_active_provider(
                OWNER_EMAIL,
                "KOJO — Place de marché vide depuis %s h" % heures_ecoulees,
                "Aucune mission OUVERTE en base depuis %s h (seuil d'alerte : %s h).\n\n"
                "Conséquence : les travailleurs n'ont rien à postuler, il n'y a "
                "aucune fiche à indexer (les sondes de SEO rendent des prémisses) "
                "et le revenu est nul. Une place de marché qui publie zéro mission "
                "n'est pas un creux, c'est une panne.\n"
                "À vérifier : la publication (GET /api/jobs?status=open), la jauge "
                "kojo_missions_ouvertes sur /metrics, et les comptes clients qui "
                "devraient publier.\n"
                "Le RETOUR d'une mission ouverte RÉ-ARME cette alerte : un nouvel "
                "épisode donnera un nouvel email ; le même, jamais deux.\n"
                % (heures_ecoulees, MARCHE_VIDE_ALERTE_HEURES),
            )
            alerte_envoyee = True
        except Exception as exc:
            # L'email est le canal SECONDAIRE (la notification in-app vient de
            # partir) : un échec est écrit, jamais tu.
            alerte_erreur = str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
            logger.warning("⚠️ Email d'alerte marché vide échoué: %s" % exc)
    else:
        alerte_erreur = "OWNER_EMAIL non configuré"
        logger.warning(
            "⚠️ Alerte marché vide : OWNER_EMAIL absent — la notification in-app "
            "est le seul canal."
        )

    changement["alertee_at"] = now
    changement["alerte_envoyee"] = alerte_envoyee
    changement["alerte_erreur"] = alerte_erreur
    await collection.update_one(
        {"_id": _MARCHE_ALERT_SUBJECT}, {"$set": changement}, upsert=True
    )
    resume["etat"] = "alertee"
    resume["alertes"] = 1
    logger.warning(
        "🚨 Place de marché vide depuis %s h (seuil %s h) — alerte envoyée "
        "(email=%s)." % (heures_ecoulees, MARCHE_VIDE_ALERTE_HEURES, alerte_envoyee)
    )
    return resume


async def marche_vide_alert_loop():
    """Tâche de fond : juge périodiquement si la place de marché est vide.

    Même modèle que les autres boucles : sommeil d'abord (aucun passage au
    redémarrage, ni à chaque déploiement), annulable proprement au shutdown,
    erreurs isolées par itération, et un BAIL par passage — sans lui, N machines
    Fly jugeraient N fois et pourraient alerter N fois.

    Le travail vit dans `marche_vide_alert_once` : il est appelable directement
    par un test, avec une horloge injectée.
    """
    while True:
        try:
            await asyncio.sleep(MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES * 60)
            await executer_si_bail(
                "marche_vide_alert",
                timedelta(minutes=MARCHE_VIDE_ALERTE_INTERVALLE_MINUTES),
                marche_vide_alert_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur alerte marché vide: {exc}")


# ---------------------------------------------------------------------------
# ALERTE « MISSIONS OUVERTES SANS AUCUNE PROPOSITION »
# ---------------------------------------------------------------------------
#
# Le complément de l'alerte précédente, et pas sa répétition. « Marché vide »
# dit que l'OFFRE a disparu ; ici l'offre est LÀ et personne n'a répondu. Une
# mission publiée depuis plusieurs jours sans une seule candidature n'est pas
# un détail d'affichage : elle est trop chère, mal datée, invisible dans la
# liste — ou située dans une ville où aucun travailleur n'est inscrit. Quatre
# corrections différentes, et aucune n'est visible sur un tableau de bord qui ne
# compte que des missions.
#
# LA MESURE EST UNE ANCIENNETÉ, pas une absence : une mission publiée il y a une
# heure sans proposition est une mission qui vient de paraître. Seules les
# missions plus vieilles que `MISSIONS_SANS_PROPOSITION_JOURS` (3 par défaut)
# et SANS AUCUNE proposition (aucun statut : une candidature refusée reste une
# candidature) sont comptées, avec leur plus ancienne en jours.
#
# DEUX LECTURES, DEUX PRÉMISSES : si les missions ne se lisent pas, on ne sait
# rien ; si les PROPOSITIONS ne se lisent pas, on ne peut pas conclure « aucune
# proposition » — et conclure le contraire ferait alerter sur TOUTES les
# missions ouvertes à chaque panne de la collection `job_proposals`. Dans les
# deux cas : l'erreur est écrite, rien n'est envoyé, et l'épisode en cours n'est
# pas réarmé.
#
# CE QUI EST BORNÉ EST DÉCLARÉ : au-delà de `MAX_MISSIONS_MESUREES` le compte
# est un PLANCHER (`tronque` dans l'état) ; au-delà de `MAX_PROPOSITIONS_LUES`
# on ne sait pas quelles missions ont reçu une candidature, donc on ne conclut
# rien (`mesure_tronquee`, aucune alerte).
#
# UNE ALERTE PAR CROISSANCE DE LA FILE, pas une par passage : le même nombre de
# missions en attente ne se répète pas toutes les six heures (c'est le rappel
# qu'on apprend à ignorer). Une mission de plus qui vieillit fait GRANDIR le
# compte — c'est un fait neuf, donc une alerte neuve. Une proposition reçue fait
# DESCENDRE le compte : pas d'alerte, mais le niveau retenu baisse, et le retour
# à zéro réarme (`retabli_at`) pour un épisode ultérieur.

MISSIONS_SANS_PROPOSITION_COLLECTION = "scheduler_alerts"
_MISSIONS_SANS_PROPOSITION_SUBJECT = "missions_sans_proposition"
# Borne de lecture des missions : au-delà, la mesure est TRONQUÉE et le dit.
MAX_MISSIONS_MESUREES = 500
# Borne de lecture des propositions : 5 000 lignes pour au plus 500 missions
# sans candidature, c'est dix par mission. Atteindre le plafond ne prouve pas
# qu'une mission n'a rien reçu : c'est une mesure qu'on ne sait pas conclure,
# donc une PRÉMISSE (aucune alerte), jamais un « aucune proposition » par défaut.
MAX_PROPOSITIONS_LUES = 5000
# Identifiants conservés dans l'état : de quoi agir sur les plus urgentes, pas
# une archive. Triés du plus ancien au plus récent.
MAX_MISSIONS_CITEES = 10


def _signature_missions_sans_proposition(jours: int) -> str:
    """L'identité de l'épisode : ce qui a été mesuré, et avec quelle règle."""
    return "sans_proposition:jours=%s" % jours


def _cles_mission(job: dict) -> set:
    """Toutes les façons dont une proposition peut désigner cette mission.

    Un document de mission porte son identifiant dans `id`, `job_id` (ancien)
    ou `_id` (jeu importé) ; la proposition, elle, a été écrite avec la chaîne
    que le client avait reçue. Comparer sur une seule forme laisserait croire
    qu'une mission ancienne n'a jamais reçu de candidature — et ferait alerter
    sur une mission qui a déjà trouvé preneur.
    """
    return {
        str(valeur)
        for valeur in (job.get("id"), job.get("job_id"), job.get("_id"))
        if valeur not in (None, "")
    }


class LectureImpossible(Exception):
    """Une lecture en panne, avec le CODE qui dit laquelle.

    Une panne n'est pas un verdict : l'appelant l'écrit et n'envoie rien. Le
    code distingue les deux causes (missions illisibles, propositions
    illisibles), qui n'ont pas le même remède.
    """

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def _missions_en_attente(seuil: timedelta, now: datetime) -> dict:
    """Missions ouvertes plus vieilles que `seuil` ET sans aucune proposition.

    LA RÈGLE VIT ICI, une fois. Deux alertes la lisent avec deux échelles : le
    propriétaire à l'échelle des JOURS (la place ne se remplit pas), le client à
    l'échelle des HEURES (sa mission ne reçoit rien). Deux comptages écrits
    séparément finiraient par ne plus compter la même chose — et l'un relancerait
    des clients pendant que l'autre dirait que la file est saine.

    Lève `LectureImpossible` quand une des deux lectures échoue : rendre un zéro
    par défaut ferait relancer des clients sur une panne de la base.
    """
    try:
        missions = await db.jobs.find(
            {"status": "open", "deleted": {"$ne": True}}
        ).to_list(MAX_MISSIONS_MESUREES + 1)
    except Exception as exc:
        raise LectureImpossible("lecture_erreur", str(exc)[:_EMAIL_ALERT_DETAIL_MAX])

    tronque = len(missions) > MAX_MISSIONS_MESUREES
    missions = missions[:MAX_MISSIONS_MESUREES]

    anciennes = []  # [(publiée_le, clé, mission)]
    date_illisible = 0
    for job in missions:
        publiee = _parse_payment_ts(job.get("posted_at")) or _parse_payment_ts(
            job.get("created_at")
        )
        cle = str(job.get("id") or job.get("job_id") or job.get("_id") or "")
        if publiee is None:
            # Une date illisible n'est PAS « très ancienne » (elle alerterait sur
            # une donnée qu'on ne sait pas lire) ni « récente » en silence : elle
            # est comptée, et elle sort de la mesure.
            date_illisible += 1
            continue
        if cle and now - publiee >= seuil:
            anciennes.append((publiee, cle, job))

    cles = set()
    for _publiee, cle, job in anciennes:
        cles |= _cles_mission(job)
    avec_proposition = set()
    propositions_tronquees = False
    if cles:
        try:
            propositions = await db.job_proposals.find(
                identifiants_query(sorted(cles), ("job_id",))
            ).to_list(MAX_PROPOSITIONS_LUES + 1)
        except Exception as exc:
            raise LectureImpossible(
                "propositions_lecture_erreur", str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
            )
        propositions_tronquees = len(propositions) > MAX_PROPOSITIONS_LUES
        # La mission peut être désignée par `job_id` (usage de l'app) ou par `_id`
        # (jeu IMPORTÉ) — et c'est précisément l'une de ces deux formes que la
        # requête ci-dessus a appariée. Ne garder que `job_id` rendrait invisibles
        # les lignes importées qu'on vient de lire : la mission compterait comme
        # « sans candidature » alors que sa proposition est sous nos yeux.
        for proposition in propositions:
            for valeur in (proposition.get("job_id"), proposition.get("_id")):
                if valeur not in (None, ""):
                    avec_proposition.add(str(valeur))

    sans = sorted(
        (
            (publiee, cle, job)
            for publiee, cle, job in anciennes
            if not (_cles_mission(job) & avec_proposition)
        ),
        key=lambda element: element[0],
    )
    return {
        "missions_ouvertes": len(missions),
        "sans": sans,
        "date_illisible": date_illisible,
        "tronque": tronque,
        "propositions_tronquees": propositions_tronquees,
    }


async def missions_sans_proposition_alert_once(now: Optional[datetime] = None) -> dict:
    """Un passage : compte les missions anciennes sans aucune proposition.

    Retourne un résumé testable {etat, missions_ouvertes, sans_proposition,
    plus_ancienne_jours, alertes, retablissements, alertes_ignorees}.

    Deux états : `saine` (aucune mission en attente) et `alertee` (un niveau a
    été signalé ; le niveau retenu est le PLUS HAUT atteint, donc une file qui
    redescend sans se vider ne réalerte pas, et une file qui grossit le fait).
    """
    now = now or datetime.now(timezone.utc)
    collection = db[MISSIONS_SANS_PROPOSITION_COLLECTION]
    etat = await collection.find_one({"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT}) or {}
    signature = _signature_missions_sans_proposition(MISSIONS_SANS_PROPOSITION_JOURS)
    resume = {
        "etat": "inconnu",
        "missions_ouvertes": None,
        "sans_proposition": None,
        "plus_ancienne_jours": None,
        "alertes": 0,
        "retablissements": 0,
        "alertes_ignorees": 0,
    }

    async def _premisse(code: str, erreur: str) -> dict:
        """Une lecture en panne : on l'écrit, on n'envoie rien, on ne réarme pas."""
        await collection.update_one(
            {"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT},
            {"$set": {code: erreur, "derniere_mesure_at": now}},
            upsert=True,
        )
        resume["etat"] = "lecture_impossible"
        resume["lecture_erreur"] = erreur
        logger.warning(
            "⚠️ Alerte missions sans proposition : lecture impossible (%s) — "
            "aucun verdict, et l'état en cours n'est pas réarmé." % erreur
        )
        return resume

    # ── 1-2. La mesure (une seule règle, partagée avec la relance client) ──
    try:
        mesure = await _missions_en_attente(
            timedelta(days=MISSIONS_SANS_PROPOSITION_JOURS), now
        )
    except LectureImpossible as exc:
        return await _premisse(exc.code, exc.message)

    resume["missions_ouvertes"] = mesure["missions_ouvertes"]
    commun = {
        "signature": signature,
        "jours": MISSIONS_SANS_PROPOSITION_JOURS,
        "missions_ouvertes": mesure["missions_ouvertes"],
        "derniere_mesure_at": now,
        "lecture_erreur": "",
        "propositions_lecture_erreur": "",
        "date_illisible": mesure["date_illisible"],
        "tronque": mesure["tronque"],
    }

    # ── 3. Ce qu'on ne sait pas conclure ──────────────────────────────────
    if mesure["propositions_tronquees"]:
        await collection.update_one(
            {"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT},
            {"$set": dict(commun, propositions_tronquees=True)},
            upsert=True,
        )
        resume["etat"] = "mesure_tronquee"
        resume["propositions_tronquees"] = 1
        logger.warning(
            "⚠️ Alerte missions sans proposition : %s propositions lues, plafond "
            "atteint — impossible de dire lesquelles sont sans candidature."
            % MAX_PROPOSITIONS_LUES
        )
        return resume

    sans = mesure["sans"]
    resume["sans_proposition"] = len(sans)
    plus_ancienne = (
        round((now - sans[0][0]).total_seconds() / 86400, 1) if sans else None
    )
    resume["plus_ancienne_jours"] = plus_ancienne
    changement = dict(
        commun,
        missions_sans_proposition=len(sans),
        plus_ancienne_jours=plus_ancienne,
        ids=[cle for _publiee, cle, _job in sans[:MAX_MISSIONS_CITEES]],
    )

    # ── 4. Plus rien en attente : la file est vide, donc on RÉARME ─────────
    if not sans:
        changement = dict(changement, etat="saine", alertee_pour=0)
        if etat.get("etat") == "alertee":
            changement["retabli_at"] = now
            resume["retablissements"] = 1
            logger.info(
                "✅ Plus aucune mission ancienne sans proposition : l'alerte est "
                "réarmée."
            )
        await collection.update_one(
            {"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["etat"] = "saine"
        return resume

    # ── 5. La file n'a pas grandi : déjà signalée ──────────────────────────
    deja_signale = (
        etat.get("etat") == "alertee"
        and etat.get("signature") == signature
        and len(sans) <= int(etat.get("alertee_pour") or 0)
    )
    changement["alertee_pour"] = int(etat.get("alertee_pour") or 0)
    if deja_signale:
        changement["etat"] = "alertee"
        await collection.update_one(
            {"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT}, {"$set": changement}, upsert=True
        )
        resume["etat"] = "alertee"
        resume["alertes_ignorees"] = 1
        logger.debug(
            "Missions sans proposition : file déjà signalée (%s) — pas de "
            "seconde alerte." % len(sans)
        )
        return resume

    owner_id = await resolve_owner_id() or OWNER_USER_ID
    await notify_user_localized(
        user_id=owner_id,
        key="owner_missions_sans_proposition",
        notif_type=NotificationType.GENERAL,
        related_type="marche",
        count=len(sans),
        jours=MISSIONS_SANS_PROPOSITION_JOURS,
        total=mesure["missions_ouvertes"],
        plus_ancienne=plus_ancienne,
    )

    alerte_envoyee = False
    alerte_erreur = ""
    if OWNER_EMAIL:
        try:
            await send_email_via_active_provider(
                OWNER_EMAIL,
                "KOJO — %s mission(s) sans aucune proposition" % len(sans),
                "%s mission(s) ouverte(s) sur %s attendent depuis plus de %s jour(s) "
                "SANS AUCUNE proposition (la plus ancienne depuis %s jour(s)).\n\n"
                "Conséquence : l'offre existe et personne ne postule — la place ne "
                "se remplit pas. À vérifier : le prix demandé, la ville et la "
                "catégorie (un métier sans travailleur inscrit dans cette ville ne "
                "recevra jamais de candidature), et la visibilité de la mission "
                "(GET /api/jobs?status=open).\n"
                "Le RETOUR de la file à zéro, ou une proposition reçue faisant "
                "BAISSER le compte, ne déclenche aucun email ; une mission de plus "
                "qui vieillit fait grandir la file et rouvre donc une alerte.\n"
                % (
                    len(sans),
                    mesure["missions_ouvertes"],
                    MISSIONS_SANS_PROPOSITION_JOURS,
                    plus_ancienne,
                ),
            )
            alerte_envoyee = True
        except Exception as exc:
            alerte_erreur = str(exc)[:_EMAIL_ALERT_DETAIL_MAX]
            logger.warning("⚠️ Email d'alerte missions sans proposition échoué: %s" % exc)
    else:
        alerte_erreur = "OWNER_EMAIL non configuré"
        logger.warning(
            "⚠️ Alerte missions sans proposition : OWNER_EMAIL absent — la "
            "notification in-app est le seul canal."
        )

    changement["etat"] = "alertee"
    changement["alertee_pour"] = len(sans)
    changement["alertee_at"] = now
    changement["alerte_envoyee"] = alerte_envoyee
    changement["alerte_erreur"] = alerte_erreur
    await collection.update_one(
        {"_id": _MISSIONS_SANS_PROPOSITION_SUBJECT}, {"$set": changement}, upsert=True
    )
    resume["etat"] = "alertee"
    resume["alertes"] = 1
    logger.warning(
        "🚨 %s mission(s) sans proposition depuis plus de %s jour(s) — alerte "
        "envoyée (email=%s)." % (len(sans), MISSIONS_SANS_PROPOSITION_JOURS, alerte_envoyee)
    )
    return resume


async def missions_sans_proposition_alert_loop():
    """Tâche de fond : juge périodiquement les missions sans candidature.

    Même modèle que les autres boucles : sommeil d'abord, annulable au
    shutdown, erreurs isolées par itération, et un BAIL par passage (N machines
    n'alertent pas N fois). Le travail vit dans
    `missions_sans_proposition_alert_once` : appelable avec une horloge.
    """
    while True:
        try:
            await asyncio.sleep(MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES * 60)
            await executer_si_bail(
                "missions_sans_proposition_alert",
                timedelta(minutes=MISSIONS_SANS_PROPOSITION_INTERVALLE_MINUTES),
                missions_sans_proposition_alert_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur alerte missions sans proposition: {exc}")


# ---------------------------------------------------------------------------
# RELANCE DU CLIENT — « votre mission n'a reçu aucune candidature »
# ---------------------------------------------------------------------------
#
# L'alerte « missions sans proposition » prévient le PROPRIÉTAIRE au bout de
# trois jours : elle dit que la place ne se remplit pas. Elle ne dit rien à la
# seule personne qui peut changer quelque chose à CETTE mission — son client,
# qui a fixé un prix, une date et une ville, et qui n'ouvre pas la file
# d'arbitrage. Une mission à 5 000 FCFA pour une plomberie à Dakar ne reçoit
# personne : le client, lui, peut corriger le prix, la date ou le quartier.
#
# POURQUOI QUELQUES HEURES ET PAS TROIS JOURS : passé une nuit sans candidature,
# le client doit pouvoir corriger pendant que sa mission est encore visible dans
# les listes. À trois jours, la relance arrive quand l'annonce est déjà morte.
#
# CE QUI EST BORNÉ ET DIT : une relance PAR MISSION (marqueur
# `nudge_sans_proposition_at` sur le document de la mission — jamais un compteur
# en mémoire, qui se perdrait au redémarrage), un plafond par passage
# (`MAX_CLIENTS_RELANCEES`), et une mission sans client lisible est COMPTÉE
# (`sans_client`) au lieu d'être notifiée à personne. Une lecture en panne n'est
# pas « zéro mission à relancer » : elle est écrite et ne relance rien.

CLIENT_SANS_PROPOSITION_COLLECTION = "scheduler_alerts"
_CLIENT_SANS_PROPOSITION_SUBJECT = "client_sans_proposition"
# Plafond de relances par passage : une rafale de notifications est le meilleur
# moyen de faire désinstaller l'application. Le reste part au passage suivant.
MAX_CLIENTS_RELANCEES = 25


def _signature_client_sans_proposition(heures: int) -> str:
    """L'identité de la règle appliquée (elle change le sens d'une relance)."""
    return "client_sans_proposition:heures=%s" % heures


async def clients_sans_proposition_once(now: Optional[datetime] = None) -> dict:
    """Un passage : relance les clients dont la mission n'a reçu aucune candidature.

    Retourne un résumé testable {etat, missions_ouvertes, sans_proposition,
    relances, deja_relancees, sans_client, plafond_atteint, lecture_erreur}.
    """
    now = now or datetime.now(timezone.utc)
    collection = db[CLIENT_SANS_PROPOSITION_COLLECTION]
    signature = _signature_client_sans_proposition(CLIENT_SANS_PROPOSITION_HEURES)
    resume = {
        "etat": "inconnu",
        "missions_ouvertes": None,
        "sans_proposition": None,
        "relances": 0,
        "deja_relancees": 0,
        "sans_client": 0,
        "plafond_atteint": 0,
        "lecture_erreur": "",
    }

    try:
        mesure = await _missions_en_attente(
            timedelta(hours=CLIENT_SANS_PROPOSITION_HEURES), now
        )
    except LectureImpossible as exc:
        await collection.update_one(
            {"_id": _CLIENT_SANS_PROPOSITION_SUBJECT},
            {"$set": {exc.code: exc.message, "derniere_mesure_at": now}},
            upsert=True,
        )
        resume["etat"] = "lecture_impossible"
        resume["lecture_erreur"] = exc.message
        logger.warning(
            "⚠️ Relance client : lecture impossible (%s) — personne n'est "
            "relancé sur une mesure qu'on ne sait pas lire." % exc.message
        )
        return resume

    resume["missions_ouvertes"] = mesure["missions_ouvertes"]
    resume["sans_proposition"] = len(mesure["sans"])
    if mesure["propositions_tronquees"]:
        # On ne sait pas quelles missions ont reçu une candidature : relancer
        # sur cette base enverrait des reproches faux à des clients servis.
        await collection.update_one(
            {"_id": _CLIENT_SANS_PROPOSITION_SUBJECT},
            {
                "$set": {
                    "signature": signature,
                    "missions_ouvertes": mesure["missions_ouvertes"],
                    "derniere_mesure_at": now,
                    "mesure_tronquee": True,
                }
            },
            upsert=True,
        )
        resume["etat"] = "mesure_tronquee"
        logger.warning(
            "⚠️ Relance client : %s propositions lues, plafond atteint — aucune "
            "relance (on ne sait pas qui a déjà reçu une candidature)."
            % MAX_PROPOSITIONS_LUES
        )
        return resume

    for publiee, cle, job in mesure["sans"]:
        if resume["relances"] >= MAX_CLIENTS_RELANCEES:
            resume["plafond_atteint"] = 1
            break
        client = str(job.get("client_id") or "").strip()
        if not client:
            resume["sans_client"] += 1
            continue
        if job.get("nudge_sans_proposition_at"):
            # Déjà relancé : une seconde relance pour la même mission est du bruit.
            resume["deja_relancees"] += 1
            continue

        heures = max(1, int(round((now - publiee).total_seconds() / 3600)))
        # Le compteur du PROCESS dit combien de relances sont parties ; l'EFFET,
        # lui, se mesure sur l'historique (`mesure_relances`) — un compteur n'est
        # pas une mesure, et l'inverse n'est pas vrai non plus.
        try:
            await notify_user_localized(
                user_id=client,
                key="client_mission_sans_proposition",
                notif_type=NotificationType.GENERAL,
                related_id=cle,
                related_type="job",
                job_title=str(job.get("title") or "votre mission"),
                heures=heures,
            )
        except Exception:
            _compteurs_relance["echecs"] += 1
            raise
        _compteurs_relance["envoyees"] += 1
        # Le marqueur est posé APRÈS l'envoi : une notification qui échoue
        # (exception de `notify_user_localized`) laisse la mission à relancer au
        # passage suivant, plutôt que de la perdre en la marquant comme faite.
        await db.jobs.update_one(
            identifiant_job_query(cle),
            {
                "$set": {
                    "nudge_sans_proposition_at": now,
                    "nudge_sans_proposition_heures": heures,
                }
            },
        )
        resume["relances"] += 1

    await collection.update_one(
        {"_id": _CLIENT_SANS_PROPOSITION_SUBJECT},
        {
            "$set": {
                "signature": signature,
                "heures": CLIENT_SANS_PROPOSITION_HEURES,
                "missions_ouvertes": mesure["missions_ouvertes"],
                "sans_proposition": len(mesure["sans"]),
                "date_illisible": mesure["date_illisible"],
                "tronque": mesure["tronque"],
                "plafond_atteint": bool(resume["plafond_atteint"]),
                "derniere_mesure_at": now,
                "derniere_relance_at": now if resume["relances"] else None,
                "lecture_erreur": "",
                "propositions_lecture_erreur": "",
                "mesure_tronquee": False,
            }
        },
        upsert=True,
    )
    resume["etat"] = "relancee" if resume["relances"] else "saine"
    if resume["relances"]:
        logger.info(
            "📩 %s client(s) relancé(s) : mission publiée depuis plus de %s h "
            "sans aucune proposition." % (resume["relances"], CLIENT_SANS_PROPOSITION_HEURES)
        )
    return resume


async def clients_sans_proposition_loop():
    """Tâche de fond : relance les clients des missions qui ne reçoivent rien.

    Même modèle que les autres boucles : sommeil d'abord (aucune rafale de
    relances à chaque redéploiement), annulable au shutdown, erreurs isolées
    par itération, et un BAIL par passage (N machines ne relancent pas N fois).
    Le travail vit dans `clients_sans_proposition_once`, appelable avec une
    horloge par les tests.
    """
    while True:
        try:
            await asyncio.sleep(CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES * 60)
            await executer_si_bail(
                "client_sans_proposition",
                timedelta(minutes=CLIENT_SANS_PROPOSITION_INTERVALLE_MINUTES),
                clients_sans_proposition_once,
            )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"⚠️ Erreur relance client sans proposition: {exc}")


# ---------------------------------------------------------------------------
# MESURE DES RELANCES — la relance a-t-elle été ENTENDUE ?
# ---------------------------------------------------------------------------
#
# La relance dit au client qu'il peut corriger son prix, sa date ou son
# quartier. Elle ne dit pas si la mission a ENSUITE reçu une candidature : le
# passage ne compte que des envois, et un envoi n'est pas un effet. Ce chiffre
# vit donc sur l'HISTORIQUE des missions portant le marqueur
# `nudge_sans_proposition_at` — la même donnée que celle qui empêche une seconde
# relance, lue pour une autre question.
#
# CE QUI EST COMPTÉ, ET CE QUI NE L'EST PAS :
#   • une candidature ne compte que si elle est ARRIVÉE APRÈS la relance
#     (`created_at` ≥ marqueur). Une candidature antérieure ne serait pas un
#     effet de la relance, et sa présence sur une mission relancée est une
#     CONTRADICTION : elle est publiée (`candidature_prealable`), jamais
#     recasée en succès ;
#   • une candidature dont la date est ILLISIBLE ne devient ni un succès ni un
#     échec — elle est comptée à part (`propositions_date_illisible`), sinon
#     elle gonflerait le taux surveillé dans un sens ou dans l'autre ;
#   • un marqueur illisible, futur ou hors fenêtre est COMPTÉ et exclu, jamais
#     recasé « maintenant » ;
#   • la lecture est BORNÉE et le dit (`tronque`, `mesure_tronquee`) : au-delà
#     de `MAX_RELANCEES_MESUREES` ou de `MAX_PROPOSITIONS_LUES`, on ne sait plus
#     quelles missions ont reçu une candidature, donc AUCUN taux n'est publié.
#
# PLANCHER : sous `RELANCE_PLANCHER_MESURE` relances mesurées, le taux vaut
# `None` et les COMPTES bruts restent publiés (ils sont vrais). Un pourcentage
# sur trois envois est du bruit, pas une mesure.
RELANCE_PLANCHER_MESURE = 10
# Fenêtre DÉCLARÉE : une fenêtre libre rendrait deux mesures incomparables.
# 30 jours, comme la première fenêtre de l'arbitrage.
RELANCE_FENETRE_JOURS = 30
# Bornes de lecture, déclarées pour la même raison que celles de la file.
MAX_RELANCEES_MESUREES = 500

# Compteurs du PROCESS (remis à zéro par un redémarrage, ce que Prometheus lit
# avec `rate()`) : ils disent combien de relances sont parties d'ici, pas si
# elles ont servi. L'effet est la mesure ci-dessous.
_compteurs_relance = {"envoyees": 0, "echecs": 0}


def relance_stats() -> dict:
    """Compteurs du process : relances parties, et envois qui ont échoué."""
    return dict(_compteurs_relance)


def _delais_candidature(delais: list) -> dict:
    """Médiane, moyenne et pire délai relance → première candidature.

    Règle PROPRE à cette mesure (heures entre le marqueur et la première
    candidature) : elle ne reprend pas celle de l'arbitrage, qui mesure un
    autre intervalle. Une liste vide ne devient pas zéro : `n = 0` et des
    valeurs `None` disent qu'aucun délai n'a été mesuré.
    """
    if not delais:
        return {"n": 0, "mediane_heures": None, "moyenne_heures": None, "max_heures": None}
    tries = sorted(delais)
    milieu = len(tries) // 2
    mediane = tries[milieu] if len(tries) % 2 else (tries[milieu - 1] + tries[milieu]) / 2
    return {
        "n": len(tries),
        "mediane_heures": round(mediane / 3600.0, 1),
        "moyenne_heures": round(sum(tries) / len(tries) / 3600.0, 1),
        "max_heures": round(tries[-1] / 3600.0, 1),
    }


async def mesure_relances(
    now: Optional[datetime] = None,
    fenetre_jours: Optional[int] = None,
    limite: Optional[int] = None,
) -> dict:
    """Les relances clients ONT-ELLES fait arriver des candidatures ?

    Mesure sur les missions RELANCÉES de la fenêtre (`nudge_sans_proposition_at`
    ≥ `now - fenetre_jours`) : combien ont reçu au moins une candidature APRÈS
    la relance, et après combien de temps. Les dénominateurs sont publiés avec
    le taux, le taux vaut `None` sous `RELANCE_PLANCHER_MESURE`, et une lecture
    bornée dit qu'elle l'est.

    Une lecture EN PANNE remonte l'exception : l'appelant (route propriétaire,
    scrape) la nomme. Rendre un zéro ferait lire « aucune relance n'a servi »
    là où on ne sait pas lire la base — exactement le silence que cette mesure
    existe pour fermer.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    jours = int(fenetre_jours or RELANCE_FENETRE_JOURS)
    # La borne se lit à l'APPEL, pas à la définition : une valeur par défaut
    # figée dans la signature ignorerait toute modification de la constante
    # (relue par les tests et par la configuration).
    limite = MAX_RELANCEES_MESUREES if limite is None else int(limite)
    depuis = now - timedelta(days=jours)

    filtre = {"nudge_sans_proposition_at": {"$exists": True}}
    total = await db.jobs.count_documents(filtre)
    missions = await db.jobs.find(filtre).to_list(limite + 1)
    tronque = len(missions) > limite
    missions = missions[:limite]

    date_illisible = 0
    date_future = 0
    hors_fenetre = 0
    mesurees = []  # [(relance_le, clés, mission)]
    for job in missions:
        relance_le = _parse_payment_ts(job.get("nudge_sans_proposition_at"))
        if relance_le is None:
            # Un marqueur illisible n'est ni ancien ni récent : compté, exclu.
            date_illisible += 1
            continue
        if relance_le > now:
            date_future += 1
            continue
        if relance_le < depuis:
            hors_fenetre += 1
            continue
        cles = _cles_mission(job)
        if cles:
            mesurees.append((relance_le, cles, job))

    cles_lues = set()
    for _relance_le, cles, _job in mesurees:
        cles_lues |= cles

    propositions = []
    propositions_tronquees = False
    if cles_lues:
        propositions = await db.job_proposals.find(
            identifiants_query(sorted(cles_lues), ("job_id",))
        ).to_list(MAX_PROPOSITIONS_LUES + 1)
        propositions_tronquees = len(propositions) > MAX_PROPOSITIONS_LUES
        propositions = propositions[:MAX_PROPOSITIONS_LUES]

    par_mission = {}  # clé → [instant de candidature ou None]
    for proposition in propositions:
        instant = _parse_payment_ts(proposition.get("created_at"))
        for valeur in (proposition.get("job_id"), proposition.get("_id")):
            if valeur not in (None, ""):
                par_mission.setdefault(str(valeur), []).append(instant)

    avec_candidature = 0
    sans_candidature = 0
    candidature_prealable = 0
    propositions_date_illisible = 0
    delais = []
    for relance_le, cles, _job in mesurees:
        instants = []
        for cle in cles:
            instants.extend(par_mission.get(cle, []))
        if not instants:
            sans_candidature += 1
            continue
        lisibles = [instant for instant in instants if instant is not None]
        if not lisibles:
            # La mission a des candidatures, mais aucune date lisible : on ne
            # peut pas dire si elles précèdent ou suivent la relance.
            propositions_date_illisible += 1
            continue
        apres = [instant for instant in lisibles if instant >= relance_le]
        if not apres:
            # Relancée alors qu'elle avait déjà une candidature : la donnée se
            # contredit (ou une candidature antidatée existe). Compté, jamais
            # compté comme un succès.
            candidature_prealable += 1
            continue
        avec_candidature += 1
        delais.append((min(apres) - relance_le).total_seconds())

    mesure_tronquee = tronque or propositions_tronquees
    taux = None
    if not mesure_tronquee and len(mesurees) >= RELANCE_PLANCHER_MESURE:
        taux = round(avec_candidature / len(mesurees), 3)

    return {
        "mesure_le": now.isoformat(),
        "fenetre_jours": jours,
        "depuis": depuis.isoformat(),
        "plancher": RELANCE_PLANCHER_MESURE,
        "relances": {
            "total": total,
            "lues": len(missions),
            "tronque": tronque,
        },
        "mesurees": len(mesurees),
        "avec_candidature": avec_candidature,
        "sans_candidature": sans_candidature,
        "taux_candidature": taux,
        "delai_candidature": _delais_candidature(delais),
        "exclusions": {
            "date_illisible": date_illisible,
            "date_future": date_future,
            "hors_fenetre": hors_fenetre,
            "candidature_prealable": candidature_prealable,
            "propositions_date_illisible": propositions_date_illisible,
            "propositions_lues": len(propositions),
            "propositions_tronquees": propositions_tronquees,
            "mesure_tronquee": mesure_tronquee,
        },
    }
