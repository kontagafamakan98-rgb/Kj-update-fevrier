# -*- coding: utf-8 -*-
"""Faits de conservation des données — propriétaire UNIQUE.

Pendant combien de temps une donnée vit en base était jusqu'ici écrit à deux
endroits qui ne se parlaient pas : `expireAfterSeconds` en clair dans l'index
TTL de `kojo_core`, et la durée réellement inscrite dans le document à la
création (`expires_at` d'un paiement, d'un OTP, d'un jeton révoqué). Autrement
dit, personne ne pouvait répondre « combien de temps gardez-vous ceci ? » sans
recouper trois fichiers, et rien n'empêchait un chiffre publié de mentir.

Ce module est désormais la SEULE source :

  * `kojo_core.create_database_indexes` crée les index TTL depuis
    `RETENTION_RULES` — le code n'écrit plus `expireAfterSeconds` à la main ;
  * `.github/scripts/check-privacy-policy.py` rend le tableau de PRIVACY.md
    depuis ce même objet, et refuse une divergence.

Publier une durée différente de celle que le code applique demande donc de
changer ce fichier — ce que le garde signale.

Deux formes d'index TTL coexistent, et elles ne se lisent pas pareil :

  * « date portée par le document » — le document connaît sa date de mort
    (`expires_at`, `expire_at`) et l'index vaut `expireAfterSeconds=0` ;
  * « date de création » — le champ porte la naissance de la donnée
    (`created_at`) et c'est `expireAfterSeconds` qui porte la durée.

`RegleDeConservation.lifetime` est la durée dans les deux cas, donc la seule
chose que la politique ait besoin de dire.

QUI APPLIQUE CES DURÉES — deux étages, une seule règle :

  * l'index TTL (`kojo_core.create_database_indexes`) est la garantie de la
    base : un document périmé disparaît même si l'application ne tourne plus ;
  * le passage de purge (`kojo_scheduler.retention_purge_once`) applique
    `RegleDeConservation.query_de_purge`, c'est-à-dire la MÊME règle — c'est
    l'étage observable, parce qu'un index TTL ne s'exécute pas dans une suite
    de tests (Mongo le fait en tâche de fond, une fois par minute).

Le piège de ce mécanisme, écrit ici pour qu'il ne se reperde pas : un index TTL
ne mord que sur un champ de type DATE (BSON `datetime`). Un `created_at` stocké
en chaîne ISO n'expire JAMAIS, en silence. Les règles à date de création
(`notifications`, `support_tickets`, `messages`) s'appuient donc sur des champs
`datetime` des modèles (`kojo_models.py`) — les vérifier avant d'ajouter une
règle qui lirait un horodatage textuel.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from kojo_settings import (
    DELETED_ACCOUNT_RETENTION_DAYS,
    EMAIL_OTP_EXPIRY_MINUTES,
    JWT_EXPIRATION_HOURS,
    MESSAGE_RETENTION_DAYS,
    NOTIFICATION_RETENTION_DAYS,
    PAYMENT_PENDING_EXPIRY_HOURS,
    SUPPORT_TICKET_RETENTION_DAYS,
)


@dataclass(frozen=True)
class RegleDeConservation:
    """Une collection purgée automatiquement, et la durée qui la gouverne."""

    collection: str
    ttl_field: str
    lifetime: timedelta
    # Le symbole qui PORTE la durée. La politique le nomme plutôt que de citer
    # son chiffre : une valeur recopiée dans un document est un chiffre que
    # personne ne relira quand le code changera.
    porte_par: str
    # Ce que le TTL supprime réellement, en clair — une portée partielle
    # (paiements) ne se déduit pas du nom de la collection.
    portee: str
    # Filtre partiel éventuel : l'index ne s'applique qu'aux documents qui le
    # matchent, donc il ne purge pas toute la collection.
    partial: Optional[Dict[str, object]] = None
    # True : le document porte sa date de péremption (expireAfterSeconds=0).
    # False : le champ porte sa date de création (expireAfterSeconds=lifetime).
    date_portee_par_le_document: bool = True

    @property
    def expire_after_seconds(self) -> int:
        """La valeur que l'index TTL reçoit — dérivée, jamais écrite à la main."""
        if self.date_portee_par_le_document:
            return 0
        return int(self.lifetime.total_seconds())

    def options_index(self) -> Dict[str, object]:
        """Options passées à `create_index`, pour que l'index vienne d'ici."""
        options: Dict[str, object] = {"expireAfterSeconds": self.expire_after_seconds}
        if self.partial is not None:
            options["partialFilterExpression"] = dict(self.partial)
        return options

    def query_de_purge(self, maintenant: datetime) -> Dict[str, object]:
        """Le filtre qui désigne les documents DUS, dérivé de la même règle que
        l'index TTL — sans quoi « périmé » se dirait de deux façons, et la purge
        pourrait contredire la durée publiée.

        Les deux formes de règle se lisent ici : un document qui porte sa date
        de mort se compare à MAINTENANT, un document qui porte sa naissance se
        compare à maintenant moins la durée.

        Le filtre partiel est FUSIONNÉ et non écrasé : sur les paiements il
        porte le `$exists` qui protège les pièces comptables, et il doit
        survivre à l'ajout de la borne temporelle sur le même champ.
        """
        seuil = maintenant if self.date_portee_par_le_document else maintenant - self.lifetime
        filtre: Dict[str, object] = {self.ttl_field: {"$lte": seuil}}
        for cle, valeur in (self.partial or {}).items():
            if cle == self.ttl_field and isinstance(valeur, dict):
                filtre[cle] = {**valeur, **filtre[cle]}
            else:
                filtre[cle] = valeur
        return filtre


RETENTION_RULES: Tuple[RegleDeConservation, ...] = (
    RegleDeConservation(
        collection="email_otps",
        ttl_field="expires_at",
        lifetime=timedelta(minutes=EMAIL_OTP_EXPIRY_MINUTES),
        porte_par="EMAIL_OTP_EXPIRY_MINUTES",
        portee=(
            "le code de vérification, qu'il ait servi ou non — "
            "l'index s'applique à la collection entière"
        ),
    ),
    RegleDeConservation(
        collection="payments",
        ttl_field="expires_at",
        lifetime=timedelta(hours=PAYMENT_PENDING_EXPIRY_HOURS),
        porte_par="PAYMENT_PENDING_EXPIRY_HOURS",
        portee=(
            "le seul paiement resté `pending` (client parti, IPN perdu) — "
            "un paiement complété ou annulé ne porte pas `expires_at` et n'est "
            "JAMAIS purgé (obligation comptable)"
        ),
        partial={"status": "pending", "expires_at": {"$exists": True}},
    ),
    RegleDeConservation(
        collection="notifications",
        ttl_field="created_at",
        lifetime=timedelta(days=NOTIFICATION_RETENTION_DAYS),
        porte_par="NOTIFICATION_RETENTION_DAYS",
        portee="toute notification, lue ou non",
        date_portee_par_le_document=False,
    ),
    RegleDeConservation(
        collection="revoked_tokens",
        ttl_field="expire_at",
        lifetime=timedelta(hours=JWT_EXPIRATION_HOURS),
        porte_par="JWT_EXPIRATION_HOURS",
        portee=(
            "l'inscription au rebut d'un jeton révoqué, conservée jusqu'à "
            "l'expiration naturelle du jeton : le garder plus longtemps "
            "n'ajouterait rien, l'oublier plus tôt rouvrirait la session"
        ),
    ),
    RegleDeConservation(
        collection="users",
        ttl_field="purge_at",
        lifetime=timedelta(days=DELETED_ACCOUNT_RETENTION_DAYS),
        porte_par="DELETED_ACCOUNT_RETENTION_DAYS",
        portee=(
            "le document d'un compte SUPPRIMÉ (anonymisé : plus aucune PII, "
            "mais l'identifiant interne qui référence les paiements) — un "
            "compte actif ne porte pas `purge_at` et n'est jamais purgé"
        ),
        partial={"deleted": True, "purge_at": {"$exists": True}},
    ),
    RegleDeConservation(
        collection="support_tickets",
        ttl_field="created_at",
        lifetime=timedelta(days=SUPPORT_TICKET_RETENTION_DAYS),
        porte_par="SUPPORT_TICKET_RETENTION_DAYS",
        portee=(
            "tout ticket support, résolu ou non — nom, téléphone, email et "
            "message libre, la donnée la plus identifiante du dépôt"
        ),
        date_portee_par_le_document=False,
    ),
    RegleDeConservation(
        collection="messages",
        ttl_field="timestamp",
        lifetime=timedelta(days=MESSAGE_RETENTION_DAYS),
        porte_par="MESSAGE_RETENTION_DAYS",
        portee=(
            "tout message envoyé — il appartient aussi au destinataire, donc "
            "il survit à la suppression de compte, mais pas indéfiniment"
        ),
        date_portee_par_le_document=False,
    ),
)


def regle_de(collection: str) -> RegleDeConservation:
    """La règle d'une collection, par son nom."""
    for regle in RETENTION_RULES:
        if regle.collection == collection:
            return regle
    raise KeyError(f"aucune règle de conservation pour {collection!r}")


def echeance_de_purge(collection: str, depart: datetime) -> datetime:
    """Quand un document dont la règle est portée par le document devient
    purgeable : `depart` + la durée de sa règle.

    C'est le point qui évite la recopie : la suppression de compte n'écrit pas
    « + 90 jours », elle demande son échéance à la règle qui porte aussi
    l'index TTL. Un document sans date de mort ne périme jamais, donc oublier
    cette écriture rendrait la durée publiée purement décorative.
    """
    return depart + regle_de(collection).lifetime


# L'unité qu'un symbole exprime, lue sur son nom. C'est ce qui permet à la
# politique de dire « 48 heures » là où le code dit PAYMENT_PENDING_EXPIRY_HOURS,
# au lieu d'un « 2 jours » juste mais étranger au code qu'on relit en face.
UNITES_PAR_SUFFIXE = (
    ("_SECONDS", "seconde"),
    ("_MINUTES", "minute"),
    ("_HOURS", "heure"),
    ("_DAYS", "jour"),
)

FACTEURS = {"seconde": 1, "minute": 60, "heure": 3600, "jour": 86400}


def unite_du_symbole(porte_par: str) -> Optional[str]:
    """L'unité que le symbole porte (`_HOURS` → « heure »), ou None."""
    for suffixe, unite in UNITES_PAR_SUFFIXE:
        if porte_par.endswith(suffixe):
            return unite
    return None


def formater_duree(duree: timedelta, unite: Optional[str] = None) -> str:
    """Rend une durée lisible (« 10 minutes », « 48 heures », « 90 jours »).

    Le chiffre et le mot sont calculés depuis la valeur, jamais écrits : une
    durée qui change d'ordre de grandeur change aussi de mot, donc le document
    ne peut pas annoncer « 90 jours » après un passage à 30.
    """
    secondes = int(duree.total_seconds())
    if secondes == 0:
        return "immédiat"

    # L'unité du symbole d'origine est préférée quand elle divise exactement :
    # elle ne change pas la valeur, elle rend le chiffre comparable à celui du
    # code qu'un relecteur a sous les yeux.
    if unite in FACTEURS and secondes % FACTEURS[unite] == 0:
        valeur = secondes // FACTEURS[unite]
        return f"{valeur} {unite}" + ("s" if valeur > 1 else "")

    jours, reste = divmod(secondes, 86400)
    heures, reste = divmod(reste, 3600)
    minutes, secondes = divmod(reste, 60)

    parts = []
    for valeur, nom in ((jours, "jour"), (heures, "heure"),
                        (minutes, "minute"), (secondes, "seconde")):
        if valeur:
            parts.append(f"{valeur} {nom}" + ("s" if valeur > 1 else ""))
    # Deux unités suffisent à être exact sans être illisible : « 1 heure et
    # 30 minutes » se lit, « 1 heure 30 minutes 7 secondes » ne se lit plus.
    return " et ".join(parts[:2]) if len(parts) > 1 else parts[0]
