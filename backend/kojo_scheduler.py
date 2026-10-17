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
from kojo_settings import (
    EMAIL_HEALTH_ALERT_INTERVAL_MINUTES,
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
