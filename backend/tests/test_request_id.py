# -*- coding: utf-8 -*-
"""Un incident se NOMME : `X-Request-ID` relie une réponse à SES lignes.

POURQUOI CE FICHIER

Sans identifiant de requête, un 500, une capture d'écran d'erreur et les
journaux du serveur ne se recoupent que par l'horodatage. Quand trois cents
requêtes se croisent et qu'un utilisateur écrit « ça a échoué hier vers 14 h »,
c'est inutilisable : on ne peut pas nommer LA requête. L'identifiant est posé
sur la réponse (donc lisible par le client) et journalisé avec l'incident.

Trois propriétés font la différence entre un en-tête décoratif et une
corrélation réelle, et chacune est mesurée ici :

  1. L'IDENTIFIANT PUBLIÉ est celui du client quand il est sain — un proxy qui
     en pose un garde la chaîne intacte — et il est REMPLACÉ quand il ne l'est
     pas : une valeur reçue est un vœu, pas une preuve (retour à la ligne,
     balise, log forgé). L'en-tête d'une réponse ne recopie jamais ce que
     l'appelant a écrit.
  2. Il est LISIBLE dans la requête (`request.state.request_id`) : c'est ce qui
     permet de l'écrire dans une ligne de journal, pas seulement de le renvoyer.
  3. Il est posé sur les réponses de REFUS (`429`) — donc le middleware est le
     plus EXTERNE. Monté à l'intérieur du rate-limiter, les réponses qu'un
     utilisateur signale le plus (trop de requêtes, refus) n'en auraient pas.
     Le cas monte les deux ordres pour le prouver, plutôt que de le commenter.

Ce que ces cas ne jugent pas : le contenu des journaux de production (un
collecteur peut les filtrer), ni la conservation des identifiants côté client
(le frontend les affiche au support, il ne les stocke pas).
"""
import re
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from kojo_middlewares import (
    REQUEST_ID_HEADER,
    RequestIdMiddleware,
    _identifiant_de_requete,
)

BACKEND = Path(__file__).resolve().parents[1]
MOTIF_IDENTIFIANT = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


class _RefusInterne(BaseHTTPMiddleware):
    """Un middleware qui REFUSE, sur UNE route, sans appeler la suite.

    C'est la forme du rate-limiter : le refus est décidé en amont du routeur,
    donc une réponse qui ne traverse pas ce middleware n'existe pas.
    """

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/refus"):
            return JSONResponse({"detail": "refus"}, status_code=429)
        return await call_next(request)


def _application(ordre: str) -> FastAPI:
    """Une app minimale où l'ordre de montage est celui qu'on veut juger."""
    app = FastAPI()

    @app.get("/api/rien")
    async def rien(request: Request):
        return {"id": getattr(request.state, "request_id", None)}

    if ordre == "externe":
        app.add_middleware(_RefusInterne)
        app.add_middleware(RequestIdMiddleware)
    else:
        app.add_middleware(RequestIdMiddleware)
        app.add_middleware(_RefusInterne)
    return app


async def _appel(app: FastAPI, entetes: dict | None = None, chemin: str = "/api/rien"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        return await http.get(chemin, headers=entetes or {})


class TestIdentifiantPublie:
    def test_sans_identifiant_client_un_identifiant_neuf_est_produit(self):
        identifiant = _identifiant_de_requete(None)

        assert MOTIF_IDENTIFIANT.match(identifiant), (
            f"l'identifiant produit ne respecte pas le format publié : {identifiant!r}"
        )

    def test_deux_requetes_sans_identifiant_n_en_partagent_pas(self):
        """Deux requêtes qui porteraient le même identifiant ne se distingueraient plus."""
        assert _identifiant_de_requete(None) != _identifiant_de_requete(None)

    def test_un_identifiant_sain_du_client_est_conserve(self):
        """Un proxy qui en pose un garde la chaîne : c'est le cas qui corrèle."""
        fourni = "abc123def456"

        assert _identifiant_de_requete(fourni) == fourni

    @pytest.mark.parametrize(
        "valeur",
        [
            "court",                    # sous le plancher de 8 caractères
            "x" * 65,                   # au-delà du plafond
            "id\r\nX-Forgé: 1",         # injection de ligne d'en-tête
            "ident ifiant",             # espace
            "<script>alert(1)</script>",  # balise
            "identifiant%0a",           # reste encodé, donc inutilisable
        ],
    )
    def test_une_valeur_hors_format_est_remplacee_jamais_recopiee(self, valeur):
        obtenu = _identifiant_de_requete(valeur)

        assert obtenu != valeur, (
            "une valeur fournie hors format a été recopiée dans la réponse et "
            "les journaux : l'appelant choisirait ce qui s'écrit"
        )
        assert MOTIF_IDENTIFIANT.match(obtenu)

    @pytest.mark.asyncio
    async def test_un_identifiant_du_client_est_rendu_tel_quel_dans_la_reponse(self):
        """Le cas réel : un intermédiaire pose un identifiant, on le renvoie."""
        reponse = await _appel(_application("externe"), {REQUEST_ID_HEADER: "trace-0123456789"})

        assert reponse.headers[REQUEST_ID_HEADER] == "trace-0123456789"


class TestIdentifiantUtilisable:
    @pytest.mark.asyncio
    async def test_la_requete_porte_l_identifiant_qu_elle_publie(self):
        """`request.state.request_id` est ce qu'une ligne de journal écrit."""
        reponse = await _appel(_application("externe"))

        assert reponse.json()["id"] == reponse.headers[REQUEST_ID_HEADER]
        assert reponse.json()["id"]

    @pytest.mark.asyncio
    async def test_un_refus_porte_l_identifiant_quand_le_middleware_est_externe(self):
        """Le 429 est LA réponse qu'un utilisateur signale : elle doit se nommer."""
        reponse = await _appel(_application("externe"), chemin="/api/refus")

        assert reponse.status_code == 429
        assert MOTIF_IDENTIFIANT.match(reponse.headers.get(REQUEST_ID_HEADER, "")), (
            "un refus sans identifiant ne peut pas être retrouvé dans les journaux"
        )

    @pytest.mark.asyncio
    async def test_monte_a_l_interieur_un_refus_n_aurait_aucun_identifiant(self):
        """Contre-épreuve : c'est bien la PLACE qui donne le résultat, pas le hasard."""
        reponse = await _appel(_application("interne"), chemin="/api/refus")

        assert reponse.status_code == 429
        assert REQUEST_ID_HEADER not in reponse.headers


class TestCablageDansServer:
    def test_le_middleware_est_le_plus_externe_de_server_py(self):
        """L'ordre de montage du VRAI serveur : monté en dernier, donc le plus externe.

        Lu à la source : le câblage est un fait du fichier, pas une propriété
        qu'un test d'import pourrait deviner.
        """
        source = (BACKEND / "server.py").read_text(encoding="utf-8")
        montages = re.findall(r"app\.add_middleware\(\s*([A-Za-z_][A-Za-z0-9_]*)", source)

        assert "RequestIdMiddleware" in montages, "le middleware n'est pas monté"
        assert montages[-1] == "RequestIdMiddleware", (
            "un middleware monté APRÈS RequestIdMiddleware serait plus externe que "
            f"lui : ses réponses de refus n'auraient pas d'identifiant ({montages})"
        )

    def test_l_identifiant_est_expose_au_navigateur(self):
        """Sans `expose_headers`, l'en-tête arrive mais reste ILLISIBLE en JS."""
        source = (BACKEND / "server.py").read_text(encoding="utf-8")
        bloc = re.search(r"expose_headers=\[(.*?)\]", source, re.S)

        assert bloc is not None, "aucun expose_headers : le navigateur ne lira rien"
        assert REQUEST_ID_HEADER in bloc.group(1)


@pytest.mark.asyncio
async def test_une_reponse_du_serveur_reel_porte_un_identifiant(client: AsyncClient):
    """Le câblage complet : une route réelle, un identifiant réel."""
    reponse = await client.get("/api/health")

    assert reponse.status_code == 200
    assert MOTIF_IDENTIFIANT.match(reponse.headers.get(REQUEST_ID_HEADER, ""))


@pytest.mark.asyncio
async def test_un_429_du_rate_limiter_reel_porte_un_identifiant(
    client: AsyncClient, monkeypatch
):
    """La place du middleware, mesurée sur la pile RÉELLE du serveur.

    Le verdict du bucket est remplacé (aucune attente d'horloge, aucun quota à
    épuiser) : ce qui est jugé ici est l'ordre de la pile, pas la politique.
    """
    import kojo_middlewares

    async def refuse(*_args, **_kwargs):
        return False

    monkeypatch.setattr(kojo_middlewares, "rate_limit_check", refuse)

    reponse = await client.post(
        "/api/auth/login", json={"email": "personne@kojo.sn", "password": "x"}
    )

    assert reponse.status_code == 429, "le rate-limiter n'a pas refusé : rien à juger"
    assert MOTIF_IDENTIFIANT.match(reponse.headers.get(REQUEST_ID_HEADER, "")), (
        "une réponse de refus du rate-limiter n'est pas nommable"
    )
