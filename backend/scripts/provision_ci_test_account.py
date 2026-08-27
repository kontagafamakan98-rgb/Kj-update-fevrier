#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Provisionne le COMPTE CLIENT DÉDIÉ CI (isolé des comptes de test e2e partagés).

POURQUOI : le job Lighthouse CI (lighthouse-ci) audite /dashboard, /jobs et
/profile en tant que CLIENT. Historiquement il réutilisait le compte e2e
partagé (makemoney0598@), modifié par les tests de bout en bout manuels
(profil, photo, missions) → les budgets Lighthouse variaient d'un run à
l'autre selon ce que l'état manuel du compte. Ce script crée un compte client
NEUF, VERROUILLÉ, utilisé UNIQUEMENT par la CI : personne ne le touche à la
main, donc les pages auditées ont un état déterministe.

INSÉRITION DIRECTE en base (au lieu du flux register-verified, qui exige un
OTP email) : on miroire EXACTEMENT les invariants qu'un client vérifié
aurait après register-verified :
  - is_verified=True, email_verified=True, payment_accounts_count>=1 (un
    client doit avoir >=1 moyen de paiement sinon ProtectedRoute le renvoie
    vers /payment-verification → l'audit LHCI échouerait).
  - password_hash = bcrypt (hash_password de kojo_core), verify_password
    fonctionne donc au login.
  - skills=[], bio=null : profil volontairement vide et stable (le Dashboard/
    Profile sont les mêmes à chaque run).

USAGE (depuis un hôte autorisé, ex. une machine de l'équipe, avec accès à la
base de prod) :
    # 1. Récupérer MONGO_URL depuis les secrets Fly :
    flyctl secrets list --app kojo-backend
    # 2. Lancer :
    python backend/scripts/provision_ci_test_account.py <MONGO_URL> <email> <password>
    # 3. Documenter le couple <email>/<password> dans les secrets GitHub :
    #    Settings → Secrets and variables → Actions → ajouter
    #    LHCI_CI_EMAIL et LHCI_CI_PASSWORD (JAMAIS en clair dans le repo).

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
    now = datetime.now(timezone.utc)
    clean_email = sanitize_email(email)
    # Numéro Orange Money sénégalais fictif mais VALIDE (préfixe 77x, 9 chiffres
    # locaux) : même forme que les fixtures de test. Le client a donc >=1 moyen
    # de paiement lié → ProtectedRoute passe.
    payment_accounts = {"orange_money": "+221771112233"}
    return {
        "id": str(__import__("uuid").uuid4()),
        "email": clean_email,
        "password_hash": hash_password(password),
        "google_sub": None,
        "first_name": "CI",
        "last_name": "Lighthouse",
        "phone": "+221771112233",
        "user_type": "client",
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
        "payment_accounts": payment_accounts,
        "payment_accounts_count": 1,
        "rating": 0.0,
        "total_reviews": 0,
        "created_at": now,
        "updated_at": now,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Provisionne le compte client dédié CI.")
    parser.add_argument("mongo_url", help="Chaîne de connexion MongoDB de prod (MONGO_URL).")
    parser.add_argument("email", help="Adresse email du compte client CI (dédié, isolé).")
    parser.add_argument(
        "--password", default=os.environ.get("CI_PASSWORD"),
        help="Mot de passe (préférer la variable d'env CI_PASSWORD).",
    )
    args = parser.parse_args()
    if not args.password:
        print("::error::Mot de passe manquant : passez-le en argument ou via l'env CI_PASSWORD.")
        return 2

    clean_email = sanitize_email(args.email)
    doc = build_verified_client_doc(clean_email, args.password)
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
                        "payment_accounts_count": 1,
                        "skills": [],
                        "bio": None,
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
            print(f"✅ Compte client CI créé : {clean_email}")

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
        print("   user_type      : client")
        print("   is_verified    : True / payment_accounts_count = 1")
        print("   skills         : [] (volontairement vide et stable)")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())