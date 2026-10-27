#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les index DÉCLARÉS sont-ils ceux que la base PORTE ? Cette sonde compare.

POURQUOI ELLE EXISTE (mesuré le 27/10/2026)

La création des index enveloppait ses ~70 déclarations dans un seul `try`. Le
sixième échouait, les 66 suivants n'étaient jamais créés, et l'échec partait
dans un `logger.warning` à chaque démarrage. Rien ne le mesurait : `/health` ne
publiait rien sur les index, et le repli `$regex` de la recherche répondait 200
— plus lentement — sur une base sans index texte. Une contrainte d'unicité
absente ne se voit pas non plus depuis l'extérieur : elle se voit le jour où un
doublon passe.

CE QU'ELLE JUGE : la MÊME déclaration que `kojo_db.create_database_indexes()`
(`backend/kojo_index_declares.py`), confrontée à `list_indexes()` de la base.
Pour chaque index déclaré : présent ? sous le bon nom ? avec les bonnes options
(clé, unicité, filtre partiel, TTL, langue du texte) ? Elle lit aussi les index
PRÉSENTS mais NON DÉCLARÉS — un résidu n'est pas un rouge, mais il est publié :
c'est souvent l'ancienne forme d'un index qu'on vient de changer.

TROIS SORTIES, jamais deux :
  0  tous les index déclarés sont présents et conformes ;
  1  au moins un écart — la ligne le nomme avec les deux valeurs, et le remède
     est de redémarrer le backend (la création répare) ou de retirer l'index ;
  2  impossible de juger (MONGO_URL absent, base injoignable, collection
     illisible, déclaration tronquée). Une surface aveugle se DÉCLARE : elle ne
     vaut pas un vert.

Variables d'environnement (jamais en argument : une chaîne de connexion dans
l'historique du shell est une fuite) :
  MONGO_URL   chaîne de connexion MongoDB (lecture seule suffit)
  DB_NAME     base à juger (défaut : kojo_db)

Usage :
    MONGO_URL=… python backend/scripts/check_index_db.py
    MONGO_URL=… python backend/scripts/check_index_db.py --delai 20
"""
import argparse
import os
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
if str(RACINE) not in sys.path:
    sys.path.insert(0, str(RACINE))

# La déclaration est lue au CHARGEMENT, et son échec est CAPTURÉ. La sonde
# importe la chaîne `kojo_index_declares → kojo_retention → kojo_settings`, donc
# un profil d'environnement incomplet la fait tomber AVANT tout verdict —
# mesuré le 27/10/2026 sur le premier run du workflow : sans `APP_ENV`, la CI
# n'a pas de `JWT_SECRET`, `kojo_settings` refuse de démarrer en production, et
# le TRACEBACK sortait en code 1, c'est-à-dire « index non conformes » alors
# qu'aucun index n'avait été LU. Une déclaration illisible est une PRÉMISSE
# (code 2), et elle est nommée.
try:
    import kojo_index_declares as index_declares  # noqa: E402 - après le sys.path
    ERREUR_DECLARATION = None
except Exception as exc:  # noqa: BLE001 - une surface aveugle se déclare, elle ne vaut pas un vert
    index_declares = None
    ERREUR_DECLARATION = exc

BASE_PAR_DEFAUT = "kojo_db"

# Plancher de lecture : une déclaration tronquée (fichier amputé, import qui
# rend une liste vide) ferait passer la sonde sans rien juger. 81 index lus le
# 27/10/2026 ; en dessous de 40, le fichier n'est plus celui du dépôt.
PLANCHER_DECLARES = 40


def declarations_lues():
    """`(declares, erreur)` — charger la déclaration ne LÈVE jamais.

    Deux échecs distincts mènent ici : l'import du module (profil
    d'environnement incomplet, fichier amputé) et l'appel de
    `declarations()` (qui lit les règles de conservation). Les deux sont des
    prémisses : sans déclaration, la sonde n'a rien à comparer.
    """
    if index_declares is None:
        return None, ERREUR_DECLARATION
    try:
        return index_declares.declarations(), None
    except Exception as exc:  # noqa: BLE001 - reporté comme prémisse nommée
        return None, exc


def collections_declarees(declares) -> list:
    """Les collections à interroger, dans l'ordre de la déclaration."""
    vues = []
    for declare in declares:
        collection = str(declare["collection"])
        if collection not in vues:
            vues.append(collection)
    return vues


def juger(declares, etats: dict) -> tuple:
    """`(code, lignes)` — PUR, donc testable sans base.

    `etats` : `{collection: {"index": {nom: document}}}` ou
    `{collection: {"erreur": "raison"}}` (ou absente du dictionnaire : non lue).
    """
    lignes = []
    if len(declares) < PLANCHER_DECLARES:
        return 2, [
            f"[PREMISSE] Seulement {len(declares)} index déclaré(s) lu(s) "
            f"(plancher {PLANCHER_DECLARES}) : la déclaration est tronquée, donc "
            "rien n'a été jugé. Vérifier backend/kojo_index_declares.py."
        ]

    illees = [collection for collection in collections_declarees(declares) if collection in etats]
    if not illees:
        return 2, [
            "[PREMISSE] Aucune collection n'a pu être lue : la sonde ne peut pas "
            "comparer la déclaration à la base. Aucun verdict n'est rendu."
        ]

    absentes = []
    ecarts = []
    conformes = 0
    presents_total = 0
    declares_par_collection = {}

    for declare in declares:
        collection = str(declare["collection"])
        nom = index_declares.nom(declare)
        declares_par_collection.setdefault(collection, []).append(nom)
        etat = etats.get(collection)
        if etat is None:
            ecarts.append(
                f"[ERREUR] {collection}.{nom} : collection non lue par la sonde "
                "(elle n'a pas été interrogée) — aucun verdict sur cet index."
            )
            continue
        if "erreur" in etat:
            # Une erreur de lecture est une PRÉMISSE : confondre « je n'ai pas
            # pu lire » avec « il manque » ferait crier au loup, et un rouge
            # qu'on ne peut pas corriger s'apprend à être ignoré.
            return 2, lignes + [
                f"[PREMISSE] Collection {collection} illisible ({etat['erreur']}) : "
                "la sonde ne peut pas juger ses index. Aucun verdict n'est rendu."
            ]
        presents = etat.get("index") or {}
        presents_total += len(presents)
        detail = index_declares.comparer(declare, presents.get(nom))
        if not detail:
            conformes += 1
            continue

        if nom not in presents and not presents:
            absentes.append(collection)
        ecarts.append(
            f"[ERREUR] {collection}.{nom} ({declare['cle']}) : " + " ; ".join(detail)
        )

    non_declares = []
    for collection in illees:
        presents = (etats.get(collection) or {}).get("index") or {}
        for nom in presents:
            if nom == "_id_":
                continue
            if nom not in declares_par_collection.get(collection, []):
                non_declares.append(f"{collection}.{nom}")

    lignes.append(
        f"[MESURÉ] {len(declares)} index déclarés sur {len(collections_declarees(declares))} "
        f"collections ; {conformes} présents et conformes ; {len(ecarts)} écart(s) ; "
        f"{len(collections_declarees(declares)) - len(illees)} collection(s) non lue(s)."
    )
    if non_declares:
        apercu = ", ".join(sorted(non_declares)[:10])
        suite = "" if len(non_declares) <= 10 else f" (+{len(non_declares) - 10})"
        lignes.append(
            f"[INFO] {len(non_declares)} index présents mais NON déclarés : {apercu}{suite} "
            "— résidu ou ancienne forme ; la création ne les retire pas."
        )
    else:
        lignes.append("[INFO] Aucun index non déclaré : la base ne porte que la déclaration.")

    if absentes:
        lignes.append(
            "[INFO] Collections absentes de la base : " + ", ".join(sorted(set(absentes)))
        )

    if ecarts:
        return 1, lignes + ecarts

    lignes.append(
        "[OK] Les index déclarés sont présents et portent leurs options : unicité, "
        "filtre partiel, TTL et langue du texte compris."
    )
    return 0, lignes


def lire_etats(base, collections) -> dict:
    """`{collection: {"index": {nom: doc}}}` — une erreur est CAPTURÉE, pas levée."""
    etats = {}
    presentes = set()
    try:
        presentes = set(base.list_collection_names())
    except Exception as exc:  # noqa: BLE001 - base injoignable plus bas, mais rester précis
        return {collection: {"erreur": f"list_collection_names: {exc}"} for collection in collections}

    for collection in collections:
        if collection not in presentes:
            # Une collection absente n'a AUCUN index : c'est un écart, pas une
            # erreur de lecture — la création l'aurait créée au démarrage.
            etats[collection] = {"index": {}}
            continue
        try:
            etats[collection] = {
                "index": {doc["name"]: doc for doc in base[collection].list_indexes()}
            }
        except Exception as exc:  # noqa: BLE001 - reporté comme prémisse
            etats[collection] = {"erreur": str(exc)}
    return etats


def _sortie_utf8():
    """Console Windows en cp1252 : sans cela, un accent sort en `\\uFFFD`."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _resume(lignes, code):
    """Le résumé publié sur la sortie standard ET dans le résumé du run."""
    entete = {
        0: "Index de la base : conformes",
        1: "Index de la base : ÉCARTS",
        2: "Index de la base : non jugeables (prémisse)",
    }[code]
    return "\n".join([f"### {entete}", ""] + [f"- {ligne}" for ligne in lignes])


def main(argv=None):
    """`argv` explicite : un `parse_args()` sans argument lit `sys.argv`, donc
    les options de l'appelant (pytest, par exemple) et sort en 2 pour de
    mauvaises raisons."""
    _sortie_utf8()
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--delai", type=int, default=20, help="délai de connexion (secondes)")
    args = parseur.parse_args(argv)

    declares, erreur = declarations_lues()
    if declares is None:
        print(
            "[PREMISSE] La déclaration des index est ILLISIBLE "
            f"({type(erreur).__name__}: {erreur}) : aucun index n'a été jugé, donc "
            "aucun verdict n'est rendu. Une surface aveugle se déclare — elle ne "
            "vaut pas un vert. Vérifier backend/kojo_index_declares.py et le profil "
            "d'environnement de la sonde (elle importe les durées de conservation, "
            "donc `kojo_settings`).",
            file=sys.stderr,
        )
        return 2

    uri = os.environ.get("MONGO_URL")
    base_nom = os.environ.get("DB_NAME") or BASE_PAR_DEFAUT
    if not uri:
        print(
            "[PREMISSE] MONGO_URL absent : les index ne sont pas jugés. Une surface "
            "aveugle se déclare — elle ne vaut pas un vert.",
            file=sys.stderr,
        )
        return 2

    try:
        from pymongo import MongoClient
    except ImportError as exc:
        print(f"[PREMISSE] `pymongo` indisponible ({exc}) : aucun verdict rendu.", file=sys.stderr)
        return 2

    collections = collections_declarees(declares)

    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=args.delai * 1000)
        base = client[base_nom]
        base.command("ping")
    except Exception as exc:  # noqa: BLE001 - prémisse nommée, jamais un vert
        print(
            f"[PREMISSE] Base injoignable ({exc}) : aucun index n'a été lu, donc "
            "aucun verdict n'est rendu.",
            file=sys.stderr,
        )
        return 2

    etats = lire_etats(base, collections)
    code, lignes = juger(declares, etats)

    for ligne in lignes:
        print(ligne)

    # Le coût de la passe est publié MÊME quand tout est vert : une sonde qui ne
    # dit ce qu'elle a lu que le jour où elle échoue ne permet aucun arbitrage.
    print(f"[COÛT] {len(collections)} collection(s) interrogée(s), {len(declares)} index jugés.")

    resume = _resume(lignes, code)
    chemin = os.environ.get("GITHUB_STEP_SUMMARY")
    if chemin:
        try:
            with open(chemin, "a", encoding="utf-8") as flux:
                flux.write(resume + "\n")
        except OSError as exc:
            print(f"[INFO] Résumé du run non écrit ({exc}).", file=sys.stderr)

    if code == 1:
        print(
            "\n::error title=Index de la base non conformes::Au moins un index déclaré "
            "manque ou porte d'autres options — voir backend/kojo_index_declares.py et "
            "le résumé du démarrage du backend."
        )
    elif code == 2:
        print(
            "\n::warning title=Index de la base non jugeables::La sonde n'a pas pu "
            "comparer (prémisse), aucun verdict n'est rendu."
        )
    return code


if __name__ == "__main__":
    sys.exit(main())
