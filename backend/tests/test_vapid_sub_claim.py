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

# Domaines réservés (RFC 2606 / RFC 6761) : jamais une adresse de contact
# réelle, donc jamais un défaut acceptable pour le claim `sub`.
DOMAINES_PLACEHOLDER = (
    "example.com",
    "example.org",
    "example.net",
    "example",
    "invalid",
    "test",
    "localhost",
)


def _domaine_du_claim(claim):
    """Domaine d'un claim `sub` mailto: — None si ce n'est pas un mailto:."""
    if not isinstance(claim, str) or not claim.lower().startswith("mailto:"):
        return None
    adresse = claim.split(":", 1)[1]
    if "@" not in adresse:
        return None
    return adresse.rsplit("@", 1)[1].lower()


def _est_placeholder(claim):
    """True si le claim mailto: pointe un domaine réservé (ex. example.com).

    Un claim https: n'est jamais un placeholder par construction (un domaine
    réservé y serait au moins explicite).
    """
    domaine = _domaine_du_claim(claim)
    if domaine is None:
        return False
    return any(domaine == d or domaine.endswith("." + d) for d in DOMAINES_PLACEHOLDER)


def _defaut_du_code():
    """Défaut littéral de VAPID_CLAIMS_EMAIL dans kojo_settings.py.

    Lu dans la SOURCE (et non via l'import) pour rester un test du défaut même
    si la variable d'environnement est définie localement ou en CI.
    """
    source = (BACKEND_DIR / "kojo_settings.py").read_text(encoding="utf-8")
    match = re.search(
        r"VAPID_CLAIMS_EMAIL\s*=\s*os\.environ\.get\(\s*['\"]VAPID_CLAIMS_EMAIL['\"]\s*,\s*['\"]([^'\"]*)['\"]",
        source,
    )
    assert match, "défaut de VAPID_CLAIMS_EMAIL introuvable dans kojo_settings.py"
    return match.group(1)


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

    def test_defaut_code_pas_un_placeholder(self):
        # Le défaut littéral du code (utilisé quand l'env n'est pas définie)
        # doit être une adresse RÉELLE : un domaine réservé passe le validateur
        # de format tout en étant inutilisable — la panne VAPID redeviendrait
        # silencieuse en cas de variable manquante sur Fly.
        defaut = _defaut_du_code()
        assert validate_vapid_sub_claim(defaut)
        assert not _est_placeholder(defaut), (
            f"défaut de VAPID_CLAIMS_EMAIL = domaine réservé ({defaut})"
        )

    def test_defaut_egal_reference_env_example(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        match = re.search(
            r"^VAPID_CLAIMS_EMAIL=(\S+)\s*$",
            env_path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        assert match, "VAPID_CLAIMS_EMAIL absent de .env.example"
        assert _defaut_du_code() == match.group(1), (
            f"défaut du code ({_defaut_du_code()}) != .env.example ({match.group(1)})"
        )

    def test_doc_deploiement_reprend_l_adresse_du_defaut(self):
        doc_path = BACKEND_DIR / "DEPLOY_FLYIO.md"
        if not doc_path.exists():
            pytest.skip("DEPLOY_FLYIO.md absent")
        adresse = _defaut_du_code()
        assert adresse in doc_path.read_text(encoding="utf-8"), (
            f"DEPLOY_FLYIO.md ne documente pas l'adresse par défaut du code ({adresse})"
        )


class TestDetecteurPlaceholder:
    """Le garde anti-placeholder doit échouer sur de VRAIS placeholders.

    Sans ce test, `test_defaut_code_pas_un_placeholder` pourrait passer parce
    que le détecteur ne détecte rien du tout.
    """

    @pytest.mark.parametrize(
        "claim",
        [
            "mailto:kojo@example.com",
            "mailto:contact@example.org",
            "mailto:dev@example.net",
            "mailto:preprod@test",
            "mailto:dev@localhost",
            "mailto:x@sous.example.com",
        ],
    )
    def test_detecte_les_domaines_reserves(self, claim):
        assert _est_placeholder(claim)

    @pytest.mark.parametrize(
        "claim",
        [
            "mailto:kojoapp98@gmail.com",
            "https://kojo.app/contact",
        ],
    )
    def test_ne_detecte_pas_une_vraie_adresse(self, claim):
        assert not _est_placeholder(claim)
