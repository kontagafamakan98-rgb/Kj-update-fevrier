# -*- coding: utf-8 -*-
"""Catégories de mission : la seule normalisation d'écriture → slug canonique.

Extrait de `kojo_routers_jobs.py` sans changement de comportement. Deux
consommateurs distincts posaient la même question — la CRÉATION (normaliser ce
qui est écrit) et la RECHERCHE (retrouver toutes les écritures d'un groupe) —
donc la table vit ici plutôt que chez l'un des deux.
"""
from typing import Optional


# --------------------------------------------------------------------------
# Catégories : normalisation multi-écritures (slugs FR legacy vs EN actuel)
# --------------------------------------------------------------------------
# Les anciens jobs et certains clients écrivent des catégories FR (plomberie,
# menuiserie…) alors que les filtres UI utilisent des slugs EN (plumbing…).
# _initialize_job_category ramène TOUT à un slug canonique à l'écriture, et
# le filtre liste interroge le groupe d'équivalence complet pour ne jamais
# rater un job legacy.
_CATEGORY_GROUPS: dict[str, list[str]] = {
    "general": ["general", "divers", "général", "generaliste", "généraliste"],
    "plumbing": ["plumbing", "plomberie", "plombier", "plomberie urgent", "plombier urgent",
        # Libellés FR prédéfinis (frontend WorkerRegistrationFields.js) : les
        # profils stockent CES libellés exacts, le matching doit les matcher.
        "installation sanitaire", "réparation fuites", "soudure",
        "débouchage canalisations", "installation chauffe-eau"],
    "electrical": ["electrical", "electricite", "électricité", "electricien", "électricien", "electronique", "électronique",
        "installation électrique", "dépannage électrique", "câblage",
        "tableau électrique", "éclairage"],
    "construction": ["construction", "batiment", "bâtiment", "maconnerie", "maçonnerie", "macon", "maçon", "peinture", "carrelage",
        "toiture", "coffrage"],
    "cleaning": ["cleaning", "menage", "ménage", "nettoyage", "femme de menage", "femme de ménage"],
    "gardening": ["gardening", "jardinage", "jardinier", "espace vert",
        "entretien jardin", "élagage", "plantation", "arrosage automatique", "paysagisme"],
    "tutoring": ["tutoring", "cours", "soutien scolaire", "professeur", "enseignant", "formation",
        "mathématiques", "français", "anglais", "sciences", "histoire-géographie",
        "physique-chimie", "informatique scolaire", "aide aux devoirs",
        "préparation examens"],
    "mechanics": ["mechanics", "mecanique", "mécanique", "mecanicien", "mécanicien", "garage", "auto",
        "réparation moteur", "diagnostic automobile", "carrosserie",
        "électricité auto", "climatisation auto"],
    # Menuiserie / ébénisterie : groupe prédéfini du frontend, absent de la
    # taxonomie historique (les jobs menuiserie tombaient en « general »).
    "carpentry": ["carpentry", "menuiserie", "menuisier", "ébénisterie", "ébéniste", "bois",
        "fabrication de meubles", "pose de portes", "pose de fenêtres",
        "menuiserie aluminium", "menuiserie bois", "placards et dressings",
        "cuisine sur mesure", "escaliers en bois", "finition et vernissage",
        "réparation de meubles"],
    # Informatique / réparation téléphone : groupe prédéfini du frontend, absent
    # de la taxonomie historique (le profil « Réparation PC » ne matchait rien).
    "computing": ["computing", "informatique", "informaticien", "ordinateur", "réparation pc",
        "installation logiciels", "réseaux", "maintenance", "formation",
        "réparation téléphone android", "réparation iphone",
        "changement écran téléphone"],
}

# Dictionnaire inverse : n'importe quelle écriture → slug canonique.
_CATEGORY_TO_CANONICAL: dict[str, str] = {
    variant.strip().lower(): group
    for group, variants in _CATEGORY_GROUPS.items()
    for variant in variants
}


def _normalize_job_category(value: Optional[str]) -> str:
    """Ramène n'importe quelle écriture de catégorie au slug canonique."""
    if not value:
        return "general"
    return _CATEGORY_TO_CANONICAL.get(str(value).strip().lower(), "general")


def _category_search_variants(value: str) -> list[str]:
    """Toutes les écritures stockées en base qui appartiennent au même groupe
    canonique (pour que le filtre retrouve les jobs legacy)."""
    canonical = _normalize_job_category(value)
    for group, variants in _CATEGORY_GROUPS.items():
        if group == canonical:
            return sorted({v.lower() for v in variants})
    return [canonical]
