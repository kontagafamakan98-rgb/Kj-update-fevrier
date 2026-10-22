# -*- coding: utf-8 -*-
"""RECHERCHE DES MISSIONS : un seul propriétaire des jetons, du pliage et de l'index.

Trois porteurs doivent prononcer la MÊME règle, sinon ils divergent en silence :

  • `kojo_db.create_database_indexes` crée l'index texte sur `CHAMPS_TEXTE`, avec
    `LANGUE_TEXTE` — un index qui ne couvrirait pas l'adresse ferait de
    « Plateau » une recherche sans résultat, sans que rien ne le dise ;
  • `kojo_routers_jobs_listing` envoie `$text` avec les termes de
    `termes_de_requete` : ni guillemet, ni tiret, jamais une expression ;
  • `tests/conftest.py` (FakeDB) matche `$text` avec `tokens_texte`. Sans ce
    partage, la doublure locale chercherait dans d'autres champs que l'index
    réel, ou avec un autre pliage, et la suite locale dirait autre chose que la
    CI (qui tourne sur un vrai MongoDB).

Ce qui a été MESURÉ avant d'écrire ces constantes (MongoDB 7.0.14, index
`default_language: "none"`, sonde sur trois missions) :

  • « senegal » trouve « Sénégal », « reparation » trouve « Réparation »,
    « SÉNÉGAL » aussi : l'index plie la CASSE et les ACCENTS, sans qu'on
    demande `$diacriticSensitive` (le défaut est `false`) ;
  • « plomb » ne trouve PAS « Plomberie » et « fuites » ne trouve PAS « fuite » :
    la langue « none » ne RADICALISE pas (avec « french », fuite/fuites se
    rejoignent — c'est la seule différence mesurée entre les deux langues) ;
  • plusieurs termes sont un OU, pas un ET : « plomberie urgente » a rendu
    AUSSI une mission qui ne porte que « plomberie » (catégorie) et pas
    « urgente ». C'est la sémantique de `$text` sans phrase, et elle est
    assumée : la recherche élargit, elle ne filtre pas ;
  • une chaîne entre guillemets devient une PHRASE, et un terme préfixé de `-`
    une NÉGATION.

Les deux derniers points sont la raison pour laquelle la requête DÉCOUPE la
saisie en termes : ce qu'un utilisateur tape n'est pas une expression à
interpréter. Et le premier est la raison pour laquelle le routeur GARDE un
repli `$regex` : l'index ne sait pas trouver une frappe partielle (« plomb »),
que la recherche par fragment trouve encore.
"""
import math
import re
import unicodedata

# ── L'INDEX ────────────────────────────────────────────────────────────────
# Les quatre champs que la recherche couvre, déclarés UNE fois : l'index les
# indexe, la doublure de test les lit. Le titre, la description, la catégorie
# et l'adresse — pas seulement les deux premiers, sinon « Dakar » ne trouve
# que les missions qui le citent dans leur prose.
CHAMPS_TEXTE = ("title", "description", "category", "location.address")

# « none » : casse et accents pliés par l'index, aucun radical (mesuré
# ci-dessus). Un radical français fusionnerait des mots que la catégorie
# n'a aucune raison de confondre, et la doublure de test devrait alors
# embarquer un radicaliseur pour dire la même chose que Mongo.
LANGUE_TEXTE = "none"

# Le nom est STABLE : `create_index` idempotent, et un index texte ne peut pas
# coexister avec un second sur la même collection (Mongo répond 67).
NOM_INDEX_TEXTE = "recherche_missions"

# Un mot de plus ne resserre pas : au-delà de huit termes, la requête dit
# « toutes ces conditions » sur une saisie qui n'a pas été composée pour ça, et
# chaque terme ajouté coûte un test d'index. Borné, donc — jamais silencieux :
# le routeur garde la saisie entière pour le repli `$regex`.
MAX_TERMES = 8

# ── LE TRI PAR DISTANCE ────────────────────────────────────────────────────
# Le tri par distance lit TOUS les candidats du filtre (Mongo ne sait pas
# trier par distance sans `$geoNear`, que la doublure de test refuse
# délibérément) : au-delà de ce plafond, le routeur REFUSE en nommant le
# remède (resserrer `radius_km`) plutôt que de rendre une page triée sur une
# partie des missions — une liste qui a l'air triée et ne l'est pas est pire
# qu'un refus.
MAX_CANDIDATS_DISTANCE = 500

# Le rayon de la Terre, en kilomètres : la MÊME valeur pour le tri par distance
# et pour le filtre `$centerSphere` du rayon (`radius_km / RAYON_TERRE_KM`).
# Deux constantes déplaceraient la frontière d'un rayon de quelques centaines de
# mètres, et une mission à la limite entrerait ou sortirait selon le chemin.
# 6371,0088 km : le rayon moyen IUGG.
RAYON_TERRE_KM = 6371.0088


def plier_casse_accents(texte) -> str:
    """Minuscules, sans accents, forme NFD recomposée en une seule passe.

    Même opération que celle de l'index (`senegal` ↔ `Sénégal`), pour que les
    termes envoyés à `$search` soient ceux que Mongo indexera : envoyer
    « SÉNÉGAL » fonctionne aussi, mais dépendre du pliage de l'index pour
    comparer nos propres jetons serait deux règles pour un seul fait.
    """
    decompose = unicodedata.normalize("NFKD", str(texte or "").lower())
    return "".join(caractere for caractere in decompose if not unicodedata.combining(caractere))


def tokens_texte(valeur) -> list:
    """Les jetons d'un texte, comme l'index les découpe : lettres et chiffres.

    `\\w` plutôt que `[a-z0-9]` : le dépôt publie aussi des libellés wolof,
    bambara et mossi, dont les lettres accentuées sont déjà pliées ici, mais
    une écriture non latine ne doit pas être réduite à rien (un jeton vide
    rendrait la recherche plus permissive qu'elle ne le dit).
    """
    return [jeton for jeton in re.split(r"[^\w]+", plier_casse_accents(valeur)) if jeton]


def termes_de_requete(texte) -> list:
    """Les termes envoyés à `$text` : des jetons, jamais des opérateurs.

    Guillemets, tirets et deux-points disparaissent avec la découpe : ils
    portent la syntaxe de `$search` (phrase, négation), et une saisie
    d'utilisateur n'a pas à décider de la forme de la requête. Bornés à
    `MAX_TERMES`, sans doublon (répéter un terme ne resserre rien).
    """
    vus = []
    for terme in tokens_texte(texte):
        if terme not in vus:
            vus.append(terme)
        if len(vus) >= MAX_TERMES:
            break
    return vus


def filtre_texte(termes) -> dict:
    """La clause `$text` d'une liste de termes.

    Mongo fait un OU des termes (mesuré) : plusieurs mots ÉLARGISSENT la
    recherche au lieu de la resserrer. Une phrase ne s'obtient qu'avec des
    guillemets, que `termes_de_requete` retire — donc jamais depuis une saisie.
    """
    return {"$text": {"$search": " ".join(termes)}}


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance orthodromique en kilomètres (haversine, rayon terrestre moyen).

    Même formule que `haversineKm` côté écran (`frontend/src/utils/workerTrustLevel.js`) :
    un ordre calculé ici et une distance affichée là doivent désigner le même
    point le plus proche, sinon la carte contredirait la liste.

    `RAYON_TERRE_KM` est partagé avec le filtre par rayon : sans cela, une
    mission à la limite d'un `radius_km` pourrait entrer par un chemin et
    sortir par l'autre.
    """
    rayon_km = RAYON_TERRE_KM
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * rayon_km * math.asin(math.sqrt(a))
