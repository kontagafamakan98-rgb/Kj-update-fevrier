# -*- coding: utf-8 -*-
"""Le trou que les contrats de famille ne peuvent PAS voir.

Un contrat de surface (`test_job_route_surface.py`, `test_user_route_surface.py`)
dérive la famille des routes du COMPOSEUR, puis cherche ces routes dans
l'application. Les deux listes viennent du même montage : un module
`kojo_routers_users_<sujet>.py` que le composeur oublie de monter n'apparaît
donc ni dans la famille ni dans l'application, et son contrat reste vert — le
mode d'échec exact d'un découpage, invisible à ce qui le vérifie.

Le seul périmètre qui puisse le voir est le DOSSIER : c'est celui-ci. Tout
module de la forme `kojo_routers_<famille>_<sujet>.py` qui déclare des routes
doit les voir servies par l'application.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from fastapi.routing import APIRoute

from tests.surface_contract import BACKEND_DIR, modules_du_decoupage, routes_du_module


def _famille(chemin: Path) -> str:
    """« kojo_routers_users_referral.py » → « users » (le sujet, c'est le reste)."""
    return chemin.stem.split("_")[2]


def _composeur(chemin: Path) -> Path:
    """Le composeur de la famille : `kojo_routers_users.py` pour un module `_users_`."""
    return BACKEND_DIR / ("kojo_routers_%s.py" % _famille(chemin))


def _montees():
    """((chemin PRÉFIXÉ, méthode) servis par l'application, préfixe du montage)."""
    from server import api_router, app

    montees = {
        (r.path, m)
        for r in app.routes
        if isinstance(r, APIRoute)
        for m in r.methods
    }
    return montees, api_router.prefix


def test_les_familles_sont_derivees_du_dossier():
    """Non-vacuité, sans aucun nom de famille recopié ici.

    Une famille n'existe que si son composeur existe : c'est ce que le nom
    promet, et un module dont le composeur manque est une famille imaginaire.
    """
    modules = modules_du_decoupage()
    familles = Counter(_famille(m) for m in modules)
    assert len(modules) >= 4, "trop peu de modules découverts : %s" % [m.name for m in modules]
    assert len(familles) >= 2, "une seule famille découpée découverte : %s" % dict(familles)
    sans_composeur = sorted(
        m.name for m in modules if not _composeur(m).is_file()
    )
    assert sans_composeur == [], (
        "module(s) d'une famille SANS composeur (nom de famille invalide ?) : %s" % sans_composeur
    )


def test_aucun_module_porteur_de_routes_n_est_orphelin():
    """Tout module de la famille qui déclare des routes doit les voir SERVIES.

    L'échec nomme le module ET la route qui ne répond nulle part — sans quoi
    « un module a été oublié » ne dirait pas au lecteur ce qui a disparu de
    l'API.
    """
    montees, prefixe = _montees()
    orphelins = []
    pourvus = 0
    for chemin in modules_du_decoupage():
        routes = routes_du_module(chemin)
        if not routes:
            continue
        pourvus += 1
        manquantes = sorted(r for r in routes if (prefixe + r[0], r[1]) not in montees)
        if manquantes:
            orphelins.append(
                "%s : %s NON montée(s) — le composeur %s ne monte pas ce module"
                % (
                    chemin.name,
                    ", ".join("%s %s" % (m, c) for c, m in manquantes),
                    _composeur(chemin).name,
                )
            )
    assert pourvus >= 2, "aucun module porteur de routes trouvé : le verdict serait vide"
    assert orphelins == [], "\n  ".join(orphelins)
