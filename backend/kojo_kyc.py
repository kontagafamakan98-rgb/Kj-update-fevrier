# -*- coding: utf-8 -*-
"""Le TITULAIRE du compte mobile money — la seule vérification que Kojo fait aujourd'hui.

LE TROU QUE CE MODULE FERME (mesuré le 25/10/2026)

`get_mobile_money_account` exige un compte Orange Money ou Wave pour décaisser,
mais ne vérifie JAMAIS que ce compte appartient au titulaire du compte Kojo :
un travailleur pouvait déclarer le wallet d'un tiers et être payé dessus. C'est
la fraude qui coûte de l'argent réel, et elle ne demande aucun document.

CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS

Trois états, une règle, aucune ambiguïté :

  * `non_declare` — le titulaire du wallet n'est pas déclaré (ou aucun wallet) :
    rien ne peut être comparé, donc rien n'est vérifié ;
  * `verifie` — le nom déclaré est CELUI DU COMPTE (comparaison normalisée :
    casse, accents, ponctuation, ordre des mots), ou le propriétaire l'a validé
    à la main ;
  * `en_attente` — le nom déclaré est DIFFÉRENT : un humain doit trancher (être
    payé sur le wallet d'un proche est fréquent et légitime en Afrique de
    l'Ouest — c'est une décision, pas une fraude par défaut).

Ce module ne prétend PAS identifier une personne : il vérifie qu'un compte
mobile money est bien celui qu'on dit. Pas de pièce d'identité, pas de selfie,
aucune donnée sensible de plus à conserver — c'est l'option A du KYC, choisie
parce qu'elle coûte 0 FCFA et ferme le trou qui coûte de l'argent.

CE QUI EST BLOQUÉ

`exiger_wallet_verifie` est appelé par les DEUX chemins qui font sortir de
l'argent vers un travailleur : la libération du séquestre (`liberer_sequestre`,
seul chemin de versement) et le retrait des récompenses de parrainage. Les
REMBOURSEMENTS au client ne sont pas concernés : geler un remboursement
bloquerait un séquestre, ce qui n'est pas une vérification mais une panne.

LA TRACE

La décision du propriétaire vit sur le DOCUMENT du compte
(`wallet_verification`), avec sa méthode, son auteur, sa date, son motif et une
empreinte du couple (nom déclaré, numéro) : aucune collection neuve, donc
l'export RGPD la rend déjà et la suppression de compte l'efface. Un changement
de nom OU de numéro change l'empreinte, donc ANNULE une validation manuelle —
une validation couvre ce qui a été validé, pas autre chose.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import HTTPException

from kojo_db import db

ETAT_NON_DECLARE = "non_declare"
ETAT_EN_ATTENTE = "en_attente"
ETAT_VERIFIE = "verifie"
ETAT_REFUSE = "refuse"
ETATS = (ETAT_NON_DECLARE, ETAT_EN_ATTENTE, ETAT_VERIFIE, ETAT_REFUSE)

# Motifs : des CONSTANTES, jamais une phrase libre. La même valeur sert au
# stockage, à la réponse de l'API et à l'affichage — un motif écrit à trois
# endroits finirait par diverger.
MOTIF_AUCUN_COMPTE = "aucun_compte_mobile_money"
MOTIF_TITULAIRE_NON_DECLARE = "titulaire_non_declare"
MOTIF_NOM_CORRESPOND = "nom_correspond"
MOTIF_NOM_DIFFERENT = "nom_different"
MOTIF_VALIDE_PROPRIETAIRE = "valide_par_le_proprietaire"
MOTIF_REFUSE_PROPRIETAIRE = "refuse_par_le_proprietaire"

METHODE_NOM = "nom_correspond"
METHODE_MANUEL = "manuel"

# Bornes de saisie : un nom de titulaire plus court ne distingue personne, et
# au-delà de 80 caractères c'est une phrase, pas un nom.
NOM_MINIMUM = 3
NOM_MAXIMUM = 80

# Une décision se justifie : en dessous, elle ne se relit pas six mois après.
NOTE_MINIMUM = 10
NOTE_MAXIMUM = 500

HISTORIQUE_MAX = 20
MAX_PORTEFEUILLES_LUS = 2000


def _horodatage() -> str:
    return datetime.now(timezone.utc).isoformat()


def normaliser_nom(valeur: Optional[str]) -> str:
    """Un nom comparable : sans accents, sans casse, sans ponctuation, mots triés.

    L'ordre des mots est TRIÉ parce qu'un même nom s'écrit « Famakan Kontaga »
    ou « Kontaga Famakan » selon la personne et le guichet : refuser l'un des
    deux ferait passer un compte légitime en revue manuelle à chaque fois.
    Une valeur vide rend une chaîne vide (jamais un espace, qui se comparerait
    à un autre espace).
    """
    texte = unicodedata.normalize("NFKD", str(valeur or ""))
    texte = "".join(c for c in texte if not unicodedata.combining(c))
    texte = re.sub(r"[^A-Za-z0-9\s'-]", " ", texte)
    mots = [mot.strip("'-").lower() for mot in texte.split()]
    return " ".join(sorted(mot for mot in mots if mot))


def noms_correspondent(declared: Optional[str], account_name: Optional[str]) -> bool:
    """Deux noms désignent-ils la même personne pour cette vérification ?

    Égalité après normalisation. Pas de distance d'édition : « Moussa Traore »
    et « Moussa Traoré » sont égaux par la normalisation, mais « Moussa Traore »
    et « Moussa Traor » ne le sont pas — et un rapprochement approximatif
    laisserait passer exactement ce qu'on veut empêcher.
    """
    gauche, droite = normaliser_nom(declared), normaliser_nom(account_name)
    return bool(gauche) and gauche == droite


def nom_du_compte(compte: Optional[dict]) -> str:
    """Le nom légal du compte Kojo — celui auquel le wallet doit correspondre."""
    compte = compte or {}
    return " ".join(
        part for part in (compte.get("first_name"), compte.get("last_name")) if part
    ).strip()


def nom_du_titulaire(compte: Optional[dict]) -> str:
    """Le nom du titulaire DÉCLARÉ pour le wallet (saisi par la personne)."""
    comptes = (compte or {}).get("payment_accounts") or {}
    valeur = comptes.get("holder_name")
    return valeur.strip() if isinstance(valeur, str) and valeur.strip() else ""


def numero_du_wallet(compte: Optional[dict]) -> Tuple[Optional[str], Optional[str]]:
    """(méthode, numéro) du wallet de décaissement — même priorité que le paiement.

    Lecture LOCALE, sans importer `kojo_payments` : la règle de priorité
    (Orange Money d'abord, puis Wave) a un seul propriétaire, et ce module n'a
    pas à en devenir un second. Si elle change, `empreinte` change avec elle et
    une validation manuelle est annulée — ce qui est le comportement voulu.
    """
    comptes = (compte or {}).get("payment_accounts") or {}
    if comptes.get("orange_money"):
        return "orange_money", str(comptes["orange_money"])
    if comptes.get("wave"):
        return "wave", str(comptes["wave"])
    return None, None


def empreinte(compte: Optional[dict]) -> str:
    """Empreinte du couple (nom déclaré, numéro) : ce qu'une décision a couvert.

    Un nom ou un numéro qui change produit une autre empreinte, donc la
    décision manuelle ne s'applique plus : elle portait sur l'ancien couple.
    """
    _methode, numero = numero_du_wallet(compte)
    # Les chiffres sont extraits AVANT l'interpolation : une barre oblique
    # inverse dans une expression d'accolade n'est légale qu'à partir de
    # Python 3.12, et le backend tourne en 3.11 — pyflakes y voyait une erreur
    # de syntaxe (CI du 25/10/2026), alors qu'un interpréteur 3.14 local
    # l'acceptait sans rien dire.
    chiffres = re.sub(r"\D", "", numero or "")
    matiere = f"{normaliser_nom(nom_du_titulaire(compte))}|{chiffres}"
    return hashlib.sha256(matiere.encode("utf-8")).hexdigest()[:20]


def _evaluation(compte: Optional[dict]) -> dict:
    """L'état CALCULÉ à partir des données du compte (sans décision manuelle)."""
    _methode, numero = numero_du_wallet(compte)
    if not numero:
        return {
            "etat": ETAT_NON_DECLARE,
            "methode": None,
            "motif": MOTIF_AUCUN_COMPTE,
        }
    declare = nom_du_titulaire(compte)
    if not declare:
        return {
            "etat": ETAT_NON_DECLARE,
            "methode": None,
            "motif": MOTIF_TITULAIRE_NON_DECLARE,
        }
    if noms_correspondent(declare, nom_du_compte(compte)):
        return {
            "etat": ETAT_VERIFIE,
            "methode": METHODE_NOM,
            "motif": MOTIF_NOM_CORRESPOND,
        }
    return {
        "etat": ETAT_EN_ATTENTE,
        "methode": None,
        "motif": MOTIF_NOM_DIFFERENT,
    }


def etat_du_document(compte: Optional[dict]) -> dict:
    """Ce que l'écran et la porte lisent : l'état EFFECTIF, décision comprise.

    Une décision manuelle ne vaut que pour le couple qu'elle a couvert
    (empreinte) ; sinon elle est ignorée et l'état est recalculé. Un document
    sans `wallet_verification` (tous ceux d'avant ce module) est donc jugé sur
    ses données, jamais supposé vérifié.
    """
    calcule = _evaluation(compte)
    stockee = (compte or {}).get("wallet_verification")
    if not isinstance(stockee, dict):
        return {**calcule, "empreinte": empreinte(compte), "decide_le": None,
                "decide_par": None, "note": None, "historique": []}

    if (
        stockee.get("empreinte") == empreinte(compte)
        and stockee.get("etat") in (ETAT_VERIFIE, ETAT_REFUSE)
        and stockee.get("methode") == METHODE_MANUEL
    ):
        return {
            "etat": stockee["etat"],
            "methode": METHODE_MANUEL,
            "motif": stockee.get("motif") or (
                MOTIF_VALIDE_PROPRIETAIRE
                if stockee["etat"] == ETAT_VERIFIE
                else MOTIF_REFUSE_PROPRIETAIRE
            ),
            "empreinte": stockee.get("empreinte"),
            "nom_declare": stockee.get("nom_declare") or nom_du_titulaire(compte),
            "nom_compte": stockee.get("nom_compte") or nom_du_compte(compte),
            "decide_le": stockee.get("decide_le"),
            "decide_par": stockee.get("decide_par"),
            "note": stockee.get("note"),
            "historique": list(stockee.get("historique") or []),
        }
    return {**calcule, "empreinte": empreinte(compte), "decide_le": None,
            "decide_par": None, "note": None, "historique": []}


def verification_apres_ecriture(compte: Optional[dict]) -> dict:
    """L'enregistrement à poser sur le compte après une modification des wallets.

    Deux cas : une décision manuelle encore VALABLE (même empreinte) est
    conservée — réenregistrer le même numéro ne doit pas rouvrir le dossier —
    et tout le reste est recalculé, y compris ce qui annule une validation
    devenue caduque.
    """
    lecture = etat_du_document(compte)
    return {
        "etat": lecture["etat"],
        "methode": lecture["methode"],
        "motif": lecture["motif"],
        "empreinte": lecture["empreinte"],
        "nom_declare": nom_du_titulaire(compte),
        "nom_compte": nom_du_compte(compte),
        "decide_le": lecture.get("decide_le"),
        "decide_par": lecture.get("decide_par"),
        "note": lecture.get("note"),
        "historique": list(lecture.get("historique") or []),
    }


class WalletNonVerifie(HTTPException):
    """403 qui n'est pas un ÉCHEC mais une ATTENTE.

    Distinguer les deux est ce qui évite un blocage à vie : la libération
    AUTOMATIQUE (`kojo_job_completion.liberer_automatiquement`) traite un 403
    ordinaire comme un échec (`auto_release_blocked`) et ne repasse plus
    jamais — la décision du propriétaire arriverait alors trop tard, et le
    travailleur ne serait payé que si un humain relançait la machine. Ici la
    déclaration reste `marked` : le balayage suivant repart tout seul dès que
    le wallet est vérifié, sans qu'aucun humain n'ait à relancer quoi que ce
    soit. La décision de vérifier un titulaire est UNE décision, pas une tâche
    à refaire à chaque versement.
    """

    def __init__(self, detail: str):
        super().__init__(status_code=403, detail=detail)


def _refus(compte: Optional[dict], lecture: dict) -> WalletNonVerifie:
    """403 NOMMÉ : chaque état dit ce qui manque ET qui peut le corriger.

    Un refus muet se relit comme une panne, et c'est exactement ce que la
    personne verra au moment où elle attend son argent.
    """
    etat = lecture["etat"]
    if etat == ETAT_NON_DECLARE:
        if lecture.get("motif") == MOTIF_AUCUN_COMPTE:
            detail = (
                "Versement retenu : aucun compte Orange Money ou Wave n'est "
                "enregistré pour le travailleur. Il doit en ajouter un, avec le "
                "nom de son titulaire, dans « Moyens de paiement »."
            )
        else:
            detail = (
                "Versement retenu : le NOM DU TITULAIRE du compte mobile money "
                "n'est pas déclaré. Le travailleur doit le renseigner dans "
                "« Moyens de paiement » ; le versement repart dès qu'il "
                "correspond au nom de son compte Kojo."
            )
    elif etat == ETAT_EN_ATTENTE:
        detail = (
            "Versement retenu : le compte mobile money déclaré n'est pas au nom "
            "du travailleur. Le propriétaire doit valider ou refuser ce choix "
            "(Administration → Portefeuilles) avant qu'un centime sorte."
        )
    else:
        note = (lecture.get("note") or "").strip()
        detail = (
            "Versement retenu : ce compte mobile money a été refusé par le "
            "propriétaire"
            + (f" ({note})" if note else "")
            + ". Le travailleur doit enregistrer un compte à son nom."
        )
    # `WalletNonVerifie` (et non un 403 générique) : le balayage automatique
    # doit pouvoir dire « il attend une vérification », pas « il a échoué ».
    return WalletNonVerifie(detail)


def exiger_wallet_verifie(compte: Optional[dict]) -> None:
    """La PORTE : lève un 403 nommé tant que le wallet n'est pas vérifié.

    Appelée par les chemins de décaissement seulement (`liberer_sequestre`, le
    retrait des récompenses). Le gate tombe AVANT toute écriture : un versement
    retenu ne laisse ni séquestre « releasing », ni mission close.
    """
    lecture = etat_du_document(compte)
    if lecture["etat"] == ETAT_VERIFIE:
        return
    raise _refus(compte, lecture)


def _portefeuille_public(compte: dict) -> dict:
    """Ce que le propriétaire voit pour décider : les deux noms, jamais le condensé."""
    lecture = etat_du_document(compte)
    methode, numero = numero_du_wallet(compte)
    chiffres = re.sub(r"\D", "", numero or "")
    return {
        "compte_id": compte.get("id"),
        "nom": nom_du_compte(compte),
        "email": compte.get("email"),
        "user_type": compte.get("user_type"),
        "country": compte.get("country"),
        "etat": lecture["etat"],
        "motif": lecture["motif"],
        "methode": lecture["methode"],
        "nom_declare": nom_du_titulaire(compte),
        "nom_compte": nom_du_compte(compte),
        "wallet_methode": methode,
        "wallet_masque": f"•••• {chiffres[-2:]}" if chiffres else None,
        "decide_le": lecture.get("decide_le"),
        "decide_par": lecture.get("decide_par"),
        "note": lecture.get("note"),
        "historique": list(lecture.get("historique") or []),
    }


async def lister_portefeuilles(
    etat: Optional[str] = None, limite: int = 50, offset: int = 0
) -> dict:
    """Les comptes qui ont un wallet ou un titulaire déclaré, avec leur état.

    Lecture BORNÉE et déclarée : au-delà de `MAX_PORTEFEUILLES_LUS`, `tronque`
    le dit, parce qu'une file d'attente incomplète qui se tait ferait croire
    qu'il n'y a plus rien à valider.
    """
    if etat is not None and etat not in ETATS:
        raise HTTPException(status_code=400, detail=f"État inconnu : {etat!r}")

    comptes = await db.users.find({"deleted": {"$ne": True}}).to_list(MAX_PORTEFEUILLES_LUS)
    portefeuilles = [
        _portefeuille_public(compte)
        for compte in comptes
        if (compte.get("payment_accounts") or {}).get("orange_money")
        or (compte.get("payment_accounts") or {}).get("wave")
        or nom_du_titulaire(compte)
    ]
    if etat is not None:
        portefeuilles = [p for p in portefeuilles if p["etat"] == etat]

    # La file utile d'abord : ce qui attend une décision, du plus ancien au plus
    # récent — puis les autres états, dans l'ordre où ils ont été décidés.
    portefeuilles.sort(key=lambda p: (p["etat"] != ETAT_EN_ATTENTE, p.get("decide_le") or p["compte_id"] or ""))
    total = len(portefeuilles)
    debut = max(0, int(offset))
    page = portefeuilles[debut:debut + max(1, int(limite))]
    return {
        "total": total,
        "count": len(page),
        "offset": debut,
        "limite": limite,
        "tronque": len(comptes) >= MAX_PORTEFEUILLES_LUS,
        "portefeuilles": page,
    }


def _identifiant_auteur(auteur) -> Optional[str]:
    """L'identifiant de l'auteur, qu'il soit un document ou un profil.

    Le propriétaire arrive ici sous forme de DOCUMENT relu (`verify_owner_access`)
    et un agent support sous forme de modèle `User` (`get_current_user`) :
    supposer un dict faisait tomber la route en 500 au premier agent qui
    tranchait — mesuré le 25/10/2026 par `test_un_agent_du_support_peut_trancher`.
    """
    if isinstance(auteur, dict):
        return auteur.get("id")
    return getattr(auteur, "id", None)


async def decision_proprietaire(
    compte: dict, *, decision: str, note: Optional[str], auteur
) -> dict:
    """Valider ou refuser un wallet — PROPRIÉTAIRE UNIQUEMENT (la route le garde).

    Refus nommés, aucun rattrapage silencieux :
      400 — décision inconnue, note absente ou trop courte, ou rien à décider
            (aucun wallet déclaré : une validation sans objet serait un blanc-seing) ;
      409 — compte propriétaire (il n'a pas de wallet à faire valider) et compte
            supprimé (il n'existe plus).
    """
    if decision not in ("verifier", "refuser"):
        raise HTTPException(status_code=400, detail=f"Décision inconnue : {decision!r}")
    if compte.get("deleted"):
        raise HTTPException(
            status_code=409, detail="Ce compte est supprimé : il n'a plus de wallet à vérifier."
        )
    if _est_proprietaire(compte):
        raise HTTPException(
            status_code=409,
            detail="Le compte propriétaire ne se fait pas vérifier son propre wallet.",
        )

    _methode, numero = numero_du_wallet(compte)
    if not numero:
        raise HTTPException(
            status_code=400,
            detail="Ce compte n'a aucun wallet Orange Money ou Wave : il n'y a rien à vérifier.",
        )

    note_propre = (note or "").strip()
    if len(note_propre) < NOTE_MINIMUM:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Une note d'au moins {NOTE_MINIMUM} caractères est exigée : une "
                "décision sur l'argent de quelqu'un ne se relit pas sans motif."
            ),
        )
    if len(note_propre) > NOTE_MAXIMUM:
        note_propre = note_propre[:NOTE_MAXIMUM]

    instant = _horodatage()
    etat = ETAT_VERIFIE if decision == "verifier" else ETAT_REFUSE
    auteur_id = _identifiant_auteur(auteur)
    entree = {
        "etat": etat,
        "par": auteur_id,
        "at": instant,
        "note": note_propre,
        "nom_declare": nom_du_titulaire(compte),
        "empreinte": empreinte(compte),
    }
    historique = list(((compte.get("wallet_verification") or {}).get("historique")) or [])
    historique.append(entree)
    historique = historique[-HISTORIQUE_MAX:]

    verification = {
        "etat": etat,
        "methode": METHODE_MANUEL,
        "motif": MOTIF_VALIDE_PROPRIETAIRE if decision == "verifier" else MOTIF_REFUSE_PROPRIETAIRE,
        "empreinte": empreinte(compte),
        "nom_declare": nom_du_titulaire(compte),
        "nom_compte": nom_du_compte(compte),
        "decide_le": instant,
        "decide_par": auteur_id,
        "note": note_propre,
        "historique": historique,
    }
    await db.users.update_one(
        {"id": compte.get("id")},
        {"$set": {"wallet_verification": verification, "updated_at": instant}},
    )
    return {
        "compte_id": compte.get("id"),
        "etat": etat,
        "decision": decision,
        "note": note_propre,
        "at": instant,
        "historique": historique,
    }


def _est_proprietaire(compte: dict) -> bool:
    """Le propriétaire est désigné par son EMAIL, lu à l'appel (jamais recopié)."""
    import kojo_settings

    email_proprietaire = (getattr(kojo_settings, "OWNER_EMAIL", "") or "").strip().lower()
    email = str((compte or {}).get("email") or "").strip().lower()
    return bool(email_proprietaire) and email == email_proprietaire
