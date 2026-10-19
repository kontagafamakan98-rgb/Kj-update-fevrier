# -*- coding: utf-8 -*-
"""Les DEUX pertes du bus, jugées en CI contre un VRAI Redis.

Un bus a deux bouts, et chacun perd à sa manière : le PUBLIEUR peut laisser
tomber l'enveloppe qu'il vient de retirer du tampon (premier défaut ci-dessous,
corrigé), et l'ABONNÉ perd TOUT ce qu'un autre worker publie pendant que son
abonnement est rompu — le pub/sub n'a aucun historique, donc rien ne le rejoue.
La seconde perte n'est pas évitable ; elle est par conséquent DÉCLARÉE
(`bus_stats()['reprises']`) et RÉPARÉE par une relecture (`resync`) de chaque
flux local au rétablissement, et le fichier MESURE la perte avant d'exiger la
réparation (douze enveloppes publiées pendant la fenêtre, zéro livrée). Il
garde aussi le CALME : une lecture de canal qui expire n'est pas une coupure —
sinon l'abonnement se romprait toutes les 2 s et la réparation relirait sans
arrêt (défaut mesuré le 19/10/2026).

Le défaut, et ce qu'il a coûté
-----------------------------
Mesuré le 19/10/2026 avec le banc `scripts/charge/mesure_panne_redis.py`
(400 flux, 400 évt/s, panne réelle de 2 s) : la tâche `_publieur` retirait une
enveloppe du tampon, la publication échouait, et elle passait à la SUIVANTE.
Le bus recevait donc 799 des 800 enveloppes de la fenêtre, et la manquante
n'était comptée nulle part — `perdus` restait à 0, seul `repli` bougeait.
La file tenait sa promesse de dimensionnement ; c'est le consommateur qui la
rompait, et la perte était MUETTE.

Le banc a mesuré, il ne garde rien : il vit dans `scripts/charge/`, personne ne
le lance à chaque PR, et sa panne est un serveur RESP minimal écrit pour lui.
Ce fichier-ci est la garde : il rejoue le même défaut **contre le service
`redis:7` du job `backend-tests`**, avec le client réel (`redis.asyncio`), et il
échoue si une seule enveloppe retirée du tampon n'arrive ni au bus ni au
compteur.

Comment la panne est VRAIE sans arrêter le service
--------------------------------------------------
Le test ne peut pas tuer le Redis du job (il sert aussi un autre fichier). Il
place donc un PROXY TCP devant lui, et c'est le PROXY qui s'arrête : écoute
fermée ET connexions coupées. Le client voit `ConnectionRefused` / reset
comme d'une machine morte, sans qu'aucun `raise` soit simulé dans le produit.
Le Redis, lui, est le vrai : mêmes trames, mêmes connexions, même reprise de
redis-py.

Ce qui est exigé, et pourquoi chacun
-----------------------------------
1. `publies + perdus == envoyees` : toute enveloppe publiée est soit au bus,
   soit COMPTÉE perdue. Un écart est une perte muette — le défaut lui-même.
2. `perdus == 0` : 12 enveloppes pendant la fenêtre, très en deçà de la file
   de 1000 ; le dimensionnement n'a aucune raison de céder.
3. `repli >= 1` : la panne a bien ATTEINT le publieur. Sans cette mesure, un
   proxy qui n'aurait rien coupé rendrait le cas vert sans rien prouver.
4. Les files LOCALES ont tout reçu : la panne du bus ne prive jamais le
   process de son propre flux.

La preuve de mutation (l'enveloppe jetée au lieu d'être retentée) vise le cas
unitaire `tests/test_live_bus.py::test_un_echec_de_publication_ne_perd_pas_
l_enveloppe_en_vol`, qui tourne SANS Redis : une mutation doit pouvoir se
rejouer dans un job qui n'a pas de service. Ce fichier-ci est le second
témoin, celui qui ne dépend d'aucun double.

Prémisses (aucun verdict rendu ici)
-----------------------------------
`TEST_REDIS_URL` est le mandat : posé, ce fichier juge ; absent, il se déclare
— en le disant, jamais en vert. Le job `backend-tests` le lance dans l'étape
du bus partagé, à côté du vrai Redis, et le dernier cas de ce fichier vérifie
que cette étape le lance encore : un test que personne n'exécute serait un
silence de plus.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
import socketserver
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import pytest
import pytest_asyncio

import kojo_live

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"

FICHIER = "tests/test_live_bus_panne_redis.py"
# Le fichier qui partage l'étape : il porte déjà la preuve de la traversée, et
# c'est SA ligne de commande que ce fichier-ci complète.
COMPAGNON = "tests/test_live_bus_deux_workers.py"
JOB = "backend-tests"
MIN_LIGNES_CI = 500


def _exiger_redis() -> str:
    """Le mandat : sans `TEST_REDIS_URL`, aucun verdict n'est rendu."""
    url = (os.environ.get("TEST_REDIS_URL") or "").strip()
    if not url:
        pytest.skip(
            "prémisse (aucun verdict rendu ici) : TEST_REDIS_URL absent — ce "
            "fichier ne juge la perte en vol que contre un VRAI Redis (étape "
            "dédiée du job %s)." % JOB
        )
    return url


# ---------------------------------------------------------------------------
# Un proxy TCP devant le vrai Redis : c'est LUI qui tombe
# ---------------------------------------------------------------------------


class _Gestionnaire(socketserver.BaseRequestHandler):
    """Relais bidirectionnel d'une connexion vers l'amont, sans rien comprendre."""

    def handle(self) -> None:  # noqa: C901 - deux sens, un seul relais
        serveur: "_Proxy" = self.server  # type: ignore[assignment]
        try:
            amont = socket.create_connection(serveur.amont, timeout=2)
        except OSError:
            return
        # `create_connection` laisse SON délai sur la socket : sans ce retour à
        # l'attente infinie, le relais rendait la main après 2 s de silence et
        # coupait une connexion SAINE — c'est ce qui a fait croire à une panne
        # toutes les 2 s lors de la première mesure de ce fichier. Le proxy ne
        # doit expirer que quand le test le lui demande.
        amont.settimeout(None)
        self.request.settimeout(None)
        serveur.enregistrer(self.request)
        serveur.enregistrer(amont)
        fil = threading.Thread(
            target=self._pomper, args=(amont, self.request), daemon=True
        )
        fil.start()
        self._pomper(self.request, amont)

    @staticmethod
    def _pomper(source: socket.socket, puits: socket.socket) -> None:
        try:
            while True:
                morceau = source.recv(65536)
                if not morceau:
                    break
                puits.sendall(morceau)
        except OSError:
            pass
        finally:
            # Les DEUX côtés tombent ensemble : laisser une moitié ouverte
            # ferait attendre le client au lieu de lui rendre l'erreur.
            for prise in (source, puits):
                try:
                    prise.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass


class _Proxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, adresse, amont):
        self.amont = amont
        self.connexions: list[socket.socket] = []
        self.verrou = threading.Lock()
        super().__init__(adresse, _Gestionnaire)

    def enregistrer(self, connexion: socket.socket) -> None:
        with self.verrou:
            self.connexions.append(connexion)

    def fermer_connexions(self) -> None:
        with self.verrou:
            connexions, self.connexions = list(self.connexions), []
        for connexion in connexions:
            try:
                connexion.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connexion.close()
            except OSError:
                pass


class ProxyQuiTombe:
    """Le proxy, arrêtable et redémarrable sur le MÊME port.

    Même port, parce que le client Redis garde son URL : la reprise doit se
    faire sur l'adresse du contrat, sinon on mesurerait un changement de
    configuration au lieu d'une reconnexion.
    """

    def __init__(self, url_amont: str):
        analysé = urlparse(url_amont)
        self.amont = (analysé.hostname or "127.0.0.1", analysé.port or 6379)
        self._serveur: _Proxy | None = None
        self._fil: threading.Thread | None = None
        self._port: int | None = None

    @property
    def url(self) -> str:
        return "redis://127.0.0.1:%d/0" % self._port

    @property
    def actif(self) -> bool:
        return self._serveur is not None

    def start(self) -> None:
        serveur = _Proxy(("127.0.0.1", self._port or 0), self.amont)
        self._port = int(serveur.server_address[1])
        self._serveur = serveur
        self._fil = threading.Thread(target=serveur.serve_forever, daemon=True)
        self._fil.start()

    def stop(self) -> None:
        serveur, self._serveur = self._serveur, None
        if serveur is None:
            return
        serveur.shutdown()
        serveur.server_close()
        serveur.fermer_connexions()
        if self._fil is not None:
            self._fil.join(timeout=5)
            self._fil = None


# ---------------------------------------------------------------------------
# Le cas
# ---------------------------------------------------------------------------


async def _attendre(predicat, message: str, secondes: float = 10.0) -> None:
    """Attend une CONDITION (jamais une horloge), avec une borne nommée."""
    limite = time.perf_counter() + secondes
    while time.perf_counter() < limite:
        if predicat():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(message)


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


@pytest.mark.asyncio
async def test_une_enveloppe_en_vol_n_est_jamais_perdue_sans_etre_comptee(monkeypatch):
    """La panne de Redis ne peut pas coûter une enveloppe retirée du tampon.

    La fenêtre du contrat est reproduite à taille de CI : quelques comptes, un
    débit modeste, une panne courte — mais le chemin est celui du produit
    (`kojo_live.publish` → tampon borné → `_publieur` → redis-py → Redis), et
    c'est bien l'enveloppe EN VOL qui est en jeu.
    """
    url = _exiger_redis()
    # La reprise attend le délai du contrat ; en CI on le raccourcit pour que
    # le cas dure quelques secondes. C'est la même constante que le publieur
    # lit, donc ce n'est pas un autre code.
    monkeypatch.setattr(kojo_live, "BUS_RECONNECT_SECONDS", 0.2)

    proxy = ProxyQuiTombe(url)
    proxy.start()
    monkeypatch.setenv("REDIS_URL", proxy.url)
    assert await kojo_live.start_bus(), (
        "le bus n'a pas démarré contre le VRAI Redis (%s) : le service du job "
        "%s n'est pas joignable, donc rien n'est jugé" % (url, JOB)
    )
    try:
        comptes = ["compte-%02d" % index for index in range(4)]
        files = [kojo_live.subscribe(compte) for compte in comptes]

        # 1) Témoin : le même chemin, sans panne. S'il échoue, le défaut n'est
        #    pas la panne mais le bus lui-même — et le message doit le dire.
        temoin = 5
        for index in range(temoin):
            kojo_live.publish(comptes[index % len(comptes)], "notification", {"n": index})
        await _attendre(
            lambda: kojo_live.bus_stats()["publies"] == temoin,
            "le témoin n'est pas passé par le bus : le défaut est dans la "
            "publication, pas dans la panne",
        )

        # 2) La panne : le proxy s'arrête AVANT les enveloppes de la fenêtre.
        proxy.stop()
        panne = 12
        for index in range(panne):
            kojo_live.publish(
                comptes[index % len(comptes)], "notification", {"n": temoin + index}
            )
            await asyncio.sleep(0.01)

        # La preuve que la panne a ATTEINT le publieur : sans elle, un proxy
        # qui n'aurait rien coupé rendrait la suite verte sans rien mesurer.
        await _attendre(
            lambda: kojo_live.bus_stats()["repli"] >= 1,
            "la panne du proxy n'a jamais atteint le publieur : le cas ne "
            "prouverait rien",
            secondes=5.0,
        )

        # 3) La reprise : le proxy réécoute sur le même port.
        proxy.start()
        envoyees = temoin + panne
        await _attendre(
            lambda: kojo_live.bus_stats()["publies"] == envoyees,
            "les enveloppes gardées n'ont jamais été republiées après la "
            "reprise (%d/%d)" % (kojo_live.bus_stats()["publies"], envoyees),
            secondes=15.0,
        )

        stats = kojo_live.bus_stats()
        muettes = envoyees - stats["publies"] - stats["perdus"]
        assert muettes == 0, (
            "%d enveloppe(s) ne sont ni parvenues au bus ni comptées perdues "
            "(%d envoyées − %d publiées − %d comptées) : perte MUETTE, le "
            "défaut du 19/10/2026"
            % (muettes, envoyees, stats["publies"], stats["perdus"])
        )
        assert stats["perdus"] == 0, (
            "%d enveloppe(s) perdues alors que la file (1000) devait tenir les "
            "%d de la fenêtre : le dimensionnement n'a pas cédé, c'est la "
            "reprise qui manque" % (stats["perdus"], panne)
        )
        assert stats["repli"] >= 1, "aucune reprise n'a été comptée"

        # Les files contiennent aussi la RELECTURE de réparation (`resync`),
        # demandée à chaque flux après la fenêtre : compter les trames brutes
        # confondrait 4 événements livrés avec 1 relecture et 3 événements.
        recus = []
        for file in files:
            while not file.empty():
                recus.append(file.get_nowait())
        local = sum(1 for evenement in recus if evenement[0] != "resync")
        relectures = sum(1 for evenement in recus if evenement[0] == "resync")
        assert local == envoyees, (
            "les flux LOCAUX ont reçu %d/%d événements : la panne du bus a "
            "privé le process de son propre flux" % (local, envoyees)
        )
        assert relectures == len(files), (
            "%d flux local(aux) sur %d ont été faits de relire : la fenêtre "
            "sans écoute doit être réparée pour TOUS (on ignore quels comptes "
            "elle a touchés)" % (relectures, len(files))
        )
    finally:
        await kojo_live.stop_bus()
        kojo_live.reset_bus()
        kojo_live.reset_streams()
        proxy.stop()


@pytest.mark.asyncio
async def test_ce_que_l_abonne_perd_pendant_la_panne_est_declare_et_repare(monkeypatch):
    """La perte de l'ABONNÉ, mesurée puis RÉPARÉE — l'autre moitié du contrat.

    Le cas précédent juge le PUBLIEUR : il ne perd pas l'enveloppe qu'il tient.
    Mais le bus a deux bouts, et le second était muet : le pub/sub n'a AUCUN
    historique, donc ce qu'un AUTRE worker publie pendant que notre abonnement
    est rompu ne nous parviendra jamais. Ce cas le MESURE : douze enveloppes
    publiées pendant la fenêtre, zéro livrée.

    Ce qui est réparable n'est pas l'enveloppe (elle n'existe plus nulle part)
    mais l'ÉTAT du client : au rétablissement, chaque flux local reçoit
    `resync` et relit la source de vérité. Le cas exige les trois :
      1. la fenêtre est DÉCLARÉE (`reprises`), sinon la perte est muette ;
      2. les enveloppes de la fenêtre ne sont PAS livrées (la perte est réelle,
         on ne fait pas semblant de l'avoir évitée) ;
      3. chaque flux OUVERT a reçu `resync` avant les événements de la reprise.

    L'AUTRE worker est un client Redis direct : même canal, même enveloppe,
    même chemin que son `_publieur` — seule notre connexion à nous passe par le
    proxy qui tombe.
    """
    url = _exiger_redis()
    aioredis = pytest.importorskip(
        "redis.asyncio", reason="prémisse (aucun verdict rendu ici) : redis-py absent"
    )
    monkeypatch.setattr(kojo_live, "BUS_RECONNECT_SECONDS", 0.2)
    # Pas de plancher ici : le cas mesure UNE fenêtre et veut sa relecture tout
    # de suite (le plancher a son propre cas unitaire dans `test_live_bus.py`).
    monkeypatch.setattr(kojo_live, "RESYNC_MIN_INTERVAL_SECONDS", 0.0)

    proxy = ProxyQuiTombe(url)
    proxy.start()
    monkeypatch.setenv("REDIS_URL", proxy.url)
    assert await kojo_live.start_bus(), (
        "le bus n'a pas démarré contre le VRAI Redis (%s) : le service du job "
        "%s n'est pas joignable, donc rien n'est jugé" % (url, JOB)
    )
    autre = None
    try:
        comptes = ["compte-abonne-a", "compte-abonne-b"]
        files = [kojo_live.subscribe(compte) for compte in comptes]

        # 1) L'abonnement écoute VRAIMENT : la souscription est établie (pub/sub
        #    réel : publier avant `SUBSCRIBE` serait un événement sans témoin),
        #    puis notre propre écho le prouve.
        await _attendre(
            lambda: kojo_live.bus_stats()["ecoutes"] >= 1,
            "la souscription n'a jamais été établie : le cas jugerait un bus qui "
            "n'écoute pas",
        )
        kojo_live.publish(comptes[0], "message", {"id": "temoin"})
        await _attendre(
            lambda: kojo_live.bus_stats()["echo"] >= 1,
            "l'abonnement ne recevait pas son propre écho : le cas jugerait un "
            "bus qui n'écoute pas",
        )
        for file in files:
            while not file.empty():
                file.get_nowait()

        # 2) La fenêtre aveugle. Le proxy tombe sous NOTRE abonnement ; l'autre
        #    worker, lui, parle directement à Redis et publie pendant ce temps.
        proxy.stop()
        await _attendre(
            lambda: kojo_live.bus_stats()["repli"] >= 1,
            "la panne n'a jamais atteint l'abonnement : le cas ne prouverait rien",
            secondes=10.0,
        )

        autre = aioredis.from_url(url, encoding="utf-8", decode_responses=True)
        panne = 12
        for index in range(panne):
            await autre.publish(
                kojo_live.BUS_CHANNEL,
                json.dumps(
                    {
                        "o": "autre-worker",
                        "u": comptes[index % len(comptes)],
                        "e": "message",
                        "d": {"id": "perdu-%d" % index},
                    }
                ),
            )

        # 3) Le rétablissement : la reprise est DÉCLARÉE, et les flux relisent.
        proxy.start()
        await _attendre(
            lambda: kojo_live.bus_stats()["reprises"] >= 1,
            "la fenêtre sans écoute n'est pas déclarée (reprises) : la perte "
            "serait muette",
            secondes=15.0,
        )
        await _attendre(
            lambda: kojo_live.bus_stats()["resyncs"] >= 1,
            "aucune relecture n'a été demandée après la fenêtre : le client "
            "resterait avec un trou",
            secondes=10.0,
        )

        attendu = ("resync", {"motif": "bus_reprise"})
        for file in files:
            recus = []
            while not file.empty():
                recus.append(file.get_nowait())
            assert recus == [attendu], (
                "le flux a reçu %r au rétablissement : il fallait UN resync et "
                "AUCUNE des %d enveloppes de la fenêtre (le pub/sub n'a pas "
                "d'historique — prétendre les avoir livrées serait un mensonge, "
                "les omettre sans relecture serait la perte muette)"
                % (recus, panne)
            )

        # 4) Le bus est bien VIVANT après la reprise : l'événement suivant de
        #    l'autre worker arrive. Une relecture ne remplace pas un bus mort.
        await autre.publish(
            kojo_live.BUS_CHANNEL,
            json.dumps(
                {"o": "autre-worker", "u": comptes[0], "e": "message", "d": {"id": "apres"}}
            ),
        )
        await _attendre(
            lambda: not files[0].empty(),
            "l'événement publié APRÈS la reprise n'est jamais arrivé : le bus "
            "est resté sourd, la relecture n'y changerait rien",
        )
        assert files[0].get_nowait() == ("message", {"id": "apres"})

        stats = kojo_live.bus_stats()
        assert stats["reprises"] >= 1
        assert stats["resyncs"] >= 1
    finally:
        await kojo_live.stop_bus()
        kojo_live.reset_bus()
        kojo_live.reset_streams()
        proxy.stop()
        if autre is not None:
            try:
                await autre.aclose()
            except Exception:  # noqa: BLE001 - fermeture best-effort du banc
                pass


@pytest.mark.asyncio
async def test_un_canal_calme_n_est_pas_une_coupure(monkeypatch):
    """Le SILENCE n'est pas une panne — mesuré, pas supposé.

    Le client Redis du bus a un `socket_timeout` de 2 s. `pubsub.listen()` le
    subit : sur un canal CALME (aucun événement), il lève un `TimeoutError`
    toutes les 2 s. L'abonnement se rompait donc toutes les 2,2 s et restait
    sourd pendant la reprise — près de la MOITIÉ du temps, au repos — et avec
    la réparation en place, chaque rupture aurait déclenché sa relecture :
    mesuré le 19/10/2026, c'est le défaut que ce cas garde.

    Il attend PLUS LONG que l'inactivité du client (le délai est LU dans le
    produit, jamais recopié) et exige qu'AUCUNE coupure n'ait été comptée. Le
    canal doit ensuite encore livrer : une connexion gardée mais morte ne
    passerait pas pour un calme.
    """
    url = _exiger_redis()
    aioredis = pytest.importorskip(
        "redis.asyncio", reason="prémisse (aucun verdict rendu ici) : redis-py absent"
    )
    monkeypatch.setenv("REDIS_URL", url)
    assert await kojo_live.start_bus(), (
        "le bus n'a pas démarré contre le VRAI Redis (%s) : rien n'est jugé" % url
    )
    autre = None
    try:
        queue = kojo_live.subscribe("compte-calme")
        await _attendre(
            lambda: kojo_live.bus_stats()["ecoutes"] >= 1,
            "la souscription n'a jamais été établie",
        )

        # Plus long que la fenêtre d'inactivité du client, dérivée du produit.
        await asyncio.sleep(kojo_live.BUS_READ_TIMEOUT_SECONDS + 0.75)

        stats = kojo_live.bus_stats()
        assert stats["repli"] == 0, (
            "%d coupure(s) comptée(s) sur un canal CALME : la lecture expirait "
            "et l'abonnement se rompait au repos (le défaut du `listen`)"
            % stats["repli"]
        )
        assert stats["ecoutes"] == 1, (
            "%d souscription(s) pour une seule fenêtre de silence : "
            "l'abonnement a été rouvert inutilement" % stats["ecoutes"]
        )
        assert stats["reprises"] == 0, "un canal calme a été déclaré fenêtre sans écoute"

        # La connexion gardée LIVRE encore : un silence n'a rien cassé.
        autre = aioredis.from_url(url, encoding="utf-8", decode_responses=True)
        await autre.publish(
            kojo_live.BUS_CHANNEL,
            json.dumps(
                {"o": "autre-worker", "u": "compte-calme", "e": "message", "d": {"id": "vif"}}
            ),
        )
        await _attendre(
            lambda: not queue.empty(),
            "après le silence, l'événement n'arrive plus : la connexion a été "
            "perdue sans être comptée",
        )
        assert queue.get_nowait() == ("message", {"id": "vif"})
    finally:
        await kojo_live.stop_bus()
        kojo_live.reset_bus()
        kojo_live.reset_streams()
        if autre is not None:
            try:
                await autre.aclose()
            except Exception:  # noqa: BLE001 - fermeture best-effort du banc
                pass


def test_le_workflow_lance_ce_fichier_avec_un_vrai_redis():
    """Un test que personne ne lance est un silence — celui-là se déclare lancé.

    Ce cas tourne dans la suite principale : il ne demande ni Redis ni base. Il
    vérifie que l'étape qui porte déjà la traversée du bus lance AUSSI ce
    fichier, avec `TEST_REDIS_URL` posé et sans soupape : sinon le fichier
    s'inapplicabiliserait dans la suite principale, et le job resterait vert
    alors que plus rien ne garde la perte en vol.
    """
    assert CI.exists(), "workflow introuvable : %s" % CI
    with open(CI, "r", encoding="utf-8", newline="") as flux:
        texte = flux.read()
    lignes = texte.splitlines()
    assert len(lignes) >= MIN_LIGNES_CI, (
        "lecture suspecte de %s (%d lignes, plancher %d) : le lecteur est cassé, "
        "il ne peut rien verrouiller." % (CI.name, len(lignes), MIN_LIGNES_CI)
    )

    commandes = [
        index
        for index, ligne in enumerate(lignes)
        if "python -m pytest" in ligne and COMPAGNON in ligne
    ]
    assert len(commandes) == 1, (
        "attendu exactement une commande lançant %s, trouvé %d : l'étape du bus "
        "a disparu ou a été dupliquée." % (COMPAGNON, len(commandes))
    )
    commande = lignes[commandes[0]]
    assert FICHIER in commande, (
        "l'étape qui lance %s ne lance pas %s : le fichier se déclarerait "
        "inapplicable dans la suite principale, et la perte en vol ne serait "
        "plus gardée nulle part." % (COMPAGNON, FICHIER)
    )

    # L'environnement de l'étape : le mandat posé, et aucune soupape.
    debut = commandes[0]
    while debut > 0 and not lignes[debut].lstrip().startswith("- name:"):
        debut -= 1
    etape = "\n".join(lignes[debut : commandes[0] + 1])
    assert "TEST_REDIS_URL" in etape, (
        "l'étape qui lance %s ne pose pas TEST_REDIS_URL : le fichier se "
        "déclarerait inapplicable et le job resterait vert sans preuve."
        % FICHIER
    )
    assert "continue-on-error" not in etape, (
        "l'étape qui garde la perte en vol est tolérante à l'échec : elle ne "
        "garderait plus rien."
    )
    assert "|| true" not in commande, "la commande de l'étape est neutralisée (|| true)."
