#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sonde de l'assistant support en PRODUCTION : il doit GUIDER, pas seulement dire
« je ne sais pas ».

Ce que cette sonde existe pour empêcher, et qui a eu lieu le 23/10/2026 :

  * `POST /api/support/robot/chat` a répondu **502** parce que le modèle avait
    épuisé son plafond de jetons (`finish_reason: length`) — un visiteur sans
    réponse, invisible tant que personne ne posait la question ;
  * le même jour, un **200** portait une réponse VIDE ;
  * et avant l'enrichissement du prompt, la réponse était honnête mais inutile :
    « je ne sais pas » devant « comment publier une mission ? », alors que le
    site a une page, un bouton et des délais.

La sonde pose donc TROIS questions de référence — publier, être payé, litige —
et juge la réponse servie, pas seulement le statut :

  1. statut HTTP 200 (un 502/503 est refusé en le NOMMANT) ;
  2. réponse non vide (et d'une longueur qui vaut une réponse) ;
  3. l'ÉTAPE attendue est citée (par exemple `/create-job` pour publier,
     « litige » pour un désaccord) — une réponse qui n'oriente vers rien ne
     répare rien ;
  4. le texte est FINAL : ni brouillon (« Wait, should I include ticket? »,
     « Let me think », étiquette « Draft: »), ni répétition (la même phrase
     servie deux fois), ni marqueur mécanique visible (`[KOJO_TICKET]`). Le
     modèle avait rendu son raisonnement dans le champ de réponse, et le
     client WhatsApp comme la page `/support` affichent ce champ tel quel.

Trois sorties, jamais deux :

  0  conforme : les trois réponses sont non vides et citent l'étape attendue ;
  1  refus nommé : statut, réponse vide ou étape absente, avec la question, la
     cause et un extrait de ce qui a été servi ;
  2  prémisse : le budget de la journée est atteint (429 du produit) ou l'URL
     est inutilisable — aucun verdict n'est rendu, et ce n'est PAS un vert.

Aucune écriture, aucun secret : la route est publique et la sonde ne lit que
`reply` (le jeton et l'hôte ne sortent jamais du serveur).

Usage :
    python backend/scripts/check_ai_assistant_probe.py [--url URL] [--timeout 90]
"""

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

DEFAULT_URL = "https://api.kojoforafrica.cc.cd/api/support/robot/chat"
AGENT = "KojoAssistantProbe/1.0"

# Une réponse plus courte que cela n'oriente personne : c'est le plancher qui
# attrape une réponse vide ET un texte du genre « OK ».
LONGUEUR_MINIMALE = 40

# Ce qui trahit un texte NON FINAL. Le 23/10/2026, le modèle a écrit dans le
# champ de réponse « Wait, should I include ticket? No… » avant de se reprendre
# et de répéter sa réponse. Ces marques sont ANGLAISES dans une réponse
# française : c'est ce qui les rend reconnaissables sans juger le fond. La
# liste reste volontairement courte — un mot français courant (« attends »,
# « en fait ») est une prose légitime, pas une fuite de raisonnement.
MARQUEURS_BROUILLON = (
    "wait,",
    "wait…",
    "wait...",
    "hmm,",
    "hmm…",
    "let me think",
    "let me check",
    "let me reconsider",
    "should i ",
    "i should ",
    "i need to ",
    "draft:",
    "reasoning:",
    "thought:",
    "final answer:",
    "brouillon :",
    "raisonnement :",
    "réfléchissons",
)

# Le marqueur d'escalade est un mot du protocole avec le modèle : le serveur le
# RETIRE avant de rendre la réponse. S'il apparaît, la mécanique est visible.
MARQUEUR_VISIBLE = "KOJO_TICKET"

# En dessous, une phrase répétée est un fragment de prose normal (« Oui. »).
LONGUEUR_PHRASE = 30

# Les trois parcours que la personne vient chercher. `attendus` est une suite de
# GROUPES : chaque groupe doit être satisfait par au moins une de ses
# alternatives, pour qu'une reformulation légitime ne fasse pas rougir la sonde.
# Les libellés sont ceux du site (`/create-job`, « Ouvrir un litige »).
QUESTIONS_DE_REFERENCE = (
    {
        "cle": "publication",
        "question": "Comment publier une mission ?",
        "attendus": (
            ("create-job", "publier un emploi"),
        ),
    },
    {
        "cle": "paiement",
        "question": "J'ai fini la mission, quand vais-je recevoir mon argent ?",
        "attendus": (
            ("versement", "mobile money", "orange money"),
        ),
    },
    {
        "cle": "litige",
        "question": "Le travailleur a mal fait le travail, que faire ?",
        "attendus": (
            ("litige",),
        ),
    },
)


def _sans_accent(texte: str) -> str:
    """Minuscules sans accents : le modèle peut écrire « payé » ou « paye »."""
    decompose = unicodedata.normalize("NFKD", (texte or "").lower())
    return "".join(c for c in decompose if not unicodedata.combining(c))


def _poster(url: str, question: str, timeout: int):
    """Pose une question à l'assistant : rend `(statut, corps, erreur)`.

    Ne lève jamais : une panne de transport est un VERDICT à nommer, pas une
    exception qui ferait tomber la sonde sans dire pourquoi.
    """
    corps = json.dumps(
        {"messages": [{"role": "user", "content": question}], "language": "fr"}
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=corps,
        headers={"Content-Type": "application/json", "User-Agent": AGENT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as reponse:
            return reponse.status, reponse.read().decode("utf-8", "replace"), None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, "", f"{type(exc).__name__}: {exc}"


def _detail(corps: str) -> str:
    """Cause lisible d'un refus : le `detail` du backend, sinon le corps brut."""
    try:
        charge = json.loads(corps)
    except (ValueError, TypeError):
        return (corps or "").strip()[:200] or "corps vide"
    detail = charge.get("detail") if isinstance(charge, dict) else None
    if isinstance(detail, dict):
        return json.dumps(detail, ensure_ascii=False)[:220]
    if detail:
        return str(detail)[:220]
    return json.dumps(charge, ensure_ascii=False)[:220]


def _groupes_manquants(reponse: str, attendus) -> list:
    """Groupes d'étapes qu'aucune alternative ne couvre."""
    texte = _sans_accent(reponse)
    return [groupe for groupe in attendus if not any(_sans_accent(a) in texte for a in groupe)]


def _phrases(texte: str) -> list:
    """Phrases comparables : minuscules, sans accents, bornes de ponctuation."""
    morceaux = re.split(r"[.!?\n]+", _sans_accent(texte))
    return [m.strip() for m in morceaux if len(m.strip()) >= LONGUEUR_PHRASE]


def _phrases_repetees(texte: str) -> list:
    """Phrases servies plus d'une fois : un doublon, pas une reprise."""
    vues = {}
    for phrase in _phrases(texte):
        vues[phrase] = vues.get(phrase, 0) + 1
    return [phrase for phrase, fois in vues.items() if fois > 1]


def _defauts_de_forme(reponse: str) -> list:
    """Ce qui prouve que le texte n'est pas la réponse FINALE, nommé.

    Trois familles, parce que trois choses ont été servies à un visiteur : un
    brouillon de raisonnement, la même phrase deux fois, et le marqueur
    d'escalade que le serveur devait retirer. Chaque défaut est nommé avec sa
    preuve (le marqueur, la phrase) : « réponse non conforme » ne dirait pas
    quoi corriger.
    """
    texte = reponse or ""
    bas = _sans_accent(texte)
    defauts = []

    for marqueur in MARQUEURS_BROUILLON:
        if _sans_accent(marqueur) in bas:
            defauts.append(f"brouillon (« {marqueur.strip()} »)")

    if MARQUEUR_VISIBLE.lower() in bas:
        defauts.append(f"marqueur visible ([{MARQUEUR_VISIBLE}])")

    repetees = _phrases_repetees(texte)
    if repetees:
        defauts.append(f"repetition (« {repetees[0][:60]} »)")

    return defauts


def verifier_assistant(url: str = DEFAULT_URL, timeout: int = 90) -> int:
    """Juge l'assistant servi en production. Rend 0, 1 (refus nommé) ou 2."""
    if not (url or "").strip().lower().startswith(("http://", "https://")):
        print(f"[PREMISSE] URL inutilisable : {url!r} — aucun verdict rendu ici")
        return 2

    erreurs = []

    for reference in QUESTIONS_DE_REFERENCE:
        cle = reference["cle"]
        question = reference["question"]
        debut = time.time()
        statut, corps, erreur = _poster(url, question, timeout)
        duree = time.time() - debut

        if erreur:
            message = f"{cle} : assistant injoignable ({erreur})"
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        # 429 = le plafond de la journée est atteint : c'est le produit qui
        # protège sa facture, pas une régression. Aucun verdict n'est rendu.
        if statut == 429:
            print(
                f"[PREMISSE] {cle} : budget quotidien de l'assistant atteint "
                f"(HTTP 429) — aucun verdict rendu ici (Retry-After : "
                f"{_detail(corps)})"
            )
            return 2

        # 502/503 = le gateway ou le modèle n'a pas produit de réponse : c'est
        # l'indisponibilité de l'assistant, pas une forme à corriger.
        if statut in (502, 503):
            message = f"{cle} : assistant indisponible (HTTP {statut}) — {_detail(corps)}"
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        if statut != 200:
            cause = _detail(corps)
            message = f"{cle} : HTTP {statut} — {cause}"
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        try:
            charge = json.loads(corps)
            reponse = charge.get("reply") if isinstance(charge, dict) else None
        except (ValueError, TypeError):
            charge, reponse = None, None

        if not isinstance(reponse, str) or len(reponse.strip()) < LONGUEUR_MINIMALE:
            message = (
                f"{cle} : reponse vide ou trop courte "
                f"({len((reponse or '').strip())} caracteres, plancher {LONGUEUR_MINIMALE})"
            )
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        defauts = _defauts_de_forme(reponse)
        if defauts:
            extrait = reponse.strip().replace("\n", " ")[:160]
            message = (
                f"{cle} : texte non final ({' ; '.join(defauts)}) — servi : « {extrait} »"
            )
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        manquants = _groupes_manquants(reponse, reference["attendus"])
        if manquants:
            attendu = " / ".join(" ou ".join(g) for g in manquants)
            extrait = reponse.strip().replace("\n", " ")[:160]
            message = f"{cle} : etape attendue absente ({attendu}) — servi : « {extrait} »"
            print(f"[ERREUR] {message}")
            erreurs.append(message)
            continue

        modele = (charge or {}).get("model") or "?"
        print(f"[OK] {cle} : HTTP 200, {len(reponse.strip())} caracteres, {duree:.1f}s, modele={modele}")

    if erreurs:
        print("\n[ERREUR] L'ASSISTANT SUPPORT N'EST PAS CONFORME EN PRODUCTION :")
        for message in erreurs:
            print(f" - {message}")
        return 1

    print(
        "\n[SUCCESS] Les trois parcours de reference (publier, etre paye, litige) "
        "recoivent une reponse non vide qui cite l'etape attendue."
    )
    return 0


def main():
    parser = argparse.ArgumentParser(description="Sonde de l'assistant support Kojo en production")
    parser.add_argument("--url", default=DEFAULT_URL, help="URL de /api/support/robot/chat")
    parser.add_argument("--timeout", type=int, default=90, help="Delai d'attente par question (s)")
    args = parser.parse_args()

    sys.exit(verifier_assistant(args.url, args.timeout))


if __name__ == "__main__":
    main()
