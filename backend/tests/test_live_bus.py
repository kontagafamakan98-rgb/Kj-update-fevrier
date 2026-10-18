# -*- coding: utf-8 -*-
"""Le BUS PARTAGÉ du temps réel : ce que ces tests établissent.

Le fan-out SSE est en mémoire, donc un événement publié par un worker ne joint
que les flux de CE worker. Le bus (Redis pub/sub) le prolonge aux autres
workers et aux autres machines — et il doit pouvoir DISPARAÎTRE sans que le
produit cesse de fonctionner : c'est la contrainte qui décide de tout le reste.

  * sans `REDIS_URL`, rien ne change : le bus n'existe pas, et l'événement
    publié est livré localement comme avant ;
  * avec un bus, le dépôt LOCAL passe en premier (il ne peut pas échouer), la
    proposition au bus ensuite (elle ne peut pas bloquer une route) ;
  * un process IGNORE son propre écho : il a déjà livré l'événement au moment
    du `publish`, le livrer une seconde fois le doublerait ;
  * l'enveloppe d'un AUTRE process est rendue aux flux locaux du bon compte ;
  * une enveloppe illisible est comptée et ignorée — jeter l'exception ferait
    tomber l'abonnement pour un message qui ne concerne pas le produit ;
  * un Redis dont la PUBLICATION échoue ne prive pas le process de son propre
    flux : le bus retente, et l'événement reste local ;
  * le tampon est BORNÉ : au-delà, c'est le bus qui perd l'événement, pas le
    flux local, et la perte est comptée (elle ne peut donc pas être tue).

Le double `FauxRedis` ne simule pas le réseau : il porte le PROTOCOLE
(`publish`, `pubsub().subscribe()`, `listen()`) et rejoue le message dans la
file de l'abonné, comme le ferait le serveur — c'est ce qui rend l'anti-écho
mesurable sans Redis dans la CI.
"""
from __future__ import annotations

import asyncio
import json
import logging

import pytest
import pytest_asyncio

import kojo_live


class FauxPubSub:
    """L'abonnement d'un process : une file de messages, et un arrêt propre."""

    def __init__(self, bus: "FauxRedis"):
        self._bus = bus
        self.canal = None
        self.ferme = False

    async def subscribe(self, canal):
        self.canal = canal
        self._bus.abonnements.append(canal)

    async def listen(self):
        while not self.ferme:
            message = await self._bus.recus.get()
            if message is None:
                return
            yield {"type": "message", "data": message}

    async def aclose(self):
        self.ferme = True


class FauxRedis:
    """Un Redis pub/sub minimal, en mémoire — le protocole, jamais le réseau.

    `publish` REJOUE l'enveloppe dans la file de l'abonné par défaut : c'est le
    comportement du vrai serveur, et donc la seule façon d'éprouver qu'un
    process ne se livre pas deux fois son propre événement.
    """

    def __init__(self, echo: bool = True, en_panne: bool = False, bloque=None):
        self.recus: asyncio.Queue = asyncio.Queue()
        self.publies = []
        self.abonnements = []
        self.echo = echo
        self.en_panne = en_panne
        self.bloque = bloque
        self.ferme = False

    async def publish(self, canal, charge):
        if self.bloque is not None:
            await self.bloque.wait()
        if self.en_panne:
            raise ConnectionError("redis injoignable")
        self.publies.append((canal, charge))
        if self.echo:
            self.recus.put_nowait(charge)
        return 1

    def pubsub(self):
        return FauxPubSub(self)

    async def aclose(self):
        self.ferme = True


async def attendre(predicat, message: str = "", essais: int = 400) -> None:
    """Attend une CONDITION (jamais une horloge) : deux tâches se donnent la main."""
    for _ in range(essais):
        if predicat():
            return
        await asyncio.sleep(0.005)
    raise AssertionError(message or "la condition attendue n'est jamais arrivée")


@pytest_asyncio.fixture(autouse=True)
async def bus_isole():
    """Le bus est un état de PROCESS : chaque cas part d'un registre propre."""
    await kojo_live.stop_bus()
    kojo_live.reset_bus()
    kojo_live.reset_streams()
    yield
    await kojo_live.stop_bus()
    kojo_live.reset_bus()
    kojo_live.reset_streams()


def _vider(queue: asyncio.Queue) -> list:
    evenements = []
    while not queue.empty():
        evenements.append(queue.get_nowait())
    return evenements


@pytest.mark.asyncio
async def test_sans_redis_url_le_bus_n_existe_pas_et_le_fan_out_reste_local(monkeypatch):
    """Sans `REDIS_URL`, le comportement d'avant est intact — et dit comme tel."""
    monkeypatch.setenv("REDIS_URL", "")
    assert await kojo_live.start_bus() is False
    assert kojo_live.bus_actif() is False

    queue = kojo_live.subscribe("compte-memoire")
    assert kojo_live.publish("compte-memoire", "notification", {"id": "n1"}) == 1
    assert queue.get_nowait() == ("notification", {"id": "n1"})
    assert kojo_live.bus_stats()["publies"] == 0, "un bus absent ne doit rien publier"


@pytest.mark.asyncio
async def test_un_evenement_publie_part_aussi_sur_le_canal_partage():
    """Le bus porte l'enveloppe adressée : origine, destinataire, événement, charge."""
    faux = FauxRedis(echo=False)
    assert await kojo_live.start_bus(client=faux) is True
    assert kojo_live.bus_actif() is True

    queue = kojo_live.subscribe("compte-a")
    kojo_live.publish("compte-a", "message", {"id": "m1"})

    # LOCAL d'abord : le flux du process qui publie n'attend pas Redis.
    assert queue.get_nowait() == ("message", {"id": "m1"})

    await attendre(lambda: faux.publies, "l'événement n'a jamais été publié sur le bus")
    canal, charge = faux.publies[0]
    assert canal == kojo_live.BUS_CHANNEL
    assert json.loads(charge) == {
        "o": kojo_live.origine_du_processus(),
        "u": "compte-a",
        "e": "message",
        "d": {"id": "m1"},
    }


@pytest.mark.asyncio
async def test_mon_propre_echo_n_est_pas_relivre_une_seconde_fois():
    """Anti-doublon : le process reconnaît son origine et ignore son écho."""
    faux = FauxRedis(echo=True)
    await kojo_live.start_bus(client=faux)

    queue = kojo_live.subscribe("compte-b")
    kojo_live.publish("compte-b", "notification", {"id": "n"})
    assert queue.get_nowait()[0] == "notification"

    await attendre(
        lambda: kojo_live.bus_stats()["echo"] == 1,
        "l'écho du bus n'a jamais été reçu (le faux serveur n'a rien rejoué)",
    )
    assert _vider(queue) == [], "l'écho a livré une SECONDE fois l'événement local"


@pytest.mark.asyncio
async def test_un_evenement_d_un_autre_processus_est_livre_aux_flux_locaux():
    """Le fait qui justifie le bus : un AUTRE process joint nos flux."""
    faux = FauxRedis(echo=False)
    await kojo_live.start_bus(client=faux)
    queue = kojo_live.subscribe("compte-c")

    faux.recus.put_nowait(
        json.dumps(
            {"o": "un-autre-processus", "u": "compte-c", "e": "message", "d": {"id": "m2"}}
        )
    )

    await attendre(lambda: not queue.empty(), "l'événement venu du bus n'est jamais arrivé")
    assert queue.get_nowait() == ("message", {"id": "m2"})
    assert kojo_live.bus_stats()["recus"] == 1


@pytest.mark.asyncio
async def test_une_enveloppe_illisible_est_comptee_sans_casser_l_abonnement():
    """Un message qu'on ne comprend pas ne doit pas rendre le process sourd."""
    faux = FauxRedis(echo=False)
    await kojo_live.start_bus(client=faux)
    queue = kojo_live.subscribe("compte-d")

    faux.recus.put_nowait("pas du JSON du tout")
    faux.recus.put_nowait(json.dumps({"o": "x"}))  # ni destinataire ni événement
    faux.recus.put_nowait(
        json.dumps({"o": "autre", "u": "compte-d", "e": "notification", "d": {"id": "ok"}})
    )

    await attendre(
        lambda: not queue.empty(),
        "après deux enveloppes illisibles, l'événement VALIDE n'est pas arrivé : "
        "l'abonnement est tombé",
    )
    assert queue.get_nowait() == ("notification", {"id": "ok"})
    assert kojo_live.bus_stats()["illisibles"] == 2


@pytest.mark.asyncio
async def test_un_redis_en_panne_ne_prive_pas_le_process_de_son_propre_flux(caplog):
    """Le bus est un accélérateur : sa panne ne doit pas coûter un événement local."""
    faux = FauxRedis(en_panne=True)
    with caplog.at_level(logging.WARNING):
        await kojo_live.start_bus(client=faux)
        queue = kojo_live.subscribe("compte-e")
        assert kojo_live.publish("compte-e", "message", {"id": "m3"}) == 1

        assert queue.get_nowait() == ("message", {"id": "m3"}), (
            "le flux du process qui publie a attendu Redis"
        )
        await attendre(
            lambda: kojo_live.bus_stats()["repli"] >= 1,
            "la panne de publication n'a pas été comptée",
        )

    assert kojo_live.bus_actif() is True, "le bus doit rester branché pour réessayer"
    assert any("reste LOCAL" in message for message in caplog.messages), caplog.messages


@pytest.mark.asyncio
async def test_publier_ne_bloque_jamais_sur_un_bus_lent():
    """La route qui publie n'attend pas Redis : la preuve est structurelle."""
    bloque = asyncio.Event()
    faux = FauxRedis(bloque=bloque)
    await kojo_live.start_bus(client=faux)
    queue = kojo_live.subscribe("compte-f")

    assert kojo_live.publish("compte-f", "message", {"id": "m4"}) == 1
    assert queue.get_nowait() == ("message", {"id": "m4"})
    # Le bus est encore BLOQUÉ dans sa publication : il n'a donc rien publié,
    # et pourtant `publish` a rendu son verdict. Aucun `await` n'a été pris.
    assert faux.publies == []
    assert kojo_live.bus_stats()["publies"] == 0

    bloque.set()
    await attendre(lambda: faux.publies, "le bus débloqué n'a jamais publié")


@pytest.mark.asyncio
async def test_le_tampon_borne_perd_le_bus_jamais_l_evenement_local(monkeypatch):
    """Un flush plus lent que la production perd le BUS, et le compte le dit."""
    monkeypatch.setattr(kojo_live, "BUS_QUEUE_SIZE", 2)
    bloque = asyncio.Event()
    faux = FauxRedis(bloque=bloque)
    await kojo_live.start_bus(client=faux)
    queue = kojo_live.subscribe("compte-g")

    for index in range(5):
        kojo_live.publish("compte-g", "notification", {"index": index})

    assert len(_vider(queue)) == 5, "le flux LOCAL a perdu un événement"
    assert kojo_live.bus_stats()["perdus"] >= 1, (
        "le tampon a débordé sans le dire : la perte serait muette"
    )
    bloque.set()


@pytest.mark.asyncio
async def test_arreter_le_bus_rend_les_taches_et_redemarre_proprement():
    """Le shutdown coupe les deux tâches ; un redémarrage rebranche le bus."""
    faux = FauxRedis(echo=False)
    await kojo_live.start_bus(client=faux)
    assert kojo_live.bus_actif() is True

    await kojo_live.stop_bus()
    assert kojo_live.bus_actif() is False

    kojo_live.publish("compte-h", "message", {"id": "hors-bus"})
    assert faux.publies == [], "un bus arrêté publie encore"

    assert await kojo_live.start_bus(client=faux) is True
    kojo_live.publish("compte-h", "message", {"id": "apres-redemarrage"})
    await attendre(lambda: faux.publies, "le bus redémarré ne publie plus")
