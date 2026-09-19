# -*- coding: utf-8 -*-
"""Sortir de `pending` RETIRE l'échéance du checkout : l'invariant tient à l'écriture.

Pourquoi ce test existe
-----------------------
`expires_at` est écrit à la création du checkout (`kojo_routers_payments.py`) et
c'est, avec le statut, ce qui dit à la purge qu'un paiement est un panier
abandonné plutôt qu'une pièce comptable. Tant que l'échéance n'était JAMAIS
retirée, la survie d'un paiement versé reposait sur la seule clause
`status: pending` du filtre partiel de `kojo_retention.py` : un refactor du
filtre pouvait supprimer des pièces comptables sans qu'aucun test ne bronche
(un paiement `completed` du test voisin ne porte pas d'échéance, donc il survit
même sans la clause).

L'invariant est donc porté par l'ÉCRITURE, en un seul endroit
(`kojo_payments.maj_statut_collecte` : la seule écriture du statut d'une
collecte). Ce fichier le mesure par la VRAIE surface — checkout, webhook IPN,
retour de statut par l'API — et jamais en appelant la fonction qui le porte.

Trois choses, dans cet ordre parce que l'ordre porte la preuve :
  1. la NON-VACUITÉ — l'échéance EXISTE après le checkout, sinon retirer le
     champ partout satisferait le test ;
  2. l'EFFET — après la transition, elle n'est plus là, sur les DEUX chemins
     qui font sortir un paiement de `pending` (IPN et retour de statut) ;
  3. l'INVARIANT, sur tous les paiements — « porte l'échéance » ⟺ « encore en
     attente ». Regarder le seul document qu'on vient de traverser laisserait
     passer un correctif qui ne nettoie que celui-là.

La clause `status: pending` du filtre de purge reste un SECOND FILET : les
documents écrits avant ce changement portent encore une échéance périmée.

Le fichier porte aussi les DEUX AUTRES champs dont un invariant croisé dépend,
dans le même mouvement : le statut lui-même, et l'état de séquestre
(`payout_status`), dont chaque transition est un mouvement d'argent qui n'est
lisible que s'il est écrit avec sa trace. Leur point d'écriture unique n'est pas
énuméré ici : il se LIT sur `kojo_payments` — voir la section finale.
"""
import ast
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from kojo_core import db
from kojo_retention import RETENTION_RULES
from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

# Le nom du champ n'est pas recopié : il appartient à la règle de conservation,
# seul document qui dit ce que la purge lit.
CHAMP_ECHEANCE = next(
    regle.ttl_field for regle in RETENTION_RULES if regle.collection == "payments"
)


async def _mission_payable(client_user) -> str:
    """Une mission en cours, assignée à un travailleur : le checkout exige une
    mission payable (même forme que les autres tests de paiement)."""
    job_id = str(uuid.uuid4())
    worker_id = "worker-echeance"
    proposal_id = str(uuid.uuid4())
    await db_insert("jobs", {
        "id": job_id, "title": "Mission à échéance",
        "client_id": client_user["user"]["id"], "status": "in_progress",
        "assigned_worker_id": worker_id, "accepted_proposal_id": proposal_id,
        "deleted": False,
    })
    await db_insert("job_proposals", {
        "id": proposal_id, "job_id": job_id, "worker_id": worker_id,
        "proposed_amount": 5000, "status": "accepted",
    })
    return job_id


async def _checkout(client: AsyncClient, headers: dict, job_id: str, jeton: str) -> str:
    """Le vrai endpoint de checkout : c'est lui qui écrit l'échéance."""
    with patch(
        "kojo_routers_payments.is_paydunya_configured", return_value=True
    ), patch(
        "kojo_routers_payments.create_paydunya_invoice",
        return_value={
            "token": jeton, "response_code": "00",
            "response_text": f"https://paydunya.test/{jeton}",
        },
    ):
        resp = await client.post("/api/payments/checkout", headers=headers, json={
            "job_id": job_id, "amount": 5000,
            "payment_method": "orange_money", "country": "senegal",
        })
    assert resp.status_code == 200, resp.text
    return resp.json()["payment_id"]


def _confirmation(statut_provider: str):
    """La réponse du fournisseur, simulée : aucun appel réseau."""
    return patch(
        "kojo_payments.confirm_paydunya_invoice",
        return_value={"invoice": {"status": statut_provider}},
    )


async def _ipn(client: AsyncClient, payment_id: str, statut_provider: str):
    """PREMIER chemin de sortie de `pending` : le webhook PayDunya."""
    with patch("kojo_payments.is_paydunya_configured", return_value=True), _confirmation(statut_provider):
        resp = await client.post(
            "/api/payments/ipn/paydunya", json={"custom_data": {"payment_id": payment_id}}
        )
    assert resp.status_code == 200, resp.text
    return resp


async def _statut_par_api(client: AsyncClient, headers: dict, payment_id: str, statut_provider: str):
    """SECOND chemin : `/payments/status/{id}`, que l'app interroge quand l'IPN
    n'arrive jamais. Les deux passent par la même écriture — un correctif posé
    dans un seul laisserait l'autre échéance en place."""
    with patch("kojo_payments.is_paydunya_configured", return_value=True), _confirmation(statut_provider):
        resp = await client.get(f"/api/payments/status/{payment_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _paiements():
    return await db.payments.find({}).to_list(length=None)


async def _verifie_l_invariant():
    """« porte l'échéance » ⟺ « encore en attente », sur TOUS les paiements."""
    documents = await _paiements()
    assert documents, "aucun paiement en base : l'invariant ne porterait sur rien"
    portent = sorted(doc["id"] for doc in documents if CHAMP_ECHEANCE in doc)
    en_attente = sorted(doc["id"] for doc in documents if doc.get("status") == "pending")
    assert portent == en_attente, (
        "des paiements portent une échéance de checkout sans être en attente "
        f"(ou l'inverse) — portent={portent}, en_attente={en_attente}"
    )
    return documents


@pytest.mark.asyncio
class TestEcheanceDeCheckout:

    async def test_un_paiement_abouti_perd_son_echeance(self, client: AsyncClient):
        """Le client paie : le paiement devient `completed` et n'a plus d'échéance."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        # DEUX paiements : un qui reste en attente, un qui aboutit. Sans le
        # premier, un correctif qui supprimerait l'échéance partout passerait.
        en_attente = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-attente"
        )
        abouti = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-abouti"
        )

        avant = await db_find_one("payments", {"id": abouti})
        assert CHAMP_ECHEANCE in avant, (
            "l'échéance n'est pas écrite à la création du checkout : ce cas ne "
            "mesurerait rien"
        )

        await _ipn(client, abouti, "completed")

        apres = await db_find_one("payments", {"id": abouti})
        assert apres["status"] == "completed", apres
        assert CHAMP_ECHEANCE not in apres, (
            "un paiement abouti porte encore son échéance de checkout : sa "
            "survie ne tient qu'à la clause de statut du filtre de purge, "
            "c'est-à-dire à une ligne qu'un refactor peut déplacer"
        )
        # La transition retire l'échéance, RIEN d'autre : les faits comptables
        # du document sont intacts.
        for champ in ("amount", "job_id", "payer_id", "receiver_id",
                      "commission_amount", "worker_amount", "payment_method"):
            assert apres[champ] == avant[champ], champ

        documents = await _verifie_l_invariant()
        assert [d["id"] for d in documents if d.get("status") == "pending"] == [en_attente], (
            "le paiement laissé en attente a lui aussi perdu son échéance : la "
            "transition nettoie plus que ce qui a quitté `pending`"
        )

    async def test_le_retour_de_statut_par_l_api_perd_aussi_l_echeance(self, client: AsyncClient):
        """L'autre chemin : l'IPN peut ne jamais arriver, et c'est
        `/payments/status/{id}` qui fait alors sortir le paiement de `pending`."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        payment_id = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-statut"
        )

        assert CHAMP_ECHEANCE in await db_find_one("payments", {"id": payment_id}), (
            "l'échéance n'est pas écrite à la création du checkout : ce cas ne "
            "mesurerait rien"
        )

        corps = await _statut_par_api(client, headers, payment_id, "completed")

        assert corps.get(CHAMP_ECHEANCE) is None, corps
        apres = await db_find_one("payments", {"id": payment_id})
        assert apres["status"] == "completed", apres
        assert CHAMP_ECHEANCE not in apres, (
            "le chemin `/payments/status` laisse l'échéance en place alors que "
            "l'IPN la retire : les deux chemins ne font donc pas la même chose"
        )
        await _verifie_l_invariant()

    async def test_un_paiement_abandonne_perd_aussi_son_echeance(self, client: AsyncClient):
        """La règle porte sur la SORTIE de `pending`, pas sur le succès : un
        panier annulé côté PayDunya ne doit pas non plus garder une échéance —
        sinon la clause de statut redevient le seul filet pour ce cas."""
        client_user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {client_user['access_token']}"}
        payment_id = await _checkout(
            client, headers, await _mission_payable(client_user), "tok-annule"
        )

        await _ipn(client, payment_id, "cancelled")

        apres = await db_find_one("payments", {"id": payment_id})
        assert apres["status"] == "cancelled", apres
        assert CHAMP_ECHEANCE not in apres, (
            "un paiement annulé garde son échéance de checkout"
        )
        await _verifie_l_invariant()


# ---------------------------------------------------------------------------
# Les points uniques d'écriture, DÉRIVÉS du code
# ---------------------------------------------------------------------------
# L'invariant de l'échéance ne vaut que si personne d'autre n'écrit le statut
# d'une collecte : un second écrivain pourrait le faire changer sans retirer
# l'échéance, et la survie d'un paiement versé retomberait sur la clause du
# filtre de purge — la dépendance que ce fichier supprime.
#
# Le champ de séquestre (`payout_status`, l'escrow de ce système) porte le même
# genre de couplage : chaque transition est un MOUVEMENT D'ARGENT, et elle n'est
# lisible que si elle est écrite avec la trace qui la rend confirmable et
# relançable (`payout_kind`, `disburse_token`, `payout_failure_reason`, réponse
# du prestataire). Une écriture directe du champ ferait changer l'état sans
# cette trace.
#
# Qui écrit quoi n'est PAS énuméré ici : la table se LIT sur le module
# propriétaire (`kojo_payments`), en relevant les clés de champ que chaque
# fonction y écrit dans un document de mise à jour. Un champ gouverné ajouté
# demain est couvert sans que ce fichier change — ce qu'il ne peut pas couvrir
# est dit à la fin.
RACINE = Path(__file__).resolve().parents[2]
CODAGE = "utf-8"
ECRITURES = {"update_one", "update_many", "find_one_and_update", "replace_one"}
OPERATEURS = {"$set", "$unset"}
MODULE_PROPRIETAIRE = RACINE / "backend" / "kojo_payments.py"


def _sources_de_production():
    backend = RACINE / "backend"
    return sorted([*backend.glob("kojo_*.py"), backend / "server.py"])


def _ecritures_sur_les_paiements(arbre):
    for noeud in ast.walk(arbre):
        if (
            isinstance(noeud, ast.Call)
            and isinstance(noeud.func, ast.Attribute)
            and noeud.func.attr in ECRITURES
            and ast.unparse(noeud.func.value) == "db.payments"
        ):
            yield noeud


def _champs_du_document(noeud) -> set:
    """Les clés de champ qu'un document `{"$set": {...}}` écrit en clair."""
    champs = set()
    if not isinstance(noeud, ast.Dict):
        return champs
    for cle, valeur in zip(noeud.keys, noeud.values):
        if (
            isinstance(cle, ast.Constant)
            and cle.value in OPERATEURS
            and isinstance(valeur, ast.Dict)
        ):
            champs |= {c.value for c in valeur.keys if isinstance(c, ast.Constant)}
    return champs


def _champs_ecrits_dans(fonction) -> set:
    """Les champs qu'une fonction écrit dans un document de mise à jour, que le
    document soit un littéral (`{"$set": {...}}`) ou une affectation du même
    genre qui complète le document déjà construit (`doc["$unset"] = {...}`)."""
    champs = set()
    for noeud in ast.walk(fonction):
        if isinstance(noeud, ast.Dict):
            champs |= _champs_du_document(noeud)
        elif isinstance(noeud, ast.Assign):
            cible = noeud.targets[0]
            if (
                isinstance(cible, ast.Subscript)
                and isinstance(cible.slice, ast.Constant)
                and cible.slice.value in OPERATEURS
                and isinstance(noeud.value, ast.Dict)
            ):
                champs |= {
                    c.value for c in noeud.value.keys if isinstance(c, ast.Constant)
                }
    return champs


def _module_proprietaire():
    arbre = ast.parse(MODULE_PROPRIETAIRE.read_text(encoding=CODAGE))
    fonctions = {
        noeud.name: noeud
        for noeud in arbre.body
        if isinstance(noeud, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    return arbre, fonctions


def _table_des_ecrivains() -> dict:
    """{champ gouverné: {noms des fonctions qui l'écrivent}} — lu sur le module
    propriétaire, jamais énuméré dans ce fichier."""
    _, fonctions = _module_proprietaire()
    table: dict = {}
    for nom, fonction in fonctions.items():
        for champ in _champs_ecrits_dans(fonction):
            table.setdefault(champ, set()).add(nom)
    return table


def _producteurs(fonctions, ecrivains) -> set:
    """Les fonctions du module propriétaire habilitées à produire un document de
    mise à jour : celles qui écrivent un champ gouverné, et celles qui les
    COMPOSENT (elles appellent un producteur) — une écriture qui touche deux
    invariants à la fois reste une écriture des propriétaires, pas un
    bricolage d'appelant. Le calcul va jusqu'au point fixe pour qu'une
    composition de composition soit couverte aussi."""
    producteurs = set(ecrivains)
    ajoute = True
    while ajoute:
        ajoute = False
        for nom, fonction in fonctions.items():
            if nom in producteurs:
                continue
            appels = {
                noeud.func.id
                for noeud in ast.walk(fonction)
                if isinstance(noeud, ast.Call) and isinstance(noeud.func, ast.Name)
            }
            if appels & producteurs:
                producteurs.add(nom)
                ajoute = True
    return producteurs


def _forme_du_document(noeud, arbre, profondeur=3):
    """Déplie un document de mise à jour : renvoie (champs écrits en clair,
    noms des fonctions qui le construisent).

    Un nom local est résolu sur ses assignations du module : deux écrivains du
    dépôt construisent leur document dans une variable avant de le passer, et
    ne pas les lire reviendrait à ne pas les contrôler. Ce qui reste hors de
    portée est dit en fin de fichier."""
    champs, appels = set(), set()
    if noeud is None or profondeur <= 0:
        return champs, appels
    if isinstance(noeud, ast.Dict):
        return _champs_du_document(noeud), appels
    if isinstance(noeud, ast.Call):
        if isinstance(noeud.func, ast.Name):
            appels.add(noeud.func.id)
        return champs, appels
    if isinstance(noeud, ast.IfExp):
        brancher = (noeud.body, noeud.orelse)
    elif isinstance(noeud, ast.Name):
        brancher = tuple(
            assigne.value
            for assigne in ast.walk(arbre)
            if isinstance(assigne, ast.Assign)
            and isinstance(assigne.targets[0], ast.Name)
            and assigne.targets[0].id == noeud.id
        )
    else:
        # Lecture (`await db.payments.find_one(...)`) ou expression dynamique.
        return champs, appels
    for branche in brancher:
        sous_champs, sous_appels = _forme_du_document(branche, arbre, profondeur - 1)
        champs |= sous_champs
        appels |= sous_appels
    return champs, appels


def test_les_champs_a_invariant_croise_ont_un_seul_ecrivain():
    """Chaque champ dont un invariant croisé dépend a UN écrivain, et le tableau
    qui le dit est dérivé du module propriétaire."""
    table = _table_des_ecrivains()

    # Non-vacuité, dérivée elle aussi : les champs que la règle de conservation
    # des paiements interroge dans son filtre partiel sont gouvernés. Sans cette
    # borne, une dérivation qui ne trouverait rien rendrait tout le reste vert.
    regle_paiements = next(
        regle for regle in RETENTION_RULES if regle.collection == "payments"
    )
    assert set(regle_paiements.partial or {}) <= set(table), (
        "des champs du filtre de purge des paiements ne sont gouvernés par "
        f"aucun écrivain : {sorted(set(regle_paiements.partial or {}) - set(table))}"
    )
    # Le séquestre ne figure dans aucun filtre de purge : c'est la SEULE entrée
    # exigée ici sans être dérivée, parce que la demande porte sur lui.
    assert "payout_status" in table, (
        "le champ de séquestre n'est écrit par aucune fonction de "
        "kojo_payments : l'argent peut changer d'état sans point unique"
    )

    doubles = {champ: sorted(noms) for champ, noms in table.items() if len(noms) > 1}
    assert not doubles, (
        f"un champ gouverné est écrit par plusieurs fonctions, donc l'invariant "
        f"croisé n'a plus un seul point de passage : {doubles}"
    )


def test_les_champs_gouvernes_ne_s_ecrivent_que_chez_leur_ecrivain():
    """Aucune source de production n'écrit un champ gouverné sur `db.payments`
    autrement que par un écrivain du module propriétaire."""
    table = _table_des_ecrivains()
    gouvernes = set(table)
    _, fonctions = _module_proprietaire()
    producteurs = _producteurs(
        fonctions, {nom for noms in table.values() for nom in noms}
    )

    violations = []
    for chemin in _sources_de_production():
        arbre = ast.parse(chemin.read_text(encoding=CODAGE))
        for appel in _ecritures_sur_les_paiements(arbre):
            if len(appel.args) < 2:
                continue
            champs, appels = _forme_du_document(appel.args[1], arbre)
            for champ in sorted(champs & gouvernes):
                violations.append(
                    f"{chemin.name}:{appel.lineno} écrit {champ!r} en clair, "
                    f"hors de {sorted(table[champ])}"
                )
            for nom in sorted(appels - producteurs):
                violations.append(
                    f"{chemin.name}:{appel.lineno} construit son document avec "
                    f"{nom}(), qui n'est pas un écrivain dérivé de "
                    f"{MODULE_PROPRIETAIRE.name}"
                )
    assert not violations, (
        "écriture d'un champ à invariant croisé hors de son point unique :\n  "
        + "\n  ".join(violations)
    )


# LIMITES, dites plutôt que supposées :
#   * un document assemblé dynamiquement (un dictionnaire construit par
#     compréhension, une clé calculée) n'est pas lisible ici — le contrôle
#     porte sur ce que l'AST montre, et refuse seulement ce qu'il voit ;
#   * un champ qui n'est encore écrit par aucune fonction du module
#     propriétaire n'est pas gouverné : c'est en l'écrivant là-bas qu'il le
#     devient, et le trou est alors visible dans la table ;
#   * la table ne dit pas que l'écrivain est correct, seulement qu'il est
#     UNIQUE — ce que fait la transition est mesuré par les tests de flux.
