# -*- coding: utf-8 -*-
"""
Régression CORS : le domaine propre du frontend doit être une origine autorisée.

Le 18/09/2026 le frontend est passé de `*.vercel.app` à
`https://kojoforafrica.cc.cd`. `server.py` construisait `allow_origins` avec
`WEST_AFRICA_ORIGINS + CORS_ORIGINS` : `FRONTEND_APP_URL` n'y entrait jamais.
Tant que le frontend vivait sous `*.vercel.app`, le motif Vercel
(`allow_origin_regex`) couvrait la production et le trou restait invisible.
Après la migration, plus aucune origine exacte ne matchait : tous les appels
portant un en-tête personnalisé (statistiques, géolocalisation) partaient en
préflight et recevaient `400 — Disallowed CORS origin`, sans aucune trace
serveur (le 400 vient de Starlette, avant les routes).

Ces tests portent sur la fonction pure qui produit la liste (donc sur la
décision) ET sur le câblage réel de `server.py` (donc sur le fait qu'elle est
bien celle qui alimente le middleware).
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from kojo_core import build_allowed_origins, normalize_origin

PROD = "https://kojoforafrica.cc.cd"


class TestOriginNormalization:
    def test_slash_final_supprime(self):
        # Un slash final ne matche jamais l'en-tête Origin d'un navigateur.
        assert normalize_origin("https://kojoforafrica.cc.cd/") == PROD

    def test_espaces_ignores(self):
        assert normalize_origin("  https://kojoforafrica.cc.cd  ") == PROD

    def test_schema_absent_lu_en_https(self):
        assert normalize_origin("kojoforafrica.cc.cd") == PROD

    @pytest.mark.parametrize("value", ["", "   ", "/", "ftp://kojoforafrica.cc.cd",
                                       "https://kojoforafrica.cc.cd/chemin"])
    def test_entrees_inutilisables_ecartees(self, value):
        # Aucune de ces valeurs ne peut correspondre à une origine de navigateur.
        assert normalize_origin(value) is None


class TestAllowedOrigins:
    def test_domaine_propre_du_frontend_autorise(self):
        """Le cas de la panne : FRONTEND_APP_URL seul, CORS_ORIGINS vide."""
        origins = build_allowed_origins(frontend_url=PROD, cors_value="")

        assert PROD in origins

    def test_origines_de_dev_conservees(self):
        origins = build_allowed_origins(frontend_url=PROD, cors_value="")

        assert "http://localhost:3000" in origins

    def test_cors_origins_ajoutees_et_normalisees(self):
        origins = build_allowed_origins(
            frontend_url=PROD,
            cors_value=" https://kj-update-fevrier.vercel.app/ , ,https://kojo.app ",
        )

        assert "https://kj-update-fevrier.vercel.app" in origins
        assert "https://kojo.app" in origins
        assert "" not in origins

    def test_pas_de_doublon(self):
        origins = build_allowed_origins(
            frontend_url=PROD, cors_value=f"{PROD},http://localhost:3000"
        )

        assert origins.count(PROD) == 1
        assert origins.count("http://localhost:3000") == 1

    def test_frontend_url_absente_n_ajoute_rien(self):
        """Variable non définie : la liste ne doit pas contenir d'entrée vide."""
        origins = build_allowed_origins(frontend_url="", cors_value="")

        assert origins == ["http://localhost:3000", "https://localhost:3000", "http://127.0.0.1:3000"]

    def test_lit_l_environnement_reel_par_defaut(self, monkeypatch):
        monkeypatch.setenv("CORS_ORIGINS", "https://kojo.app")

        assert "https://kojo.app" in build_allowed_origins(frontend_url=PROD)



# Configuration de PRODUCTION au moment de la panne : domaine propre côté
# frontend, et CORS_ORIGINS vide (son ancienne valeur pointait sur l'ancien
# domaine Vercel). Les noms imposés par conftest (secrets, Mongo, etc.)
# viennent de os.environ.
SONDE = """
import json
from fastapi.testclient import TestClient
import server

client = TestClient(server.app)


def preflight(origin, path='/api/geolocation/available-countries', method='GET',
              requested_headers='content-type'):
    response = client.options(path, headers={
        'Origin': origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': requested_headers,
    })
    return {
        'origin': origin,
        'path': path,
        'status': response.status_code,
        'acao': response.headers.get('access-control-allow-origin'),
        'credentials': response.headers.get('access-control-allow-credentials'),
    }


print(json.dumps({
    'allowed_origins': server.allowed_origins,
    'frontend': preflight('https://kojoforafrica.cc.cd'),
    'stats': preflight('https://kojoforafrica.cc.cd', '/api/public/stats'),
    'mutation': preflight('https://kojoforafrica.cc.cd', '/api/jobs', 'POST',
                          'content-type,x-csrftoken,authorization'),
    'inconnue': preflight('https://evil.example'),
}))
"""


@pytest.fixture(scope="module")
def production_preflight():
    """Exécute l'app RÉELLE configurée comme la production, dans un processus
    neuf : `server.py` construit sa liste CORS à l'import, donc la seule façon
    d'exercer sa configuration de production est de la lui donner à ce
    moment-là.
    """
    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "FRONTEND_APP_URL": PROD,
        "CORS_ORIGINS": "",
        # Le journal applicatif contient des emojis : sans cela le décodage
        # cp1252 par défaut de Windows échoue à la lecture du tube.
        "PYTHONIOENCODING": "utf-8",
    }
    completed = subprocess.run(
        [sys.executable, "-c", SONDE],
        cwd=str(backend_dir),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
    )
    assert completed.returncode == 0, completed.stderr
    # La sortie utile est la dernière ligne (le reste est du journal applicatif).
    return json.loads([line for line in completed.stdout.splitlines() if line.startswith("{")][-1])


class TestPreflightProduction:
    """Le chemin HTTP réellement emprunté par le navigateur, exécuté sur l'app
    configurée comme en production.

    Chaque assertion échouerait avec l'ancien code (`WEST_AFRICA_ORIGINS +
    CORS_ORIGINS`) : le domaine propre n'y figurait que si quelqu'un l'avait
    recopié dans CORS_ORIGINS.
    """

    def test_domaine_propre_present_dans_la_liste(self, production_preflight):
        assert PROD in production_preflight["allowed_origins"]

    def test_preflight_geolocalisation_accepte(self, production_preflight):
        # L'appel exact qui échouait en production.
        result = production_preflight["frontend"]
        assert result["status"] == 200
        assert result["acao"] == PROD
        assert result["credentials"] == "true"  # cookies httpOnly requis

    def test_preflight_statistiques_accepte(self, production_preflight):
        assert production_preflight["stats"]["acao"] == PROD

    def test_preflight_mutation_avec_csrf_accepte(self, production_preflight):
        # X-CSRFToken et Authorization font partie des en-têtes envoyés par le client.
        result = production_preflight["mutation"]
        assert result["status"] == 200
        assert result["acao"] == PROD

    def test_origine_inconnue_toujours_refusee(self, production_preflight):
        """Sonde non vacuité : le 200 vient bien de la liste d'origines, pas
        du fait que tout préflight répondrait 200."""
        result = production_preflight["inconnue"]
        assert result["status"] == 400
        assert result["acao"] is None
