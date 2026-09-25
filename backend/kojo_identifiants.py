# -*- coding: utf-8 -*-
"""Ce qui identifie un document, et comment le retrouver par ce que le client a vu.

Un même document peut porter son identifiant de trois façons selon son
historique : la chaîne applicative (`id`), un ancien champ métier (`job_id`
pour les missions), ou la clé primaire de Mongo (`_id`) — posée par la base,
tantôt en ObjectId, tantôt en chaîne dans les jeux importés.

Deux règles en découlent, et chacune vivait recopiée d'un routeur à l'autre :

  - RETROUVER un document par l'identifiant que le client a reçu (`_query`) ;
  - RENDRE un identifiant qui désigne vraiment quelque chose (`_public`).

Les notifications ont payé la seconde : un document sans champ `id` était lu
avec le défaut du modèle (`uuid4`), donc chaque lecture rendait un identifiant
DIFFÉRENT — l'id affiché ne désignait rien, la suppression répondait 404, et
la notification restait à l'écran. Un identifiant qui change à chaque lecture
n'est pas un identifiant.
"""
from bson import ObjectId


def _formes_stockables(valeur: str) -> list:
    """Les formes sous lesquelles un document peut AVOIR stocké cet identifiant.

    L'identifiant rendu au client est TOUJOURS une chaîne (`identifiant_public`),
    mais ce que le document porte peut être d'une autre forme — un jeu IMPORTÉ
    (JSON, export d'une base antérieure) écrit `2` ou un ObjectId là où l'app
    écrit un uuid. Chaque forme qui correspond à la chaîne rendue est donc un
    candidat de recherche.

    Sans elles, la ligne est affichée avec un identifiant stable mais
    INADRESSABLE : la suppression et le marquage « lu » répondent 404, le
    serveur garde la ligne, et l'écran la ramène au rafraîchissement suivant
    (symptôme « la notification montre toujours 1 et refuse de disparaître »).

    L'ordre compte : la forme donnée d'abord (c'est celle de l'app, la plus
    fréquente) ; les autres ne sont que des replis d'import.
    """
    formes = [valeur]
    if ObjectId.is_valid(valeur):
        formes.append(ObjectId(valeur))
    try:
        nombre = int(valeur)
    except (TypeError, ValueError):
        nombre = None
    if nombre is not None:
        formes.append(nombre)
        formes.append(float(nombre))
    return formes


def identifiant_query(valeur: str, champs=("id",)) -> dict:
    """Filtre qui retrouve un document, quelle que soit la forme de son identifiant.

    Couvre les champs applicatifs demandés (`id`, plus `job_id` pour les anciens
    jobs), `_id` sous sa forme CHAÎNE (jeux importés), `_id` en ObjectId quand la
    valeur en est un (usage Mongo normal) — et, POUR CHAQUE champ applicatif, les
    formes non-chaînes qu'un document importé peut porter (`2` en entier,
    ObjectId) ; voir `_formes_stockables`.

    L'appelant l'utilise tel quel dans `find_one`, `update_one` ou `delete_one`,
    en ajoutant le propriétaire (`user_id`) quand la ressource appartient à un
    compte : l'identifiant dit QUOI, jamais À QUI.
    """
    formes = _formes_stockables(valeur)
    candidats = [{champ: forme} for champ in champs for forme in formes]
    candidats.extend({"_id": forme} for forme in formes)
    return {"$or": candidats}


def identifiant_job_query(valeur: str) -> dict:
    """Le filtre d'un DOCUMENT de la collection `jobs`.

    Une mission a porté son identifiant de deux façons selon son âge : `id`
    aujourd'hui, `job_id` pour les anciennes — et `_id` pour les jeux importés.
    C'est un fait de CETTE collection, donc il vit ici, une fois : les six
    modules de la famille `jobs` s'en servaient chacun de leur côté, et deux
    d'entre eux avaient déjà perdu l'alias legacy (la mission ancienne n'était
    plus adressable par l'identifiant que le client avait reçu).
    """
    return identifiant_query(valeur, ("id", "job_id"))


def identifiant_public(document: dict) -> str:
    """L'identifiant ADRESSABLE d'un document, tel qu'il est rendu au client.

    Le champ applicatif quand il existe ; sinon la clé primaire de Mongo, stable
    et unique par construction. Un défaut de modèle pydantic ne peut PAS servir
    ici : évalué à la lecture, il change à chaque requête, et l'identifiant
    affiché ne désigne plus rien — donc toute action dessus vise à côté.
    """
    return str(document.get("id") or document.get("_id") or "")


def dump_stable(modele, document: dict, **options) -> dict:
    """Sérialise un document stocké en RENDANT l'identifiant DU DOCUMENT.

    Un modèle dont le champ `id` porte un défaut (`uuid4`) en reçoit un NOUVEAU
    à chaque construction : lu depuis la base sans champ `id`, il rend donc un
    identifiant différent à chaque requête, qui ne désigne aucun document —
    l'action du client répond 404 et l'écran ment (le bug des notifications,
    et le même sur les missions anciennes, qui portent `job_id` au lieu de `id`).

    C'est le SEUL endroit qui décide comment un document stocké devient une
    réponse. Les sites qui construisaient le modèle à la main recopiaient
    chacun la même ligne, et la reprise de l'identifiant y manquait.

    Un document qui ne porte NI `id` NI `_id` (une entrée construite depuis la
    requête, pas encore écrite) garde le défaut du modèle : c'est alors un
    document neuf, et son identifiant est légitime.
    """
    # Un document importé peut porter son `id` sous une forme non-chaîne
    # (nombre, ObjectId). Le modèle le refuse (`id: str`) et pydantic lève : la
    # liste ENTIÈRE répondrait 500 — un seul document d'un vieux jeu suffisait
    # donc à vider le centre de notifications. On rend d'abord la forme
    # canonique du champ, puis `identifiant_public` en décide.
    if "id" in document and document["id"] is not None and not isinstance(document["id"], str):
        document = {**document, "id": str(document["id"])}
    rendu = modele(**document).model_dump(**options)
    identifiant = identifiant_public(document)
    if identifiant and "id" in rendu:
        rendu["id"] = identifiant
    return rendu
