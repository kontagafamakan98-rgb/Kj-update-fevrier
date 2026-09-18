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
import re
import shutil
from pathlib import Path

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
    assert extract_host_from_url("https://api.kojoforafrica.cc.cd") == "api.kojoforafrica.cc.cd"
    assert extract_host_from_url("api.kojoforafrica.cc.cd") == "api.kojoforafrica.cc.cd"
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


# `test_shared_helpers_importable` est SUPPRIMÉ : il n'affirmait que l'existence
# de trois exports de kojo_shared. L'import du module est déjà prouvé, nom par
# nom, par tests/test_import_health.py (qui échoue sur un `NameError`/`ImportError`
# à l'import), et un garde refuse désormais ce type d'assertion :
# .github/scripts/check-test-existence-assertions.py.


# ── Garde pyflakes : aucun nom non défini dans les modules découpés ──────────
# Les modules surveillés sont DÉRIVÉS du dossier (`kojo_*.py` + `server.py`). La
# liste était recopiée à la main et en omettait quatre, dont `server.py` — le
# fichier dont le `NameError` a atteint la production le 2026-08-27 — et
# `kojo_routers_public.py`, qui sert les fiches mission. Un module ajouté au
# backend entre désormais dans le périmètre sans que personne n'y pense.
BACKEND_DIR = Path(__file__).resolve().parent.parent


def split_modules(root=BACKEND_DIR):
    """Modules surveillés : tous les `kojo_*.py` du backend, plus `server.py`."""
    return sorted(path.name for path in Path(root).glob("kojo_*.py")) + ["server.py"]


def _pyflakes_reporter():
    """Rapporteur pyflakes qui COLLECTE les messages au lieu de les imprimer."""
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

    return _Reporter()


def undefined_names(paths):
    """Lignes « undefined name » que pyflakes signale pour ces fichiers.

    pyflakes est requis (outil de dev, installé en CI) ; sans lui le test est
    SAUTÉ — un vert à connaître, pas un silence : le job méta-test
    `audit-regression-test` prouve par ailleurs que pyflakes lui-même sait
    échouer sur un import retiré.
    """
    pyflakes_api = pytest.importorskip("pyflakes.api", reason="pyflakes non installé")
    reporter = _pyflakes_reporter()
    for path in paths:
        pyflakes_api.checkPath(str(path), reporter)
    return [line for line in reporter.buffer.getvalue().splitlines() if "undefined name" in line]


def _imported_name(line):
    """Nom lié par une ligne d'import, ou None (alias compris)."""
    aliased = re.match(r"^\s*import\s+([\w.]+)\s+as\s+(\w+)", line)
    if aliased:
        return aliased.group(2)
    plain = re.match(r"^\s*import\s+([\w.]+)", line)
    if plain:
        return plain.group(1).split(".")[0]
    from_import = re.match(r"^\s*from\s+[\w.]+\s+import\s+([A-Za-z_]\w*)\s*$", line)
    return from_import.group(1) if from_import else None


def _remove_first_used_import(source):
    """Retire le premier import dont le nom est UTILISÉ ailleurs dans le fichier.

    Retourne (source mutée, nom retiré) ou (None, None). L'usage est vérifié
    AVANT de retirer quoi que ce soit : supprimer un import inutilisé ne
    déclencherait aucun message, et le test échouerait pour une mauvaise raison.
    """
    for line in source.splitlines():
        candidate = _imported_name(line)
        if not candidate:
            continue
        reste = source.replace(line, "", 1)
        if re.search(rf"\b{re.escape(candidate)}\b", reste):
            return reste, candidate
    return None, None


def test_le_perimetre_des_modules_est_derive_et_complet():
    """Non-vacuité : la dérivation voit bien les modules, y compris les oubliés."""
    names = split_modules()
    assert len(names) >= 20, names
    for attendu in ("server.py", "kojo_routers_public.py", "kojo_env_validators.py"):
        assert attendu in names, f"{attendu} est hors du périmètre pyflakes : {names}"
    # Le step pyflakes de la CI doit viser le MÊME ensemble : deux périmètres qui
    # divergent en silence, c'est précisément ce qui a laissé quatre modules hors
    # garde (dont `server.py`).
    workflow = (BACKEND_DIR.parent / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    assert "python -m pyflakes kojo_*.py server.py" in workflow, (
        "le step pyflakes de la CI ne vise plus kojo_*.py + server.py : le garde et la CI "
        "surveilleraient deux ensembles différents"
    )


def test_no_undefined_names_in_split_modules():
    """Garde-fou : aucun nom non défini dans les modules découpés.

    Aucun module n'a besoin d'être IMPORTÉ ici : pyflakes ne fait qu'analyser des
    fichiers. Qu'un module échoue à s'importer est la question d'un autre garde,
    plus fort que celui-ci — tests/test_import_health.py.
    """
    undefined = undefined_names([BACKEND_DIR / name for name in split_modules()])
    assert not undefined, "Noms non définis détectés dans les modules découpés:\n" + "\n".join(undefined)


def test_le_garde_echoue_quand_on_retire_un_import(tmp_path):
    """Mutation, sur une COPIE des modules réels : retirer un import utilisé rougit.

    Sans ce test, « ce garde échoue quand un import manque » restait une
    supposition : la suite ne l'exerçait que sur des modules sains, donc un
    garde devenu aveugle (mauvaise liste de fichiers, filtre trop large) aurait
    gardé sa réputation sans preuve.
    """
    pytest.importorskip("pyflakes.api", reason="pyflakes non installé")

    copies = []
    for name in split_modules():
        target = tmp_path / name
        shutil.copyfile(BACKEND_DIR / name, target)
        copies.append(target)

    # Contrôle : la copie INTACTE est propre — c'est donc bien la mutation, et
    # non la copie ou le chemin, qui déclenche le message.
    assert undefined_names(copies) == [], "la copie intacte n'est pas propre : le reste ne prouve rien"

    mutated, removed = None, None
    for target in copies:
        mutated_source, name = _remove_first_used_import(target.read_text(encoding="utf-8"))
        if mutated_source is None:
            continue
        target.write_text(mutated_source, encoding="utf-8")
        mutated, removed = target, name
        break
    assert mutated is not None, (
        "aucun import utilisé trouvé dans les modules copiés : la mutation ne prouve rien"
    )

    report = "\n".join(undefined_names(copies))
    assert report, f"retirer l'import `{removed}` de {mutated.name} n'a été signalé par personne"
    assert mutated.name in report, report
    assert removed in report, report
