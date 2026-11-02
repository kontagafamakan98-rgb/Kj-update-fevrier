# -*- coding: utf-8 -*-
"""LE CACHE DES PAGES : CE QU'IL ÉVITE, ET CE QU'IL NE DOIT PAS CACHER.

Mesure du 02/11/2026 qui a motivé le module : `/emplois/bamako` coûtait 0,5 s de
rendu côté Fly et 0,67 s à travers Vercel, `X-Vercel-Cache: MISS` à chaque
appel — le CDN ne met pas en cache une réécriture vers une origine externe. Le
document est donc gardé 60 s en mémoire.

Ce que ces cas tiennent, un par un :

  • un second appel ne RELIT PAS la base et ne REND pas : c'est tout le gain,
    et un cas qui ne le vérifierait pas laisserait un cache décoratif ;
  • le TTL EXPIRE : une page servie indéfiniment publierait un compteur d'offres
    faux sans que rien ne le dise ;
  • la BASE DU SITE est dans la clé (les URL absolues du document en
    dépendent) ;
  • le cache est BORNÉ : au-delà du plafond, la plus ancienne entrée sort ;
  • une 404 n'est JAMAIS servie depuis le cache ;
  • la réponse DIT d'où elle vient, et `/metrics` publie les deux compteurs —
    sinon un cache qui ne sert jamais rien passerait pour un cache qui marche.
"""
import pytest

import kojo_pages_cache as cache


class _Horloge:
    """Horloge monotone contrôlée : l'expiration s'éprouve sans dormir."""

    def __init__(self):
        self.instant = 1000.0

    def __call__(self):
        return self.instant


@pytest.fixture(autouse=True)
def _cache_neuf():
    cache.reinitialiser()
    yield
    cache.reinitialiser()


async def test_un_second_appel_ne_rend_pas_et_ne_lit_pas_la_base():
    rendus = []

    async def _rendre():
        rendus.append(1)
        return "<html>page</html>"

    premier, rejoue_1 = await cache.obtenir(("ville", "bamako", "https://x"), _rendre)
    second, rejoue_2 = await cache.obtenir(("ville", "bamako", "https://x"), _rendre)

    assert premier == second == "<html>page</html>"
    assert (rejoue_1, rejoue_2) == (False, True)
    # LE point : la lecture Mongo et le rendu n'ont eu lieu qu'une fois.
    assert len(rendus) == 1
    assert cache.stats()["frais"] == 1
    assert cache.stats()["rejoue"] == 1


async def test_le_ttl_expire_et_le_document_est_rendu_de_nouveau():
    horloge = _Horloge()
    rendus = []

    async def _rendre():
        rendus.append(1)
        return f"<html>{len(rendus)}</html>"

    _, rejoue_1 = await cache.obtenir(("ville", "bamako", "x"), _rendre, maintenant=horloge)
    horloge.instant += cache.TTL_SECONDES - 1
    _, rejoue_2 = await cache.obtenir(("ville", "bamako", "x"), _rendre, maintenant=horloge)
    horloge.instant += 2  # le TTL est franchi
    contenu, rejoue_3 = await cache.obtenir(("ville", "bamako", "x"), _rendre, maintenant=horloge)

    assert (rejoue_1, rejoue_2, rejoue_3) == (False, True, False)
    assert contenu == "<html>2</html>"
    assert cache.stats()["expire"] == 1


async def test_la_base_du_site_fait_partie_de_la_cle():
    """Le `canonical` et le JSON-LD sont absolus : une base, un document."""
    appels = []

    async def _rendre(base):
        async def _r():
            appels.append(base)
            return f"<html>{base}</html>"
        return _r

    premier, _ = await cache.obtenir(("ville", "bamako", "https://kojo"), await _rendre("kojo"))
    second, _ = await cache.obtenir(("ville", "bamako", "https://fly"), await _rendre("fly"))

    assert premier == "<html>kojo</html>"
    assert second == "<html>fly</html>"
    assert appels == ["kojo", "fly"]


async def test_le_cache_est_borne_et_sort_la_plus_ancienne_entree():
    async def _rendre(valeur):
        async def _r():
            return valeur
        return _r

    for rang in range(cache.MAX_ENTREES + 1):
        await cache.obtenir(("ville", f"slug-{rang}", "x"), await _rendre(str(rang)))

    assert cache.stats()["entrees"] == cache.MAX_ENTREES
    # La première est sortie ; la dernière est là.
    _, rejoue_vieille = await cache.obtenir(
        ("ville", "slug-0", "x"), await _rendre("0")
    )
    _, rejoue_neuve = await cache.obtenir(
        ("ville", f"slug-{cache.MAX_ENTREES}", "x"), await _rendre("neuve")
    )
    assert rejoue_vieille is False
    assert rejoue_neuve is True


async def test_une_page_ville_est_servie_par_le_cache_au_second_appel(client):
    """Le vrai chemin : deux GET, une seule lecture — et le témoin le dit."""
    premier = await client.get("/api/pages/villes/abidjan")
    second = await client.get("/api/pages/villes/abidjan")

    assert premier.status_code == second.status_code == 200
    assert premier.headers.get("x-kojo-pages-cache") == "frais"
    assert second.headers.get("x-kojo-pages-cache") == "rejoue"
    # Le document servi est le MÊME : un cache qui changerait la page serait pire
    # que pas de cache.
    assert premier.text == second.text


async def test_une_404_n_est_jamais_servie_depuis_le_cache(client):
    """Une page inexistante n'entre pas : elle porte `no-store`, sans témoin."""
    premiere = await client.get("/api/pages/villes/atlantide")
    seconde = await client.get("/api/pages/villes/atlantide")

    assert premiere.status_code == seconde.status_code == 404
    for reponse in (premiere, seconde):
        assert "x-kojo-pages-cache" not in reponse.headers
        assert reponse.headers.get("cache-control") == "no-store"
    assert cache.stats()["entrees"] == 0
