#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Combien coûte le repli `resync` quand Redis bat de l'aile ? Ce banc le MESURE.

DEUX QUESTIONS, ET POURQUOI ELLES NE SE MESURENT PAS PAREIL
------------------------------------------------------------
1. **Combien de relectures par minute ?** Un `resync` est une TRAME par flux
   local (`_diffuser_resync`), et chaque flux relit ensuite sa source de
   vérité — 400 flux, c'est 400 relectures d'un coup. Leur CADENCE est bornée
   par `RESYNC_MIN_INTERVAL_SECONDS` dans le produit : ce banc la COMPTE, il ne
   la recalcule pas. On fait battre un Redis réel (arrêt et reprise du socket,
   cf. `mesure_panne_redis.RedisQuiTombe`) devant 400 flux, et on lit
   `bus_stats()['resyncs']` et les trames réellement déposées.
2. **Quel effet sur le p99 des requêtes ?** Le coût du fan-out lui-même est
   minuscule (400 `put_nowait` synchrones) ; le coût RÉEL est côté clients :
   les 400 relectures partent en même temps, contre l'API. On rejoue cette
   RAFALE contre le VRAI `server.app` (`serveur_mesure.py`, base en mémoire à
   latence simulée), sous une charge constante, et on compare le p99 des
   requêtes stables avant / pendant.

CE QUE CE BANC NE MESURE PAS (écrit, pas tu)
--------------------------------------------
  * Le temps de relecture côté NAVIGATEUR (rendu, parsing) : on mesure les
    requêtes HTTP que la relecture produit, pas leur peinture.
  * Le RTT d'un vrai Redis : la panne est un VRAI arrêt de socket, mais le
    serveur pub/sub est celui du banc (il ne fait que transporter le canal).
  * Le débit absolu : générateur et serveur partagent la machine, donc le p99
    est PESSIMISTE. La comparaison avant/après reste, elle, valable.

    cd backend && python scripts/charge/mesure_resync.py
    python scripts/charge/mesure_resync.py --duree 180 --sans-http

La durée du flap doit couvrir PLUSIEURS fois le plancher de relecture
(`RESYNC_MIN_INTERVAL_SECONDS`) : à 30 s, une fenêtre de 60 s ne montre que
deux relectures, et le taux mesuré serait celui de l'échantillon, pas du
produit. `--sans-http` garde la seule cadence (le coût de la rafale, lui, se
mesure avec `--http-seul`).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402

import kojo_live  # noqa: E402

SORTIE = Path(__file__).resolve().parent / "resultats"


def percentile(valeurs, p: float) -> float:
    if not valeurs:
        return 0.0
    rang = max(0, min(len(valeurs) - 1, int(round((p / 100.0) * (len(valeurs) - 1)))))
    return valeurs[rang]


def resume(latences) -> dict:
    triees = sorted(latences)
    return {
        "requetes": len(triees),
        "p50_ms": round(percentile(triees, 50) * 1000, 1),
        "p95_ms": round(percentile(triees, 95) * 1000, 1),
        "p99_ms": round(percentile(triees, 99) * 1000, 1),
        "max_ms": round((triees[-1] if triees else 0.0) * 1000, 1),
    }


# ---------------------------------------------------------------------------
# 1. Les relectures : un Redis qui bat de l'aile devant 400 flux
# ---------------------------------------------------------------------------


async def mesurer_bus(duree: float, panne: float, retour: float, flux: int) -> dict:
    """Fait battre Redis et compte les fenêtres aveugles et les relectures.

    Le débit de publication est volontairement BAS (5 évt/s) : la question est
    la CADENCE des relectures, pas la tenue du tampon (c'est
    `mesure_panne_redis.py`). Un débit élevé ajouterait du bruit sans changer
    le nombre de fenêtres.
    """
    from mesure_panne_redis import RedisQuiTombe

    redis = RedisQuiTombe()
    redis.start()
    os.environ["REDIS_URL"] = f"redis://127.0.0.1:{redis.port}/0"

    comptes = [f"resync-{index:04d}" for index in range(flux)]
    files = [kojo_live.subscribe(compte) for compte in comptes]
    if not await kojo_live.start_bus():
        raise RuntimeError("prémisse : le bus n'a pas démarré")

    frames = {"resync": 0, "evenement": 0}
    stop = asyncio.Event()

    def vider():
        for file in files:
            while True:
                try:
                    nom, _ = file.get_nowait()
                except asyncio.QueueEmpty:
                    break
                frames["resync" if nom == "resync" else "evenement"] += 1

    async def drainer():
        while not stop.is_set():
            vider()
            await asyncio.sleep(0.02)

    async def publier():
        index = 0
        while not stop.is_set():
            kojo_live.publish(comptes[index % flux], "notification", {"n": index})
            index += 1
            await asyncio.sleep(0.2)

    taches = [asyncio.create_task(drainer()), asyncio.create_task(publier())]
    try:
        # 1) CALME : aucune fenêtre aveugle ne doit produire de relecture.
        await asyncio.sleep(3.0)
        vider()
        calme = kojo_live.bus_stats()
        if calme["resyncs"] != 0 or calme["reprises"] != 0:
            raise RuntimeError(
                "prémisse : un canal CALME a produit %d reprise(s) / %d relecture(s) "
                "— la mesure suivante attribuerait au flap ce qui vient du repos"
                % (calme["reprises"], calme["resyncs"])
            )

        # 2) LE FLAP : arrêt réel (écoute + connexions), puis reprise.
        frames["resync"] = 0
        frames["evenement"] = 0
        avant_flap = calme["resyncs"]
        debut = time.perf_counter()
        while time.perf_counter() - debut < duree:
            redis.stop()
            await asyncio.sleep(panne)
            redis.start()
            await asyncio.sleep(retour)
        ecoule = time.perf_counter() - debut

        # Laisser la dernière reprise se réparer (elle peut être différée).
        await asyncio.sleep(kojo_live.RESYNC_MIN_INTERVAL_SECONDS + 1.0)
        vider()
        stats = kojo_live.bus_stats()

        # Ce que le PRODUIT a diffusé pendant le flap : le delta, jamais le
        # compteur absolu — sinon la mesure du fan-out ci-dessous se compterait
        # elle-même comme une relecture du produit.
        relectures = stats["resyncs"] - avant_flap
        trames_produit = frames["resync"]
        reprises = stats["reprises"]

        # 3) Le coût SYNCHRONE du fan-out : 400 dépôts sur la boucle.
        depart = time.perf_counter()
        servis = kojo_live._diffuser_resync("mesure")  # noqa: SLF001 - le banc mesure CE coût
        blocage_ms = (time.perf_counter() - depart) * 1000
        vider()

        intervalle = kojo_live.RESYNC_MIN_INTERVAL_SECONDS
        # La parité que le produit PROMET : le sondage remplacé valait 2
        # req/min par session, et une relecture vaut une requête par flux.
        # `relectures_de_fond_par_minute` est le plancher seul (une relecture
        # toutes les `intervalle`) ; le taux MESURÉ peut le dépasser d'une
        # relecture de rattrapage par rafale — c'est cette différence que le
        # rapport doit montrer, pas masquer.
        sondage_remplace = flux * 2
        return {
            "flux": flux,
            "duree_s": round(ecoule, 2),
            "panne_s": panne,
            "retour_s": retour,
            "fenetres_sans_ecoute": reprises,
            "relectures_diffusees": relectures,
            "relectures_par_minute": round(relectures / ecoule * 60, 1),
            "fenetres_par_relecture": round(reprises / max(relectures, 1), 2),
            "trames_resync_recues": trames_produit,
            "trames_resync_par_minute": round(trames_produit / ecoule * 60, 1),
            "requetes_de_relecture_par_minute": round(trames_produit / ecoule * 60, 1),
            "sondage_remplace_par_minute": sondage_remplace,
            "relectures_de_fond_par_minute": round(60.0 / intervalle, 1),
            "parite_vs_sondage": round(
                (trames_produit / ecoule * 60) / max(sondage_remplace, 1), 2
            ),
            "evenements_locaux": frames["evenement"],
            "plafond_theorique_de_la_fenetre": int(ecoule / intervalle) + 2,
            "fan_out": {
                "flux_servis": servis,
                "blocage_boucle_ms": round(blocage_ms, 3),
                "microsecondes_par_flux": round(blocage_ms * 1000 / max(servis, 1), 2),
            },
            "compteurs": stats,
        }
    finally:
        stop.set()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await kojo_live.stop_bus()
        kojo_live.reset_bus()
        kojo_live.reset_streams()
        redis.stop()
        # Le serveur de mesure est un PROCESSUS enfant : il hérite de
        # l'environnement. Lui laisser un `REDIS_URL` mort le ferait démarrer
        # sur un bus injoignable (et la sonde de santé ne serait qu'un symptôme).
        os.environ.pop("REDIS_URL", None)


# ---------------------------------------------------------------------------
# 2. La rafale des relectures : effet sur le p99 sous charge constante
# ---------------------------------------------------------------------------


async def attendre_sante(base: str, delai: float = 120.0) -> None:
    limite = time.perf_counter() + delai
    async with httpx.AsyncClient(timeout=3.0) as client:
        while time.perf_counter() < limite:
            try:
                reponse = await client.get(base + "/api/health")
                if reponse.status_code < 500:
                    return
            except Exception:
                pass
            await asyncio.sleep(0.5)
    raise RuntimeError("prémisse : le serveur de mesure n'a pas répondu à /api/health")


async def jeton_reel(base: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        reponse = await client.post(
            base + "/api/auth/login",
            json={"email": "user1@mesure.kojo", "password": "password123"},
        )
        reponse.raise_for_status()
        donnees = reponse.json()
        jeton = donnees.get("access_token") or donnees.get("token")
        if not jeton:
            raise RuntimeError("prémisse : pas de jeton dans la réponse de login")
        return jeton


def requetes_stables(entetes: dict):
    """Le mélange d'un utilisateur réel — le même que `mesure_charge.py`."""
    return (
        [("GET", "/api/jobs?status=open&limit=50", None, {})] * 3
        + [("GET", "/api/jobs/job-7", None, {})] * 2
        + [("GET", "/api/auth/me", None, entetes)] * 2
        + [("GET", "/api/notifications/unread-count", None, entetes)] * 2
        + [("GET", "/api/health", None, {})] * 1
    )


async def travailleur(client, base, requetes, fin, latences, depart):
    index = depart
    while time.perf_counter() < fin:
        methode, chemin, corps, entetes = requetes[index % len(requetes)]
        index += 1
        debut = time.perf_counter()
        try:
            await client.request(methode, base + chemin, json=corps, headers=entetes)
        except Exception:
            pass
        latences.append(time.perf_counter() - debut)


async def rafale_de_relecture(base: str, entetes: dict, nombre: int) -> dict:
    """Les N relectures d'une même fenêtre, lancées ENSEMBLE.

    Le client de la sonde est distinct de celui de la charge : sans cela, ses
    connexions occuperaient le pool de la charge et le p99 mesurerait
    l'attente du GÉNÉRATEUR, pas celle du serveur.
    """
    limites = httpx.Limits(max_connections=nombre + 10, max_keepalive_connections=nombre + 10)
    latences = []
    departs = []
    statuts = {}
    async with httpx.AsyncClient(timeout=60.0, limits=limites) as client:

        async def une():
            departs.append(time.perf_counter())
            debut = departs[-1]
            try:
                reponse = await client.get(
                    base + "/api/notifications/unread-count", headers=entetes
                )
                statuts[reponse.status_code] = statuts.get(reponse.status_code, 0) + 1
            except Exception:
                statuts["reseau"] = statuts.get("reseau", 0) + 1
            latences.append(time.perf_counter() - debut)

        debut = time.perf_counter()
        await asyncio.gather(*(une() for _ in range(nombre)))
        duree = time.perf_counter() - debut
    # L'ÉTALEMENT DES DÉPARTS sépare deux causes qu'un « p50 à 9 s » confond :
    # si les requêtes partent étalées, c'est le GÉNÉRATEUR qui plafonne ; si
    # elles partent toutes dans la première seconde, c'est le SERVEUR qui fait
    # la queue et le chiffre est un coût produit.
    etalement = (max(departs) - min(departs)) if departs else 0.0
    return {
        "duree_s": round(duree, 3),
        "etalement_des_departs_s": round(etalement, 3),
        "statuts": statuts,
        **resume(latences),
    }


async def mesurer_http(
    port: int,
    concurrence: int,
    phase: float,
    rafale: int,
    intervalle: float,
    controle_seul: bool = False,
) -> dict:
    """Deux phases : charge seule, puis la MÊME charge + les RAFALES de relecture."""
    base = f"http://127.0.0.1:{port}"
    journal = Path(tempfile.gettempdir()) / f"serveur-mesure-{port}.log"
    environnement = {cle: valeur for cle, valeur in os.environ.items() if cle != "REDIS_URL"}
    with journal.open("w", encoding="utf-8", errors="replace") as sortie:
        serveur = subprocess.Popen(
            [
                sys.executable,
                "scripts/charge/serveur_mesure.py",
                "--port",
                str(port),
                "--users",
                "4000",
                "--jobs",
                "300",
                "--notifications",
                "2000",
                "--bus",
                "memoire",
            ],
            cwd=str(BACKEND),
            stdout=sortie,
            stderr=subprocess.STDOUT,
            env=environnement,
        )
    try:
        try:
            await attendre_sante(base)
        except RuntimeError:
            code = serveur.poll()
            queue = journal.read_text(encoding="utf-8", errors="replace")[-2000:]
            raise RuntimeError(
                "prémisse : serveur de mesure muet (code %s) — journal %s\n%s"
                % (code, journal, queue)
            ) from None
        jeton = await jeton_reel(base)
        entetes = {"Authorization": f"Bearer {jeton}"}
        requetes = requetes_stables(entetes)

        async def phase_charge(duree: float, rafales: bool) -> dict:
            latences = []
            rafales_mesurees = []
            limites = httpx.Limits(max_connections=concurrence * 2 + 20)
            async with httpx.AsyncClient(timeout=60.0, limits=limites) as client:
                fin = time.perf_counter() + duree
                taches = [
                    asyncio.create_task(
                        travailleur(client, base, requetes, fin, latences, index)
                    )
                    for index in range(concurrence)
                ]
                if rafales:
                    suivant = time.perf_counter() + 2.0
                    while suivant < fin:
                        reste = suivant - time.perf_counter()
                        if reste > 0:
                            await asyncio.sleep(reste)
                        rafales_mesurees.append(
                            await rafale_de_relecture(base, entetes, rafale)
                        )
                        suivant += intervalle
                await asyncio.gather(*taches)
            return {"charge": resume(latences), "rafales": rafales_mesurees}

        # Échauffement : les premières requêtes paient les imports et les pools.
        await phase_charge(3.0, rafales=False)

        if controle_seul:
            controle = await rafale_de_relecture(base, entetes, rafale)
            return {
                "base": base,
                "rafale": rafale,
                "controle_seul": True,
                "rafale_serveur_au_repos": controle,
            }

        seule = await phase_charge(phase, rafales=False)
        avec = await phase_charge(phase * 1.2, rafales=True)

        # Contrôle : la MÊME rafale, serveur au repos. Sans lui, un p99 qui
        # explose sous charge ne dit pas si c'est la rafale ou la charge.
        controle = await rafale_de_relecture(base, entetes, rafale)
        return {
            "base": base,
            "concurrence": concurrence,
            "rafale": rafale,
            "intervalle_rafale_s": intervalle,
            "phase_sans_relectures": seule,
            "phase_avec_relectures": avec,
            "rafale_serveur_au_repos": controle,
            "p99_delta_ms": round(
                avec["charge"]["p99_ms"] - seule["charge"]["p99_ms"], 1
            ),
            "p99_rafale_sous_charge_ms": (
                avec["rafales"][0]["p99_ms"] if avec["rafales"] else None
            ),
        }
    finally:
        serveur.terminate()
        try:
            serveur.wait(timeout=15)
        except subprocess.TimeoutExpired:
            serveur.kill()


# ---------------------------------------------------------------------------


async def principal() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument(
        "--duree",
        type=float,
        default=180.0,
        help="durée du flap (s) — plusieurs fois le plancher de relecture",
    )
    parseur.add_argument("--panne", type=float, default=2.0)
    parseur.add_argument("--retour", type=float, default=2.0)
    parseur.add_argument("--flux", type=int, default=None)
    parseur.add_argument("--sans-http", action="store_true")
    parseur.add_argument("--http-seul", action="store_true")
    parseur.add_argument(
        "--controle-seul",
        action="store_true",
        help="ne mesurer QUE l'étalement des départs d'une rafale, serveur au repos "
        "(sépare la limite du générateur de celle du serveur)",
    )
    parseur.add_argument("--port", type=int, default=8991)
    parseur.add_argument("--concurrence", type=int, default=40)
    parseur.add_argument(
        "--phase",
        type=float,
        default=None,
        help="durée d'une phase de charge (défaut : de quoi contenir 3 rafales "
        "au rythme du produit, jamais moins de 20 s)",
    )
    parseur.add_argument("--rafale", type=int, default=None)
    args = parseur.parse_args()

    flux = args.flux if args.flux is not None else int(kojo_live.MAX_STREAMS_TOTAL)
    rafale = args.rafale if args.rafale is not None else flux
    intervalle = kojo_live.RESYNC_MIN_INTERVAL_SECONDS
    # La phase « avec relectures » dure `phase × 1,2` et sa première rafale part
    # à +2 s : il lui faut au moins 2 `intervalle` pour contenir TROIS rafales.
    # La durée se DÉRIVE du plancher du produit, elle n'est pas recopiée : à
    # 30 s, garder 20 s ne mesurerait qu'une rafale, et le p99 comparerait deux
    # fenêtres de nature différente.
    phase = args.phase if args.phase is not None else max(20.0, 2.2 * intervalle)

    rapport = {
        "horodatage": datetime.now().isoformat(timespec="seconds"),
        "produit": {
            "flux": flux,
            "repli_s": kojo_live.RESYNC_MIN_INTERVAL_SECONDS,
            "panne_s": args.panne,
            "retour_s": args.retour,
        },
    }
    if args.controle_seul:
        rapport["http"] = await mesurer_http(
            args.port, args.concurrence, phase, rafale, intervalle, controle_seul=True
        )
    else:
        if not args.http_seul:
            rapport["bus"] = await mesurer_bus(args.duree, args.panne, args.retour, flux)
        if not args.sans_http:
            rapport["http"] = await mesurer_http(
                args.port, args.concurrence, phase, rafale, intervalle
            )

    print(json.dumps(rapport, indent=2, ensure_ascii=False))
    SORTIE.mkdir(exist_ok=True)
    chemin = SORTIE / f"resync-{datetime.now().strftime('%H%M%S')}.json"
    chemin.write_text(json.dumps(rapport, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n→ {chemin}")

    if args.controle_seul:
        return 0

    if "http" in rapport:
        http = rapport["http"]
        print(
            "✅ p99 stable : %s ms sans relectures, %s ms avec — écart %s ms ; "
            "rafale au repos %.2f s (départs étalés sur %.2f s)"
            % (
                http["phase_sans_relectures"]["charge"]["p99_ms"],
                http["phase_avec_relectures"]["charge"]["p99_ms"],
                http["p99_delta_ms"],
                http["rafale_serveur_au_repos"]["duree_s"],
                http["rafale_serveur_au_repos"]["etalement_des_departs_s"],
            ),
            flush=True,
        )

    if "bus" not in rapport:
        return 0

    bus = rapport["bus"]
    if bus["relectures_diffusees"] == 0:
        print("❌ prémisse : aucune relecture mesurée pendant le flap — rien à conclure")
        return 2
    print(
        "✅ %d fenêtre(s) sans écoute → %d relecture(s) en %.1f s, soit %.1f/min "
        "(1 fenêtre sur %.1f relue), %d trames `resync` reçues (%.1f/min) — "
        "sondage remplacé %d/min, parité %.2f× (plancher seul %.1f/min)"
        % (
            bus["fenetres_sans_ecoute"],
            bus["relectures_diffusees"],
            bus["duree_s"],
            bus["relectures_par_minute"],
            bus["fenetres_par_relecture"],
            bus["trames_resync_recues"],
            bus["trames_resync_par_minute"],
            bus["sondage_remplace_par_minute"],
            bus["parite_vs_sondage"],
            bus["relectures_de_fond_par_minute"],
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(principal()))
    except KeyboardInterrupt:
        sys.exit(130)
