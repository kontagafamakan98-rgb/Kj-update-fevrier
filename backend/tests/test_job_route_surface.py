# -*- coding: utf-8 -*-
"""Contrat de surface des routes de `kojo_routers_jobs` (découpage du 21/09/2026).

Ce qui est comparé, et pourquoi, est décrit UNE fois — dans
`tests/surface_contract.py` — plutôt que dans chaque famille : deux copies d'une
même règle divergent, et la seconde est celle qu'on oublie de corriger.

Ici : le verdict, plus la non-vacuité de la famille (une famille vide passerait
le contrat en ne vérifiant rien).
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from tests.surface_contract import famille, surface, verifier_contrat

COMPOSER = "kojo_routers_jobs"
SNAPSHOT = "job_route_surface.json"


class TestSurfaceDesRoutes:
    def test_la_surface_des_routes_est_inchangee(self):
        verifier_contrat(COMPOSER, SNAPSHOT, COMPOSER)

    def test_la_famille_est_non_vide_et_entierement_montee(self):
        """« Définie mais non montée » rougit ici aussi, sur la famille dérivée
        du composeur. Le cas du module ENTIÈREMENT orphelin — que ni le
        composeur ni l'application ne voient, puisque les deux dérivent du même
        montage — est celui de `test_decoupage_familles.py`, qui part du dossier.
        """
        from server import app

        montees = {(r.path, m) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
        possedees = famille(COMPOSER)
        assert len(possedees) >= 13, "famille suspicieusement petite : %s" % sorted(possedees)
        assert possedees - montees == set(), (
            "route(s) définie(s) mais NON montée(s) : %s" % sorted(possedees - montees)
        )
        assert len(surface(COMPOSER)) == len(possedees)
