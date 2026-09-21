# -*- coding: utf-8 -*-
"""Aucune route ne rend un identifiant qui change entre deux lectures.

POURQUOI CE FICHIER

Un modèle dont le champ `id` porte un défaut (`uuid4`) en reçoit un NOUVEAU à
chaque construction. Construit depuis un document stocké qui n'a pas de champ
`id` — un document antérieur au champ, ou une mission ancienne qui porte
`job_id` — il rend donc un identifiant DIFFÉRENT à chaque lecture : l'id affiché
ne désigne aucun document, l'action du client répond 404, l'écran ment.

C'est le bug des notifications du 21/09/2026, et le même motif vivait encore
dans douze autres rendus — `kojo_routers_jobs_completion.py` ×5,
`kojo_routers_jobs_proposals.py`, `kojo_routers_jobs_tracking.py`,
`kojo_routers_reviews.py`, `kojo_routers_support.py` ×2,
`kojo_routers_messages.py`, `kojo_routers_auth.py` ×3. Ils passent tous par
`kojo_identifiants.dump_stable`, seul endroit qui décide comment un document
stocké devient une réponse.

Ce que ce fichier mesure, et qui empêche la classe de revenir :

  * un modèle à identifiant par défaut peut être ÉCRIT, jamais rendu : tout
    `.model_dump()` d'un tel modèle hors d'une écriture est refusé (dérivé du
    dossier et de `kojo_models.py`, jamais d'une liste) ;
  * la propriété est vérifiée pour CHAQUE modèle dérivé : deux rendus du même
    document donnent le même identifiant, celui du document — et le danger est
    mesuré dans le même cas (le modèle nu, lui, change bien entre deux lectures) ;
  * la propriété est prouvée sur une route réelle : un document ancien lu deux
    fois rend le même identifiant, et cet identifiant ACCEPTE la proposition.

Le témoin de la règle est `kojo_routers_jobs_tracking.py` : son entrée au
registre (`guard-proofs.json`) montre que ce contrôle sait rougir quand un rendu
revient au modèle nu, en nommant le fichier et la ligne.

Le même fichier mesure un second fait, trouvé ici en exerçant la route :
`kojo_routers_jobs_proposals.py` rejetait la proposition qu'il venait d'accepter,
parce qu'il NIAIT la règle d'identifiant (`{"$ne": valeur}` sur chacun des trois
champs que la règle accepte) — un `$or` de négations est vrai dès que
l'identifiant vit dans un autre champ, donc il ne peut pas dire « pas ce
document ». La négation se fait sur `_id`, la seule clé unique par construction,
et le registre porte la mutation qui le montre.
"""
from __future__ import annotations

import ast
import datetime
import enum
import typing
from pathlib import Path

import pytest
from httpx import AsyncClient

import kojo_models
from kojo_identifiants import dump_stable, identifiant_public
from tests.conftest import (
    BASE_USER,
    WORKER_USER,
    db_find_one,
    db_insert,
    register_and_login,
)

BACKEND = Path(__file__).resolve().parent.parent
MODELES = BACKEND / "kojo_models.py"

# Sous ces seuils, la dérivation est cassée — on refuse de conclure plutôt que
# de passer au vert sur un contrôle vide.
MINIMUM_DE_MODELES = 5
MINIMUM_DE_RENDUS = 12

# Les opérations qui ÉCRIVENT le résultat d'un modèle : construire un document
# neuf pour l'insérer est légitime, c'est même comme ça que `id` est attribué.
OPERATIONS_D_ECRITURE = {
    "insert_one", "insert_many", "update_one", "update_many", "replace_one",
}


def modules() -> list[Path]:
    """Les modules du dossier backend — un module neuf entre tout seul."""
    return sorted(
        chemin for chemin in BACKEND.glob("kojo_*.py") if chemin.name != "kojo_models.py"
    )


def modeles_a_identifiant_par_defaut() -> dict[str, str]:
    """Les modèles dont `id` porte un défaut, donc un identifiant NEUF à chaque
    construction. Dérivé de `kojo_models.py` : un modèle ajouté entre tout seul.
    """
    arbre = ast.parse(MODELES.read_text(encoding="utf-8"))
    trouves = {}
    for noeud in arbre.body:
        if not isinstance(noeud, ast.ClassDef):
            continue
        for corps in noeud.body:
            if not isinstance(corps, ast.AnnAssign) or corps.value is None:
                continue
            if isinstance(corps.target, ast.Name) and corps.target.id == "id":
                trouves[noeud.name] = corpus(corps.value)
    return trouves


def corpus(noeud: ast.AST) -> str:
    try:
        return ast.unparse(noeud)
    except Exception:  # pragma: no cover - unparse ne devrait pas échouer
        return "?"


def dumps_de_modeles(chemin: Path, dangereux: set[str]) -> list[tuple[int, str, bool]]:
    """Les `.model_dump()` d'un modèle dérivé : (ligne, modèle, est_une_écriture)."""
    arbre = ast.parse(chemin.read_text(encoding="utf-8"))
    for parent in ast.walk(arbre):
        for enfant in ast.iter_child_nodes(parent):
            enfant._parent = parent
    trouves = []
    for noeud in ast.walk(arbre):
        if not (
            isinstance(noeud, ast.Call)
            and isinstance(noeud.func, ast.Attribute)
            and noeud.func.attr == "model_dump"
        ):
            continue
        cible = noeud.func.value
        if not (isinstance(cible, ast.Call) and isinstance(cible.func, ast.Name)):
            continue
        if cible.func.id not in dangereux:
            continue
        # Le dump part-il vers une ÉCRITURE ? On remonte les parents proches.
        parent, ecriture = getattr(noeud, "_parent", None), False
        for _ in range(6):
            if parent is None:
                break
            if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Attribute):
                if parent.func.attr in OPERATIONS_D_ECRITURE:
                    ecriture = True
                    break
            parent = getattr(parent, "_parent", None)
        trouves.append((noeud.lineno, cible.func.id, ecriture))
    return trouves


def _bornes(champ) -> tuple[int | None, int | None]:
    """Les bornes qu'un champ STRING impose (elles vivent dans ses métadonnées)."""
    mini = maxi = None
    for contrainte in getattr(champ, "metadata", None) or []:
        mini = getattr(contrainte, "min_length", None) or mini
        maxi = getattr(contrainte, "max_length", None) or maxi
    return mini, maxi


def _valeur_de(annotation, champ=None) -> object:
    """Une valeur valide minimale pour un champ requis (le doc « ancien » doit
    pouvoir être chargé par le modèle réel, sinon la propriété n'est pas testée).
    """
    origine = typing.get_origin(annotation)
    if origine in (typing.Union,):
        options = [a for a in typing.get_args(annotation) if a is not type(None)]
        return _valeur_de(options[0], champ) if options else None
    if origine is typing.Literal:
        return typing.get_args(annotation)[0]
    if origine in (list, set, tuple):
        return []
    if origine is dict:
        return {}
    if isinstance(annotation, type):
        if issubclass(annotation, enum.Enum):
            return list(annotation)[0]
        if issubclass(annotation, bool):
            return False
        if issubclass(annotation, int):
            return 1
        if issubclass(annotation, float):
            return 1.0
        if "Email" in annotation.__name__:
            return "valeur@exemple.sn"
        if issubclass(annotation, str):
            mini, maxi = _bornes(champ)
            taille = max(mini or 0, 32)
            return "v" * (min(taille, maxi) if maxi else taille)
        if issubclass(annotation, dict):
            return {}
        if issubclass(annotation, (list, set, tuple)):
            return []
        if issubclass(annotation, (datetime.datetime, datetime.date)):
            return "2026-01-01T00:00:00+00:00"
    return None


def document_ancien(modele) -> dict:
    """Un document tel qu'on en trouve en base AVANT le champ `id` : les champs
    du modèle, l'identifiant en moins, la clé primaire de Mongo en plus.
    """
    doc = {}
    for nom, champ in modele.model_fields.items():
        if champ.default_factory is not None:
            doc[nom] = champ.default_factory()
        elif champ.is_required():
            doc[nom] = _valeur_de(champ.annotation, champ)
        else:
            doc[nom] = champ.default
    doc.pop("id", None)
    doc["_id"] = "cle-primaire-du-document"
    return doc


class TestLeDangerEstMesure:
    def test_la_derivation_trouve_bien_des_modeles_a_identifiant_par_defaut(self):
        modeles = modeles_a_identifiant_par_defaut()
        assert len(modeles) >= MINIMUM_DE_MODELES, (
            "seuls %d modèle(s) à identifiant par défaut : la dérivation de "
            "`kojo_models.py` ne mesure plus rien" % len(modeles)
        )

    def test_chaque_modele_derive_change_bien_d_identifiant_entre_deux_lectures(self):
        """Le danger, mesuré sur chaque modèle : construit deux fois depuis le
        même document ancien, le modèle NU rend deux identifiants différents.
        C'est la contrepartie du contrôle qui suit — sans elle, il ne prouverait
        rien.
        """
        reproches = []
        for nom in sorted(modeles_a_identifiant_par_defaut()):
            modele = getattr(kojo_models, nom)
            doc = document_ancien(modele)
            premier = modele(**doc).model_dump()
            second = modele(**doc).model_dump()
            if premier.get("id") == second.get("id"):
                reproches.append(
                    "%s : construit deux fois depuis un document sans `id`, le "
                    "modèle rend le MÊME identifiant (%r) — le danger a changé "
                    "de forme, la règle doit être relue" % (nom, premier.get("id"))
                )
        assert reproches == [], "\n  ".join(reproches)

    def test_chaque_modele_derive_rend_l_identifiant_du_document(self):
        """La propriété, pour chaque modèle dérivé : `dump_stable` rend
        l'identifiant DU DOCUMENT, et deux lectures donnent le même.
        """
        reproches = []
        for nom in sorted(modeles_a_identifiant_par_defaut()):
            modele = getattr(kojo_models, nom)
            doc = document_ancien(modele)
            premier = dump_stable(modele, doc)
            second = dump_stable(modele, doc)
            attendu = identifiant_public(doc)
            if premier.get("id") != attendu or second.get("id") != attendu:
                reproches.append(
                    "%s : identifiant rendu %r / %r, attendu %r (celui du document)"
                    % (nom, premier.get("id"), second.get("id"), attendu)
                )
        assert reproches == [], "\n  ".join(reproches)


class TestAucunRenduNeConstruitSonModele:
    def test_la_derivation_trouve_bien_les_rendus(self):
        """Non-vacuité : le contrôle ci-dessous ne vaut que si les rendus passent
        par le propriétaire de la règle.
        """
        total = sum(
            chemin.read_text(encoding="utf-8").count("dump_stable(")
            for chemin in modules()
        )
        assert total >= MINIMUM_DE_RENDUS, (
            "seuls %d appel(s) à `dump_stable` dans les modules : la règle "
            "d'origine a-t-elle disparu ?" % total
        )

    def test_aucun_module_ne_rend_le_dump_nu_d_un_modele_a_identifiant_par_defaut(self):
        """Un tel modèle peut être ÉCRIT (c'est ainsi qu'il reçoit son `id`),
        jamais rendu : le rendu passe par `dump_stable`.
        """
        dangereux = set(modeles_a_identifiant_par_defaut())
        assert dangereux, "aucun modèle dérivé : le contrôle ne mesurerait rien"
        fautes = []
        for chemin in modules():
            for ligne, modele, ecriture in dumps_de_modeles(chemin, dangereux):
                if ecriture:
                    continue
                fautes.append(
                    "%s:%d  %s(**document).model_dump() hors écriture : "
                    "l'identifiant rendu vient du DÉFAUT du modèle (nouveau à "
                    "chaque lecture) — passer par kojo_identifiants.dump_stable"
                    % (chemin.name, ligne, modele)
                )
        assert fautes == [], (
            "rendu(s) qui construisent leur modèle à la main :\n  " + "\n  ".join(fautes)
        )


class TestSurLaRouteReelle:
    """Ce que la classe de bug produisait, exercé sur une route : un document
    ancien est lu deux fois, et l'identifiant rendu doit désigner la ligne.
    """

    @pytest.mark.asyncio
    async def test_une_proposition_ancienne_garde_son_identifiant_et_reste_acceptable(
        self, client: AsyncClient
    ):
        cliente = await register_and_login(client, BASE_USER)
        entetes = {"Authorization": f"Bearer {cliente['access_token']}"}
        travailleur = await register_and_login(client, WORKER_USER)

        # Une MISSION ANCIENNE : son identifiant est dans `job_id`, pas dans `id`.
        await db_insert(
            "jobs",
            {
                "job_id": "mission-ancienne",
                "client_id": cliente["user"]["id"],
                "title": "Mission ancienne",
                "description": "Document antérieur au champ id",
                "category": "menage",
                "status": "open",
                "budget_min": 4000,
                "budget_max": 6000,
                "location": {"address": "Dakar, Sénégal"},
            },
        )
        job = await db_find_one("jobs", {"job_id": "mission-ancienne"})
        assert "id" not in job, "le document doit rester SANS champ `id` pour ce cas"

        # Une PROPOSITION ANCIENNE, elle aussi sans champ `id`.
        await db_insert(
            "job_proposals",
            {
                "job_id": "mission-ancienne",
                "worker_id": travailleur["user"]["id"],
                "status": "pending",
                "proposed_amount": 5000,
                "estimated_completion_time": "2 jours",
                "message": "Je peux faire cette mission dès demain matin.",
            },
        )
        proposition = await db_find_one("job_proposals", {"job_id": "mission-ancienne"})
        assert "id" not in proposition, "le document doit rester SANS champ `id` pour ce cas"

        # Deux lectures de la MÊME liste, par la route réelle.
        premiere = await client.get("/api/jobs/mission-ancienne/proposals", headers=entetes)
        seconde = await client.get("/api/jobs/mission-ancienne/proposals", headers=entetes)
        assert premiere.status_code == 200, premiere.text
        identifiants = [
            [p["id"] for p in premiere.json()],
            [p["id"] for p in seconde.json()],
        ]
        assert identifiants[0] == identifiants[1], (
            "l'identifiant rendu change entre deux lectures : %r puis %r — "
            "il ne désigne rien" % (identifiants[0], identifiants[1])
        )
        rendu = identifiants[0][0]
        assert rendu == str(proposition["_id"]), (
            "l'identifiant rendu (%r) doit être celui du document (%r)"
            % (rendu, str(proposition["_id"]))
        )

        # Et il DÉSIGNE la ligne : l'action menée avec cet identifiant aboutit.
        acceptation = await client.post(
            f"/api/jobs/mission-ancienne/proposals/{rendu}/accept", headers=entetes
        )
        assert acceptation.status_code == 200, acceptation.text
        corps = acceptation.json()
        apres = await db_find_one("job_proposals", {"job_id": "mission-ancienne"})
        assert apres["status"] == "accepted", "la proposition doit être acceptée, pas seulement annoncée"
        assert corps["job"]["id"] == str(job["_id"]), (
            "la mission rendue doit porter l'identifiant de SON document (%r), pas un défaut (%r)"
            % (str(job["_id"]), corps["job"]["id"])
        )

        # La même action, rejouée : la mission ancienne répond la même chose.
        rejeu = await client.post(
            f"/api/jobs/mission-ancienne/proposals/{rendu}/accept", headers=entetes
        )
        assert rejeu.status_code == 200, rejeu.text
        assert rejeu.json()["job"]["id"] == corps["job"]["id"], (
            "deux lectures de la même mission rendent deux identifiants : %r puis %r"
            % (corps["job"]["id"], rejeu.json()["job"]["id"])
        )
