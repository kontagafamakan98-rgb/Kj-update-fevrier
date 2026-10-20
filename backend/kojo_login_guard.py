# -*- coding: utf-8 -*-
"""Verrouillage d'un COMPTE après des échecs de connexion répétés.

POURQUOI CE MODULE

Le rate-limiter ne connaît que des ADRESSES IP. En Afrique de l'Ouest, Orange,
Sonatel et Wave partagent quelques IP publiques entre des milliers d'abonnés
(CGNAT) : une limite par IP y est à la fois INJUSTE (elle punit des voisins qui
n'ont rien fait) et POREUSE (un credential stuffing réparti sur mille IP ne la
touche jamais). Le seul objet qui décrit l'attaque, c'est le COMPTE visé — et
c'est lui que ce module protège.

DEUX PROPRIÉTÉS, ET POURQUOI

  1. LE VERROU EST PORTÉ PAR LE DOCUMENT DU COMPTE, pas par une collection
     séparée ni par la mémoire du process : il survit à un redéploiement, il
     est PARTAGÉ par tous les workers (une limite en mémoire serait multipliée
     par le nombre de machines), et il disparaît avec le compte — donc
     l'export RGPD et la suppression n'ont rien de plus à connaître
     (`users` est déjà classée ; une collection de plus aurait exigé sa ligne
     dans `USER_DATA_SOURCES` et sa règle de conservation).
  2. LE COMPTE INCONNU N'EST PAS VERROUILLÉ. Un email qui n'existe pas n'a
     aucun document à marquer : la réponse reste 401, comme avant. Cela évite
     aussi qu'un verrou réponde 429 là où le compte n'existe pas — un 429 sur
     un email inconnu serait un annuaire des comptes existants.

LE COÛT, ASSUMÉ

Un tiers peut verrouiller le compte d'un utilisateur en échouant volontairement
huit fois. C'est le prix de toute protection par compte ; il est borné par une
durée COURTE (15 min, puis 30, puis 60 au plus) et par le fait qu'un succès
libère immédiatement. Un verrou permanent aurait transformé un déni de service
en suppression de compte.

CE QUE CE MODULE NE FAIT PAS

Il ne juge pas le MOT DE PASSE (c'est `verify_password`) et il ne remplace pas
le rate-limiter par IP, qui reste la première barrière : ce module est la
seconde, celle qui compte l'attaque du point de vue de la victime.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from kojo_db import db

# ── Les bornes, écrites une fois ────────────────────────────────────────────
# Huit échecs : assez pour qu'un mot de passe mal tapé ne verrouille pas un
# humain (trois ou quatre essais sont courants), assez peu pour qu'une
# attaque par dictionnaire coûte huit tentatives par fenêtre et par compte.
SEUIL_ECHECS = 8
# Fenêtre d'observation : au-delà, les échecs anciens ne comptent plus.
FENETRE_MINUTES = 15
# Verrou de base, doublé à chaque palier de `SEUIL_ECHECS` échecs, plafonné.
VERROU_BASE_SECONDS = 15 * 60
VERROU_MAX_SECONDS = 60 * 60


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _depuis_iso(valeur) -> Optional[datetime]:
    """Horodatage ISO → datetime, ou None (valeur absente ou illisible).

    Une valeur illisible n'est PAS traitée comme un verrou actif : elle
    laisserait un compte bloqué par une donnée corrompue. On la considère
    comme absente, et le prochain échec repose un verrou propre.
    """
    if not valeur:
        return None
    if isinstance(valeur, datetime):
        return valeur if valeur.tzinfo else valeur.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(valeur).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def secondes_de_verrou(user: Optional[dict]) -> int:
    """Secondes restantes de verrou pour ce compte (0 = pas verrouillé).

    Lue AVANT la vérification du mot de passe : un compte verrouillé refuse
    même le BON mot de passe, sinon le verrou ne protégerait rien.
    """
    if not user:
        return 0
    jusqu_a = _depuis_iso(user.get("login_locked_until"))
    if jusqu_a is None:
        return 0
    reste = int((jusqu_a - _maintenant()).total_seconds())
    return reste if reste > 0 else 0


def _duree_du_verrou(echecs: int) -> int:
    """Durée du verrou pour un nombre d'échecs cumulés.

    Doubler à chaque palier rend une attaque soutenue de plus en plus chère
    sans jamais dépasser `VERROU_MAX_SECONDS` : un compte ne peut pas être
    rendu inaccessible indéfiniment.
    """
    palier = max(1, echecs // SEUIL_ECHECS)
    return min(VERROU_BASE_SECONDS * (2 ** (palier - 1)), VERROU_MAX_SECONDS)


async def enregistrer_echec(user_id: str) -> int:
    """Compte un échec et pose le verrou au seuil. Rend le nombre d'échecs.

    Atomique (`$inc` puis lecture du résultat) : deux tentatives simultanées
    ne peuvent pas se perdre, et le seuil est franchi une seule fois par
    palier — un `find_one` puis `update_one` laisserait deux workers lire le
    même compte et poser deux verrous différents.

    Les échecs hors FENÊTRE repartent de zéro : sans cela, huit fautes de
    frappe étalées sur un an finiraient par verrouiller un compte légitime.
    """
    if not user_id:
        return 0
    maintenant = _maintenant()
    debut_de_fenetre = maintenant - timedelta(minutes=FENETRE_MINUTES)
    try:
        # Premier cas, ATOMIQUE : la fenêtre est expirée (ou n'a jamais
        # commencé). C'est le FILTRE qui porte la condition — un `find_one`
        # suivi d'un `$set` laisserait deux tentatives simultanées lire le même
        # compte et s'écraser l'une l'autre, donc le compteur sous-compterait
        # exactement quand l'attaque est parallèle.
        reprise = await db.users.update_one(
            {
                "id": user_id,
                "$or": [
                    {"login_last_failed_at": {"$lt": debut_de_fenetre.isoformat()}},
                    {"login_last_failed_at": {"$exists": False}},
                ],
            },
            {
                "$set": {
                    "login_failed_count": 1,
                    "login_last_failed_at": maintenant.isoformat(),
                }
            },
        )

        if reprise and reprise.matched_count:
            echecs = 1
        else:
            # Fenêtre en cours : `$inc` est atomique côté serveur. La relecture
            # ne sert qu'à décider du VERROU ; se tromper d'une unité sur ce
            # seuil retarde un verrou d'un échec, il ne le supprime pas.
            await db.users.update_one(
                {"id": user_id},
                {
                    "$inc": {"login_failed_count": 1},
                    "$set": {"login_last_failed_at": maintenant.isoformat()},
                },
            )
            relu = await db.users.find_one(
                {"id": user_id}, {"_id": 0, "login_failed_count": 1}
            )
            echecs = int((relu or {}).get("login_failed_count") or 1)

        if echecs >= SEUIL_ECHECS and echecs % SEUIL_ECHECS == 0:
            verrou = maintenant + timedelta(seconds=_duree_du_verrou(echecs))
            await db.users.update_one(
                {"id": user_id},
                {"$set": {"login_locked_until": verrou.isoformat()}},
            )
        return echecs
    except Exception as exc:  # une panne de la garde ne doit pas empêcher de se connecter
        # On ne refuse PAS la connexion parce que le compteur n'a pas pu être
        # écrit : le rate-limiter par IP reste appliqué, et un utilisateur
        # légitime ne doit pas être bloqué par une base momentanément lente.
        from kojo_settings import logger

        logger.warning(f"⚠️ Verrouillage de compte : échec non enregistré ({exc})")
        return 0


async def oublier_echecs(user_id: str) -> None:
    """Connexion RÉUSSIE : les compteurs et le verrou disparaissent.

    C'est ce qui rend le verrou supportable : la victime qui se souvient de son
    mot de passe n'attend pas la fin du délai.
    """
    if not user_id:
        return
    try:
        await db.users.update_one(
            {"id": user_id},
            {
                "$unset": {
                    "login_failed_count": "",
                    "login_last_failed_at": "",
                    "login_locked_until": "",
                }
            },
        )
    except Exception as exc:
        from kojo_settings import logger

        logger.warning(f"⚠️ Verrouillage de compte : compteurs non purgés ({exc})")
