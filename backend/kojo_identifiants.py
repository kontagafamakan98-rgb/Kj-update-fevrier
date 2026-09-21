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


def identifiant_query(valeur: str, champs=("id",)) -> dict:
    """Filtre qui retrouve un document, quelle que soit la forme de son identifiant.

    Couvre les champs applicatifs demandés (`id`, plus `job_id` pour les anciens
    jobs), `_id` sous sa forme CHAÎNE (jeux importés) et `_id` en ObjectId quand
    la valeur en est un (usage Mongo normal).

    L'appelant l'utilise tel quel dans `find_one`, `update_one` ou `delete_one`,
    en ajoutant le propriétaire (`user_id`) quand la ressource appartient à un
    compte : l'identifiant dit QUOI, jamais À QUI.
    """
    candidats = [{champ: valeur} for champ in champs]
    candidats.append({"_id": valeur})
    if ObjectId.is_valid(valeur):
        candidats.append({"_id": ObjectId(valeur)})
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
