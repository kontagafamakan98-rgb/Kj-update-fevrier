#!/usr/bin/env python3
"""
Sonde de surveillance continue du backend Kojo en production.

Vérifie :
1. La disponibilité HTTP de l'endpoint /health (statut 200).
2. L'état global du backend (`status: healthy`).
3. L'état de connexion à la base MongoDB (`database: connected`).
4. L'état du disjoncteur PayDunya (`paydunya_circuit.state: closed`).
   Échoue si le circuit est ouvert ('open') ou si la base est déconnectée.
5. Le fournisseur email ACTIF : `/monitor/email` doit répondre 200 — un 503
   nomme la panne (`provider`, `configured`, `detail`) : clé refusée,
   transport coupé, domaine Resend non vérifié, expéditeur Brevo inactif,
   jeton Gmail révoqué, ou `EMAIL_PROVIDER=none`. Sans cette vérification, un
   fournisseur muet n'était constaté que par un utilisateur qui attend son code.
6. Le healthcheck composite `/monitor` : un 503 (au moins `threshold`
   fournisseurs down) échoue et nomme les fournisseurs down ; un seul
   fournisseur transitoirement down est publié en WARN, sans échec — c'est le
   contrat du seuil (une panne isolée qui flappe n'alerte pas).

Les deux moniteurs sont dérivés de l'origine de `--url`, donc un seul drapeau
suffit ; ils vivent hors `/api` comme `/health`.

Usage :
    python backend/scripts/check_health_probe.py [--url https://api.kojoforafrica.cc.cd/health]
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_HEALTH_URL = "https://api.kojoforafrica.cc.cd/health"
CHEMIN_MONITEUR_EMAIL = "/monitor/email"
CHEMIN_MONITEUR_COMPOSITE = "/monitor"
AGENT = "KojoHealthMonitor/1.0"


def _origine(url: str) -> str:
    """Origine (scheme://host[:port]) d'une URL, sans chemin ni requête."""
    morceaux = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((morceaux.scheme, morceaux.netloc, "", "", ""))


def _url_de(origine: str, chemin: str) -> str:
    return origine.rstrip("/") + chemin


def _lire_moniteur(url: str, timeout: int):
    """Lit un moniteur : rend `(payload, statut, erreur)` — jamais d'exception.

    Un 503 est un VERDICT, pas une panne de la sonde : le corps JSON porte le
    détail qui nomme la cause, et c'est lui qui doit sortir dans l'échec. Le
    statut est rendu AVEC le corps, sans quoi on ne saurait pas distinguer
    « dégradé sous le seuil » (200) de « au-delà du seuil » (503).
    """
    req = urllib.request.Request(
        url,
        headers={"User-Agent": AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            statut = response.status
            corps = response.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        corps = ""
        try:
            corps = e.read().decode("utf-8")
        except Exception:
            pass
        if e.code == 503:
            try:
                return json.loads(corps), 503, ""
            except json.JSONDecodeError:
                return None, 503, f"HTTP 503 sans corps JSON lisible : {corps[:200]}"
        if e.code == 404:
            return None, 404, "HTTP 404 : le backend deploye ne porte pas encore cette sonde"
        return None, e.code, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return None, None, f"injoignable : {e.reason}"
    except Exception as e:
        return None, None, str(e)

    try:
        return json.loads(corps), statut, ""
    except json.JSONDecodeError as e:
        return None, statut, f"reponse JSON invalide : {e}"


def _verifier_email(origine: str, timeout: int) -> list:
    """`/monitor/email` : le fournisseur ACTIF peut-il réellement envoyer ?

    Échoue sur un 503 (le corps nomme la cause) et sur un corps qui contredit le
    statut — une sonde qui répond 200 en disant « down » serait exactement le
    silence qu'on veut fermer.
    """
    url = _url_de(origine, CHEMIN_MONITEUR_EMAIL)
    print(f"[PROBE] Fournisseur email actif : {url}")
    payload, statut, erreur = _lire_moniteur(url, timeout)

    if payload is None:
        print(f"[ERREUR] Sonde email inutilisable : {erreur}")
        return [f"Sonde email /monitor/email inutilisable : {erreur}"]

    provider = payload.get("provider") or "?"
    if statut == 200 and payload.get("circuit") == "ok":
        print(f"[OK] Email : fournisseur actif '{provider}' operationnel ({payload.get('detail', '')})")
        return []

    detail = payload.get("detail") or "aucun detail"
    configure = payload.get("configured")
    print(f"[ERREUR] Email : fournisseur actif '{provider}' NON OPERATIONNEL "
          f"(HTTP {statut}, configure={configure})")
    print(f"   Detail : {detail}")
    note = payload.get("provider_note")
    if note:
        print(f"   Configuration : {note}")
    # Un statut et un verdict qui se contredisent ne disent pas que le
    # fournisseur est tombe, mais que la sonde elle-meme est incoherente — dans
    # les deux sens (200 dit 'down', 503 dit 'ok').
    informe_ok = statut == 200
    verdict_ok = payload.get("circuit") == "ok"
    if informe_ok != verdict_ok:
        return [
            f"Sonde email incoherente : HTTP {statut} pour circuit={payload.get('circuit')!r} ({detail})"
        ]
    return [f"FOURNISSEUR EMAIL MUET (provider={provider}, configure={configure}) : {detail}"]


def _verifier_composite(origine: str, timeout: int) -> list:
    """`/monitor` : la panne est-elle agrégée au point de déclencher l'alerte ?

    Le seuil décide : un 503 est un échec (au moins `threshold` fournisseurs
    down) ; un 200 « dégradé » est publié en WARN, parce qu'une panne isolée qui
    flappe ne doit pas alerter — c'est le contrat du composite.
    """
    url = _url_de(origine, CHEMIN_MONITEUR_COMPOSITE)
    print(f"[PROBE] Healthcheck composite : {url}")
    payload, statut, erreur = _lire_moniteur(url, timeout)

    if payload is None:
        print(f"[ERREUR] Healthcheck composite inutilisable : {erreur}")
        return [f"Healthcheck composite /monitor inutilisable : {erreur}"]

    providers = payload.get("providers") or {}
    down = [
        nom for nom, info in providers.items()
        if isinstance(info, dict) and info.get("circuit") not in (None, "ok")
    ]
    total = payload.get("total")
    seuil = payload.get("threshold")

    if statut == 200 and payload.get("circuit") == "ok":
        print(f"[OK] Composite : {total} fournisseur(s), aucun en panne (seuil {seuil})")
        return []

    if not down:
        # Un échec sans fournisseur down : le corps ne dit pas la panne, on
        # refuse de conclure plutôt que d'inventer un coupable.
        return [f"Healthcheck composite en echec (HTTP {statut}) sans fournisseur down identifiable"]

    if statut == 200:
        print(f"[WARN] Composite degrade : {', '.join(down)} "
              f"(down={payload.get('down')}/{total}, seuil {seuil}) : sous le seuil, pas d'echec")
        return []

    print(f"[ERREUR] Composite au-dela du seuil : {', '.join(down)} "
          f"(down={payload.get('down')}/{total}, seuil {seuil})")
    return [f"PRODUCTION DEGRADEE : {len(down)} fournisseur(s) down : {', '.join(down)}"]

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

    # Les moniteurs sont juges MEME si /health a deja releve des anomalies : un
    # seul passage doit dire tout ce qui ne va pas, pas la premiere panne.
    origine = _origine(url)
    errors.extend(_verifier_email(origine, timeout))
    errors.extend(_verifier_composite(origine, timeout))

    if errors:
        print("\n[ERREUR] ANOMALIES DETECTEES SUR LA PRODUCTION :")
        for err in errors:
            print(f" - {err}")
        return 1

    print("\n[SUCCESS] La production est saine (MongoDB connecte, PayDunya operationnel, "
          "fournisseur email actif joignable).")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Verification de sante continue du backend Kojo")
    parser.add_argument("--url", default=DEFAULT_HEALTH_URL, help="URL de l'endpoint /health")
    parser.add_argument("--timeout", type=int, default=15, help="Delai d'attente en secondes")
    args = parser.parse_args()

    sys.exit(check_health(args.url, args.timeout))

if __name__ == "__main__":
    main()
