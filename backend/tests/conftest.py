"""
Fixtures partagées pour la suite de tests Kojo.

DEUX MODES DE BASE DE DONNÉES :

1. Par défaut (local, sans Docker) : une fausse base en mémoire (FakeDB) qui
   reproduit un sous-ensemble de l'API Motor. Rapide et hermétic.

2. Vrai MongoDB : définir la variable d'environnement TEST_MONGO_URL
   (ex: mongodb://localhost:27017) pour exécuter la SUITE COMPLÈTE contre une
   vraie instance Mongo (mode utilisé en CI via un service container, et
   recommandé localement avec Docker : `docker run -d -p 27017:27017 mongo`).

Le but du mode réel : éviter les faux positifs de la FakeDB (atomicité,
indexes, agrégations). Les helpers `db_insert` / `db_find` abstraient la
différence pour les tests qui manipulent des documents directement.

Ce que la FakeDB applique et ce qu'elle REFUSE (audit du 19/09/2026) :

  * requêtes : égalité (sous-document = égalité EXACTE), chemins POINTÉS,
    `$ne`, `$in`, `$nin`, `$exists`, `$gt`/`$gte`/`$lt`/`$lte` (comparaison
    typée),    `$regex` + `$options`, `$or`, `$and`, `$geoWithin`/`$centerSphere` ;
  * écritures : `$set` (chemins pointés compris), `$setOnInsert` (chemin upsert
    uniquement), `$unset`, `$inc` et `$push` (chemins pointés compris, type
    numérique préservé), et le REMPLACEMENT (document sans opérateur) ;
  * tri : à clés MULTIPLES, chacune avec son sens, comparaison NUMÉRIQUE des
    nombres et lexicographique des chaînes (les dates du dépôt sont des chaînes
    ISO, donc l'ordre y est chronologique) ;
  * curseur : `sort` puis `skip` puis `limit`, dans cet ordre (celui de Mongo) ;
  * `insert_one` attribue et STOCKE un `_id`, et refuse un `_id` dupliqué
    (`FakeDbDuplicateKey`) : l'index `_id` de Mongo est unique sans que
    `create_index` ait à le déclarer.

Tout opérateur HORS de ces listes lève `FakeDbUnsupportedOperator`. C'est
volontaire : un opérateur ignoré en silence rend la requête plus permissive
qu'en production (« la recherche trouve X » passe sans que rien ne filtre) ou
fait disparaître une écriture (« le champ n'y est plus » passe sur un champ que
le code devait poser). Exemples trouvés par cet audit : `$regex` (3
clauses réelles dans la recherche de missions), `$setOnInsert` (le `created_at`
d'un code OTP), `skip` appliqué AVANT le tri (donc toute page 2 d'une liste
paginée), `find_one(sort=…)` trié au TEXTE (le « paiement le plus récent » de
`kojo_routers_jobs`), `$inc` qui rendait `100.0` là où Mongo écrit `100`, et un
update par REMPLACEMENT sans effet tout en rendant `modified_count=1`.

Divergences CONNUES, non corrigées : les indexes uniques DÉCLARÉS
(`create_index(..., unique=True)` : `email`, `id`, `google_sub`, la paire
`(email, purpose)` des OTP, `(job_id, reviewer_id)` des avis) ne sont PAS
appliqués — seul `_id` l'est ; le `_id` attribué est une CHAÎNE (uuid4) là où
Mongo pose un `ObjectId` : les lectures qui l'exposent portent donc ici un texte,
même si les deux modes s'accordent depuis qu'il est INCLUS dans les résultats ;
les agrégations (`aggregate`),
`find_one_and_update`, `bulk_write`, `distinct`, `insert_many` et `replace_one`
n'existent pas, donc leur emploi lève une AttributeError bruyante plutôt qu'un
résultat faux (vérifié : aucun de ces appels dans `backend/` hors tests).
"""
import asyncio
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# ---------------------------------------------------------------------------
# Variables d'env AVANT tout import de server.py
# ---------------------------------------------------------------------------
TEST_MONGO_URL = os.environ.get("TEST_MONGO_URL", "").strip()
USE_REAL_MONGO = bool(TEST_MONGO_URL)

os.environ["JWT_SECRET"] = "test-secret-kojo-pytest-only-32chars!!"
os.environ["EMAIL_OTP_SECRET"] = "test-otp-secret-kojo-pytest-32chars!!"
if USE_REAL_MONGO:
    os.environ["MONGO_URL"] = TEST_MONGO_URL
else:
    os.environ["MONGO_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "kojo_test"
os.environ["APP_ENV"] = "test"
os.environ["REDIS_URL"] = ""
os.environ["DISABLE_TRUSTED_HOST_MIDDLEWARE"] = "true"
# Aucun envoi d'email réel pendant les tests (code OTP généré mais non envoyé).
os.environ["EMAIL_PROVIDER"] = "none"

# Code OTP déterministe utilisé par les tests (le backend estime que le code
# a été envoyé par email ; ici on le connaît d'avance).
TEST_OTP_CODE = "123456"


# ---------------------------------------------------------------------------
# FakeCollection et FakeDB (mode local sans MongoDB)
# ---------------------------------------------------------------------------

def _unset_path(doc: Dict, path: str) -> None:
    """Retire un chemin pointé (« location.latitude »), comme `$unset` de Mongo :
    la CLÉ disparaît du document (ce n'est pas une mise à None).

    Sans ce support, la FakeDB ignorait `$unset` en silence : une écriture qui
    efface des champs ne changeait rien, et le test qui la vérifie échouait pour
    une raison qui n'existait qu'en local — ou pire, passait si l'assertion
    portait sur l'absence et que le champ n'avait jamais été posé.
    """
    parts = path.split(".")
    current: Any = doc
    for part in parts[:-1]:
        current = current.get(part) if isinstance(current, dict) else None
        if not isinstance(current, dict):
            return
    current.pop(parts[-1], None)


class _Absent:
    """Sentinelle : « ce chemin n'existe pas », distinct d'un None stocké."""

    def __repr__(self):
        return "<absent>"


_ABSENT = _Absent()


def _get_path(doc: Dict, path: str, sentinelle: Any = None) -> Any:
    """Valeur d'un chemin POINTÉ (« location.latitude »), comme Mongo la lit.

    La lecture littérale (`doc.get("location.latitude")`) rend toujours None :
    toute clause visant un sous-champ ne pouvait donc jamais correspondre, ce qui
    rend le filtre plus strict qu'en production (l'inverse de l'opérateur
    ignoré, mais tout aussi faux).
    """
    courant: Any = doc
    for part in path.split("."):
        if not isinstance(courant, dict) or part not in courant:
            return sentinelle
        courant = courant[part]
    return courant


def _set_path(doc: Dict, path: str, valeur: Any) -> None:
    """Écrit un chemin pointé en créant les sous-documents intermédiaires,
    comme `$set: {"a.b": 1}` en production (sinon la clé "a.b" littérale est
    créée, et le sous-champ que le code interroge ne bouge jamais)."""
    parts = path.split(".")
    courant = doc
    for part in parts[:-1]:
        suivant = courant.get(part)
        if not isinstance(suivant, dict):
            suivant = {}
            courant[part] = suivant
        courant = suivant
    courant[parts[-1]] = valeur


def _push_path(doc: Dict, path: str, valeur: Any) -> None:
    """`$push` sur un CHEMIN pointé (« stats.vues »).

    L'ancien code faisait `doc.setdefault(cle, []).append(...)` avec la clé
    LITTÉRALE : un `$push` sur `a.b` créait une clé `"a.b"` à côté du
    sous-document, donc le tableau que le code relit (`doc["a"]["b"]`) restait
    inchangé alors que l'écriture était « passée ».
    """
    existant = _get_path(doc, path, sentinelle=_ABSENT)
    if existant is _ABSENT:
        _set_path(doc, path, [valeur])
    elif isinstance(existant, list):
        existant.append(valeur)
    else:
        # Mongo refuse `$push` sur un champ qui n'est pas un tableau.
        raise FakeDbUnsupportedOperator(
            f"$push sur {path!r} : ce champ existe et n'est pas un tableau"
        )


def _inc_path(doc: Dict, path: str, valeur: Any) -> None:
    """`$inc` sur un CHEMIN pointé, en PRÉSERVANT le type numérique.

    Deux divergences silencieuses ici : la clé littérale (même cause que
    `$push`) et le `float()` systématique, qui transformait un compteur entier
    en `100.0` — un test comparant un solde ou un compteur passait, et la
    réponse JSON de l'API différait de la production (`100.0` au lieu de `100`).
    """
    existant = _get_path(doc, path, sentinelle=_ABSENT)
    if existant is _ABSENT:
        _set_path(doc, path, valeur)  # Mongo crée le champ avec l'incrément
        return
    est_nombre = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if not (est_nombre(existant) and est_nombre(valeur)):
        raise FakeDbUnsupportedOperator(
            f"$inc sur {path!r} : {existant!r} n'est pas un nombre (Mongo refuse)"
        )
    if isinstance(existant, int) and isinstance(valeur, int):
        _set_path(doc, path, existant + valeur)   # entier + entier = entier
    else:
        _set_path(doc, path, float(existant) + float(valeur))


def _vers_utc(valeur: datetime) -> datetime:
    """Un `datetime` SANS fuseau est lu comme UTC : Mongo stocke des dates BSON
    sans fuseau, et comparer un naïf avec un aware lève un TypeError que
    l'appelant interprète comme « aucun match » (donc une purge muette)."""
    return valeur if valeur.tzinfo else valeur.replace(tzinfo=timezone.utc)


def _compare(doc_val: Any, op_val: Any, op: str) -> bool:
    """Comparaison ordonnée, TYPÉE comme Mongo : deux nombres se comparent,
    deux chaînes aussi (les dates de ce dépôt sont des chaînes ISO, donc
    l'ordre lexicographique y est chronologique), et deux types différents ne
    matchent pas.

    L'ancienne version ne connaissait que `$gte`, en passant par `float()` :
    composer une plage `$gte` + `$lte` laissait la borne haute ignorée (donc
    plus de résultats qu'en production), et comparer des dates ISO levait un
    TypeError interprété comme « aucun match ».
    """
    est_nombre = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if est_nombre(doc_val) and est_nombre(op_val):
        gauche, droite = float(doc_val), float(op_val)
    elif isinstance(doc_val, str) and isinstance(op_val, str):
        gauche, droite = doc_val, op_val
    elif isinstance(doc_val, datetime) and isinstance(op_val, datetime):
        # Les MODÈLES écrivent de vraies dates (`Message.timestamp`,
        # `SupportTicket.created_at`, `User.created_at`), pas des chaînes ISO :
        # sans cette branche, toute plage sur une date BSON rendait False, donc
        # la purge de conservation ne trouvait jamais rien à supprimer — un
        # faux vert silencieux de plus.
        gauche, droite = _vers_utc(doc_val), _vers_utc(op_val)
    else:
        return False
    if op == "$gt":
        return gauche > droite
    if op == "$gte":
        return gauche >= droite
    if op == "$lt":
        return gauche < droite
    return gauche <= droite


def _regex(valeur: Any, motif: Any, options: str) -> bool:
    """`$regex` + `$options`, ignorés en silence jusqu'ici.

    Une clause `$regex` ignorée rendait la REQUÊTE ENTIÈRE plus permissive :
    `GET /jobs?q=...` ramenait tout, donc un test « la recherche trouve cette
    mission » passait sans que la recherche ne filtre quoi que ce soit.

    Deux détails de Mongo sont respectés ici : un champ TABLEAU est testé
    élément par élément, et un motif déjà compilé garde ses propres drapeaux.
    Les deux cas ont un site d'appel réel (`_notify_matching_workers` pour le
    tableau, `$in` pour un motif dans une liste).
    """
    if isinstance(valeur, list):
        # Mongo applique la clause à un champ TABLEAU en la testant sur CHAQUE
        # élément : `{"specialties": {"$regex": "^plomberie$"}}` matche un
        # profil dont la liste contient « plomberie » — cas réel du push matching
        # de `_notify_matching_workers`. Rendre False sur une liste vidait cette
        # requête, et le repli « même pays » ne la rattrapait pas toujours (le
        # job n'a pas de pays).
        return any(_regex(element, motif, options) for element in valeur)
    drapeaux = 0
    if isinstance(motif, re.Pattern):
        # Un motif DÉJÀ compilé porte ses propres drapeaux (`re.compile("x", re.I)`)
        # et Mongo les honore : les perdre rendait `$in: [/plomb/i]` toujours faux.
        drapeaux |= motif.flags
        motif = motif.pattern
    if not isinstance(motif, str) or not isinstance(valeur, str):
        return False  # Mongo n'applique une expression qu'aux chaînes
    for lettre, drapeau in (
        ("i", re.IGNORECASE), ("m", re.MULTILINE),
        ("s", re.DOTALL), ("x", re.VERBOSE),
    ):
        if lettre in (options or ""):
            drapeaux |= drapeau
    try:
        return re.search(motif, valeur, drapeaux) is not None
    except re.error:
        return False


def _dans_la_sphere(doc_val: Any, op_val: Any) -> bool:
    """$geoWithin / $centerSphere en haversine (Mongo, lui, utilise l'index
    2dsphere). Document de recherche : {type: Point, coordinates: [lng, lat]}."""
    import math

    centre = op_val.get("$centerSphere") if isinstance(op_val, dict) else None
    if not centre or len(centre) != 2:
        return False
    doc_coords = doc_val.get("coordinates") if isinstance(doc_val, dict) else None
    if not doc_coords or len(doc_coords) != 2:
        return False
    emplacement, rayon_radians = centre
    lat1, lng1 = float(emplacement[1]), float(emplacement[0])
    lat2, lng2 = float(doc_coords[1]), float(doc_coords[0])
    to_rad = lambda d: d * math.pi / 180.0
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2
         + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2)
    distance_km = 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return distance_km <= rayon_radians * 6371.0


def _cle_de_tri(valeur: Any):
    """Clé de tri qui ne compare pas des nombres comme du texte.

    `sorted(key=str(doc.get(champ, "")))` classait « 9 » après « 100 », donc
    `results[0]` pouvait être le mauvais document — un test qui affirme « le
    premier est le plus récent / le plus cher » passait alors sur un tri que
    Mongo n'aurait jamais produit. L'ordre des types est APPROXIMATIF (Mongo
    place Booléen et Date après les chaînes) : ce qui est exact ici, c'est que
    deux nombres se comparent en nombres et deux chaînes en chaînes, ce qui
    couvre les tris réels du dépôt (montants, dates ISO).
    """
    if valeur is None:
        return (0, 0.0, "")
    if isinstance(valeur, bool):
        return (1, float(valeur), "")
    if isinstance(valeur, (int, float)):
        return (2, float(valeur), "")
    if isinstance(valeur, str):
        return (3, 0.0, valeur)
    if isinstance(valeur, datetime):
        # Un tri sur une date BSON doit être chronologique : la branche
        # précédente (`str(valeur)`) tombait juste pour des chaînes ISO à
        # décalage identique, et faux dès que deux dates naïves et aware se
        # côtoyaient.
        return (2, _vers_utc(valeur).timestamp(), "")
    return (4, 0.0, str(valeur))


def _spec_de_tri(sort: Any) -> List:
    """Normalise un `sort` de Mongo : `"champ"`, `("champ", -1)` ou
    `[("a", 1), ("b", -1)]`."""
    if not sort:
        return []
    if isinstance(sort, str):
        return [(sort, 1)]
    entrees = list(sort)
    if entrees and isinstance(entrees[0], str):
        if len(entrees) == 2 and isinstance(entrees[1], int):
            return [(entrees[0], entrees[1])]
        return [(entrees[0], 1)]
    return [(champ, sens) for champ, sens in entrees]


def _trie_multi(docs: List[Dict], spec: List) -> List[Dict]:
    """Tri à clés MULTIPLES, chacune avec son sens.

    Deux divergences silencieuses corrigées : `find_one(sort=…)` triait avec
    `str(valeur)` (donc « 9 » après « 100 »), et le curseur ne retenait que la
    PREMIÈRE paire d'un `sort([("a", 1), ("b", -1)])`, laissant le reste dans
    l'ordre d'insertion. Un test « le premier est le plus récent / le plus
    élevé » pouvait donc passer sur un document que Mongo n'aurait pas rendu.

    Le tri de Python étant STABLE, appliquer les clés de la DERNIÈRE à la
    première reproduit exactement l'ordre lexicographique par clés de Mongo.
    """
    resultat = list(docs)
    for champ, sens in reversed(list(spec)):
        resultat.sort(
            key=lambda d, champ=champ: _cle_de_tri(_get_path(d, champ)),
            reverse=(sens == -1),
        )
    return resultat


def _applique_ecriture(doc: Dict, update: Dict, sur_insertion: bool = False) -> None:
    """Applique un update Mongo à UN document.

    `sur_insertion` distingue le chemin upsert : `$setOnInsert` ne s'applique
    QUE là (c'est sa définition). L'ignorer laissait `created_at` absent du
    document créé, ce qui faisait par exemple passer au vert un test comparant
    `created_at` AVANT et APRÈS un renvoi de code : deux clés absentes sont
    égales.
    """
    if not update:
        raise FakeDbUnsupportedOperator(
            "document de mise à jour vide : Mongo le refuse (l'ancienne FakeDB "
            "rendait matched_count=1 sans rien écrire)"
        )
    if not any(cle.startswith("$") for cle in update):
        # REMPLACEMENT : Mongo remplace TOUT le document sauf `_id`. Sans cette
        # branche, la FakeDB ne faisait RIEN tout en rendant matched_count=1 et
        # modified_count=1 : le plus coûteux des faux verts, puisque l'appelant
        # voyait un succès et que rien, dans le test, ne pouvait le voir.
        identifiant = doc.get("_id", _ABSENT)
        if "_id" in update and identifiant is not _ABSENT and update["_id"] != identifiant:
            raise FakeDbUnsupportedOperator("un remplacement ne peut pas changer `_id`")
        doc.clear()
        doc.update(update)
        if identifiant is not _ABSENT:
            doc["_id"] = identifiant
        return
    inconnus = sorted(
        cle for cle in update if cle.startswith("$") and cle not in OPERATEURS_D_ECRITURE
    )
    if inconnus:
        raise FakeDbUnsupportedOperator(
            f"opérateur d'écriture non implémenté : {inconnus} (Mongo l'applique, "
            f"la FakeDB non — un test passerait sur une écriture qui n'a pas eu lieu)"
        )
    if "$set" in update:
        for cle, valeur in update["$set"].items():
            _set_path(doc, cle, valeur)
    if sur_insertion and "$setOnInsert" in update:
        for cle, valeur in update["$setOnInsert"].items():
            _set_path(doc, cle, valeur)
    if "$unset" in update:
        for cle in update["$unset"]:
            _unset_path(doc, cle)
    if "$inc" in update:
        for cle, valeur in update["$inc"].items():
            _inc_path(doc, cle, valeur)
    if "$push" in update:
        for cle, valeur in update["$push"].items():
            if isinstance(valeur, dict) and "$each" in valeur:
                raise FakeDbUnsupportedOperator(
                    "$push avec $each n'est pas implémenté : l'ajouter tel quel "
                    "glisserait le modificateur comme ÉLÉMENT du tableau"
                )
            _push_path(doc, cle, valeur)


class FakeDbUnsupportedOperator(NotImplementedError):
    """Opérateur Mongo que la FakeDB n'applique pas.

    Lever est le SEUL choix sûr : un opérateur ignoré en silence rend la requête
    plus permissive qu'en production (elle ramène tout, donc un test « la
    recherche trouve X » passe sans rien prouver) ou fait disparaître une
    écriture (donc un test « le champ n'y est plus » passe sur un champ que le
    code devait poser). Les deux verstes vertes sans cause sont pires qu'un
    échec : c'est exactement ce qui s'était produit avec `$unset`.
    """


class FakeDbDuplicateKey(ValueError):
    """Violation d'unicité, comme `pymongo.errors.DuplicateKeyError`.

    L'index `_id` existe TOUJOURS dans Mongo et il est unique, sans qu'aucun
    `create_index` n'ait à le déclarer : deux documents de même `_id` sont donc
    refusés ici comme en production.
    """


# Opérateurs de requête et d'écriture que cette FakeDB APPLIQUE. Ce qui n'est
# pas ici lève, au lieu d'être ignoré (voir FakeDbUnsupportedOperator).
OPERATEURS_DE_REQUETE = frozenset({
    "$ne", "$in", "$nin", "$exists", "$gt", "$gte", "$lt", "$lte",
    "$regex", "$geoWithin",
})
OPERATEURS_D_ECRITURE = frozenset({
    "$set", "$setOnInsert", "$unset", "$inc", "$push",
})


class FakeCollection:
    def __init__(self):
        self._docs: List[Dict] = []

    def _match(self, query: Dict, doc: Dict) -> bool:
        for key, value in query.items():
            if key == "$or":
                if not any(self._match(sub, doc) for sub in value):
                    return False
            elif key == "$and":
                if not all(self._match(sub, doc) for sub in value):
                    return False
            elif key.startswith("$"):
                raise FakeDbUnsupportedOperator(
                    f"opérateur de requête non implémenté : {key!r} (clause {value!r})"
                )
            elif isinstance(value, dict) and any(
                operateur.startswith("$") for operateur in value
            ):
                # Chemin POINTÉ (`location.latitude`) comme le vrai Mongo : une
                # lecture littérale de la clé ne correspondrait jamais, donc la
                # clause `$exists`/`$ne` sur un sous-champ ferait silencieusement
                # zéro match (cas réel : le backfill géo de kojo_core).
                doc_val = _get_path(doc, key)
                for op, op_val in value.items():
                    if op == "$options":
                        continue  # consommé par $regex, comme dans Mongo
                    if op not in OPERATEURS_DE_REQUETE:
                        raise FakeDbUnsupportedOperator(
                            f"opérateur de requête non implémenté : {op!r} "
                            f"(clause {key!r})"
                        )
                    if not self._satisfait(op, op_val, doc_val, value, key, doc):
                        return False
            else:
                # Sous-document SANS opérateur : Mongo exige l'ÉGALITÉ EXACTE du
                # sous-document. L'ancienne lecture traitait ses clés comme des
                # opérateurs, donc la clause était ignorée — plus permissive
                # qu'en production.
                if _get_path(doc, key) != value:
                    return False
        return True

    def _satisfait(self, op, op_val, doc_val, clause, key, doc) -> bool:
        """Une clause unitaire : Mongo la satisfait, ou non."""
        if op == "$ne":
            return doc_val != op_val
        if op in ("$in", "$nin"):
            # Un motif `re.Pattern` DANS une liste est une expression pour Mongo
            # (`$in: [/^a/, "b"]`) ; la comparaison littérale de l'ancienne
            # version ne pouvait jamais correspondre, donc la clause était plus
            # STRICTE qu'en production.
            appartient = any(
                _regex(doc_val, membre, "") if isinstance(membre, re.Pattern)
                else doc_val == membre
                for membre in op_val
            )
            return appartient if op == "$in" else not appartient
        if op == "$exists":
            # `$exists` porte sur le CHEMIN réellement présent, pas sur une clé
            # littérale : `_get_path` rend None, d'où le test explicite ci-dessous.
            present = _get_path(doc, key, sentinelle=_ABSENT) is not _ABSENT
            return present if op_val else not present
        if op in ("$gt", "$gte", "$lt", "$lte"):
            return _compare(doc_val, op_val, op)
        if op == "$regex":
            return _regex(doc_val, op_val, clause.get("$options", ""))
        if op == "$geoWithin":
            return _dans_la_sphere(doc_val, op_val)
        raise FakeDbUnsupportedOperator(f"opérateur de requête non implémenté : {op!r}")

    def _project(self, doc: Dict, projection: Optional[Dict]) -> Dict:
        """Projection fidèle à Mongo : `_id` est INCLUS sauf exclusion explicite.

        L'ancienne version le retirait TOUJOURS. Ce n'était pas neutre :
        `find_one({"id": …}, {"deleted": 1})` rendait `{}` (un document vide est
        falsy), donc la garde anti-notification-orpheline de
        `kojo_shared.notify_user` (« destinataire absent ») sortait AVANT
        d'écrire quoi que ce soit — la fonctionnalité de notification était
        INERTE en local alors qu'elle fonctionne en CI (Mongo réel, qui inclut
        `_id`) : la suite ne disait pas la même chose des deux côtés.
        """
        if not projection:
            return dict(doc)
        include = {k for k, v in projection.items() if v and k != "_id"}
        exclude = {k for k, v in projection.items() if not v}
        garder_identifiant = {"_id"} if projection.get("_id", 1) else set()
        if include:
            return {k: v for k, v in doc.items() if k in include | garder_identifiant}
        return {k: v for k, v in doc.items() if k not in exclude | (set() if garder_identifiant else {"_id"})}

    async def find_one(self, query=None, projection=None, sort=None):
        """find_one avec tri optionnel (utilisé par ex. par la clôture de
        mission pour retrouver le paiement le plus récent).
        Accepte sort="field" ou sort=[("field", -1)] comme le vrai Mongo."""
        query = query or {}
        matches = [d for d in self._docs if self._match(query, d)]
        if sort:
            # Le tri passe par `_trie_multi` (clés multiples, clé numérique) :
            # l'ancien `str(d.get(sort_key, ""))` classait « 9 » après « 100 »,
            # donc le « paiement le plus récent » pouvait être le mauvais.
            matches = _trie_multi(matches, _spec_de_tri(sort))
        if not matches:
            return None
        return self._project(matches[0], projection)

    def find(self, query=None, projection=None):
        query = query or {}
        results = [self._project(d, projection) for d in self._docs if self._match(query, d)]
        return FakeCursor(results)

    async def insert_one(self, doc: Dict):
        """Mongo attribue ET STOCKE un `_id` (index unique par construction).

        L'ancienne version rendait un `inserted_id` tiré au hasard sans jamais
        le ranger, et acceptait deux documents de même `_id` : un test qui
        exerçait la branche « doublon » restait vert en local alors que la CI
        (vrai Mongo) l'aurait refusé. Le `_id` stocké ne change aucun résultat,
        puisque `_project` le retire des lectures.
        """
        entre = dict(doc)
        identifiant = entre.setdefault("_id", str(uuid.uuid4()))
        if any(existant.get("_id", _ABSENT) == identifiant for existant in self._docs):
            raise FakeDbDuplicateKey(
                f"`_id` dupliqué : {identifiant!r} (l'index `_id` de Mongo est unique)"
            )
        self._docs.append(entre)
        result = MagicMock()
        result.inserted_id = identifiant
        return result

    async def update_one(self, query: Dict, update: Dict, upsert: bool = False):
        for doc in self._docs:
            if self._match(query, doc):
                _applique_ecriture(doc, update)
                result = MagicMock()
                result.matched_count = 1
                result.modified_count = 1
                # `upserted_id` est posé EXPLICITEMENT : sans cela, MagicMock
                # fabrique un attribut véridique, et un test qui teste
                # `if result.upserted_id:` prendrait silencieusement la branche
                # « inséré » sur une mise à jour.
                result.upserted_id = None
                return result
        result = MagicMock()
        result.matched_count = 0
        result.modified_count = 0
        result.upserted_id = None
        if upsert:
            # Mongo construit le document depuis les égalités de la requête,
            # puis $set / $setOnInsert / $inc. `$setOnInsert` est le propre du
            # chemin insert : c'est ici, et seulement ici, qu'il s'applique.
            new_doc = {k: v for k, v in query.items() if not k.startswith("$")}
            _applique_ecriture(new_doc, update, sur_insertion=True)
            # Mongo attribue TOUJOURS un `_id` au document inséré : sans cela
            # `upserted_id` valait None sur un vrai insert, et le seul moyen de
            # distinguer « inséré » de « mis à jour » disparaissait.
            new_doc.setdefault("_id", str(uuid.uuid4()))
            self._docs.append(new_doc)
            result.upserted_id = new_doc["_id"]
        return result

    async def delete_one(self, query: Dict):
        for i, doc in enumerate(self._docs):
            if self._match(query, doc):
                self._docs.pop(i)
                result = MagicMock()
                result.deleted_count = 1
                return result
        result = MagicMock()
        result.deleted_count = 0
        return result

    async def update_many(self, query: Dict, update: Dict):
        """Met à jour tous les documents correspondants (utilisé par
        l'acceptation de proposition pour rejeter les autres)."""
        matched = 0
        for doc in self._docs:
            if not self._match(query, doc):
                continue
            matched += 1
            _applique_ecriture(doc, update)
        result = MagicMock()
        result.matched_count = matched
        result.modified_count = matched
        return result

    async def delete_many(self, query: Dict):
        before = len(self._docs)
        self._docs = [d for d in self._docs if not self._match(query, d)]
        result = MagicMock()
        result.deleted_count = before - len(self._docs)
        return result

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for d in self._docs if self._match(query, d))

    async def create_index(self, *args, **kwargs):
        pass

    def reset(self):
        self._docs.clear()


class FakeCursor:
    def __init__(self, docs: List[Dict]):
        self._docs = list(docs)
        self._sort_spec: List = []
        self._skip = 0
        self._limit = None

    def sort(self, key_or_list, direction=1):
        # Accepte sort("field", -1) et sort([("a", 1), ("b", -1)]) : l'ancienne
        # version ne retenait que la PREMIÈRE paire et ignorait le reste.
        if isinstance(key_or_list, str):
            self._sort_spec = [(key_or_list, direction)]
        else:
            self._sort_spec = _spec_de_tri(key_or_list)
        return self

    def skip(self, n):
        # `skip`/`limit` sont DIFFÉRÉS : Mongo les applique APRÈS le tri.
        # L'ancienne version coupait la liste AVANT de la trier, donc
        # `find(...).sort("created_at", -1).skip(10)` — la page 2 d'une liste
        # paginée — rendait une page prise dans l'ordre d'insertion.
        self._skip = int(n or 0)
        return self

    def limit(self, n):
        self._limit = n or None
        return self

    def _resultats(self):
        docs = _trie_multi(self._docs, self._sort_spec) if self._sort_spec else list(self._docs)
        if self._skip:
            docs = docs[self._skip:]
        if self._limit:
            docs = docs[:self._limit]
        return docs

    async def to_list(self, length=None):
        docs = self._resultats()
        return docs[:length] if length else docs

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for doc in self._resultats():
            yield doc


class FakeDB:
    def __init__(self):
        self._collections: Dict[str, FakeCollection] = {}

    def __getattr__(self, name: str) -> FakeCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = FakeCollection()
        return self._collections[name]

    def __getitem__(self, name: str) -> FakeCollection:
        # Miroir de AsyncIOMotorDatabase.__getitem__ (db["collection"]) —
        # utilisé par la persistance du circuit breaker (kojo_payments).
        return self.__getattr__(name)

    async def command(self, cmd):
        return {"ok": 1}

    def reset_all(self):
        for col in self._collections.values():
            col.reset()


fake_db = FakeDB()

# ---------------------------------------------------------------------------
# Import de server.py (après les env vars)
# ---------------------------------------------------------------------------
if USE_REAL_MONGO:
    # Vrai MongoDB : aucun patch Motor, la connexion pointe sur la vraie base.
    import server as _srv
else:
    # Mode FakeDB : on remplace `db` AVANT que quiconque ne lie le nom.
    #
    # Le nom `db` appartient a `kojo_db` (c'est lui qui cree le client Motor),
    # et ses lecteurs le lient a l'import : les routeurs et les services par
    # `from kojo_core import db`, les modules extraits de `kojo_core` par
    # `from kojo_db import db`. La doublure se pose donc LA, avant `import
    # kojo_core` — sinon ces derniers garderaient la reference au client Motor
    # patche, qui ne repond a rien. `kojo_core.db` est repose aussi pour que
    # l'alias de la facade reste coherent avec sa source.
    #
    # `tests/test_core_db_seam.py` verifie le resultat : tout module charge qui
    # expose `db` doit exposer CETTE doublure.
    with patch("motor.motor_asyncio.AsyncIOMotorClient"):
        import kojo_db as _kojo_db
        _kojo_db.db = fake_db
        import kojo_core as _core
        _core.db = fake_db
        import server as _srv

# ---------------------------------------------------------------------------
# Helpers d'accès DB (compatibles FakeDB / vrai MongoDB)
# ---------------------------------------------------------------------------

async def db_insert(collection: str, doc: Dict):
    """Insère un document dans la collection donnée (mode indifférent).

    Passe par `insert_one` dans les DEUX modes : c'est ce qui attribue `_id`.
    En mode FakeDB, l'ancienne version ajoutait le document à `_docs` sans
    passer par l'insertion, donc sans `_id` — là où Mongo en pose toujours un.
    Conséquence mesurée le 21/09/2026 : un test de la suppression d'une
    notification passait sous FakeDB (document sans `_id`) et aurait échoué
    sous un vrai Mongo (document avec `_id`), donc la doublure ne disait pas la
    même chose que la base — et la suite qui mesure cet écart
    (`test_fake_db_fidelity.py`) ne s'exécute qu'avec un Mongo réel. Utiliser
    l'insertion fait aussi respecter l'unicité de `_id` dans les deux modes.
    """
    if USE_REAL_MONGO:
        await _srv.db[collection].insert_one(dict(doc))
    else:
        await getattr(fake_db, collection).insert_one(dict(doc))


async def db_upsert(collection: str, query: Dict, update: Dict):
    """Upsert (update_one avec upsert=True) dans la collection donnée
    (mode indifférent). Évite les DuplicateKeyError en mode réel quand le
    document existe déjà (ex: le circuit breaker _id="global" ré-inséré par
    une tâche de fond)."""
    if USE_REAL_MONGO:
        await _srv.db[collection].update_one(query, update, upsert=True)
    else:
        await getattr(fake_db, collection).update_one(query, update, upsert=True)


async def db_find_one(collection: str, query: Dict) -> Optional[Dict]:
    """find_one dans la collection donnée (mode indifférent)."""
    if USE_REAL_MONGO:
        return await _srv.db[collection].find_one(query)
    return await getattr(fake_db, collection).find_one(query)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(autouse=True)
async def reset_state():
    # Le rate-limiter (mémoire, REDIS_URL vide) est partagé sur toute la
    # session ; on vide ses compteurs à chaque test pour éviter des 429
    # fantômes (buckets auth-otp 12/5min et auth-session 20/5min) en mode
    # réel comme en mode FakeDB.
    _srv.request_counts.clear()
    # Le circuit breaker PayDunya a un état EN MÉMOIRE (kojo_payments) en plus
    # du doc persisté en base : sans reset, un test qui adopte un circuit open
    # en base le laisse en mémoire pour les tests suivants (fraîcheur : un
    # circuit ouvert en mémoire n'est pas écrasé par une base vide/fermée).
    try:
        import kojo_payments
        kojo_payments._paydunya_circuit.update({"state": "closed", "consecutive_failures": 0, "opened_at": 0.0})
    except Exception:
        pass
    if USE_REAL_MONGO:
        await _srv.db.client.drop_database(_srv.db.name)
    else:
        fake_db.reset_all()
    yield
    _srv.request_counts.clear()
    try:
        import kojo_payments
        kojo_payments._paydunya_circuit.update({"state": "closed", "consecutive_failures": 0, "opened_at": 0.0})
    except Exception:
        pass
    if USE_REAL_MONGO:
        await _srv.db.client.drop_database(_srv.db.name)


@pytest_asyncio.fixture
async def client():
    """Client HTTP branché directement sur l'app ASGI.
    La validation de response_model est désactivée pour que les données
    retournées par la FakeDB (potentiellement incomplètes vs. le vrai Mongo)
    ne déclenchent pas des 422 lors de la sérialisation FastAPI.
    """
    for route in getattr(_srv.api_router, "routes", []):
        if hasattr(route, "response_model") and route.response_model is not None:
            route.response_model = None
    async with AsyncClient(
        transport=ASGITransport(app=_srv.app),
        base_url="http://test"
    ) as ac:
        yield ac


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_USER = {
    "email": "test@kojo.sn",
    "password": "password123",
    "first_name": "Kojo",
    "last_name": "Test",
    "phone": "+221771234567",
    "user_type": "client",
    "country": "senegal",
    "preferred_language": "fr",
    "legal_documents_accepted": True,
    "legal_documents_version": "v1.0.0-2024",
    # L'inscription exige désormais la vérification email ET au moins un
    # moyen de paiement pour un client.
    "payment_accounts": {
        "orange_money": "+221771234567",
    },
}

WORKER_USER = {
    **BASE_USER,
    "email": "worker@kojo.sn",
    "user_type": "worker",
    # Un travailleur doit lier au moins 2 moyens de paiement.
    "payment_accounts": {
        "orange_money": "+221771234567",
        "wave": "+221771234568",
    },
}

BASE_JOB = {
    "title": "Plomberie urgente Dakar",
    "description": "Réparer une fuite d'eau dans la salle de bain, travail urgent.",
    "category": "plomberie",
    "budget_min": 10000,
    "budget_max": 30000,
    # Le endpoint create_job requiert location.address ou location.fullAddress
    # (pas location.text) - c'est ce que le frontend envoie réellement.
    "location": {"address": "Dakar Plateau, Sénégal", "lat": 14.69, "lng": -17.44},
}

# Code retourné par FastAPI/HTTPBearer quand l'Authorization header est absent :
# selon la version, 401 ou 403 - les deux signifient "non authentifié".
AUTH_REQUIRED_STATUS = (401, 403)


async def issue_email_verification_token(client: AsyncClient, email: str) -> str:
    """Crée un OTP vérifié pour `email` (sans envoi réel) et retourne le
    jeton de vérification à passer à /auth/register-verified.

    Reproduit le flux produit : send-otp → verify-otp → jeton. Ici l'OTP est
    inséré directement en base avec un code connu pour rester déterministe.
    """
    otp_hash = _srv.hash_email_otp(email, "signup", TEST_OTP_CODE)
    await _srv.db.email_otps.update_one(
        {"email": email.lower().strip(), "purpose": "signup"},
        {"$set": {
            "otp_hash": otp_hash,
            "attempt_count": 0,
            "status": "pending",
            "last_sent_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    resp = await client.post("/api/auth/email/verify-otp", json={
        "email": email,
        "otp": TEST_OTP_CODE,
        "purpose": "signup",
    })
    assert resp.status_code == 200, f"verify-otp failed: {resp.text}"
    return resp.json()["verification_token"]


async def register_and_login(client: AsyncClient, user_data: dict = None) -> dict:
    """Inscription via le flux vérifié (OTP + comptes de paiement), puis
    retourne la réponse (access_token + user)."""
    data = dict(user_data or BASE_USER)
    token = await issue_email_verification_token(client, data["email"])
    payload = {**data, "email_verification_token": token}
    resp = await client.post("/api/auth/register-verified", json=payload)
    assert resp.status_code == 200, f"Register failed: {resp.text}"
    return resp.json()


async def auth_headers(client: AsyncClient, user_data: dict = None) -> dict:
    result = await register_and_login(client, user_data)
    return {"Authorization": f"Bearer {result['access_token']}"}
