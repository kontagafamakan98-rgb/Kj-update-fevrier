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
7. Le DIAGNOSTIC DE PAIEMENT (`paiement` de /health, 31/10/2026) : la paire
   `closed` / 0 échec ne distinguait pas « clés absentes », « configuré, jamais
   exercé » et « dernier paiement réussi ». Le bloc les sépare ; la sonde
   refuse un bloc absent (révision à redéployer), un champ manquant,
   `configured: false`, `state: echec` (en publiant son motif) et toute
   contradiction entre les deux lectures du même circuit — `inconnu` est
   publié en WARN, parce que zéro vente n'est pas une panne.
8. Les LANGUES SERVIES (`langues` de /health, 01/11/2026) : le nombre de
   langues indexées et, pour chacune, le nombre de documents que le sitemap
   publie — la question que la sonde `hreflang` met 61 requêtes et 11 s à
   trancher. Un bloc absent est un refus nommé (révision antérieure), un volume
   qui ne tombe pas juste aussi. Ce qu'elle ne dit pas : le `lang`, le
   `canonical` et la réciprocité des documents SERVIES restent à la sonde.

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

# Les champs que le bloc `paiement` doit porter pour qu'un diagnostic soit
# possible. Un bloc amputé (déploiement partiel, sérialisation oubliée) ne se
# juge pas à moitié : il est refusé en nommant ce qui manque.
CHAMPS_PAIEMENT = (
    "configured",
    "state",
    "circuit",
    "cause",
    "motif",
    "consecutive_failures",
    "failure_threshold",
    "remaining_cooldown_seconds",
)

# Les champs que le bloc `langues` doit porter (01/11/2026). Un bloc amputé ne se
# juge pas à moitié : il est refusé en nommant ce qui manque.
CHAMPS_LANGUES = (
    "indexees",
    "defaut",
    "documents_par_langue",
    "urls_par_langue",
    "pages",
    "alternatives_par_page",
    "portee",
)


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


def _verifier_composite(origine: str, timeout: int, fournisseurs=None) -> list:
    """`/monitor` : la panne est-elle agrégée au point de déclencher l'alerte ?

    Le seuil décide : un 503 est un échec (au moins `threshold` fournisseurs
    down) ; un 200 « dégradé » est publié en WARN, parce qu'une panne isolée qui
    flappe ne doit pas alerter — c'est le contrat du composite.

    `fournisseurs`, quand il est fourni, reçoit les `providers` lus : c'est une
    SECONDE lecture du même circuit PayDunya dans la même passe, et
    `_verifier_paiement` la confronte au bloc `paiement` de /health. Aucune
    requête supplémentaire n'est faite pour cela.
    """
    url = _url_de(origine, CHEMIN_MONITEUR_COMPOSITE)
    print(f"[PROBE] Healthcheck composite : {url}")
    payload, statut, erreur = _lire_moniteur(url, timeout)

    if payload is None:
        print(f"[ERREUR] Healthcheck composite inutilisable : {erreur}")
        return [f"Healthcheck composite /monitor inutilisable : {erreur}"]

    providers = payload.get("providers") or {}
    if fournisseurs is not None:
        fournisseurs.update(providers)
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

def _verifier_langues(data: dict) -> list:
    """Le bloc `langues` de /health : combien de langues, et combien de documents.

    CE QU'IL FERME (01/11/2026). La question « combien de langues le site sert-il,
    et combien de documents chacune ? » ne se lisait qu'en lançant la sonde
    `hreflang` sur la production : 61 requêtes et 11 s. `/health` publie
    desormais la DECLARATION du sitemap, et cette sonde la juge : un bloc absent
    (revision anterieure au deploiement) est un refus nomme, pas un silence, et
    un volume qui ne tombe pas juste est un refus — un compte faux se lit comme
    une couverture, ce qui est pire que pas de compte du tout.

    Ce que la sonde NE juge PAS, et qui reste a la sonde `hreflang` : le `lang`
    des documents servis, leur `canonical` et la reciprocite des alternatives.
    Le bloc dit ce que le sitemap ENUMERE ; l'origine du site dit ce qu'elle
    SERT, et ce sont deux faits differents.
    """
    bloc = data.get("langues")
    if not isinstance(bloc, dict):
        return [
            "le backend deploye ne publie pas de bloc 'langues' dans /health : le "
            "volume des langues servies n'est pas lisible — la revision servie est "
            "anterieure a ce bloc, redeployer"
        ]

    manquants = [champ for champ in CHAMPS_LANGUES if champ not in bloc]
    if manquants:
        return [f"bloc 'langues' incomplet : champ(s) absent(s) {', '.join(manquants)}"]

    codes = bloc.get("indexees")
    if not isinstance(codes, list) or len(codes) < 2:
        return [
            "bloc 'langues' : 'indexees' doit etre une liste d'au moins deux codes "
            f"(lu : {codes!r}) — un site monolingue n'a pas de hreflang a publier"
        ]

    erreurs = []
    defaut = bloc.get("defaut")
    if defaut not in codes:
        erreurs.append(f"bloc 'langues' : la langue par defaut {defaut!r} n'est pas indexee")

    documents = bloc.get("documents_par_langue") or {}
    urls = bloc.get("urls_par_langue") or {}
    for nom, table in (("documents_par_langue", documents), ("urls_par_langue", urls)):
        if not isinstance(table, dict) or set(table) != set(codes):
            erreurs.append(
                f"bloc 'langues' : '{nom}' ne couvre pas exactement les langues "
                f"declarees ({sorted(set(table) ^ set(codes))} en ecart)"
            )
    if erreurs:
        return erreurs

    muettes = [code for code in codes if int(documents.get(code) or 0) < 1]
    if muettes:
        erreurs.append(
            "bloc 'langues' : " + ", ".join(muettes) + " n'annonce aucun document — "
            "une langue sans document n'a pas d'URL a servir"
        )

    pages = bloc.get("pages") or {}
    if pages.get("total") != sum(int(nombre or 0) for nombre in urls.values()):
        erreurs.append(
            "/health se contredit : pages.total="
            f"{pages.get('total')!r} mais urls_par_langue totalise "
            f"{sum(int(nombre or 0) for nombre in urls.values())}"
        )

    if not str(bloc.get("portee") or "").strip():
        erreurs.append(
            "bloc 'langues' : 'portee' est vide — un volume publie sans portee se "
            "lit comme une mesure des documents servis"
        )

    if not erreurs:
        par_langue = documents.get(codes[0])
        print(
            f"[OK] Langues : {len(codes)} ({', '.join(codes)}), {par_langue} document(s) "
            f"par langue, {sum(int(nombre or 0) for nombre in urls.values())} URL publiee(s)"
        )
    return erreurs


def _verifier_paiement(data: dict, paydunya_composite=None) -> list:
    """Le bloc `paiement` de /health : TROIS états, pas deux.

    CE QU'IL FERME (31/10/2026). `/health` ne publiait que
    `paydunya_circuit: {state: closed, consecutive_failures: 0}` — la MÊME
    lecture pour « les clés sont absentes, aucun paiement ne peut aboutir »,
    « les clés sont posées et aucun paiement n'a eu lieu » et « le dernier
    paiement a réussi ». L'audit du 31/10 l'a écrit tel quel. Le bloc `paiement`
    sépare ces trois cas ; cette sonde le JUGE, sinon le fait serait publié pour
    personne.

    ÉCHEC (nommé) : bloc absent — la révision servie est antérieure au
    diagnostic, il faut redéployer —, champ manquant, `configured: false`,
    `state: echec` (le motif est publié, un échec sans remède ne se répare pas),
    et toute CONTRADICTION entre les deux lectures du même circuit dans la même
    réponse (`paydunya_circuit` contre `paiement`) ou avec le composite.

    PAS un échec : `state: inconnu` — « configuré, jamais exercé » est le fait
    d'un site qui n'a pas encore vendu, pas une panne ; il est PUBLIÉ. Et
    `state: ok` publie le statut et la date du dernier appel réussi.
    """
    bloc = data.get("paiement")
    if not isinstance(bloc, dict):
        return [
            "le backend deploye ne publie pas de bloc 'paiement' dans /health : la "
            "revision servie est anterieure au diagnostic de paiement — redeployer"
        ]

    manquants = [champ for champ in CHAMPS_PAIEMENT if champ not in bloc]
    if manquants:
        return [f"bloc 'paiement' incomplet : champ(s) absent(s) {', '.join(manquants)}"]

    erreurs = []
    configure = bloc.get("configured")
    etat = bloc.get("state")
    circuit_paiement = bloc.get("circuit")
    cause = bloc.get("cause") or ""
    motif = (bloc.get("motif") or "").strip()

    if etat not in ("ok", "echec", "inconnu"):
        erreurs.append(
            f"bloc 'paiement' : etat inconnu {etat!r} (attendu ok, echec ou inconnu)"
        )

    if configure is False:
        erreurs.append(f"PAIEMENT NON CONFIGURE : {motif or 'aucun motif publie'}")
    elif etat == "echec":
        erreurs.append(
            f"PAIEMENT EN ECHEC (cause={cause}, circuit={circuit_paiement}) : "
            f"{motif or 'aucun motif publie'} — un echec sans motif ne se repare pas"
        )
    elif etat == "inconnu":
        print(
            "[WARN] Paiement : configure, aucun appel depuis le demarrage (aucune vente "
            "depuis ce deploiement) — fait publie, pas une panne"
        )
    elif etat == "ok":
        print(
            f"[OK] Paiement : dernier appel reussi (statut {bloc.get('last_status')}, "
            f"{bloc.get('last_success_at')})"
        )

    # Deux lectures du MÊME circuit dans la MÊME reponse : elles doivent
    # s'accorder, sinon l'une des deux est fausse et le diagnostic ment.
    circuit = data.get("paydunya_circuit") if isinstance(data.get("paydunya_circuit"), dict) else {}
    if circuit.get("state") != circuit_paiement:
        erreurs.append(
            "/health se contredit : paydunya_circuit.state="
            f"{circuit.get('state')!r} mais paiement.circuit={circuit_paiement!r}"
        )
    if circuit.get("consecutive_failures") != bloc.get("consecutive_failures"):
        erreurs.append(
            "/health se contredit : paydunya_circuit.consecutive_failures="
            f"{circuit.get('consecutive_failures')!r} mais "
            f"paiement.consecutive_failures={bloc.get('consecutive_failures')!r}"
        )

    if isinstance(paydunya_composite, dict):
        verdict = paydunya_composite.get("circuit")
        attendu_down = circuit_paiement == "open"
        if verdict == "ok" and attendu_down:
            erreurs.append(
                "le composite /monitor dit paydunya 'ok' alors que /health dit circuit 'open'"
            )
        elif verdict == "down" and not attendu_down:
            erreurs.append(
                "le composite /monitor dit paydunya 'down' alors que /health dit "
                f"circuit {circuit_paiement!r}"
            )

    return erreurs


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
    fournisseurs = {}
    errors.extend(_verifier_composite(origine, timeout, fournisseurs))
    # 4. Le diagnostic de paiement : la paire `closed` / 0 échec ci-dessus ne dit
    #    ni si les clés existent, ni si un paiement a été exercé, ni pourquoi il
    #    a échoué. Le composite donne une SECONDE lecture du même circuit.
    errors.extend(_verifier_paiement(data, fournisseurs.get("paydunya")))
    # 5. Les LANGUES SERVIES (01/11/2026) : combien de langues, combien de
    #    documents chacune — la question que la sonde hreflang met 11 s et 61
    #    requêtes à trancher sur les documents servis.
    errors.extend(_verifier_langues(data))

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
