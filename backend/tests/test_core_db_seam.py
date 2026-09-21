# -*- coding: utf-8 -*-
"""Le nom `db` n'a qu'UNE source, et c'est celle que les tests remplacent.

POURQUOI CE FICHIER

Le découpage de `kojo_core` a déplacé le nom `db` vers `kojo_db`. Ce qui compte
n'est pas l'emplacement, c'est ceci : chaque module qui expose `db` doit exposer
le MÊME objet que celui posé par `conftest.py`. Sinon un module interroge une
base qui ne répond à rien — ou pire, la vraie, quand la suite croit parler à une
doublure. C'est le mode d'échec silencieux d'un découpage qui déplace un nom
substitué : le code ne plante pas, il répond d'ailleurs.

COMMENT C'EST MESURÉ

Aucune liste n'est tenue ici : on part des modules réellement CHARGÉS après
l'import de `server` (ceux dont le nom commence par `kojo` et qui portent un
`db`), donc un module ajouté demain entre tout seul dans le contrôle. Le seuil
de modules vérifiés protège du faux vert quand plus rien n'est importé.
"""
from __future__ import annotations

import sys

from tests.conftest import USE_REAL_MONGO, fake_db

MINIMUM_DE_MODULES = 10


def modules_portant_db() -> dict:
    """Les modules chargés qui exposent un `db`, dérivés de `sys.modules`."""
    trouves = {}
    for nom, module in list(sys.modules.items()):
        if not nom.split(".")[0].startswith("kojo"):
            continue
        if getattr(module, "db", None) is None:
            continue
        trouves[nom] = module
    return trouves


def source_attendue():
    """La source que les tests ont posée : `kojo_db.db` (doublure ou vrai client)."""
    import kojo_db

    return kojo_db.db


class TestCoutureDeLaBase:
    def test_la_derivation_trouve_bien_des_modules(self):
        """Un contrôle vide passerait toujours : on refuse de conclure."""
        trouves = modules_portant_db()
        assert len(trouves) >= MINIMUM_DE_MODULES, (
            "seuls %d module(s) exposent `db` : le contrôle ne mesurerait rien "
            "(%s)" % (len(trouves), sorted(trouves))
        )

    def test_chaque_module_charge_pointe_sur_la_meme_source(self):
        """Tout `db` d'un module chargé est celui de `kojo_db` — nommément."""
        attendu = source_attendue()
        ecarts = {
            nom: type(module.db).__name__
            for nom, module in modules_portant_db().items()
            if module.db is not attendu
        }
        assert ecarts == {}, (
            "ces modules interrogent une AUTRE base que celle des tests "
            "(%s au lieu de %s) : %s"
            % (
                "vrai Mongo" if USE_REAL_MONGO else "la doublure FakeDB",
                type(attendu).__name__,
                ecarts,
            )
        )

    def test_la_facade_kojo_core_alias_cette_source(self):
        """L'alias servi par `kojo_core` est la source, pas une copie."""
        import kojo_core

        assert kojo_core.db is source_attendue(), (
            "l'alias `kojo_core.db` n'est plus celui de `kojo_db` : ses lecteurs "
            "et les tests ne parlent plus de la même base"
        )

    def test_en_mode_doublure_la_source_est_bien_la_fake(self):
        """Le contrôle n'a de sens que si la suite remplace réellement la base."""
        if USE_REAL_MONGO:
            return  # en mode Mongo réel, la source EST le vrai client
        assert source_attendue() is fake_db, (
            "la source de `db` n'est pas la doublure des tests : %s"
            % type(source_attendue()).__name__
        )
