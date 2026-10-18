#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le push coûte-t-il moins que le sondage ? Ce banc le MESURE.

La question n'est pas « le code est-il plus joli » mais « une machine qui tient
400 connexions ouvertes sert-elle encore les autres requêtes ? ». Un flux SSE
immobile n'envoie rien : il ne devrait coûter ni CPU ni base, seulement une
entrée dans la boucle d'événements. Le sondage, lui, coûtait une requête (et
une lecture Mongo) toutes les 30 s par session.

Protocole, sur le MÊME serveur et la MÊME charge :

  1. **témoin** — K clients bouclent sur `/api/health` pendant D secondes ;
  2. **avec flux** — C connexions `GET /api/notifications/stream` sont ouvertes
     et LAISSÉES ouvertes (l'événement `ready` de chacune est attendu : une
     connexion refusée ne mesurerait rien), puis les mêmes K clients rejouent
     la MÊME charge pendant D secondes.

Ce qui doit rester stable : le débit et le p95 du témoin. Ce qui doit être nul :
les requêtes attribuées aux flux (ils n'en font aucune).

BUS PARTAGÉ (`--evenements N`) : la même phase 2 rejoue la charge pendant que
N événements par seconde sont publiés vers le compte dont les flux sont
ouverts — donc fan-out N fois par seconde. Lancée contre un serveur démarré
avec `--bus memoire`, elle mesure ce que le bus AJOUTE : encodage, dépôt,
tâche de publication, réception, décodage. Elle ne mesure pas l'aller-retour de
Redis (le double est en mémoire), et le rapport publie `etat_bus` pour qu'un
relevé qui n'aurait rien publié ne puisse pas se lire comme un coût nul.

    python scripts/charge/serveur_mesure.py --port 8990 --users 40 --jobs 20 \
        --notifications 200 --latence-ms 1
    # plafond par compte levé pour le banc (4 en production) : une seule
    # session ouvre toutes les connexions, sinon il faudrait C logins bcrypt.
    KOJO_SSE_MAX_PER_USER=2000 python scripts/charge/mesure_push.py \
        --url http://127.0.0.1:8990 --connexions 400 --clients 4 --duree 6

    # avec le bus de banc (serveur pub/sub en mémoire) et 50 événements/s :
    python scripts/charge/serveur_mesure.py --port 8991 --users 2000 --jobs 20 \
        --notifications 200 --bus memoire
    KOJO_SSE_MAX_PER_USER=2000 python scripts/charge/mesure_push.py \
        --url http://127.0.0.1:8991 --connexions 200 --clients 4 --duree 6 \
        --evenements 50
"""
import argparse
import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

import httpx

SORTIE = Path(__file__).resolve().parent / "resultats"


def percentile(valeurs, p):
    if not valeurs:
        return 0.0
    rang = max(0, min(len(valeurs) - 1, int(round((p / 100.0) * (len(valeurs) - 1)))))
    return valeurs[rang]


async def jeton_reel(base: str) -> tuple:
    """Jeton ET identifiant du compte : les événements sont adressés à LUI."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        reponse = await client.post(
            base + "/api/auth/login",
            json={"email": "user1@mesure.kojo", "password": "password123"},
        )
        reponse.raise_for_status()
        donnees = reponse.json()
        jeton = donnees.get("access_token") or donnees["token"]
        return jeton, donnees.get("user", {}).get("id")


async def charge_sante(base: str, clients: int, duree: float):
    """K clients fermés sur `/api/health` — le témoin du coût fixe."""
    mesures = []
    limites = httpx.Limits(max_connections=clients * 2, max_keepalive_connections=clients * 2)

    async def travailleur():
        async with httpx.AsyncClient(timeout=30.0, limits=limites) as client:
            fin = time.perf_counter() + duree
            while time.perf_counter() < fin:
                debut = time.perf_counter()
                try:
                    await client.get(base + "/api/health")
                except Exception:
                    pass
                mesures.append(time.perf_counter() - debut)

    debut = time.perf_counter()
    await asyncio.gather(*(travailleur() for _ in range(clients)))
    ecoule = time.perf_counter() - debut
    triees = sorted(mesures)
    return {
        "requetes": len(mesures),
        "rps": round(len(mesures) / ecoule, 1) if ecoule else 0.0,
        "p50_ms": round(percentile(triees, 50) * 1000, 1),
        "p95_ms": round(percentile(triees, 95) * 1000, 1),
        "p99_ms": round(percentile(triees, 99) * 1000, 1),
    }


async def publier_des_evenements(base: str, user_id: str, par_seconde: float, stop: asyncio.Event):
    """Publie `par_seconde` événements/s par la route de BANC, jusqu'à `stop`.

    Le chemin emprunté est celui du produit (`kojo_live.publish`) : la charge
    publie donc exactement ce que publie une notification réelle. Les requêtes
    de publication sont COMPTÉES à part dans le rapport — elles font partie de
    la charge, mais elles ne sont pas du trafic client.
    """
    envoye = 0
    periode = 1.0 / par_seconde
    async with httpx.AsyncClient(timeout=10.0) as client:
        suivant = time.perf_counter()
        while not stop.is_set():
            now = time.perf_counter()
            if now < suivant:
                await asyncio.sleep(min(suivant - now, periode))
                continue
            try:
                await client.post(
                    base + "/_mesure/publier",
                    json={"user_id": user_id, "evenements": 1},
                )
                envoye += 1
            except Exception:
                pass
            suivant += periode
    return envoye


async def tenir_flux(client, base: str, jeton: str, prets: asyncio.Queue, stop: asyncio.Event):
    """Ouvre UN flux et le garde ouvert jusqu'à `stop` ; annonce son `ready`.

    Le client HTTP est PARTAGÉ : un `AsyncClient` par flux multiplierait les
    pools et la mémoire du générateur, et la mesure décrirait le banc.
    """
    try:
        async with client.stream(
            "GET",
            base + "/api/notifications/stream",
            headers={"Authorization": f"Bearer {jeton}"},
        ) as reponse:
            if reponse.status_code != 200:
                await prets.put(("refus", reponse.status_code))
                return
            async for ligne in reponse.aiter_lines():
                if ligne.startswith("event: ready"):
                    await prets.put(("pret", 200))
                if stop.is_set():
                    return
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # réseau fermé en fin de mesure
        await prets.put(("erreur", str(exc)))


async def principal():
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--url", default="http://127.0.0.1:8990")
    parseur.add_argument("--connexions", type=int, default=400)
    parseur.add_argument("--clients", type=int, default=4)
    parseur.add_argument("--duree", type=float, default=6.0)
    parseur.add_argument(
        "--evenements",
        type=float,
        default=0.0,
        help="événements publiés par seconde vers les flux ouverts (0 = flux muets)",
    )
    args = parseur.parse_args()

    base = args.url.rstrip("/")
    jeton, user_id = await jeton_reel(base)
    print(
        f"✅ Session ouverte — {args.clients} clients, {args.duree}s par phase, "
        f"{args.evenements:g} événement(s)/s\n",
        flush=True,
    )

    print("⏳ Phase 1/2 : témoin SANS flux…", flush=True)
    temoin = await charge_sante(base, args.clients, args.duree)

    print(f"⏳ Ouverture de {args.connexions} flux SSE…", flush=True)
    prets: asyncio.Queue = asyncio.Queue()
    stop = asyncio.Event()
    client_flux = httpx.AsyncClient(
        timeout=None,
        limits=httpx.Limits(
            max_connections=args.connexions + 10,
            max_keepalive_connections=args.connexions + 10,
        ),
    )
    taches = [
        asyncio.create_task(tenir_flux(client_flux, base, jeton, prets, stop))
        for _ in range(args.connexions)
    ]
    try:
        etats = await asyncio.wait_for(
            asyncio.gather(*(prets.get() for _ in range(args.connexions))),
            timeout=90,
        )
    except asyncio.TimeoutError:
        print(f"❌ Ouverture incomplète : {prets.qsize()} flux prêts sur {args.connexions}", flush=True)
        stop.set()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await client_flux.aclose()
        raise SystemExit(1)

    ouverts = sum(1 for etat, _ in etats if etat == "pret")
    refus = [detail for etat, detail in etats if etat != "pret"]
    if ouverts != args.connexions:
        print(f"❌ {args.connexions - ouverts} flux non ouverts : {refus[:3]}", flush=True)
        stop.set()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await client_flux.aclose()
        raise SystemExit(1)
    print(f"✅ {ouverts} flux ouverts", flush=True)

    print("⏳ Phase 2/2 : même charge, flux OUVERTS…", flush=True)
    tache_publication = None
    if args.evenements > 0 and user_id:
        tache_publication = asyncio.create_task(
            publier_des_evenements(base, user_id, args.evenements, stop)
        )
    try:
        avec_flux = await charge_sante(base, args.clients, args.duree)
    finally:
        stop.set()
        publies = 0
        if tache_publication is not None:
            try:
                publies = await asyncio.wait_for(tache_publication, timeout=5)
            except asyncio.TimeoutError:
                tache_publication.cancel()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await client_flux.aclose()

    # État du bus CÔTÉ SERVEUR : un relevé qui n'a rien publié ne doit pas se
    # lire comme « coût nul ». Si les événements ont été demandés et que le bus
    # est actif, `publies` doit être non nul — sinon la mesure ne mesurait rien.
    etat_bus = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            reponse = await client.get(base + "/_mesure/bus")
            etat_bus = reponse.json()
    except Exception as exc:  # serveur de production sans routes de banc
        etat_bus = {"indisponible": str(exc)}

    rapport = {
        "url": base,
        "connexions": args.connexions,
        "clients_temoin": args.clients,
        "duree_phase_s": args.duree,
        "evenements_par_seconde": args.evenements,
        "evenements_publies": publies,
        "sans_flux": temoin,
        "avec_flux": avec_flux,
        "requetes_des_flux": 0,  # un flux immobile n'émet que son battement
        "etat_bus": etat_bus,
    }

    if args.evenements > 0 and isinstance(etat_bus, dict) and etat_bus.get("actif"):
        if not etat_bus.get("publies"):
            print(
                "❌ Le bus est branché et des événements ont été demandés, mais "
                "AUCUN n'a été publié : ce relevé ne mesure aucune charge de bus.",
                flush=True,
            )
            raise SystemExit(2)
        if not etat_bus.get("flux"):
            print(
                "❌ Aucun flux ouvert côté serveur au moment du relevé : les "
                "événements publiés n'avaient aucun destinataire.",
                flush=True,
            )
            raise SystemExit(2)
    print(json.dumps(rapport, indent=2, ensure_ascii=False))
    SORTIE.mkdir(exist_ok=True)
    chemin = SORTIE / f"push-{datetime.now().strftime('%H%M%S')}.json"
    chemin.write_text(json.dumps(rapport, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n→ {chemin}")


if __name__ == "__main__":
    asyncio.run(principal())
