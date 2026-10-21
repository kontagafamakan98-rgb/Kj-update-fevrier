# -*- coding: utf-8 -*-
"""Preuve de `backend/scripts/exercice_restauration.py`.

Un exercice de restauration qui rendrait un vert sans comparer quelque chose
serait le pire des deux mondes : il coûte une restauration et ne prouve rien.
Ce fichier verrouille donc les deux moitiés :

  1. la COMPARAISON dit ce qui a été perdu — collection absente, document en
     moins, contenu altéré, index perdu, index d'une autre DÉFINITION,
     collection en trop (six écarts, six cas, parce qu'un seul « ça ne
     correspond pas » n'aide personne à 3 h du matin) ;
  2. l'EXERCICE refuse de conclure sans base (`--uri` absent, cible égale à la
     source, cible vide) et ÉCRIT cette prémisse dans son rapport daté, au lieu
     de rendre 0 ;
  3. `--deja-restauree` juge l'ARCHIVE que `mongorestore` a posée, sans la
     recopier ni la détruire — sans ce mode, le run de sauvegarde devenait vert
     sans avoir jamais jugé ce qui serait restauré le jour d'une perte.

Rien ici n'ouvre de connexion : les fonctions pures sont appelées sur des
dictionnaires d'empreintes, et la dernière classe sur un pilote FACTICE
(quatre collections en mémoire qui lèvent à la moindre écriture).
"""
import io
import json
import sys
import tempfile
import types
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
# Le script vit sous `backend/scripts/`, pas à la racine du backend : c'est là
# que les outils d'ops sont déclarés (et lus par le registre de preuves).
if str(REPO_ROOT / "backend" / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

import exercice_restauration as exercice  # noqa: E402  (après le chemin)


def _empreinte(documents=10, sha="a" * 64, index=("id",), definitions=None):
    return {
        "documents": documents,
        "sha256": sha,
        "index": list(index),
        "definitions": definitions or {},
    }


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

    def test_index_present_mais_sans_sparse_est_un_ecart(self):
        """Un index du MÊME nom mais d'une autre définition n'est pas restauré :
        un unique non sparse fait échouer la restauration, un TTL perdu fait
        garder les données pour toujours. Le nom seul ne le dit pas — mesuré le
        21/10/2026 (E11000 sur `payments.idempotency_key`)."""
        ecarts = exercice.comparer(
            {"payments": _empreinte(
                index=("idempotency_key_1",),
                definitions={"idempotency_key_1": '{"key": [["idempotency_key", 1]], "sparse": true, "unique": true}'},
            )},
            {"payments": _empreinte(
                index=("idempotency_key_1",),
                definitions={"idempotency_key_1": '{"key": [["idempotency_key", 1]], "unique": true}'},
            )},
        )
        assert ecarts and "AUTRE définition" in ecarts[0]
        assert "sparse/TTL/partiel" in ecarts[0]

    def test_collection_en_trop_est_un_ecart(self):
        ecarts = exercice.comparer({"users": _empreinte()}, {"users": _empreinte(), "fantome": _empreinte()})
        assert ecarts and "EN TROP" in ecarts[0]


class TestLesIndexSontRecopiesEntiers:
    def test_sparse_ttl_et_filtre_partiel_survivent(self):
        """Ne garder que `unique` perdait `sparse` (restauration refusée) et
        `expireAfterSeconds` (TTL effacé sans le dire)."""
        information = {
            "key": [("idempotency_key", 1)],
            "unique": True,
            "sparse": True,
            "name": "idempotency_key_1",
            "v": 2,
            "ns": "kojo_db.payments",
            "background": True,
        }
        options = exercice.options_index(information)
        assert options == {"unique": True, "sparse": True}

        ttl = exercice.options_index({"key": [("recu_le", 1)], "expireAfterSeconds": 2592000, "name": "recu_le_1"})
        assert ttl == {"expireAfterSeconds": 2592000}

        partiel = exercice.options_index({
            "key": [("email", 1)],
            "partialFilterExpression": {"email": {"$exists": True}},
            "name": "email_1",
        })
        assert partiel == {"partialFilterExpression": {"email": {"$exists": True}}}

    def test_la_definition_ne_depend_pas_de_l_ordre_des_cles(self):
        dit = exercice.definition_index({"key": [("a", 1)], "unique": True, "sparse": True, "name": "a_1"})
        autre = exercice.definition_index({"sparse": True, "unique": True, "key": [("a", 1)]})
        assert dit == autre
        assert exercice.definition_index({"key": [("a", 1)], "unique": True}) != dit


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

    def test_deja_restauree_exige_une_cible_nommee(self):
        """Sans `--cible`, « ce qui est déjà restauré » n'a pas de sujet : le
        défaut est une base datée que le script créerait lui-même."""
        code, sortie = _lancer(["--uri", "mongodb://exemple.invalide/", "--deja-restauree"])
        assert code == 2, sortie
        assert "PRÉMISSE" in sortie and "--cible" in sortie


def _collection(documents, index=None):
    return {"documents": list(documents), "index": index}


class _FauxCurseur(list):
    def sort(self, *_a, **_k):
        return self


class _FausseCollection:
    """Collection en mémoire qui COMPTE les écritures.

    C'est la moitié qui compte : `--deja-restauree` existe pour comparer
    l'archive que `mongorestore` a posée, donc toute recopie ou recréation
    d'index est ici une ERREUR, pas un détail d'implémentation.
    """

    def __init__(self, documents=None, index=None):
        self.documents = list(documents or [])
        self.index = index or {"_id_": {"key": [("_id", 1)]}}

    def find(self, *_a, **_k):
        return _FauxCurseur(self.documents)

    def index_information(self):
        return self.index

    def insert_many(self, *_a, **_k):
        raise AssertionError("--deja-restauree ne doit RIEN recopier")

    def create_index(self, *_a, **_k):
        raise AssertionError("--deja-restauree ne doit RIEN recréer")


class _FausseBase(dict):
    def __init__(self, collections):
        super().__init__(
            (nom, _FausseCollection(**contenu)) for nom, contenu in collections.items()
        )

    def list_collection_names(self):
        return list(self.keys())


class _FauxClient:
    def __init__(self, bases):
        self.bases = {nom: _FausseBase(collections) for nom, collections in bases.items()}
        self.drops = []

    @property
    def admin(self):
        return self

    def command(self, _nom):
        return {"ok": 1}

    def __getitem__(self, nom):
        return self.bases.setdefault(nom, _FausseBase({}))

    def drop_database(self, nom):
        self.drops.append(nom)
        self.bases.pop(nom, None)

    def close(self):
        pass


def _lancer_avec_client(argv, bases):
    """Exécute `main` contre un pilote FACTICE : aucune connexion, aucune base."""
    client = _FauxClient(bases)
    faux = types.SimpleNamespace(MongoClient=lambda *_a, **_k: client)
    with mock.patch.dict(sys.modules, {"pymongo": faux}):
        code, sortie = _lancer(argv)
    return code, sortie, client


_DOCUMENTS = [{"_id": 1, "v": "a"}, {"_id": 2, "v": "b"}]
_INDEX = {
    "_id_": {"key": [("_id", 1)]},
    "idempotency_key_1": {"key": [("idempotency_key", 1)], "unique": True, "sparse": True},
}


class TestLArchiveRestaureeEstLeSujet:
    """Le mode qui rend le run de sauvegarde honnête.

    Mesuré le 21/10/2026 : sans `--deja-restauree`, le script détruisait la base
    que `mongorestore` venait de remplir pour la recopier lui-même depuis la
    source. Le run devenait vert sans avoir jamais jugé l'ARCHIVE — le seul
    objet qui serve le jour d'une perte.
    """

    def test_la_base_restauree_est_comparee_et_jamais_touchee(self):
        with tempfile.TemporaryDirectory() as dossier:
            rapport = Path(dossier) / "rapport.json"
            code, sortie, client = _lancer_avec_client(
                [
                    "--uri", "mongodb://exemple.invalide/",
                    "--base", "kojo_db", "--cible", "kojo_verif",
                    "--deja-restauree", "--rapport", str(rapport),
                ],
                {
                    "kojo_db": {"users": {"documents": _DOCUMENTS, "index": _INDEX}},
                    "kojo_verif": {"users": {"documents": _DOCUMENTS, "index": _INDEX}},
                },
            )
            assert code == 0, sortie
            assert "Archive restaurée IDENTIQUE" in sortie, (
                "le verdict doit dire que c'est l'ARCHIVE qui est jugée : " + sortie
            )
            # Ni recopie, ni reconstruction d'index, ni destruction : le client
            # factice lève sur toute écriture, et `drops` prouve le reste.
            assert client.drops == [], client.drops
            donnees = json.loads(rapport.read_text(encoding="utf-8"))
            assert donnees["mode"].startswith("comparaison d'une archive")
            # Le RTO n'est pas prétendu : mongorestore a restauré hors du script.
            assert donnees["rto_mesure_s"] is None
            assert "mongorestore" in donnees["rto_non_mesure"]

    def test_un_document_perdu_dans_l_archive_est_un_ecart(self):
        code, sortie, _client = _lancer_avec_client(
            [
                "--uri", "mongodb://exemple.invalide/",
                "--base", "kojo_db", "--cible", "kojo_verif", "--deja-restauree",
            ],
            {
                "kojo_db": {"users": {"documents": _DOCUMENTS, "index": _INDEX}},
                "kojo_verif": {"users": {"documents": _DOCUMENTS[:1], "index": _INDEX}},
            },
        )
        assert code == 1, sortie
        assert "1 document(s) restaurés sur 2" in sortie, sortie

    def test_un_index_sans_sparse_dans_l_archive_est_un_ecart(self):
        """`mongorestore` peut poser un index d'une autre définition sans
        échouer : la comparaison doit le nommer, sinon le run serait vert sur
        une base qui refusera les écritures qu'acceptait la production."""
        sans_sparse = {
            "_id_": {"key": [("_id", 1)]},
            "idempotency_key_1": {"key": [("idempotency_key", 1)], "unique": True},
        }
        code, sortie, _client = _lancer_avec_client(
            [
                "--uri", "mongodb://exemple.invalide/",
                "--base", "kojo_db", "--cible", "kojo_verif", "--deja-restauree",
            ],
            {
                "kojo_db": {"payments": {"documents": _DOCUMENTS, "index": _INDEX}},
                "kojo_verif": {"payments": {"documents": _DOCUMENTS, "index": sans_sparse}},
            },
        )
        assert code == 1, sortie
        assert "AUTRE définition" in sortie and "sparse/TTL/partiel" in sortie, sortie

    def test_une_cible_vide_est_une_premisse_pas_une_reussite(self):
        """Une archive qui n'a rien restauré ne prouve rien : c'est une
        prémisse nommée, jamais un vert sur deux Bases vides."""
        code, sortie, _client = _lancer_avec_client(
            [
                "--uri", "mongodb://exemple.invalide/",
                "--base", "kojo_db", "--cible", "kojo_verif", "--deja-restauree",
            ],
            {"kojo_db": {"users": {"documents": _DOCUMENTS, "index": _INDEX}}},
        )
        assert code == 2, sortie
        assert "est vide" in sortie and "PRÉMISSE" in sortie, sortie
