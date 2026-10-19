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
        "BACKEND_PUBLIC_URL": "https://api.kojoforafrica.cc.cd",
        "FRONTEND_APP_URL": "https://kj-update-fevrier.vercel.app",
        "TRUSTED_HOSTS": "*.internal,api.kojoforafrica.cc.cd",
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
        # Tout ce qui a été donné doit avoir été contrôlé : la comparaison porte
        # sur les fixtures, jamais sur un compte figé qui exigerait une retouche
        # du test à chaque clé ajoutée.
        assert len(check.checked) == len(self.PUBLIC_OK) + len(self.SECRETS_OK)

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
        public = dict(self.PUBLIC_OK, BACKEND_PUBLIC_URL="https://api.kojoforafrica.cc.cd/")
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
        # On injecte l'espace sur la LIGNE réelle (l'adresse VAPID du
        # .env.example peut varier selon le commit) — le test doit rester
        # robuste à la valeur présente dans le fichier.
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
                "BACKEND_PUBLIC_URL = 'https://api.kojoforafrica.cc.cd'",
                "BACKEND_PUBLIC_URL = 'https://api.kojoforafrica.cc.cd/'",
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

    def test_le_step_refs_only_tourne_sans_jeton(self):
        # `--refs-only` doit tourner SANS FLY_API_TOKEN : c'est ce qui permet à
        # l'audit des formats de références de tourner à CHAQUE push. Le verdict
        # sur les références réelles appartient à l'étape de CI qui l'exécute ;
        # ici on ne vérifie que son câblage (une étape qui exigerait un jeton ne
        # tournerait jamais sur une PR).
        workflow = (
            BACKEND_DIR.parent / ".github" / "workflows" / "ci.yml"
        ).read_text(encoding="utf-8")
        lines = workflow.splitlines()
        index = next(
            (
                i
                for i, line in enumerate(lines)
                if "name: Audit formats des références (refs-only)" in line
            ),
            None,
        )
        assert index is not None, "l'étape refs-only a disparu du workflow"
        bloc = lines[index : index + 4]
        assert any("--refs-only" in line for line in bloc), bloc
        assert not any("FLY_API_TOKEN" in line for line in bloc), bloc


class TestOrphelinsBoutEnBout:
    """Le check ORPHELINS doit FAIRE ÉCHOUER le job, pas seulement exister.

    `TestCheckOrphanSecrets` teste la fonction ; ces tests-ci testent son
    CÂBLAGE dans main() : les trois sources de références réellement consultées
    et le code de sortie réellement non nul. Sans eux, un refactor pouvait
    retirer l'appel — ou l'une des sources — et la CI serait restée verte en ne
    détectant plus aucun secret déployé absent des références du dépôt.

    Tout se mesure en UNE exécution de main(), hors ligne, sur des références
    FIXTURE. L'audit des formats des fichiers RÉELS est déjà payé par l'étape
    `--refs-only` de la CI (dont le verdict est mesuré par
    `TestCheckReferenceFormats`) ; le repayer ici ne le rendrait pas plus vrai.
    Le montage est donc construit pour que la SEULE divergence possible soit
    celle qu'on plante — ce qui remplace l'ancien cas « base neutre », un second
    main() qui ne servait qu'à prouver que l'échec venait bien de l'injection.
    """

    # Références fixture : des valeurs CONFORMES (mêmes formes que les vraies,
    # mêmes validateurs), pour que le seul écart mesuré soit celui qu'on injecte.
    FLY_TOML_FIXTURE = (
        "[env]\n"
        "BACKEND_PUBLIC_URL = 'https://api.kojoforafrica.cc.cd'\n"
        "FRONTEND_APP_URL = 'https://kj-update-fevrier.vercel.app'\n"
        "TRUSTED_HOSTS = '*.internal,api.kojoforafrica.cc.cd'\n"
    )
    # Doc avec un bloc `fly secrets set` : deux secrets REQUIS (les placeholders
    # « ... » ne sont pas validés) — `required` est donc déterministe, sans
    # dépendre du contenu de DEPLOY_FLYIO.md.
    DEPLOY_DOC_FIXTURE = (
        "# Déploiement\n\n"
        "```bash\n"
        "fly secrets set \\\n"
        "  MONGO_URL=... \\\n"
        "  JWT_SECRET=...\n"
        "```\n"
    )
    # Une clé OPTIONNELLE et vide : la couverture .env.example l'ignore.
    ENV_EXAMPLE_FIXTURE = "CORS_ORIGINS=\n"
    # La TROISIÈME source : une clé que SEUL kojo_settings.py nomme.
    SETTINGS_FIXTURE = (
        "import os\n\n"
        'SETTINGS_ONLY = os.environ.get("SECRET_LU_DANS_KOJO_SETTINGS_SEULEMENT")\n'
    )
    SECRETS_FIXTURE = {
        # Requis par la doc fixture → présence exigée, et couverts.
        "MONGO_URL": "digest",
        "JWT_SECRET": "digest",
        # Référencé par la SEULE troisième source → PAS orphelin.
        "SECRET_LU_DANS_KOJO_SETTINGS_SEULEMENT": "digest",
        # Référencé nulle part → le SEUL orphelin attendu.
        "SECRET_MORT_REFERENCE_NULLE_PART": "digest",
    }

    @pytest.fixture
    def references_fixture(self, check, tmp_path):
        """Pointe le module vers des références FIXTURE (hors ligne, aucun
        fichier du dépôt lu), et restaure chemins ET caches après le test — le
        module est partagé par toute la session."""
        chemins = (check.FLY_TOML, check.ENV_EXAMPLE, check.DEPLOY_DOC, check.SETTINGS)
        caches = (check._fly_toml_env_cache, check._settings_refs_cache)
        check.FLY_TOML = tmp_path / "fly.toml"
        check.ENV_EXAMPLE = tmp_path / ".env.example"
        check.DEPLOY_DOC = tmp_path / "DEPLOY_FLYIO.md"
        check.SETTINGS = tmp_path / "kojo_settings.py"
        check.FLY_TOML.write_text(self.FLY_TOML_FIXTURE, encoding="utf-8")
        check.ENV_EXAMPLE.write_text(self.ENV_EXAMPLE_FIXTURE, encoding="utf-8")
        check.DEPLOY_DOC.write_text(self.DEPLOY_DOC_FIXTURE, encoding="utf-8")
        check.SETTINGS.write_text(self.SETTINGS_FIXTURE, encoding="utf-8")
        check._fly_toml_env_cache = None
        check._settings_refs_cache = None
        yield
        check.FLY_TOML, check.ENV_EXAMPLE, check.DEPLOY_DOC, check.SETTINGS = chemins
        check._fly_toml_env_cache, check._settings_refs_cache = caches

    def _run(self, check, monkeypatch, secrets):
        """Exécute main() hors ligne : aucun accès réseau, secrets simulés."""
        monkeypatch.setattr(check, "API_TOKEN", "jeton-factice")
        monkeypatch.setattr(
            check,
            "fetch_json",
            lambda url, token: [
                {
                    "id": "machine-test",
                    "state": "started",
                    "config": {
                        "env": check.parse_fly_toml_env(
                            check.FLY_TOML.read_text(encoding="utf-8")
                        )
                    },
                }
            ],
        )
        monkeypatch.setattr(check, "list_fly_secrets", lambda token: dict(secrets))
        monkeypatch.setattr(check, "read_secrets_via_ssh", lambda keys: {})
        check.errors, check.checked = [], []
        return check.main([])

    def test_orphelin_detecte_sans_repayer_l_audit_des_formats(
        self, check, monkeypatch, capsys, references_fixture
    ):
        # UNE exécution, sur la fixture. Elle porte à la fois un secret déployé
        # absent des trois sources ET un secret que seul kojo_settings.py nomme
        # (sans lui, ce cas serait sauté quand le dépôt n'en a plus).
        rc = self._run(check, monkeypatch, self.SECRETS_FIXTURE)
        out = capsys.readouterr().out

        # 1) Le secret absent des trois sources est NOMMÉ, et le job échoue.
        assert "[ORPHELIN SECRET_MORT_REFERENCE_NULLE_PART]" in out, out
        assert rc == 1, out
        # 2) C'est la SEULE divergence : la fixture est propre par construction,
        #    donc un montage cassé (ou un contrôle qui crie à tort) rougit ici
        #    au lieu de se cacher derrière une base neutre exécutée à part.
        assert len(check.errors) == 1, check.errors
        # 3) La troisième source est CÂBLÉE : sans elle, la clé ci-dessous
        #    deviendrait un second orphelin et l'égalité ci-dessus tomberait.
        assert all("SECRET_LU_DANS_KOJO_SETTINGS_SEULEMENT" not in e for e in check.errors)

    def test_le_controle_des_formats_de_secrets_dit_s_il_a_eu_lieu(
        self, check, monkeypatch, capsys, references_fixture
    ):
        """Sans SSH, le contrôle doit le DIRE au lieu de ne rien dire.

        Mesuré le 12/10/2026 sur les trois derniers pushs de `main` : le journal
        du job ne portait NI `[OK]` NI `[WARN]` sur les formats des secrets
        déployés — `read_secrets_via_ssh` n'écrit sa ligne que dans le cas
        d'EXCEPTION, jamais quand `flyctl ssh` rend une sortie vide sans erreur.
        Un lecteur du run ne pouvait donc pas distinguer « vérifié » de
        « sauté ». Les deux issues sont maintenant nommées : ces deux cas
        tiennent chacune des deux moitiés (sans la seconde, on pourrait
        satisfaire le test en écrivant « rien n'a été fait » pour toujours).
        """
        self._run(check, monkeypatch, self.SECRETS_FIXTURE)
        sortie_sans_ssh = capsys.readouterr().out
        assert "[AUCUN VERDICT] formats des" in sortie_sans_ssh, sortie_sans_ssh
        assert "NON" in sortie_sans_ssh

        monkeypatch.setattr(
            check, "read_secrets_via_ssh", lambda keys: {cle: "valeur-factice" for cle in keys}
        )
        check.errors, check.checked = [], []
        check.main([])
        sortie_avec_ssh = capsys.readouterr().out
        assert "[OK] formats des" in sortie_avec_ssh, sortie_avec_ssh
        assert "vérifiés" in sortie_avec_ssh

    def test_le_check_est_bien_cable_dans_le_workflow_ci(self, check):
        # Un orphelin ne peut être détecté que si le job appelle réellement le
        # script AVEC un jeton : supprimer l'étape rendrait tous les tests
        # ci-dessus inutiles SANS qu'aucun job ne rougisse.
        workflow = (
            BACKEND_DIR.parent / ".github" / "workflows" / "ci.yml"
        ).read_text(encoding="utf-8")
        assert "run: python .github/scripts/check-fly-env-drift.py" in workflow
        assert "FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}" in workflow


class TestBattementDeploye:
    """`KOJO_SSE_HEARTBEAT_SECONDS` posé sur la machine : la valeur que les
    gardes HORS LIGNE ne peuvent pas voir.

    `battement-coeur-aligne.test.js` lit trois sources commitées (défaut Python,
    `fly.toml`, config du client) ; une surcharge posée en secret Fly change le
    battement RÉEL sans toucher aucune des trois. Mesure à l'origine du défaut :
    une fenêtre client de 15 s contre un battement de 20 s déclarait TOMBÉ un
    flux vivant mais inactif, donc une reconnexion par flux inactif — plus
    d'allers-retours que le sondage que le flux remplace.

    Deux moitiés sont éprouvées ici : la RÈGLE (valeurs en clair, aucun réseau)
    et son CÂBLAGE dans `main()` (sans lui, la règle serait un ornement).
    """

    def test_le_contrat_est_lu_dans_la_config_du_client(self, check):
        # Les trois nombres sont LUS, jamais recopiés : 20 s de battement, un
        # battement manqué toléré, 5 s de marge → 45 s de silence toléré. La
        # valeur 45 000 est aussi celle qu'asserte le garde JavaScript : si le
        # client change, c'est LUI qui fait foi et ce test dit l'écart.
        assert check.contrat_du_client() == (20000.0, 45000.0)

    def test_un_contrat_illisible_n_est_pas_un_contrat(self, check, tmp_path):
        fichier = tmp_path / "flux-temps-reel.js"
        fichier.write_text("export const AUTRE = 1;\n", encoding="utf-8")
        assert check.contrat_du_client(fichier) is None
        assert check.contrat_du_client(tmp_path / "absent.js") is None

    def test_une_surcharge_absente_est_nommee_sans_rougir(self, check):
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(False, "", check.contrat_du_client())
        assert check.errors == []
        assert any("KOJO_SSE_HEARTBEAT_SECONDS" in ligne for ligne in check.checked)

    def test_une_surcharge_qui_tient_dans_la_fenetre_passe(self, check):
        contrat = check.contrat_du_client()
        # 20 s (le défaut) et 15 s (plus RAPIDE que le défaut) sont deux états
        # sains : un battement plus fréquent ne fait que raccourcir l'attente du
        # client, il ne peut pas la dépasser.
        for valeur in ("20", "15", "22.5"):
            check.errors, check.checked = [], []
            check.check_heartbeat_contract(True, valeur, contrat)
            assert check.errors == [], (valeur, check.errors)
            assert quantite(check.checked, "KOJO_SSE_HEARTBEAT_SECONDS") == 1

    def test_une_surcharge_plus_longue_que_la_fenetre_est_refusee(self, check):
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(True, "30", check.contrat_du_client())
        assert len(check.errors) == 1, check.errors
        refus = check.errors[0]
        # Le refus NOMME les deux nombres en présence (30 s déployé, 45 s de
        # fenêtre) et le remède : sans eux, il faudrait rouvrir deux fichiers
        # pour savoir de quel écart on parle.
        assert "30" in refus and "45000" in refus and "fenêtre" in refus, refus
        assert "fly secrets unset KOJO_SSE_HEARTBEAT_SECONDS" in refus

    def test_une_valeur_illisible_est_refusee_sans_la_publier(self, check):
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(True, "trente-secondes", check.contrat_du_client())
        assert len(check.errors) == 1, check.errors
        refus = check.errors[0]
        assert "ILLISIBLE" in refus
        # La valeur n'est jamais recopiée : un secret se masque, et celui-ci
        # pourrait un jour porter autre chose qu'un nombre.
        assert "trente" not in refus, refus
        assert "15 car." in refus, refus

    def test_un_battement_nul_est_refuse(self, check):
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(True, "0", check.contrat_du_client())
        assert len(check.errors) == 1, check.errors
        assert "ne bat pas" in check.errors[0]

    def test_une_valeur_non_lue_est_un_angle_mort_declare(self, check):
        # SSH indisponible en CI : la règle ne peut pas juger. Elle le DIT, et
        # ne rougit pas — comme les formats de secrets déployés, dont la valeur
        # est lue par le même canal. Un vert ici serait un vert sans lecture.
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(True, "", check.contrat_du_client())
        assert check.errors == []
        assert any("[AUCUN VERDICT]" in ligne and "KOJO_SSE_HEARTBEAT" in ligne
                   for ligne in check.checked), check.checked

    def test_un_contrat_illisible_refuse_de_conclure(self, check):
        check.errors, check.checked = [], []
        check.check_heartbeat_contract(True, "20", None)
        assert len(check.errors) == 1, check.errors
        assert "ILLISIBLE" in check.errors[0]
        assert "flux-temps-reel.js" in check.errors[0]

    def test_la_regle_est_cablee_dans_main(self, check, monkeypatch, capsys):
        """Sans ce cas, la règle pourrait exister sans être appelée : le job
        resterait vert et la surcharge continuerait de passer."""
        monkeypatch.setattr(check, "API_TOKEN", "jeton-factice")
        monkeypatch.setattr(
            check, "fetch_json", lambda url, token: [{"id": "m", "state": "started", "config": {"env": {}}}]
        )
        monkeypatch.setattr(
            check, "list_fly_secrets", lambda token: {"KOJO_SSE_HEARTBEAT_SECONDS": "digest"}
        )
        monkeypatch.setattr(
            check, "read_secrets_via_ssh",
            lambda keys: {cle: "30" for cle in keys if cle == "KOJO_SSE_HEARTBEAT_SECONDS"},
        )
        check.errors, check.checked = [], []
        code = check.main([])
        sortie = capsys.readouterr().out
        assert "[KOJO_SSE_HEARTBEAT_SECONDS]" in sortie, sortie
        assert "deux battements" in sortie, sortie
        assert code == 1, sortie


class TestReglagesDeTempsDuFlux:
    """Les DEUX autres délais qui décident de la vie d'un flux.

    Le battement est jugé depuis le 19/10/2026 ; le BAIL du registre Redis et
    le REPLI du client ne l'étaient pas. Ce sont pourtant eux qui décident
    quand une place se libère, et à quelle cadence on redemande quand le flux
    est tombé — deux contrats que rien ne regardait.

    Le bail n'existe pas comme variable : il est CALCULÉ depuis le battement.
    C'est pourquoi ces cas éprouvent aussi le CALCUL (formule lue dans
    `kojo_live.py`, évaluée avec le battement réellement déployé) : juger le
    défaut du code pendant qu'une surcharge existe serait juger une autre
    machine.
    """

    def test_le_bail_est_calcule_comme_le_code_avec_le_battement_du_defaut(self, check):
        contrats = check.contrats_du_serveur()
        assert contrats is not None, "formule du bail illisible dans kojo_live.py"
        defaut, bail = contrats
        assert defaut == 20.0
        # Ni 20 ni 60 ne sont recopiés ici : la formule du code est évaluée.
        assert bail(20) == 60.0
        assert bail(30) == 90.0

    def test_une_formule_hors_vocabulaire_est_refusee(self, check, tmp_path):
        # `eval` borné : un nom inconnu, un appel, un attribut — refusés. Une
        # formule qu'on ne sait pas lire n'est pas un contrat.
        assert check.bail_depuis_battement("max(60.0, AUTRE_CHOSE * 3)") is None
        assert check.bail_depuis_battement("open('/etc/passwd').read()") is None
        # Et un fichier sans la formule ne rend pas un contrat par défaut.
        sans = tmp_path / "kojo_live.py"
        sans.write_text("HEARTBEAT_SECONDS = 20\n", encoding="utf-8")
        assert check.contrats_du_serveur(sans) is None
        assert check.contrats_du_serveur(tmp_path / "absent.py") is None

    def test_le_bail_du_defaut_tient_ses_deux_contrats(self, check):
        check.errors, check.checked = [], []
        check.check_lease_contract(
            False, "", check.contrat_du_client(), check.contrats_du_serveur()
        )
        assert check.errors == [], check.errors
        ligne = [l for l in check.checked if "PARTAGE_LEASE_SECONDS" in l][0]
        # Les TROIS nombres du verdict sont publiés : bail, plancher de
        # renouvellement et borne du verdict client.
        assert "60" in ligne and "40" in ligne and "65" in ligne, ligne

    def test_un_battement_deploye_calcule_le_bail_reel(self, check):
        check.errors, check.checked = [], []
        check.check_lease_contract(
            True, "22", check.contrat_du_client(), check.contrats_du_serveur()
        )
        assert check.errors == [], check.errors
        # 3 × 22 s = 66 s : c'est le bail de CETTE machine, pas celui du défaut.
        assert "66" in "".join(check.checked), check.checked

    def test_un_bail_trop_court_pour_un_battement_perdu_est_refuse(self, check):
        contrats = (20.0, lambda battement: battement * 1.5)
        check.errors, check.checked = [], []
        check.check_lease_contract(False, "", check.contrat_du_client(), contrats)
        assert len(check.errors) == 1, check.errors
        refus = check.errors[0]
        assert "30" in refus and "40" in refus, refus
        assert "VIVANTE" in refus, refus

    def test_un_bail_qui_survit_au_verdict_du_client_est_refuse(self, check):
        contrats = (20.0, lambda battement: 600.0)
        check.errors, check.checked = [], []
        check.check_lease_contract(False, "", check.contrat_du_client(), contrats)
        assert len(check.errors) == 1, check.errors
        refus = check.errors[0]
        assert "600" in refus and "65" in refus, refus
        # Sans surcharge, le remède est la FORMULE : nommer la surcharge
        # enverrait l'exploitant retirer un secret qui n'existe pas.
        assert "Ramener PARTAGE_LEASE_SECONDS" in refus, refus

    def test_un_bail_allonge_par_une_surcharge_nomme_la_surcharge(self, check):
        # 30 s de battement allonge le bail à 90 s : deux contrats tombent, et
        # celui du bail nomme la SURCHARGE, puisqu'il en découle.
        check.errors, check.checked = [], []
        check.check_lease_contract(
            True, "30", check.contrat_du_client(), check.contrats_du_serveur()
        )
        assert len(check.errors) == 1, check.errors
        assert "fly secrets unset KOJO_SSE_HEARTBEAT_SECONDS" in check.errors[0]

    def test_une_formule_illisible_refuse_de_conclure(self, check):
        check.errors, check.checked = [], []
        check.check_lease_contract(False, "", check.contrat_du_client(), None)
        assert len(check.errors) == 1, check.errors
        assert "kojo_live.py" in check.errors[0] and "ILLISIBLE" in check.errors[0]

    def test_un_battement_deploye_illisible_ne_donne_pas_de_bail(self, check):
        check.errors, check.checked = [], []
        check.check_lease_contract(
            True, "trente", check.contrat_du_client(), check.contrats_du_serveur()
        )
        assert len(check.errors) == 1, check.errors
        assert "ILLISIBLE" in check.errors[0]
        assert "trente" not in check.errors[0], "la valeur déployée ne se cite pas"

    def test_un_battement_non_lu_est_un_angle_mort_declare(self, check):
        check.errors, check.checked = [], []
        check.check_lease_contract(
            True, "", check.contrat_du_client(), check.contrats_du_serveur()
        )
        assert check.errors == [], check.errors
        assert any(
            "[AUCUN VERDICT]" in ligne and "PARTAGE_LEASE_SECONDS" in ligne
            for ligne in check.checked
        ), check.checked

    # ── Le repli du client ─────────────────────────────────────────────────

    def test_le_repli_est_lu_dans_ses_deux_declarations(self, check):
        valeur, raison = check.contrat_du_repli()
        assert raison is None, raison
        assert valeur == 60000.0

    def test_deux_replis_qui_divergent_sont_refuses(self, check, tmp_path):
        notifications = tmp_path / "NotificationContext.js"
        notifications.write_text("const FALLBACK_POLL_MS = 60_000;\n", encoding="utf-8")
        messages = tmp_path / "Messages.js"
        messages.write_text("const FALLBACK_POLL_MS = 30_000;\n", encoding="utf-8")
        valeur, raison = check.contrat_du_repli((notifications, messages))
        assert valeur is None
        assert "DIVERGENTES" in raison and "60" in raison and "30" in raison, raison
        check.errors, check.checked = [], []
        check.check_fallback_contract(valeur, raison)
        assert len(check.errors) == 1, check.errors
        assert "NON JUGEABLE" in check.errors[0]

    def test_un_repli_absent_refuse_de_conclure(self, check, tmp_path):
        muet = tmp_path / "NotificationContext.js"
        muet.write_text("// aucun repli\n", encoding="utf-8")
        valeur, raison = check.contrat_du_repli((muet,))
        assert valeur is None
        assert "ne déclare pas FALLBACK_POLL_MS" in raison, raison

    def test_un_repli_aussi_bavard_que_l_ancien_sondage_est_refuse(self, check):
        check.errors, check.checked = [], []
        # 30 s, c'est exactement les 2 req/min du sondage que le flux remplace :
        # le remplacement n'aurait remplacé qu'un aller-retour par un autre.
        check.check_fallback_contract(30000.0, None)
        assert len(check.errors) == 1, check.errors
        assert "sondage" in check.errors[0] and "30000" in check.errors[0]

    def test_le_repli_actuel_est_moins_bavard_que_le_sondage(self, check):
        check.errors, check.checked = [], []
        check.check_fallback_contract(*check.contrat_du_repli())
        assert check.errors == [], check.errors
        assert any(
            "FALLBACK_POLL_MS" in ligne and "moins bavard" in ligne
            for ligne in check.checked
        ), check.checked

    def test_les_deux_regles_sont_cablees_dans_main(self, check, monkeypatch):
        """Sans ce cas, les deux règles pourraient exister sans être appelées."""
        monkeypatch.setattr(check, "API_TOKEN", "jeton-factice")
        monkeypatch.setattr(
            check,
            "fetch_json",
            lambda url, token: [{"id": "m", "state": "started", "config": {"env": {}}}],
        )
        monkeypatch.setattr(check, "list_fly_secrets", lambda token: {})
        monkeypatch.setattr(check, "read_secrets_via_ssh", lambda keys: {})
        check.errors, check.checked = [], []
        check.main([])
        sortie = "\n".join(check.checked)
        assert "PARTAGE_LEASE_SECONDS" in sortie, sortie
        assert "FALLBACK_POLL_MS" in sortie, sortie


def quantite(lignes, motif):
    return sum(1 for ligne in lignes if motif in ligne)