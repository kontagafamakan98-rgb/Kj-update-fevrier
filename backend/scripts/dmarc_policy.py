#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Politique DMARC de `kojoforafrica.cc.cd` : montée par paliers, retour immédiat.

── Pourquoi un outil, et pas une modification à la main ────────────────────
Passer de `p=none` à `p=quarantine` en un saut, c'est décider sur une
impression : un seul expéditeur légitime qu'on aurait oublié (une adresse
« Envoyer en tant que » dans une boîte, un outil qui signe sans DKIM aligné) et
ses messages partent en quarantaine — sans que personne ne le voie avant la
plainte d'un utilisateur. La montée se fait donc par PALIERS, chacun observé
avant le suivant, et le retour arrière doit être aussi simple que l'aller.

── Les paliers, et ce qui les déclenche ────────────────────────────────────
| Étape      | Record publié                          | Durée minimale avant la suivante |
|------------|----------------------------------------|----------------------------------|
| `observe`  | `p=none` (aucun rejet possible)        | aucune                           |
| `canary`   | `p=quarantine; pct=10` (10 % des échecs) | 7 jours                         |
| `half`     | `p=quarantine; pct=50`                 | 3 jours                          |
| `full`     | `p=quarantine` (pct=100)               | —                                |

Le temps déjà passé dans l'étape courante est lu dans le `updated_at` de
l'enregistrement DNS renvoyé par DNSHE, et non dans un fichier d'état : rien à
tenir à jour, et l'horloge ne peut pas mentir. `ramp` REFUSE de monter si le
délai n'est pas écoulé.

⚠️ `pct` est déprécié par DMARCbis et certains récepteurs l'ignorent : pour
eux, `pct=10` vaut `p=quarantine` plein. C'est pourquoi chaque palier est
observé, et pourquoi `rollback` existe.

── Le retour arrière ──────────────────────────────────────────────────────
`rollback` republie `p=none` immédiatement (aucun délai, aucun palier à
défaire) et laisse `rua` en place, pour continuer à recevoir les rapports
pendant qu'on diagnostique. Le TTL est ramené à 300 s à chaque écriture : le
retour arrière se propage en minutes, pas en heures.

Prérequis : `DNSHE_API_KEY` et `DNSHE_API_SECRET` (API Management du domaine).
Un `User-Agent` explicite est OBLIGATOIRE vers DNSHE (Cloudflare répond 403
`browser_signature_banned` à la signature d'`urllib`).

Usage :
    python backend/scripts/dmarc_policy.py show
    python backend/scripts/dmarc_policy.py ramp
    python backend/scripts/dmarc_policy.py rollback
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import socket
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api005.dnshe.com/index.php?m=domain_hub"
USER_AGENT = "kojo-dmarc-policy/1.0"
DEFAULT_DOMAIN = "kojoforafrica.cc.cd"
DMARC_HOST = "_dmarc"
RUPTURE_ADDRESS = "mailto:rua@dmarc.brevo.com"
# TTL court : c'est lui qui borne le temps de retour arrière.
FAST_TTL = 300
# Horloge du délai d'observation (DNSHE ne date pas ses enregistrements).
STATE_FILE = Path(__file__).with_name("dmarc_policy.state.json")

# `pct` absent = 100 (RFC 7489 §6.3) : l'étape `full` n'a donc PAS besoin de
# pct, et un `pct` oublié ailleurs se lit comme 100 — d'où le palier explicite.
STAGES = [
    {"name": "observe", "policy": "none", "pct": None, "min_days": 0,
     "why": "aucun rejet possible : on observe"},
    {"name": "canary", "policy": "quarantine", "pct": 10, "min_days": 7,
     "why": "10 % des messages en échec partent en quarantaine"},
    {"name": "half", "policy": "quarantine", "pct": 50, "min_days": 3,
     "why": "la moitié des échecs"},
    {"name": "full", "policy": "quarantine", "pct": 100, "min_days": None,
     "why": "politique complète"},
]
STAGE_BY_NAME = {stage["name"]: stage for stage in STAGES}


def build_record(stage_name: str) -> str:
    """Record TXT `_dmarc` d'une étape. `rua` reste TOUJOURS présent : sans lui,
    plus de rapports agrégés, donc plus rien pour décider de la suite."""
    stage = STAGE_BY_NAME[stage_name]
    parts = ["v=DMARC1", f"p={stage['policy']}"]
    if stage["pct"] is not None and stage["pct"] != 100:
        parts.append(f"pct={stage['pct']}")
    parts.append(f"rua={RUPTURE_ADDRESS}")
    return "; ".join(parts)


def parse_record(content: str) -> dict:
    """Décompose un record DMARC publié (`{v, p, pct, rua, …}`).

    Tolérant par construction : un record modifié à la main doit être LU, pas
    rejeté — c'est ce qui permet à `ramp` de dire où en est réellement le
    domaine au lieu de supposer.
    """
    tags: dict[str, str] = {}
    for chunk in str(content or "").split(";"):
        name, _, value = chunk.partition("=")
        name = name.strip().lower()
        if name:
            tags[name] = value.strip()
    if "pct" in tags:
        try:
            tags["pct"] = int(tags["pct"])
        except ValueError:
            tags["pct"] = None
    return tags


def stage_of(content: str) -> str | None:
    """Étape correspondant à un record publié, ou None s'il ne correspond à
    aucune étape de l'échelle (record édité à la main)."""
    tags = parse_record(content)
    policy = (tags.get("p") or "").lower()
    pct = tags.get("pct")
    if pct is None:
        pct = 100
    for stage in STAGES:
        if stage["policy"] == policy and (stage["pct"] or 100) == pct:
            return stage["name"]
    return None


def next_stage(current: str | None) -> str | None:
    """Étape suivante, ou None si l'échelle est terminée (ou le record inconnu)."""
    if current is None:
        return None
    index = [stage["name"] for stage in STAGES].index(current)
    return STAGES[index + 1]["name"] if index + 1 < len(STAGES) else None


def days_since(stamp: str, now: dt.datetime | None = None) -> int:
    """Jours entiers écoulés depuis un horodatage (formats DNSHE ou ISO)."""
    text = str(stamp).strip().replace("Z", "+00:00")
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            parsed = dt.datetime.strptime(text, pattern)
            break
        except ValueError:
            continue
    else:
        raise ValueError(f"horodatage illisible : {stamp!r}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return max(0, ((now or dt.datetime.now(dt.timezone.utc)) - parsed).days)


def read_state(path: Path | None = None) -> dict:
    """État local de la montée (`{"stage": …, "published_at": …}`), ou {}."""
    path = path or STATE_FILE
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(stage: str, published_at: str, path: Path | None = None) -> dict:
    """Note le début d'une politique. DNSHE ne date PAS ses enregistrements (ni
    `updated_at` ni `created_at` sur un TXT de la liste) : sans cette note, rien
    ne dit depuis quand l'étape courante est en place, donc rien ne peut faire
    respecter le délai d'observation."""
    state = {"stage": stage, "published_at": published_at}
    Path(path or STATE_FILE).write_text(json.dumps(state, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return state


def policy_started_at(record: dict, state: dict, stage: str) -> str | None:
    """Depuis quand la politique EN PLACE est en place.

    Priorité au DNS s'il expose un horodatage (source de vérité, insensible à la
    perte d'un fichier local) ; repli sur l'état écrit par cet outil, À CONDITION
    qu'il décrive bien l'étape constatée — sinon on ne sait pas, et on le dit.
    """
    if record.get("updated_at"):
        return record["updated_at"]
    if state.get("stage") == stage and state.get("published_at"):
        return state["published_at"]
    return None


def ramp_blocked_by(current: str | None, started_at: str | None, now: dt.datetime | None = None) -> str | None:
    """Raison de refuser la montée, ou None si elle est permise."""
    if current is None:
        return "record DMARC non reconnu (modifié à la main ?) — relire avec `show` avant de monter"
    following = next_stage(current)
    if following is None:
        return f"l'échelle est terminée (étape « {current} » = politique complète)"
    required = STAGE_BY_NAME[current]["min_days"] or 0
    if not required:
        return None
    if not started_at:
        return (
            f"étape « {current} » non datée : DNSHE n'horodate pas ses enregistrements et "
            f"{STATE_FILE.name} ne décrit pas cette étape — relancer `rollback` pour \
            repartir d'une étape datée plutôt que de monter à l'aveugle"
        )
    elapsed = days_since(started_at, now)
    if elapsed < required:
        return (
            f"étape « {current} » observée depuis {elapsed} jour(s) sur {required} requis "
            f"avant de passer à « {following} »"
        )
    return None


# ── Lecture du DNS servi (aucune dépendance : un client TXT minimal) ────────
def parse_dns_txt_response(packet: bytes) -> list[str]:
    """TXT de la section RÉPONSE d'un message DNS (RFC 1035).

    Un nom compressé est terminé par un pointeur de 2 octets — le lire comme un
    préfixe décalait tout ce qui suit et rendait une liste vide, c'est-à-dire un
    « rien n'est propagé » indistinguable d'une vraie absence.
    """
    header = struct.unpack(">HHHHHH", packet[:12])
    offset = 12
    for _ in range(header[2]):  # questions (jamais compressées)
        while packet[offset]:
            offset += packet[offset] + 1
        offset += 5
    values = []
    for _ in range(header[3]):
        while True:
            length = packet[offset]
            if length & 0xC0:  # pointeur : le nom s'arrête ici
                offset += 2
                break
            offset += 1
            if length == 0:
                break
            offset += length
        rtype, _cls, _ttl, rdlength = struct.unpack(">HHIH", packet[offset:offset + 10])
        rdata = packet[offset + 10:offset + 10 + rdlength]
        offset += 10 + rdlength
        if rtype == 16:
            text, index = [], 0
            while index < len(rdata):
                size = rdata[index]
                text.append(rdata[index + 1:index + 1 + size].decode("utf-8", "replace"))
                index += size + 1
            values.append("".join(text))
    return values


def propagation_report(name: str, expected: str, resolve=None) -> str:
    """Ce que le monde voit déjà, sans confondre un cache avec un échec.

    Juste après une écriture, un résolveur public peut encore servir l'ANCIENNE
    valeur pendant tout son TTL : c'est une propagation en cours, pas un retour
    arrière raté. Le distinguer évite de republier sur une fausse alerte.
    """
    try:
        served = (resolve or resolve_txt)(name)
    except (TimeoutError, OSError) as error:
        # La vue DNS est un CONFORT : l'écriture ci-dessus a réussi. Échouer ici
        # transformerait un succès en échec, et ferait republier pour rien.
        return f"vue DNS indisponible ({error}) — l'état publié ci-dessus fait foi"
    if expected in served:
        return f"propagé : {expected}"
    if not served:
        return f"pas encore servi : aucune réponse TXT pour {name}"
    return (
        "en cours de propagation : un résolveur public sert encore "
        f"{served[0]} (cache d'au plus {FAST_TTL} s)"
    )


def resolve_txt(name: str, server: str = "1.1.1.1", timeout: float = 5.0) -> list[str]:
    """TXT servis par un résolveur public, pour comparer au record écrit.

    La vue de l'API dit ce qui est PUBLIÉ ; celle-ci dit ce qui est SERVI (et
    peut retarder d'un TTL). Les deux sont imprimées : c'est l'écart entre elles
    qui explique pourquoi un retour arrière « n'a pas l'air » d'avoir pris.
    """
    query = struct.pack(">HHHHHH", 0x4B4F, 0x0100, 1, 0, 0, 0)
    query += b"".join(bytes([len(part)]) + part.encode() for part in name.split(".")) + b"\x00"
    query += struct.pack(">HH", 16, 1)  # TXT, IN
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        sock.sendto(query, (server, 53))
        data, _ = sock.recvfrom(4096)
    return parse_dns_txt_response(data)


# ── API DNSHE ───────────────────────────────────────────────────────────────
def api_call(endpoint: str, action: str, params: dict | None = None, body: dict | None = None, env=None):
    """Appel API DNSHE authentifié (en-têtes, jamais les paramètres d'URL)."""
    env = env if env is not None else os.environ
    key, secret = env.get("DNSHE_API_KEY"), env.get("DNSHE_API_SECRET")
    if not key or not secret:
        raise SystemExit("DNSHE_API_KEY / DNSHE_API_SECRET absents de l'environnement")
    url = f"{API}&endpoint={endpoint}&action={action}"
    if params:
        url += "&" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "X-API-Key": key,
            "X-API-Secret": secret,
            "user-agent": USER_AGENT,
            "content-type": "application/json",
        },
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SystemExit(f"DNSHE {endpoint}/{action} → HTTP {error.code} : {error.read().decode('utf-8', 'replace')[:200]}")
    # DNSHE répond 200 avec `success: false` (clé refusée, quota, action refusée) :
    # sans ce contrôle, un échec d'authentification se lit « zone introuvable ».
    if isinstance(payload, dict) and payload.get("success") is False:
        raise SystemExit(f"DNSHE {endpoint}/{action} → refusé : {payload.get('message') or payload}")
    return payload


def dmarc_record(domain: str, env=None) -> tuple[dict, dict]:
    """(sous-domaine, enregistrement TXT `_dmarc`) du domaine."""
    # `search` et non `rootdomain` : DNSHE décrit `kojoforafrica.cc.cd` comme le
    # sous-domaine « kojoforafrica » de la racine « cc.dd » — filtrer sur le nom
    # complet rend une liste vide, qu'on lirait à tort comme « zone absente ».
    listing = api_call("subdomains", "list", {"search": domain}, env=env)
    zones = listing.get("subdomains") or []
    zone = next((entry for entry in zones if entry.get("full_domain") == domain), None)
    if zone is None:
        raise SystemExit(
            f"zone {domain} introuvable dans le compte DNSHE "
            f"({len(zones)} sous-domaine(s) renvoyé(s) : {[z.get('full_domain') for z in zones]})"
        )

    records = api_call("dns_records", "list", {"subdomain_id": zone["id"]}, env=env).get("records") or []
    wanted = f"{DMARC_HOST}.{domain}"
    record = next(
        (entry for entry in records if entry.get("type") == "TXT" and entry.get("name") in (wanted, DMARC_HOST)),
        None,
    )
    if record is None:
        raise SystemExit(f"aucun TXT {wanted} — publier d'abord la politique DMARC ({len(records)} enregistrements lus)")
    return zone, record


def publish(domain: str, stage_name: str, env=None, state_path=None) -> dict:
    """Écrit le record de l'étape, NOTE son début, et renvoie la relecture (pas
    l'intention : ce qui compte est ce que le DNS sert après l'écriture)."""
    zone, record = dmarc_record(domain, env=env)
    content = build_record(stage_name)
    api_call(
        "dns_records",
        "update",
        body={"id": record["id"], "type": "TXT", "name": DMARC_HOST, "content": content, "ttl": FAST_TTL},
        env=env,
    )
    _zone, written = dmarc_record(domain, env=env)
    state = write_state(stage_name, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), state_path)
    return {
        "content": written.get("content"),
        "ttl": written.get("ttl"),
        "subdomain_id": zone["id"],
        "state": state,
    }


def describe(domain: str, env=None, state_path=None) -> dict:
    """État réel du domaine : record publié, étape reconnue, date de début, et
    si la montée est permise."""
    _zone, record = dmarc_record(domain, env=env)
    content = record.get("content") or ""
    stage = stage_of(content)
    state = read_state(state_path)
    started_at = policy_started_at(record, state, stage) if stage else None
    return {
        "content": content,
        "ttl": record.get("ttl"),
        "stage": stage,
        "started_at": started_at,
        "days_in_stage": days_since(started_at) if started_at else None,
        "next": next_stage(stage),
        "blocked": ramp_blocked_by(stage, started_at),
        "state": state,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("show", "ramp", "rollback"))
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    parser.add_argument("--state", default=None, help="chemin de l'horloge d'observation (tests)")
    args = parser.parse_args(argv)

    state_path = Path(args.state) if args.state else None

    if args.command == "show":
        state = describe(args.domain, state_path=state_path)
        print(f"_dmarc.{args.domain} → {state['content']}")
        print(f"  TTL {state['ttl']} · étape « {state['stage']} » · suivante : {state['next'] or '(terminée)'}")
        if state["started_at"]:
            print(f"  en place depuis {state['days_in_stage']} jour(s) (depuis {state['started_at']})")
        else:
            print("  étape non datée (aucun horodatage DNS, état local sans cette étape)")
        print(f"  montée : {'BLOQUÉE — ' + state['blocked'] if state['blocked'] else 'autorisée'}")
        print(f"  horloge d'observation : {(state_path or STATE_FILE)}")
        return 0

    if args.command == "rollback":
        result = publish(args.domain, "observe", state_path=state_path)
        print(f"⏪ RETOUR ARRIÈRE → {result['content']} (TTL {result['ttl']}), noté {result['state']['published_at']}")
        print("   `rua` conservé : les rapports agrégés continuent d'arriver pendant le diagnostic")
        print("   " + propagation_report(f"{DMARC_HOST}.{args.domain}", result["content"]))
        return 0

    state = describe(args.domain, state_path=state_path)
    if state["blocked"]:
        print(f"⛔ montée refusée : {state['blocked']}")
        print(f"   record actuel : {state['content']} (étape « {state['stage']} »)")
        return 1
    target = state["next"]
    result = publish(args.domain, target, state_path=state_path)
    print(f"⏫ étape « {target} » → {result['content']} (TTL {result['ttl']}), noté {result['state']['published_at']}")
    print(f"   {STAGE_BY_NAME[target]['why']}")
    print("   " + propagation_report(f"{DMARC_HOST}.{args.domain}", result["content"]))
    print(f"   retour arrière : python {os.path.basename(__file__)} rollback")
    return 0


if __name__ == "__main__":
    sys.exit(main())
