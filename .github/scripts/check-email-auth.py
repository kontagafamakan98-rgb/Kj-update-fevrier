#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sonde email transactionnel : SPF/DKIM/DMARC LUS sur un message réellement reçu.

── Pourquoi lire au lieu de supposer ────────────────────────────────────────
Le domaine `kojoforafrica.cc.cd` est authentifié (SPF, deux CNAME DKIM chez
Brevo, DMARC), et Brevo répond `dkimError: false` / `spfError: false` sur son
domaine. Rien de tout cela ne prouve qu'un email LIVRÉ passe les trois : ce que
vérifie un récepteur (Gmail) dépend de la signature telle qu'elle arrive, de
l'IP qui se connecte et de l'alignement DMARC. Jusqu'ici, cette vérification
dépendait d'un humain ouvrant « Afficher l'original » dans sa boîte.

── Ce qui est vérifié ici, et par qui ──────────────────────────────────────
La sonde envoie un vrai email via l'API de PRODUCTION (l'étape OTP d'un alias
Gmail dédié), puis lit l'en-tête `Authentication-Results` que Gmail pose à la
RÉCEPTION et qui porte les trois verdicts. C'est le seul endroit où ils
existent :

  • une boîte jetable ne les enregistre pas (mesuré sur mail.tm : aucune
    occurrence de l'en-tête, aucun `Received-SPF`) ;
  • les recalculer soi-même sur la copie reçue est impossible — le récepteur
    réécrit le corps, donc le `bh` signé ne correspond plus (mesuré : `bh`
    annoncé `BbH7…`, `bh` recalculé `uaXR…`, signature invalide). L'octet
    signé n'existe plus qu'à la réception.

── Ce que la sonde refuse de faire ────────────────────────────────────────
Sans identifiants, elle ANNULE en le disant (`::notice`, code 0) plutôt que de
sortir verte : un run qui n'a rien vérifié doit se lire comme tel. Identifiants
présents mais boîte injoignable ou message absent = échec (code 1) : un secret
périmé ou un chemin d'envoi cassé sont des régressions, pas des faits
d'exploitation.

Usage :
    KOJO_PROBE_IMAP_USER=… KOJO_PROBE_IMAP_PASSWORD=… python .github/scripts/check-email-auth.py
"""

from __future__ import annotations

import argparse
import imaplib
import json
import os
import re
import secrets
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from email import message_from_bytes

BACKEND_DEFAULT = "https://api.kojoforafrica.cc.cd"
SEND_PATH = "/api/auth/email/send-otp"
IMAP_HOST_DEFAULT = "imap.gmail.com"
IMAP_PORT = 993
ALIAS_TAG = "kojo-probe"
MECHANISMS = ("spf", "dkim", "dmarc")
EXPECTED = "pass"

# `dkim=pass header.i=@d ; spf=fail (...) smtp.mailfrom=d ; dmarc=none ...` —
# le verdict est le premier jeton après le nom du mécanisme.
VERDICT_RE = re.compile(r"\b(spf|dkim|dmarc)\s*=\s*([A-Za-z]+)", re.IGNORECASE)


def probe_alias(inbox: str, token: str | None = None) -> str:
    """Alias unique de la boîte de test (`user+kojo-probe-<jeton>@domaine`).

    Un alias par run : le jeton évite d'attraper le message du run précédent
    (et de valider un email d'hier).
    """
    local, _, domain = inbox.partition("@")
    if not domain:
        raise ValueError("KOJO_PROBE_IMAP_USER doit être une adresse email")
    return f"{local}+{ALIAS_TAG}-{token or secrets.token_hex(4)}@{domain}"


def authentication_verdicts(raw_headers: bytes | str):
    """Lit les verdicts du RÉCEPTEUR dans les en-têtes du message reçu.

    Prend le PREMIER `Authentication-Results` — celui que le récepteur qui a
    évalué le message a posé en tête. Lire un en-tête plus bas accepterait un
    `Authentication-Results` fabriqué par l'expéditeur, c'est-à-dire
    exactement ce que DKIM/DMARC cherchent à empêcher.

    Returns:
        (verdicts, transcript) — `verdicts` mappe mécanisme → verdict constaté
        (parmi spf/dkim/dmarc, absents omis) et `transcript` est la valeur
        dépliée de l'en-tête lu, pour la preuve imprimée.
    """
    if isinstance(raw_headers, str):
        raw_headers = raw_headers.encode("utf-8", "replace")
    # `message_from_bytes` accepte un bloc d'en-têtes seul (RFC 5322) : c'est
    # exactement ce que `BODY.PEEK[HEADER]` renvoie.
    found = message_from_bytes(raw_headers).get_all("Authentication-Results")
    if not found:
        return {}, ""
    transcript = " ".join(str(found[0]).split())
    verdicts: dict[str, str] = {}
    for name, verdict in VERDICT_RE.findall(transcript):
        verdicts.setdefault(name.lower(), verdict.lower())
    return verdicts, transcript


def evaluate(verdicts: dict[str, str], expected: str = EXPECTED) -> list[str]:
    """Manquements observés, un par mécanisme — liste vide si tout passe."""
    problems = []
    for mechanism in MECHANISMS:
        verdict = verdicts.get(mechanism)
        if verdict is None:
            problems.append(f"{mechanism}=absent (aucun verdict dans Authentication-Results)")
        elif verdict != expected:
            problems.append(f"{mechanism}={verdict} (attendu {expected})")
    return problems


def credentials(env: dict[str, str]):
    """Identifiants IMAP, ou None si la sonde n'est pas configurée."""
    user = (env.get("KOJO_PROBE_IMAP_USER") or "").strip()
    password = (env.get("KOJO_PROBE_IMAP_PASSWORD") or "").strip()
    if not user or not password:
        return None
    return {
        "host": (env.get("KOJO_PROBE_IMAP_HOST") or IMAP_HOST_DEFAULT).strip(),
        "user": user,
        "password": password,
    }


def send_probe_email(backend: str, alias: str, timeout: float = 30.0) -> str:
    """Déclenche l'envoi de production vers l'alias. Renvoie le corps brut."""
    payload = json.dumps({"email": alias, "purpose": "signup"}).encode("utf-8")
    request = urllib.request.Request(
        backend.rstrip("/") + SEND_PATH,
        data=payload,
        headers={
            "content-type": "application/json",
            "user-agent": "kojo-email-auth-probe/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
            if response.status != 200:
                raise RuntimeError(f"HTTP {response.status} : {body[:200]}")
            return body
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:200]
        raise RuntimeError(f"HTTP {error.code} sur {SEND_PATH} : {detail}") from error


def open_inbox(creds: dict):
    """Ouvre une session IMAP et sélectionne INBOX en LECTURE SEULE.

    Une erreur de connexion ou d'identification remonte telle quelle : elle est
    définitive (mot de passe révoqué, IMAP désactivé) et doit arrêter la sonde
    immédiatement, pas être retentée jusqu'au délai.
    """
    box = imaplib.IMAP4_SSL(
        creds["host"], IMAP_PORT, ssl_context=ssl.create_default_context(), timeout=45
    )
    try:
        box.login(creds["user"], creds["password"])
        box.select("INBOX", readonly=True)
    except Exception:
        try:
            box.logout()
        except Exception:  # noqa: BLE001 — un logout raté ne masque pas l'erreur d'origine
            pass
        raise
    return box


def fetch_probe_headers(creds: dict, alias: str, timeout: float = 180.0, poll: float = 10.0,
                        imap_factory=None, sleep=time.sleep) -> bytes:
    """Attend le message de l'alias et renvoie ses EN-TÊTES bruts.

    `BODY.PEEK[HEADER]` : on ne marque pas le message comme lu (la boîte reste
    utilisable à la main) et on ne télécharge pas un corps inutile.

    ⚠️ Une session NEUVE à chaque essai, et non une session gardée ouverte.
    Mesuré le 18/09/2026 sur la boîte réelle, avec le MÊME message : une session
    ouverte AVANT l'arrivée ne le voit jamais (240 s d'essais sans le voir),
    tandis qu'une session ouverte après le trouve en 14 s. La livraison, elle,
    est immédiate (`INTERNALDATE` = `Date` d'émission à 1 s près) : l'ancienne
    optimisation « une seule connexion pour épargner Gmail » faisait donc
    échouer la sonde à tous les coups en accusant la livraison.

    Une erreur d'IDENTIFICATION interrompt la sonde immédiatement (cf.
    `open_inbox`) ; une session qui tombe en cours de route est simplement
    remplacée au tour suivant.
    """
    open_box = imap_factory or open_inbox
    deadline = time.monotonic() + timeout
    while True:
        # Hors du `try` : une identification refusée est définitive et doit
        # arrêter la sonde tout de suite, pas être retentée jusqu'au délai.
        box = open_box(creds)
        try:
            typ, data = box.search(None, "TO", f'"{alias}"')
            if typ == "OK" and data and data[0].split():
                number = data[0].split()[-1]
                typ, fetched = box.fetch(number, "(BODY.PEEK[HEADER])")
                if typ == "OK" and fetched and isinstance(fetched[0], tuple) and fetched[0][1]:
                    return fetched[0][1]
        except imaplib.IMAP4.error:
            # Session morte en cours de route : on en rouvre une au tour suivant.
            pass
        finally:
            try:
                box.logout()
            except Exception:  # noqa: BLE001 — un logout raté ne masque pas le verdict
                pass
        if time.monotonic() >= deadline:
            raise TimeoutError(f"aucun message pour {alias} après {int(timeout)} s")
        sleep(poll)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--backend", default=os.environ.get("KOJO_BACKEND_URL", BACKEND_DEFAULT))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("KOJO_EMAIL_PROBE_TIMEOUT", "180")))
    args = parser.parse_args(argv)

    creds = credentials(dict(os.environ))
    if not creds:
        print(
            "::notice title=Sonde email NON EXÉCUTÉE::"
            "KOJO_PROBE_IMAP_USER / KOJO_PROBE_IMAP_PASSWORD absents — SPF/DKIM/DMARC "
            "n'ont PAS été vérifiés (aucun verdict lu). Poser les deux secrets pour activer la sonde."
        )
        return 0

    alias = probe_alias(creds["user"])
    print(f"Sonde email : envoi d'un OTP de production vers {alias}")

    try:
        send_probe_email(args.backend, alias)
    except (RuntimeError, urllib.error.URLError) as error:
        print(f"::error title=Envoi impossible::{error}")
        return 1

    try:
        headers = fetch_probe_headers(creds, alias, timeout=args.timeout)
    except imaplib.IMAP4.error as error:
        # Définitif, et rien à voir avec la lecture d'un message : le titre le dit.
        print(
            f"::error title=Identification IMAP refusée::{error} — vérifier "
            "KOJO_PROBE_IMAP_USER (adresse complète de la boîte) et "
            "KOJO_PROBE_IMAP_PASSWORD (mot de passe d'APPLICATION de 16 lettres ; un mot de "
            "passe de compte Google est refusé en IMAP)."
        )
        return 1
    except (TimeoutError, OSError, ssl.SSLError) as error:
        print(f"::error title=Message non livré::{error} — l'envoi de production a répondu 200, "
              "donc c'est la livraison qui manque, pas l'authentification du message.")
        return 1

    verdicts, transcript = authentication_verdicts(headers)
    print(f"Authentication-Results lu : {transcript or '(absent)'}")

    problems = evaluate(verdicts)
    if problems:
        print("::error title=Authentification email en échec::" + " | ".join(problems))
        for problem in problems:
            print(f"  ❌ {problem}")
        print("  (le message est bien arrivé : le problème est la façon dont il est signé, pas la livraison)")
        return 1

    print(f"::notice title=Email authentifié::spf={verdicts['spf']} dkim={verdicts['dkim']} dmarc={verdicts['dmarc']}")
    print(f"✅ SPF, DKIM et DMARC au vert sur un message réellement reçu ({verdicts['dkim']}, {verdicts['dmarc']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
