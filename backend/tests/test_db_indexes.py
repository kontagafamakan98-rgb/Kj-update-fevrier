# -*- coding: utf-8 -*-
"""La déclaration des index ET leur création : un échec ne doit plus en emporter 66.

Ce que ces cas tiennent, et pourquoi chacun existe (mesuré le 27/10/2026) :

  * `create_database_indexes` enveloppait ~70 créations dans UN `try` ; le
    sixième index échouait et les 66 suivants n'étaient jamais créés. Le cas
    « un index en échec n'empêche pas les suivants » est le cœur du fichier :
    c'est la panne qu'aucune sonde ne voyait ;
  * `google_sub` était `unique`+`sparse` alors que l'inscription écrit
    `google_sub: None` : `sparse` écarte les champs ABSENTS, pas les `null`, donc
    l'index devenait impossible au deuxième compte (`E11000`). Il est
    désormais PARTIEL, sur les valeurs de type chaîne ;
  * un index qui existe sous le MÊME nom avec d'AUTRES options est RÉPARÉ
    (retrait puis recréation, une seule fois) — c'est l'état que laisse
    l'ancienne forme, et sans cela la production resterait avec un index qui ne
    porte pas la contrainte annoncée ;
  * un 11000 (doublon réel) n'est PAS un conflit d'options : retirer l'index ne
    corrigerait pas les données, donc on ne le retire pas ;
  * le RÉSUMÉ du démarrage dit combien sont conformes, remplacés, en échec —
    un avertissement par index, sans total, ne dit pas si la base est saine.
"""
import logging

import pytest

import kojo_db
import kojo_index_declares as index_declares


# ── La déclaration ─────────────────────────────────────────────────────────


class TestLIndexTexte:
    """Un index TEXTE se juge sur ses CHAMPS, pas sur la clé que Mongo replie.

    Mesuré le 27/10/2026 en production : `list_indexes()` rend la clé d'un index
    texte sous la forme `{'_fts': 'text', '_ftsx': 1}`. Comparer la clé faisait
    donc afficher « clé … ≠ {'_fts': …} » sur un index parfaitement conforme —
    un rouge qu'AUCUNE création ne peut corriger, donc un rouge qui apprend à
    être ignoré. Les champs se lisent dans `weights`.
    """

    def _declare_texte(self):
        return next(
            declare
            for declare in index_declares.declarations()
            if index_declares.est_texte(declare)
        )

    def _document_mongo(self, declare):
        """La forme RÉELLE d'un index texte dans `list_indexes()`."""
        return {
            "name": index_declares.nom(declare),
            "key": {"_fts": "text", "_ftsx": 1},
            "weights": {champ: 1 for champ in index_declares.champs_texte(declare)},
            "default_language": (declare.get("options") or {}).get("default_language"),
        }

    def test_un_index_texte_reel_est_conforme(self):
        declare = self._declare_texte()
        assert index_declares.comparer(declare, self._document_mongo(declare)) == []

    def test_un_champ_texte_disparu_est_nomme_avec_les_deux_listes(self):
        declare = self._declare_texte()
        document = self._document_mongo(declare)
        document["weights"].pop("location.address")
        ecarts = index_declares.comparer(declare, document)
        assert len(ecarts) == 1, ecarts
        assert "champs texte" in ecarts[0]
        assert "location.address" in ecarts[0].split("≠")[0]

    def test_un_index_texte_absent_reste_un_ecart(self):
        declare = self._declare_texte()
        assert index_declares.comparer(declare, None) == [
            "absent de la base (aucun index de ce nom)"
        ]


class TestLaDeclaration:
    def test_aucun_index_n_est_declare_deux_fois(self):
        declares = index_declares.declarations()
        assert index_declares.doublons(declares) == [], (
            "deux déclarations du même nom sur la même collection : la seconde "
            "n'écraserait pas la première, elle échouerait en silence"
        )

    def test_google_sub_est_un_index_PARTIEL_et_pas_sparse(self):
        """`sparse` ignore les champs absents, pas les `null` — d'où l'E11000."""
        google = [
            declare
            for declare in index_declares.declarations()
            if declare["collection"] == "users" and declare["cle"] == "google_sub"
        ]
        assert len(google) == 1
        options = google[0]["options"]
        assert options.get("unique") is True
        assert options.get("sparse") is not True, (
            "`sparse` sur `google_sub` laisse passer les documents à `null` dans "
            "l'index unique : c'est exactement la panne du 27/10/2026"
        )
        assert options.get("partialFilterExpression") == {"google_sub": {"$type": "string"}}

    def test_les_noms_suivent_la_regle_de_mongodb(self):
        for declare in index_declares.declarations():
            nom = index_declares.nom(declare)
            if "name" in (declare["options"] or {}):
                assert nom == declare["options"]["name"]
            else:
                assert nom == index_declares.nom_index(declare["cle"])

    def test_chaque_regle_de_conservation_a_son_index_TTL(self):
        """Une règle de rétention sans index TTL ne purge rien."""
        from kojo_retention import RETENTION_RULES

        declares = index_declares.declarations()
        for regle in RETENTION_RULES:
            attendu = index_declares.nom(index_declares._declare(regle.collection, regle.ttl_field))
            trouve = [
                declare
                for declare in declares
                if declare["collection"] == regle.collection
                and index_declares.nom(declare) == attendu
                and "expireAfterSeconds" in (declare["options"] or {})
            ]
            assert trouve, f"{regle.collection}.{attendu} (TTL) manque à la déclaration"

    def test_la_declaration_est_suffisamment_large_pour_etre_jugee(self):
        # Plancher partagé avec la sonde : une déclaration amputée doit refuser
        # de conclure, pas passer pour un vert.
        assert len(index_declares.declarations()) >= 60


# ── La création : un `try` par index ───────────────────────────────────────

class ConflitOptions(Exception):
    """L'erreur réelle de pymongo : `OperationFailure` code 85."""

    code = 85


class DoublonReel(Exception):
    code = 11000


class FauxCurseur:
    def limit(self, _n):
        return self

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class FausseCollection:
    def __init__(self, nom, journal, erreurs):
        self.nom = nom
        self.journal = journal
        self.erreurs = erreurs
        self.index = {}

    async def create_index(self, cle, **options):
        nom = options.get("name") or index_declares.nom_index(cle)
        erreur = self.erreurs.get((self.nom, nom))
        if erreur is not None:
            # Une erreur ne se rejoue pas : le cas du conflit doit réussir APRÈS
            # le retrait, sinon le test passerait pour la mauvaise raison.
            self.erreurs.pop((self.nom, nom))
            raise erreur
        self.journal.append(("create", self.nom, nom))
        self.index[nom] = {"key": cle, **options}
        return nom

    async def drop_index(self, nom):
        self.journal.append(("drop", self.nom, nom))
        self.index.pop(nom, None)

    def find(self, *_a, **_k):
        return FauxCurseur()

    async def update_one(self, *_a, **_k):
        return None


class FausseBase:
    def __init__(self, erreurs=None):
        self.journal = []
        self.erreurs = erreurs or {}
        self.collections = {}

    def __getitem__(self, nom):
        if nom not in self.collections:
            self.collections[nom] = FausseCollection(nom, self.journal, self.erreurs)
        return self.collections[nom]


@pytest.fixture
def creation(monkeypatch):
    """`preparer(erreurs)` lance la création sur une base en mémoire."""

    async def preparer(erreurs=None):
        base = FausseBase(erreurs)

        async def _dispo():
            return True

        monkeypatch.setattr(kojo_db, "db", base)
        monkeypatch.setattr(kojo_db, "is_database_available", _dispo)
        await kojo_db.create_database_indexes()
        return base

    return preparer


@pytest.mark.asyncio
class TestLaCreation:
    async def test_un_index_en_echec_n_empeche_pas_les_suivants(self, creation):
        declares = index_declares.declarations()
        # Le sixième index est celui qui cassait tout : on reproduit sa place.
        cible = declares[5]
        nom_cible = index_declares.nom(cible)
        base = await creation({(str(cible["collection"]), nom_cible): DoublonReel("E11000")})

        crees = [entree for entree in base.journal if entree[0] == "create"]
        assert len(crees) == len(declares) - 1, (
            f"{len(crees)} index créés sur {len(declares)} : un échec emporte encore "
            "les suivants"
        )
        # Le DERNIER de la déclaration est bien créé : c'est la preuve que la
        # boucle est allée au bout malgré l'échec du sixième.
        dernier = declares[-1]
        assert ("create", str(dernier["collection"]), index_declares.nom(dernier)) in base.journal

    async def test_le_resume_nomme_les_echecs_et_leur_nombre(self, creation, caplog):
        declares = index_declares.declarations()
        cible = declares[5]
        nom_cible = index_declares.nom(cible)
        with caplog.at_level(logging.INFO):
            await creation({(str(cible["collection"]), nom_cible): RuntimeError("boum")})
        texte = caplog.text
        assert "Index MongoDB :" in texte
        assert f"{len(declares) - 1}/{len(declares)} conformes" in texte
        assert "ÉCHEC" in texte
        assert f"{cible['collection']}.{nom_cible}" in texte

    async def test_un_index_aux_options_divergentes_est_remplace(self, creation, caplog):
        base_erreurs = {("users", "google_sub_1"): ConflitOptions("conflit")}
        with caplog.at_level(logging.INFO):
            base = await creation(base_erreurs)
        journal = [(action, collection, nom) for action, collection, nom in base.journal
                   if (collection, nom) == ("users", "google_sub_1")]
        assert journal[0][0] == "drop", (
            "un index qui existe sous le même nom avec d'autres options doit être "
            f"retiré puis recréé — vu : {journal}"
        )
        assert ("create", "users", "google_sub_1") in base.journal
        assert "REMPLACÉ" in caplog.text

    async def test_un_doublon_reel_ne_fait_pas_retirer_l_index(self, creation):
        """Un 11000 dit que les DONNÉES contredisent la règle : retirer l'index
        ne les corrigerait pas, et le ferait passer pour un index sain."""
        base = await creation({("users", "google_sub_1"): DoublonReel("E11000")})
        retraits = [entree for entree in base.journal if entree[0] == "drop"]
        assert retraits == []
