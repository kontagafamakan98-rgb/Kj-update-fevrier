# -*- coding: utf-8 -*-
"""Façade des endpoints « missions » : monte les modules, et rien d'autre.

Ce fichier portait 1 507 lignes et treize routes — le plus gros module du
backend. Il ne portait pas une concern mais cinq, mêlées : le profil
travailleur, la collection des missions (créer, chercher, lire, supprimer), les
candidatures, la clôture avec versement, et le suivi (mes candidatures, l'état
du paiement). Chacune a maintenant son module, avec ses propres helpers, et
chacun se lit seul.

  - `kojo_routers_jobs_workers`    : `/workers/profile` (3 routes)
  - `kojo_routers_jobs_creation`   : `POST /jobs` + push de matching
  - `kojo_routers_jobs_listing`    : `GET /jobs`, `GET|DELETE /jobs/{id}`
  - `kojo_routers_jobs_proposals`  : candidater, accepter une candidature
  - `kojo_routers_jobs_completion` : clôturer et verser, bonus de 1ʳᵉ mission
  - `kojo_routers_jobs_tracking`   : candidatures et état du paiement (lecture)

Trois faits partagés ont leur propre propriétaire, pour la même raison :
`kojo_job_categories` (normalisation des catégories, lue par la création ET la
recherche), `kojo_job_refunds` (remboursement PayDunya, appelé par trois
routeurs différents) et `kojo_job_effects` (les six appels qui SORTENT du
processus, donc les seuls que les tests substituent).

L'ORDRE des `include_router` reproduit l'ordre d'enregistrement historique :
l'ordre décide quelle route gagne quand deux motifs se recouvrent, et la
surface publique est donc figée route par route, dans l'ordre, par
`tests/job_route_surface.json`.

Ce module reste la façade : `server.py` continue de prendre `router` ici, et
les noms déjà importés par d'autres modules ou par les tests sont ré-exportés
en bas — la découpe ne casse aucun appelant.
"""
from fastapi import APIRouter

from kojo_routers_jobs_completion import router as _completion
from kojo_routers_jobs_creation import router as _creation
from kojo_routers_jobs_listing import router as _listing
from kojo_routers_jobs_proposals import router as _proposals
from kojo_routers_jobs_tracking import router as _tracking
from kojo_routers_jobs_workers import router as _workers

router = APIRouter()

# L'ordre EST le contrat (voir le docstring) : ne pas trier, ne pas regrouper.
router.include_router(_workers)
router.include_router(_creation)
router.include_router(_listing)
router.include_router(_proposals)
router.include_router(_completion)
router.include_router(_tracking)

# ─── Ré-exports : la surface d'import existante, conservée ──────────────────
# Ces noms avaient des appelants AVANT la découpe ; ils les gardent, sans
# seconde définition (chaque nom a un seul propriétaire, indiqué ici).
from kojo_job_categories import (  # noqa: E402  (catégories, lues par les tests)
    _CATEGORY_GROUPS,
    _category_search_variants,
    _normalize_job_category,
)
from kojo_job_refunds import execute_paydunya_refund  # noqa: E402  (owner, users)
from kojo_routers_jobs_creation import _notify_matching_workers  # noqa: E402  (tests)

__all__ = [
    "router",
    "_CATEGORY_GROUPS",
    "_category_search_variants",
    "_normalize_job_category",
    "_notify_matching_workers",
    "execute_paydunya_refund",
]
