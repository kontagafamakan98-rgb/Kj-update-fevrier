# -*- coding: utf-8 -*-
"""Suppression de compte (RGPD) et export des données personnelles.

Les deux vivent dans le MÊME module parce qu'ils répondent à la même question
par les deux bouts : ce que le dépôt CONSERVE (l'export) et ce qu'il efface,
anonymise ou garde (la suppression). Séparés, ils divergeraient — alors que le
registre de conservation de `kojo_retention` est la source des durées, et que
l'export est la contrepartie exacte de la cascade d'effacement.

L'ordre des opérations de la suppression est critique et documenté sur
l'endpoint (rembourser les fonds séquestrés AVANT d'anonymiser, refuser quand un
remboursement a échoué) : il n'a pas bougé.
"""
import asyncio

import uuid

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from fastapi.responses import JSONResponse

from kojo_core import db

from kojo_models import NotificationType, User

from kojo_settings import logger

# Durée de conservation d'un compte supprimé : l'échéance est DEMANDÉE à la
# règle de conservation au lieu d'être recopiée ici — c'est la même durée que
# celle de l'index TTL et celle que publie PRIVACY.md.
from kojo_retention import echeance_de_purge

from kojo_core import get_current_user, sanitize_email

from kojo_shared import nom_affiche, notify_user_localized, retirer_nom_des_notifications_tiers

from kojo_payments import maj_sequestre

# Réutilise le remboursement PayDunya de kojo_routers_jobs (point unique de
# vérité du décaissement de refund, avec verrou CAS et mapping IPN refund-aware).
from kojo_routers_jobs import execute_paydunya_refund

router = APIRouter()


# ---------------------------------------------------------------------------
# Suppression de compte (droit RGPD / store) — SOFT DELETE + anonymisation
# ---------------------------------------------------------------------------

# Statuts de versement REFUNDABLES de façon SÛRE (PayDunya n'a rien exécuté) :
# held (fonds séquestrés), release_failed (versement travailleur refusé),
# refund_failed (échec EXPLICITE d'un remboursement précédent — rien exécuté,
# une relance est sûre).
REFUNDABLE_PAYOUT_STATES = ("held", "release_failed", "refund_failed")

# Champs qui situent physiquement un client dans une mission. La mission
# supprimée n'en garde AUCUN : elle est filtrée partout par `deleted`, donc plus
# personne ne la lit, et une seule coordonnée restante suffirait à re-situer le
# compte supprimé. `geo` est le point GeoJSON de la recherche par rayon ;
# `location.coordinates` la forme historique — les deux dérivent de
# location.latitude/longitude à des époques différentes.
JOB_LOCATION_FIELDS = (
    "shared_location",
    "location.latitude",
    "location.longitude",
    "location.coordinates",
    "geo",
)

# --- Anonymisation RGPD : ce qui advient de CHAQUE champ du compte ------------
# Deux tables dont l'union doit couvrir EXACTEMENT les champs du modèle `User`
# (plus les champs de document hors modèle, déclarés à part) :
#
#   * `ANONYMISATION_CHAMPS` — effacés, et par quelle valeur. Le `$set` de
#     l'endpoint est CONSTRUIT depuis cette table, donc une valeur effacée n'a
#     qu'un propriétaire : retirer une ligne ici retire l'effacement, et le test
#     le voit rougir.
#   * `CHAMPS_CONSERVES` — conservés (ou réécrits), chacun avec sa RAISON.
#
# L'invariant est porté par `test_delete_account_erases_identity_and_referral_pii` :
# un champ du modèle absent des deux tables fait ÉCHOUER le test en le nommant.
# C'est ce qui remplace la liste d'assertions tenue à la main — ajouter une PII
# au modèle oblige à trancher ici, au lieu de la laisser survivre en silence.
ANONYMISATION_CHAMPS = {
    # PII nominatives : sans elles, le document présenté comme anonymisé gardait
    # le nom de la personne, et un accès direct à la collection permettait de la
    # réidentifier.
    "first_name": None,
    "last_name": None,
    # Texte LIBRE : la bio redonnait en clair le nom et le téléphone effacés
    # juste à côté, dans le même document.
    "bio": None,
    # Profil professionnel : `worker_profiles` (qui porte les specialities) est
    # supprimé en cascade, donc garder `skills` ici laissait la moitié du même
    # profil derrière lui.
    "skills": [],
    "phone": None,
    "password_hash": None,
    "google_sub": None,
    "profile_photo": None,
    "payment_accounts": None,
    "payment_accounts_count": 0,
    "referral_code": None,
    "referred_by": None,
    "referral_reward_balance": 0.0,
    "referral_rewards": [],
    # Hors modèle `User` : permissions de l'équipe, posées sur le compte par
    # kojo_core.ensure_owner_exists et lues par /owner/monitor. Un compte
    # supprimé ne peut garder aucun accès élevé.
    "permissions": [],
}

# Champs CONSERVÉS dans le document anonymisé, avec la raison — c'est la
# contrepartie de la table ci-dessus, et elle est exhaustive comme elle.
CHAMPS_CONSERVES = {
    "id": "identifiant interne (UUID) : clé des paiements et des missions qui le référencent, aucune identité",
    "_id": "clé primaire de Mongo, posée par la base et jamais réécrite par la suppression (le document anonymisé la porte encore) : aucune identité, l'identifiant applicatif est `id`",
    "email": "RÉÉCRITE en adresse de service @kojo.deleted : l'adresse de la personne ne survit pas, mais la forme reste valide pour les index uniques",
    "user_type": "rôle technique, nécessaire aux agrégats et aux missions conservées",
    "country": "pays de rattachement, sans identité",
    "preferred_language": "préférence d'interface, sans identité",
    "legal_documents_accepted": "preuve de consentement aux documents légaux : une obligation se prouve, elle ne s'efface pas",
    "legal_documents_accepted_at": "horodatage de ce consentement",
    "legal_documents_version": "version acceptée des documents",
    "is_owner": "booléen dérivé de l'email (recalculé à chaque lecture) ; aucun contrôle d'accès ne lit ce champ — verify_owner_access compare les emails",
    "is_verified": "état de vérification, sans identité",
    "email_verified": "état de vérification, sans identité",
    "email_verified_at": "horodatage de cette vérification",
    "referral_first_job_rewarded": "état de récompense de parrainage (booléen), sans identité",
    "rating": "moyenne des avis RECUS, qui sont conservés parce qu'ils appartiennent aussi au travailleur qui les a reçus",
    "total_reviews": "compteur de ces avis, sans identité",
    "created_at": "horodatage de création, conservé avec la trace comptable",
    "updated_at": "REÉCRITE à l'horodatage de la suppression",
}

# Champs que le document porte SANS figurer dans le modèle `User` (écrits
# directement en base, par le dépôt ou par l'endpoint). Déclarés pour que
# l'union ci-dessus puisse être une ÉGALITÉ : un champ hors modèle non déclaré
# ici, ou une faute de frappe dans l'une des deux tables, fait échouer le test.
CHAMPS_HORS_MODELE = frozenset({"permissions", "deleted", "deleted_at", "purge_at", "_id"})

@router.delete("/users/account")
async def delete_my_account(current_user: User = Depends(get_current_user)):
    """Supprime définitivement le compte de l'utilisateur connecté.

    Ordre critique (audit RGPD) :
    1. Les fonds SÉQUESTRÉS (paiement `held` / `release_failed` /
       `refund_failed` où l'utilisateur est le PAYEUR) sont remboursés AVANT
       toute anonymisation : `execute_paydunya_refund` lit les comptes mobile
       money du payeur en base — purger `payment_accounts` d'abord rendrait
       le remboursement impossible et l'argent resterait bloqué chez PayDunya.
    2. GARDE 409 : un versement/remboursement EN VOL (`releasing` /
       `refunding`) est ambigu (l'IPN n'a pas tranché) → suppression refusée.
       Un remboursement qui ÉCHOUE bloque aussi la suppression (le propriétaire
       doit relancer pendant que le compte possède encore ses moyens de
       paiement).
    3. Les paiements TERMINÉS (`released` / `refunded`) ne sont JAMAIS
       touchés : ni re-remboursés, ni re-annulés (pas de double remboursement).
    4. Les missions où ce compte est le TRAVAILLEUR assigné sont
       réinitialisées (annulées, assignment retiré) et le CLIENT est remboursé
       des fonds séquestrés — les données du client ne sont pas supprimées.

    Puis : soft delete + anonymisation des PII (email masqué ; nom, prénom,
    bio, profil professionnel, mot de passe et numéro de téléphone effacés) →
    les jetons existants deviennent inutiles (get_current_user rejette un compte
    `deleted`, et aucun login possible sans password_hash).

    Cascade : push tokens, notifications, propositions envoyées, avis laissés,
     tickets support (supprimés, et non anonymisés : leur message est du texte
     libre qui peut nommer l'utilisateur) ; le NOM du compte est retiré des
     notifications de l'AUTRE PARTIE (les gabarits de proposition l'interpolent à
     l'écriture, donc la copie vit dans la boîte du tiers et survivrait à
     l'anonymisation) ; les jobs créés par le client sont soft-deleted ET
     perdent toute coordonnée GPS (la sienne, partagée ou non).
    Les messages restent (ils appartiennent aussi à l'autre partie). Les
    enregistrements DE PAIEMENT sont conservés (obligation comptable / lutte
    contre la fraude) : ils référencent des identifiants internes, plus aucune
    PII n'y est jointe après anonymisation.

    Returns:
        dict: {message, deleted: true}.
    """
    user_id = current_user.id
    now = datetime.now(timezone.utc)

    # ------------------------------------------------------------------
    # 1) GARDE : paiement en vol (versement OU remboursement) côté PAYEUR
    # ------------------------------------------------------------------
    # releasing = versement au travailleur en cours ; refunding = remboursement
    # en cours. Dans les deux cas l'IPN n'a pas tranché : supprimer le compte
    # maintenant gèlerait l'argent sans voie de résolution → 409.
    in_flight_payment = await db.payments.find_one(
        {
            "payer_id": user_id,
            "status": "completed",
            "payout_status": {"$in": ["releasing", "refunding"]},
        },
        {"_id": 1},
    )
    if in_flight_payment:
        raise HTTPException(
            status_code=409,
            detail=(
                "Un paiement est en cours de traitement sur votre compte : "
                "attendez sa confirmation avant de supprimer votre compte."
            ),
        )

    # ------------------------------------------------------------------
    # 2) REMBOURSEMENT des fonds séquestrés (AVANT toute anonymisation)
    # ------------------------------------------------------------------
    # held / release_failed / refund_failed : PayDunya n'a rien exécuté, un
    # remboursement est sûr. Le verrou CAS (→ refunding) empêche un double
    # remboursement concurrent. On lit payment_accounts du payeur TANT QU'IL
    # EST ENCORE EN BASE.
    refundable_payments = await db.payments.find(
        {
            "payer_id": user_id,
            "status": "completed",
            "payout_status": {"$in": list(REFUNDABLE_PAYOUT_STATES)},
        }
    ).to_list(length=100)

    for payment in refundable_payments:
        payout_status = payment.get("payout_status") or "held"
        lock_result = await db.payments.update_one(
            {"id": payment["id"], "payout_status": payout_status},
            maj_sequestre("refunding", {"payout_kind": "refund", "updated_at": now}),
        )
        if lock_result.matched_count == 0:
            # Concurrence : un autre flux traite déjà ce paiement.
            continue
        outcome = await execute_paydunya_refund(payment)
        if outcome == "refund_failed":
            # L'argent est coincé : refuser la suppression pour que le
            # propriétaire puisse relancer (retry-refund) tant que le compte
            # possède encore ses moyens de paiement.
            raise HTTPException(
                status_code=409,
                detail=(
                    "Un remboursement automatique a échoué : contactez le "
                    "support avant de supprimer votre compte."
                ),
            )
        # refunded / refunding → on poursuit (l'IPN confirmera le cas échéant).

    # ------------------------------------------------------------------
    # 3) RESET des missions où ce compte est le TRAVAILLEUR assigné
    # ------------------------------------------------------------------
    # Un travailleur supprimé ne peut plus mener la mission : on annule les
    # jobs qui lui étaient attribués (les données appartiennent au CLIENT, pas
    # de soft-delete) et on rembourse le client des fonds séquestrés — le
    # payeur n'est pas le compte supprimé, ses comptes restent intacts.
    assigned_jobs = await db.jobs.find(
        {"assigned_worker_id": user_id, "deleted": {"$ne": True}}
    ).to_list(length=200)

    for job in assigned_jobs:
        job_id = job.get("id") or job.get("job_id")
        if not job_id:
            continue

        job_payment = await db.payments.find_one(
            {"job_id": job_id, "status": "completed"},
            sort=[("created_at", -1)],
        )
        if job_payment:
            payout_status = job_payment.get("payout_status") or "held"
            if payout_status in REFUNDABLE_PAYOUT_STATES:
                lock_result = await db.payments.update_one(
                    {"id": job_payment["id"], "payout_status": payout_status},
                    maj_sequestre("refunding", {"payout_kind": "refund", "updated_at": now}),
                )
                if lock_result.matched_count:
                    await execute_paydunya_refund(job_payment)
            # releasing / refunding / released / refunded : l'IPN tranche, on
            # ne touche à rien (pas de double remboursement).

        await db.jobs.update_one(
            {"id": job_id},
            {"$set": {
                "status": "cancelled",
                "assigned_worker_id": None,
                "accepted_proposal_id": None,
                "cancelled_at": now,
                "updated_at": now,
            }},
        )

        client_id = job.get("client_id")
        if client_id:
            asyncio.create_task(notify_user_localized(
                user_id=client_id,
                key="mission_cancelled_client",
                notif_type=NotificationType.GENERAL,
                related_id=job_id,
                related_type="job",
                job_title=job.get("title") or "la mission",
            ))

    # ------------------------------------------------------------------
    # 4) ANONYMISATION (soft delete) — APRÈS les remboursements
    # ------------------------------------------------------------------
    anonymous_email = f"deleted_{uuid.uuid4().hex[:12]}@kojo.deleted"

    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "deleted": True,
            "deleted_at": now,
            # Échéance de purge : ce champ est la DATE DE MORT du document
            # anonymisé (règle `users` de kojo_retention). Sans lui, le filtre
            # de purge ne verrait jamais ce document et l'anonymisation serait
            # définitive — ce que la politique ne promet pas.
            "purge_at": echeance_de_purge("users", now),
            "email": anonymous_email,
            "updated_at": now,
            # Les valeurs effacées viennent d'ANONYMISATION_CHAMPS (une seule
            # table, donc le test qui la parcourt prouve l'effacement RÉEL au
            # lieu de réaffirmer une liste recopiée à côté du code).
            **ANONYMISATION_CHAMPS,
        }}
    )

    # Cascade des données directement liées au compte.
    await db.push_tokens.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"user_id": user_id})
    # Les notifications dont ce compte était le DESTINATAIRE viennent de partir,
    # mais le nom vit aussi chez l'autre partie : `proposal_received` et
    # `proposal_accepted` l'interpolent à l'écriture (kojo_shared), et la copie
    # appartient au TIERS. Le nom est lu sur `current_user`, chargé au début de
    # la requête : le `$set` d'anonymisation ci-dessus a déjà vidé le document,
    # mais l'objet en mémoire, lui, porte encore le nom — après lui, plus rien ne
    # le retrouverait.
    await retirer_nom_des_notifications_tiers(user_id, nom_affiche(current_user))
    await db.worker_profiles.delete_many({"user_id": user_id})
    await db.job_proposals.delete_many({"worker_id": user_id})
    await db.reviews.delete_many({"reviewer_id": user_id})
    # Les tickets support du compte sont SUPPRIMES, pas anonymisés : leur
    # `message` est du texte libre écrit par l'utilisateur, qui peut nommer,
    # situer ou donner un téléphone dans une phrase. Effacer full_name/phone/
    # email laisserait le reste de la phrase intacte — donc une suppression est
    # la seule qui soit une garantie, et ces tickets appartiennent au même
    # utilisateur que les notifications et les propositions, déjà supprimées.
    await db.support_tickets.delete_many({"user_id": user_id})
    # Les missions POSTÉES par ce client sont closes (plus de nouvelles
    # propositions, plus visibles publiquement) et perdent TOUTE coordonnée :
    # `$unset` plutôt que `None`, pour que la clé disparaisse au lieu de rester
    # en place avec une valeur vide (l'index géospatial 2dsphere ignore un
    # document sans `geo`, il ne le situe plus). Les messages restent
    # (ils appartiennent aussi à l'autre partie).
    await db.jobs.update_many(
        {"client_id": user_id},
        {
            "$set": {"deleted": True, "deleted_at": now, "status": "cancelled"},
            "$unset": {field: "" for field in JOB_LOCATION_FIELDS},
        },
    )

    # Used by get_current_user (aucune session ne peut plus se réauthentifier) :
    # le jeton en cours restera valide jusqu'à son expiration naturelle, mais
    # chaque appel renverra 401 (compte inexistant) → le frontend redirigera
    # vers /login et videra le stockage local.

    logger.info(f"✅ Compte supprimé (soft delete): {user_id}")
    return {"message": "Votre compte Kojo a été supprimé. Au revoir !", "deleted": True}


# ---------------------------------------------------------------------------
# Export des données personnelles (droit d'accès RGPD) — GET /users/account/export
# ---------------------------------------------------------------------------

# Ce que le dépôt conserve pour un compte : chaque source nomme la collection ET
# les champs qui peuvent porter l'identifiant de l'utilisateur (un document est
# à lui si l'un d'eux le désigne). C'est la contrepartie exacte de la cascade de
# suppression ci-dessus, et la raison pour laquelle les deux vivent dans le même
# fichier : « ce qu'on garde » et « quand on l'efface » se lisent ensemble.
#
# Un document conservé à cause d'une AUTRE partie (un message reçu, un avis
# reçu) est rendu quand même : c'est une donnée personnelle de l'utilisateur
# même quand elle ne lui appartient pas.
USER_DATA_SOURCES = (
    ("users", ("id",)),
    ("worker_profiles", ("user_id",)),
    ("jobs", ("client_id", "assigned_worker_id")),
    ("job_proposals", ("worker_id",)),
    ("messages", ("sender_id", "receiver_id")),
    ("payments", ("payer_id", "receiver_id")),
    ("commissions", ("worker_id",)),
    ("reviews", ("reviewer_id", "reviewee_id")),
    ("notifications", ("user_id",)),
    ("support_tickets", ("user_id",)),
    ("push_tokens", ("user_id",)),
)

# Collections qui portent des données d'un utilisateur mais SANS clé
# d'identifiant : elles se lisent autrement que par `USER_DATA_SOURCES`. Ici les
# codes OTP, indexés par EMAIL — l'endpoint les rend donc avec l'adresse du
# compte, sans quoi un code encore valide pour cette personne manquerait à son
# export alors qu'il est conservé sur elle.
USER_DATA_BY_EMAIL = ("email_otps",)

# Le champ par lequel ces collections se lisent : elles ne portent pas
# d'identifiant de compte, elles sont indexées par l'ADRESSE. Nommé ici pour que
# le test qui confronte l'export et la suppression n'ait pas à recopier ce champ
# (la suppression ne les touche pas : elles périment par leur propre règle de
# conservation, kojo_retention).
USER_DATA_BY_EMAIL_FIELD = "email"

# Collections qui ne portent AUCUNE donnée d'un utilisateur. Elles sont listées
# quand même : le test de classement exige que TOUTE collection du backend soit
# dans l'une de ces listes, donc en ajouter une oblige à trancher ici au lieu de
# la voir manquer à l'export sans que rien ne le dise.
NO_USER_DATA_COLLECTIONS = (
    "revoked_tokens",  # jti + date d'expiration, aucune identité
    "settings",        # configuration globale (taux de commission)
)

# Secrets qui ne sortent JAMAIS d'un export : ils ne servent pas la personne qui
# demande ses données et les recopier dans un fichier téléchargé les exposerait.
EXPORT_WITHHELD_FIELDS = {"users": ("password_hash",), "email_otps": ("otp_hash",)}

# Plafond par collection : un export qui raconte tout doit pouvoir le faire, mais
# pas au prix d'une réponse non bornée. Le dépassement est SIGNALÉ par
# `truncated` (un export d'accès incomplet qui se tait n'est pas conforme).
EXPORT_LIMIT_PER_COLLECTION = 1000


def _exportable(value):
    """Rend un document Mongo sérialisable : dates en ISO, le reste (ObjectId,
    Decimal…) en texte. Un export qui lève sur un identifiant interne n'est pas
    un export."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _exportable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_exportable(item) for item in value]
    return str(value)


def _without_secrets(collection: str, document: dict) -> dict:
    """Le document, moins les champs de EXPORT_WITHHELD_FIELDS."""
    withheld = EXPORT_WITHHELD_FIELDS.get(collection, ())
    return {
        key: _exportable(value)
        for key, value in (document or {}).items()
        if key not in withheld
    }

def _user_documents_query(user_id: str, fields) -> dict:
    """Documents dont l'un des champs désigne ce compte."""
    return {"$or": [{field: user_id} for field in fields]}


@router.get("/users/account/export")
async def export_my_data(current_user: User = Depends(get_current_user)):
    """Export des données personnelles du compte connecté (droit d'accès RGPD).

    Rend tout ce que le dépôt conserve pour cet identifiant, collection par
    collection, dans la forme où c'est stocké — y compris ce qui est conservé
    à cause d'une autre partie (messages reçus, avis reçus, paiements où
    l'utilisateur est le destinataire).

    Deux choses ne sortent pas : `password_hash` et le condensé d'un code OTP en
    attente (`otp_hash`) — des secrets, qu'un fichier téléchargé ne doit pas
    contenir (voir EXPORT_WITHHELD_FIELDS, rendu dans `withheld`).

    Une collection plafonnée (EXPORT_LIMIT_PER_COLLECTION) le dit par
    `truncated: true` : un export incomplet qui se tairait ne serait pas un
    droit d'accès.

    Returns:
        dict: {generated_at, user_id, account, collections, withheld}.
    """
    user_id = current_user.id
    user_email = sanitize_email(current_user.email)
    collections = {}

    for name, fields in USER_DATA_SOURCES:
        query = _user_documents_query(user_id, fields)
        total = await db[name].count_documents(query)
        documents = await db[name].find(query).to_list(length=EXPORT_LIMIT_PER_COLLECTION)
        collections[name] = {
            "count": total,
            "truncated": total > len(documents),
            "documents": [_without_secrets(name, doc) for doc in documents],
        }

    # Les collections de USER_DATA_BY_EMAIL (codes OTP) sont indexées par EMAIL.
    otp_query = {USER_DATA_BY_EMAIL_FIELD: user_email}
    otp_total = await db.email_otps.count_documents(otp_query)
    otp_documents = await db.email_otps.find(otp_query).to_list(
        length=EXPORT_LIMIT_PER_COLLECTION
    )
    collections["email_otps"] = {
        "count": otp_total,
        "truncated": otp_total > len(otp_documents),
        "documents": [_without_secrets("email_otps", doc) for doc in otp_documents],
    }

    # Le compte lui-même sort sous `account` : c'est le document que la personne
    # reconnaît, pas une collection parmi les autres.
    users_entry = collections.pop("users")
    account = users_entry["documents"][0] if users_entry["documents"] else None

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id,
        "account": account,
        "collections": collections,
        "withheld": {name: list(fields) for name, fields in EXPORT_WITHHELD_FIELDS.items()},
    }
    logger.info(f"✅ Export RGPD servi pour le compte {user_id}")
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="kojo-donnees-{user_id}.json"'},
    )
