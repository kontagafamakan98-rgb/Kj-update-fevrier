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

    async def get_message(self, ignore_subscribe_messages=True, timeout=None):
        """Le protocole que `_abonnement` emploie : un message, ou `None` sur silence.

        Un délai qui expire rend `None` (canal calme) et ne lève pas : c'est
        exactement ce que la vraie bibliothèque fait avec un délai explicite, et
        ce qui distingue une coupure d'un canal sans événement.
        """
        if self.ferme:
            return None
        try:
            message = await asyncio.wait_for(self._bus.recus.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        if message is None:
            return None
        # Coupure d'abonnement, UNE fois : le double d'une connexion arrachée.
        # La vérification est APRÈS le `get` pour que la coupure réveille un
        # abonnement déjà en attente, comme le ferait un reset TCP.
        if self._bus._coupure:
            self._bus._coupure = False
            raise ConnectionError("abonnement rompu (double)")
        return {"type": "message", "data": message}

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
        self._coupure = False

    def couper_abonnement(self) -> None:
        """Rompt l'écoute UNE fois, et réveille une attente déjà bloquée.

        Le réveil est un message factice : le vrai serveur, lui, rend une erreur
        de lecture dès que la connexion tombe. Il est consommé AVANT d'être
        livré, donc aucun événement fantôme n'atteint les flux.
        """
        self._coupure = True
        self.recus.put_nowait("__coupure__")

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
async def test_une_fenetre_sans_ecoute_est_declaree_et_fait_relire_chaque_flux(monkeypatch):
    """Ce que l'ABONNÉ perd quand Redis tombe, et la seule réparation possible.

    Le pub/sub n'a aucun historique : une enveloppe publiée par un AUTRE worker
    pendant que notre abonnement est rompu est perdue, définitivement. Le cas
    fixe les deux moitiés du contrat :
      * la fenêtre est COMPTÉE (`reprises`) — sans quoi la perte serait muette ;
      * chaque flux OUVERT reçoit `resync` (`resyncs`) — la relecture répare
        l'état du client, la seule chose réparable ici.
    """
    monkeypatch.setattr(kojo_live, "BUS_RECONNECT_SECONDS", 0.01)
    faux = FauxRedis(echo=True)
    # Les flux existent AVANT la première souscription : elle ne doit rien
    # relire, aucun client n'ayant vécu sans écoute.
    qa = kojo_live.subscribe("compte-a")
    qb = kojo_live.subscribe("compte-b")
    await kojo_live.start_bus(client=faux)

    # Établissement prouvé par l'écho : le faux serveur n'envoie qu'à un
    # abonné qui écoute réellement.
    kojo_live.publish("compte-a", "message", {"id": "avant"})
    await attendre(
        lambda: kojo_live.bus_stats()["echo"] == 1, "l'abonnement n'écoutait pas"
    )
    assert _vider(qa) == [("message", {"id": "avant"})]
    assert _vider(qb) == [], "un flux sans événement a reçu quelque chose"
    assert kojo_live.bus_stats()["resyncs"] == 0, (
        "la PREMIÈRE souscription a fait relire : ce n'est pas une fenêtre perdue"
    )

    # La fenêtre aveugle : l'abonnement tombe, une seule fois.
    faux.couper_abonnement()
    await attendre(
        lambda: kojo_live.bus_stats()["repli"] >= 1,
        "la coupure n'a jamais atteint l'abonnement : le cas ne prouverait rien",
    )
    await attendre(
        lambda: kojo_live.bus_stats()["reprises"] >= 1,
        "la reprise de l'abonnement n'est pas DÉCLARÉE (reprises) : la perte "
        "serait muette",
    )

    attendu = [("resync", {"motif": "bus_reprise"})]
    assert _vider(qa) == attendu, "le flux du compte A n'a pas été fait de relire"
    assert _vider(qb) == attendu, (
        "le compte B n'a pas été fait de relire alors qu'on ignore quelles "
        "enveloppes la fenêtre a perdues : TOUS les flux ouverts doivent relire"
    )
    assert kojo_live.bus_stats()["reprises"] == 1
    assert kojo_live.bus_stats()["resyncs"] == 1

    # Un flux ouvert APRÈS la reprise n'a pas vécu la fenêtre : il ne doit pas
    # relire pour rien (sinon chaque ouverture d'onglet coûterait une relecture).
    qc = kojo_live.subscribe("compte-c")
    assert qc.empty(), "un flux ouvert après la reprise a reçu un resync inutile"


@pytest.mark.asyncio
async def test_une_rafale_ne_laisse_pas_sa_derniere_fenetre_sans_relecture(monkeypatch):
    """La cadence des relectures est bornée, mais la DERNIÈRE fenêtre est réparée.

    Un Redis qui bat de l'aile ferait une reprise toutes les
    `BUS_RECONNECT_SECONDS` ; relire à chacune serait plus bavard que le
    sondage remplacé. Une relecture étant TOTALE, une seule couvre les fenêtres
    qu'elle suit — mais si la dernière tombe dans la marge, elle doit être
    rattrapée plus tard, sinon c'est justement celle qui resterait non relue.
    """
    monkeypatch.setattr(kojo_live, "BUS_RECONNECT_SECONDS", 0.01)
    monkeypatch.setattr(kojo_live, "RESYNC_MIN_INTERVAL_SECONDS", 0.2)
    faux = FauxRedis(echo=True)
    queue = kojo_live.subscribe("compte-rafale")
    await kojo_live.start_bus(client=faux)

    kojo_live.publish("compte-rafale", "message", {"id": "temoin"})
    await attendre(
        lambda: kojo_live.bus_stats()["ecoutes"] >= 1, "l'abonnement n'écoutait pas"
    )
    _vider(queue)

    # Première fenêtre : relecture immédiate.
    faux.couper_abonnement()
    await attendre(
        lambda: kojo_live.bus_stats()["resyncs"] == 1,
        "la première fenêtre n'a pas été réparée",
    )
    _vider(queue)

    # Seconde fenêtre DANS la marge : rien tout de suite...
    faux.couper_abonnement()
    await attendre(
        lambda: kojo_live.bus_stats()["reprises"] == 2,
        "la seconde fenêtre n'a pas été déclarée",
    )
    assert queue.empty(), (
        "une relecture a été relancée dans la marge : la cadence bornée ne "
        "protège plus le sondage qu'elle remplace"
    )
    # ... mais une relecture DIFFÉRÉE rattrape la dernière fenêtre.
    await attendre(
        lambda: kojo_live.bus_stats()["resyncs"] == 2,
        "la dernière fenêtre d'une rafale n'a jamais été réparée : c'est "
        "précisément celle dont personne ne parlerait plus ensuite",
    )
    assert _vider(queue) == [("resync", {"motif": "bus_reprise"})]


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
    # Le journal ne dit plus « reste LOCAL » mais « GARDÉE et republiée » : ce
    # n'est plus une perte pour les autres workers, seulement un RETARD (mesuré
    # le 19/10/2026 : l'ancienne version perdait une enveloppe par fenêtre).
    assert any("GARDÉE" in message for message in caplog.messages), caplog.messages


@pytest.mark.asyncio
async def test_un_echec_de_publication_ne_perd_pas_l_enveloppe_en_vol(monkeypatch):
    """La fenêtre de reconnexion ne peut pas coûter l'enveloppe EN VOL.

    Mesuré le 19/10/2026 (`scripts/charge/mesure_panne_redis.py`, 400 flux,
    400 évt/s, panne de 2 s) : la tâche retirait une enveloppe du tampon, la
    publication échouait, et elle passait à la suivante après la pause. Le bus
    recevait donc 799 des 800 enveloppes de la fenêtre, et la manquante n'était
    comptée NULLE PART (`perdus` restait à 0, seul `repli` bougeait) : la file
    tenait sa promesse, le consommateur la rompait.

    La reprise doit être celle de la MÊME enveloppe, et dans l'ordre.
    """
    monkeypatch.setattr(kojo_live, "BUS_RECONNECT_SECONDS", 0.01)
    faux = FauxRedis(en_panne=True)
    await kojo_live.start_bus(client=faux)
    queue = kojo_live.subscribe("compte-i")

    for index in range(3):
        kojo_live.publish("compte-i", "message", {"index": index})

    # Les trois sont livrées LOCALEMENT, panne comprise.
    assert [evenement[1]["index"] for evenement in _vider(queue)] == [0, 1, 2]

    # Deux tentatives échouées au moins : la preuve que le chemin de panne a
    # bien été pris (sinon la reprise ci-dessous ne prouverait rien).
    await attendre(
        lambda: kojo_live.bus_stats()["repli"] >= 2,
        "la panne de publication n'a pas été retentée",
    )
    faux.en_panne = False

    await attendre(
        lambda: len(faux.publies) == 3,
        "les enveloppes gardées n'ont jamais été republiées après la reprise",
    )
    publiees = [json.loads(charge)["d"]["index"] for _, charge in faux.publies]
    assert publiees == [0, 1, 2], "la reprise a changé l'ordre de publication"
    assert kojo_live.bus_stats()["perdus"] == 0, "une enveloppe a été perdue sans débordement"


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


class FauxPubSubAnnulationAvalee(FauxPubSub):
    """Un abonnement qui AVALE sa première annulation.

    C'est la course de `asyncio.wait_for` antérieure à 3.12 : quand le délai
    expire au moment où l'annulation arrive, le `CancelledError` peut être
    perdu et la tâche repart dans sa boucle. Le double la reproduit à volonté.
    """

    def __init__(self, bus: FauxRedis):
        super().__init__(bus)
        self.annulations_avalees = 0

    async def get_message(self, ignore_subscribe_messages=True, timeout=None):
        try:
            return await super().get_message(ignore_subscribe_messages, timeout)
        except asyncio.CancelledError:
            if self.annulations_avalees == 0:
                self.annulations_avalees += 1
                return None
            raise


class FauxRedisAnnulationAvalee(FauxRedis):
    """Le même bus, dont l'abonnement perd sa première annulation."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.dernier_pubsub = None

    def pubsub(self):
        self.dernier_pubsub = FauxPubSubAnnulationAvalee(self)
        return self.dernier_pubsub


@pytest.mark.asyncio
async def test_une_annulation_avalee_ne_bloque_pas_l_arret_du_bus():
    """`stop_bus` est BORNÉ même quand une annulation est perdue.

    Mesuré le 19/10/2026 : sous Python 3.11 + pytest 9, la suite backend
    expirait à 30 min sur le cas de reprise d'enveloppe (deux passes de CI
    identiques) — le test finissait, puis `stop_bus` attendait sans borne une
    tâche dont l'annulation avait été avalée par un délai concurrent. Ici,
    l'attente est bornée et le drapeau d'arrêt fait sortir la boucle : l'arrêt
    rend la main en quelques millisecondes.
    """
    faux = FauxRedisAnnulationAvalee()
    await kojo_live.start_bus(client=faux)
    await asyncio.sleep(0.01)  # laisse l'abonnement s'installer dans son délai

    await asyncio.wait_for(kojo_live.stop_bus(), timeout=5.0)

    assert kojo_live.bus_actif() is False
    assert faux.dernier_pubsub is not None, "l'abonnement n'a jamais été ouvert"
    assert faux.dernier_pubsub.annulations_avalees == 1, (
        "le cas de l'annulation avalée n'a pas été exercé : la preuve ne prouverait rien"
    )


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
