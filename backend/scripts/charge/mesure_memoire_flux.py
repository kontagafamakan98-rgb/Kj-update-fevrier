#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Combien de RAM tient UNE connexion SSE ouverte — et donc combien de sessions
la machine peut réellement promettre ?

POURQUOI CE BANC EXISTE : `fly.toml` annonçait `hard_limit = 800` connexions avec
**256 Mo** de RAM (mesuré le 18/10/2026 : la config promettait plus que la
mémoire ne tient). Une limite de connexions n'est pas une opinion : c'est
`RAM disponible ÷ coût mesuré d'une session`, sinon la machine refuse des
sessions à l'utilisateur par OOM au lieu de les refuser proprement en 503 nommé.

CE QU'IL MESURE, et comment il évite de se mentir :

  1. le RSS du PROCESSUS qui sert les flux, relevé par paliers (0, 100, 200,
     400 connexions) sur le vrai `serveur_mesure.py` (`server.app` réel, base en
     mémoire) — c'est le chiffre qui décide, pas une estimation ;
  2. le coût MARGINAL par connexion, calculé entre deux paliers et non à partir
     du palier zéro : le RSS de départ contient l'interpréteur, les modules et
     les registres du serveur, que le nombre de sessions ne paie pas ;
  3. la taille qui RESTE disponible à 75 % de la RAM (25 % de marge pour
     l'allocateur, les pics de rendu OG et le cache du système) : c'est ce
     nombre, et lui seul, que `hard_limit` a le droit de promettre.

CE QU'IL NE MESURE PAS (dit plutôt que tu) : la RAM de la machine Fly elle-même
(le palier vient de `fly.toml`), le coût d'un flux qui REÇOIT des événements
(une session immobile coûte sa file vide ; publier ajoute des octets par
client), et le coût de MongoDB (le banc sert une base en mémoire).

Usage :
    # terminal 1
    python scripts/charge/serveur_mesure.py --port 8990 --users 4000
    # terminal 2
    python scripts/charge/mesure_memoire_flux.py --pid <PID du serveur> \\
        --url http://127.0.0.1:8990 --paliers 0,100,200,400
"""
import argparse
import asyncio
import ctypes
import json
import os
import sys
import time
from pathlib import Path

import httpx

# La RAM de la machine déployée, telle que `fly.toml` la demande. Recopiée ici
# parce que le banc tourne sur le POSTE, pas dans la VM : c'est une entrée du
# calcul, pas une mesure.
RAM_PALIER_MO = 512

# Part de la RAM que les sessions ont le droit d'occuper. Le reste paie
# l'interpréteur, les tampons, le rendu OG (Pillow, ~30 Mo de pics) et
# l'allocateur : promettre 100 % de la RAM, c'est promettre un OOM.
PART_SESSIONS = 0.75


def rss_octets(pid: int) -> int:
    """RSS du processus, sans dépendance : /proc sur Linux, ps sur macOS,
    GetProcessMemoryInfo sur Windows (le poste de mesure)."""
    if sys.platform.startswith("linux"):
        with open(f"/proc/{pid}/status", "r", encoding="utf-8") as flux:
            for ligne in flux:
                if ligne.startswith("VmRSS:"):
                    return int(ligne.split()[1]) * 1024
        raise RuntimeError(f"VmRSS introuvable pour {pid}")

    if sys.platform == "darwin":
        import subprocess

        sortie = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)], capture_output=True, text=True, check=True
        ).stdout.strip()
        return int(sortie) * 1024

    if os.name == "nt":
        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        compteurs = PROCESS_MEMORY_COUNTERS()
        compteurs.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        handle = ctypes.windll.kernel32.OpenProcess(0x1000 | 0x0400, False, pid)
        if not handle:
            raise RuntimeError(f"OpenProcess a refusé le PID {pid}")
        try:
            if not ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(compteurs), compteurs.cb
            ):
                raise RuntimeError("GetProcessMemoryInfo a échoué")
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
        return int(compteurs.WorkingSetSize)

    raise RuntimeError(f"plateforme non gérée : {sys.platform}")


async def jeton_reel(base: str) -> tuple:
    """Ouvre une session de mesure comme le fait `mesure_push.py`.

    Le compte est l'un de ceux que `serveur_mesure.py` crée (`user1@mesure.kojo`) :
    un email inventé rendrait un 401, donc un banc qui ne mesure rien.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        reponse = await client.post(
            base + "/api/auth/login",
            json={"email": "user1@mesure.kojo", "password": "password123"},
        )
        if reponse.status_code != 200:
            raise SystemExit(
                f"❌ POST /api/auth/login → HTTP {reponse.status_code}. Ce banc vise le "
                "serveur de CHARGE (scripts/charge/serveur_mesure.py), pas la production."
            )
        donnees = reponse.json()
        return donnees.get("access_token") or donnees["token"], donnees.get("user", {}).get("id")


async def tenir_flux(client, base: str, jeton: str, prets: asyncio.Queue, stop: asyncio.Event):
    """Garde UNE connexion SSE ouverte, comme le ferait un onglet."""
    try:
        async with client.stream(
            "GET",
            base + "/api/notifications/stream",
            headers={"Authorization": f"Bearer {jeton}", "Accept": "text/event-stream"},
        ) as reponse:
            if reponse.status_code != 200:
                await prets.put(False)
                return
            await prets.put(True)
            async for ligne in reponse.aiter_lines():
                if stop.is_set():
                    return
                if ligne.startswith("event: ready"):
                    continue
    except asyncio.CancelledError:
        raise
    except Exception:
        if not stop.is_set():
            await prets.put(False)


async def palier(base: str, jeton: str, nombre: int) -> tuple:
    """Ouvre `nombre` flux, attend que TOUS soient prêts, rend (client, taches).

    L'attente est une CONDITION (chaque flux annonce son `ready`), jamais une
    durée : un palier « ouvert » qui n'a pas fini d'ouvrir se lirait comme un
    coût mémoire trop faible, c'est-à-dire un vert faux.
    """
    if nombre == 0:
        return None, [], stop()

    prets: asyncio.Queue = asyncio.Queue()
    stop_evt = asyncio.Event()
    client = httpx.AsyncClient(
        timeout=None,
        limits=httpx.Limits(
            max_connections=nombre + 10, max_keepalive_connections=nombre + 10
        ),
    )
    taches = [
        asyncio.create_task(tenir_flux(client, base, jeton, prets, stop_evt))
        for _ in range(nombre)
    ]
    try:
        resultats = await asyncio.wait_for(
            asyncio.gather(*(prets.get() for _ in range(nombre))), timeout=120
        )
    except asyncio.TimeoutError:
        stop_evt.set()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await client.aclose()
        raise SystemExit(
            f"❌ {prets.qsize()} flux prêts sur {nombre} : la mesure serait partielle, "
            "donc le coût par session serait sous-estimé."
        )
    if not all(resultats):
        stop_evt.set()
        for tache in taches:
            tache.cancel()
        await asyncio.gather(*taches, return_exceptions=True)
        await client.aclose()
        raise SystemExit(f"❌ {resultats.count(False)} flux refusés sur {nombre}")
    return client, taches, stop_evt


def stop():
    """Le `stop` d'un palier vide : rien à arrêter, mais l'appelant en attend un."""
    return asyncio.Event()


def mo(octets: int) -> float:
    return octets / (1024 * 1024)


async def principal() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--url", default="http://127.0.0.1:8990")
    parseur.add_argument("--pid", type=int, required=True, help="PID du serveur mesuré")
    parseur.add_argument("--paliers", default="0,100,200,400")
    parseur.add_argument("--ram-mo", type=float, default=RAM_PALIER_MO)
    parseur.add_argument(
        "--json",
        default=str(Path(__file__).with_name("mesure_memoire.json")),
        help="où écrire la mesure que le garde de dimensionnement relit",
    )
    args = parseur.parse_args()

    base = args.url.rstrip("/")
    paliers = [int(p) for p in args.paliers.split(",") if p.strip()]
    jeton, _ = await jeton_reel(base)

    mesures = []
    for nombre in sorted(paliers):
        client, taches, stop_evt = await palier(base, jeton, nombre)
        # Un palier n'est lu qu'une fois STABILISÉ : laisser l'allocateur rendre
        # ce que les connexions fermées ont libéré, sinon le palier suivant
        # hérite du précédent et le coût marginal devient négatif.
        await asyncio.sleep(1.0)
        rss = rss_octets(args.pid)
        mesures.append((nombre, rss))
        print(f"   palier {nombre:>4} flux → RSS {mo(rss):7.1f} Mo", flush=True)
        if stop_evt:
            stop_evt.set()
        for tache in taches:
            tache.cancel()
        if taches:
            await asyncio.gather(*taches, return_exceptions=True)
        if client:
            await client.aclose()
        await asyncio.sleep(0.5)

    # Coût MARGINAL par palier, puis la moyenne pondérée des marges : un coût
    # calculé depuis le palier zéro compterait l'interpréteur et les modules.
    marges = []
    for (n0, r0), (n1, r1) in zip(mesures, mesures[1:]):
        if n1 > n0 and r1 >= r0:
            marges.append(((r1 - r0) / (n1 - n0), n1 - n0))
    if not marges:
        print("❌ Aucune marge positive : le relevé n'a pas vu les connexions — refus de conclure.")
        return 1
    total = sum(poids for _, poids in marges)
    cout = sum(cout_par * poids for cout_par, poids in marges) / total

    # LE PIRE PALIER DÉCIDE. L'allocateur ne rend pas la mémoire d'un palier
    # fermé, donc une marge isolée peut doubler sans que ce soit une fuite — et
    # une moyenne effacerait justement le palier qui a coûté cher. `hard_limit`
    # se dimensionne sur le pire, jamais sur la moyenne : c'est la seule forme
    # qui tienne encore quand la mesure est bruitée.
    cout_pire = max((marge for marge, _ in marges), default=cout)

    base_rss = mesures[0][1]
    disponible = args.ram_mo * 1024 * 1024 * PART_SESSIONS - base_rss
    promesse = int(max(0, disponible // cout_pire))

    print()
    print(
        f"Coût mesuré d'une session SSE ouverte : {cout / 1024:,.0f} Ko "
        f"(moyenne pondérée ; pire palier {cout_pire / 1024:,.0f} Ko, celui qui décide)".replace(",", " ")
    )
    print(f"RSS hors sessions (interpréteur + application) : {mo(base_rss):.1f} Mo")
    print(
        f"RAM {args.ram_mo:.0f} Mo × {PART_SESSIONS:.0%} = "
        f"{args.ram_mo * PART_SESSIONS:.0f} Mo pour les sessions"
    )
    print(f"→ connexions qui tiennent : {promesse}   (promesse DÉRIVÉE, pas choisie)")

    # La mesure est ÉCRITE : `backend/tests/test_dimensionnement_machine.py` la
    # relit et refuse un `fly.toml` qui promettrait plus que ce qu'elle tient.
    # Sans ce fichier, le chiffre du jour vivrait dans une conversation.
    rapport = {
        "mesure_le": time.strftime("%Y-%m-%d"),
        "hote": f"{sys.platform}-{sys.version_info.major}.{sys.version_info.minor} (poste de mesure)",
        "palier_ram_mo": args.ram_mo,
        "part_sessions": PART_SESSIONS,
        "cout_session_mo": round(cout / (1024 * 1024), 4),
        "cout_pire_palier_mo": round(cout_pire / (1024 * 1024), 4),
        "base_hors_sessions_mo": round(mo(base_rss), 1),
        "paliers": [[nombre, round(mo(rss), 1)] for nombre, rss in mesures],
        "promesse_connexions": promesse,
    }
    if args.json:
        Path(args.json).write_text(
            json.dumps(rapport, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Mesure écrite dans {args.json}")
    return 0


if __name__ == "__main__":
    # Le rapport est en français (flèches, accents) et se lit aussi depuis un
    # terminal Windows en cp1252 : sans cela, le banc mourait en PLEINE mesure
    # sur un caractère non encodable, après avoir ouvert les connexions.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    sys.exit(asyncio.run(principal()))
