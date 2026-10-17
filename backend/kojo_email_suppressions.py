# -*- coding: utf-8 -*-
"""Adresses email injoignables : arrêter d'écrire dans le vide.

── Le fait que ce module répare ───────────────────────────────────────────
Un envoi transactionnel qui échoue ne fait rougir personne. L'API du
fournisseur répond 200, le message part, et le rebond — quand il revient —
n'est lu par aucun humain : il n'existe que dans un tableau de bord que
personne n'ouvre. Les codes OTP et les réinitialisations repartaient donc
indéfiniment vers des boîtes inexistantes, et l'utilisateur attendait un code
qui ne viendrait jamais, sans que rien ne le dise.

Resend PUBLIE ces faits (webhook signé) ; ce module les reçoit, les journalise
et retient l'adresse. C'est la moitié « arrêter » de la chaîne : sans lui, la
connaissance du rebond ne change rien à ce qui est envoyé.

── Deux collections, deux rôles ───────────────────────────────────────────
  * `email_delivery_events` — le JOURNAL des faits reçus. `id_evenement`
    (l'en-tête `svix-id` de la requête) y est UNIQUE : une re-livraison du même
    fait par Resend est absorbée par la contrainte, exactement comme
    `business_events.cle` absorbe un jalon écrit deux fois. Il porte une règle
    de conservation (kojo_retention) : c'est une trace, pas un état, et
    `recu_le` est un DATETIME — un index TTL ne mord pas sur une chaîne ISO ;
  * `email_suppressions` — l'ÉTAT : cette adresse est injoignable, depuis
    quand, d'après quel fait. Il NE périme PAS : lever une suppression est une
    DÉCISION (le propriétaire la prend), pas une horloge. Rendre l'adresse
    joignable par simple écoulement du temps, c'est se remettre à écrire dans
    le vide — le défaut que ce module existe pour corriger.

── Ce qui supprime, ce qui alerte ─────────────────────────────────────────
Suppriment, parce que le fait est DÉFINITIF :
  * `email.bounced` avec `bounce.type == "permanent"` (la boîte n'existe pas) ;
  * `email.complained` (le destinataire nous a signalés comme indésirables :
    continuer à écrire est le meilleur moyen de ne plus jamais être livré).

Ne suppriment pas, mais se font voir :
  * `email.bounced` transitoire, et de type ILLISIBLE — supprimer est
    irréversible pour l'expéditeur, donc on ne le fait que sur un fait nommé ;
    le fait est journalisé tel quel et le comptage continue ;
  * `email.delivery_delayed`.
Ces derniers sont comptés DEPUIS LA DERNIÈRE LIVRAISON RÉUSSIE de l'adresse
(une réussite remet donc le compteur à zéro sans qu'on ait à l'écrire), et le
propriétaire est prévenu à chaque multiple du seuil : une série qui dure se
voit, sans qu'un premier rebond déclenche une alerte inutile.

── Le filtre est UN point de règle ────────────────────────────────────────
`adresse_supprimee` est consulté par `kojo_email.send_email_via_active_provider`
— le point par lequel passent déjà l'OTP, les reçus et les alertes
propriétaire. Aucun envoi produit ne peut donc atteindre une adresse retenue,
quel que soit l'appelant ; `backend/tests/test_email_send_points.py` refuse
qu'un module produise un envoi en contournant ce point.
"""

import base64
import binascii
import hashlib
import hmac
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from kojo_core import db
from kojo_settings import (
    EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD,
    EMAIL_WEBHOOK_TOLERANCE_SECONDS,
    RESEND_WEBHOOK_SECRET,
    logger,
)

COLLECTION_JOURNAL = "email_delivery_events"
COLLECTION_SUPPRESSIONS = "email_suppressions"

# Ce que le fournisseur annonce, traduit en trois familles de conséquences.
MOTIF_REBOND_PERMANENT = "bounce_permanent"
MOTIF_REBOND_TRANSITOIRE = "bounce_transitoire"
MOTIF_PLAINTE = "complaint"
MOTIF_RETARD = "delivery_delayed"
MOTIF_LIVRAISON = "delivered"

MOTIFS_QUI_SUPPRIMENT = (MOTIF_REBOND_PERMANENT, MOTIF_PLAINTE)
MOTIFS_COMPTES = (MOTIF_REBOND_TRANSITOIRE, MOTIF_RETARD)

# Types d'événements Resend que nous interprétons. Les autres sont ignorés,
# jamais refusés : Resend re-livre toute requête non-2xx, donc refuser un type
# qu'on ne suit pas produirait une tempête de re-livraisons pour un fait qui ne
# nous concerne pas.
TYPES_SUIVIS = frozenset(
    {"email.bounced", "email.complained", "email.delivered", "email.delivery_delayed"}
)

# Code d'une violation d'index UNIQUE, côté pymongo comme côté doublure de test
# (même convention que kojo_scheduler.acquerir_bail).
_CODE_DOUBLON = 11000

# Le message du fournisseur est du texte libre, souvent BEAUCOUP plus long que
# ce qu'il faut pour agir, et il recopie fréquemment l'adresse du destinataire.
# Borné à l'écriture : c'est une trace de diagnostic, pas une archive.
MESSAGE_MAX = 300

PREFIXE_SECRET = "whsec_"


class WebhookRefuse(Exception):
    """Une requête de webhook refusée, avec son MOTIF et son code HTTP.

    Jamais un booléen : la route publie le motif (c'est ce qui rend un refus
    diagnostiquable), et le code décide du sort de la requête — 503 quand la
    fonctionnalité n'est pas configurée, 401 quand la signature ne prouve pas
    que l'appelant est Resend.
    """

    def __init__(self, motif: str, statut: int = 401):
        super().__init__(motif)
        self.motif = motif
        self.statut = statut


def adresse_boite(email: str) -> str:
    """L'adresse de la BOÎTE : minuscules, sans l'étiquette `+tag`.

    `prenom+kojo-probe-1234@gmail.com` et `prenom@gmail.com` sont la MÊME
    boîte : un rebond reçu sur l'une dit le même fait sur l'autre, donc la
    suppression doit porter sur la boîte. Sans cela, envoyer une fois avec une
    étiquette suffirait à faire écrire une adresse qu'on vient de retenir —
    échappatoire d'autant plus réelle que les sondes du dépôt envoient
    précisément vers des alias `+kojo-probe-…`.
    """
    valeur = (email or "").strip().lower()
    local, separateur, domaine = valeur.partition("@")
    if not separateur:
        return valeur
    return local.split("+", 1)[0] + "@" + domaine


def _entete(entetes, nom: str) -> str:
    """Une en-tête HTTP, insensible à la casse et à la classe du conteneur.

    `request.headers` (Starlette) est insensible à la casse de lui-même, un
    dict ordinaire non : lire un seul des deux rendrait la vérification
    impossible selon l'appelant. Un mapping vide rend une chaîne vide, donc un
    refus nommé (« en-tête absent ») au lieu d'une exception.
    """
    if not entetes:
        return ""
    getter = getattr(entetes, "get", None)
    valeur = getter(nom) if getter else None
    if valeur is None and hasattr(entetes, "items"):
        for cle, contenu in entetes.items():
            if str(cle).lower() == nom.lower():
                valeur = contenu
                break
    return str(valeur).strip() if valeur is not None else ""


def verifier_signature(corps: bytes, entetes, *, maintenant: Optional[float] = None) -> str:
    """L'identifiant de l'événement, si et seulement si la signature est celle de Resend.

    Le contrat Svix est celui de Resend : HMAC-SHA256 sur
    `svix-id.svix-timestamp.corps`, clé = le secret `whsec_…` DÉCODÉ du base64.
    Trois précisions qui ont chacune un mode d'échec réel :

      * le corps est celui REÇU, en octets — un corps re-sérialisé ne signe plus
        la même chose, donc la vérification échouerait sur une requête légitime ;
      * l'horodatage est borné (`EMAIL_WEBHOOK_TOLERANCE_SECONDS`) : sans borne,
        une requête signée capturée une fois se rejoue à jamais, et rejouer
        suffit ici à retenir une adresse ;
      * la comparaison est en temps constant (`hmac.compare_digest`) : une
        comparaison naïve laisse mesurer la signature octet par octet.

    Lève `WebhookRefuse` (motif nommé) plutôt que de rendre un booléen : un
    refus muet oblige à recouper le journal du fournisseur pour comprendre.
    """
    secret = (RESEND_WEBHOOK_SECRET or "").strip()
    if not secret:
        raise WebhookRefuse(
            "webhook email désactivé : RESEND_WEBHOOK_SECRET n'est pas configuré — "
            "sans secret la signature ne peut pas être vérifiée, et retenir une "
            "adresse sur la parole du premier venu ferait taire les emails d'un tiers "
            "(poser le Signing Secret du webhook Resend, puis redéployer)",
            statut=503,
        )

    identifiant = _entete(entetes, "svix-id")
    horodatage = _entete(entetes, "svix-timestamp")
    signature_recue = _entete(entetes, "svix-signature")
    manquants = [
        nom
        for nom, valeur in (
            ("svix-id", identifiant),
            ("svix-timestamp", horodatage),
            ("svix-signature", signature_recue),
        )
        if not valeur
    ]
    if manquants:
        raise WebhookRefuse(
            "en-tête(s) de signature absent(s) : %s — la requête ne prouve pas "
            "qu'elle vient de Resend" % ", ".join(manquants)
        )

    try:
        emis_le = int(horodatage)
    except (TypeError, ValueError):
        raise WebhookRefuse(
            "svix-timestamp illisible : %r (un horodatage en secondes est attendu)"
            % (horodatage,)
        )

    instant = time.time() if maintenant is None else float(maintenant)
    ecart = abs(instant - emis_le)
    if ecart > EMAIL_WEBHOOK_TOLERANCE_SECONDS:
        raise WebhookRefuse(
            "signature hors de sa fenêtre de fraîcheur : %.0f s d'écart, %d tolérées "
            "(une signature sans borne temporelle se rejoue à jamais)"
            % (ecart, EMAIL_WEBHOOK_TOLERANCE_SECONDS)
        )

    if not secret.startswith(PREFIXE_SECRET):
        raise WebhookRefuse(
            "RESEND_WEBHOOK_SECRET illisible : un secret Svix commence par "
            "`%s` (valeur reçue : %d caractère(s))" % (PREFIXE_SECRET, len(secret)),
            statut=503,
        )
    try:
        cle = base64.b64decode(secret[len(PREFIXE_SECRET):], validate=True)
    except (binascii.Error, ValueError):
        raise WebhookRefuse(
            "RESEND_WEBHOOK_SECRET illisible : la partie après `%s` doit être du "
            "base64 (recopier le Signing Secret tel que Resend l'affiche)"
            % PREFIXE_SECRET,
            statut=503,
        )

    signe = ("%s.%s." % (identifiant, horodatage)).encode("utf-8") + corps
    attendu = base64.b64encode(hmac.new(cle, signe, hashlib.sha256).digest()).decode("ascii")

    # `svix-signature` porte une ou plusieurs signatures séparées par des
    # espaces, chacune `version,signature` : plusieurs pendant une rotation de
    # secret. Seules les `v1` sont comparées — une version inconnue n'est pas
    # une signature valide.
    for element in signature_recue.split():
        version, separateur, valeur = element.partition(",")
        if separateur and version.strip() == "v1" and hmac.compare_digest(valeur.strip(), attendu):
            return identifiant
    raise WebhookRefuse(
        "signature invalide : la requête ne vient pas de Resend (ou le secret "
        "configuré n'est pas celui de ce webhook)"
    )


def _premier_destinataire(valeur: Any) -> str:
    """L'adresse visée, que le fournisseur l'annonce en liste ou en chaîne.

    Les exemples documentés par Resend portent `data.to` en TABLEAU ; la forme
    scalaire est acceptée parce qu'un champ qui change de forme côté fournisseur
    ne doit pas transformer toute la file de webhooks en 400.
    """
    if isinstance(valeur, (list, tuple)):
        return str(valeur[0]).strip() if valeur else ""
    return str(valeur or "").strip()


def lire_fait(payload: Any) -> Optional[Dict[str, Any]]:
    """Le fait utile d'une charge utile, ou `None` si elle n'en porte aucun suivi.

    `None` n'est PAS un refus : c'est un type d'événement que nous ne suivons
    pas (Resend en envoie d'autres). La route répond alors 200 en le NOMMANT —
    refuser ferait re-livrer indéfiniment un fait qui ne nous concerne pas.

    Lève `WebhookRefuse` sur une charge utile ininterprétable (pas d'objet, pas
    de `data`, pas de destinataire) : là, c'est un fait qui devait nous
    concerner et qu'on ne sait pas lire — le taire serait la surface aveugle
    que ce module existe pour fermer.
    """
    if not isinstance(payload, dict):
        raise WebhookRefuse("charge utile sans objet JSON", statut=400)

    type_evenement = str(payload.get("type") or "").strip().lower()
    donnees = payload.get("data")
    if not isinstance(donnees, dict):
        raise WebhookRefuse(
            "charge utile sans « data » : rien à lire (type annoncé %r)"
            % (type_evenement or "?"),
            statut=400,
        )

    if type_evenement not in TYPES_SUIVIS:
        return None

    destinataire = _premier_destinataire(donnees.get("to"))
    if not destinataire:
        raise WebhookRefuse(
            "charge utile sans destinataire (« data.to ») pour un événement %r : "
            "aucune adresse à retenir" % type_evenement,
            statut=400,
        )

    rebond: Dict[str, Any] = {}
    if type_evenement == "email.bounced":
        brut = donnees.get("bounce")
        rebond = brut if isinstance(brut, dict) else {}
        type_rebond = str(rebond.get("type") or "").strip().lower()
        motif = MOTIF_REBOND_PERMANENT if type_rebond == "permanent" else MOTIF_REBOND_TRANSITOIRE
    elif type_evenement == "email.complained":
        motif = MOTIF_PLAINTE
    elif type_evenement == "email.delivered":
        motif = MOTIF_LIVRAISON
    else:
        motif = MOTIF_RETARD

    return {
        "type_evenement": type_evenement,
        "email": adresse_boite(destinataire),
        "motif": motif,
        "type_rebond": str(rebond.get("type") or "").strip() or None,
        "sous_type": str(rebond.get("subType") or "").strip() or None,
        "message": (str(rebond.get("message") or "").strip() or None),
    }


def _document_de_journal(
    fait: Dict[str, Any], id_evenement: str, fournisseur: str, recu_le: datetime
) -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "id_evenement": id_evenement,
        "email": fait["email"],
        "type_evenement": fait["type_evenement"],
        "motif": fait["motif"],
        "type_rebond": fait.get("type_rebond"),
        "sous_type": fait.get("sous_type"),
        "message": (fait.get("message") or "")[:MESSAGE_MAX] or None,
        "fournisseur": fournisseur,
        # DATETIME, jamais une chaîne ISO : la règle de conservation de ce
        # journal est un index TTL, et un index TTL ne mord que sur une date
        # BSON — une chaîne ISO ne périmerait jamais, en silence.
        "recu_le": recu_le,
    }


async def compter_rebonds_consecutifs(email: str) -> int:
    """Les rebonds NON définitifs reçus depuis la dernière livraison réussie.

    « Consécutifs » se lit ici sans état supplémentaire : on compte les faits
    postérieurs à la dernière `delivered`. Une livraison qui réussit remet donc
    le compteur à zéro par construction, et rien n'a besoin d'être remis à zéro
    à la main (un compteur à réinitialiser finit par ne plus l'être).

    La borne est STRICTE, et la limite qu'elle porte est nommée : MongoDB ne
    conserve une date qu'à la MILLISECONDE, donc deux faits de la même
    milliseconde ne sont plus ordonnables (mesuré : deux instants à 400 µs
    d'écart relus identiques). Un rebond qui partage la milliseconde de la
    dernière livraison n'est alors pas compté — l'erreur va dans le sens sûr,
    une alerte retardée d'un rebond plutôt que déclenchée à tort.
    """
    adresse = adresse_boite(email)
    journal = db[COLLECTION_JOURNAL]
    derniere_reussite = await journal.find_one(
        {"email": adresse, "motif": MOTIF_LIVRAISON}, sort=[("recu_le", -1)]
    )
    filtre: Dict[str, Any] = {"email": adresse, "motif": {"$in": list(MOTIFS_COMPTES)}}
    if derniere_reussite and derniere_reussite.get("recu_le") is not None:
        filtre["recu_le"] = {"$gt": derniere_reussite["recu_le"]}
    return await journal.count_documents(filtre)


async def _retenir(adresse: str, fait: Dict[str, Any], fournisseur: str, quand: datetime) -> None:
    """Marque l'adresse injoignable. Idempotent par construction.

    `$setOnInsert` pose la PREMIÈRE date (celle qui compte pour dire « depuis
    quand »), `$set` la dernière, et `$inc` compte les faits : deux rebonds
    permanents sur la même adresse disent une adresse et une histoire, pas deux
    lignes à réconcilier.
    """
    await db[COLLECTION_SUPPRESSIONS].update_one(
        {"email": adresse},
        {
            "$set": {
                "motif": fait["motif"],
                "type_rebond": fait.get("type_rebond"),
                "sous_type": fait.get("sous_type"),
                "message": (fait.get("message") or "")[:MESSAGE_MAX] or None,
                "fournisseur": fournisseur,
                "dernier_fait_le": quand,
            },
            "$setOnInsert": {
                "email": adresse,
                "premier_fait_le": quand,
                "id": str(uuid.uuid4()),
            },
            "$inc": {"faits": 1},
        },
        upsert=True,
    )


async def enregistrer_fait(
    fait: Dict[str, Any],
    *,
    id_evenement: str,
    fournisseur: str = "resend",
    quand: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Journalise un fait et applique sa conséquence. Rend ce qu'il a fait.

    `nouveau` vaut False sur une RE-LIVRAISON du même événement (`id_evenement`
    déjà journalisé) : Resend rejoue une requête dont il n'a pas vu la réponse,
    et compter ce fait deux fois fausserait le compteur de rebonds comme
    l'alerte. L'index unique est la garantie ; la lecture préalable évite d'en
    dépendre pour le cas courant.
    """
    maintenant = quand or datetime.now(timezone.utc)
    adresse = fait["email"]
    journal = db[COLLECTION_JOURNAL]

    bilan: Dict[str, Any] = {
        "nouveau": False,
        "motif": fait["motif"],
        "adresse": adresse,
        "supprime": False,
        "rebonds_consecutifs": 0,
        "alerte_due": False,
    }

    if await journal.find_one({"id_evenement": id_evenement}) is not None:
        return bilan
    try:
        await journal.insert_one(
            _document_de_journal(fait, id_evenement, fournisseur, maintenant)
        )
    except Exception as exc:  # doublon d'index unique : le fait est déjà traité
        if getattr(exc, "code", None) == _CODE_DOUBLON:
            return bilan
        raise

    bilan["nouveau"] = True

    if fait["motif"] in MOTIFS_QUI_SUPPRIMENT:
        await _retenir(adresse, fait, fournisseur, maintenant)
        bilan["supprime"] = True
        logger.warning(
            "🚫 Adresse retenue (%s) : plus aucun email ne lui sera envoyé — %s",
            fait["motif"],
            adresse,
        )

    if fait["motif"] in MOTIFS_COMPTES:
        consecutifs = await compter_rebonds_consecutifs(adresse)
        bilan["rebonds_consecutifs"] = consecutifs
        # À chaque multiple du seuil : la série se voit sans qu'un premier
        # rebond (banal : boîte pleine) déclenche une alerte.
        bilan["alerte_due"] = bool(
            consecutifs and consecutifs % EMAIL_SOFT_BOUNCE_ALERT_THRESHOLD == 0
        )

    return bilan


async def adresse_supprimee(email: str) -> Optional[Dict[str, Any]]:
    """Le document de suppression de cette adresse, ou None si elle est joignable.

    C'est ce que consulte le point de règle de l'envoi. Rendre le DOCUMENT (et
    non un booléen) laisse l'appelant nommer le motif dans son message — « vous
    avez signalé nos emails comme indésirables » ne se dit pas comme « cette
    boîte n'existe pas ».
    """
    adresse = adresse_boite(email)
    if not adresse:
        return None
    return await db[COLLECTION_SUPPRESSIONS].find_one({"email": adresse})


async def lister_suppressions(limite: int = 200) -> List[Dict[str, Any]]:
    """Les adresses retenues, la plus récemment retenue d'abord.

    Bornée : c'est une vue d'exploitation, pas un export de base. La borne est
    annoncée par l'appelant (`count` vs longueur), jamais silencieuse.
    """
    curseur = (
        db[COLLECTION_SUPPRESSIONS]
        .find({})
        .sort("dernier_fait_le", -1)
        .limit(max(1, int(limite)))
    )
    return [document async for document in curseur]


async def lever_suppression(email: str) -> bool:
    """Rend l'adresse joignable : une DÉCISION, jamais un délai qui s'écoule.

    Sert les cas réels — la boîte a été recréée, l'utilisateur a changé
    d'adresse, ou un fait a été mal classé — sans qu'il faille écrire en base
    de production à la main, ce qui laisserait aucune trace de qui a décidé.
    """
    adresse = adresse_boite(email)
    if not adresse:
        return False
    resultat = await db[COLLECTION_SUPPRESSIONS].delete_one({"email": adresse})
    return bool(getattr(resultat, "deleted_count", 0))


async def etat_des_suppressions(limite: int = 200) -> Tuple[List[Dict[str, Any]], int]:
    """(adresses retenues, total). Le total dit si la liste a été tronquée."""
    documents = await lister_suppressions(limite)
    total = await db[COLLECTION_SUPPRESSIONS].count_documents({})
    return documents, total
