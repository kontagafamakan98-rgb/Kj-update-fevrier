# -*- coding: utf-8 -*-
"""Régression : le check doc↔prod des variables Fly (check-fly-env-drift.py).

Le job CI `fly-env-drift` compare `backend/fly.toml [env]` (référence commitée)
à l'environnement réellement servi par la machine Fly, et s'assure que chaque
secret OBLIGATOIRE (documenté dans DEPLOY_FLYIO.md) a un digest déployé. Les
valeurs des secrets restent illisibles (digests opaques) — seule la présence /
la stabilité est vérifiable.

Ce test recharge les fonctions pures du script contre les fichiers RÉELS du
repo (fly.toml, DEPLOY_FLYIO.md, kojo_settings.py) et verrouille :
- le parsing de la table `[env]` et la détection de DRIFT ;
- la distinction secret OBLIGATOIRE (sans défaut repli) vs OPTIONNEL (défaut
  non vide dans le code, ex. BREVO_SENDER_NAME='KOJO') ;
- qu'aucun secret obligatoire de la doc n'est déjà publiquement dans [env].
Ainsi, si le script (ou les références) régressent, la CI le détecte.
"""
import importlib.util
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCRIPT = BACKEND_DIR.parent / ".github" / "scripts" / "check-fly-env-drift.py"


def _load_check():
    """Charge check-fly-env-drift.py en pointant ses chemins vers le repo."""
    assert SCRIPT.exists(), f"{SCRIPT} absent — normalement commité"
    spec = importlib.util.spec_from_file_location("check_fly_env_drift", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    mod.REPO_ROOT = BACKEND_DIR.parent
    # sys.modules requis si le module lit d'autres modules (non — autonome stdlib).
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def check():
    return _load_check()


class TestParseFlyTomlEnv:
    def test_extrait_table_env(self, check):
        text = (
            "[app]\nfoo=bar\n\n"
            "[env]\n"
            'CORS_ORIGINS = "https://x.com"\n'
            "BACKEND_PUBLIC_URL = https://api.x.com\n"
            "# commentaire\n"
            "SIMPLE = skyl\n\n"
            "[[vm]]\n"
        )
        env = check.parse_fly_toml_env(text)
        assert env["CORS_ORIGINS"] == "https://x.com"
        assert env["BACKEND_PUBLIC_URL"] == "https://api.x.com"
        assert env["SIMPLE"] == "skyl"
        assert "vm" not in env

    def test_ignore_sections_apres_env(self, check):
        text = "[env]\nA=1\n\n[[services]]\nB=2\n"
        env = check.parse_fly_toml_env(text)
        assert env == {"A": "1"}, env


class TestCheckPublicEnv:
    def test_pas_de_drift_quand_identique(self, check):
        check.errors, check.checked = [], []
        check.check_public_env(
            '[env]\nCORS_ORIGINS = "https://x.com"\n',
            {"CORS_ORIGINS": "https://x.com", "FLY_APP_NAME": "kojo-backend"},
        )
        assert not check.errors, check.errors

    def test_drift_detecte(self, check):
        check.errors, check.checked = [], []
        check.check_public_env(
            '[env]\nBACKEND_PUBLIC_URL = "https://old.com"\n',
            {"BACKEND_PUBLIC_URL": "https://new.com"},
        )
        assert any("DRIFT" in e for e in check.errors), check.errors

    def test_manquant_detecte(self, check):
        check.errors, check.checked = [], []
        check.check_public_env('[env]\nNEW_VAR = "x"\n', {"OTHER": "y"})
        assert any("ABSENT du runtime" in e for e in check.errors), check.errors

    def test_fly_injected_ignore(self, check):
        # PRIMARY_REGION / FLY_* sont injectées par la plateforme, pas du projet.
        check.errors, check.checked = [], []
        check.check_public_env(
            '[env]\nPRIMARY_REGION = "cdg"\n',
            {"PRIMARY_REGION": "fsn1"},  # divergente mais injectée → ignorée
        )
        assert not check.errors, check.errors


class TestOptionalVsRequired:
    """Un secret documenté avec un défaut non vide est OPTIONNEL."""

    def test_has_nonempty_default(self, check):
        assert check.has_nonempty_default("BREVO_SENDER_NAME") is True
        assert check.has_nonempty_default("GMAIL_SENDER_NAME") is True

    def test_required_sans_default(self, check):
        assert check.has_nonempty_default("MONGO_URL") is False
        assert check.has_nonempty_default("JWT_SECRET") is False
        assert check.has_nonempty_default("BREVO_SENDER_EMAIL") is False
        assert check.has_nonempty_default("VAPID_PRIVATE_KEY") is False


class TestRequiredSecrets:
    def test_requis_depuis_doc_exclut_les_publics(self, check):
        req = check.required_secrets_from_deploy_doc()
        assert req, "aucun secret requis extrait de DEPLOY_FLYIO.md"
        # Aucun secret requis ne doit être déjà public dans [env] de fly.toml.
        fly_env = check.parse_fly_toml_env(
            check.FLY_TOML.read_text(encoding="utf-8")
        )
        assert not (req & set(fly_env)), f"secrets requis aussi publics: {req & set(fly_env)}"

    def test_requis_inclut_les_secrets_critiques(self, check):
        req = check.required_secrets_from_deploy_doc()
        for k in ("JWT_SECRET", "MONGO_URL", "PAYDUNYA_PRIVATE_KEY", "EMAIL_OTP_SECRET"):
            assert k in req, f"{k} devrait être requis"

    def test_opt_sn_exclus_des_requis(self, check):
        req = check.required_secrets_from_deploy_doc()
        assert "BREVO_SENDER_NAME" not in req, "optionnel avec défaut ne doit pas être requis"
        assert "PAYDUNYA_MODE" not in req


class TestSecretPresence:
    def test_manquant_detecte_meme_sensible(self, check):
        # RÉGRESSION : un secret sensible (JWT_SECRET) MANQUANT est fatal au
        # boot — SENSITIVE_KEYS ne doit limiter QUE la stabilité du digest.
        check.errors, check.checked = [], []
        req = {"JWT_SECRET", "MONGO_URL", "PAYDUNYA_PRIVATE_KEY"}
        check.check_secret_presence(req, {"MONGO_URL": "d1"})
        missing = " ".join(check.errors)
        assert "JWT_SECRET" in missing and "PAYDUNYA_PRIVATE_KEY" in missing

    def test_present_aucune_erreur(self, check):
        check.errors, check.checked = [], []
        req = {"JWT_SECRET", "MONGO_URL"}
        check.check_secret_presence(req, {"JWT_SECRET": "d1", "MONGO_URL": "d2"})
        assert not check.errors, check.errors


class TestParseEnvExample:
    def test_extrait_cles_et_valeurs(self, check):
        text = (
            "# commentaire\n"
            "APP_ENV=production\n"
            "BACKEND_PUBLIC_URL=\n"
            "# autre\n"
            "MONGO_URL=mongodb://x\n"
        )
        env = check.parse_env_example(text)
        assert env == {
            "APP_ENV": "production",
            "BACKEND_PUBLIC_URL": "",
            "MONGO_URL": "mongodb://x",
        }, env

    def test_ignore_cles_non_majuscules(self, check):
        env = check.parse_env_example("foo=bar\nAPP_ENV=x\n")
        assert env == {"APP_ENV": "x"}, env


class TestCheckDuplicates:
    """RÉGRESSION : BACKEND_PUBLIC_URL et VERCEL_PROJECT_NAME étaient dupliqués
    ([env] + secret) — le secret écrase [env] sur Fly, drift silencieux.
    Les secrets ont été unset le 27/08/2026 ; ce test verrouille la détection."""

    def test_doublon_detecte(self, check):
        check.errors, check.checked = [], []
        check.check_duplicates({"A": "1", "B": "2"}, {"B": "digest", "C": "digest"})
        assert any("DOUBLON" in e and "B" in e for e in check.errors), check.errors
        assert not any("A" in e for e in check.errors)

    def test_pas_de_doublon(self, check):
        check.errors, check.checked = [], []
        check.check_duplicates({"A": "1"}, {"B": "digest"})
        assert not check.errors, check.errors

    def test_aucun_doublon_reel(self, check):
        # L'état actuel du dépôt + prod ne doit avoir AUCUN doublon.
        fly_env = check.parse_fly_toml_env(
            check.FLY_TOML.read_text(encoding="utf-8")
        )
        check.errors, check.checked = [], []
        # Sans accès aux secrets en CI locale, on vérifie la règle structurelle :
        # les clés [env] ne doivent pas être listées dans le bloc secrets de la doc.
        req = check.required_secrets_from_deploy_doc()
        assert not (set(fly_env) & req), f"doublon [env]/doc: {set(fly_env) & req}"


class TestCheckOrphanSecrets:
    def test_orphelin_detecte(self, check):
        check.errors, check.checked = [], []
        check.check_orphan_secrets({"A": "d", "B": "d"}, {"A"})
        assert any("ORPHELIN" in e and "B" in e for e in check.errors), check.errors

    def test_pas_d_orphelin(self, check):
        check.errors, check.checked = [], []
        check.check_orphan_secrets({"A": "d"}, {"A"})
        assert not check.errors, check.errors


class TestCheckEnvExampleCoverage:
    def test_manquant_detecte(self, check):
        check.errors, check.checked = [], []
        check.check_env_example_coverage({"A", "MISSING"}, {"A": "1"}, {})
        assert any("MISSING" in e for e in check.errors), check.errors

    def test_optionnels_ignores(self, check):
        check.errors, check.checked = [], []
        check.check_env_example_coverage({"A", "SENTRY_DSN", "REDIS_URL"}, {"A": "1"}, {})
        assert not check.errors, check.errors

    def test_couvert_aucune_erreur(self, check):
        check.errors, check.checked = [], []
        check.check_env_example_coverage({"A", "B"}, {"A": "1"}, {"B": "d"})
        assert not check.errors, check.errors


class TestMask:
    def test_vide(self, check):
        assert check._mask("") == "(vide)"

    def test_avec_schema_garde_le_prefixe(self, check):
        assert check._mask("redis://x") == "redis://[9 car.]"
        assert check._mask("https://a.com/path") == "https://[18 car.]"

    def test_sans_schema(self, check):
        assert check._mask("mailto:kojoapp98@gmail.com") == "[26 car.]"

    def test_ne_contient_jamais_la_valeur(self, check):
        assert "kojoapp98" not in check._mask("mailto:kojoapp98@gmail.com")


class TestSanitizeError:
    def test_remplace_la_valeur_par_le_masque(self, check):
        msg = "MONGO_URL invalide : «mongodb+srv://u:p@h/db» contient un espace."
        out = check._sanitize_error(msg, "mongodb+srv://u:p@h/db")
        assert "u:p@h" not in out
        assert "mongodb+srv://[22 car.]" in out

    def test_sans_valeur_inchange(self, check):
        assert check._sanitize_error("erreur générique", "") == "erreur générique"


class TestCheckDeployedFormats:
    PUBLIC_OK = {
        "BACKEND_PUBLIC_URL": "https://kojo-backend.fly.dev",
        "FRONTEND_APP_URL": "https://kj-update-fevrier.vercel.app",
        "TRUSTED_HOSTS": "*.internal,kojo-backend.fly.dev",
    }
    SECRETS_OK = {
        "CORS_ORIGINS": "https://kj-update-fevrier.vercel.app",
        "REDIS_URL": "rediss://default:p@h:6379",
        "MONGO_URL": "mongodb+srv://u:p@c.mongodb.net/db",
        "VAPID_CLAIMS_EMAIL": "mailto:kojoapp98@gmail.com",
    }

    def test_formats_valides_aucune_erreur(self, check):
        check.errors, check.checked = [], []
        check.check_deployed_formats(self.PUBLIC_OK, self.SECRETS_OK)
        assert not check.errors, check.errors
        assert len(check.checked) == 7

    def test_public_url_invalide_detectee(self, check):
        check.errors, check.checked = [], []
        public = dict(self.PUBLIC_OK, BACKEND_PUBLIC_URL="http://kojo.fly.dev")
        check.check_deployed_formats(public, {})
        assert any("BACKEND_PUBLIC_URL" in e for e in check.errors), check.errors

    def test_slash_final_non_normalise_detecte(self, check):
        # RÉGRESSION : un slash final sur BACKEND_PUBLIC_URL casse les callbacks
        # IPN — le validateur normalise, mais le runtime ne normalise pas : la
        # valeur déployée brute doit être signalée comme NON normalisée.
        check.errors, check.checked = [], []
        public = dict(self.PUBLIC_OK, BACKEND_PUBLIC_URL="https://kojo-backend.fly.dev/")
        check.check_deployed_formats(public, {})
        assert any("NON normalisée" in e for e in check.errors), check.errors

    def test_secret_invalide_detecte_sans_fuite(self, check):
        check.errors, check.checked = [], []
        secrets = {"VAPID_CLAIMS_EMAIL": "mailto: kojoapp98@gmail.com"}
        check.check_deployed_formats({}, secrets)
        joined = " ".join(check.errors)
        assert "VAPID_CLAIMS_EMAIL" in joined
        assert "mailto: kojoapp98@gmail.com" not in joined, "secret fuité dans la sortie"

    def test_credential_mongo_masquee(self, check):
        check.errors, check.checked = [], []
        secrets = {"MONGO_URL": "mongodb+srv://admin:TopSecret2026@cluster.mongodb.net/db"}
        check.check_deployed_formats({}, secrets)
        joined = " ".join(check.errors)
        assert "TopSecret2026" not in joined, "credential fuité dans la sortie"


class TestCheckReferenceFormats:
    """Le mode --refs-only valide le FORMAT des variables critiques dans les
    RÉFÉRENCES du dépôt (fly.toml, .env.example, DEPLOY_FLYIO.md) —
    déterministe, sans accès Fly, lancé à chaque push par la CI."""

    @pytest.fixture(autouse=True)
    def _restore_paths(self, check):
        # Les tests mutent check.ENV_EXAMPLE/FLY_TOML/DEPLOY_DOC vers des
        # copies temporaires — on restaure les chemins réels après CHAQUE test
        # pour éviter la pollution de l'état du module entre tests.
        originals = (check.ENV_EXAMPLE, check.FLY_TOML, check.DEPLOY_DOC)
        yield
        check.ENV_EXAMPLE, check.FLY_TOML, check.DEPLOY_DOC = originals

    def _load_real_repo(self, check, tmp_path, env_override=None, toml_override=None):
        """Pointe le module vers des copies des fichiers réels (mutables)."""
        real_env = check.ENV_EXAMPLE.read_text(encoding="utf-8")
        real_toml = check.FLY_TOML.read_text(encoding="utf-8")
        real_doc = check.DEPLOY_DOC.read_text(encoding="utf-8")
        check.ENV_EXAMPLE = tmp_path / "env"
        check.FLY_TOML = tmp_path / "fly.toml"
        check.DEPLOY_DOC = tmp_path / "doc"
        check.ENV_EXAMPLE.write_text(
            env_override(real_env) if env_override else real_env, encoding="utf-8"
        )
        check.FLY_TOML.write_text(
            toml_override(real_toml) if toml_override else real_toml, encoding="utf-8"
        )
        check.DEPLOY_DOC.write_text(real_doc, encoding="utf-8")

    def test_references_reelles_conformes(self, check, tmp_path):
        # Les fichiers RÉELS du dépôt doivent passer le check de format.
        self._load_real_repo(check, tmp_path)
        check.errors, check.checked = [], []
        check.check_reference_formats()
        assert not check.errors, check.errors
        # Les 3 sources sont couvertes (fly.toml + .env.example + DEPLOY_FLYIO.md).
        sources = {line.split("(")[-1].split(",")[0].strip() for line in check.checked}
        assert "fly.toml [env]" in sources
        assert ".env.example" in sources
        assert "DEPLOY_FLYIO.md" in sources

    def test_regression_vapid_espace_detectee(self, check, tmp_path):
        # RÉGRESSION : un espace après mailto: dans .env.example doit échouer.
        # On injecte l'espace sur la LIGNE réelle (l'adresse peut être
        # contact@kojo.app dans le commit ou kojoapp98@gmail.com en cours) —
        # le test doit rester robuste à la valeur présente dans le fichier.
        def inject_space(text):
            import re as _re
            return _re.sub(
                r"^(VAPID_CLAIMS_EMAIL=mailto:)(\S+)$",
                r"\1 \2",
                text,
                flags=_re.MULTILINE,
            )

        self._load_real_repo(check, tmp_path, env_override=inject_space)
        check.errors, check.checked = [], []
        check.check_reference_formats()
        assert any("VAPID_CLAIMS_EMAIL" in e for e in check.errors), check.errors

    def test_regression_slash_final_flytoml_detectee(self, check, tmp_path):
        # RÉGRESSION : un slash final sur BACKEND_PUBLIC_URL dans fly.toml casse
        # les callbacks IPN — doit être signalé NON normalisé.
        self._load_real_repo(
            check, tmp_path,
            toml_override=lambda t: t.replace(
                "BACKEND_PUBLIC_URL = 'https://kojo-backend.fly.dev'",
                "BACKEND_PUBLIC_URL = 'https://kojo-backend.fly.dev/'",
            ),
        )
        check.errors, check.checked = [], []
        check.check_reference_formats()
        assert any("NON normalisée" in e for e in check.errors), check.errors

    def test_placeholder_doc_ignores(self, check, tmp_path):
        # Les placeholders de la doc (« ... ») ne doivent pas être validés.
        self._load_real_repo(check, tmp_path)
        check.errors, check.checked = [], []
        # Injecte une valeur placeholder MONGO dans la doc et vérifie qu'aucune
        # erreur ne la concerne (elle est ignorée).
        real_doc = check.DEPLOY_DOC.read_text(encoding="utf-8")
        check.DEPLOY_DOC.write_text(
            real_doc.replace('MONGO_URL=mongodb+srv://...', 'MONGO_URL=mongodb+srv://...'),
            encoding="utf-8",
        )
        check.check_reference_formats()
        assert not any("MONGO_URL" in e for e in check.errors), check.errors

    def test_main_refs_only_sans_token(self, check, capsys, monkeypatch):
        # --refs-only doit fonctionner SANS FLY_API_TOKEN (exit 0 sur les
        # références réelles conformes).
        monkeypatch.setenv("FLY_API_TOKEN", "")
        import importlib
        rc = check.main(["--refs-only"])
        assert rc == 0
        out = capsys.readouterr().out
        assert "références du dépôt conformes" in out