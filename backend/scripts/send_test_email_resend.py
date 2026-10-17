#!/usr/bin/env python3
"""
Envoi de contrôle Resend : le « Hello World » de la doc, par le code du backend.

Pourquoi côté BACKEND, et pas le snippet JavaScript tel quel
------------------------------------------------------------
La clé Resend (`re_…`) autorise l'envoi d'emails au nom du domaine : dans du
code frontend, elle finit dans le bundle servi à tous les visiteurs — le dépôt
a des gardes qui refusent exactement ça (check-origines-bundles,
check-token-exposure-production). Ici elle est lue de l'environnement
(`backend/.env` en local, secrets Fly en production) et n'est jamais imprimée.

Ce script passe par le MÊME chemin que la production
(`kojo_email.send_email_via_resend_api`) : ce qu'il valide est donc la vraie
configuration du backend, pas un appel isolé qui pourrait réussir à côté.

Usage
-----
    cd backend && python scripts/send_test_email_resend.py [destinataire]

Sans RESEND_SENDER_EMAIL, l'expéditeur de test `onboarding@resend.dev` est
utilisé — Resend n'accepte alors QUE l'adresse du compte : pour écrire à
n'importe qui, vérifier le domaine puis poser RESEND_SENDER_EMAIL dessus.

Codes de sortie : 0 envoyé, 2 configuration absente, 1 refus du fournisseur.
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Expéditeur de TEST de Resend : il n'autorise que l'adresse du compte. Une
# valeur dans l'environnement le remplace (domaine vérifié = envoi réel).
EXPEDITEUR_DE_TEST = "onboarding@resend.dev"
DESTINATAIRE_PAR_DEFAUT = "kojoapp98@gmail.com"
SUJET = "Hello World"
HTML = "<p>Congrats on sending your <strong>first email</strong>!</p>"
TEXTE = "Congrats on sending your first email!"


def main(argv) -> int:
    """Envoie l'email de contrôle et rend le code de sortie du script."""
    destinataire = argv[1] if len(argv) > 1 else DESTINATAIRE_PAR_DEFAUT

    # .env AVANT l'import de kojo_settings : les réglages sont lus à l'import
    # (os.environ.get), donc charger le fichier après ne servirait à rien.
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")

    sys.path.insert(0, str(BACKEND_DIR))
    import kojo_email
    from fastapi import HTTPException

    if not os.environ.get("RESEND_API_KEY", "").strip():
        print("[ERR] RESEND_API_KEY est absente.")
        print("      Local   : l'ajouter dans backend/.env (RESEND_API_KEY=re_...)")
        print("      Production : flyctl secrets set RESEND_API_KEY=re_... -a kojo-backend")
        return 2

    # Même code que la production ; seul l'expéditeur de repli change, et
    # seulement pour ce processus (une clé de test ne peut écrire qu'à
    # l'adresse du compte, d'où l'expéditeur de test).
    expediteur = os.environ.get("RESEND_SENDER_EMAIL", "").strip() or EXPEDITEUR_DE_TEST
    kojo_email.RESEND_SENDER_EMAIL = expediteur

    print(f"[INFO] Envoi Resend : {expediteur} -> {destinataire}")
    print(f"[INFO] Clé présente : {len(kojo_email.RESEND_API_KEY)} caractères (valeur jamais affichée)")

    try:
        reponse = kojo_email.send_email_via_resend_api(
            destinataire, SUJET, TEXTE, HTML
        )
    except HTTPException as exc:
        print(f"[ERR] HTTP {exc.status_code} : {exc.detail}")
        return 1

    identifiant = (reponse or {}).get("id", "(sans id)")
    print(f"[OK]  Email accepté par Resend — id {identifiant}")
    print("      Si rien n'arrive : vérifier les spams, puis le domaine (Resend → Domains).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
