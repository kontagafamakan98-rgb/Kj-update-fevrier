# -*- coding: utf-8 -*-
"""Contrat de surface de TOUTE l'application : famille par famille.

Ce qui est comparé, pourquoi, et ce que coûte la maintenance d'un instantané par
famille est décrit UNE fois — dans `tests/surface_contract.py`. Ici : les
verdicts.

Les mêmes règles valent pour toutes les familles, découpées ou non : c'est le
même contrôle qui protège les deux familles déjà découpées
(`kojo_routers_jobs.py`, `kojo_routers_users.py` — leurs instantanés sont ceux
pris sur l'arbre d'AVANT leur découpage) et les dix autres, dont celle que
`server.py` monte lui-même. C'est lui qui attrapera le prochain découpage : une
famille neuve n'a pas besoin d'un test neuf — elle a besoin d'un instantané, et
ce fichier le dit en la nommant.
"""
from __future__ import annotations

import pytest

from tests.surface_contract import (
    MINIMUM_DE_FAMILLES,
    MINIMUM_DE_ROUTES,
    familles,
    familles_gelees,
    porteurs,
    routes_declarees,
    routes_hors_famille,
    routes_servies,
    surface,
    verifier_famille,
)


class TestLaDerivationEstReelle:
    """Un contrat vide passerait toujours : on refuse de conclure."""

    def test_la_derivation_trouve_bien_des_familles_et_des_routes(self):
        familles_ = familles()
        total = sum(len(routes) for routes in surface().values())
        assert len(familles_) >= MINIMUM_DE_FAMILLES, (
            "seules %d famille(s) dérivées (%s) : le contrat ne mesurerait rien"
            % (len(familles_), familles_)
        )
        assert total >= MINIMUM_DE_ROUTES, (
            "%d route(s) montée(s) au total : la dérivation est cassée, pas le contrat" % total
        )

    def test_chaque_route_de_l_application_appartient_au_produit(self):
        """Hors familles, la surface doit être celle du framework — nommée sinon.

        C'est le seul angle par lequel une surface pourrait échapper au contrat :
        une route montée depuis un module inconnu, ou une application tierce
        montée sur le site.
        """
        inconnues = routes_hors_famille()
        assert inconnues == [], "route(s) hors familles et hors framework : %s" % inconnues

    def test_aucun_instantane_orphelin(self):
        """Le MIROIR du contrôle d'orphelin : une famille qui DISPARAÎT.

        Un instantané dont plus aucune route de l'application ne relève ne
        vérifie plus rien : un routeur débranché, une famille renommée ou vidée
        laisserait son fichier derrière lui, et le contrat resterait vert sur du
        vide. Ce sont les deux moitiés de la même règle — un module sans famille
        (le contrôle d'orphelin ci-dessous) et une famille sans module.
        """
        sans_famille = sorted(set(familles_gelees()) - set(familles()))
        assert sans_famille == [], (
            "instantané(s) dont plus aucune route de l'application ne relève : %s — "
            "une famille qui disparaît se retire avec son instantané"
            % ["route_surface_%s.json" % f for f in sans_famille]
        )

    def test_aucun_porteur_de_routes_n_est_orphelin(self):
        """Le mode d'échec qu'aucun contrôle dérivé du MONTAGE ne peut voir.

        Un module qui déclare des routes sans que personne ne le monte
        n'apparaît ni dans sa famille ni dans l'application : les deux viennent
        du même montage. Le seul périmètre qui puisse le voir est le dossier —
        et c'est pourquoi ce test part des modules qui assignent un `APIRouter`,
        pas des routes servies.

        L'échec nomme le module ET les routes qui ne répondent nulle part.
        """
        manquants = []
        pourvus = 0
        for nom_module in sorted(porteurs()):
            declarees = routes_declarees(nom_module)
            if not declarees:
                # Un composeur ne déclare aucune route à lui : celles qu'il
                # inclut appartiennent à leurs modules, et c'est par eux qu'elles
                # sont vérifiées. Ici, il ne dit rien de lui-même.
                continue
            pourvus += 1
            servies = routes_servies(nom_module)
            absentes = sorted(
                (methode, chemin)
                for methode, chemin in declarees
                if not any(methode == autre and montee.endswith(chemin) for autre, montee in servies)
            )
            if absentes:
                manquants.append(
                    "%s : %s NON servie(s) — ce module n'est monté par personne"
                    % (
                        nom_module,
                        ", ".join("%s %s" % (m, c) for m, c in absentes),
                    )
                )
        assert pourvus >= 8, (
            "seuls %d module(s) déclarent des routes : le verdict serait vide" % pourvus
        )
        assert manquants == [], "\n  ".join(manquants)


class TestSurfaceDesFamilles:
    """La surface montée == la référence, pour chaque famille de l'application."""

    @pytest.mark.parametrize("famille", familles())
    def test_la_surface_de_la_famille_est_inchangee(self, famille):
        verifier_famille(famille)

    @pytest.mark.parametrize("famille", familles())
    def test_la_famille_n_est_pas_vide(self, famille):
        """Une famille sans route ne mesurerait rien — et le dirait au vert."""
        routes = surface().get(famille, [])
        assert routes, "la famille « %s » est vide : elle ne vérifierait rien" % famille
