#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Provisionne le COMPTE DÉDIÉ CI (isolé des comptes de test e2e partagés).

DEUX VARIANTES, UN SEUL CHEMIN D'ÉCRITURE : `--type client` (défaut) et
`--type worker`.

POURQUOI LE CLIENT : le job Lighthouse CI (lighthouse-ci) audite /dashboard,
/jobs et /profile en tant que CLIENT. Historiquement il réutilisait le compte
e2e partagé (makemoney0598@), modifié par les tests de bout en bout manuels
(profil, photo, missions) → les budgets Lighthouse variaient d'un run à
l'autre selon ce que l'état manuel du compte. Ce script crée un compte client
NEUF, VERROUILLÉ, utilisé UNIQUEMENT par la CI : personne ne le touche à la
main, donc les pages auditées ont un état déterministe.

POURQUOI LE TRAVAILLEUR (31/10/2026) : `PUT /job-alerts` est réservé aux
TRAVAILLEURS (403 pour un client — la veille enverrait à un client le
catalogue qu'il publie lui-même). Écrire une veille emploi RÉELLE en
production, c'est-à-dire mesurer l'acquisition que les pages ville et métier
existent pour produire, demandait donc un compte travailleur vérifié, et il
n'en existait aucun que la CI pût provisionner. La variante est la MÊME
fonction d'écriture, avec les invariants d'un travailleur d'après
`register_user_verified` : `user_type=worker`, `is_verified` et
`email_verified`, et DEUX moyens de paiement — le minimum que le parcours
exige d'un travailleur (`required_minimum: 2` dans la réponse de login), sans
quoi le compte serait renvoyé vers /payment-verification au lieu de la page
qu'on veut mesurer. `skills` n'est pas vide pour la même raison : un
travailleur sans compétence ne peut proposer sur aucune mission.

INSÉRITION DIRECTE en base (au lieu du flux register-verified, qui exige un
OTP email) : on miroire EXACTEMENT les invariants qu'un compte vérifié aurait
après register-verified, par rôle :
  - communes : is_verified=True, email_verified=True, password_hash = bcrypt
    (hash_password de kojo_core), donc verify_password accepte le login ;
  - CLIENT : payment_accounts_count>=1 (sinon ProtectedRoute le renvoie vers
    /payment-verification → l'audit LHCI échouerait), skills=[], bio=null
    (profil volontairement vide et stable : le Dashboard/Profile sont les
    mêmes à chaque run) ;
  - TRAVAILLEUR : payment_accounts_count>=2, skills non vide, bio=null et
    note à 0 (aucun historique inventé sur la fiche publique).

USAGE (depuis un hôte autorisé, ex. une machine de l'équipe, avec accès à la
base de prod) :
    # 1. Récupérer MONGO_URL depuis les secrets Fly :
    flyctl secrets list --app kojo-backend
    # 2. Lancer :
    python backend/scripts/provision_ci_test_account.py <MONGO_URL> <email> <password>
    # Variante TRAVAILLEUR (veille emploi) : ajouter --type worker.
    # 3. Documenter le couple <email>/<password> dans les secrets GitHub :
    #    Settings → Secrets and variables → Actions → ajouter
    #    LHCI_CI_EMAIL et LHCI_CI_PASSWORD (JAMAIS en clair dans le repo) ;
    #    pour la variante travailleur, VEILLE_EMPLOI_EMAIL et
    #    VEILLE_EMPLOI_PASSWORD (lus par semer_alerte_emploi.py et par
    #    .github/workflows/veille-emploi-production.yml).

IDEMPOTENT : si l'email existe déjà, le script MAJ le mot de passe vers la
nouvelle valeur et s'assure des invariants (utile pour une rotation).

Attention : le mot de passe est passé en argument de ligne de commande — ne
l'utilise pas dans un historique partagé. Préfère lire l'environnement
CI_PASSWORD pour une exécution scriptée.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import bcrypt
import pymongo


def hash_password(password: str) -> str:
    """Même implémentation que kojo_core.hash_password (bcrypt)."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def sanitize_email(email: str) -> str:
    """Même normalisation que kojo_core.sanitize_email."""
    clean = email.strip().lower()
    if len(clean) > 254:
        raise ValueError("Email too long")
    return clean


def _base_doc(email: str, password: str, *, prenom: str, nom: str, type_compte: str) -> dict:
    """Le socle commun aux deux variantes : un compte VÉRIFIÉ, prêt à se connecter.

    Les champs propres au rôle (moyens de paiement, compétences) sont posés par
    l'appelant : eux seuls distinguent un client d'un travailleur, et les mêler
    ici ferait diverger la variante travailleur sans qu'on le voie.
    """
    now = datetime.now(timezone.utc)
    return {
        "id": str(__import__("uuid").uuid4()),
        "email": sanitize_email(email),
        "password_hash": hash_password(password),
        "google_sub": None,
        "first_name": prenom,
        "last_name": nom,
        "phone": "+221771112233",
        "user_type": type_compte,
        "country": "senegal",
        "preferred_language": "fr",
        "legal_documents_accepted": True,
        "legal_documents_accepted_at": now,
        "legal_documents_version": "1.0",
        "is_owner": False,
        "bio": None,
        "skills": [],
        "profile_photo": None,
        "is_verified": True,
        "email_verified": True,
        "email_verified_at": now,
        "referral_code": None,
        "referred_by": None,
        "referral_reward_balance": 0.0,
        "referral_rewards": [],
        "referral_first_job_rewarded": False,
        "payment_accounts": None,
        "payment_accounts_count": 0,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": now,
        "updated_at": now,
    }


def build_verified_client_doc(email: str, password: str) -> dict:
    """Construit le document utilisateur d'un client VÉRIFIÉ (miroir exact de
    ce que produirait `User(...).model_dump()` dans register_user_verified).
    On insère un doc complet pour que :
      - /auth/login fonctionne (email + password_hash bcrypt),
      - /auth/me renvoie un utilisateur valide (verrous Pydantic du User),
      - ProtectedRoute laisse passer la page auditable : un client a besoin de
        >=1 moyen de paiement lié, sinon il serait redirigé vers
        /payment-verification et l'audit LHCI échouerait.
    """
    doc = _base_doc(email, password, prenom="CI", nom="Lighthouse", type_compte="client")
    # Numéro Orange Money sénégalais fictif mais VALIDE (préfixe 77x, 9 chiffres
    # locaux) : même forme que les fixtures de test. Le client a donc >=1 moyen
    # de paiement lié → ProtectedRoute passe.
    doc["payment_accounts"] = {"orange_money": "+221771112233"}
    doc["payment_accounts_count"] = 1
    return doc


def build_verified_worker_doc(email: str, password: str) -> dict:
    """Le document d'un TRAVAILLEUR vérifié (miroir de `register_user_verified`).

    Trois écarts avec le client, et chacun a une conséquence mesurable :

      * `user_type = worker` — `PUT /job-alerts` refuse un client en 403, donc
        la veille emploi de production ne peut pas être écrite avec le compte
        Lighthouse ;
      * DEUX moyens de paiement — c'est le minimum que le parcours exige d'un
        travailleur (`required_minimum: 2`), et un compte en dessous serait
        renvoyé vers /payment-verification ;
      * `skills` NON VIDE — un travailleur sans compétence ne peut proposer sur
        aucune mission, donc la page mesurée serait celle d'un compte inutilisable.

    `bio` reste vide et la note à 0 : ce compte n'a pas d'historique, et lui en
    inventer un rendrait la fiche publique qu'on mesurerait non représentative
    de la production.
    """
    doc = _base_doc(email, password, prenom="CI", nom="Worker", type_compte="worker")
    doc["payment_accounts"] = {
        "orange_money": "+221771112233",
        "wave": "+221771112244",
    }
    doc["payment_accounts_count"] = len(doc["payment_accounts"])
    # Catégories du catalogue (kojo_job_categories), pas des libellés libres :
    # une compétence hors catalogue ne donnerait aucune mission à proposer.
    doc["skills"] = ["plumbing"]
    return doc


def build_verified_doc(type_compte: str, email: str, password: str) -> dict:
    """Le document à insérer, selon la variante demandée.

    Le TYPE est une déclaration fermée : une valeur inconnue LÈVE au lieu de
    retomber sur le client — un `--type worker` mal orthographié créerait sinon
    un client, et le 403 de `PUT /job-alerts` n'expliquerait pas pourquoi.
    """
    if type_compte == "client":
        return build_verified_client_doc(email, password)
    if type_compte == "worker":
        return build_verified_worker_doc(email, password)
    raise ValueError(f"type de compte inconnu « {type_compte} » (client | worker)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Provisionne le compte dédié CI (client Lighthouse ou travailleur)."
    )
    parser.add_argument("mongo_url", help="Chaîne de connexion MongoDB de prod (MONGO_URL).")
    parser.add_argument("email", help="Adresse email du compte CI (dédié, isolé).")
    parser.add_argument(
        "--type",
        dest="type_compte",
        choices=("client", "worker"),
        default="client",
        help="Type du compte à provisionner (client par défaut).",
    )
    parser.add_argument(
        "--password", default=os.environ.get("CI_PASSWORD"),
        help="Mot de passe (préférer la variable d'env CI_PASSWORD).",
    )
    args = parser.parse_args()
    if not args.password:
        print("::error::Mot de passe manquant : passez-le en argument ou via l'env CI_PASSWORD.")
        return 2

    clean_email = sanitize_email(args.email)
    doc = build_verified_doc(args.type_compte, clean_email, args.password)
    # Défensif : ne jamais forcer un _id custom — c'est Mongo qui gère l'ObjectId.
    doc.pop("_id", None)

    uri = urlparse(args.mongo_url)
    db_name = (uri.path or "/").lstrip("/") or "kojo"

    client = pymongo.MongoClient(args.mongo_url, serverSelectionTimeoutMS=10000)
    try:
        db = client[db_name]
        users = db["users"]
        existing = users.find_one({"email": clean_email})
        if existing:
            result = users.update_one(
                {"email": clean_email},
                {
                    "$set": {
                        "password_hash": doc["password_hash"],
                        "is_verified": True,
                        "email_verified": True,
                        "payment_accounts": doc["payment_accounts"],
                        "payment_accounts_count": doc["payment_accounts_count"],
                        # `user_type` aussi : une rotation de mot de passe ne
                        # doit pas laisser un compte travailleur redescendre en
                        # client (la veille emploi redeviendrait un 403).
                        "user_type": doc["user_type"],
                        "skills": doc["skills"],
                        "bio": doc["bio"],
                        "updated_at": datetime.now(timezone.utc),
                        "password_version": (existing.get("password_version") or 0) + 1,
                    }
                },
            )
            print(f"✅ Compte CI existant mis à jour ({result.modified_count} modifié) : {clean_email}")
        else:
            # La route d'authentification cherche par champ 'id' (uuid string),
            # email unique par champ 'email'. On insère avec id (sans _id custom).
            insert_doc = {k: v for k, v in doc.items() if k != "_id"}
            users.insert_one(insert_doc)
            print(f"✅ Compte {args.type_compte} CI créé : {clean_email}")

        # Vérification finale : verify_password doit accepter le mot de passe.
        fresh = users.find_one({"email": clean_email})
        ok = fresh is not None and bcrypt.checkpw(
            args.password.encode("utf-8"), (fresh.get("password_hash") or "").encode("utf-8")
        )
        if not ok:
            print("::error::Échec de la vérification du login après insertion.")
            return 1
        print("✅ Login vérifié (bcrypt accepte le mot de passe).")
        print(f"   email          : {clean_email}")
        print(f"   user_type      : {doc['user_type']}")
        print(
            "   is_verified    : True / payment_accounts_count = %d"
            % doc["payment_accounts_count"]
        )
        print(
            "   skills         : %s"
            % (", ".join(doc["skills"]) if doc["skills"] else "(vide : compte client stable)")
        )
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())