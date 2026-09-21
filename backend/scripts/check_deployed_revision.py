#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le backend SERVI est-il bien celui de ce commit ?

── Le trou que ce garde ferme ──────────────────────────────────────────────
Le job `deploy-fly` filtrait sur `backend/**` : un push qui ne touchait que le
frontend laissait ses étapes de déploiement en `skipped` et le job passait au
vert. « main est vert » pouvait donc signifier deux choses opposées — « le
backend déployé est celui de ce commit » et « rien n'a été déployé, le service
tourne la version précédente » — sans qu'aucun job ne puisse les distinguer. Le
20/09/2026 le job s'est mis à ÉCRIRE laquelle des deux, ce qui rend le ✓ lisible
mais ne VÉRIFIE rien : une déclaration n'est pas une preuve.

Le service répond désormais à la question qu'on lui posait à sa place :
`/health` publie `revision` (le commit dont l'image a été construite, injecté au
build par `--build-arg KOJO_GIT_SHA`). Ce garde interroge la production et
compare cette réponse à la révision ATTENDUE — celle que ce push aurait dû
déployer :

  • push qui touche `backend/**` (ou le workflow) → l'attendu est le commit poussé ;
  • push qui n'y touche pas → l'attendu est le dernier commit qui y a touché
    (déploiement sauté : le service DOIT tourner cette révision-là, et le job
    échoue si ce n'est pas le cas).

── Ce que ce garde refuse, et pourquoi il le NOMME ─────────────────────────
Trois pannes distinctes, trois corrections distinctes — un seul « échec » les
confondrait :
  1. `revision` vaut « inconnue » : l'image servie est antérieure à ce mécanisme,
     ou elle a été construite sans `--build-arg`. Correction : redéployer.
  2. `revision` est un autre commit : le déploiement n'a pas abouti, ou une
     machine ancienne répond encore. Correction : regarder le job, redéployer.
  3. Aucune réponse exploitable : le service ne répond pas (ou pas du JSON), donc
     RIEN ne peut être affirmé sur le déploiement. Correction : regarder Fly.

Un garde qui ne peut pas savoir ce qu'il compare ÉCHOUE (code 2) au lieu de
passer : `--attendu` vide, ou une valeur trop courte pour être un identifiant de
commit, sont des erreurs d'invocation, pas des succès.

Usage :
    python3 backend/scripts/check_deployed_revision.py --attendu <sha>
Optionnel :
    --url https://api.kojoforafrica.cc.cd/health   (défaut : env KOJO_BACKEND_HEALTH_URL)
    --tentatives 6 --delai 20                      (attente d'un déploiement en cours)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Adresse par défaut : la même que fly.toml (BACKEND_PUBLIC_URL), jamais un
# hôte interne — ce garde mesure ce qu'un client reçoit.
URL_PAR_DEFAUT = os.environ.get(
    "KOJO_BACKEND_HEALTH_URL", "https://api.kojoforafrica.cc.cd/health"
).strip()

# Longueur minimale d'un SHA de commit : en dessous, ce n'est pas un identifiant
# de commit mais une chaîne quelconque — comparer là-dessus serait un faux vert.
LONGUEUR_SHA_MIN = 7

# Valeurs qui ne sont pas une révision : le défaut du Dockerfile, et le vide.
REVISIONS_ABSENTES = {"", "inconnue", "unknown", "none", "null"}

# Un refus qui plante n'est pas un refus qui NOMME. Sous Windows la console est
# en cp1252 : les accents et «≠» y lèvent UnicodeEncodeError, donc le message
# (servi vs attendu) mourait dans une traceback au lieu d'être lu — la CI, en
# UTF-8 partout, ne le voit jamais (même classe de défaut que test_cors_origins,
# cf. AGENTS.md). On garde l'encodage de la console et on remplace seulement ce
# qu'elle ne sait pas écrire : le verdict et les deux SHA, eux, sont ASCII.
for _flux in (sys.stdout, sys.stderr):
    try:
        _flux.reconfigure(errors="replace")
    except (AttributeError, ValueError):  # flux redirigé/remplacé : rien à faire
        pass


def normaliser(valeur) -> str:
    """La valeur est-elle une RÉVISION ? Vide et « inconnue » ne le sont pas.

    Une seule fonction pour les deux côtés de la comparaison : sans ça, un
    « inconnue » attendu (ou servi) pourrait être comparé à un « inconnue » reçu
    et se déclarer concordant — le faux vert exact que ce garde existe pour
    fermer.
    """
    if not isinstance(valeur, str):
        return ""
    valeur = valeur.strip()
    return "" if valeur.lower() in REVISIONS_ABSENTES else valeur


def revision_annoncee(payload) -> str:
    """La révision publiée par le service, ou '' si la réponse n'en porte pas."""
    if not isinstance(payload, dict):
        return ""
    return normaliser(payload.get("revision"))


def comparer(attendue: str, servie: str) -> tuple[bool, str]:
    """Le verdict, avec le coupable nommé dans chaque cas."""
    attendue = normaliser(attendue)
    servie = normaliser(servie)

    if not servie:
        return False, (
            "le backend servi n'annonce AUCUNE révision (champ `revision` absent ou "
            "« inconnue ») : l'image déployée est antérieure à ce mécanisme, ou elle a "
            "été construite sans `--build-arg KOJO_GIT_SHA`. Redéployer le backend "
            "(job deploy-fly) — tant que ce champ se tait, rien ne prouve quelle "
            "version tourne."
        )
    if servie == attendue:
        return True, "révision servie = attendue (%s)" % servie[:12]
    return False, (
        "révision servie ≠ attendue : servi=%s attendu=%s — le backend déployé n'est "
        "pas celui de ce commit (déploiement non abouti, ou machine ancienne encore "
        "répondante)." % (servie[:12], attendue[:12] or "(aucune)")
    )


def interroger(url: str, fetch=None, timeout: float = 20.0):
    """(payload, erreur) — l'erreur est un message ou None. Aucune exception ne sort."""
    fetch = fetch or _fetch_defaut
    try:
        statut, corps = fetch(url, timeout)
    except urllib.error.HTTPError as exc:  # pragma: no cover - dépend du réseau
        return None, "HTTP %s" % exc.code
    except Exception as exc:  # réseau, DNS, TLS, timeout…
        return None, "%s: %s" % (type(exc).__name__, exc)
    if statut != 200:
        return None, "HTTP %s (attendu 200)" % statut
    try:
        return json.loads(corps), None
    except ValueError:
        return None, "réponse non JSON (le service ne répond pas /health)"


def _fetch_defaut(url: str, timeout: float):
    with urllib.request.urlopen(url, timeout=timeout) as reponse:
        return reponse.status, reponse.read()


def verifier_servi(
    url: str,
    attendue: str,
    fetch=None,
    tentatives: int = 6,
    delai: float = 20.0,
    dormir=time.sleep,
    log=print,
) -> tuple[bool, list[str]]:
    """Interroge le service jusqu'à ce qu'il annonce la révision attendue.

    Les tentatives absorbent le déploiement en cours (une image qui vient d'être
    poussée met quelques secondes à répondre) ; elles ne transforment pas un refus
    en succès, elles attendent que la réponse change.
    """
    journal: list[str] = []
    verdict, message = False, "aucune tentative"
    for tentative in range(1, max(1, tentatives) + 1):
        payload, erreur = interroger(url, fetch=fetch)
        if payload is None:
            verdict, message = False, (
                "aucune réponse exploitable de %s : %s — rien ne peut être affirmé sur "
                "le déploiement." % (url, erreur)
            )
        else:
            verdict, message = comparer(attendue, revision_annoncee(payload))
        journal.append("tentative %d/%d : %s" % (tentative, tentatives, message))
        log("  %s" % journal[-1])
        if verdict:
            return True, journal
        if tentative < tentatives:
            dormir(delai)
    return False, journal


def _valider_attendu(attendu: str) -> str:
    """Refuse une invocation qui ne dit pas quoi comparer (code 2, pas un succès)."""
    brut = (attendu or "").strip()
    attendu = normaliser(brut)
    if len(attendu) < LONGUEUR_SHA_MIN:
        print(
            "::error::--attendu manquant, générique ou trop court (%r) : ce garde compare "
            "la révision servie à un identifiant de commit, il ne peut pas conclure sans "
            "lui. Passer le SHA attendu (commit poussé, ou dernier commit qui a touché "
            "backend/**)." % brut,
            file=sys.stderr,
        )
        raise SystemExit(2)
    return attendu


def main(argv=None) -> int:
    analyseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    analyseur.add_argument("--attendu", default=os.environ.get("KOJO_ATTENDU", ""),
                           help="révision attendue (SHA du commit)")
    analyseur.add_argument("--url", default=URL_PAR_DEFAUT,
                           help="URL du health check à interroger")
    analyseur.add_argument("--tentatives", type=int, default=6)
    analyseur.add_argument("--delai", type=float, default=20.0)
    options = analyseur.parse_args(argv)

    attendu = _valider_attendu(options.attendu)
    print("Révision attendue : %s" % attendu)
    print("Interrogation de %s…" % options.url)

    ok, journal = verifier_servi(
        options.url, attendu,
        tentatives=options.tentatives, delai=options.delai,
    )
    if ok:
        print("::notice title=Backend servi::%s — le service tourne bien le commit attendu."
              % journal[-1])
        return 0
    erreur = journal[-1]
    if "aucune réponse exploitable" in erreur:
        print("::error title=Backend injoignable::%s (URL %s)" % (erreur, options.url))
    elif "AUCUNE révision" in erreur:
        print("::error title=Révision non annoncée::%s" % erreur)
    else:
        print("::error title=Révision déployée ≠ attendue::%s" % erreur)
    return 1


if __name__ == "__main__":
    sys.exit(main())
