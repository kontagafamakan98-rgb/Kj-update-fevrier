# -*- coding: utf-8 -*-
"""Les durées de conservation des données personnelles qui survivent à un
compte, et la purge qui les applique.

Les trois durées choisies, avec leur raison (elles sont déclarées dans
`kojo_settings.py` et publiées par PRIVACY.md, donc ici on les LIT) :

  * `DELETED_ACCOUNT_RETENTION_DAYS` — le document d'un compte supprimé n'est
    pas effacé, il est anonymisé (les paiements le référencent). Son délai court
    à partir de la suppression et couvre la fenêtre de litige ;
  * `SUPPORT_TICKET_RETENTION_DAYS` — nom, téléphone, email et message libre :
    la donnée la plus identifiante du dépôt, et la moins relue. Le délai court
    à partir de la création, sinon un ticket jamais traité ne périme jamais ;
  * `MESSAGE_RETENTION_DAYS` — le message appartient aux deux parties, donc il
    survit à la suppression d'un compte, mais il n'est pas éternel.

Ce que ce fichier éprouve, et pourquoi ici plutôt qu'ailleurs :

  * la PURGE est mesurée DES DEUX CÔTÉS — un document dû disparaît, un document
    non dû survit. Sans le second, une purge qui viderait la collection
    passerait pour un succès ;
  * les GARDE-FOUS tiennent : un compte ACTIF n'est jamais purgé même s'il porte
    une vieille échéance, et un paiement complété non plus (pièce comptable) ;
  * le POINT D'ÉCRITURE existe : la suppression de compte réelle inscrit une
    échéance, et c'est celle de la règle. Un document sans date de mort ne
    périme jamais — la durée publiée serait alors une décoration.

Le filtre n'est pas recopié ici : il vient de `RegleDeConservation.query_de_purge`,
c'est-à-dire de la même règle que l'index TTL. En mode Mongo réel (CI), ces
mêmes cas passent par Mongo — c'est voulu : un test qui ne décrit que la FakeDB
ne dit rien de la production.
"""
from datetime import datetime, timedelta, timezone

import pytest

import kojo_settings
import server as _srv
from kojo_retention import RETENTION_RULES, echeance_de_purge, regle_de
from kojo_scheduler import retention_purge_once
from tests.conftest import BASE_USER, auth_headers, db_find_one, db_insert

# Date fixe : la purge reçoit son « maintenant » en paramètre, donc les cas
# ci-dessous ne dépendent pas de l'horloge du runner.
MAINTENANT = datetime(2026, 9, 19, 12, 0, 0, tzinfo=timezone.utc)


async def _identifiants(collection: str):
    """Les `id` présents dans une collection, triés (mode indifférent)."""
    documents = await _srv.db[collection].find({}).to_list(length=500)
    return sorted(str(d.get("id")) for d in documents)


@pytest.mark.parametrize("collection, symbole", [
    ("users", "DELETED_ACCOUNT_RETENTION_DAYS"),
    ("support_tickets", "SUPPORT_TICKET_RETENTION_DAYS"),
    ("messages", "MESSAGE_RETENTION_DAYS"),
])
def test_la_regle_cite_le_symbole_qui_porte_la_duree(collection, symbole):
    """Les deux faits qui empêchent la politique et la base de diverger : la
    règle DÉCLARE le symbole qui porte la durée, et sa durée est celle de ce
    symbole. Le témoin (« Ce que la purge supprime ») est publié dans le tableau
    de PRIVACY.md, donc il ne doit pas être vide non plus."""
    regle = regle_de(collection)

    assert regle.porte_par == symbole
    assert regle.lifetime == timedelta(days=getattr(kojo_settings, symbole))
    assert regle.portee.strip(), f"{collection} : la politique publierait une case vide"


def test_l_echeance_de_purge_decoule_de_la_regle():
    """Le point d'écriture ne recopie pas la durée : il demande son échéance à
    la règle qui porte aussi l'index TTL."""
    depart = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert echeance_de_purge("users", depart) == depart + regle_de("users").lifetime


def test_le_filtre_de_purge_protege_les_pieces_comptables():
    """Sur les paiements, le filtre partiel porte le `$exists` QUI PLUS la borne
    de date : si la borne écrasait le filtre partiel, la purge supprimerait des
    paiements complétés — donc des pièces comptables, et la politique annonce
    le contraire."""
    filtre = regle_de("payments").query_de_purge(MAINTENANT)

    assert filtre["status"] == "pending"
    assert filtre["expires_at"] == {"$exists": True, "$lte": MAINTENANT}


def test_les_regles_a_date_de_creation_reculent_le_seuil():
    """Un document qui porte sa MORT se compare à maintenant ; un document qui
    porte sa NAISSANCE se compare à maintenant moins la durée. Confondre les
    deux formes ferait purger tout l'historique d'un coup."""
    naissance = regle_de("messages")

    assert naissance.query_de_purge(MAINTENANT) == {
        "timestamp": {"$lte": MAINTENANT - naissance.lifetime}
    }
    assert regle_de("users").query_de_purge(MAINTENANT)["purge_at"]["$lte"] == MAINTENANT


def test_aucune_regle_ne_purge_sans_borne_de_date():
    """L'invariant qui tient l'avenir : toute règle, y compris celles qu'on
    ajoutera, se traduit par un filtre borné dans le temps. Une règle dont le
    filtre perdrait son `ttl_field` purgerait la collection entière."""
    for regle in RETENTION_RULES:
        filtre = regle.query_de_purge(MAINTENANT)

        assert regle.ttl_field in filtre, f"{regle.collection} : filtre sans borne"
        assert "$lte" in filtre[regle.ttl_field], (
            f"{regle.collection} : la borne de date a disparu du filtre"
        )


async def test_la_purge_supprime_le_du_et_laisse_le_reste():
    """Une paire (dû / pas dû) par collection, plus les deux garde-fous."""
    comptes = regle_de("users").lifetime
    tickets = regle_de("support_tickets").lifetime
    messages = regle_de("messages").lifetime

    await db_insert("users", {
        "id": "compte-supprime-perime",
        "deleted": True,
        "deleted_at": MAINTENANT - comptes - timedelta(days=1),
        "purge_at": MAINTENANT - timedelta(days=1),
    })
    await db_insert("users", {
        "id": "compte-supprime-recent",
        "deleted": True,
        "deleted_at": MAINTENANT,
        "purge_at": MAINTENANT + timedelta(days=1),
    })
    # Garde-fou 1 : un compte ACTIF portant une échéance ancienne. Le filtre
    # exige `deleted`, donc le purger serait supprimer un compte vivant.
    await db_insert("users", {
        "id": "compte-actif-echeance-ancienne",
        "deleted": False,
        "purge_at": MAINTENANT - timedelta(days=400),
    })
    await db_insert("support_tickets", {
        "id": "ticket-perime",
        "created_at": MAINTENANT - tickets - timedelta(days=1),
    })
    await db_insert("support_tickets", {
        "id": "ticket-recent",
        "created_at": MAINTENANT - timedelta(days=1),
    })
    await db_insert("messages", {
        "id": "message-perime",
        "timestamp": MAINTENANT - messages - timedelta(days=1),
    })
    await db_insert("messages", {
        "id": "message-recent",
        "timestamp": MAINTENANT - timedelta(days=1),
    })
    # Garde-fou 2 : la pièce comptable. Un paiement complété ne porte pas
    # `expires_at`, donc la règle `payments` ne le voit pas, même très ancien.
    await db_insert("payments", {
        "id": "paiement-complete-ancien",
        "status": "completed",
        "created_at": MAINTENANT - timedelta(days=3650),
    })
    await db_insert("payments", {
        "id": "paiement-en-attente-perime",
        "status": "pending",
        "expires_at": MAINTENANT - timedelta(hours=1),
    })

    supprimes = await retention_purge_once(MAINTENANT)

    assert await _identifiants("users") == [
        "compte-actif-echeance-ancienne", "compte-supprime-recent",
    ]
    assert await _identifiants("support_tickets") == ["ticket-recent"]
    assert await _identifiants("messages") == ["message-recent"]
    assert await _identifiants("payments") == ["paiement-complete-ancien"]
    assert supprimes == {
        "users": 1, "support_tickets": 1, "messages": 1, "payments": 1,
    }


async def test_la_purge_epargne_les_paiements_encore_requis():
    """Les paiements « encore requis » — ceux qui doivent survivre.

    Le cas qui compte ici est CELUI DE LA PRODUCTION, et il ne se devine pas :
    les documents écrits AVANT que sortir de `pending` ne retire l'échéance
    (`kojo_payments.maj_statut_collecte` — l'invariant est mesuré par
    `test_paiement_echeance_checkout.py`) portent encore une échéance périmée.
    Un paiement `completed` (puis `released`) de cette génération est donc
    indiscernable d'un panier abandonné par la seule date.

    Ce qui le protège est l'autre moitié du filtre partiel, `status: pending` :
    c'est le SECOND FILET, celui qui couvre l'existant. Retirer cette clause (ou
    ajouter une règle qui l'oublie) supprimerait des pièces comptables —
    l'argent a été versé — et aucun autre cas ne le verrait : le paiement
    `completed` du test voisin, lui, ne porte pas d'échéance (forme d'après
    l'invariant), donc il survit même sans la clause `status`.
    """
    await db_insert("payments", {
        # Panier abandonné d'hier : dû, il doit partir.
        "id": "paiement-en-attente-echu",
        "status": "pending",
        "expires_at": MAINTENANT - timedelta(minutes=1),
    })
    await db_insert("payments", {
        # En cours, dans sa fenêtre : le client peut encore payer.
        "id": "paiement-en-attente-frais",
        "status": "pending",
        "expires_at": MAINTENANT + timedelta(hours=1),
    })
    await db_insert("payments", {
        # Payé PUIS versé, échéance jamais retirée : pièce comptable.
        "id": "paiement-verse-echeance-perimee",
        "status": "completed",
        "payout_status": "released",
        "payout_kind": "payout",
        "expires_at": MAINTENANT - timedelta(days=30),
    })
    await db_insert("payments", {
        # Séquestré, en attente de décision : le litige peut encore s'ouvrir.
        "id": "paiement-sequestre-echeance-perimee",
        "status": "completed",
        "payout_status": "held",
        "expires_at": MAINTENANT - timedelta(days=30),
    })

    supprimes = await retention_purge_once(MAINTENANT)

    assert await _identifiants("payments") == [
        "paiement-en-attente-frais",
        "paiement-sequestre-echeance-perimee",
        "paiement-verse-echeance-perimee",
    ], "un paiement encore requis a été purgé"
    assert supprimes == {"payments": 1}, (
        "seul le panier abandonné doit partir — sans ce compte, le cas ne "
        "prouverait pas que la purge agit"
    )


async def test_un_second_passage_ne_supprime_plus_rien():
    """La purge est IDEMPOTENTE : elle tourne tous les jours, donc un second
    passage sur un état déjà purgé doit être un non-événement (sans quoi le
    journal se remplirait d'un « 0 supprimé » quotidien)."""
    await db_insert("messages", {
        "id": "message-perime",
        "timestamp": MAINTENANT - regle_de("messages").lifetime - timedelta(days=1),
    })

    premier = await retention_purge_once(MAINTENANT)
    second = await retention_purge_once(MAINTENANT)

    assert premier == {"messages": 1}
    assert second == {}


async def test_la_suppression_de_compte_inscrit_l_echeance_de_la_regle(client):
    """Le point d'écriture, par la surface réelle : sans lui, la règle `users`
    ne purgerait jamais rien, puisque son filtre exige `purge_at`."""
    entetes = await auth_headers(client, BASE_USER)
    compte = await db_find_one("users", {"email": BASE_USER["email"]})

    reponse = await client.delete("/api/users/account", headers=entetes)

    assert reponse.status_code == 200, reponse.text
    document = await db_find_one("users", {"id": compte["id"]})
    assert document.get("deleted") is True, "le compte doit être marqué supprimé"
    assert "purge_at" in document, (
        "un compte anonymisé sans date de mort ne périme jamais : la durée "
        "publiée serait purement décorative"
    )
    # Les deux dates viennent du MÊME `now`, donc leur écart est exactement la
    # durée de la règle — pas une valeur approchée à une seconde près.
    assert document["purge_at"] - document["deleted_at"] == regle_de("users").lifetime
