#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LES INDEX RÉSIDUELS CONNUS SONT RETIRÉS — la sonde cesse alors de les publier.

POURQUOI CE SCRIPT EXISTE (mesuré le 27/10/2026)

La sonde des index (`backend/scripts/check_index_db.py`) publie en `[INFO]` tout
index présent dans la base mais absent de la déclaration. C'est le bon verdict —
un résidu n'est pas une panne —, mais il revient à CHAQUE run tant que le résidu
est là : un avertissement permanent s'apprend à être ignoré, et l'index continue
de coûter à chaque insertion. Relevé ce jour : `messages.created_at_-1`, un
index sur un champ qu'aucun chemin de code n'écrit ni ne lit (le modèle écrit
`timestamp`, les requêtes trient `timestamp`, le TTL expire sur `timestamp`).

Trois façons de faire taire cette ligne. La DÉCLARER créerait et maintiendrait
un index mort, sur un champ qui n'existe pas. L'EXCEPTER dans la sonde rendrait
invisible un résidu qui reviendrait — l'angle mort que la sonde existe pour
fermer. Le RETIRER laisse une base qui ne porte que la déclaration : il n'y a
plus rien à publier, et ce n'est pas parce qu'on a cessé de regarder.

CE QUE CE SCRIPT REFUSE

  * retirer un nom DÉCLARÉ dans `kojo_index_declares` : un résidu ne l'est que
    tant que personne ne le déclare. Le jour où ce nom devient utile, le script
    le dit et s'arrête (code 1) au lieu de défaire une déclaration ;
  * retirer `_id_` ;
  * conclure sans rien lire : `MONGO_URL` absent, `pymongo` absent, base
    injoignable, collection illisible, liste de résidus tronquée sont des
    PRÉMISSES (code 2). Un script qui n'a rien lu ne retire rien.

TROIS SORTIES, jamais deux :
  0  rien à retirer (le résidu est déjà absent — une seconde passe est sans
     effet) ou tout retiré ET vérifié absent ;
  1  refus (le nom est déclaré, c'est `_id_`) ou un index est RESTÉ après le
     retrait — constaté en RELISANT `list_indexes()`, jamais supposé du code de
     retour de `drop_index()` ;
  2  prémisse : aucun verdict n'est rendu, et rien n'est retiré.

Sans `--appliquer`, le script MONTRE ce qu'il retirerait et n'écrit pas : une
passe d'écriture sur la base de production se demande, elle ne se devine pas.

Variables d'environnement (jamais en argument : une chaîne de connexion dans
l'historique du shell est une fuite) :
  MONGO_URL   chaîne de connexion MongoDB (écriture requise pour le retrait)
  DB_NAME     base à traiter (défaut : kojo_db)

Usage :
    MONGO_URL=… python backend/scripts/retirer_index_residuels.py
    MONGO_URL=… python backend/scripts/retirer_index_residuels.py --appliquer
"""
import argparse
import os
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
if str(RACINE) not in sys.path:
    sys.path.insert(0, str(RACINE))
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

BASE_PAR_DEFAUT = "kojo_db"

# Plancher de lecture : une liste de résidus vidée (fichier amputé, import qui
# rend un tuple vide) ferait rendre un vert à un script qui n'a rien retiré —
# et lirait « aucun résidu » là où veut dire « je n'ai rien à retirer parce que
# je ne sais plus quoi retirer ».
PLANCHER_RESIDUS = 1

# La déclaration est lue au CHARGEMENT, et son échec est CAPTURÉ — même raison
# que dans la sonde : elle importe `kojo_index_declares → kojo_retention →
# kojo_settings`, donc un profil d'environnement incomplet la fait tomber AVANT
# tout verdict, et un traceback sortirait en code 1, c'est-à-dire « refus »
# alors qu'aucun index n'aurait été LU.
try:
    import kojo_index_declares as index_declares  # noqa: E402 - après le sys.path
    ERREUR_DECLARATION = None
except Exception as exc:  # noqa: BLE001 - une prémisse se déclare, elle ne vaut pas un vert
    index_declares = None
    ERREUR_DECLARATION = exc


# ── Le plan : ce qui serait retiré, ce qui est déjà absent, ce qui est refusé ──

def planifier(residus, declares, etats) -> tuple:
    """`(code, lignes, a_retirer)` — PUR, donc testable sans base.

    `etats` a la forme que `check_index_db.lire_etats()` rend :
    `{collection: {"index": {nom: document}}}` ou `{collection: {"erreur": …}}`,
    une collection ABSENTE du dictionnaire n'ayant pas été interrogée.

    `a_retirer` est une liste de couples `(collection, nom)` : le nom est
    recalculé comme MongoDB le fait (`nom_index`), il n'est donc jamais recopié
    à la main d'un côté et écrit de l'autre.
    """
    if len(residus) < PLANCHER_RESIDUS:
        return 2, [
            f"[PREMISSE] Seulement {len(residus)} résidu(s) déclaré(s) "
            f"(plancher {PLANCHER_RESIDUS}) : la liste est tronquée, donc rien "
            "n'est retiré et rien n'est affirmé. Vérifier "
            "`RESIDUS_CONNUS` dans backend/kojo_index_declares.py."
        ], []

    declares_par_nom = {
        (str(declare["collection"]), index_declares.nom(declare)): declare
        for declare in declares
    }

    lignes = []
    a_retirer = []
    refus = []
    illisibles = []
    absents = 0

    for residu in residus:
        collection = str(residu["collection"])
        nom_index_ = index_declares.nom(residu)
        couple = f"{collection}.{nom_index_}"

        if nom_index_ == "_id_" or (collection, nom_index_) in declares_par_nom:
            # Le cas qui protège une DÉCLARATION : un résidu qui devient un
            # index déclaré n'est plus un résidu, et le retirer déferait la
            # déclaration que la création vient de poser.
            refus.append(
                f"[ERREUR] {couple} : ce nom est DÉCLARÉ dans "
                "backend/kojo_index_declares.py — il n'est pas résiduel. Retirer "
                "cette entrée de `RESIDUS_CONNUS`, ou retirer l'index fait par "
                "erreur de la déclaration ; le script ne tranche pas à votre place."
            )
            continue

        etat = etats.get(collection)
        if etat is None:
            illisibles.append(
                f"[PREMISSE] {couple} : collection non interrogée par le script — "
                "aucun verdict sur ce résidu."
            )
            continue
        if "erreur" in etat:
            illisibles.append(
                f"[PREMISSE] {collection} illisible ({etat['erreur']}) : "
                f"l'état de {nom_index_} n'est pas connu."
            )
            continue

        presents = etat.get("index") or {}
        if nom_index_ in presents:
            a_retirer.append((collection, nom_index_))
        else:
            absents += 1
            lignes.append(
                f"[OK] {couple} : déjà absent — le résidu a été retiré par une "
                "passe précédente, ou n'a jamais existé sur cette base."
            )

    lignes.append(
        f"[MESURÉ] {len(residus)} résidu(s) déclaré(s) ; {len(a_retirer)} "
        f"présent(s) à retirer ; {absents} déjà absent(s) ; {len(refus)} refus ; "
        f"{len(illisibles)} non lisible(s)."
    )

    if refus:
        return 1, lignes + refus, []
    if illisibles:
        return 2, lignes + illisibles, []
    if a_retirer:
        for collection, nom_index_ in a_retirer:
            lignes.append(f"[A RETIRER] {collection}.{nom_index_}")
    return 0, lignes, a_retirer


def appliquer(base, a_retirer) -> tuple:
    """`(code, lignes)` — retire, puis RELIT pour vérifier l'absence.

    `drop_index()` peut réussir en laissant l'index (réplique en retard, vue
    périmée) : la seule preuve est `list_indexes()`. Croire le code de retour
    ferait publier « retiré » sur un résidu toujours présent, et la sonde
    continuerait de le publier sans que personne ne relie les deux.
    """
    lignes = []
    restes = []
    for collection, nom_index_ in a_retirer:
        couple = f"{collection}.{nom_index_}"
        try:
            base[collection].drop_index(nom_index_)
        except Exception as exc:  # noqa: BLE001 - nommé dans le verdict, jamais avalé
            restes.append(f"[ERREUR] {couple} : retrait refusé par la base ({exc}).")
            continue
        try:
            presents = {doc["name"] for doc in base[collection].list_indexes()}
        except Exception as exc:  # noqa: BLE001 - ne pas pouvoir relire n'est pas un succès
            restes.append(
                f"[ERREUR] {couple} : retrait demandé mais `list_indexes()` "
                f"illisible ({exc}) — l'absence n'est PAS prouvée."
            )
            continue
        if nom_index_ in presents:
            restes.append(f"[ERREUR] {couple} : TOUJOURS présent après le retrait.")
        else:
            lignes.append(f"[OK] {couple} : retiré, absent de `list_indexes()`.")

    if restes:
        return 1, lignes + restes
    return 0, lignes


# ── La passe ────────────────────────────────────────────────────────────────

def _sortie_utf8():
    """Console Windows en cp1252 : sans cela, un accent sort en `\\uFFFD`."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _args(argv=None):
    """`argv` explicite : un `parse_args()` sans argument lit `sys.argv`, donc
    les options de l'appelant (pytest, par exemple)."""
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument(
        "--appliquer",
        action="store_true",
        help="retire réellement les index (sans ce drapeau, la passe est une simulation)",
    )
    parseur.add_argument("--delai", type=int, default=20, help="délai de connexion (secondes)")
    return parseur.parse_args(argv)


def executer(argv=None, fabrique=None) -> int:
    """Le déroulé complet. `fabrique(uri, delai)` remplace la connexion dans les
    tests : sans cela, la seule façon de prouver qu'une simulation n'écrit pas
    serait d'écrire pour de vrai."""
    _sortie_utf8()
    args = _args(argv)

    if index_declares is None:
        print(
            "[PREMISSE] La déclaration des index est ILLISIBLE "
            f"({type(ERREUR_DECLARATION).__name__}: {ERREUR_DECLARATION}) : aucun "
            "résidu n'a été lu, donc rien n'est retiré. Vérifier "
            "backend/kojo_index_declares.py et le profil d'environnement (le "
            "module importe les durées de conservation, donc `kojo_settings`).",
            file=sys.stderr,
        )
        return 2

    residus = tuple(index_declares.RESIDUS_CONNUS or ())
    try:
        declares = index_declares.declarations()
    except Exception as exc:  # noqa: BLE001 - prémisse nommée
        print(
            f"[PREMISSE] La déclaration des index est ILLISIBLE ({type(exc).__name__}: "
            f"{exc}) : impossible de dire quel nom est résiduel, donc rien n'est retiré.",
            file=sys.stderr,
        )
        return 2

    if len(residus) < PLANCHER_RESIDUS:
        print(
            f"[PREMISSE] Seulement {len(residus)} résidu(s) déclaré(s) (plancher "
            f"{PLANCHER_RESIDUS}) : rien n'est retiré et rien n'est affirmé.",
            file=sys.stderr,
        )
        return 2

    uri = os.environ.get("MONGO_URL")
    base_nom = os.environ.get("DB_NAME") or BASE_PAR_DEFAUT
    if not uri:
        print(
            "[PREMISSE] MONGO_URL absent : les résidus ne sont pas lus, donc aucun "
            "n'est retiré. Une surface aveugle se déclare — elle ne vaut pas un vert.",
            file=sys.stderr,
        )
        return 2

    collections = []
    for residu in residus:
        collection = str(residu["collection"])
        if collection not in collections:
            collections.append(collection)

    try:
        if fabrique is None:
            from pymongo import MongoClient

            def fabrique(uri_mongo, delai):  # noqa: F811 - fabrique par défaut
                return MongoClient(uri_mongo, serverSelectionTimeoutMS=delai * 1000)[base_nom]
        base = fabrique(uri, args.delai)
        base.command("ping")
    except Exception as exc:  # noqa: BLE001 - prémisse nommée, jamais un vert
        print(
            f"[PREMISSE] Base injoignable ({exc}) : aucun résidu n'a été lu, donc "
            "aucun n'est retiré et aucun verdict n'est rendu.",
            file=sys.stderr,
        )
        return 2

    try:
        import check_index_db as sonde  # noqa: E402 - après le sys.path

        etats = sonde.lire_etats(base, collections)
    except Exception as exc:  # noqa: BLE001 - prémisse nommée
        print(
            f"[PREMISSE] Lecture des index impossible ({exc}) : rien n'est retiré.",
            file=sys.stderr,
        )
        return 2

    code, lignes, a_retirer = planifier(residus, declares, etats)
    for ligne in lignes:
        print(ligne)

    if code != 0 or not a_retirer:
        return code

    if not args.appliquer:
        print(
            "[INFO] Simulation : aucun index n'a été retiré. Relancer avec "
            "`--appliquer` pour retirer ceux qui sont listés ci-dessus."
        )
        return 0

    code, lignes = appliquer(base, a_retirer)
    for ligne in lignes:
        print(ligne)
    if code == 0:
        print(
            "[OK] La base ne porte plus ces résidus : la sonde des index n'a plus "
            "rien à publier pour eux."
        )
    else:
        print(
            "\n::error title=Index résiduels toujours présents::Le retrait n'a pas "
            "été vérifié absent — voir les lignes ci-dessus."
        )
    return code


if __name__ == "__main__":
    sys.exit(executer())
