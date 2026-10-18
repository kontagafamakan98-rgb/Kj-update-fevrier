# -*- coding: utf-8 -*-
"""Preuve de `backend/scripts/exercice_restauration.py`.

Un exercice de restauration qui rendrait un vert sans comparer quelque chose
serait le pire des deux mondes : il coûte une restauration et ne prouve rien.
Ce fichier verrouille donc les deux moitiés :

  1. la COMPARAISON dit ce qui a été perdu — collection absente, document en
     moins, contenu altéré, index perdu, collection en trop (cinq écarts, cinq
     cas, parce qu'un seul « ça ne correspond pas » n'aide personne à 3 h du
     matin) ;
  2. l'EXERCICE refuse de conclure sans base (`--uri` absent, cible égale à la
     source) et ÉCRIT cette prémisse dans son rapport daté, au lieu de rendre 0.

Rien ici n'ouvre de connexion : les fonctions pures sont appelées sur des
dictionnaires d'empreintes, et la prémisse lève AVANT tout pilote.
"""
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# Le script vit sous `backend/scripts/`, pas à la racine du backend : c'est là
# que les outils d'ops sont déclarés (et lus par le registre de preuves).
if str(REPO_ROOT / "backend" / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

import exercice_restauration as exercice  # noqa: E402  (après le chemin)


def _empreinte(documents=10, sha="a" * 64, index=("id",)):
    return {"documents": documents, "sha256": sha, "index": list(index)}


def _lancer(argv):
    """Exécute le script sans réseau : la prémisse lève avant le pilote."""
    tampon = io.StringIO()
    with redirect_stdout(tampon):
        code = exercice.main(argv)
    return code, tampon.getvalue()


class TestLaComparaisonNommeCeQuiEstPerdu:
    def test_identique_ne_produit_aucun_ecart(self):
        avant = {"users": _empreinte(), "jobs": _empreinte(5, "b" * 64)}
        assert exercice.comparer(avant, avant) == []

    def test_collection_absente_est_un_ecart(self):
        ecarts = exercice.comparer({"users": _empreinte()}, {})
        assert ecarts and "ABSENTE" in ecarts[0]

    def test_document_en_moins_est_un_ecart(self):
        ecarts = exercice.comparer({"users": _empreinte(10)}, {"users": _empreinte(9)})
        assert ecarts and "9 document" in ecarts[0]

    def test_contenu_altere_est_un_ecart_meme_au_bon_compte(self):
        ecarts = exercice.comparer({"users": _empreinte()}, {"users": _empreinte(sha="c" * 64)})
        assert ecarts and "empreinte différente" in ecarts[0]

    def test_index_perdu_est_un_ecart(self):
        ecarts = exercice.comparer(
            {"jobs": _empreinte(index=("id", "assigned_worker_id"))},
            {"jobs": _empreinte(index=("id",))},
        )
        assert ecarts and "assigned_worker_id" in ecarts[0]

    def test_collection_en_trop_est_un_ecart(self):
        ecarts = exercice.comparer({"users": _empreinte()}, {"users": _empreinte(), "fantome": _empreinte()})
        assert ecarts and "EN TROP" in ecarts[0]


class TestLaPremisseNEstPasUnVert:
    def test_sans_uri_le_script_rend_2_et_ecrit_sa_premisse(self):
        with tempfile.TemporaryDirectory() as dossier:
            rapport = Path(dossier) / "rapport.json"
            code, sortie = _lancer(["--uri", "", "--rapport", str(rapport)])
            assert code == 2, sortie
            assert "PRÉMISSE" in sortie
            donnees = json.loads(rapport.read_text(encoding="utf-8"))
            assert donnees["verdict"].startswith("prémisse")
            # Le rapport dit ce que l'exercice ne prouve pas, même quand il n'a
            # rien pu faire : c'est la phrase qui évite de croire le drill fait.
            assert "snapshot" in donnees["ce_qui_n_est_pas_prouve"]

    def test_refuse_une_cible_egale_a_la_source(self):
        code, sortie = _lancer(
            ["--uri", "mongodb://exemple.invalide/", "--base", "kojo_db", "--cible", "kojo_db"]
        )
        assert code == 2, sortie
        assert "REFUS" in sortie
