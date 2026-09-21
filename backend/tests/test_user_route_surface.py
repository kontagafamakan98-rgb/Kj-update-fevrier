# -*- coding: utf-8 -*-
"""Contrat de surface des routes de `kojo_routers_users` (découpage du 21/09/2026).

Ce qui est comparé, et pourquoi, est décrit UNE fois — dans
`tests/surface_contract.py`. Ici : le verdict, plus la non-vacuité de la famille.

Sur ce routeur, le contrat couvre des routes que la surface publique ne laisse
pas deviner : `/users/account` (suppression de compte, avec remboursement des
fonds séquestrés AVANT anonymisation) et `/users/account/export` (droit
d'accès). Leur ORDRE d'enregistrement et leurs dépendances d'authentification
sont donc figés au même titre que leurs chemins.
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from tests.surface_contract import famille, surface, verifier_contrat

COMPOSER = "kojo_routers_users"
SNAPSHOT = "user_route_surface.json"


class TestSurfaceDesRoutes:
    def test_la_surface_des_routes_est_inchangee(self):
        verifier_contrat(COMPOSER, SNAPSHOT, COMPOSER)

    def test_la_famille_est_non_vide_et_entierement_montee(self):
        """« Définie mais non montée » rougit, et la famille doit rester entière :
        les 21 routes du routeur d'origine, aucune de moins."""
        from server import app

        montees = {(r.path, m) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
        possedees = famille(COMPOSER)
        assert len(possedees) >= 21, "famille suspicieusement petite : %s" % sorted(possedees)
        assert possedees - montees == set(), (
            "route(s) définie(s) mais NON montée(s) : %s" % sorted(possedees - montees)
        )
        assert len(surface(COMPOSER)) == len(possedees)
