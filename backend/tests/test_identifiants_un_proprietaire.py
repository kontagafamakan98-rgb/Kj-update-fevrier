# -*- coding: utf-8 -*-
"""Le filtre d'identifiant a UN propriétaire : `kojo_identifiants`.

POURQUOI CE FICHIER

Un document peut porter son identifiant de trois façons selon son âge : la
chaîne applicative (`id`), un ancien champ métier (`job_id`, les missions), ou
la clé primaire de Mongo (`_id`). Chaque routeur qui écrivait lui-même
`{"id": <ce que le client a envoyé>}` ne trouvait donc QUE les documents récents —
et le symptôme est celui des notifications : l'identifiant affiché ne désigne
rien, l'action répond 404, la ligne reste.

Le 21/09/2026, 92 filtres de ce genre vivaient encore recopiés dans 16 routeurs.
Ils sont branchés sur la règle unique. Ce qui est mesuré ici est ce qui empêche
la re-copie de revenir : le fichier part du DOSSIER, jamais d'une liste.

  * aucun routeur n'écrit son propre filtre d'identifiant (AST, clé `id` d'un
    filtre Mongo, projections `{"id": 1}` exclues) ;
  * aucun routeur ne définit SA copie de la règle (une fonction qui rend un
    filtre d'identifiant) ;
  * un document ANCIEN (sans champ `id`, seulement `_id`) reste adressable par
    une route réelle — la propriété que les filtres recopiés faisaient perdre.

Le témoin de la règle pour les seize routeurs concernés est
`kojo_routers_users_push.py` : son registre de preuves porte les deux mutations
qui montrent que ce contrôle sait rougir (filtre recopié dans un routeur, copie
locale de la règle), et une troisième qui retire le repli `_id` au propriétaire.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest
from httpx import AsyncClient

from tests.conftest import BASE_USER, db_find_one, db_insert, register_and_login

BACKEND = Path(__file__).resolve().parent.parent

# Les opérations Mongo qui reçoivent un FILTRE en premier argument.
OPERATIONS = {
    "find_one", "find", "update_one", "update_many", "delete_one", "delete_many",
    "replace_one", "find_one_and_update", "find_one_and_delete", "count_documents",
}

# Sous ce seuil, la dérivation est cassée, pas le contrat : on refuse de
# conclure plutôt que de passer au vert sur un contrôle vide.
MINIMUM_D_APPELS = 60


def routeurs() -> list[Path]:
    """Les modules de routes du dossier — un routeur neuf entre tout seul."""
    return sorted(BACKEND.glob("kojo_routers_*.py"))


def _collection(noeud: ast.AST) -> str:
    chaine = []
    courant = noeud
    while isinstance(courant, ast.Attribute):
        chaine.append(courant.attr)
        courant = courant.value
    if isinstance(courant, ast.Name):
        chaine.append(courant.id)
    return ".".join(reversed(chaine))


def filtres_ecrits_a_la_main(chemin: Path) -> list[str]:
    """Filtres Mongo qui portent la clé `id` — donc l'identifiant du document.

    Écartés : les `$or` et les valeurs `0`/`1`, qui sont des PROJECTIONS
    (`find(filtre, {"id": 1})`) et non des filtres.
    """
    arbre = ast.parse(chemin.read_text(encoding="utf-8"))
    trouves = []
    for noeud in ast.walk(arbre):
        if not isinstance(noeud, ast.Call) or not isinstance(noeud.func, ast.Attribute):
            continue
        if noeud.func.attr not in OPERATIONS or not noeud.args:
            continue
        filtre = noeud.args[0]
        if not isinstance(filtre, ast.Dict):
            continue
        for cle, valeur in zip(filtre.keys, filtre.values):
            if not (isinstance(cle, ast.Constant) and cle.value == "id"):
                continue
            if isinstance(valeur, ast.Constant) and valeur.value in (0, 1):
                continue
            trouves.append(
                "%s:%d  %s.%s  filtre %s"
                % (
                    chemin.name,
                    noeud.lineno,
                    _collection(noeud.func.value),
                    noeud.func.attr,
                    ast.get_source_segment(chemin.read_text(encoding="utf-8"), filtre),
                )
            )
    return trouves


# Les champs qui peuvent PORTER l'identifiant d'un document selon son âge.
CHAMPS_D_IDENTIFIANT = {"id", "job_id", "_id"}


def copies_locales(chemin: Path) -> list[str]:
    """Fonctions d'un routeur qui rendent un filtre d'identifiant.

    C'est la forme qu'avait `_job_identifier_query` avant d'être ramenée au
    propriétaire : une copie qui a l'air d'un appel et qui dérive en silence.

    Le motif est le DICTIONNAIRE rendu qui choisit un des champs d'identifiant
    avec une clé littérale. Un `{"$or": [{field: user_id} for field in …]}`
    n'en est pas un : ses clés sont calculées, et il ne désigne pas l'identifiant
    d'un document mais la carte des collections qui portent un compte.
    """
    arbre = ast.parse(chemin.read_text(encoding="utf-8"))
    # Toutes les fonctions, imbriquées comprises : une copie locale définie dans
    # une route est la même re-copie que celle d'hier, au même endroit du fichier.
    fonctions = {
        noeud.name: noeud
        for noeud in ast.walk(arbre)
        if isinstance(noeud, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    # Un helper qui rend une RÉPONSE (`{"id": …, "title": …}`) n'est pas une
    # copie de la règle. Ce qui en est une : un helper dont le résultat part
    # comme FILTRE d'une opération Mongo. C'est ce que l'on mesure d'abord.
    filtres = set()
    for noeud in ast.walk(arbre):
        if not isinstance(noeud, ast.Call) or not isinstance(noeud.func, ast.Attribute):
            continue
        if noeud.func.attr not in OPERATIONS or not noeud.args:
            continue
        for appel in ast.walk(noeud.args[0]):
            if (
                isinstance(appel, ast.Call)
                and isinstance(appel.func, ast.Name)
                and appel.func.id in fonctions
            ):
                filtres.add(appel.func.id)

    fautes = []
    for nom in sorted(filtres):
        for retour in ast.walk(fonctions[nom]):
            if not isinstance(retour, ast.Return) or retour.value is None:
                continue
            for dictionnaire in ast.walk(retour.value):
                if not isinstance(dictionnaire, ast.Dict):
                    continue
                for cle, valeur in zip(dictionnaire.keys, dictionnaire.values):
                    if not (isinstance(cle, ast.Constant) and cle.value in CHAMPS_D_IDENTIFIANT):
                        continue
                    if isinstance(valeur, ast.Constant) and valeur.value in (0, 1):
                        continue
                    fautes.append(
                        "%s:%d  %s() rend un filtre d'identifiant (champ `%s`) et sert de "
                        "filtre Mongo : la règle doit venir de `kojo_identifiants`"
                        % (chemin.name, fonctions[nom].lineno, nom, cle.value)
                    )
                    break
    return fautes


class TestAucunFiltreRecopie:
    def test_la_derivation_trouve_bien_les_appels_a_la_regle(self):
        """Non-vacuité : le contrôle inverse ne vaut que si les appels existent."""
        total = 0
        for chemin in routeurs():
            source = chemin.read_text(encoding="utf-8")
            total += source.count("identifiant_query(") + source.count("identifiant_job_query(")
        assert total >= MINIMUM_D_APPELS, (
            "seuls %d appel(s) à la règle dans les routeurs : le contrôle ne "
            "mesurerait rien (dérivation cassée ?)" % total
        )

    def test_aucun_routeur_n_ecrit_son_propre_filtre_d_identifiant(self):
        fautes = []
        for chemin in routeurs():
            fautes.extend(filtres_ecrits_a_la_main(chemin))
        assert fautes == [], (
            "filtre(s) d'identifiant écrit(s) à la main : l'identifiant doit venir "
            "de `kojo_identifiants` (id / job_id legacy / _id)\n  " + "\n  ".join(fautes)
        )

    def test_aucun_routeur_ne_recopie_la_regle(self):
        fautes = []
        for chemin in routeurs():
            fautes.extend(copies_locales(chemin))
        assert fautes == [], "copie(s) locale(s) de la règle :\n  " + "\n  ".join(fautes)


class TestUnDocumentAncienResteAdressable:
    """La propriété que les filtres recopiés faisaient perdre, sur une route réelle."""

    @pytest.mark.asyncio
    async def test_un_jeton_sans_champ_id_est_desactive_par_son_identifiant_mongo(
        self, client: AsyncClient
    ):
        """Un document ANCIEN (sans `id`, seulement `_id`) doit rester adressable.

        Le filtre recopié `{"id": <valeur>}` ne le trouvait pas : la route
        répondait 404 et le jeton restait actif. La règle le trouve par sa clé
        primaire — c'est exactement le cas des documents antérieurs au champ `id`.
        """
        user = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        await db_insert(
            "push_tokens",
            {
                "user_id": user["user"]["id"],
                "push_token": "jeton-ancien",
                "active": True,
            },
        )
        ancien = await db_find_one("push_tokens", {"push_token": "jeton-ancien"})
        assert "id" not in ancien, "le document doit rester SANS champ `id` pour ce cas"
        assert ancien.get("_id"), "la base doit lui avoir posé une clé primaire"

        reponse = await client.delete(
            f"/api/users/push-token/{ancien['_id']}", headers=headers
        )

        assert reponse.status_code == 200, reponse.text
        apres = await db_find_one("push_tokens", {"push_token": "jeton-ancien"})
        assert apres["active"] is False, "le jeton doit avoir été désactivé, pas seulement annoncé"
