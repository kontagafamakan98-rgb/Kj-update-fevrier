# -*- coding: utf-8 -*-
"""La suite de tests ne peut pas écrire dans une base qui n'est pas une base de test.

── Ce que ce garde ferme (02/11/2026) ────────────────────────────────────────

Trois profils de test étaient publics en production (« CI Worker » et deux
doublons « Famakan Kontaga »). Aucun ne venait de la CI — la CI était déjà
isolée —, mais l'isolation était INCIDENTE : elle tenait à une ligne
`os.environ["DB_NAME"] = "kojo_test"`, et le défaut du serveur est `kojo_db`,
c'est-à-dire la base de PRODUCTION (`kojo_db.py`). Retirer ou déplacer cette
ligne suffisait à faire écrire toute la suite dans la vraie base : les comptes
créés par les tests y seraient publics, au sitemap et dans les compteurs de
l'accueil.

L'isolation est devenue un REFUS : `conftest.nom_base_de_test` n'accepte qu'un
nom qui finit par `_test`, et la suite ne démarre pas sinon. Ce fichier prouve
les deux moitiés — le refus (sur des noms réels, pas sur une liste recopiée) et
le fait que la suite tourne effectivement sur la base de test, lue sur le client
Mongo lui-même et non sur la variable qu'on vient de poser.
"""
import os

import pytest

import kojo_db
from tests.conftest import NOM_BASE_TEST, nom_base_de_test


class TestLeRefus:
    def test_une_base_de_production_est_refusee(self):
        """`kojo_db` est le défaut du serveur : c'est LA base à ne pas toucher."""
        for nom in ("kojo_db", "kojo", "production", "kojo_prod"):
            with pytest.raises(RuntimeError) as refus:
                nom_base_de_test(nom)
            assert "_test" in str(refus.value), (
                "le refus doit NOMMER la règle (« un nom qui finit par _test »), "
                "sinon il se lit comme une panne"
            )

    def test_un_nom_absent_est_un_refus_pas_un_defaut(self):
        """Pas de `DB_NAME` ne vaut pas « la base par défaut » : c'est un refus."""
        for nom in ("", "   ", None):
            with pytest.raises(RuntimeError):
                nom_base_de_test(nom)

    def test_une_base_de_test_passe_telle_quelle(self):
        """Non-vacuité : le garde ne refuse pas ce qu'il doit laisser passer."""
        for nom in ("kojo_test", "kojo_ci_test", "  kojo_test  "):
            assert nom_base_de_test(nom).endswith("_test")


class TestLaSuiteTourneSurLaBaseDeTest:
    def test_la_variable_est_posee_avant_les_imports(self):
        assert os.environ["DB_NAME"] == NOM_BASE_TEST

    def test_la_connexion_a_retenu_la_base_de_test(self):
        """Le fait, pas l'intention : `kojo_db` PUBLIE le nom qu'il a retenu.

        Celui du client ou de la doublure ne se lit pas de la même façon (le
        local remplace le client par un `MagicMock`), mais `nom_base` est écrit
        à l'import dans les deux cas : c'est donc le seul fait commun, et il
        porte sur la connexion réellement ouverte, pas sur la variable posée
        par `conftest` juste avant.
        """
        assert kojo_db.nom_base == NOM_BASE_TEST

    def test_aucun_test_ne_nomme_la_base_de_production(self):
        """`kojo_db` ne doit apparaître nulle part comme cible d'écriture.

        Le nom est cherché dans les fichiers de test eux-mêmes : un cas qui
        écrirait `DB_NAME = "kojo_db"` ou qui importerait un module avant
        `conftest` réintroduirait le risque en contournant le garde.
        """
        from pathlib import Path

        ici = Path(__file__).parent
        suspects = []
        for fichier in ici.glob("test_*.py"):
            if fichier.name == Path(__file__).name:
                continue
            texte = fichier.read_text(encoding="utf-8")
            for ligne in texte.splitlines():
                depouillee = ligne.strip()
                if depouillee.startswith("#"):
                    continue
                if "DB_NAME" in depouillee and "kojo_db" in depouillee:
                    suspects.append(f"{fichier.name}: {depouillee}")
        assert not suspects, (
            "un test désigne la base de production : l'isolation de la suite "
            "repose sur le nom, pas sur la discipline de chaque cas —\n"
            + "\n".join(suspects)
        )
