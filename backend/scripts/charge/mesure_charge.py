#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Générateur de charge : paliers de concurrence, latences, débit, erreurs.

Le modèle est FERMÉ (N clients qui bouclent) : chaque palier mesure ce qu'un
groupe d'utilisateurs simultanés obtient réellement, latence d'attente
comprise. C'est la question utile — « à 5 000 utilisateurs actifs, mon p95
tient-il ? » — et non le débit maximal théorique d'un robinet ouvert.

Le générateur et le serveur mesuré tournent sur la MÊME machine : le débit
absolu est donc pessimiste (le client mange du CPU au serveur). Les
COMPARAISONS avant/après, elles, restent valables — c'est ce pour quoi ce banc
existe.

Exemples :
    python scripts/charge/mesure_charge.py --scenario mix
    python scripts/charge/mesure_charge.py --scenario blocage --duree 10
"""
import argparse
import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

import httpx

SORTIE = Path(__file__).resolve().parent / "resultats"


async def jeton_reel(base: str) -> str:
    """Ouvre une VRAIE session (POST /auth/login) et rend son jeton.

    Le jeton est minté par le serveur mesuré, jamais signé ici : le secret de
    signature peut venir de `backend/.env` (chargé par `kojo_settings`), et un
    jeton forgé avec un autre secret donnerait des 401 — c'est-à-dire une
    mesure de rien du tout.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        reponse = await client.post(
            base + "/api/auth/login",
            json={"email": "user1@mesure.kojo", "password": "password123"},
        )
        reponse.raise_for_status()
        donnees = reponse.json()
        jeton = donnees.get("access_token") or donnees.get("token")
        if not jeton:
            raise SystemExit(f"Pas de jeton dans la réponse de login : {list(donnees)}")
        return jeton


def requetes_du_scenario(nom: str, base: str, connecte: dict):
    """Liste de (méthode, chemin, corps, en-têtes)."""
    anonyme = {}
    if nom == "health":
        # Témoin du coût FIXE (middlewares + routeur) : tout ce qu'un palier
        # au-dessus de ce chiffre est le travail de la route mesurée.
        return [("GET", "/api/health", None, anonyme)]
    if nom == "jobs":
        return [("GET", "/api/jobs?status=open&limit=50", None, anonyme)]
    if nom == "job":
        return [("GET", "/api/jobs/job-7", None, anonyme)]
    if nom == "authme":
        return [("GET", "/api/auth/me", None, connecte)]
    if nom == "notifs":
        return [("GET", "/api/notifications/unread-count", None, connecte)]
    if nom == "login":
        return [
            (
                "POST",
                "/api/auth/login",
                {"email": "user1@mesure.kojo", "password": "password123"},
                anonyme,
            )
        ]
    if nom == "mix":
        # Mélange conforme à l'usage réel : chaque écran connecté rejoue
        # /auth/me, la liste des missions et le compteur de notifications ;
        # la découverte publique (jobs) pèse pour les visiteurs.
        return (
            [("GET", "/api/jobs?status=open&limit=50", None, anonyme)] * 3
            + [("GET", "/api/jobs/job-7", None, anonyme)] * 2
            + [("GET", "/api/auth/me", None, connecte)] * 2
            + [("GET", "/api/notifications/unread-count", None, connecte)] * 2
            + [("GET", "/api/health", None, anonyme)] * 1
        )
    raise SystemExit(f"scénario inconnu : {nom}")


def percentile(valeurs, p):
    if not valeurs:
        return 0.0
    rang = max(0, min(len(valeurs) - 1, int(round((p / 100.0) * (len(valeurs) - 1)))))
    return valeurs[rang]


async def _travailleur(client, base, requetes, fin, mesures, index_depart):
    i = index_depart
    while time.perf_counter() < fin:
        methode, chemin, corps, entetes = requetes[i % len(requetes)]
        i += 1
        debut = time.perf_counter()
        statut = 0
        try:
            reponse = await client.request(
                methode, base + chemin, json=corps, headers=entetes
            )
            statut = reponse.status_code
        except Exception:
            statut = 0
        mesures.append((time.perf_counter() - debut, statut))


async def _palier_brut(base, requetes, concurrence, duree):
    """Un process de mesure : rend les mesures BRUTES, pas un résumé.

    Le résumé est calculé dans le parent, sur l'union des processus : des
    percentiles de percentiles ne veulent rien dire.
    """
    limites = httpx.Limits(
        max_connections=max(concurrence, 1) * 2,
        max_keepalive_connections=max(concurrence, 1) * 2,
    )
    mesures = []
    async with httpx.AsyncClient(timeout=60.0, limits=limites) as client:
        fin = time.perf_counter() + duree
        taches = [
            asyncio.create_task(_travailleur(client, base, requetes, fin, mesures, k))
            for k in range(concurrence)
        ]
        debut = time.perf_counter()
        await asyncio.gather(*taches)
        ecoule = time.perf_counter() - debut
    return mesures, ecoule


async def palier(base, nom_scenario, jeton, concurrence, duree):
    """Un palier : `concurrence` clients qui bouclent pendant `duree`.

    PLAFOND CONNU du générateur : ~320 rps sur cette machine, mesuré contre
    `etalon.py` (un serveur qui ne fait rien). Au-delà, un chiffre décrirait le
    GIL du client, pas le serveur — d'où le calibrage, et la règle : ne
    conclure que sous ce plafond.
    """
    entetes = {"Authorization": f"Bearer {jeton}"} if jeton else {}
    requetes = requetes_du_scenario(nom_scenario, base, entetes)
    mesures, ecoule = await _palier_brut(base, requetes, concurrence, duree)
    latences = sorted(d for d, _ in mesures)
    erreurs = sum(1 for _, s in mesures if s == 0)
    non_ok = sum(1 for _, s in mesures if s >= 400)
    return {
        "concurrence": concurrence,
        "duree_s": round(ecoule, 2),
        "requetes": len(mesures),
        "rps": round(len(mesures) / ecoule, 1) if ecoule else 0.0,
        "p50_ms": round(percentile(latences, 50) * 1000, 1),
        "p95_ms": round(percentile(latences, 95) * 1000, 1),
        "p99_ms": round(percentile(latences, 99) * 1000, 1),
        "erreurs_reseau": erreurs,
        "reponses_4xx_5xx": non_ok,
    }


async def scenario_blocage(base, duree, lenteur):
    """Un appel SORTANT lent (email, paiement) bloque-t-il les autres requêtes ?

    Phase 1 : santé seule. Phase 2 : santé + un envoi d'email toutes les
    `lenteur` secondes. Si l'event loop est bloqué, le p95 de /api/health
    explose — c'est la mesure qui décide, pas la lecture du code.
    """
    mesures_1, mesures_2 = [], []

    async def sante(fin, mesures):
        async with httpx.AsyncClient(timeout=60.0) as client:
            while time.perf_counter() < fin:
                debut = time.perf_counter()
                try:
                    await client.get(base + "/api/health")
                except Exception:
                    pass
                mesures.append(time.perf_counter() - debut)
                await asyncio.sleep(0.02)

    async def otp(fin, i=0):
        async with httpx.AsyncClient(timeout=60.0) as client:
            while time.perf_counter() < fin:
                try:
                    await client.post(
                        base + "/api/auth/email/send-otp",
                        json={"email": f"charge{i}@mesure.kojo", "purpose": "signup"},
                    )
                except Exception:
                    pass
                i += 1
                await asyncio.sleep(max(0.05, lenteur))

    fin1 = time.perf_counter() + duree
    await asyncio.gather(*(sante(fin1, mesures_1) for _ in range(4)))

    taches = [asyncio.create_task(sante(time.perf_counter() + duree, mesures_2)) for _ in range(4)]
    taches.append(asyncio.create_task(otp(time.perf_counter() + duree)))
    await asyncio.gather(*taches)

    def resume(mesures):
        triees = sorted(mesures)
        return {
            "requetes": len(mesures),
            "p50_ms": round(percentile(triees, 50) * 1000, 1),
            "p95_ms": round(percentile(triees, 95) * 1000, 1),
            "p99_ms": round(percentile(triees, 99) * 1000, 1),
            "max_ms": round((triees[-1] if triees else 0) * 1000, 1),
        }

    return {"sans_envoi": resume(mesures_1), "avec_envoi": resume(mesures_2)}


def _tableau(paliers):
    entete = f"{'conc.':>6} {'rps':>8} {'p50 ms':>8} {'p95 ms':>8} {'p99 ms':>8} {'err':>5} {'4xx+':>5}"
    lignes = [entete, "-" * len(entete)]
    for p in paliers:
        lignes.append(
            f"{p['concurrence']:>6} {p['rps']:>8} {p['p50_ms']:>8} {p['p95_ms']:>8} "
            f"{p['p99_ms']:>8} {p['erreurs_reseau']:>5} {p['reponses_4xx_5xx']:>5}"
        )
    return "\n".join(lignes)


async def principal():
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--url", default="http://127.0.0.1:8990")
    parseur.add_argument("--scenario", default="mix")
    parseur.add_argument("--paliers", default="1,4,16,32,64,128")
    parseur.add_argument("--duree", type=float, default=8.0)
    parseur.add_argument("--lenteur", type=float, default=2.0)
    args = parseur.parse_args()

    SORTIE.mkdir(exist_ok=True)
    horodatage = datetime.now().strftime("%H%M%S")

    if args.scenario == "blocage":
        resultat = await scenario_blocage(args.url, args.duree, args.lenteur)
        print(json.dumps(resultat, indent=2, ensure_ascii=False))
        (SORTIE / f"blocage-{horodatage}.json").write_text(
            json.dumps(resultat, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return

    # Le jeton n'est demandé QUE si le scénario a besoin d'une session :
    # l'étalon (`etalon.py`) ne sert pas de route d'authentification, et c'est
    # précisément lui qui mesure le plafond du générateur.
    jeton = ""
    if args.scenario in ("mix", "authme", "notifs"):
        jeton = await jeton_reel(args.url)
    paliers = []
    print(f"Scénario « {args.scenario} » — {args.duree}s par palier, {args.url}\n")
    for concurrence in [int(c) for c in args.paliers.split(",") if c.strip()]:
        paliers.append(
            await palier(args.url, args.scenario, jeton, concurrence, args.duree)
        )
        print(_tableau(paliers[-1:]).splitlines()[-1], flush=True)

    print()
    print(_tableau(paliers))
    compte_rendu = {
        "scenario": args.scenario,
        "url": args.url,
        "duree_palier_s": args.duree,
        "paliers": paliers,
    }
    chemin = SORTIE / f"{args.scenario}-{horodatage}.json"
    chemin.write_text(json.dumps(compte_rendu, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n→ {chemin}")


if __name__ == "__main__":
    asyncio.run(principal())
