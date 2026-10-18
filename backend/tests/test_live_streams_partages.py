# -*- coding: utf-8 -*-
"""Le plafond de flux est celui du COMPTE, pas celui d'une machine.

Le défaut que ce fichier verrouille
-----------------------------------
`MAX_STREAMS_PER_USER` comptait les flux d'UN process. Derrière quatre workers,
un même compte pouvait donc en ouvrir seize — et le plafond, qui existe pour
qu'un onglet bogué n'épuise pas la ressource, ne bornait plus le compte du tout.
Chaque worker, pris seul, se croyait dans les règles.

Ce qui est mesuré ici
---------------------
  * deux flux sur un worker + deux sur l'autre épuisent le compte ; le cinquième
    est refusé par le worker qui n'en sert que deux (donc loin de SON plafond) ;
  * un membre périmé (worker tué sans `finally`) ne compte plus : son bail a
    expiré, la place revient au compte ;
  * le battement de cœur REPOUSSE ce bail : un flux vivant dont le bail
    expirerait passerait pour fermé, et le plafond laisserait entrer un flux de
    trop ;
  * fermer le flux retire le membre (sinon les vrais flux finiraient en 503) ;
  * un refus REND la place locale : un abonné fantôme compterait pour un autre ;
  * un registre injoignable n'est PAS un refus : le plafond local décide seul et
    la panne est comptée (`partage_stats()['repli']`). Un flux ne doit jamais
    s'arrêter parce que le compteur est muet.

Ce que ce fichier ne dit pas
----------------------------
Le double ci-dessous rejoue le CONTRAT des deux scripts, pas Lua : la purge des
baux, l'admission sous plafond et le refus qui se retire lui-même. L'atomicité
et le script eux-mêmes sont mesurés contre un vrai Redis, entre deux vrais
workers, par `tests/test_live_bus_deux_workers.py`.
"""
from __future__ import annotations

import asyncio
import time

import pytest

import kojo_live


class FauxRegistre:
    """Le registre partagé en mémoire : le contrat des scripts, sans serveur.

    `erreur` simule Redis injoignable (ou trop lent) : la levée est ce qui
    déclenche le repli local, donc elle doit être provoquable sans réseau.
    """

    def __init__(self):
        self.flux = {}  # clé → {membre: expiration_ms}
        self.erreur = None

    async def eval(self, script, numkeys, cle, *arguments):
        if self.erreur is not None:
            raise self.erreur
        if "-- kojo:reserver" in script:
            maintenant = int(arguments[0])
            membre = arguments[1]
            expiration = int(arguments[2])
            plafond = int(arguments[3])
            membres = self.flux.setdefault(cle, {})
            for nom in [n for n, fin in membres.items() if fin <= maintenant]:
                del membres[nom]
            membres[membre] = expiration
            if len(membres) > plafond:
                del membres[membre]
                return len(membres)
            return -1
        if "-- kojo:rafraichir" in script:
            expiration = int(arguments[0])
            membre = arguments[1]
            self.flux.setdefault(cle, {})[membre] = expiration
            return 1
        raise AssertionError("script inconnu :\n%s" % script)

    async def zrem(self, cle, membre):
        if self.erreur is not None:
            raise self.erreur
        self.flux.get(cle, {}).pop(membre, None)
        return 1


@pytest.fixture(autouse=True)
def registre_isole():
    """Chaque cas part d'un registre local vide et d'un partage débranché."""
    kojo_live.reset_streams()
    kojo_live.reset_bus()
    yield
    kojo_live.reset_streams()
    kojo_live.reset_bus()


def _membres(faux: FauxRegistre, user_id: str) -> dict:
    return faux.flux.setdefault(kojo_live._cle_flux(user_id), {})


def _peupler(faux: FauxRegistre, user_id: str, combien: int, expiration_ms: int) -> None:
    """Pose des flux « d'autres workers » — ce que le registre verrait d'eux."""
    membres = _membres(faux, user_id)
    for index in range(combien):
        membres["autre-worker:%d" % index] = expiration_ms


@pytest.mark.asyncio
async def test_sans_registre_partage_le_plafond_local_reste_seul_juge():
    """Sans Redis, rien ne change : le plafond du process borne toujours."""
    for _ in range(kojo_live.MAX_STREAMS_PER_USER):
        await kojo_live.sse_response("compte-sans-partage")

    with pytest.raises(kojo_live.StreamCapacityExceeded):
        await kojo_live.sse_response("compte-sans-partage")


@pytest.mark.asyncio
async def test_le_plafond_est_celui_du_compte_et_non_du_worker():
    """Trois flux ailleurs + un ici = quatre ; le suivant est refusé ICI.

    C'est le cœur du défaut : ce worker n'en sert qu'un seul, donc son plafond
    LOCAL est loin d'être atteint — et pourtant le compte, lui, est plein.
    """
    faux = FauxRegistre()
    kojo_live.brancher_partage(faux)
    maintenant = int(time.time() * 1000)
    _peupler(faux, "compte-charge", kojo_live.MAX_STREAMS_PER_USER - 1, maintenant + 60_000)

    await kojo_live.sse_response("compte-charge")
    assert kojo_live.active_streams_for("compte-charge") == 1
    assert kojo_live.partage_stats()["reserves"] == 1

    with pytest.raises(kojo_live.StreamCapacityExceeded) as refus:
        await kojo_live.sse_response("compte-charge")
    assert str(kojo_live.MAX_STREAMS_PER_USER) in str(refus.value), (
        "le refus ne nomme pas le plafond, il ne dit donc pas ce qui est atteint"
    )
    assert kojo_live.partage_stats()["refus"] == 1


@pytest.mark.asyncio
async def test_un_refus_rend_la_place_locale():
    """Un refus ne doit pas laisser d'abonné fantôme compter pour un autre."""
    faux = FauxRegistre()
    kojo_live.brancher_partage(faux)
    maintenant = int(time.time() * 1000)
    _peupler(faux, "compte-plein", kojo_live.MAX_STREAMS_PER_USER, maintenant + 60_000)

    with pytest.raises(kojo_live.StreamCapacityExceeded):
        await kojo_live.sse_response("compte-plein")

    assert kojo_live.active_streams_for("compte-plein") == 0, (
        "le flux refusé est resté abonné localement : il compterait pour un "
        "autre flux du même compte"
    )
    assert kojo_live.active_streams() == 0
    assert len(_membres(faux, "compte-plein")) == kojo_live.MAX_STREAMS_PER_USER


@pytest.mark.asyncio
async def test_un_bail_expire_ne_compte_plus():
    """Un worker tué sans `finally` ne garde pas ses places pour toujours."""
    faux = FauxRegistre()
    kojo_live.brancher_partage(faux)
    maintenant = int(time.time() * 1000)
    # Quatre flux « morts » : leur bail est passé.
    _peupler(faux, "compte-revenu", kojo_live.MAX_STREAMS_PER_USER, maintenant - 1_000)

    await kojo_live.sse_response("compte-revenu")

    assert kojo_live.active_streams_for("compte-revenu") == 1
    assert len(_membres(faux, "compte-revenu")) == 1, (
        "les baux expirés n'ont pas été purgés : le compte resterait bloqué"
    )


@pytest.mark.asyncio
async def test_redis_injoignable_n_empeche_pas_un_flux(monkeypatch):
    """Une panne du registre ne ferme rien : le plafond local décide, et c'est dit."""
    faux = FauxRegistre()
    faux.erreur = ConnectionError("Redis injoignable")
    kojo_live.brancher_partage(faux)

    await kojo_live.sse_response("compte-sous-panne")

    assert kojo_live.active_streams_for("compte-sous-panne") == 1, (
        "un flux a été refusé (ou perdu) parce que le registre ne répondait pas"
    )
    assert kojo_live.partage_stats()["repli"] >= 1, (
        "le repli local n'est pas compté : la panne serait tue"
    )


@pytest.mark.asyncio
async def test_le_battement_de_coeur_repousse_le_bail(monkeypatch):
    """Un flux vivant ne doit pas expirer : son bail suit le battement.

    Sans ce rafraîchissement, un flux de plus de `PARTAGE_LEASE_SECONDS` serait
    compté comme fermé, et le compte pourrait ouvrir un flux de trop.
    """
    monkeypatch.setattr(kojo_live, "HEARTBEAT_SECONDS", 0.01)
    faux = FauxRegistre()
    kojo_live.brancher_partage(faux)

    reponse = await kojo_live.sse_response("compte-vivant")
    corps = reponse.body_iterator
    try:
        (membre, premier_bail), = _membres(faux, "compte-vivant").items()
        assert await anext(corps) == ": keepalive\n\n"
        second_bail = _membres(faux, "compte-vivant")[membre]
        assert second_bail > premier_bail, (
            "le bail n'a pas été repoussé : le flux expirerait en vivant"
        )
    finally:
        await corps.aclose()


@pytest.mark.asyncio
async def test_fermer_le_flux_libere_la_place_partagee(monkeypatch):
    """La place doit revenir au compte dès que le flux se ferme.

    Le corps est DÉMARRÉ avant d'être fermé, comme le fait `StreamingResponse` :
    fermer un générateur jamais démarré ne traverse pas son `finally` (Python),
    et ce n'est pas la forme que le framework produit. Le battement est accéléré
    pour que cette première trame ne coûte pas les vingt secondes du vrai.
    """
    monkeypatch.setattr(kojo_live, "HEARTBEAT_SECONDS", 0.01)
    faux = FauxRegistre()
    kojo_live.brancher_partage(faux)

    reponse = await kojo_live.sse_response("compte-ferme")
    corps = reponse.body_iterator
    assert len(_membres(faux, "compte-ferme")) == 1
    await anext(corps)  # la première trame (ici un battement accéléré)

    await corps.aclose()

    assert kojo_live.active_streams_for("compte-ferme") == 0
    assert _membres(faux, "compte-ferme") == {}, (
        "le membre partagé survit au flux fermé : la place resterait prise "
        "jusqu'à l'expiration du bail"
    )


@pytest.mark.asyncio
async def test_un_flux_n_attend_pas_un_registre_muet(monkeypatch):
    """Le registre est BORNÉ dans le temps : il ne retarde pas l'ouverture."""
    monkeypatch.setattr(kojo_live, "PARTAGE_TIMEOUT_SECONDS", 0.05)

    class RegistreMu:
        async def eval(self, *args, **kwargs):
            await asyncio.sleep(30)

        async def zrem(self, *args, **kwargs):
            await asyncio.sleep(30)

    kojo_live.brancher_partage(RegistreMu())
    debut = time.monotonic()
    await kojo_live.sse_response("compte-muet")
    duree = time.monotonic() - debut

    assert duree < 5, (
        "l'ouverture d'un flux a attendu un registre muet (%.2f s) : le repli "
        "n'est pas borné" % duree
    )
    assert kojo_live.active_streams_for("compte-muet") == 1
