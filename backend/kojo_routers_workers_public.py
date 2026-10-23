# -*- coding: utf-8 -*-
"""Profil PUBLIC d'un travailleur — la réputation qu'un client peut LIRE.

Pourquoi ce routeur existe. Les avis (`reviews`) et le portfolio
(`worker_profiles.portfolio_images`) étaient déjà en base, mais un client ne
pouvait les voir qu'en bas d'une fiche mission, et nulle part ailleurs : il n'y
avait donc aucun endroit où un travailleur CONSTRUIT une réputation visible, et
aucun endroit où un client choisit sur preuve. Le backend expose ici ce que le
site peut publier, sans ouvrir le document utilisateur.

Le choix qui gouverne tout le fichier : ALLOWLIST, pas denylist. La réponse est
CONSTRUITE champ par champ — elle ne part jamais d'un document Mongo amputé de
quelques clés. Un champ ajouté demain au modèle `User` (une pièce d'identité,
un identifiant de paiement, une coordonnée) reste donc privé par défaut, alors
qu'une denylist l'aurait publié sans que personne ne l'ait décidé. C'est la
même discipline que `JobPublic` pour la vue publique des missions, et elle est
mesurée par `tests/test_workers_public_profile.py` sur les CLÉS exactes de la
réponse, pas sur l'absence d'une valeur devinée.

Ce qui n'est JAMAIS public ici, et pourquoi :
  • `email`, `phone` : coordonnées directes — les publier exposerait chaque
    travailleur au démarchage et au harcèlement, et un annuaire public de
    numéros n'est pas ce que le produit promet ;
  • `geo`, `location.*` : position — la règle du dépôt vaut aussi pour les
    personnes (`AGENTS.md`, vue publique des jobs) ;
  • `payment_accounts` : numéros Orange Money/Wave — une donnée de paiement
    n'est pas une donnée de profil ;
  • `password_hash`, `password_version`, `google_sub`, `permissions`,
    `referral_*` : secrets ou internes, jamais lisibles de l'extérieur ;
  • l'identité complète d'un RÉVISEUR — seul son prénom sort, parce qu'un avis
    signé « Awa » reste un avis de client, alors qu'un avis signé d'un nom
    complet et de son auteur identifiable devient un profil qu'on n'a pas
    demandé à publier.

Ce que le routeur ne juge pas : la VÉRACITÉ des avis (elle est tenue à leur
création, mission terminée + participants seulement, `kojo_routers_reviews`),
ni l'ordre du portfolio (il appartient au travailleur).
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException

from kojo_core import db
# L'identifiant d'une entité se LIT à un domicile unique (`kojo_identifiants`),
# jamais recopié : le format a changé une fois dans l'histoire du dépôt, et un
# filtre écrit à la main cesserait silencieusement de retrouver les documents
# anciens. Garde : tests/test_identifiants_un_proprietaire.py.
from kojo_identifiants import identifiant_public, identifiant_query, identifiants_query

router = APIRouter()

# Les seule URLs d'image publiables (règle du dépôt : `photo_url` est toujours
# une URL Cloudinary absolue). Toute autre valeur est rendue `None` au lieu
# d'être servie telle quelle : une URL `javascript:` ou un chemin de fichier
# local dans un document legacy ne doit pas devenir un lien public.
PREFIXE_PHOTO_PUBLIABLE = "https://res.cloudinary.com/"

# Un avis pèse plus qu'un compteur : on en publie une page courte, la plus
# récente d'abord. Le total, lui, est public (`stats.rating_count`) — borner la
# LISTE ne cache donc pas la réputation, ça évite seulement de servir un
# document de plusieurs centaines de kilo-octets sur un réseau mobile.
MAX_AVIS_PUBLIES = 10

# Bornes de champs libres : celles du modèle (`User.bio` 1000, `skills` 20
# entrées ≤ 100 caractères). Recopiées ici parce que la lecture publique ne
# passe pas par le modèle — et une valeur hors borne ne doit pas sortir.
BIO_MAX = 1000
SKILLS_MAX = 20
SKILL_MAX = 100


def _texte(value, max_length: int):
    """Chaîne nettoyée et bornée, ou None — jamais un type inattendu rendu tel quel."""
    if value is None:
        return None
    texte = str(value).strip()
    if not texte:
        return None
    return texte[:max_length]


def _photo_publique(user: dict):
    """URL Cloudinary absolue et rien d'autre (voir PREFIXE_PHOTO_PUBLIABLE)."""
    for champ in ("profile_photo", "photo_url"):
        valeur = _texte(user.get(champ), 500)
        if valeur and valeur.startswith(PREFIXE_PHOTO_PUBLIABLE):
            return valeur
    return None


def _liste_de_texte(value, maximum: int, longueur_max: int):
    """Liste de chaînes bornée — une valeur non-liste rend une liste vide."""
    if not isinstance(value, list):
        return []
    sortie = []
    for element in value[:maximum]:
        if not isinstance(element, str):
            continue
        element = element.strip()
        if element:
            sortie.append(element[:longueur_max])
    return sortie


def _annee(value):
    """Année d'un `created_at` (datetime OU chaîne ISO), ou None.

    Les documents anciens stockent parfois une chaîne : refuser l'un des deux
    formats viderait `member_since` pour la moitié des comptes sans erreur.
    """
    if isinstance(value, datetime):
        return value.year
    texte = _texte(value, 40)
    if not texte:
        return None
    try:
        return datetime.fromisoformat(texte.replace("Z", "+00:00")).year
    except ValueError:
        return None


def _avis_public(avis: dict, prenom_du_reviseur):
    """Vue publique d'un avis : note, commentaire, date, PRÉNOM de l'auteur.

    `reviewer_first_name` peut être None (compte supprimé, ou réviseur qui n'est
    plus lisible) : l'avis reste publiable — un commentaire anonyme vaut mieux
    qu'un avis qui disparaît quand son auteur ferme son compte.
    """
    note = avis.get("rating")
    try:
        note = int(note)
    except (TypeError, ValueError):
        note = None
    return {
        "rating": note,
        "comment": _texte(avis.get("comment") or avis.get("text"), 1000),
        "created_at": avis.get("created_at"),
        "reviewer_first_name": prenom_du_reviseur,
    }


async def profil_public(worker_id: str):
    """La VUE PUBLIQUE d'un travailleur, ou None s'il n'y en a pas.

    C'est ici que l'allowlist vit, une seule fois : la route JSON (publique), la
    page HTML pré-rendue et la carte Open Graph lisent TOUTES les trois la même
    vue. Une seconde construction, écrite pour le pré-rendu, publierait un jour
    un champ de plus que la route — et c'est exactement ce que l'allowlist
    existe pour empêcher.

    Returns:
        dict | None — voir la route ci-dessous pour la forme exacte.
    """
    identifiant = _texte(worker_id, 100)
    if not identifiant:
        return None

    user = await db.users.find_one({**identifiant_query(identifiant)})
    if (
        not user
        or user.get("deleted")
        or str(user.get("user_type") or "").lower() != "worker"
    ):
        return None

    profil = await db.worker_profiles.find_one({"user_id": identifiant}) or {}

    # Les compteurs sont des requêtes COUNT indexées (`reviews.reviewee_id`,
    # `jobs.assigned_worker_id`) — pas un `len()` sur une liste ramenée en
    # mémoire, qui coûterait le document entier pour un chiffre.
    missions_terminees = await db.jobs.count_documents(
        {"assigned_worker_id": identifiant, "status": "completed", "deleted": {"$ne": True}}
    )
    nombre_avis = await db.reviews.count_documents({"reviewee_id": identifiant})

    # ── Litiges : le SEUL chiffre négatif de la réputation ────────────────
    # Une note moyenne se lit bien quand on a vingt avis ; elle ne dit rien de
    # la seule chose qu'un client redoute — que l'argent se bloque. Le nombre
    # de litiges ENGAGÉS sur les missions du travailleur et le nombre tranchés
    # en faveur du client se publient donc à côté de la note, même quand ils
    # valent zéro : une absence de litige est une information, et une fiche qui
    # la tairait laisserait croire que le sujet n'est pas suivi.
    #
    # Un litige RETIRÉ ne compte pas : l'accord a été retrouvé, il n'a jamais
    # été tranché. Un litige encore OUVERT compte — c'est un désaccord réel.
    litiges_engages = await db.jobs.count_documents(
        {
            "assigned_worker_id": identifiant,
            "dispute.state": {"$exists": True, "$ne": "withdrawn"},
            "deleted": {"$ne": True},
        }
    )
    litiges_perdus = await db.jobs.count_documents(
        {
            "assigned_worker_id": identifiant,
            "dispute.decision": "refund_client",
            "deleted": {"$ne": True},
        }
    )

    # La moyenne est celle que le routeur d'avis RECALCULE à chaque écriture
    # (une seule vérité). `None` — et non 0.0 — quand personne n'a encore noté :
    # un profil neuf ne doit pas s'afficher « 0 étoile », ce qui se lit comme un
    # mauvais avis alors qu'il n'y en a aucun.
    moyenne = None
    if nombre_avis:
        try:
            moyenne = round(float(user.get("rating") or 0.0), 1)
        except (TypeError, ValueError):
            moyenne = None

    avis_bruts = (
        await db.reviews.find({"reviewee_id": identifiant})
        .sort("created_at", -1)
        .limit(MAX_AVIS_PUBLIES)
        .to_list(length=MAX_AVIS_PUBLIES)
    )

    # Les prénoms des réviseurs, en UNE requête (au plus `MAX_AVIS_PUBLIES`
    # identifiants distincts) : une requête par avis ferait N+1 sur la seule
    # route publique que les crawlers et les visiteurs ouvrent en rafale.
    identifiants_reviseurs = sorted(
        {a.get("reviewer_id") for a in avis_bruts if a.get("reviewer_id")}
    )
    prenoms = {}
    if identifiants_reviseurs:
        curseur = db.users.find(
            {**identifiants_query(identifiants_reviseurs)},
            {"_id": 0, "id": 1, "first_name": 1},
        )
        async for reviseur in curseur:
            # La clé est l'identifiant RENDU (`identifiant_public`), pas le seul
            # champ `id` : un réviseur importé peut n'avoir que `_id`, et il
            # resterait alors sans prénom dans un avis par ailleurs publié.
            prenoms[identifiant_public(reviseur)] = _texte(reviseur.get("first_name"), 50)

    return {
        # L'identifiant RENDU (celui qui désigne vraiment le document) : un
        # compte importé peut n'avoir que `_id`, et la vue publique le rendrait
        # alors sans identifiant — donc inadressable.
        "id": identifiant_public(user),
        "first_name": _texte(user.get("first_name"), 50),
        "last_name": _texte(user.get("last_name"), 50),
        "user_type": "worker",
        "photo_url": _photo_publique(user),
        # `city` n'est pas un champ du modèle `User` : il vit, quand il existe,
        # sur le profil travailleur. On ne le DÉDUIT jamais d'une mission (ce
        # serait publier une adresse de chantier comme lieu de résidence).
        "city": _texte(user.get("city") or profil.get("city"), 100),
        "country": _texte(user.get("country"), 50),
        "created_at": user.get("created_at"),
        "skills": _liste_de_texte(user.get("skills"), SKILLS_MAX, SKILL_MAX),
        "bio": _texte(user.get("bio"), BIO_MAX),
        "languages": _liste_de_texte(user.get("languages"), 10, 10),
        "verified": bool(user.get("is_verified")) and not user.get("deleted"),
        "member_since": _annee(user.get("created_at")),
        "stats": {
            "missions_completed": int(missions_terminees or 0),
            "rating_average": moyenne,
            "rating_count": int(nombre_avis or 0),
            # Deux compteurs plutôt qu'un taux : un taux calculé sur trois
            # missions se lirait comme une garantie. L'écran décide quand un
            # ratio devient lisible, la donnée reste un FAIT.
            "disputes_total": int(litiges_engages or 0),
            "disputes_lost": int(litiges_perdus or 0),
        },
        "reviews": [
            _avis_public(avis, prenoms.get(avis.get("reviewer_id")))
            for avis in avis_bruts
        ],
    }


@router.get("/workers/{worker_id}")
async def get_public_worker_profile(worker_id: str):
    """Profil public d'un travailleur : identité professionnelle, réputation,
    missions terminées et derniers avis.

    Route PUBLIQUE (aucune authentification) : c'est la page qu'un client lit
    avant de confier une mission, et celle qu'un travailleur partage. Elle
    n'ouvre que des champs déclarés un par un (voir l'en-tête du module).

    404 — et non 403 — pour un compte qui n'est pas un travailleur, supprimé, ou
    inexistant : distinguer les trois dirait à un visiteur quels identifiants
    existent, sans rien lui apprendre d'utile.

    Returns:
        dict: {id, first_name, last_name, user_type, photo_url, city, country,
        created_at, skills, bio, languages, verified, member_since, stats,
        reviews} — voir `_avis_public` pour la forme d'un avis.
    """
    profil = await profil_public(worker_id)
    if profil is None:
        raise HTTPException(status_code=404, detail="Travailleur introuvable")
    return profil
