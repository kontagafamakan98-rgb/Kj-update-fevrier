# -*- coding: utf-8 -*-
"""Régression infrastructure : le health check Fly doit rester en TCP.

Le TrustedHostMiddleware est ACTIF en prod (plus de secret
DISABLE_TRUSTED_HOST_MIDDLEWARE). Un health check HTTP (**service.check)
traverserait ce middleware et échouerait en 400 « Invalid host header »
sur le Host interne des sondes Fly → Fly retirerait la machine du pool et
le backend serait indisponible. C'est pourquoi fly.toml utilise une
syntaxe complète [[services]] + [[services.tcp_checks]] (le raccourci
[http_service] ne sait exprimer QUE des checks HTTP).

Ce test verrouille cette configuration : si quelqu'un repasse le check en
HTTP (ou oublie le check TCP en revenant à [http_service]), la CI échoue
au lieu que le middleware casse la prod au prochain déploiement.
"""
import pathlib

import pytest

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
FLY_TOML_PATH = BACKEND_DIR / "fly.toml"


@pytest.fixture(scope="module")
def fly_toml_text() -> str:
    if not FLY_TOML_PATH.exists():
        pytest.fail(f"{FLY_TOML_PATH} introuvable — le backend est-il déployé sur Fly ?")
    return FLY_TOML_PATH.read_text(encoding="utf-8")


def _strip_comments(text: str) -> str:
    """Retire les commentaires TOML (#) pour n'analyser que le code effectif.

    fly.toml documente abondamment les choix — les commentaires citent
    [http_service], [[services]], etc. Sans ce strip, on aurait des faux
    positifs (le mot apparaîtrait seulement en prose).
    """
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        # Une ligne entièrement commentée : ignorée.
        if stripped.startswith("#"):
            continue
        # Retire un éventuel commentaire en fin de ligne (précédé d'un espace).
        if "#" in line:
            line = line.split(" #", 1)[0].rstrip()
        lines.append(line)
    return "\n".join(lines)


def _services_section(text: str) -> str:
    """Extrait la première section [[services]] de fly.toml (jusqu'à [[vm]])."""
    start = text.find("[[services]]")
    assert start != -1, "Aucune section [[services]] dans fly.toml"
    end = len(text)
    for marker in ("[[vm]]", "[vm]"):
        idx = text.find(marker, start + len("[[services]]"))
        if idx != -1:
            end = idx
            break
    return text[start:end]


class TestFlyTomlTcpHealthCheck:
    def test_utilise_la_syntaxe_services_et_non_http_service(self, fly_toml_text):
        # Le raccourci [http_service] ne supporte que des checks HTTP — il
        # faut la syntaxe complète [[services]] pour pouvoir déclarer un
        # check TCP (nécessaire au middleware actif). Les commentaires sont
        # ignorés (ils documentent précisément ce choix).
        code = _strip_comments(fly_toml_text)
        assert "[http_service]" not in code, (
            "fly.toml revient à [http_service] : seul des checks HTTP sont "
            "possibles → le TrustedHostMiddleware casserait la prod "
            "(400 Invalid host header sur les sondes internes Fly). Utiliser "
            "[[services]] + [[services.tcp_checks]]."
        )
        assert "[[services]]" in code, (
            "Aucune section [[services]] dans fly.toml — le check TCP qui "
            "permet d'activer le TrustedHostMiddleware manque."
        )

    def test_declare_un_check_tcp(self, fly_toml_text):
        services = _services_section(fly_toml_text)
        assert "[[services.tcp_checks]]" in services, (
            "Aucun [[services.tcp_checks]] dans fly.toml — sans check TCP, "
            "un éventuel check HTTP traverserait le TrustedHostMiddleware "
            "et échouerait en 400 sur le Host des sondes Fly (backend retiré "
            "du pool). Déclarer [[services.tcp_checks]] (interval/timeout/"
            "grace_period)."
        )

    def test_aucun_check_http_http_service_dans_les_services(self, fly_toml_text):
        services = _services_section(fly_toml_text)
        # Un check HTTP ([[services.http_checks]] ou http_service.checks avec
        # method/path) retraverserait le middleware — strictement interdit.
        assert "[[services.http_checks]]" not in services, (
            "[[services.http_checks]] présent : ce check HTTP transmettrait "
            "des Host internes au TrustedHostMiddleware → 400 Invalid host "
            "header. Remplacer par [[services.tcp_checks]]."
        )
        assert "[[http_service.checks]]" not in services, (
            "Un check HTTP 'http_service.checks' présent : retraverserait le "
            "middleware. Passer sur [[services.tcp_checks]]."
        )

    def test_ports_http_force_https_et_tls(self, fly_toml_text):
        services = _services_section(fly_toml_text)
        # Les deux ports standard du service HTTP (équivalents de
        # [http_service] force_https) doivent rester déclarés.
        assert "[[services.ports]]" in services
        assert "port = 80" in services, "Le port 80 (HTTP, force_https) manque"
        assert "force_https = true" in services, "force_https retiré sur le port 80"
        assert "port = 443" in services, "Le port 443 (HTTP+TLS) manque"
        assert "handlers = ['http', 'tls']" in services, (
            "Le port 443 doit servir http+tls (force_https)"
        )

    # ─── CAS NÉGATIFS (régressions) — le garde-fou doit bien échouer ───────
    @staticmethod
    def _http_services_config() -> str:
        """Un fly.toml RÉGRESSÉ : retour à [http_service] avec check HTTP
        (le motif qui a cassé la prod avant le passage en TCP).

        Reprend la structure actuelle mais remplace [[services]] +
        [[services.tcp_checks]] par le raccourci [http_service] + un
        [[http_service.checks]] HTTP sur /health.
        """
        return """
[env]
  APP_ENV = 'production'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'

  [[http_service.checks]]
    interval = '30s'
    timeout = '5s'
    grace_period = '30s'
    method = 'GET'
    path = '/health'
"""

    def test_regression_http_service_config_est_rejetee(self):
        """Si on revient à [http_service] + check HTTP, le garde doit rejeter."""
        bad = self._http_services_config()
        assert "[http_service]" in _strip_comments(bad)
        assert "[[services]]" not in _strip_comments(bad)
        assert "[[services.tcp_checks]]" not in bad

    def test_regression_check_http_apparait_dans_services(self):
        """Retirer le check TCP et ajouter un check HTTP ([[services.http_checks]])
        → le garde _services_section doit contenir le motif HTTP et être
        rejeté par la même assertion que le test positif.

        On le vérifie via les helper builds : on repart du fly.toml réel mais
        on supprime le tcp_checks et on ajoute un http_checks dans la section
        [[services]] — le test suivant reproduit l'assertion de
        test_aucun_check_http_http_service_dans_les_services.
        """
        import re as _re
        text = FLY_TOML_PATH.read_text(encoding="utf-8")
        # Insère un check HTTP DANS la section [[services]] (avant [[vm]]).
        svc_port_443_idx = text.find("handlers = ['http', 'tls']")
        assert svc_port_443_idx != -1, "port 443 non trouvé"
        http_checks_block = (
            "\n\n  # régression\n  [[services.http_checks]]\n"
            "    method = 'GET'\n    path = '/health'\n"
        )
        regressed = (
            text[: svc_port_443_idx]
            + text[svc_port_443_idx : svc_port_443_idx + 50]
            + http_checks_block
            + text[svc_port_443_idx + 50 :]
        )
        # Le garde _services_section doit voir le check HTTP injecté.
        services = _services_section(regressed)
        assert "[[services.http_checks]]" in services, (
            "le check HTTP aurait dû entrer dans la section [[services]]"
        )
        # Et l'assertion du test positif test_aucun_check_http... rejetterait
        # cette config : on reproduit sa logique de détection.
        code = _strip_comments(regressed)
        assert "[[services.http_checks]]" in code