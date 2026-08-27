# -*- coding: utf-8 -*-
"""Régression : format du claim `sub` VAPID conforme au RFC 8292.

Historique : `VAPID_CLAIMS_EMAIL` avait été configurée sur Fly avec un espace
après le deux-points (« mailto: kojoapp98@gmail.com »). Le claim `sub` du JWT
VAPID devenait invalide et les push providers (Mozilla/Google) rejetaient
l'authentification avec un 401/403 silencieux côté backend.

Ce test verrouille le format (RFC 8292 §4.2 : `sub` = URI mailto: RFC 6068 ou
https: RFC 2818, sans espace) à la fois sur le validateur et sur les valeurs
de référence (défaut du code + .env.example) — tout espace après mailto:
re-ferait échouer la CI.
"""
import os
import re
import sys
from pathlib import Path

import pytest

# Le validateur vit dans kojo_settings (mêmes règles que la prod).
from kojo_settings import VAPID_CLAIMS_EMAIL, validate_vapid_sub_claim

BACKEND_DIR = Path(__file__).resolve().parent.parent


class TestVapidSubClaimValid:
    def test_mailto_sans_espace(self):
        assert validate_vapid_sub_claim("mailto:kojoapp98@gmail.com") == "mailto:kojoapp98@gmail.com"

    def test_mailto_majuscule_schema(self):
        # RFC 6068 : les schémas d'URI sont insensibles à la casse.
        assert validate_vapid_sub_claim("MAILTO:Kojoapp98@Gmail.com") == "MAILTO:Kojoapp98@Gmail.com"

    def test_https_valide(self):
        assert validate_vapid_sub_claim("https://kojo.app/contact") == "https://kojo.app/contact"

    def test_https_avec_path_et_query(self):
        assert validate_vapid_sub_claim("https://kojo.app/support?ref=vapid") == "https://kojo.app/support?ref=vapid"

    def test_espaces_externes_strippes(self):
        assert validate_vapid_sub_claim("  mailto:kojoapp98@gmail.com  ") == "mailto:kojoapp98@gmail.com"


class TestVapidSubClaimInvalide:
    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "",                       # vide
            "   ",                    # que des espaces
            "mailto: kojoapp98@gmail.com",   # RÉGRESSION HISTORIQUE : espace après mailto:
            "mailto:  kojoapp98@gmail.com",  # deux espaces
            "https:// kojo.app",          # espace dans l'URL https
            "mailto:contact@",            # pas de domaine
            "mailto:@exemple.com",        # pas de local-part
            "mailto:",                    # rien après le préfixe
            "https://",                   # rien après le préfixe
            "http://kojo.app",            # http non autorisé (RFC 8292 : https OU mailto)
            "kojoapp98@gmail.com",           # email nu sans schéma
            "kojo.app",                   # host nu
            "mailto:kojoapp98@gmail.com et plus",  # texte après l'adresse
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_vapid_sub_claim(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_vapid_sub_claim(None)


class TestReferencesProd:
    """Les valeurs de référence ne doivent JAMAIS redevenir invalides."""

    def test_default_settings_valide(self):
        # Le défaut du code (utilisé quand l'env n'est pas défini) doit passer.
        assert validate_vapid_sub_claim(VAPID_CLAIMS_EMAIL)

    def test_env_example_valide(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        content = env_path.read_text(encoding="utf-8")
        match = re.search(r"^VAPID_CLAIMS_EMAIL=(\S+)\s*$", content, re.MULTILINE)
        assert match, "VAPID_CLAIMS_EMAIL absent de .env.example"
        assert validate_vapid_sub_claim(match.group(1))

    def test_doc_deploiement_valide(self):
        # DEPLOY_FLYIO.md documente la valeur à copier — elle doit rester valide.
        doc_path = BACKEND_DIR / "DEPLOY_FLYIO.md"
        if not doc_path.exists():
            pytest.skip("DEPLOY_FLYIO.md absent")
        content = doc_path.read_text(encoding="utf-8")
        for valeur in re.findall(r"VAPID_CLAIMS_EMAIL=(\S+)", content):
            assert validate_vapid_sub_claim(valeur)
