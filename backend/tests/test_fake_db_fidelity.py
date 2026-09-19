# -*- coding: utf-8 -*-
"""Fidélité de la FakeDB au vrai MongoDB — les trous qui verdissaient un test à tort.

La FakeDB (`conftest.py`) est le mode PAR DÉFAUT en local. Un opérateur qu'elle
ignore en silence n'est pas neutre : la requête devient plus permissive qu'en
production (donc un test « la recherche trouve cette mission » passe sans que
rien ne filtre), ou l'écriture disparaît (donc un test « le champ n'y est plus »
passe sur un champ que le code devait poser). Les deux verdicts sont faux sans
être visibles.

L'audit du 19/09/2026 a relevé les opérateurs RÉELLEMENT utilisés par le dépôt
que la FakeDB n'appliquait pas :

  * `$regex` + `$options` — 3 clauses réelles dans la recherche de missions
    (`kojo_routers_jobs.py`) : elles étaient ignorées, donc `?q=` ramenait TOUT ;
  * `$setOnInsert` — le `created_at` d'un code OTP (`kojo_email.py`) n'était
    jamais posé, ce qui fait passer au vert une comparaison « inchangé après
    renvoi » entre deux clés absentes ;
  * `$gt` / `$lt` / `$lte` — seul `$gte` existait, et par `float()` : une plage
    laissait sa borne haute ignorée, et une date ISO ne matchait rien ;
  * les chemins POINTÉS (`location.latitude`) — lus comme des clés littérales,
    donc toute clause visant un sous-champ ne correspondait jamais ;
  * un tri qui comparait les nombres comme du TEXTE (« 9 » après « 100 »), donc
    `results[0]` pouvait être le mauvais document.

La seconde passe (même jour) a relevé cinq autres divergences SILENCIEUSES, qui
n'étaient pas des opérateurs manquants mais des comportements faux :

  * `skip` appliqué AVANT le tri — toute page 2 d'une liste paginée
    (`kojo_routers_jobs`, `_messages`, `_owner`) rendait une page prise dans
    l'ordre d'insertion ;
  * `find_one(sort=…)` trié au texte, avec la PREMIÈRE clé seulement ;
  * `$inc` qui passait tout en `float()` : un compteur entier repartait en
    `100.0`, donc la réponse de l'API différait de la production ;
  * `$inc` et `$push` écrits sur la clé LITTÉRALE d'un chemin pointé ;
  * un update par REMPLACEMENT (document sans opérateur) qui ne faisait rien et
    rendait pourtant `modified_count=1` — et `insert_one`, qui ne stockait pas
    le `_id` qu'il venait de rendre (l'index `_id` de Mongo est unique sans
    déclaration).

Ces cas-ci décrivent UNE divergence chacun. Ceux qui éprouvent la FakeDB
elle-même sont ignorés en mode Mongo réel — là, c'est Mongo qui répond, et ils
ne prouveraient rien — sauf les deux derniers, qui passent par la SURFACE RÉELLE
(`GET /api/jobs`) et montrent ce que le trou laissait passer.
"""
import re
from datetime import datetime, timezone

import pytest

from tests.conftest import (
    BASE_USER,
    USE_REAL_MONGO,
    FakeDbDuplicateKey,
    FakeDbUnsupportedOperator,
    auth_headers,
    fake_db,
)

# Ces cas portent sur la FakeDB : en mode Mongo réel, le même code interroge
# Mongo et ils perdraient leur objet (ils passeraient sans rien éprouver).
faux_mode_seulement = pytest.mark.skipif(
    USE_REAL_MONGO,
    reason="décrit la FakeDB : en mode Mongo réel, c'est Mongo qui répond",
)


def _collection(nom="fidelite"):
    """La collection FakeDB que l'application utilise réellement (la fixture
    autouse `reset_state` la vide avant chaque test)."""
    return getattr(fake_db, nom)


async def _semer(nom, docs):
    collection = _collection(nom)
    for doc in docs:
        await collection.insert_one(dict(doc))
    return collection


@faux_mode_seulement
class TestRequetes:
    async def test_regex_filtre_vraiment_au_lieu_de_tout_ramener(self):
        """Le cas qui verdissait un test : la clause `$regex` était ignorée, donc
        la requête entière était plus permissive qu'en production."""
        collection = await _semer("regex", [
            {"id": "1", "title": "Plomberie urgente Dakar"},
            {"id": "2", "title": "Cours de mathématiques"},
        ])

        trouves = await collection.find({"title": {"$regex": "Plomberie"}}).to_list()

        assert [d["id"] for d in trouves] == ["1"]

    async def test_un_regex_sans_option_i_reste_sensible_a_la_casse(self):
        """Sans cette distinction, on ne saurait pas si le filtre compare comme
        Mongo ou s'il matche tout (une expression qui matche toujours serait le
        faux vert, sous une autre forme)."""
        collection = await _semer("regex_casse", [
            {"id": "1", "title": "Plomberie urgente Dakar"},
        ])

        trouves = await collection.find({"title": {"$regex": "plomberie"}}).to_list()

        assert trouves == []

    async def test_l_option_i_rend_la_recherche_insensible_a_la_casse(self):
        collection = await _semer("regex_i", [
            {"id": "1", "title": "Plomberie urgente Dakar"},
            {"id": "2", "title": "Cours de mathématiques"},
        ])

        trouves = await collection.find(
            {"title": {"$regex": "PLOMBERIE", "$options": "i"}}
        ).to_list()

        assert [d["id"] for d in trouves] == ["1"]

    async def test_un_regex_ne_matche_pas_un_champ_non_textuel(self):
        """Mongo n'applique une expression qu'aux chaînes : un montant ne
        « contient » pas « 100 »."""
        collection = await _semer("regex_non_texte", [{"id": "1", "budget": 10000}])

        trouves = await collection.find({"budget": {"$regex": "100"}}).to_list()

        assert trouves == []

    async def test_les_bornes_basses_et_hautes_sont_toutes_appliquees(self):
        """`$lte` n'existait pas : la borne haute était ignorée en silence, donc
        la plage ramenait plus de documents qu'en production."""
        collection = await _semer("plage", [
            {"id": "bas", "amount": 500},
            {"id": "dedans", "amount": 1500},
            {"id": "haut", "amount": 9000},
        ])

        trouves = await collection.find(
            {"amount": {"$gte": 1000, "$lte": 5000}}
        ).to_list()

        assert [d["id"] for d in trouves] == ["dedans"]

    async def test_des_dates_iso_se_comparent_chronologiquement(self):
        """Les dates du dépôt sont des chaînes ISO. L'ancien `$gte` passait par
        `float()` : un TypeError était interprété comme « aucun match »."""
        collection = await _semer("dates", [
            {"id": "vieux", "created_at": "2026-08-01T00:00:00+00:00"},
            {"id": "recent", "created_at": "2026-09-19T00:00:00+00:00"},
        ])

        trouves = await collection.find(
            {"created_at": {"$gte": "2026-09-01T00:00:00+00:00"}}
        ).to_list()

        assert [d["id"] for d in trouves] == ["recent"]

    async def test_des_dates_bson_se_comparent_chronologiquement(self):
        """Les MODÈLES écrivent de vraies dates (`Message.timestamp`,
        `SupportTicket.created_at`, `User.created_at`), pas des chaînes ISO.
        `_compare` ne connaissait que les nombres et les chaînes : une plage sur
        une date BSON rendait False, donc la purge de conservation ne trouvait
        jamais rien — et comme elle ne trouve rien en silence, rien ne le disait.
        """
        collection = await _semer("dates_bson", [
            {"id": "aout", "quand": datetime(2026, 8, 1, tzinfo=timezone.utc)},
            {"id": "septembre", "quand": datetime(2026, 9, 19, tzinfo=timezone.utc)},
        ])

        avant_septembre = await collection.find(
            {"quand": {"$lt": datetime(2026, 9, 1, tzinfo=timezone.utc)}}
        ).to_list()

        assert [d["id"] for d in avant_septembre] == ["aout"]

    async def test_une_date_naive_est_lue_comme_utc(self):
        """Mongo stocke des dates SANS fuseau : une borne naïve (celle qu'un
        appelant écrit naturellement) doit se comparer aux dates de la base au
        lieu de lever un TypeError pris pour « aucun match »."""
        collection = await _semer("dates_naives", [
            {"id": "recente", "quand": datetime(2026, 9, 19, tzinfo=timezone.utc)},
        ])

        trouvees = await collection.find(
            {"quand": {"$gte": datetime(2026, 9, 1)}}
        ).to_list()

        assert [d["id"] for d in trouvees] == ["recente"]

    async def test_des_types_incomparables_ne_matchent_pas(self):
        """Mongo compare à l'intérieur d'un type : un nombre n'est pas
        « supérieur » à une chaîne."""
        collection = await _semer("types", [{"id": "1", "amount": 100}])

        assert await collection.find({"amount": {"$gte": "abc"}}).to_list() == []
        assert await collection.find({"amount": {"$lt": 1000}}).to_list() != []

    async def test_un_chemin_pointe_est_lu_comme_un_chemin(self):
        """`location.latitude` cherché comme une clé littérale ne correspondait
        jamais : toute clause visant un sous-champ faisait zéro match (cas réel :
        le backfill géo de `kojo_core`)."""
        collection = await _semer("chemins", [
            {"id": "avec", "location": {"latitude": 14.7, "longitude": -17.4}},
            {"id": "sans", "location": {"address": "Dakar"}},
        ])

        avec = await collection.find({"location.latitude": {"$ne": None}}).to_list()
        present = await collection.find({"location.latitude": {"$exists": True}}).to_list()

        assert [d["id"] for d in avec] == ["avec"]
        assert [d["id"] for d in present] == ["avec"]

    async def test_un_sous_document_sans_operateur_exige_l_egalite_exacte(self):
        """Les clés d'un sous-document étaient prises pour des OPÉRATEURS, donc
        la clause entière était ignorée — plus permissive qu'en production."""
        collection = await _semer("sous_doc", [
            {"id": "1", "location": {"latitude": 14.7, "longitude": -17.4}},
        ])

        assert await collection.find({"location": {"latitude": 14.7}}).to_list() == []
        exacts = await collection.find(
            {"location": {"latitude": 14.7, "longitude": -17.4}}
        ).to_list()

        assert [d["id"] for d in exacts] == ["1"]

    async def test_un_operateur_de_requete_inconnu_leve_au_lieu_de_tout_ramener(self):
        """Le refus est ce qui empêche le PROCHAIN trou : sans lui, un opérateur
        non implémenté redeviendrait une clause silencieusement absente."""
        collection = await _semer("inconnu", [{"id": "1", "title": "n'importe quoi"}])

        with pytest.raises(FakeDbUnsupportedOperator, match=r"\$elemMatch"):
            await collection.find({"tags": {"$elemMatch": {"$eq": "x"}}}).to_list()

    async def test_un_operateur_de_requete_inconnu_au_niveau_racine_leve(self):
        collection = await _semer("inconnu_racine", [{"id": "1"}])

        with pytest.raises(FakeDbUnsupportedOperator, match=r"\$expr"):
            await collection.find({"$expr": {"$eq": ["$a", "$b"]}}).to_list()

    async def test_un_regex_sur_un_tableau_teste_chaque_element(self):
        """Le cas réel du push matching (`_notify_matching_workers`) : Mongo teste
        la clause sur CHAQUE élément du tableau. Rendre False sur une liste vidait
        la requête de sélection des travailleurs — et avant l'implémentation de
        `$regex`, la clause était simplement ignorée, donc le test de bout en bout
        passait sur une requête qui ne filtrait rien."""
        collection = await _semer("regex_tableau", [
            {"id": "plombier", "specialties": ["plomberie", "chauffage"]},
            {"id": "prof", "specialties": ["mathématiques"]},
        ])

        trouves = await collection.find(
            {"specialties": {"$regex": "^(plomberie|plombier)$", "$options": "i"}}
        ).to_list()

        assert [d["id"] for d in trouves] == ["plombier"]

    async def test_in_accepte_un_motif_dans_la_liste(self):
        """`$in: [/^plomb/, "cours"]` : Mongo traite un motif DANS la liste comme
        une expression. La comparaison littérale ne pouvait jamais correspondre,
        donc la clause était plus stricte qu'en production."""
        collection = await _semer("in_motif", [
            {"id": "1", "title": "Plomberie urgente"},
            {"id": "2", "title": "Cours de mathématiques"},
        ])

        trouves = await collection.find(
            {"title": {"$in": [re.compile("plomb", re.IGNORECASE), "cours"]}}
        ).to_list()

        assert [d["id"] for d in trouves] == ["1"]


@faux_mode_seulement
class TestEcritures:
    async def test_set_on_insert_ne_s_applique_qu_a_l_insertion(self):
        """`created_at` ne se posait JAMAIS : une comparaison « inchangé après
        renvoi » passait donc au vert entre deux clés absentes."""
        collection = _collection("otp")

        resultat = await collection.update_one(
            {"email": "a@kojo.sn"}, {"$setOnInsert": {"created_at": "T0"}}, upsert=True
        )
        premier = await collection.find_one({"email": "a@kojo.sn"})

        await collection.update_one(
            {"email": "a@kojo.sn"}, {"$setOnInsert": {"created_at": "T9"}}, upsert=True
        )
        second = await collection.find_one({"email": "a@kojo.sn"})

        assert premier["created_at"] == "T0"
        assert second["created_at"] == "T0", (
            "$setOnInsert ne doit pas s'appliquer sur un document existant"
        )
        assert resultat.upserted_id is not None

    async def test_upserted_id_est_none_sur_une_mise_a_jour(self):
        """MagicMock fabrique un attribut véridique quand il n'est pas posé : un
        test qui teste `if result.upserted_id:` prenait donc la branche « inséré »
        sur une simple mise à jour."""
        collection = await _semer("upsert_id", [{"id": "1", "status": "pending"}])

        resultat = await collection.update_one(
            {"id": "1"}, {"$set": {"status": "done"}}, upsert=True
        )

        assert resultat.upserted_id is None
        assert resultat.matched_count == 1

    async def test_un_operateur_d_ecriture_inconnu_leve_sans_ecrire(self):
        """Un `$addToSet`/`$pull` ignoré laissait le document intact, donc un test
        « l'élément n'y est plus » passait sur une écriture qui n'avait pas eu
        lieu."""
        collection = await _semer("ecriture_inconnue", [{"id": "1", "tags": ["a"]}])

        for update in ({"$addToSet": {"tags": "b"}}, {"$pull": {"tags": "a"}}):
            with pytest.raises(FakeDbUnsupportedOperator):
                await collection.update_one({"id": "1"}, update)

        intact = await collection.find_one({"id": "1"})
        assert intact["tags"] == ["a"], "une écriture refusée ne doit rien modifier"

    async def test_push_avec_each_leve_au_lieu_de_glisser_le_modificateur(self):
        collection = await _semer("push_each", [{"id": "1", "tags": []}])

        with pytest.raises(FakeDbUnsupportedOperator, match=r"\$each"):
            await collection.update_one({"id": "1"}, {"$push": {"tags": {"$each": ["a", "b"]}}})

    async def test_set_ecrit_un_chemin_pointe(self):
        """`doc.update({"a.b": 1})` créait la clé LITTÉRALE « a.b » : le
        sous-champ interrogé par le code ne bougeait jamais."""
        collection = await _semer("set_pointe", [{"id": "1", "location": {}}])

        await collection.update_one({"id": "1"}, {"$set": {"location.latitude": 14.7}})
        doc = await collection.find_one({"id": "1"})

        assert doc["location"] == {"latitude": 14.7}
        assert "location.latitude" not in doc

    async def test_un_remplacement_remplace_tout_le_document(self):
        """Un update sans opérateur est un REMPLACEMENT pour Mongo. L'ancienne
        FakeDB ne faisait rien et rendait `modified_count=1` : le test voyait un
        succès, le document n'avait pas bougé, et rien ne pouvait le montrer."""
        collection = await _semer("remplacement", [
            {"id": "1", "status": "pending", "temporaire": True},
        ])

        resultat = await collection.update_one({"id": "1"}, {"id": "1", "status": "done"})
        doc = await collection.find_one({"id": "1"})

        assert doc == {"id": "1", "status": "done"}, (
            "un remplacement doit retirer les champs absents du document de remplacement"
        )
        assert resultat.matched_count == 1 and resultat.modified_count == 1

    async def test_inc_garde_un_compteur_entier(self):
        """`$inc` passait tout en `float()` : le solde de parrainage revenait en
        `100.0` au lieu de `100`, donc la réponse JSON de l'API différait de la
        production pour un champ que le client relit."""
        collection = await _semer("inc_type", [{"id": "1", "solde": 50}])

        await collection.update_one({"id": "1"}, {"$inc": {"solde": 50}})
        doc = await collection.find_one({"id": "1"})

        assert doc["solde"] == 100
        assert isinstance(doc["solde"], int), f"entier attendu, obtenu {type(doc['solde'])}"

    async def test_inc_et_push_ecrivent_un_chemin_pointe(self):
        """Même cause que `$set` : `doc["stats.n"]` créait la clé LITTÉRALE
        « stats.n », donc le sous-champ que le code relit ne bougeait jamais."""
        collection = await _semer("inc_pointe", [
            {"id": "1", "stats": {"vues": 1}, "historique": {"etapes": []}},
        ])

        await collection.update_one(
            {"id": "1"},
            {"$inc": {"stats.vues": 2}, "$push": {"historique.etapes": "demande"}},
        )
        doc = await collection.find_one({"id": "1"})

        assert doc["stats"] == {"vues": 3}
        assert doc["historique"] == {"etapes": ["demande"]}
        assert "stats.vues" not in doc and "historique.etapes" not in doc

    async def test_push_sur_un_champ_non_tableau_leve(self):
        """Mongo refuse `$push` sur un champ qui n'est pas un tableau : laisser
        passer laisserait croire que l'écriture a eu lieu."""
        collection = await _semer("push_non_tableau", [{"id": "1", "titre": "texte"}])

        with pytest.raises(FakeDbUnsupportedOperator, match=r"n'est pas un tableau"):
            await collection.update_one({"id": "1"}, {"$push": {"titre": "x"}})

    async def test_update_many_applique_les_memes_operateurs(self):
        """`update_many` avait sa propre copie de l'application : elle divergeait
        dès qu'un opérateur était ajouté à `update_one`."""
        collection = await _semer("update_many", [
            {"id": "1", "status": "pending", "n": 1},
            {"id": "2", "status": "pending", "n": 1},
            {"id": "3", "status": "done", "n": 1},
        ])

        await collection.update_many(
            {"status": "pending"}, {"$set": {"status": "cancelled"}, "$inc": {"n": 1}}
        )
        docs = await collection.find({}).to_list()

        assert [(d["id"], d["status"], d["n"]) for d in docs] == [
            ("1", "cancelled", 2.0), ("2", "cancelled", 2.0), ("3", "done", 1)
        ]


@faux_mode_seulement
class TestTri:
    async def test_le_tri_des_nombres_n_est_pas_lexicographique(self):
        """`key=str(...)` classait « 9 » après « 100 » : `results[0]` pouvait être
        le mauvais document, donc un test « le premier est le plus cher » passait
        sur un ordre que Mongo n'aurait jamais produit."""
        collection = await _semer("tri_nombres", [
            {"id": "petit", "amount": 9},
            {"id": "gros", "amount": 100},
        ])

        decroissant = await collection.find({}).sort("amount", -1).to_list()
        croissant = await collection.find({}).sort("amount", 1).to_list()

        assert [d["id"] for d in decroissant] == ["gros", "petit"]
        assert [d["id"] for d in croissant] == ["petit", "gros"]

    async def test_le_tri_des_dates_iso_est_chronologique(self):
        collection = await _semer("tri_dates", [
            {"id": "aout", "created_at": "2026-08-01T00:00:00+00:00"},
            {"id": "septembre", "created_at": "2026-09-19T00:00:00+00:00"},
        ])

        recents = await collection.find({}).sort("created_at", -1).to_list()

        assert [d["id"] for d in recents] == ["septembre", "aout"]

    async def test_le_tri_des_dates_bson_est_chronologique(self):
        """Une date BSON rangée par `str()` tombait juste par chance entre deux
        décalages identiques, et faux dès qu'une date naïve et une date aware se
        côtoyaient — donc `results[0]` était le mauvais document."""
        collection = await _semer("tri_dates_bson", [
            {"id": "aout", "quand": datetime(2026, 8, 1, tzinfo=timezone.utc)},
            {"id": "septembre", "quand": datetime(2026, 9, 19, tzinfo=timezone.utc)},
        ])

        recents = await collection.find({}).sort("quand", -1).to_list()

        assert [d["id"] for d in recents] == ["septembre", "aout"]

    async def test_le_tri_accepte_un_chemin_pointe(self):
        collection = await _semer("tri_pointe", [
            {"id": "1", "location": {"latitude": 10}},
            {"id": "2", "location": {"latitude": 5}},
        ])

        tries = await collection.find({}).sort("location.latitude", -1).to_list()

        assert [d["id"] for d in tries] == ["1", "2"]

    async def test_le_tri_a_plusieurs_cles_respecte_l_ordre_des_cles(self):
        """Le curseur ne retenait que la PREMIÈRE paire d'un `sort([...])` : la
        seconde clé était ignorée en silence, donc la liste était ordonnée
        autrement qu'en production."""
        collection = await _semer("tri_multi_cles", [
            {"id": "a", "status": "open", "created_at": "2026-08-01"},
            {"id": "b", "status": "open", "created_at": "2026-09-01"},
            {"id": "c", "status": "closed", "created_at": "2026-09-10"},
        ])

        tries = await collection.find({}).sort(
            [("status", 1), ("created_at", -1)]
        ).to_list()

        assert [d["id"] for d in tries] == ["c", "b", "a"]

    async def test_find_one_avec_sort_choisit_par_valeur_numerique(self):
        """`find_one(sort=…)` triait avec `str(...)` — le « paiement le plus
        récent / le plus élevé » de `kojo_routers_jobs` pouvait donc être le
        mauvais document.

        Trois montants choisis pour DISCRIMINER : en décroissant numérique le
        premier est 1000, mais en ordre texte (« 100 » < « 1000 » < « 9 ») c'est
        100 — et en ordre texte décroissant, c'est 9. Un jeu à deux valeurs
        laissait passer les deux fautes.
        """
        collection = await _semer("find_one_sort", [
            {"id": "neuf", "amount": 9},
            {"id": "cent", "amount": 100},
            {"id": "mille", "amount": 1000},
        ])

        dernier = await collection.find_one({}, sort=[("amount", -1)])

        assert dernier["id"] == "mille"

    async def test_skip_s_applique_apres_le_tri(self):
        """La page 2 d'une liste paginée. L'ancien curseur coupait la liste AVANT
        de la trier, donc la page rendue venait de l'ordre d'insertion — un test
        de pagination pouvait passer sur une page que Mongo n'aurait pas rendue."""
        collection = await _semer("pagination", [
            {"id": "1", "created_at": "2026-09-01"},
            {"id": "2", "created_at": "2026-09-02"},
            {"id": "3", "created_at": "2026-09-03"},
            {"id": "4", "created_at": "2026-09-04"},
        ])

        page2 = await collection.find({}).sort("created_at", -1).skip(1).limit(2).to_list()

        assert [d["id"] for d in page2] == ["3", "2"], (
            "skip et limit doivent porter sur la liste TRIÉE"
        )


@faux_mode_seulement
class TestInsertion:
    async def test_insert_one_stocke_l_id_et_refuse_un_doublon(self):
        """Mongo attribue ET range un `_id`, et son index `_id` est unique par
        construction. L'ancienne version rendait un identifiant tiré au hasard
        sans le stocker et acceptait deux documents de même `_id` : un test
        exerçant la branche « doublon » restait vert en local alors que la CI
        (vrai Mongo) l'aurait refusé."""
        collection = _collection("insertion")

        premier = await collection.insert_one({"id": "1"})
        stocke = collection._docs[0]

        assert stocke["_id"] == premier.inserted_id, (
            "l'`_id` rendu doit être celui rangé dans le document"
        )
        with pytest.raises(FakeDbDuplicateKey, match=r"dupliqué"):
            await collection.insert_one({"_id": premier.inserted_id, "id": "2"})

    async def test_l_id_stocke_ne_fuit_pas_dans_les_lectures(self):
        """Le `_id` est rangé mais reste retiré des résultats : la fidélité de
        l'insertion ne doit rien changer à ce que les tests lisent."""
        collection = _collection("insertion_lecture")

        await collection.insert_one({"id": "1"})
        lu = await collection.find_one({"id": "1"})

        assert lu == {"id": "1"}


async def _creer_mission(client, headers, titre, description):
    resp = await client.post("/api/jobs", headers=headers, json={
        "title": titre,
        "description": description,
        "category": "plomberie",
        "budget_min": 10000,
        "budget_max": 30000,
        "location": {"address": "Dakar Plateau", "latitude": 14.69, "longitude": -17.44},
    })
    assert resp.status_code == 200, f"create_job a échoué : {resp.status_code} {resp.text}"
    return resp.json()


async def test_la_recherche_de_missions_exclut_les_non_correspondantes(client):
    """La preuve, par la surface réelle, que le trou `$regex` comptait.

    Avant la correction, la clause était ignorée : `?q=` ramenait TOUTES les
    missions, donc « la recherche trouve la mission » passait sans que rien ne
    filtre. Ici l'assertion porte sur l'EXCLUSION de l'autre mission, ce qu'une
    clause ignorée ne peut pas satisfaire.
    """
    headers = await auth_headers(client, BASE_USER)
    attendue = await _creer_mission(
        client, headers, "Réparation de plomberie à Dakar",
        "Fuite sous l'évier de la cuisine, intervention rapide souhaitée.",
    )
    await _creer_mission(
        client, headers, "Cours particuliers de mathématiques",
        "Soutien scolaire niveau terminale, deux heures par semaine.",
    )

    resp = await client.get("/api/jobs", headers=headers, params={"q": "plomberie"})

    assert resp.status_code == 200, resp.text
    corps = resp.json()
    missions = corps["jobs"] if isinstance(corps, dict) else corps
    identifiants = [m["id"] for m in missions]
    assert identifiants == [attendue["id"]], (
        f"la recherche « plomberie » doit ne ramener que la mission de plomberie, "
        f"elle a ramené {len(identifiants)} mission(s)"
    )


async def test_la_recherche_porte_aussi_sur_la_description(client):
    """Le `$or` titre/description de la production : le trou était dans CHAQUE
    branche de l'`$or`, donc le filtre disparaissait entièrement."""
    headers = await auth_headers(client, BASE_USER)
    attendue = await _creer_mission(
        client, headers, "Intervention rapide",
        "Recherche d'un spécialiste en soudure pour une rampe métallique.",
    )
    await _creer_mission(
        client, headers, "Cours particuliers",
        "Soutien scolaire niveau terminale, deux heures par semaine.",
    )

    resp = await client.get("/api/jobs", headers=headers, params={"q": "soudure"})

    assert resp.status_code == 200, resp.text
    corps = resp.json()
    missions = corps["jobs"] if isinstance(corps, dict) else corps
    assert [m["id"] for m in missions] == [attendue["id"]]
