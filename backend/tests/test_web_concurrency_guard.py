# -*- coding: utf-8 -*-
"""Redis est obligatoire en production dès que plusieurs workers tournent.

Sans Redis, le rate-limit vit dans la mémoire de chaque process : avec
WEB_CONCURRENCY > 1, chaque limite est multipliée par N et jamais partagée.
`kojo_settings` doit donc refuser de démarrer dans ce cas précis, et seulement
dans ce cas.

Le test lance un VRAI import de `kojo_settings` dans un sous-processus : c'est
au chargement du module que la garde s'exécute, et un import dans le process
de pytest serait déjà chargé (donc muet).
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def _demarre(**variables) -> subprocess.CompletedProcess:
    """Importe kojo_settings avec un environnement contrôlé, sans rien hériter
    de la configuration de test (REDIS_URL, WEB_CONCURRENCY, APP_ENV...)."""
    env = dict(os.environ)
    for cle in ("APP_ENV", "REDIS_URL", "WEB_CONCURRENCY"):
        env.pop(cle, None)
    env.update({
        "JWT_SECRET": "garde-web-concurrency-secret-32-chars-min",
        "EMAIL_OTP_SECRET": "garde-web-concurrency-otp-32-chars-min",
        "DISABLE_TRUSTED_HOST_MIDDLEWARE": "true",
    })
    env.update(variables)
    return subprocess.run(
        [sys.executable, "-c", "import kojo_settings"],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_prod_multi_workers_sans_redis_refuse_de_demarrer():
    resultat = _demarre(APP_ENV="production", WEB_CONCURRENCY="2", REDIS_URL="")

    assert resultat.returncode != 0
    assert "WEB_CONCURRENCY=2 sans REDIS_URL en production" in resultat.stderr


def test_prod_multi_workers_avec_redis_demarre():
    resultat = _demarre(
        APP_ENV="production",
        WEB_CONCURRENCY="2",
        REDIS_URL="rediss://default:secret@redis.example.test:6379",
    )

    assert resultat.returncode == 0, resultat.stderr


def test_prod_un_seul_worker_sans_redis_demarre():
    """Un process unique : le fallback mémoire est exact, il n'y a rien à partager."""
    resultat = _demarre(APP_ENV="production", WEB_CONCURRENCY="1", REDIS_URL="")

    assert resultat.returncode == 0, resultat.stderr


def test_defaut_sans_variable_demarre_en_prod_sans_redis():
    """WEB_CONCURRENCY absent = 1 (défaut du Dockerfile) : pas de refus."""
    resultat = _demarre(APP_ENV="production", REDIS_URL="")

    assert resultat.returncode == 0, resultat.stderr


def test_hors_prod_plusieurs_workers_sans_redis_demarrent():
    """Hors prod, le fallback mémoire reste le comportement de développement."""
    resultat = _demarre(APP_ENV="development", WEB_CONCURRENCY="4", REDIS_URL="")

    assert resultat.returncode == 0, resultat.stderr
