#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Exercice de restauration DATÉ d'une base MongoDB (Atlas ou local) — sans
`mongodump`, sans écrire dans la base de production.

POURQUOI CE SCRIPT EXISTE : `backend/SAUVEGARDES_ATLAS.md` porte un exercice
daté du 18/10/2026 qui a prouvé les commandes du repli SUR UNE BASE LOCALE, et
qui dit lui-même ce qu'il n'a pas prouvé : le chemin Atlas. Un exercice qu'on
ne peut pas rejouer vieillit mal — celui-ci se rejoue en une commande, sur la
base réelle, et ÉCRIT son verdict (date, RTO, empreintes) au lieu de le laisser
dans une conversation.

CE QU'IL FAIT, dans cet ordre, et rien d'autre :

  1. lit la base SOURCE (`--base`, défaut `kojo_db`) — aucune écriture ;
  2. calcule l'empreinte de chaque collection : nombre exact de documents,
     SHA-256 du contenu complet (documents encodés BSON, ordonnés par `_id`),
     et DÉFINITION des index (clé ET options : `unique`, `sparse`, TTL,
     filtre partiel, collation) ;
  3. RESTAURE dans une base de TRAVAIL `--cible`
     (défaut `<base>_restauration_<AAAA-MM-JJ>`), sur le même serveur,     en recréant les index AVEC leurs options ;
  4. recalcule la même empreinte dans la cible et COMPARE — un document
     manquant, un index perdu, un index aux options différentes ou un contenu
     altéré font échouer l'exercice ;
  5. détruit la base de travail (`--garder` pour l'inspecter) ;
  6. écrit un rapport daté (`--rapport`) et rend un code de sortie.

Aucune écriture dans la base de production n'est possible : la cible est une
base DIFFÉRENTE, et le script refuse `--cible` égale à `--base`. La seule
opération destructive est `drop_database(cible)`, sur une base qu'il vient de
créer.

CE QU'IL NE PROUVE PAS, et qui reste à faire (écrit dans le rapport) : la
restauration d'un SNAPSHOT ou d'un point PITR côté Atlas — elle se pilote par
l'API/la console Atlas, pas par une URI de lecture. Ce script prouve la moitié
qu'on peut prouver sans privilège de cluster : que la copie restaurée est
IDENTIQUE à la source, index compris, et combien de temps cela prend.

Usage :
    MONGO_URL='mongodb+srv://…' python scripts/exercice_restauration.py \\
        --base kojo_db --rapport /tmp/restauration-$(date +%F).json

Codes : 0 identique, 1 écart mesuré, 2 prémisse (aucune URI, base absente ou
vide, serveur injoignable) — jamais un vert sans comparaison.
"""
import argparse
import hashlib
import json
import os
import sys
import time
from datetime import date

from bson import BSON

SOURCE_DEFAUT = "kojo_db"
# Les collections qu'un test de restauration observe TOUJOURS, même absentes :
# un exercice qui ne comparerait que ce qu'il trouve passerait après une perte.
COLLECTIONS_ATTENDUES = ("users", "jobs", "payments", "notifications", "messages")

# Champs de `index_information()` qui ne sont PAS des options de création :
# `key` est passé à part, `name` aussi, et `v`/`ns`/`background` appartiennent au
# serveur (les recopier ferait refuser l'index).
CHAMPS_NON_OPTION = frozenset({"key", "v", "ns", "background", "name"})


def options_index(information: dict) -> dict:
    """Les options d'un index, RECOPIÉES telles quelles.

    Ne garder que `unique` perdait `sparse` — et un index unique non sparse sur
    `payments.idempotency_key` refuse la restauration dès le deuxième document
    sans clé (E11000, mesuré le 21/10/2026 par le run 39526117357). Il perdait
    aussi `expireAfterSeconds` : une restauration qui perd un TTL garde les
    données, mais les garde POUR TOUJOURS, et rien ne le disait.
    """
    return {cle: valeur for cle, valeur in information.items() if cle not in CHAMPS_NON_OPTION}


def definition_index(information: dict) -> str:
    """Définition canonique d'un index — ce qui décide de son comportement.

    Les options sont triées par `sort_keys` et les valeurs non JSON (ObjectId
    d'un filtre partiel, dates) passées par `default=str` : deux lectures de la
    même base doivent rendre la même chaîne, sinon la comparaison crierait au
    loup sur un ordre de dictionnaire.
    """
    cles = [
        [str(champ), direction if isinstance(direction, (int, float, str)) else str(direction)]
        for champ, direction in (information.get("key") or [])
    ]
    return json.dumps({"key": cles, **options_index(information)}, sort_keys=True, default=str)


def empreinte_collection(collection) -> dict:
    """Nombre exact, SHA-256 du contenu complet et index d'une collection.

    Le hachage porte sur les documents ENCODÉS BSON, dans l'ordre de `_id` : deux
    lectures de la même base donnent la même empreinte, et une valeur modifiée
    (même d'un caractère) la change. L'ordre est demandé au SERVEUR (index `_id`),
    donc pas de tri en mémoire sur des millions de documents.
    """
    condensat = hashlib.sha256()
    documents = 0
    for document in collection.find({}).sort("_id", 1):
        condensat.update(BSON.encode(document))
        condensat.update(b"\x00")
        documents += 1
    informations = collection.index_information()
    index = sorted(nom for nom in informations if nom != "_id_")
    definitions = {nom: definition_index(informations[nom]) for nom in index}
    return {
        "documents": documents,
        "sha256": condensat.hexdigest(),
        "index": index,
        "definitions": definitions,
    }


def empreinte_base(db) -> dict:
    """Empreinte de chaque collection de la base, noms triés."""
    return {
        nom: empreinte_collection(db[nom]) for nom in sorted(db.list_collection_names())
    }


def comparer(avant: dict, apres: dict) -> list:
    """Les écarts, nommés. Une collection ABSENTE de la cible est un écart même
    si elle était vide : c'est une collection perdue, pas un détail."""
    ecarts = []
    for nom, reference in avant.items():
        cible = apres.get(nom)
        if cible is None:
            ecarts.append(f"{nom} : collection ABSENTE de la restauration")
            continue
        if cible["documents"] != reference["documents"]:
            ecarts.append(
                "%s : %d document(s) restaurés sur %d"
                % (nom, cible["documents"], reference["documents"])
            )
        if cible["sha256"] != reference["sha256"]:
            ecarts.append(
                "%s : empreinte différente (%s… ≠ %s…)"
                % (nom, reference["sha256"][:12], cible["sha256"][:12])
            )
        perdus = sorted(set(reference["index"]) - set(cible["index"]))
        if perdus:
            ecarts.append("%s : index non restauré(s) : %s" % (nom, ", ".join(perdus)))
        # Un index présent mais DIFFÉRENT n'est pas restauré : un unique sans
        # `sparse`, un TTL perdu, un filtre partiel oublié changent le
        # comportement de la base en silence. Le nom ne le dit pas.
        reference_defs = reference.get("definitions") or {}
        cible_defs = cible.get("definitions") or {}
        for nom_index in sorted(set(reference["index"]) & set(cible["index"])):
            attendu = reference_defs.get(nom_index)
            obtenu = cible_defs.get(nom_index)
            if attendu and obtenu and attendu != obtenu:
                ecarts.append(
                    "%s : index « %s » restauré avec une AUTRE définition (%s ≠ %s) "
                    "— sparse/TTL/partiel changent le comportement"
                    % (nom, nom_index, attendu, obtenu)
                )
    for nom in sorted(set(apres) - set(avant)):
        ecarts.append("%s : collection EN TROP dans la restauration" % nom)
    return ecarts


def restaurer(source, cible, lot: int = 1000) -> dict:
    """Recopie les collections de la source vers la cible, index compris."""
    total = 0
    for nom in sorted(source.list_collection_names()):
        documents = source[nom].find({})
        tampon = []
        for document in documents:
            tampon.append(document)
            if len(tampon) >= lot:
                cible[nom].insert_many(tampon, ordered=False)
                total += len(tampon)
                tampon = []
        if tampon:
            cible[nom].insert_many(tampon, ordered=False)
            total += len(tampon)
        for nom_index, information in source[nom].index_information().items():
            if nom_index == "_id_":
                continue
            cles = information.get("key") or []
            cible[nom].create_index(cles, name=nom_index, **options_index(information))
    return {"documents": total, "collections": len(source.list_collection_names())}


def _sortie_utf8():
    """Console Windows en cp1252 : le verdict contient « ✅ », et un import du
    module (test, outil) n'exécute pas le bloc `__main__` qui s'en occupait —
    l'exercice réussissait alors en levant sur son propre message (mesuré le
    21/10/2026)."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # flux redirigé (StringIO) ou remplacé
            pass


def main(argv=None) -> int:
    _sortie_utf8()
    parseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parseur.add_argument("--uri", default=os.environ.get("MONGO_URL", ""))
    parseur.add_argument("--base", default=SOURCE_DEFAUT)
    parseur.add_argument("--cible", default="")
    parseur.add_argument("--rapport", default="")
    parseur.add_argument("--garder", action="store_true")
    args = parseur.parse_args(argv)

    aujourd_hui = date.today().isoformat()
    cible_nom = args.cible or "%s_restauration_%s" % (args.base, aujourd_hui.replace("-", ""))
    rapport = {
        "exercice_le": aujourd_hui,
        "base_source": args.base,
        "base_cible": cible_nom,
        "verdict": "non jugé",
        "ce_qui_n_est_pas_prouve": (
            "la restauration d'un snapshot/PITR côté Atlas (API ou console) : ce script "
            "compare une copie restaurée à la source, il ne restaure pas une sauvegarde Atlas"
        ),
    }

    def ecrire(code: int, message: str) -> int:
        if code != 0:
            rapport["verdict"] = "prémisse (aucun verdict rendu ici)" if code == 2 else "écart mesuré"
            rapport["message"] = message
        if args.rapport:
            with open(args.rapport, "w", encoding="utf-8") as flux:
                flux.write(json.dumps(rapport, ensure_ascii=False, indent=2) + "\n")
        print(message, flush=True)
        return code

    if not args.uri:
        return ecrire(
            2,
            "PRÉMISSE : aucune URI (`--uri` ou MONGO_URL). Aucune restauration n'est "
            "simulée : ce script refuse de rendre un vert sans base à lire.",
        )
    if cible_nom == args.base:
        return ecrire(2, "REFUS : la cible est la base source — un exercice ne restaure pas par-dessus.")

    try:
        from pymongo import MongoClient

        client = MongoClient(args.uri, serverSelectionTimeoutMS=10000)
        client.admin.command("ping")
    except Exception as exc:  # pilote absent, réseau, authentification
        return ecrire(2, "PRÉMISSE : serveur injoignable (%s)." % exc)

    try:
        source = client[args.base]
        collections = source.list_collection_names()
        if not collections:
            return ecrire(
                2,
                "PRÉMISSE : la base « %s » n'existe pas ou est vide — il n'y a rien à "
                "restaurer, donc rien à prouver." % args.base,
            )
        manquantes = [n for n in COLLECTIONS_ATTENDUES if n not in collections]
        if manquantes:
            print(
                "⚠️  collection(s) attendue(s) absente(s) de la source : %s — l'exercice "
                "le dit au lieu de le passer sous silence." % ", ".join(manquantes),
                flush=True,
            )

        debut = time.monotonic()
        avant = empreinte_base(source)
        duree_empreinte = time.monotonic() - debut

        client.drop_database(cible_nom)
        cible = client[cible_nom]
        debut = time.monotonic()
        restaure = restaurer(source, cible)
        duree_restauration = time.monotonic() - debut

        debut = time.monotonic()
        apres = empreinte_base(cible)
        duree_verification = time.monotonic() - debut

        ecarts = comparer(avant, apres)
        rapport.update(
            {
                "collections": {nom: value["documents"] for nom, value in avant.items()},
                "documents": sum(value["documents"] for value in avant.values()),
                "duree_empreinte_s": round(duree_empreinte, 1),
                "duree_restauration_s": round(duree_restauration, 1),
                "duree_verification_s": round(duree_verification, 1),
                "rto_mesure_s": round(duree_empreinte + duree_restauration + duree_verification, 1),
                "documents_restaures": restaure["documents"],
                "ecarts": ecarts,
            }
        )
        if not args.garder:
            client.drop_database(cible_nom)
            rapport["base_travail_detruite"] = True

        if ecarts:
            return ecrire(1, "ÉCART(S) MESURÉ(S) : " + " ; ".join(ecarts))
        rapport["verdict"] = "identique"
        return ecrire(
            0,
            "✅ Restauration IDENTIQUE — %d document(s), %d collection(s), index compris, "
            "en %.1f s (RTO mesuré, cible %s)."
            % (rapport["documents"], len(avant), rapport["rto_mesure_s"], cible_nom),
        )
    finally:
        try:
            client.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
