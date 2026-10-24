# -*- coding: utf-8 -*-
"""Modération des comptes, réservée au propriétaire : états, répertoire, messages.

Le propriétaire voyait des CHIFFRES (gains, litiges, paliers) mais aucun COMPTE :
il ne pouvait ni constater qu'un compte existe, ni l'empêcher de nuire, ni lire
ce qui se dit entre utilisateurs. Ce module porte les trois faits qui manquaient,
et une seule définition de chacun :

  * l'ÉTAT d'un compte (`actif` / `restreint` / `banni`), lu par la porte
    d'authentification (`get_current_user`) et par la connexion — donc un
    bannissement vaut dès la requête suivante, sans révocation de jeton à
    propager ;
  * le RÉPERTOIRE des comptes (recherche, rôle, pays, état) avec ses mesures ;
  * le fil des conversations, en LECTURE SEULE — la route de lecture du
    propriétaire ne pose jamais `read`, contrairement à celle des participants.

Deux états, deux effets, aucune suppression :

  * `restreint` : lecture seule. Publier une mission, postuler et écrire sont
    fermés ; consulter, terminer une mission déjà acceptée et payer restent
    ouverts (fermer le paiement d'une mission en cours bloquerait l'argent
    séquestré, ce qui n'est pas une sanction mais une panne).
  * `banni` : la connexion et TOUTE requête authentifiée refusent, en nommant
    le motif. Revenir à `actif` rouvre immédiatement.

Le propriétaire n'est jamais visé (409), et une décision n'est jamais anonyme :
le motif est EXIGÉ pour restreindre ou bannir, et chaque changement laisse une
entrée dans l'historique du compte (`account_state_history`, borné).

Ce module n'écrit AUCUNE collection nouvelle : l'état et son historique vivent
sur le document du compte, donc l'export RGPD les rend déjà et la suppression de
compte les efface (`ANONYMISATION_CHAMPS`, dans `kojo_routers_users_account`).
"""

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

import kojo_settings

from kojo_db import db
from kojo_identifiants import identifiants_query

ETAT_ACTIF = "actif"
ETAT_RESTREINT = "restreint"
ETAT_BANNI = "banni"
ETATS = (ETAT_ACTIF, ETAT_RESTREINT, ETAT_BANNI)

# Un motif de moins de dix caractères ne dit rien (« ok », « test ») et ne
# laisse aucune trace relisible six mois plus tard. La réactivation, elle, n'a
# pas à se justifier : elle rend un droit, elle n'en retire pas.
MOTIF_MINIMUM = 10
MOTIF_MAXIMUM = 500

# Bornes de lecture : le répertoire et le fil sont rendus à un humain, pas à un
# export. Au-delà, la réponse le DIT (`tronque`) au lieu de faire croire à une
# vue complète.
MAX_COMPTES_LUS = 2000
MAX_MESSAGES_LUS = 2000
MAX_CONVERSATIONS = 100
MAX_FIL_CONVERSATION = 200
HISTORIQUE_MAX = 20

# Champs du compte rendus au propriétaire : allowlist, jamais le document brut.
# `password_hash` n'y est pas, et n'a aucune raison d'y être : le propriétaire
# n'a pas besoin du condensé pour modérer.
CHAMPS_COMPTE = (
    "id", "first_name", "last_name", "email", "phone", "user_type", "country",
    "preferred_language", "profile_photo", "created_at", "email_verified",
    "is_verified", "rating", "total_reviews", "payment_accounts_count",
    "support_role", "bio", "skills", "referral_code",
)


def etat_du_compte(compte: Optional[dict]) -> str:
    """L'état EFFECTIF d'un compte. Absent ou inconnu vaut `actif`.

    Un document d'avant la modération ne porte pas le champ : le lire comme
    `actif` est la seule réponse qui n'invente pas une sanction. Une valeur
    inconnue (faute de frappe en base) ne devient pas non plus un bannissement
    silencieux — elle ne fermerait rien, et c'est la liste du propriétaire qui
    la montre à l'écran.
    """
    valeur = (compte or {}).get("account_state")
    return valeur if valeur in ETATS else ETAT_ACTIF


def motif_du_compte(compte: Optional[dict]) -> Optional[str]:
    """Le motif écrit par le propriétaire, ou None. Jamais une phrase inventée."""
    motif = (compte or {}).get("account_state_reason")
    return motif.strip() if isinstance(motif, str) and motif.strip() else None


def refuser_si_banni(compte: Optional[dict]) -> None:
    """403 NOMMÉ quand le compte est banni — motif compris.

    Appelé par `get_current_user` (donc par toute requête authentifiée) et par
    la connexion : un bannissement vaut immédiatement, sans attendre qu'un
    jeton expire. Le motif est rendu pour que la personne sache POURQUOI, et
    parce qu'un refus muet se relit comme une panne.
    """
    if etat_du_compte(compte) != ETAT_BANNI:
        return
    motif = motif_du_compte(compte)
    raise HTTPException(
        status_code=403,
        detail=(
            "Votre compte est suspendu"
            + (f" : {motif}" if motif else "")
            + ". Contactez le support pour en savoir plus."
        ),
    )


def refuser_si_restreint(compte: Optional[dict]) -> None:
    """403 NOMMÉ quand le compte est restreint : l'action d'écriture est fermée.

    La lecture reste ouverte (c'est la définition de la restriction), et le
    message dit que c'est une restriction, pas une panne : sans cela, publier
    une mission rendrait un 403 générique que la personne relirait comme un bug.
    """
    if etat_du_compte(compte) != ETAT_RESTREINT:
        return
    motif = motif_du_compte(compte)
    raise HTTPException(
        status_code=403,
        detail=(
            "Votre compte est restreint en lecture seule : cette action est "
            "fermée"
            + (f" (motif : {motif})" if motif else "")
            + ". Contactez le support pour en savoir plus."
        ),
    )


def _horodatage() -> str:
    return datetime.now(timezone.utc).isoformat()


def _est_proprietaire(compte: dict) -> bool:
    # Le module, pas le nom : `OWNER_EMAIL` est lu à l'APPEL, comme partout où
    # il décide d'un droit. Une copie figée à l'import ignorerait un changement
    # de configuration (et, en test, la même valeur que `verify_owner_access`).
    email_proprietaire = (getattr(kojo_settings, "OWNER_EMAIL", "") or "").strip().lower()
    email = str((compte or {}).get("email") or "").strip().lower()
    return bool(email_proprietaire) and email == email_proprietaire


def _compte_public(compte: dict) -> dict:
    """Un compte réduit à l'allowlist, plus ses trois champs de modération."""
    rendu = {champ: compte.get(champ) for champ in CHAMPS_COMPTE}
    rendu["account_state"] = etat_du_compte(compte)
    rendu["account_state_reason"] = motif_du_compte(compte)
    rendu["account_state_at"] = compte.get("account_state_at")
    rendu["account_state_by"] = compte.get("account_state_by")
    rendu["is_owner"] = _est_proprietaire(compte)
    rendu["deleted"] = bool(compte.get("deleted"))
    return rendu


async def changer_etat(
    compte: dict,
    *,
    etat: str,
    motif: Optional[str],
    auteur: dict,
) -> dict:
    """Change l'état d'un compte et journalise la décision SUR le compte.

    Refus explicites, jamais une réparation silencieuse :
      400 — état inconnu, ou motif absent/trop court pour une sanction ;
      409 — compte propriétaire (il n'a rien à modérer de ce côté), compte
            supprimé (il n'existe plus d'accès à fermer).

    L'historique est écrit par `$set` (liste relue puis réécrite), pas par un
    `$push` : une seule écriture décrit la décision ET sa trace, et la lecture
    ne dépend pas d'un opérateur que la base de test n'implémente pas.
    """
    if etat not in ETATS:
        raise HTTPException(status_code=400, detail=f"État inconnu : {etat!r}")
    if _est_proprietaire(compte):
        raise HTTPException(
            status_code=409,
            detail="Le compte propriétaire ne peut pas être restreint ni banni.",
        )
    if compte.get("deleted"):
        raise HTTPException(
            status_code=409,
            detail="Ce compte est supprimé : il n'a plus d'accès à fermer.",
        )

    motif_propre = (motif or "").strip()
    if etat != ETAT_ACTIF and len(motif_propre) < MOTIF_MINIMUM:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Un motif d'au moins {MOTIF_MINIMUM} caractères est exigé pour "
                "restreindre ou bannir : une sanction sans motif ne se relit pas."
            ),
        )
    if len(motif_propre) > MOTIF_MAXIMUM:
        motif_propre = motif_propre[:MOTIF_MAXIMUM]

    instant = _horodatage()
    entree = {
        "etat": etat,
        "motif": motif_propre or None,
        "at": instant,
        "by": auteur.get("id"),
    }
    historique = list(compte.get("account_state_history") or [])
    historique.append(entree)
    historique = historique[-HISTORIQUE_MAX:]

    await db.users.update_one(
        {"id": compte.get("id")},
        {
            "$set": {
                "account_state": etat,
                "account_state_reason": motif_propre or None,
                "account_state_at": instant,
                "account_state_by": auteur.get("id"),
                "account_state_history": historique,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    return {
        "id": compte.get("id"),
        "etat": etat,
        "motif": motif_propre or None,
        "at": instant,
        "historique": historique,
    }


def _correspond(compte: dict, recherche: str) -> bool:
    if not recherche:
        return True
    aiguille = recherche.lower()
    morceaux = (
        compte.get("first_name"), compte.get("last_name"), compte.get("email"),
        compte.get("phone"), compte.get("id"), compte.get("referral_code"),
    )
    return any(aiguille in str(morceau).lower() for morceau in morceaux if morceau)


def _role_correspond(compte: dict, role: Optional[str]) -> bool:
    if not role:
        return True
    if role == "support":
        return compte.get("support_role") == "agent"
    if role == "owner":
        return _est_proprietaire(compte)
    return compte.get("user_type") == role


def _mesures(comptes: list) -> dict:
    """Les compteurs du répertoire, calculés sur les comptes LUS (pas recopiés)."""
    return {
        "total": len(comptes),
        "clients": sum(1 for c in comptes if c.get("user_type") == "client"),
        "travailleurs": sum(1 for c in comptes if c.get("user_type") == "worker"),
        "equipe_support": sum(1 for c in comptes if c.get("support_role") == "agent"),
        "restreints": sum(1 for c in comptes if etat_du_compte(c) == ETAT_RESTREINT),
        "bannis": sum(1 for c in comptes if etat_du_compte(c) == ETAT_BANNI),
        "supprimes": sum(1 for c in comptes if c.get("deleted")),
        "email_non_verifie": sum(1 for c in comptes if not c.get("email_verified")),
    }


async def lister_comptes(
    *,
    recherche: Optional[str] = None,
    role: Optional[str] = None,
    etat: Optional[str] = None,
    pays: Optional[str] = None,
    limite: int = 50,
    offset: int = 0,
) -> dict:
    """Le répertoire des comptes : recherche, filtres, page et mesures.

    Tout est filtré en mémoire sur une lecture BORNÉE (`MAX_COMPTES_LUS`) :
    le répertoire est un écran de travail, pas un export, et une requête
    composée à la volée pour chaque combinaison de filtres finirait par deux
    définitions de « banni » qui divergent. Le dépassement de la borne est
    DÉCLARÉ (`tronque`), jamais présenté comme une vue complète.
    """
    lus = await db.users.find({}, {"password_hash": 0}).to_list(length=MAX_COMPTES_LUS + 1)
    tronque = len(lus) > MAX_COMPTES_LUS
    lus = lus[:MAX_COMPTES_LUS]

    mesures = _mesures(lus)

    filtre_recherche = (recherche or "").strip()
    filtre_pays = (pays or "").strip().lower()
    retenus = [
        compte for compte in lus
        if not compte.get("deleted")
        and _correspond(compte, filtre_recherche)
        and _role_correspond(compte, role)
        and (not etat or etat_du_compte(compte) == etat)
        and (not filtre_pays or str(compte.get("country") or "").lower() == filtre_pays)
    ]

    # Plus récent d'abord : c'est ainsi qu'on repère un compte qui vient d'être
    # créé (le cas d'un spam inscrit il y a une minute). Les documents sans date
    # finissent en fin de liste, jamais en tête.
    retenus.sort(key=lambda compte: str(compte.get("created_at") or ""), reverse=True)

    page = retenus[offset: offset + limite]
    return {
        "count": len(page),
        "total": len(retenus),
        "offset": offset,
        "limite": limite,
        "tronque": tronque,
        "comptes": [_compte_public(compte) for compte in page],
        "mesures": mesures,
    }


async def detail_compte(compte: dict) -> dict:
    """Un compte, son activité comptée et l'historique de ses sanctions."""
    identifiant = compte.get("id")
    jobs = await db.jobs.count_documents({"client_id": identifiant, "deleted": {"$ne": True}})
    propositions = await db.job_proposals.count_documents({"worker_id": identifiant})
    messages = await db.messages.count_documents(
        {"$or": [{"sender_id": identifiant}, {"receiver_id": identifiant}]}
    )
    avis = await db.reviews.count_documents({"reviewee_id": identifiant})

    rendu = _compte_public(compte)
    rendu["activite"] = {
        "missions_publiees": jobs,
        "propositions": propositions,
        "messages": messages,
        "avis_recus": avis,
    }
    rendu["historique"] = list(compte.get("account_state_history") or [])[-HISTORIQUE_MAX:]
    return rendu


async def _comptes_par_id(identifiants) -> dict:
    """Les comptes désignés par une liste d'identifiants, en UNE lecture.

    `identifiants_query` est le seul propriétaire des formes sous lesquelles un
    identifiant peut être stocké (`id`, `_id` chaîne, ObjectId, nombre) : un
    `$in` écrit à la main raterait les comptes importés, et la conversation
    afficherait « participant inconnu » sur des gens qui existent.
    """
    propres = [str(valeur) for valeur in identifiants if valeur]
    if not propres:
        return {}
    documents = await db.users.find(
        identifiants_query(propres), {"password_hash": 0}
    ).to_list(length=len(propres))
    return {str(document.get("id") or document.get("_id")): document for document in documents}


def _participant(compte: Optional[dict], identifiant: str) -> dict:
    if not compte:
        return {
            "id": identifiant,
            "nom": "Compte supprimé",
            "email": None,
            "user_type": None,
            "is_deleted": True,
        }
    prenom = str(compte.get("first_name") or "").strip()
    nom = str(compte.get("last_name") or "").strip()
    return {
        "id": identifiant,
        "nom": f"{prenom} {nom}".strip() or compte.get("email") or "Sans nom",
        "email": compte.get("email"),
        "user_type": compte.get("user_type"),
        "is_deleted": bool(compte.get("deleted")),
    }


async def lister_conversations(recherche: Optional[str] = None) -> dict:
    """Les conversations du site, la plus récente d'abord.

    Lecture BORNÉE (`MAX_MESSAGES_LUS`) et regroupement en mémoire : le
    dernier message se décide par comparaison d'horodatage, jamais par l'ordre
    d'arrivée des documents. Une conversation dont un participant a été
    supprimé reste lisible — elle est rendue avec `is_deleted`, pas cachée.
    """
    messages = await db.messages.find({}).to_list(length=MAX_MESSAGES_LUS)
    groupes = {}
    for message in messages:
        conversation = message.get("conversation_id")
        if not conversation:
            continue
        entree = groupes.setdefault(conversation, {
            "conversation_id": conversation,
            "dernier_message": None,
            "dernier_at": None,
            "messages": 0,
            "participants": set(),
        })
        entree["messages"] += 1
        if message.get("sender_id"):
            entree["participants"].add(str(message["sender_id"]))
        if message.get("receiver_id"):
            entree["participants"].add(str(message["receiver_id"]))
        horodatage = message.get("timestamp")
        if entree["dernier_at"] is None or str(horodatage) > str(entree["dernier_at"]):
            entree["dernier_at"] = horodatage
            entree["dernier_message"] = message.get("content")

    identifiants = {identifiant for entree in groupes.values() for identifiant in entree["participants"]}
    comptes = await _comptes_par_id(identifiants)

    aiguille = (recherche or "").strip().lower()
    rendues = []
    for entree in groupes.values():
        participants = [
            _participant(comptes.get(identifiant), identifiant)
            for identifiant in sorted(entree["participants"])
        ]
        if aiguille:
            textes = [
                *(participant["nom"] or "" for participant in participants),
                *(participant["email"] or "" for participant in participants),
                entree["dernier_message"] or "",
            ]
            if not any(aiguille in str(texte).lower() for texte in textes):
                continue
        rendues.append({
            "conversation_id": entree["conversation_id"],
            "participants": participants,
            "dernier_message": entree["dernier_message"],
            "dernier_at": entree["dernier_at"],
            "messages": entree["messages"],
        })

    rendues.sort(key=lambda entree: str(entree["dernier_at"] or ""), reverse=True)
    return {
        "total": len(rendues),
        "count": len(rendues[:MAX_CONVERSATIONS]),
        "tronque": len(rendues) > MAX_CONVERSATIONS,
        "conversations": rendues[:MAX_CONVERSATIONS],
    }


async def fil_de_conversation(conversation_id: str) -> dict:
    """Le fil complet d'une conversation, en LECTURE SEULE.

    Contrairement à `GET /messages/{conversation_id}` (participants), cette
    lecture ne marque RIEN comme lu : le propriétaire qui ouvre un fil ne doit
    pas effacer l'indicateur « non lu » de personnes qui n'ont rien demandé.
    Une conversation inexistante est un 404 nommé, jamais un fil vide — un
    vide se relit comme « ils ne se sont rien dit ».
    """
    messages = await db.messages.find({"conversation_id": conversation_id}).to_list(
        length=MAX_FIL_CONVERSATION
    )
    if not messages:
        raise HTTPException(status_code=404, detail="Conversation introuvable")

    messages.sort(key=lambda message: str(message.get("timestamp") or ""))

    identifiants = set()
    for message in messages:
        if message.get("sender_id"):
            identifiants.add(str(message["sender_id"]))
        if message.get("receiver_id"):
            identifiants.add(str(message["receiver_id"]))
    comptes = await _comptes_par_id(identifiants)

    fil = []
    for message in messages:
        expediteur = _participant(comptes.get(str(message.get("sender_id"))), str(message.get("sender_id") or ""))
        fil.append({
            "id": message.get("id"),
            "sender_id": message.get("sender_id"),
            "sender_name": expediteur["nom"],
            "receiver_id": message.get("receiver_id"),
            "content": message.get("content"),
            "timestamp": message.get("timestamp"),
            "job_id": message.get("job_id"),
            "read": bool(message.get("read")),
        })

    return {
        "conversation_id": conversation_id,
        "participants": [
            _participant(comptes.get(identifiant), identifiant) for identifiant in sorted(identifiants)
        ],
        "count": len(fil),
        "messages": fil,
        "lecture": "moderation",
        "lu_marque": False,
    }


def normaliser_recherche(valeur: Optional[str]) -> str:
    """La recherche est un texte libre : on la borne, on ne la compile pas.

    `re.escape` n'est pas utilisé parce qu'aucune expression régulière n'est
    construite ici (le filtre est une comparaison en mémoire) : la fonction ne
    garde que ce qui tient dans une champ de saisie, borné à 80 caractères.
    """
    return re.sub(r"\s+", " ", (valeur or "")).strip()[:80]
