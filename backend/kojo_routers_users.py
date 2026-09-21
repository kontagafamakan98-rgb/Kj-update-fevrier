# -*- coding: utf-8 -*-
"""Façade des endpoints « comptes » : monte les modules, et rien d'autre.

Ce fichier portait 1 500 lignes et vingt et une routes, mêlant l'identité du
compte (profil, photo), ses moyens d'être payé, ses jetons de notification, le
parrainage, la vitrine du travailleur, et les deux extrémités du RGPD — la
suppression de compte et l'export des données. Chacune a maintenant son module,
avec ses helpers, et chacun se lit seul.

L'ORDRE des `include_router` reproduit l'ordre d'enregistrement historique :
l'ordre décide quelle route gagne quand deux motifs se recouvrent, et ce
routeur en contient un cas — `/{user_id}/profile-photo` voisine avec les
chemins littéraux du même préfixe. La surface publique est donc figée route par
route, DANS L'ORDRE, par `tests/user_route_surface.json`.

Un module de la famille que ce composeur oublierait de monter échapperait aux
deux listes dérivées du même montage : c'est le rôle de
`tests/test_decoupage_familles.py`, qui part du dossier.

Ce module reste la façade : `server.py` continue de prendre `router` ici, et
les noms déjà importés par les tests sont ré-exportés en bas — la découpe ne
casse aucun appelant.
"""
from fastapi import APIRouter

from kojo_routers_users_profile import router as _profile
from kojo_routers_users_push import router as _push
from kojo_routers_users_payments import router as _payments
from kojo_routers_users_portfolio import router as _portfolio
from kojo_routers_users_referral import router as _referral
from kojo_routers_users_account import router as _account

router = APIRouter()

# L'ordre EST le contrat (voir le docstring) : ne pas trier, ne pas regrouper.
router.include_router(_profile)
router.include_router(_push)
router.include_router(_payments)
router.include_router(_portfolio)
router.include_router(_referral)
router.include_router(_account)

# ─── Ré-exports : la surface d'import existante, conservée ──────────────────
# Ces noms avaient des appelants AVANT la découpe (les tests les importent) ;
# ils les gardent, sans seconde définition — chaque nom a un seul propriétaire.
# Un PATCH, lui, doit viser le module où le nom est UTILISÉ, pas cette façade.
from kojo_routers_users_account import (  # noqa: E402  (registre RGPD, lu par les tests)
    ANONYMISATION_CHAMPS,
    CHAMPS_CONSERVES,
    CHAMPS_HORS_MODELE,
    EXPORT_LIMIT_PER_COLLECTION,
    EXPORT_WITHHELD_FIELDS,
    JOB_LOCATION_FIELDS,
    NO_USER_DATA_COLLECTIONS,
    REFUNDABLE_PAYOUT_STATES,
    USER_DATA_BY_EMAIL,
    USER_DATA_BY_EMAIL_FIELD,
    USER_DATA_SOURCES,
    export_my_data,
)
from kojo_routers_users_profile import EDITABLE_PROFILE_FIELDS  # noqa: E402  (tests)

__all__ = [
    "router",
    "ANONYMISATION_CHAMPS",
    "CHAMPS_CONSERVES",
    "CHAMPS_HORS_MODELE",
    "EXPORT_LIMIT_PER_COLLECTION",
    "EXPORT_WITHHELD_FIELDS",
    "JOB_LOCATION_FIELDS",
    "NO_USER_DATA_COLLECTIONS",
    "REFUNDABLE_PAYOUT_STATES",
    "USER_DATA_BY_EMAIL",
    "USER_DATA_BY_EMAIL_FIELD",
    "USER_DATA_SOURCES",
    "export_my_data",
    "EDITABLE_PROFILE_FIELDS",
]
