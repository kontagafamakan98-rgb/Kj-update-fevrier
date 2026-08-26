"""
Régression : imports manquants lors du découpage de server.py (kojo_*).

Ces tests couvrent des chemins que la suite fonctionnelle ne déclenche pas
(OTP réel, trusted hosts Render, décaissements PayDunya, push web). Ils ont
été ajoutés après que le déploiement Render a crashé sur
`NameError: name 'urlparse' is not defined` dans kojo_core.build_trusted_hosts
— des noms non définis passent inaperçus tant que le chemin n'est pas exécuté.

Note : en mode TEST_MONGO_URL (vrai MongoDB), ces tests s'exécutent aussi ;
ils n'ont pas besoin de données.
"""
import os

import pytest


def test_build_trusted_hosts_with_render_hostname(monkeypatch):
    """RENDER_EXTERNAL_HOSTNAME (auto-défini par Render) doit être accepté.

    C'est le crash exact du déploiement : build_trusted_hosts appelait
    urlparse sans l'avoir importé — uniquement exécuté quand une URL
    d'environnement est non vide.
    """
    from kojo_core import build_trusted_hosts

    monkeypatch.setenv("RENDER_EXTERNAL_HOSTNAME", "kojo-backend-03az.onrender.com")
    monkeypatch.setenv("FRONTEND_APP_URL", "")
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "")
    monkeypatch.setenv("CORS_ORIGINS", "")
    monkeypatch.setenv("TRUSTED_HOSTS", "")

    hosts = build_trusted_hosts()
    assert "kojo-backend-03az.onrender.com" in hosts
    assert "localhost" in hosts
    assert "127.0.0.1" in hosts


def test_extract_host_from_url_documented_none_cases():
    """extract_host_from_url : hostname extrait, None documenté pour les
    entrées vides ou invalides (appelants = build_trusted_hosts)."""
    from kojo_core import extract_host_from_url

    # Hostname extrait, avec ou sans schéma
    assert extract_host_from_url("https://kojo-backend.fly.dev") == "kojo-backend.fly.dev"
    assert extract_host_from_url("kojo-backend.fly.dev") == "kojo-backend.fly.dev"
    assert extract_host_from_url("  https://api.kojo.sn/  ") == "api.kojo.sn"
    # Cas None documentés
    assert extract_host_from_url("") is None
    assert extract_host_from_url("   ") is None
    assert extract_host_from_url(None) is None
    assert extract_host_from_url("://pas-de-host") is None


def test_get_mobile_money_account_documented_none():
    """get_mobile_money_account : (méthode, numéro) ou (None, None) documenté
    quand aucun compte mobile money n'est enregistré."""
    from kojo_payments import get_mobile_money_account

    assert get_mobile_money_account({"orange_money": "77000000"}) == ("orange_money", "77000000")
    assert get_mobile_money_account({"wave": "77111111"}) == ("wave", "77111111")
    # Orange Money prioritaire sur Wave
    assert get_mobile_money_account({"orange_money": "77000000", "wave": "77111111"}) == ("orange_money", "77000000")
    # Cas (None, None) documentés
    assert get_mobile_money_account({"bank": {"iban": "x"}}) == (None, None)
    assert get_mobile_money_account({}) == (None, None)
    assert get_mobile_money_account(None) == (None, None)


def test_get_cached_payment_status_documented_none():
    """_get_cached_payment_status : record frais retourné, None documenté sur
    cache-miss ou entrée expirée (> TTL 15 s)."""
    import time as _time
    from kojo_routers_payments import _get_cached_payment_status, _cache_payment_status

    try:
        assert _get_cached_payment_status("missing-id") is None
        _cache_payment_status("p1", {"id": "p1", "status": "completed"})
        cached = _get_cached_payment_status("p1")
        assert cached is not None and cached["status"] == "completed"
        # Expiration simulée (le TTL est comparé à time.time())
        import kojo_routers_payments as rp
        rp._payment_status_cache["p1"] = {"at": _time.time() - 60, "record": {"id": "p1", "status": "completed"}}
        assert _get_cached_payment_status("p1") is None
    finally:
        import kojo_routers_payments as rp
        rp._payment_status_cache.pop("p1", None)


def test_generate_email_otp_code_uses_secrets():
    """generate_email_otp_code dépend de l'import `secrets` (ajouté en régression)."""
    from kojo_email import generate_email_otp_code

    code = generate_email_otp_code()
    assert len(code) == 6
    assert code.isdigit()


def test_strip_country_code_for_disburse_uses_re():
    """Le nettoyage de téléphone de décaissement dépend de l'import `re`."""
    from kojo_payments import strip_country_code_for_disburse

    assert strip_country_code_for_disburse("+221771234567") == "771234567"
    assert strip_country_code_for_disburse("771234567") == "771234567"
    assert strip_country_code_for_disburse(None) == ""


def test_paydunya_disburse_base_url_defined():
    """La constante de décaissement PayDunya a été réintroduite dans les settings."""
    from kojo_settings import PAYDUNYA_DISBURSE_BASE_URL

    assert PAYDUNYA_DISBURSE_BASE_URL.startswith("https://")
    assert "disburse" in PAYDUNYA_DISBURSE_BASE_URL


def test_shared_helpers_importable():
    """kojo_shared dépend de json (push web) et de timedelta (expiration VAPID)."""
    from kojo_shared import _send_payment_pending_to_worker, send_web_push_to_user, store_notification

    assert callable(_send_payment_pending_to_worker)
    assert callable(send_web_push_to_user)
    assert callable(store_notification)


def test_jobs_router_imports_payment_helper():
    """kojo_routers_jobs appelle _send_payment_pending_to_worker (import régression)."""
    from kojo_routers_jobs import router

    assert router is not None


def test_profile_photo_imports():
    """Le chemin photo de profil (base64/io/cloudinary/ValidationError) importe correctement."""
    import kojo_routers_auth
    import kojo_routers_users

    assert kojo_routers_auth.router is not None
    assert kojo_routers_users.router is not None


def test_owner_and_payments_router_imports():
    """kojo_routers_owner (logging) et kojo_routers_payments (os) importent correctement."""
    import kojo_routers_owner
    import kojo_routers_payments

    assert kojo_routers_owner.router is not None
    assert kojo_routers_payments.router is not None


def test_no_undefined_names_in_split_modules():
    """Garde-fou : aucun nom non défini dans les modules découpés.

    Utilise pyflakes s'il est installé (déclaré dans les outils de dev) ;
    sinon le test est sauté (les autres tests couvrent déjà les chemins clés).
    """
    pyflakes = pytest.importorskip("pyflakes.api", reason="pyflakes non installé")
    from pyflakes import reporter as pyflakes_reporter

    import io as _io

    class _Reporter(pyflakes_reporter.Reporter):
        def __init__(self):
            self.buffer = _io.StringIO()
            super().__init__(self.buffer, self.buffer)

        def unexpectedError(self, filename, msg):
            pass

        def syntaxError(self, filename, msg, lineno, column, text):
            pass

    module_names = [
        "kojo_core", "kojo_email", "kojo_geo_data", "kojo_models", "kojo_payments",
        "kojo_routers_auth", "kojo_routers_geo", "kojo_routers_jobs",
        "kojo_routers_messages", "kojo_routers_notifications",
        "kojo_routers_owner", "kojo_routers_payments", "kojo_routers_support",
        "kojo_routers_users", "kojo_scheduler", "kojo_settings", "kojo_shared",
    ]
    import kojo_shared  # noqa: F401  (importe pywebpush si dispo)

    rep = _Reporter()
    import pyflakes.api as pf_api

    for name in module_names:
        path = os.path.join(os.path.dirname(__file__), "..", f"{name}.py")
        pf_api.checkPath(os.path.abspath(path), rep)

    output = rep.buffer.getvalue()
    undefined = [ln for ln in output.splitlines() if "undefined name" in ln]
    assert not undefined, f"Noms non définis détectés dans les modules découpés:\n" + "\n".join(undefined)
