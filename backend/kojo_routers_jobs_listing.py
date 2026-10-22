# -*- coding: utf-8 -*-
"""Collection des missions : recherche (`GET /jobs`), détail, suppression.

Extrait de `kojo_routers_jobs.py` sans changement de comportement (surface
figée par `tests/surface/route_surface_jobs.json`). La vue publique (`_job_view`) et la
résolution d'identifiant (celle de `kojo_identifiants`, `identifiant_job_query`)
sont ici parce qu'elles n'ont de sens que pour ces trois routes.
"""
import asyncio
import math
import re
import unicodedata
from datetime import datetime, timezone
from typing import Optional

from kojo_identifiants import identifiant_job_query, identifiant_query
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError

import kojo_job_effects as effets
from kojo_core import db, get_current_user, get_current_user_optional
from kojo_job_categories import _category_search_variants
from kojo_job_refunds import execute_paydunya_refund
from kojo_models import JobPublic, JobStatus, NotificationType, User
from kojo_recherche_missions import (
    MAX_CANDIDATS_DISTANCE,
    RAYON_TERRE_KM,
    distance_km,
    filtre_texte,
    termes_de_requete,
)
from kojo_settings import OWNER_EMAIL, logger

router = APIRouter()


# ── RECHERCHE INSENSIBLE AUX ACCENTS (22/10/2026) ────────────────────────────
# `$regex` comparait le texte BRUT : « senegal » ne trouvait pas « Sénégal », et
# « plomberie » ne trouvait pas « Plomberie » (seul `$options: "i"` était posé).
# Sur un clavier de téléphone ouest-africain, personne ne tape les accents : la
# recherche ne trouvait donc pas ce qu'on lui demandait, sans le dire.
#
# Chaque lettre accentuée devient une CLASSE de caractères. Ce n'est pas un
# index (voir le tri et les index de `kojo_db`) : c'est la correction du
# résultat, qui comptait plus que la vitesse sur ce volume.
_EQUIVALENTS_ACCENTS = {
    "a": "aàâäã",
    "e": "eéèêë",
    "i": "iîï",
    "o": "oôöõ",
    "u": "uùûü",
    "c": "cç",
    "n": "nñ",
    "y": "yÿ",
}


def _distance_du_document(doc: dict, lat: float, lng: float) -> float:
    """Distance d'une mission au point donné, en km — `inf` si la position est illisible.

    Un `geo` qui existe mais dont les coordonnées ne sont pas deux nombres
    (document importé à la main) ne doit ni faire tomber la liste, ni passer
    pour « très proche » : il finit l'ordre, il ne le commence pas.
    """
    coordonnees = (doc.get("geo") or {}).get("coordinates") or []
    try:
        lng_doc, lat_doc = float(coordonnees[0]), float(coordonnees[1])
    except (TypeError, ValueError, IndexError):
        return math.inf
    return distance_km(lat, lng, lat_doc, lng_doc)


def _motif_recherche(texte: str) -> str:
    """Motif `$regex` du texte, avec les accents rendus interchangeables.

    Le texte est DÉSACCENTÉ puis mis en minuscules (`SÉNÉGAL` → `senegal`), et
    seulement ensuite échappé : une requête contenant `.*` ou `(` reste une
    chaîne à chercher, jamais une expression. Sans la première étape, un « é »
    tapé restait un « é » littéral dans le motif et ne trouvait jamais le
    « e » du document — la souplesse n'allait que dans un sens.
    """
    desaccentue = "".join(
        caractere
        for caractere in unicodedata.normalize("NFKD", str(texte).strip().lower())
        if not unicodedata.combining(caractere)
    )
    echappe = re.escape(desaccentue)
    return "".join(
        f"[{_EQUIVALENTS_ACCENTS[caractere]}]" if caractere in _EQUIVALENTS_ACCENTS else caractere
        for caractere in echappe
    )



# Vue PUBLIQUE des jobs (découverte sans compte) : modélisée par une
# ALLOWLIST stricte (JobPublic dans kojo_models), pas un denylist — tout champ
# ajouté au document (identité, GPS, interne) reste privé par défaut.


def _litige_visible(job: dict, current_user: Optional[User]) -> bool:
    """Le litige d'une mission est réservé à ses PARTIES et au propriétaire.

    Le motif peut porter un nom ou un numéro (il est écrit par une partie) :
    aucune autre identité n'a de raison de le lire, et la mission elle-même
    reste consultable sans lui — c'est le désaccord qui se cache, pas la fiche.
    """
    if current_user is None:
        return False
    identifiant = str(getattr(current_user, "id", "") or "")
    if identifiant and identifiant in (
        str(job.get("client_id") or ""),
        str(job.get("assigned_worker_id") or ""),
    ):
        return True
    if getattr(current_user, "user_type", None) == "owner":
        return True
    return bool(OWNER_EMAIL) and getattr(current_user, "email", None) == OWNER_EMAIL


def _job_view(job: dict, current_user: Optional[User]):
    """Vue d'un job selon l'identité de l'appelant.

    - Visiteur anonyme : instance JobPublic construite depuis le document —
      seuls les champs explicitement autorisés sortent (identités, point geo,
      coordonnées GPS et champs internes exclus par construction, jamais par
      un retrait manuel qui pourrait être oublié à la prochaine évolution).
    - Utilisateur connecté : document complet sans _id (comportement
      historique — le frontend lit aussi created_at en fallback d'affichage).
    """
    if current_user is None:
        return JobPublic.model_validate(job)
    view = dict(job)
    view.pop("_id", None)
    # Un LITIGE ne se lit que par les PARTIES et le propriétaire. Le motif est
    # écrit par une partie (donc potentiellement un nom, une adresse) : c'est
    # exactement pour cela qu'il n'entre pas dans le journal métier, et le
    # laisser sortir sur `GET /jobs/{id}` — que tout compte connecté peut
    # appeler — rouvrirait par la fenêtre ce que le journal ferme par la porte.
    if view.get("dispute") and not _litige_visible(job, current_user):
        view.pop("dispute", None)
    return view

@router.get("/jobs")
async def get_jobs(
    status: Optional[JobStatus] = None,
    category: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    # Recherche par mot (titre, description, catégorie, adresse), insensible à
    # la casse ET aux accents (voir `_motif_recherche`).
    q: Optional[str] = Query(default=None, max_length=100),
    # Ordre de la liste : `recent` (défaut, comportement historique), `budget`
    # (le mieux payé d'abord) ou `distance` (la plus proche d'abord, depuis
    # lat/lng — obligatoires pour ce tri, et seules les missions qui PORTENT
    # une position peuvent être classées : les autres n'ont pas de distance).
    tri: Optional[str] = Query(default="recent", pattern="^(recent|budget|distance)$"),
    # Si défini, limite la liste aux jobs dont l'id est dans la liste
    # (séparée par des virgules, max 100) — utilisé par les onglets
    # « Mes candidatures » du frontend.
    ids: Optional[str] = Query(default=None, max_length=3000),
    # "mine=posted" (cliente) : jobs publiés par l'utilisateur courant ;
    # "mine=assigned" (travailleur) : missions qui lui sont attribuées.
    mine: Optional[str] = Query(default=None),
    # Filtre pays explicite (visiteur anonyme : découverte par pays).
    country: Optional[str] = Query(default=None),
    # Recherche par rayon côté serveur : seuls les jobs portant un point
    # GeoJSON (geo) dans le rayon entrent en compte. Sans lat/lng/radius_km
    # complets, le filtre ne s'applique pas (comportement inchangé).
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
    radius_km: Optional[float] = Query(default=None, ge=0.1, le=2000),
    response: Response = Response(),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Liste des jobs avec filtres (statut, catégorie, recherche q, ids,
    mine=posted/assigned, pays, rayon lat/lng/radius_km) et tri (`tri`).
    `tri=distance` exige lat/lng et ne classe que les missions qui portent une
    position ; il ne rend AUCUNE distance (l'ordre seul) — la vue publique ne
    gagne donc aucun champ géographique.
    Accessible en lecture publique (visiteur anonyme : vue nettoyée).

    Returns:
        list[dict]: vues de jobs via _job_view (le contenu diffère selon
        que l'utilisateur est connecté ou non). Le nombre de missions
        correspondant au filtre est publié dans `X-Total-Count`.
    """
    try:
        query = {}
        if status:
            query["status"] = status
        if category:
            # Filtre le GROUPE d'équivalence (canonique + écritures legacy FR)
            query["category"] = {"$in": _category_search_variants(category)}
        if country:
            query["country"] = str(country).strip().lower()
        if ids:
            id_list = [i.strip() for i in ids.split(",") if i.strip()][:100]
            if id_list:
                query["id"] = {"$in": id_list}
        if mine:
            if current_user is None:
                raise HTTPException(status_code=401, detail="Authentification requise")
            if mine == "posted":
                query["client_id"] = current_user.id
            elif mine == "assigned":
                query["assigned_worker_id"] = current_user.id
            else:
                raise HTTPException(status_code=400, detail="Paramètre mine invalide")
        # ── LA RECHERCHE : L'INDEX D'ABORD, LE FRAGMENT ENSUITE (22/10/2026) ──
        # `$regex` ne peut s'appuyer sur aucun index : chaque frappe balayait la
        # collection. L'index texte `recherche_missions` sert les MOTS (casse et
        # accents pliés, mesuré) ; il ne sait pas trouver une frappe partielle
        # (« plomb » ne trouve pas « Plomberie »), donc le fragment reste le
        # REPLI — quand aucun mot ne correspond, pas en même temps. Deux
        # chemins, un seul résultat : celui de l'index quand il a quelque chose
        # à dire, sinon celui du fragment.
        recherche_texte = None
        recherche_fragment = None
        if q and str(q).strip():
            termes = termes_de_requete(q)
            if termes:
                recherche_texte = filtre_texte(termes)
            motif = _motif_recherche(q)
            # Quatre endroits, pas deux : une mission « Plomberie » dont le
            # titre dit « réparer un robinet » se trouve par sa CATÉGORIE, et
            # « Dakar » se trouve par l'ADRESSE de la mission.
            recherche_fragment = {
                "$or": [
                    {"title": {"$regex": motif, "$options": "i"}},
                    {"description": {"$regex": motif, "$options": "i"}},
                    {"category": {"$regex": motif, "$options": "i"}},
                    {"location.address": {"$regex": motif, "$options": "i"}},
                ]
            }

        # Rayon : $geoWithin + $centerSphere (rayon en radians = km / 6371).
        # Nécessite l'index 2dsphere sur jobs.geo (créé au boot).
        if lat is not None and lng is not None and radius_km is not None:
            # `RAYON_TERRE_KM` est celui du tri par distance : deux constantes
            # déplaceraient la frontière du rayon de quelques centaines de mètres.
            query["geo"] = {
                "$geoWithin": {
                    "$centerSphere": [[lng, lat], float(radius_km) / RAYON_TERRE_KM]
                }
            }

        query["deleted"] = {"$ne": True}

        # Lecture PUBLIQUE (découverte sans compte) : un visiteur anonyme
        # voit les offres de tous les pays. Les utilisateurs connectés
        # restent filtrés par leur pays (comportement historique).
        if current_user is not None:
            is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
            if not is_owner_user:
                query["$or"] = [
                    {"country": current_user.country},
                    {"country": {"$exists": False}},
                    {"country": None}
                ]

        # ── LE TRI PAR DISTANCE N'ORDONNE QUE CE QUI A UNE POSITION ─────
        # Une mission sans `geo` n'a pas de distance : la trier « à la fin »
        # ferait publier un total que le tri ne tient pas, et la dernière page
        # ne contiendrait que des missions non classées. Elles sortent donc du
        # filtre — comme pour `radius_km`, où le même fait est déjà assumé.
        if tri == "distance":
            if lat is None or lng is None:
                raise HTTPException(
                    status_code=400,
                    detail="Le tri par distance exige lat et lng : sans position, il n'y a pas de distance à calculer.",
                )
            if "geo" not in query:
                query["geo"] = {"$exists": True}

        # ── LA RECHERCHE ARBITRE : L'INDEX, SINON LE FRAGMENT ──────────
        # L'index texte est interrogé en premier, et son compte est lu : un
        # index qui ne trouverait rien laisse la main au fragment, qui trouve
        # encore les frappes partielles. Un index ABSENT (création refusée,
        # collection récente) ne fait pas tomber la route : le repli s'applique
        # et le journal le dit — l'index est une optimisation, pas la garantie.
        total = None
        if recherche_texte is not None:
            candidat = {**query, **recherche_texte}
            try:
                total = await db.jobs.count_documents(candidat)
            except Exception as exc:
                logger.warning(
                    f"⚠️ Recherche texte indisponible ({exc}) : repli sur la recherche par fragment"
                )
                total = 0
            if total:
                query = candidat
        if not total and recherche_fragment is not None:
            # `$and` et non `{**query, "$or": …}` : un compte CONNECTÉ porte
            # déjà un `$or` (son pays), et l'écrasement retirerait ce filtre en
            # silence — la recherche rendrait les missions d'un autre pays.
            query = {**query, "$and": [recherche_fragment]}

        # ── COMBIEN, ET DANS QUEL ORDRE (22/10/2026) ────────────────────
        # La liste ne disait ni combien de missions correspondent, ni dans
        # quel ordre elles sortaient. Le client DÉDUISAIT « plus de
        # résultats » d'une page pleine : une page 2 incomplète annonçait donc
        # « fini » alors qu'une mission avait été clôturée entre-temps, et
        # personne ne pouvait savoir s'il en restait 3 ou 300. Le total est
        # mesuré sur le MÊME filtre que la page (donc il ne ment pas quand un
        # pays, une catégorie ou une recherche resserre la liste), et publié
        # en en-tête : le corps reste la liste que les clients lisent déjà.
        if total is None:
            total = await db.jobs.count_documents(query)

        # Le tri par distance lit TOUS les candidats (Mongo ne sait pas trier
        # par distance sans `$geoNear`, que la doublure de test refuse) : on
        # REFUSE au-delà du plafond plutôt que de trier une partie des missions
        # et de présenter le résultat comme un ordre.
        if tri == "distance" and total > MAX_CANDIDATS_DISTANCE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Trier par distance demande de lire toutes les missions du filtre ({total}), "
                    f"au-delà de {MAX_CANDIDATS_DISTANCE} : resserrez radius_km ou un autre filtre."
                ),
            )

        response.headers["X-Total-Count"] = str(total)

        # Pagination : offset = (page - 1) * limit.
        offset = max(0, (page - 1) * limit)
        if tri == "distance":
            documents = await db.jobs.find(query).to_list(None)
            # Deux tris STABLES : la chronologie d'abord (départage), puis la
            # distance (ordre principal). `sorted` est stable, donc deux
            # missions à la même distance restent dans l'ordre chronologique.
            documents.sort(key=lambda doc: str(doc.get("created_at") or ""), reverse=True)
            documents.sort(key=lambda doc: _distance_du_document(doc, lat, lng))
            jobs = documents[offset:offset + limit]
        else:
            curseur = db.jobs.find(query)
            if tri == "budget":
                # Le mieux payé d'abord. Une mission sans `budget_max` passe en
                # dernier (Mongo place les manquants avant les nombres en
                # descendant) : elle n'est pas « gratuite », elle est muette.
                curseur = curseur.sort([("budget_max", -1), ("created_at", -1)])
            else:
                curseur = curseur.sort("created_at", -1)
            jobs = await curseur.skip(offset).to_list(limit)

        # Cache-Control : la liste PUBLIQUE (visiteur anonyme) ne change que
        # par les créations/clôtures de missions — on la sert avec un cache
        # court (60s) pour que Googlebot et les visiteurs répétés ne tapent
        # pas MongoDB à chaque vue. JAMAIS de cache pour un utilisateur
        # connecté (ses données/filtres sont personnels).
        if current_user is None:
            response.headers["Cache-Control"] = "public, max-age=60, s-maxage=60"

        logger.debug(f"✅ Retrieved {len(jobs)} jobs (auth={current_user is not None}, page={page})")
        if current_user is None:
            # Vue publique : un fiche legacy invalide ne doit JAMAIS faire
            # tomber toute la liste en 500 — on l'écarte avec un warning (elle
            # reste visible aux utilisateurs connectés, qui ont le doc brut).
            views = []
            for job in jobs:
                try:
                    views.append(_job_view(job, current_user))
                except ValidationError as exc:
                    logger.warning(f"⚠️ Job {job.get('id')} invalide pour la vue publique, ignoré: {exc}")
            return views
        return [_job_view(job, current_user) for job in jobs]

    except HTTPException:
        # Paramètre invalide (mine=..., requête anonyme) → ne PAS transformer
        # en 500 : le except Exception générique ci-dessous avalerait l'erreur.
        raise
    except Exception as e:
        logger.error(f"❌ Failed to retrieve jobs: {e}")
        raise HTTPException(status_code=500, detail="Internal server error retrieving jobs")

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, current_user: Optional[User] = Depends(get_current_user_optional)):
    """Détail d'un job (404 si introuvable/supprimé ; 403 si le job est d'un
    autre pays pour un utilisateur connecté non-owner).

    Returns:
        dict: vue du job via _job_view (contient job + relation avec
        l'utilisateur courant).
    """
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Filtre pays uniquement pour les utilisateurs connectés : un visiteur
    # anonyme (découverte) peut consulter une offre de n'importe quel pays.
    if current_user is not None:
        is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
        job_country = job.get("country")
        if not is_owner_user and job_country and job_country != current_user.country:
            raise HTTPException(status_code=403, detail="Ce job n'appartient pas à votre pays.")

    return _job_view(job, current_user)

@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, current_user: User = Depends(get_current_user)):
    """Annule/supprime une mission (réservé à la cliente ou au owner). Si la
    mission était PAYÉE, déclenche le remboursement automatique du client
    (escrow PayDunya) avant l'annulation.

    Returns:
        dict: {message, job_id, refund_status, refunded_amount}.
    """
    job = await db.jobs.find_one({
        "$and": [
            identifiant_job_query(job_id),
            {"deleted": {"$ne": True}},
        ]
    })
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    stored_job_id = str(job.get("id") or job.get("job_id") or job.get("_id") or job_id)

    is_owner_user = bool(OWNER_EMAIL) and current_user.email == OWNER_EMAIL
    if job.get("client_id") != current_user.id and not is_owner_user:
        raise HTTPException(status_code=403, detail="Access denied")

    now_iso = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Annulation d'une mission PAYÉE : remboursement automatique du client
    # ------------------------------------------------------------------
    # Si un paiement confirmé existe (fonds séquestrés chez PayDunya), on
    # rembourse le client via l'API de décaissement avant d'annuler. Sans
    # ça, l'argent restait bloqué sans aucune voie de restitution (ni
    # remboursement client, ni libération travailleur).
    payment_record = await db.payments.find_one(
        {"job_id": stored_job_id, "status": "completed"},
        sort=[("created_at", -1)]
    )
    refund_outcome = None
    refunded_amount = None

    if payment_record:
        payout_status = payment_record.get("payout_status") or "held"

        if payout_status in ("released", "releasing"):
            raise HTTPException(
                status_code=409,
                detail="Cette mission a déjà un versement en cours ou effectué vers le travailleur : annulation impossible."
            )

        # Verrou atomique (CAS) : "held"/"release_failed" → "refunding".
        lock_result = await db.payments.update_one(
            {**identifiant_query(payment_record["id"]), "payout_status": payout_status},
            effets.maj_sequestre("refunding", {"payout_kind": "refund", "updated_at": now_iso})
        )
        if lock_result.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail="Un remboursement est déjà en cours pour cette mission"
            )

        refund_outcome = await execute_paydunya_refund(payment_record)
        refunded_amount = payment_record.get("amount")

    await db.jobs.update_one(
        identifiant_job_query(job_id),
        {
            "$set": {
                "deleted": True,
                "status": "cancelled",
                "deleted_at": now_iso,
                "deleted_by": current_user.id,
                "updated_at": now_iso
            }
        }
    )

    try:
        await db.job_proposals.delete_many({"job_id": stored_job_id})
    except Exception:
        pass

    # Notifications (best-effort) : informer le client du sort de son argent
    # et le travailleur de l'annulation.
    if payment_record:
        worker_id_for_notif = job.get("assigned_worker_id")
        job_title = job.get("title") or "la mission"
        if refund_outcome == "refunded":
            cancel_key = "mission_cancelled_client_refunded"
        elif refund_outcome == "refunding":
            cancel_key = "mission_cancelled_client_refunding"
        elif refund_outcome == "refund_failed":
            cancel_key = "mission_cancelled_client_refund_failed"
        else:
            cancel_key = "mission_cancelled_client"
        asyncio.create_task(effets.notify_user_localized(
            user_id=payment_record.get("payer_id"),
            key=cancel_key,
            notif_type=NotificationType.GENERAL,
            related_id=stored_job_id,
            related_type="job",
            job_title=job_title,
            amount=refunded_amount,
        ))
        if worker_id_for_notif:
            asyncio.create_task(effets.notify_user_localized(
                user_id=worker_id_for_notif,
                key="mission_cancelled_worker",
                notif_type=NotificationType.GENERAL,
                related_id=stored_job_id,
                related_type="job",
                job_title=job_title,
            ))

    if refund_outcome == "refunded":
        message = "Mission annulée. Le paiement a été entièrement remboursé au client."
    elif refund_outcome == "refunding":
        message = "Mission annulée. Remboursement en cours de traitement (confirmation par PayDunya)."
    elif refund_outcome == "refund_failed":
        message = "Mission annulée, mais le remboursement automatique a échoué : un remboursement manuel est nécessaire."
    else:
        message = "Job deleted successfully"

    return {
        "message": message,
        "job_id": stored_job_id,
        "refund_status": refund_outcome,
        "refunded_amount": refunded_amount,
    }
