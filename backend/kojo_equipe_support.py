# -*- coding: utf-8 -*-
"""L'ÉQUIPE SUPPORT : qui a le droit de traiter les demandes clients.

── Pourquoi ce module existe (24/10/2026) ─────────────────────────────────────
Le propriétaire était le SEUL compte admis sur `/support-admin` : dès la
deuxième demande, il devenait le goulot d'étranglement du service clientèle, et
la notification « nouveau ticket support » ne pouvait prévenir personne d'autre.
Il peut désormais ajouter des personnes de confiance, et leur travail s'arrête
là où il commence : elles lisent et font avancer les tickets, rien de plus.

── CE QUI EST ACCORDÉ, ET CE QUI NE L'EST PAS ────────────────────────────────
Un membre de l'équipe porte `support_role == "agent"` sur SON compte. Ce champ
n'ouvre QUE les routes de support (`verify_support_access`) ; il n'ouvre aucun
droit propriétaire (`verify_owner_access` reste jugé sur l'EMAIL, donc
`/owner/*`, les gains, l'arbitrage et les paliers de commission restent fermés).
Aucun `permissions` n'est posé : `OwnerService.isOwnerUser` lit `admin_access`,
et un rôle support ne doit jamais ressembler à un rôle administrateur.

── COMMENT ON AJOUTE QUELQU'UN ───────────────────────────────────────────────
Par son ADRESSE, et seulement si un compte Kojo l'utilise déjà : la personne se
connecte avec ses propres identifiants, donc le propriétaire n'a jamais à
transmettre un mot de passe (et ne peut pas se le faire voler par ce chemin).
Une adresse inconnue est REFUSÉE en le disant, avec le remède : le compte
d'abord, l'ajout ensuite.

── CE QUI SE RETIRE IMMÉDIATEMENT ────────────────────────────────────────────
`get_current_user` relit le compte à CHAQUE requête : retirer le rôle ferme
l'accès à la requête suivante, sans attendre l'expiration d'un jeton.
"""
# Le module, pas le nom : `OWNER_EMAIL` est lu à l'appel (comme partout où
# l'accès propriétaire est jugé), donc un test peut le remplacer — et la valeur
# qui décide reste UNE seule source.
import kojo_owner

from kojo_core import db, sanitize_email
from kojo_settings import logger

# La valeur du champ `User.support_role` qui accorde l'accès au service
# clientèle. `None` (ou absent) = pas d'accès : un compte ordinaire n'a rien à
# faire ici, et un document legacy ne doit pas devenir agent par accident.
ROLE_AGENT = "agent"

# Bornes des lectures : une équipe support est une poignée de personnes, et une
# requête qui en rendrait des milliers signalerait un champ corrompu.
MAX_AGENTS = 50

# Seules ces clés sortent d'ici : la fiche d'un agent est PUBLIQUE pour le
# propriétaire, jamais le document complet (mot de passe, comptes de paiement,
# téléphone…).
CHAMPS_PUBLICS = ("id", "email", "first_name", "last_name", "user_type")


class EquipeSupportRefus(Exception):
    """Un ajout/retrait refusé, avec son MOTIF déjà rédigé pour l'écran.

    Porte son code HTTP : le routeur le rend tel quel, sans re-traduire un cas
    en un autre (un 404 déguisé en 409 ferait chercher la mauvaise cause).
    """

    def __init__(self, statut: int, motif: str, **details):
        super().__init__(motif)
        self.statut = statut
        self.motif = motif
        self.details = details


def _champ(compte, nom: str):
    """Un champ du compte, qu'il arrive en DOCUMENT (base) ou en MODÈLE.

    Les deux formes circulent : les lectures d'ici rendent des dictionnaires,
    `get_current_user` rend un objet `User`. Lire `.get` sur le second lève une
    `AttributeError` — un 500 sur une route qui devait seulement répondre 403.
    """
    if compte is None:
        return None
    if isinstance(compte, dict):
        return compte.get(nom)
    return getattr(compte, nom, None)


def est_le_proprietaire(compte) -> bool:
    """Ce compte est-il celui du PROPRIÉTAIRE ? (même règle que l'accès owner : l'email)"""
    email = (_champ(compte, "email") or "").strip().lower()
    proprietaire = (kojo_owner.OWNER_EMAIL or "").strip().lower()
    if proprietaire and email == proprietaire:
        return True
    return bool(_champ(compte, "is_owner")) or _champ(compte, "user_type") == "owner"


def est_agent_support(compte) -> bool:
    """Ce compte peut-il traiter les demandes clients ? (rôle seul, aucune autre condition)"""
    return (
        compte is not None
        and not _champ(compte, "deleted")
        and _champ(compte, "support_role") == ROLE_AGENT
    )


def _fiche(compte: dict) -> dict:
    return {cle: compte.get(cle) for cle in CHAMPS_PUBLICS}


async def lister_agents() -> list[dict]:
    """Les membres de l'équipe support, du plus ancien ajout au plus récent.

    Rendus par ordre de CRÉATION du compte : le propriétaire relit une équipe
    stable d'un passage à l'autre, pas une liste qui se réordonne selon la
    dernière écriture.
    """
    curseur = db.users.find(
        {"support_role": ROLE_AGENT, "deleted": {"$ne": True}},
        {cle: 1 for cle in CHAMPS_PUBLICS},
    ).sort("created_at", 1).limit(MAX_AGENTS)
    comptes = await curseur.to_list(length=MAX_AGENTS)
    return [_fiche(compte) for compte in comptes]


async def ajouter_agent(email: str) -> dict:
    """Accorde l'accès au service clientèle au compte qui porte CETTE adresse.

    L'adresse est nettoyée par `sanitize_email` (même règle que l'inscription et
    la connexion) : ajouter « A@B.com » puis se connecter avec « a@b.com »
    désignerait sinon deux comptes différents.

    Args:
        email: adresse du compte Kojo à ajouter à l'équipe.

    Returns:
        dict: {agent, deja_membre} — la fiche du compte et si le rôle était
        déjà posé (un ajout rejoué n'est pas une erreur, c'est le même état).

    Raises:
        EquipeSupportRefus: 400 (adresse inutilisable), 404 (aucun compte),
            409 (compte supprimé, ou compte propriétaire).
    """
    # `sanitize_email` LÈVE sur une entrée vide : une adresse manquante est un
    # refus de saisie (400 nommé), jamais une erreur serveur.
    if not (email or "").strip():
        raise EquipeSupportRefus(
            400,
            "Renseignez l'adresse email du compte à ajouter.",
        )
    try:
        propre = sanitize_email(email)
    except ValueError:
        raise EquipeSupportRefus(
            400,
            "Cette adresse email n'est pas valide. Vérifiez-la et réessayez.",
        )

    # Une faute de frappe doit être dite comme telle : chercher « awa@kojo » en
    # base rendrait « aucun compte avec cette adresse » et enverrait le
    # propriétaire demander à quelqu'un de créer un compte qui existe déjà.
    local, _, domaine = propre.partition("@")
    if not local or "." not in domaine or domaine.startswith(".") or domaine.endswith("."):
        raise EquipeSupportRefus(
            400,
            "Cette adresse email n'est pas valide. Vérifiez-la et réessayez.",
        )

    compte = await db.users.find_one({"email": propre})
    if not compte:
        # Pas de création de compte ici, et surtout pas de mot de passe envoyé
        # par email : la personne s'inscrit elle-même, puis le propriétaire
        # l'ajoute. Le refus dit les deux étapes.
        raise EquipeSupportRefus(
            404,
            "Aucun compte Kojo n'utilise cette adresse. La personne doit d'abord "
            "créer son compte sur Kojo, puis vous pourrez l'ajouter à l'équipe.",
        )

    if compte.get("deleted"):
        raise EquipeSupportRefus(
            409,
            "Ce compte a été supprimé : il ne peut plus être ajouté à l'équipe.",
        )

    if est_le_proprietaire(compte):
        raise EquipeSupportRefus(
            409,
            "Le propriétaire gère déjà les demandes de support : ce compte n'a pas "
            "besoin du rôle d'équipe.",
        )

    if est_agent_support(compte):
        return {"agent": _fiche(compte), "deja_membre": True}

    await db.users.update_one(
        {"id": compte.get("id")},
        {"$set": {"support_role": ROLE_AGENT}},
    )
    logger.info("✅ Équipe support : %s peut désormais traiter les demandes clients", propre)
    return {"agent": _fiche({**compte, "support_role": ROLE_AGENT}), "deja_membre": False}


async def retirer_agent(user_id: str) -> dict:
    """Retire l'accès au service clientèle. Le compte, lui, reste intact.

    Args:
        user_id: identifiant interne du compte à retirer.

    Returns:
        dict: {agent} — la fiche du compte retiré, pour que l'écran nomme qui a
        perdu l'accès (un identifiant seul ne se lit pas).

    Raises:
        EquipeSupportRefus: 404 (compte inconnu), 409 (ce compte n'était pas
            dans l'équipe : retirer deux fois n'est pas un succès muet).
    """
    compte = await db.users.find_one({"id": (user_id or "").strip()})
    if not compte:
        raise EquipeSupportRefus(404, "Ce compte n'existe pas (ou plus).")

    if not est_agent_support(compte):
        raise EquipeSupportRefus(
            409,
            "Ce compte ne fait pas partie de l'équipe support.",
        )

    await db.users.update_one(
        {"id": compte.get("id")},
        {"$set": {"support_role": None}},
    )
    logger.info("✅ Équipe support : %s ne traite plus les demandes clients", compte.get("email"))
    return {"agent": _fiche(compte)}
