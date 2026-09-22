#!/usr/bin/env python3
"""
Sonde de surveillance continue du backend Kojo en production.

Vérifie :
1. La disponibilité HTTP de l'endpoint /health (statut 200).
2. L'état global du backend (`status: healthy`).
3. L'état de connexion de la base MongoDB (`database: connected`).
4. L'état du disjoncteur PayDunya (`paydunya_circuit.state: closed`).
   Échoue si le circuit est ouvert ('open') ou si la base est déconnectée.

Usage :
    python backend/scripts/check_health_probe.py [--url https://api.kojoforafrica.cc.cd/health]
"""

import argparse
import json
import sys
import urllib.request
import urllib.error

DEFAULT_HEALTH_URL = "https://api.kojoforafrica.cc.cd/health"

def check_health(url: str, timeout: int = 15) -> int:
    print(f"[PROBE] Interrogation de la sante backend : {url}")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "KojoHealthMonitor/1.0", "Accept": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.status
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        print(f"[ERREUR HTTP {e.code}] Le backend a renvoye une erreur HTTP")
        try:
            print(f"   Details : {e.read().decode('utf-8')[:300]}")
        except Exception:
            pass
        return 1
    except urllib.error.URLError as e:
        print(f"[ERREUR CONNEXION] Impossible de joindre le backend : {e.reason}")
        return 1
    except Exception as e:
        print(f"[ERREUR INATTENDUE] {e}")
        return 1

    if status_code != 200:
        print(f"[ERREUR] Code de statut inattendu : {status_code} (attendu : 200)")
        return 1

    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"[ERREUR] Reponse JSON invalide recue de /health : {e}")
        return 1

    print("[OK] Endpoint /health accessible (HTTP 200)")

    errors = []

    # 1. Vérification du statut global
    health_status = data.get("status")
    if health_status != "healthy":
        errors.append(f"Statut global anormal : '{health_status}' (attendu: 'healthy')")
    else:
        print("[OK] Statut general : healthy")

    # 2. Vérification de la base de données
    database_status = data.get("database")
    if database_status != "connected":
        errors.append(f"Base de donnees non connectee : '{database_status}' (attendu: 'connected')")
    else:
        print("[OK] Connexion MongoDB : connected")

    # 3. Vérification du circuit breaker PayDunya
    circuit = data.get("paydunya_circuit")
    if not isinstance(circuit, dict):
        errors.append("Bloc 'paydunya_circuit' manquant ou invalide dans la reponse")
    else:
        circuit_state = circuit.get("state")
        failures = circuit.get("consecutive_failures", 0)
        cooldown = circuit.get("remaining_cooldown_seconds", 0)

        if circuit_state == "open":
            errors.append(
                f"CIRCUIT BREAKER PAYDUNYA OUVERT ! "
                f"(echecs consecutifs: {failures}, cooldown restant: {cooldown}s)"
            )
        elif circuit_state != "closed":
            print(f"[WARN] Circuit PayDunya dans un etat transitoire : '{circuit_state}' (echecs: {failures})")
        else:
            print(f"[OK] Circuit PayDunya : closed (echecs: {failures})")

    revision = data.get("revision")
    if revision:
        print(f"[INFO] Revision deployee : {revision[:10]}")

    if errors:
        print("\n[ERREUR] ANOMALIES DETECTEES SUR LA PRODUCTION :")
        for err in errors:
            print(f" - {err}")
        return 1

    print("\n[SUCCESS] La production est 100% saine (MongoDB connecte, PayDunya operationnel).")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Verification de sante continue du backend Kojo")
    parser.add_argument("--url", default=DEFAULT_HEALTH_URL, help="URL de l'endpoint /health")
    parser.add_argument("--timeout", type=int, default=15, help="Delai d'attente en secondes")
    args = parser.parse_args()

    sys.exit(check_health(args.url, args.timeout))

if __name__ == "__main__":
    main()
