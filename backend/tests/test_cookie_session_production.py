"""Verrou du contrôle P0.1 : le cookie de session SERVI EN PRODUCTION.

Trois attributs portent la sécurité de `kojo_session` :
- `HttpOnly` — le JWT est invisible pour JavaScript (protection XSS) ;
- `Secure` — le cookie ne repart jamais en clair sur HTTP ;
- `SameSite=none` — obligatoire pour un cookie CROSS-SITE (frontend Vercel →
  API Fly) ; sans lui le navigateur ne l'envoie pas du tout.

Les trois sont calculés À L'IMPORT de `kojo_settings`, à partir de `APP_ENV`
(`none`/`true` en production, `lax`/`false` partout ailleurs). Or toute la
suite tourne avec `APP_ENV=test` (conftest) : le cookie qui y est réellement
posé est `SameSite=lax` SANS `Secure` — exactement l'inverse de la production.
Une régression qui inverserait les deux branches, ou qui ferait retomber la
production sur le défaut de dev, resterait donc invisible pour toute la suite
(le test existant `test_login_sets_http_only_session_cookie` ne regarde que
les NOMS des cookies).

Ce fichier exerce la configuration RÉELLE de production dans un processus
neuf — même méthode que `test_cors_origins.py` : mêmes modules, même
`APP_ENV`, valeurs lues dans les en-têtes `Set-Cookie` réellement produits.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Les défauts de production sont ce qu'on verrouille : l'enfant reçoit un
# environnement SANS les surcharges AUTH_COOKIE_*/CSRF_COOKIE_*, qui
# masqueraient la branche par défaut de kojo_settings (la seule qui intéresse
# ici : personne ne pose AUTH_COOKIE_SAMESITE à la main sur Fly).
SONDE = r"""
import json
import os

from fastapi import Response

import kojo_auth_core as c

pose = Response()
c.set_auth_cookies(pose, "jeton-de-sonde")
efface = Response()
c.clear_auth_cookies(efface)

print(json.dumps({
    "app_env": os.environ.get("APP_ENV", ""),
    "nom": c.AUTH_COOKIE_NAME,
    "nom_csrf": c.CSRF_COOKIE_NAME,
    "samesite": c.AUTH_COOKIE_SAMESITE,
    "secure": c.AUTH_COOKIE_SECURE,
    "pose": pose.headers.getlist("set-cookie"),
    "efface": efface.headers.getlist("set-cookie"),
}))
"""


def _en_tete(donnees, nom_cookie):
    """L'en-tête Set-Cookie du cookie demandé, ou None s'il est absent."""
    prefixe = f"{nom_cookie}="
    for entete in donnees["pose"]:
        if entete.startswith(prefixe):
            return entete
    return None


def _en_tete_effacement(donnees, nom_cookie):
    prefixe = f"{nom_cookie}="
    for entete in donnees["efface"]:
        if entete.startswith(prefixe):
            return entete
    return None


@pytest.fixture(scope="module")
def cookie_production() -> dict:
    """Pose et efface les cookies dans un processus configuré comme la prod.

    `JWT_SECRET` et `EMAIL_OTP_SECRET` sont exigés (fail-fast) dès que
    `APP_ENV=production` ; `WEB_CONCURRENCY=1` évite le garde Redis, qui ne
    concerne pas le cookie. Aucune écriture : seuls des en-têtes sont lus.
    """
    env = {
        **os.environ,
        "APP_ENV": "production",
        "WEB_CONCURRENCY": "1",
        "JWT_SECRET": "sonde-cookie-prod-secret-32-chars-mini",
        "EMAIL_OTP_SECRET": "sonde-cookie-prod-otp-32-chars-minimum",
        # Le journal applicatif contient des emojis : sans cela, le décodage
        # cp1252 par défaut de Windows échoue à la lecture du tube.
        "PYTHONIOENCODING": "utf-8",
        # La sonde importe des modules du backend : aucun .pyc n'a de raison
        # d'être écrit pour un simple contrôle de configuration.
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for surcharge in (
        "AUTH_COOKIE_NAME",
        "CSRF_COOKIE_NAME",
        "AUTH_COOKIE_SAMESITE",
        "AUTH_COOKIE_SECURE",
    ):
        env.pop(surcharge, None)

    completed = subprocess.run(
        [sys.executable, "-c", SONDE],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    assert completed.returncode == 0, completed.stderr
    lignes = [ligne for ligne in completed.stdout.splitlines() if ligne.startswith("{")]
    assert lignes, f"aucune sortie JSON de la sonde : {completed.stdout!r}"
    return json.loads(lignes[-1])


class TestCookieSessionEnProduction:
    """Les trois attributs, lus sur l'en-tête réellement servi en production."""

    def test_defauts_de_production_et_non_ceux_du_dev(self, cookie_production):
        # Le cadre : la sonde a bien tourné en production, et la branche par
        # défaut est celle de la prod (pas le `lax`/`false` du dev).
        assert cookie_production["app_env"] == "production"
        assert cookie_production["nom"] == "kojo_session"
        assert cookie_production["samesite"] == "none"
        assert cookie_production["secure"] is True

    def test_cookie_de_session_httponly_secure_samesite_none(self, cookie_production):
        entete = _en_tete(cookie_production, "kojo_session")
        assert entete is not None, cookie_production["pose"]
        # HttpOnly : le JWT n'est pas relisible par JavaScript.
        assert "HttpOnly" in entete
        # Secure : jamais transmis en HTTP en clair.
        assert "Secure" in entete
        # SameSite=None : sans lui, un cookie cross-site n'est pas envoyé.
        assert "SameSite=none" in entete
        assert "SameSite=lax" not in entete

    def test_cookie_csrf_lisible_mais_meme_perimetre(self, cookie_production):
        """Le double-submit exige un jeton CSRF LISIBLE par JS : il ne doit
        donc PAS être HttpOnly — mais il suit le même périmètre cross-site que
        le cookie de session, sinon le navigateur l'écarte."""
        entete = _en_tete(cookie_production, "kojo_csrf")
        assert entete is not None, cookie_production["pose"]
        assert "HttpOnly" not in entete
        assert "Secure" in entete
        assert "SameSite=none" in entete

    def test_effacement_garde_le_perimetre_du_cookie(self, cookie_production):
        """Un effacement dont les attributs ne correspondent pas au cookie posé
        est ignoré par le navigateur : la déconnexion laisserait une session
        vivante. L'en-tête de suppression doit donc porter le même périmètre."""
        entete = _en_tete_effacement(cookie_production, "kojo_session")
        assert entete is not None, cookie_production["efface"]
        assert "HttpOnly" in entete
        assert "Secure" in entete
        assert "SameSite=none" in entete
