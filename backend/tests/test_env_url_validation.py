# -*- coding: utf-8 -*-
"""Régression : format des variables d'environnement sensibles.

Même pattern que tests/test_vapid_sub_claim.py (RFC 8292), étendu aux autres
variables d'infrastructure :

- `validate_https_url`  : URLs publiques (BACKEND_PUBLIC_URL, FRONTEND_APP_URL,
  GOOGLE_REDIRECT_URI…) — https://, sans espace, sans slash final (un slash
  final sur BACKEND_PUBLIC_URL produirait un double slash dans les callbacks,
  ex. IPN PayDunya) ;
- `validate_cors_origins`: CORS_ORIGINS — CSV d'origines https://, sans slash
  final, sans localhost/127.0.0.1, sans entrée vide.

Valeurs de référence vérifiées : défaut du code + .env.example + docs de
déploiement — toute régression de format dans les sources de référence
re-ferait échouer la CI.
"""
import os
import re
from pathlib import Path

import pytest

from kojo_settings import (
    BACKEND_PUBLIC_URL,
    FRONTEND_APP_URL,
    validate_cors_origins,
    validate_https_url,
    validate_mongo_url,
    validate_redis_url,
    validate_trusted_hosts,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent


class TestValidateHttpsUrl:
    def test_url_valide_simple(self):
        assert validate_https_url("https://kojo-backend.fly.dev") == "https://kojo-backend.fly.dev"

    def test_url_valide_avec_path(self):
        assert validate_https_url("https://kj-update-fevrier.vercel.app/support") == "https://kj-update-fevrier.vercel.app/support"

    def test_slash_final_strippe(self):
        # RÉGRESSION : un slash final sur BACKEND_PUBLIC_URL casse les callbacks
        # (double slash) — le validateur normalise au lieu d'échouer.
        assert validate_https_url("https://kojo-backend.fly.dev/") == "https://kojo-backend.fly.dev"

    def test_espaces_externes_strippes(self):
        assert validate_https_url("  https://kojo.app  ") == "https://kojo.app"

    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "",                          # vide
            "   ",                       # que des espaces
            "https:// kojo.app",         # espace dans l'URL
            "http://kojo.app",           # http interdit
            "ftp://kojo.app",            # autre schéma
            "kojo.app",                  # host nu
            "https://",                  # rien après le préfixe
            "https:///path",             # host vide
            "https://.kojo.app",         # host commençant par un point
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_https_url(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_https_url(None)


class TestValidateCorsOrigins:
    def test_origine_unique_valide(self):
        assert validate_cors_origins("https://kj-update-fevrier.vercel.app") == ["https://kj-update-fevrier.vercel.app"]

    def test_plusieurs_origines(self):
        assert validate_cors_origins(
            "https://kojo-a.vercel.app, https://kojo-b.vercel.app"
        ) == ["https://kojo-a.vercel.app", "https://kojo-b.vercel.app"]

    def test_slash_final_strippe(self):
        # RÉGRESSION : une origine avec slash final ne matche JAMAIS l'en-tête
        # Origin du navigateur (silencieusement) — normalisé ici.
        assert validate_cors_origins("https://kj-update-fevrier.vercel.app/") == ["https://kj-update-fevrier.vercel.app"]

    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "https://kojo.app,",                 # virgule finale → entrée vide
            "https://kojo.app,,https://kojo2.app",  # double virgule
            "https://kojo.app, http://kojo2.app",   # http interdit sur une entrée
            "http://localhost:3000",             # localhost + http
            "https://localhost:3000",            # localhost en https
            "https://127.0.0.1:3000",            # 127.0.0.1
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_cors_origins(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_cors_origins(None)


class TestValidateTrustedHosts:
    """TRUSTED_HOSTS : CSV d'hôtes/motifs pour le TrustedHostMiddleware."""

    def test_vide_valide(self):
        assert validate_trusted_hosts("") == []

    def test_motifs_joker_fly(self):
        # Valeur réelle de production (backend/fly.toml [env]).
        assert validate_trusted_hosts("*.internal,*.flycast.internal,kojo-backend.fly.dev") == [
            "*.internal", "*.flycast.internal", "kojo-backend.fly.dev",
        ]

    def test_entrees_strippees(self):
        assert validate_trusted_hosts(" api.kojo.app , *.vercel.app ") == ["api.kojo.app", "*.vercel.app"]

    def test_url_complete_acceptee(self):
        # build_trusted_hosts extrait le host d'une URL via extract_host_from_url.
        assert validate_trusted_hosts("https://api.kojo.app") == ["https://api.kojo.app"]

    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "a,,b",                     # double virgule → entrée vide
            "a,b,",                     # virgule finale
            "a, b",                     # espace dans une entrée
            "http://x.com",             # http:// nu interdit
            "*.",                       # joker sans domaine
            "a/b",                      # chemin dans un host nu
            "x@y",                      # @ non autorisé
            "localhost",                # host sans point douteux
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_trusted_hosts(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_trusted_hosts(None)


class TestValidateRedisUrl:
    """REDIS_URL : URI redis:// ou rediss:// (TLS), optionnelle (vide = mémoire)."""

    def test_vide_valide(self):
        # Absence de REDIS_URL = rate-limiting en mémoire (fallback voulu).
        assert validate_redis_url("") == ""
        assert validate_redis_url("   ") == ""

    def test_redis_simple(self):
        assert validate_redis_url("redis://localhost:6379/0") == "redis://localhost:6379/0"

    def test_rediss_tls_avec_auth(self):
        # Valeur documentée dans DEPLOY_FLYIO.md (redis://default:<pass>@<host>:6379).
        assert validate_redis_url("rediss://default:pass@host:6380") == "rediss://default:pass@host:6380"

    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "http://x",             # mauvais schéma
            "redis://",             # rien après le schéma
            "redis://user@",        # hôte manquant
            "redis:// x",           # espace
            "mysql://host",         # autre schéma
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_redis_url(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_redis_url(None)


class TestValidateMongoUrl:
    """MONGO_URL : URI mongodb:// ou mongodb+srv:// (Atlas), OBLIGATOIRE."""

    def test_mongodb_local(self):
        # Valeur de dev (.env.example) — mongodb://localhost:27017.
        assert validate_mongo_url("mongodb://localhost:27017/kojo") == "mongodb://localhost:27017/kojo"

    def test_mongodb_srv_atlas(self):
        # Valeur de prod (DEPLOY_FLYIO.md) — mongodb+srv:// → Atlas.
        assert validate_mongo_url("mongodb+srv://user:pass@cluster.mongodb.net/kojo_db") == "mongodb+srv://user:pass@cluster.mongodb.net/kojo_db"

    def test_mongodb_avec_auth_et_options(self):
        assert validate_mongo_url("mongodb://u:p@h:27017/db?retryWrites=true") == "mongodb://u:p@h:27017/db?retryWrites=true"

    @pytest.mark.parametrize(
        "valeur_incorrecte",
        [
            "",                    # vide — MONGO_URL est OBLIGATOIRE
            "   ",                 # que des espaces
            "http://x",            # mauvais schéma
            "mongo://x",           # schéma inconnu
            "mongodb://",          # rien après le schéma
            "mongodb:// ",         # espace après le schéma
            "mongodb:// x",        # espace dans l'URI
        ],
    )
    def test_rejette(self, valeur_incorrecte):
        with pytest.raises(ValueError):
            validate_mongo_url(valeur_incorrecte)

    def test_rejette_non_chaine(self):
        with pytest.raises(ValueError):
            validate_mongo_url(None)


class TestReferencesProd:
    """Les valeurs de référence ne doivent JAMAIS redevenir invalides."""

    def test_default_backend_public_url_valide(self):
        # Défaut du code = '' (BACKEND_PUBLIC_URL est OBLIGATOIRE en prod,
        # cf. DEPLOY_FLYIO.md) : en test il n'est pas défini → skip ; la
        # valeur de production est vérifiée par l'audit Fly (audit_env).
        if not BACKEND_PUBLIC_URL:
            pytest.skip("BACKEND_PUBLIC_URL non défini en environnement de test (requis en prod)")
        validate_https_url(BACKEND_PUBLIC_URL, "BACKEND_PUBLIC_URL")

    def test_default_frontend_app_url_valide(self):
        if not FRONTEND_APP_URL:
            pytest.skip("FRONTEND_APP_URL non défini en environnement de test (requis en prod)")
        validate_https_url(FRONTEND_APP_URL, "FRONTEND_APP_URL")

    def test_default_cors_origins_valide(self):
        # CORS_ORIGINS est lu via os.environ (server.py/kojo_core.py), pas une
        # constante de settings. En test il n'est pas défini → '' → valide.
        validate_cors_origins(os.environ.get("CORS_ORIGINS", "") or "")

    def test_env_example_urls_valides(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        content = env_path.read_text(encoding="utf-8")
        for key in ("BACKEND_PUBLIC_URL", "FRONTEND_APP_URL"):
            match = re.search(rf"^{key}=(\S*)\s*$", content, re.MULTILINE)
            assert match, f"{key} absent de .env.example"
            valeur = match.group(1)
            # .env.example est un TEMPLATE DE DEV : valeurs vides ou
            # http://localhost:3000 acceptées (les règles https/no-slash
            # sont des règles de production). On ne valide que les valeurs
            # de type production (https) pour ne pas casser le template.
            if valeur and valeur.startswith("https://"):
                validate_https_url(valeur, key)

    def test_doc_deploiement_backend_url_valide(self):
        # DEPLOY_FLYIO.md documente la valeur à poser sur Fly.
        doc_path = BACKEND_DIR / "DEPLOY_FLYIO.md"
        if not doc_path.exists():
            pytest.skip("DEPLOY_FLYIO.md absent")
        content = doc_path.read_text(encoding="utf-8")
        for valeur in re.findall(r"BACKEND_PUBLIC_URL=(\S+)", content):
            validate_https_url(valeur, "BACKEND_PUBLIC_URL")

    def test_env_example_mongo_url_valide(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        content = env_path.read_text(encoding="utf-8")
        match = re.search(r"^MONGO_URL=(\S*)\s*$", content, re.MULTILINE)
        assert match, "MONGO_URL absent de .env.example"
        # .env.example = template DEV : mongodb://localhost:27017 accepté
        # (les règles mongodb+srv:// sont des règles de production).
        if match.group(1):
            validate_mongo_url(match.group(1), "MONGO_URL")

    def test_env_example_redis_url_valide(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        content = env_path.read_text(encoding="utf-8")
        match = re.search(r"^REDIS_URL=(\S*)\s*$", content, re.MULTILINE)
        assert match, "REDIS_URL absent de .env.example"
        validate_redis_url(match.group(1), "REDIS_URL")  # vide ou URI valide

    def test_env_example_trusted_hosts_valide(self):
        env_path = BACKEND_DIR / ".env.example"
        if not env_path.exists():
            pytest.skip(".env.example absent")
        content = env_path.read_text(encoding="utf-8")
        match = re.search(r"^TRUSTED_HOSTS=(\S*)\s*$", content, re.MULTILINE)
        assert match, "TRUSTED_HOSTS absent de .env.example"
        validate_trusted_hosts(match.group(1), "TRUSTED_HOSTS")

    def test_fly_toml_trusted_hosts_valide(self):
        # La valeur RÉELLE de prod vit dans backend/fly.toml [env] — elle doit
        # rester conforme (jokers *.internal/*.flycast.internal + host public).
        fly_toml = BACKEND_DIR / "fly.toml"
        if not fly_toml.exists():
            pytest.skip("fly.toml absent")
        content = fly_toml.read_text(encoding="utf-8")
        match = re.search(r"^\s*TRUSTED_HOSTS\s*=\s*['\"]([^'\"]+)['\"]", content, re.MULTILINE)
        assert match, "TRUSTED_HOSTS absent de fly.toml [env]"
        valeur = match.group(1)
        hosts = validate_trusted_hosts(valeur, "TRUSTED_HOSTS")
        # Contrat de prod : le host public et le trafic interne Fly couverts.
        assert any(h.startswith("*.") for h in hosts), "TRUSTED_HOSTS doit contenir un motif joker (trafic interne Fly)"

    def test_doc_deploiement_redis_url_conforme(self):
        # DEPLOY_FLYIO.md documente le format REDIS_URL (recommandé en prod).
        doc_path = BACKEND_DIR / "DEPLOY_FLYIO.md"
        if not doc_path.exists():
            pytest.skip("DEPLOY_FLYIO.md absent")
        content = doc_path.read_text(encoding="utf-8")
        for valeur in re.findall(r"REDIS_URL=\"?(redis[s]?://[^\"\s]+)\"?", content):
            validate_redis_url(valeur, "REDIS_URL")

    def test_doc_deploiement_mongo_url_conforme(self):
        doc_path = BACKEND_DIR / "DEPLOY_FLYIO.md"
        if not doc_path.exists():
            pytest.skip("DEPLOY_FLYIO.md absent")
        content = doc_path.read_text(encoding="utf-8")
        for valeur in re.findall(r"MONGO_URL=(mongodb(?:\+srv)?://[^\"\s]+)", content):
            validate_mongo_url(valeur, "MONGO_URL")
