#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le bus perd-il quelque chose quand Redis tombe ? Ce banc le MESURE.

LA PROMESSE JUGÉE

Un événement publié est d'abord déposé dans les files LOCALES (aucune I/O) ;
s'il y a un `REDIS_URL`, il est ensuite proposé à un tampon borné
(`KOJO_LIVE_BUS_QUEUE`, 1000) que la tâche `_publieur` vide vers le canal. La
panne visée n'est donc pas « Redis est lent » mais « Redis ne répond plus
pendant la fenêtre de reconnexion » (`KOJO_LIVE_BUS_RECONNECT_SECONDS`, 2 s) :
le tampon doit ENCAISSER la rafale de cette fenêtre au débit que le contrat
désigne (`MAX_STREAMS_TOTAL × délai × 1 évt/s`, soit 400 × 2 = 800 enveloppes)
sans en perdre une seule — sinon allonger la fenêtre sans agrandir la file
déplacerait la panne au lieu de la corriger (cf. la sonde Fly).

CE QUE CE BANC MESURE, ET COMMENT

  * 400 flux locaux (un compte chacun : le plafond par compte est 4), donc
    chaque `publish` sert UN flux et produit UNE enveloppe — c'est le modèle
    exact du contrat ;
  * un serveur Redis pub/sub RÉEL au sens du transport : un socket TCP, des
    connexions, des timeouts, `ConnectionError` et la reprise de redis-py. Il
    n'implémente que les commandes du bus (`SUBSCRIBE`, `PUBLISH`, `PING`,
    `CLIENT`) ; c'est déclaré ici : ce n'est pas Redis, c'est le RÉSEAU et le
    CLIENT qui sont réels (un double en mémoire rendrait la panne par un
    `raise`, ce qui ne mesure pas la reprise) ;
  * la panne est un VRAI arrêt : le serveur ferme son écoute ET toutes ses
    connexions, puis réécoute — un `publish` reçoit alors `ConnectionRefused`
    comme d'une machine morte ;
  * pendant la fenêtre, on publie au débit du contrat (400 évt/s pendant 2 s),
    puis on attend la reprise et le vidage du tampon.

LE VERDICT

  * `enveloppes = bus_recues + perdues` — TOUTE enveloppe non parvenue au bus
    doit être COMPTÉE (`bus_stats()['perdus']`). Un écart est une perte muette,
    et une perte muette est le défaut, quelle qu'en soit la taille ;
  * au débit du contrat, `perdues == 0` ET `pertes_muettes == 0` : la file n'a
    rien perdu de la fenêtre ;
  * les événements LOCAUX ne sont jamais perdus (le flux du process qui publie
    n'attend pas Redis) : `locaux == enveloppes` est exigé aussi.

Le code de sortie le dit : 0 = contrat tenu, 1 = perte mesurée (nommée), 2 =
prémisse (rien n'a pu être mesuré).

    cd backend && python scripts/charge/mesure_panne_redis.py
    # exploration hors contrat (la file de 1000 ne peut pas tenir 2 s à 900/s) :
    python scripts/charge/mesure_panne_redis.py --debit 900
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import socketserver
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import kojo_live  # noqa: E402

SORTIE = Path(__file__).resolve().parent / "resultats"


# ---------------------------------------------------------------------------
# Un serveur Redis pub/sub minimal, sur un VRAI socket
# ---------------------------------------------------------------------------


class _Abonne:
    """Une connexion abonnée : son socket et le verrou qui la protège.

    Les messages arrivent depuis le thread du PUBLIEUR, pas du sien : deux
    écritures concurrentes sur le même socket entrelaceraient deux trames RESP
    et le client lirait du bruit. Un verrou par connexion, c'est le serveur
    Redis lui-même qui l'impose.
    """

    def __init__(self, connexion: socket.socket):
        self.connexion = connexion
        self.verrou = threading.Lock()
        self.canaux: set[str] = set()

    def envoyer(self, charge: bytes) -> None:
        with self.verrou:
            self.connexion.sendall(charge)


class _ServeurPubSub(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, port: int = 0):
        self.abonnes: list[_Abonne] = []
        self.connexions: list[socket.socket] = []
        self.publications: list[tuple[float, str, str]] = []
        self.verrou = threading.Lock()
        super().__init__(("127.0.0.1", port), _Gestionnaire)

    @property
    def port(self) -> int:
        return self.server_address[1]

    def enregistrer(self, connexion: socket.socket) -> None:
        with self.verrou:
            self.connexions.append(connexion)


class _Gestionnaire(socketserver.StreamRequestHandler):
    """RESP2, les quatre commandes que le bus emploie réellement."""

    def _lire_commande(self):
        ligne = self.rfile.readline()
        if not ligne:
            return None
        if not ligne.startswith(b"*"):
            return [ligne.strip()]
        try:
            nombre = int(ligne[1:].strip())
        except ValueError:
            return None
        morceaux = []
        for _ in range(nombre):
            entete = self.rfile.readline()
            if not entete.startswith(b"$"):
                return None
            try:
                taille = int(entete[1:].strip())
            except ValueError:
                return None
            morceaux.append(self.rfile.read(taille))
            self.rfile.read(2)  # CRLF
        return morceaux

    def _repondre(self, charge: bytes) -> None:
        self.wfile.write(charge)
        self.wfile.flush()

    def handle(self):  # noqa: C901 - un routeur de commandes, pas une règle
        serveur: _ServeurPubSub = self.server  # type: ignore[assignment]
        serveur.enregistrer(self.connection)
        abonne = _Abonne(self.connection)
        try:
            while True:
                commande = self._lire_commande()
                if not commande:
                    return
                nom = commande[0].decode("utf-8", "replace").upper()
                if nom == "CLIENT":
                    self._repondre(b"+OK\r\n")
                elif nom == "PING":
                    self._repondre(b"+PONG\r\n")
                elif nom == "SELECT":
                    self._repondre(b"+OK\r\n")
                elif nom in ("SUBSCRIBE", "UNSUBSCRIBE"):
                    canal = (commande[1] if len(commande) > 1 else b"").decode(
                        "utf-8", "replace"
                    )
                    if nom == "SUBSCRIBE":
                        with serveur.verrou:
                            serveur.abonnes.append(abonne)
                        abonne.canaux.add(canal)
                    else:
                        abonne.canaux.discard(canal)
                    trame = (
                        ("*3\r\n$%d\r\n%s\r\n$%d\r\n%s\r\n:%d\r\n")
                        % (
                            len(nom.lower()),
                            nom.lower(),
                            len(canal.encode("utf-8")),
                            canal,
                            1 if abonne.canaux else 0,
                        )
                    ).encode("utf-8")
                    self._repondre(trame)
                elif nom == "PUBLISH":
                    canal = commande[1].decode("utf-8", "replace")
                    charge = commande[2].decode("utf-8", "replace")
                    with serveur.verrou:
                        serveur.publications.append((time.time(), canal, charge))
                        destinataires = [
                            a for a in serveur.abonnes if canal in a.canaux
                        ]
                    trame = (
                        "*3\r\n$7\r\nmessage\r\n$%d\r\n%s\r\n$%d\r\n%s\r\n"
                        % (
                            len(canal.encode("utf-8")),
                            canal,
                            len(charge.encode("utf-8")),
                            charge,
                        )
                    ).encode("utf-8")
                    for destinataire in destinataires:
                        try:
                            destinataire.envoyer(trame)
                        except OSError:
                            pass
                    self._repondre(b":%d\r\n" % len(destinataires))
                elif nom == "QUIT":
                    self._repondre(b"+OK\r\n")
                    return
                else:
                    self._repondre(
                        b"-ERR commande inconnue de ce banc\r\n"
                    )
        except (ConnectionError, OSError):
            return


class RedisQuiTombe:
    """Un Redis qui s'arrête VRAIMENT (écoute et connexions fermées), puis revient.

    `stop()` ferme l'écouteur ET les sockets ouvertes : sans cela, redis-py
    réutiliserait sa connexion existante et ne verrait jamais la panne — le
    banc mesurerait une panne qui n'a pas eu lieu.
    """

    def __init__(self, port: int = 0):
        self.port = port
        self._serveur: _ServeurPubSub | None = None
        self._fil: threading.Thread | None = None
        # Les publications des serveurs déjà arrêtés : une mesure ne doit pas
        # perdre ce qui a été reçu avant la panne (le témoin).
        self._historique: list[tuple[float, str, str]] = []

    @property
    def actif(self) -> bool:
        return self._serveur is not None

    @property
    def publications(self) -> list[tuple[float, str, str]]:
        """TOUTES les publications depuis le début, serveurs successifs compris.

        Le compteur doit être CUMULATIF : après une reprise, le nouveau serveur
        repart d'une liste vide, et comparer son total au relevé d'avant la
        panne soustrayait le témoin une seconde fois — la mesure aurait
        annoncé 399 reçues là où 799 l'étaient.
        """
        serveur = self._serveur
        if serveur is None:
            return list(self._historique)
        return list(self._historique) + list(serveur.publications)

    def start(self) -> None:
        serveur = _ServeurPubSub(self.port)
        self.port = serveur.port
        self._serveur = serveur
        self._fil = threading.Thread(target=serveur.serve_forever, daemon=True)
        self._fil.start()

    def stop(self) -> None:
        serveur = self._serveur
        if serveur is None:
            return
        self._historique.extend(serveur.publications)
        self._serveur = None
        serveur.shutdown()
        serveur.server_close()
        with serveur.verrou:
            connexions = list(serveur.connexions)
        for connexion in connexions:
            try:
                connexion.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connexion.close()
            except OSError:
                pass
        if self._fil is not None:
            self._fil.join(timeout=5)
            self._fil = None


# ---------------------------------------------------------------------------
# La charge
# ---------------------------------------------------------------------------


async def publier(kojo_live, comptes, par_seconde: float, nombre: int) -> None:
    """Publie `nombre` enveloppes à `par_seconde`, réparties sur les comptes.

    Le chemin est celui du produit (`kojo_live.publish`) : le dépôt local, puis
    la proposition au bus. La cadence est tenue par une échéance absolue (pas
    un `sleep` par événement), sinon la mesure dériverait dès le premier appel
    lent — et c'est justement une panne de Redis que l'on mesure.
    """
    periode = 1.0 / par_seconde
    debut = time.perf_counter()
    for index in range(nombre):
        kojo_live.publish(comptes[index % len(comptes)], "notification", {"n": index})
        suivant = debut + (index + 1) * periode
        retard = suivant - time.perf_counter()
        if retard > 0:
            await asyncio.sleep(retard)


async def attendre_vidage(kojo_live, secondes: float) -> None:
    """Attend que le tampon soit vidé ET que les compteurs cessent de bouger.

    Un tampon vide ne suffit pas : la publication EN VOL (une enveloppe déjà
    retirée) n'est pas encore comptée, et mesurer maintenant la déclarerait
    perdue. On attend donc une condition stable : file vide, `publies` et
    `perdus` identiques sur quatre relevés consécutifs (200 ms).
    """
    limite = time.perf_counter() + secondes
    dernier = None
    stable = 0
    while time.perf_counter() < limite:
        file = kojo_live._bus_file  # noqa: SLF001 - le banc mesure CE tampon
        stats = kojo_live.bus_stats()
        etat = (file.qsize() if file is not None else 0, stats["publies"], stats["perdus"])
        if etat == dernier and etat[0] == 0:
            stable += 1
            if stable >= 4:
                return
        else:
            stable = 0
        dernier = etat
        await asyncio.sleep(0.05)
    raise TimeoutError(
        "le bus n'a pas fini de publier en %.1f s (dernier état : %r)"
        % (secondes, dernier)
    )


def _vider_files(files):
    """Compte les ÉVÉNEMENTS livrés localement et les RELECTURES demandées.

    Une relecture de réparation (`resync`) est une TRAME, pas un événement : la
    compter comme un événement ferait croire à une livraison en trop. Les deux
    sont mesurées, et séparément : la première prouve que la panne du bus n'a
    pas privé le process de son propre flux, la seconde que la fenêtre sans
    écoute a bien été réparée pour chaque flux.
    """
    evenements = 0
    resyncs = 0
    for file in files:
        while not file.empty():
            nom = file.get_nowait()[0]
            if nom == "resync":
                resyncs += 1
            else:
                evenements += 1
    return evenements, resyncs


async def principal() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    # Les valeurs du contrat sont LUES dans le produit, jamais recopiées : si
    # `MAX_STREAMS_TOTAL` ou le délai de reprise changent, le débit et la
    # fenêtre du banc suivent — sinon il mesurerait une autre machine.
    parseur.add_argument(
        "--debit", type=float, default=None,
        help="enveloppes publiées par seconde (défaut : MAX_STREAMS_TOTAL)",
    )
    parseur.add_argument(
        "--duree-panne", type=float, default=None,
        help="durée de la panne (défaut : un délai de reprise)",
    )
    parseur.add_argument("--duree-temoin", type=float, default=1.0)
    parseur.add_argument("--marge", type=float, default=15.0,
                         help="attente maximale de la reprise + vidage")
    args = parseur.parse_args()

    redis = RedisQuiTombe()
    redis.start()
    os.environ["REDIS_URL"] = f"redis://127.0.0.1:{redis.port}/0"

    flux = int(kojo_live.MAX_STREAMS_TOTAL)
    args.debit = args.debit if args.debit is not None else float(flux)
    args.duree_panne = (
        args.duree_panne if args.duree_panne is not None
        else kojo_live.BUS_RECONNECT_SECONDS
    )
    comptes = [f"compte-{index:04d}" for index in range(flux)]
    files = [kojo_live.subscribe(compte) for compte in comptes]

    if not await kojo_live.start_bus():
        print("❌ prémisse : le bus n'a pas démarré (client Redis refusé)", flush=True)
        return 2

    try:
        # 1) Témoin : le même débit SANS panne — sans lui, une perte mesurée
        #    pendant la panne pourrait n'être que le régime normal du banc.
        temoin = int(args.debit * args.duree_temoin)
        await publier(kojo_live, comptes, args.debit, temoin)
        await attendre_vidage(kojo_live, args.marge)
        apres_temoin = len(redis.publications)
        if apres_temoin != temoin:
            print(
                f"❌ prémisse : le témoin n'est pas passé ({apres_temoin}/{temoin} "
                "enveloppes au bus) — la mesure suivante ne mesurerait pas la panne",
                flush=True,
            )
            return 2

        # 2) Panne : Redis s'arrête AVANT la première enveloppe, et revient à la
        #    fin de la fenêtre. C'est la fenêtre de reconnexion du contrat.
        redis.stop()
        enveloppes = int(args.debit * args.duree_panne)
        debut_panne = time.perf_counter()
        await publier(kojo_live, comptes, args.debit, enveloppes)
        duree_reelle = time.perf_counter() - debut_panne
        redis.start()
        await attendre_vidage(kojo_live, args.marge)

        recues = len(redis.publications) - apres_temoin
        stats = kojo_live.bus_stats()
        local, relectures = _vider_files(files)
        perdues = stats["perdus"]
        muettes = enveloppes - recues - perdues
        hors_contrat = enveloppes > kojo_live.BUS_QUEUE_SIZE

        rapport = {
            "horodatage": datetime.now().isoformat(timespec="seconds"),
            "bus": {
                "file": kojo_live.BUS_QUEUE_SIZE,
                "reprise_s": kojo_live.BUS_RECONNECT_SECONDS,
                "flux": len(files),
                "budget_du_contrat": flux * kojo_live.BUS_RECONNECT_SECONDS,
            },
            "temoin": {
                "enveloppes": temoin,
                "bus_recues": apres_temoin,
                "perdues": 0,
            },
            "panne": {
                "enveloppes_envoyees": enveloppes,
                "debit_demande": args.debit,
                "duree_demandee_s": args.duree_panne,
                "duree_reelle_s": round(duree_reelle, 3),
                "bus_recues": recues,
                "comptees_perdues": perdues,
                "pertes_muettes": muettes,
                "local_livres": local,
                "relectures": relectures,
                "hors_contrat": hors_contrat,
            },
            "compteurs": stats,
        }
        print(json.dumps(rapport, indent=2, ensure_ascii=False))

        SORTIE.mkdir(exist_ok=True)
        chemin = SORTIE / f"panne-redis-{datetime.now().strftime('%H%M%S')}.json"
        chemin.write_text(json.dumps(rapport, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n→ {chemin}")

        echecs = []
        total_envoyes = temoin + enveloppes
        if local != total_envoyes:
            echecs.append(
                f"les flux LOCAUX ont livré {local}/{total_envoyes} (témoin + "
                "panne) : la panne du bus a privé le process de son propre flux"
            )
        if relectures != len(files):
            echecs.append(
                f"{relectures}/{len(files)} flux ont été faits de relire après "
                "la fenêtre sans écoute : les autres resteraient avec un trou"
            )
        if muettes != 0:
            echecs.append(
                f"{muettes} enveloppe(s) ne sont ni parvenues au bus ni comptées "
                f"perdues ({enveloppes} − {recues} − {perdues}) : perte MUETTE"
            )
        if not hors_contrat and perdues != 0:
            echecs.append(
                f"{perdues} enveloppe(s) perdues pendant la fenêtre de "
                f"{kojo_live.BUS_RECONNECT_SECONDS:g} s alors que la file "
                f"({kojo_live.BUS_QUEUE_SIZE}) devait tenir les {enveloppes} du contrat"
            )
        if echecs:
            for echec in echecs:
                print(f"❌ {echec}", flush=True)
            return 1
        etat = "hors contrat (perte attendue et COMPTÉE)" if hors_contrat else "contrat tenu"
        print(
            f"✅ {etat} : {recues}/{enveloppes} enveloppes de la panne au bus, "
            f"{perdues} comptées, {muettes} muette(s), {local}/{total_envoyes} "
            f"livrées localement, {relectures}/{len(files)} flux faits de relire",
            flush=True,
        )
        return 0
    finally:
        await kojo_live.stop_bus()
        kojo_live.reset_bus()
        kojo_live.reset_streams()
        redis.stop()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(principal()))
    except KeyboardInterrupt:
        sys.exit(130)
