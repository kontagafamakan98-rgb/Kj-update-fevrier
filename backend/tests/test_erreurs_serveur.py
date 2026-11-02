# -*- coding: utf-8 -*-
"""LES ERREURS NON RATTRAPÉES SONT COMPTÉES, PUBLIÉES, ET NE SONT PAS DES 5xx.

Ce que ce fichier prouve, cas par cas — et ce qu'il empêche :

  • le middleware COMPTE puis RELANCE : une exception traverse toujours, la
    réponse servie ne change pas (un middleware qui avale changerait le 500 en
    200 muet, pire que le silence qu'on répare) ;
  • un 5xx DÉCLARÉ (le 503 de `/monitor`, un refus de capacité) n'est PAS
    compté : ces réponses disent un état, pas un échec, et les confondre ferait
    rougir l'alerte pour un fait déjà publié ailleurs ;
  • `/health` publie le bloc `erreurs` avec TOUS ses champs, et `state: ok`
    quand rien n'a cassé — sur une durée nommée (`depuis`), parce que les
    compteurs sont ceux du process ;
  • `/metrics` publie les deux séries, et elles valent 0 au démarrage ;
  • aucune donnée d'exception ne sort : ni message, ni URL avec identifiant —
    `/health` est une réponse PUBLIQUE, et un message d'exception recopie
    volontiers un e-mail ou un jeton.
"""
import pytest

import kojo_erreurs
from kojo_erreurs import ErreursServeurMiddleware, diagnostic, enregistrer, famille, reinitialiser


@pytest.fixture(autouse=True)
def _compteurs_neufs():
    reinitialiser()
    yield
    reinitialiser()


class _AppQuiLeve:
    """ASGI minimal : lève AVANT d'avoir écrit la moindre réponse."""

    def __init__(self):
        self.appels = 0

    async def __call__(self, scope, receive, send):
        self.appels += 1
        raise TypeError("boom — message qui NE DOIT PAS sortir")


class _AppQuiRefuse:
    """ASGI minimal : répond 503 sans lever (un état, pas une exception)."""

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": 503, "headers": []})
        await send({"type": "http.response.body", "body": b"indisponible"})


def _scope(chemin="/api/jobs/6f3a2b1c-0000"):  # identifiant volontairement long
    return {"type": "http", "path": chemin, "method": "GET", "headers": []}


async def test_une_exception_est_comptee_puis_relancee():
    """Le compteur monte ET l'exception continue sa route : rien n'est avalé."""
    app = _AppQuiLeve()
    middleware = ErreursServeurMiddleware(app)

    with pytest.raises(TypeError):
        await middleware(_scope(), None, None)

    assert app.appels == 1
    bloc = diagnostic()
    assert bloc["state"] == "echec"
    assert bloc["total"] == 1
    assert bloc["classe"] == "TypeError"


async def test_un_5xx_declare_n_est_pas_une_erreur():
    """Le 503 de /monitor dit un état ; le compter ferait un faux rouge."""
    middleware = ErreursServeurMiddleware(_AppQuiRefuse())
    envoyees = []

    async def _send(message):
        envoyees.append(message)

    await middleware(_scope("/monitor"), None, _send)

    # La réponse servie n'est pas transformée : le 503 arrive tel quel.
    assert envoyees[0]["status"] == 503

    assert diagnostic()["total"] == 0
    assert diagnostic()["state"] == "ok"


def test_la_famille_ne_porte_jamais_l_identifiant():
    """`/health` est PUBLIC : `/api/jobs/<uuid>` se lit `/api/jobs`."""
    assert famille("/api/jobs/6f3a2b1c-0000-4000-8000-000000000000") == "/api/jobs"
    assert famille("/api/payments/webhook") == "/api/payments"
    # Ce qui ne ressemble pas à une route n'est pas deviné.
    assert famille("") == "/"
    assert famille(None) == "/"


def test_le_message_de_l_exception_ne_sort_jamais():
    """Aucune valeur publiée ne recopie le message (il peut porter un secret)."""
    enregistrer(TypeError("boom — message qui NE DOIT PAS sortir"), "/api/jobs")
    texte = repr(diagnostic())

    assert "boom" not in texte
    assert "NE DOIT PAS SORTIR" not in texte


def test_les_classes_sont_bornees_et_le_reste_est_agrege():
    """Une réponse de santé publique n'inventorie pas indéfiniment ce qui casse."""
    for rang in range(7):
        classe = type(f"Erreur{rang}", (Exception,), {})
        enregistrer(classe("x"), "/api/jobs")

    bloc = diagnostic()

    assert bloc["total"] == 7
    assert len(bloc["classes"]) == kojo_erreurs.MAX_CLASSES + 1
    assert bloc["classes"][-1] == {"classe": "autres", "total": 2}
    assert sum(entree["total"] for entree in bloc["classes"]) == 7


def test_le_bloc_publie_sa_portee_et_sa_date_de_demarrage():
    """`0` veut dire « depuis ce démarrage » : sans durée, il se lit « toujours »."""
    bloc = diagnostic()

    assert bloc["state"] == "ok"
    assert bloc["total"] == 0
    assert bloc["derniere_at"] is None
    assert bloc["depuis"]
    assert "demarrage" in bloc["portee"]


async def test_health_publie_le_bloc_erreurs(client):
    """Le bloc est dans `/health` — la sonde de production le juge."""
    reponse = await client.get("/health")
    assert reponse.status_code == 200

    bloc = reponse.json()["erreurs"]
    assert set(bloc) == set(diagnostic())
    assert bloc["state"] == "ok"
    assert bloc["total"] == 0


async def test_metrics_publie_les_deux_series(client, monkeypatch):
    """Un scrape dit aussi ce qui a cassé : deux séries, à zéro au démarrage."""
    import kojo_metrics

    monkeypatch.setattr(kojo_metrics, "METRICS_TOKEN", "jeton-de-test")
    reponse = await client.get(
        kojo_metrics.CHEMIN, headers={"Authorization": "Bearer jeton-de-test"}
    )
    texte = reponse.text

    assert "# TYPE kojo_erreurs_serveur_total counter" in texte
    assert "kojo_erreurs_serveur_total 0" in texte
    assert "# TYPE kojo_erreurs_serveur_derniere_timestamp_seconds gauge" in texte
    assert "kojo_erreurs_serveur_derniere_timestamp_seconds 0" in texte
