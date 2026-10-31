#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ecrit une VEILLE EMPLOI REELLE en production, avec le compte travailleur CI.

CE QU'IL FERME, ET LA MESURE QUI L'A OUVERT (31/10/2026). Les quatre series de
provenance (`kojo_alertes_emploi{origine=…}`) et la jauge de fraicheur
(`kojo_alertes_emploi_plus_recente_timestamp_seconds`) ont un lecteur quotidien
depuis le 30/10 (`metriques-collecte.yml`), et ce lecteur a dit la verite : la
jauge vaut **0**, c'est-a-dire « aucune veille datee, jamais ». La sonde etait
verte sur la MECANIQUE de la collecte et rouge sur son OBJET — il n'existait
aucun chemin automatise pour ecrire une veille, donc les pages ville et metier
pouvaient rester muettes sans que personne ne le mesure autrement qu'en lisant
un zero.

CE QUE CE SCRIPT EST : ce chemin-la. Il se connecte a l'API de PRODUCTION avec
un compte TRAVAILLEUR dedie (provisionne par
`backend/scripts/provision_ci_test_account.py --type worker`), ecrit la veille
par `PUT /api/job-alerts` — la route que le navigateur appelle depuis /jobs —
puis RELIT ce que le serveur a enregistre par `GET /api/job-alerts`.

POURQUOI LA RELECTURE, ET PAS SEULEMENT LE 200. Un 200 sans ecriture s'affiche
« enregistre » dans l'interface : c'est exactement le defaut qui a ete corrige
dans la carte de /jobs le meme jour. Le fait mesure ici est ce que le SERVEUR
rend apres coup — `active`, la provenance, les criteres. Une reponse qui ne
correspond pas a la demande est un REFUS nomme, pas un succes.

POURQUOI CE N'EST PAS PLANIFIE. Une veille ecrite chaque matin par un cron
ferait mesurer la fraicheur de CE workflow au lieu de celle des visiteurs : la
jauge repondrait « acquisition fraiche » sur un corpus qui ne contient que la
CI. Le workflow est donc DISPATCHABLE a la main, deliberement — une ecriture
reelle, datee, pour prouver la chaine et alimenter la mesure ; pas un
simulateur qui la remplirait.

Trois sorties, jamais deux :

  0  la veille est ECRITE et RELUE conforme (active, provenance, criteres) ;
  1  refus nomme : provenance hors vocabulaire, identifiants absents, 401/403/
     422/429, ou une relecture qui ne dit pas ce qui a ete demande ;
  2  premisse : base inutilisable ou transport injoignable — aucun verdict.

Le cout de la passe (requetes, duree) est publie sur le vert comme sur le rouge,
sur la sortie standard ET dans `$GITHUB_STEP_SUMMARY`.

Usage :
    VEILLE_EMPLOI_EMAIL=... VEILLE_EMPLOI_PASSWORD=... \\
        python backend/scripts/semer_alerte_emploi.py --origine metier
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

# L'API de production. Le chemin est sous `/api` : `/health` et `/metrics` vivent
# hors prefixe, `/job-alerts` non.
BASE_PAR_DEFAUT = "https://api.kojoforafrica.cc.cd"
CHEMIN_LOGIN = "/api/auth/login"
CHEMIN_ALERTES = "/api/job-alerts"
AGENT = "KojoVeilleEmploi/1.0"

# Les secrets qui portent le compte TRAVAILLEUR dedie. Lus dans l'environnement
# uniquement : un mot de passe en argument de ligne de commande finit dans la
# liste des processus et dans les journaux du runner.
NOM_EMAIL = "VEILLE_EMPLOI_EMAIL"
NOM_MOT_DE_PASSE = "VEILLE_EMPLOI_PASSWORD"

# Les provenances DECLARABLES, recopiees de `kojo_job_alerts.ORIGINES_ALERTE` :
# ce script tourne depuis un runner sans le paquet backend installe.
# `backend/tests/test_veille_emploi_production.py` refuse que les deux listes
# divergent, pour que la copie ne puisse pas deriver en silence.
ORIGINES = ("ville", "metier", "directe")

# Ce que le corps de la veille porte, et rien de plus : `active` est envoye
# explicitement parce qu'une veille coupee puis reactivee doit repartir ACTIVE.
CATEGORIE_PAR_DEFAUT = "plumbing"
VILLE_PAR_DEFAUT = "Bamako"
PAYS_PAR_DEFAUT = "mali"

# Bornes du serveur (`kojo_job_alerts`) : refuser une valeur qu'il refuserait
# evite un aller-retour dont le 422 ne dirait rien de plus.
CATEGORIE_MAX = 50
VILLE_MAX = 100
PAYS_MAX = 50


class Premisse(RuntimeError):
    """Le transport a echoue : aucun verdict ne peut etre rendu."""


def _publier(lignes) -> None:
    """Ecrit le rapport sur la sortie standard ET dans le resume du job."""
    texte = "\n".join(lignes)
    print(texte)
    chemin = os.environ.get("GITHUB_STEP_SUMMARY")
    if not chemin:
        return
    try:
        with open(chemin, "a", encoding="utf-8") as resume:
            resume.write(texte + "\n")
    except OSError:
        # Un resume illisible n'est pas une raison de perdre le verdict.
        pass


def _detail(charge) -> str:
    """Cause lisible d'un refus : le `detail` du backend, sinon la charge brute."""
    if isinstance(charge, dict):
        texte = charge.get("detail") or charge.get("message") or ""
    else:
        texte = str(charge or "")
    texte = " ".join(str(texte).split())
    return texte[:200] or "corps vide"


def requete(base: str, methode: str, chemin: str, corps=None, *, token: str = "",
            timeout: int = 20):
    """Un appel a l'API de production. Rend `(statut, charge)` ; ne leve que sur reseau.

    Le jeton part en en-tete (jamais dans l'URL), et un statut non 2xx est RENDU :
    403 a un sens precis ici — le compte n'est pas un travailleur — et l'appelant
    seul peut le classer.
    """
    donnees = json.dumps(corps).encode("utf-8") if corps is not None else None
    entetes = {
        "Accept": "application/json",
        "User-Agent": AGENT,
        "Content-Type": "application/json",
    }
    if token:
        entetes["Authorization"] = "Bearer %s" % token
    appel = urllib.request.Request(
        "%s%s" % (base.rstrip("/"), chemin),
        data=donnees,
        method=methode,
        headers=entetes,
    )
    try:
        with urllib.request.urlopen(appel, timeout=timeout) as reponse:
            brut = reponse.read().decode("utf-8", "replace")
            return reponse.status, (json.loads(brut) if brut.strip() else {})
    except urllib.error.HTTPError as erreur:
        brut = erreur.read().decode("utf-8", "replace")
        try:
            charge = json.loads(brut) if brut.strip() else {}
        except ValueError:
            charge = {"message": brut[:200]}
        return erreur.code, charge
    except (urllib.error.URLError, TimeoutError, OSError) as erreur:
        raise Premisse("API injoignable (%s: %s)" % (type(erreur).__name__, erreur))


def _identifiants(email: str, mot_de_passe: str):
    """Les identifiants, lus dans l'environnement quand l'appelant n'en donne pas."""
    return (
        (email if email is not None else os.environ.get(NOM_EMAIL, "")).strip(),
        (mot_de_passe if mot_de_passe is not None else os.environ.get(NOM_MOT_DE_PASSE, "")).strip(),
    )


def verifier(
    base: str = BASE_PAR_DEFAUT,
    email: str = None,
    mot_de_passe: str = None,
    categorie: str = CATEGORIE_PAR_DEFAUT,
    ville: str = VILLE_PAR_DEFAUT,
    pays: str = PAYS_PAR_DEFAUT,
    origine: str = "metier",
    timeout: int = 20,
    http=requete,
) -> int:
    """Ecrit puis relit la veille emploi de production. Rend 0, 1 (refus) ou 2.

    `http` est injectable : les preuves scriptent les reponses du serveur sans
    reseau, et une passe complete est jouee contre un serveur HTTP REEL pour
    prouver que le corps envoye est bien celui que la route attend.
    """
    debut = time.time()
    requetes = 0

    # ── Ce qui se refuse AVANT toute requete ───────────────────────────────
    origine = (origine or "").strip().lower()
    if origine not in ORIGINES:
        _publier(
            [
                "[ERREUR] provenance HORS VOCABULAIRE : %r" % origine,
                "  Le serveur refuse en 422 une valeur qu'il ne connait pas, et une",
                "  valeur repliee en silence compterait dans la mauvaise colonne de la",
                "  mesure. Valeurs declarables : %s." % ", ".join(ORIGINES),
            ]
            + ["[COUT] 0 requete, %.2f s" % (time.time() - debut), "[VERDICT] refus"]
        )
        return 1

    email, mot_de_passe = _identifiants(email, mot_de_passe)
    if not email or not mot_de_passe:
        _publier(
            [
                "[ERREUR] Compte travailleur CI NON FOURNI : %s et %s doivent etre"
                % (NOM_EMAIL, NOM_MOT_DE_PASSE),
                "  definis (secrets GitHub, ou environnement local). Sans eux, aucune",
                "  veille ne peut etre ecrite, et la jauge de fraicheur reste a 0 —",
                "  ce qui se lit comme une acquisition tarie.",
                "  Remede : `gh secret set %s` / `gh secret set %s`, avec le compte"
                % (NOM_EMAIL, NOM_MOT_DE_PASSE),
                "  cree par `provision_ci_test_account.py --type worker`.",
            ]
            + ["[COUT] 0 requete, %.2f s" % (time.time() - debut), "[VERDICT] refus"]
        )
        return 1

    if not (base or "").strip().lower().startswith(("http://", "https://")):
        print("[PREMISSE] base inutilisable : %r — aucun verdict rendu ici" % (base,))
        return 2

    # ── 1. Se connecter comme TRAVAILLEUR ─────────────────────────────────
    try:
        statut, charge = http(
            base, "POST", CHEMIN_LOGIN, {"email": email, "password": mot_de_passe},
            token="", timeout=timeout,
        )
        requetes += 1
    except Premisse as erreur:
        print("[PREMISSE] %s — aucun verdict rendu ici" % erreur)
        return 2

    if statut != 200:
        remede = {
            401: "identifiants refuses : le mot de passe du secret n'est pas celui du compte",
            403: "compte ferme ou suspendu (bannissement) : la route de veille le refuserait aussi",
            429: "plafond de connexions atteint : relancer plus tard, le compte n'est pas en cause",
        }.get(statut, "reponse inattendue de /api/auth/login")
        _publier(
            [
                "[ERREUR] CONNEXION IMPOSSIBLE (HTTP %d) : %s — %s"
                % (statut, remede, _detail(charge)),
                "[COUT] %d requete(s), %.2f s" % (requetes, time.time() - debut),
                "[VERDICT] refus",
            ]
        )
        return 1

    jeton = (charge or {}).get("access_token") if isinstance(charge, dict) else None
    if not jeton:
        _publier(
            [
                "[ERREUR] Connexion acceptee (HTTP 200) SANS `access_token` : la reponse",
                "  n'est pas celle de /api/auth/login — rien ne peut etre ecrit sans elle.",
                "[COUT] %d requete(s), %.2f s" % (requetes, time.time() - debut),
                "[VERDICT] refus",
            ]
        )
        return 1

    type_compte = ""
    if isinstance(charge, dict) and isinstance(charge.get("user"), dict):
        type_compte = str(charge["user"].get("user_type") or "")

    # ── 2. Ecrire la veille ───────────────────────────────────────────────
    corps = {
        "category": categorie[:CATEGORIE_MAX],
        "city": ville[:VILLE_MAX],
        "country": pays[:PAYS_MAX],
        "active": True,
        "origin": origine,
    }
    try:
        statut, charge = http(
            base, "PUT", CHEMIN_ALERTES, corps, token=jeton, timeout=timeout
        )
        requetes += 1
    except Premisse as erreur:
        print("[PREMISSE] %s — aucun verdict rendu ici" % erreur)
        return 2

    if statut != 200:
        if statut == 403:
            cause = (
                "la veille est RESERVEE AUX TRAVAILLEURS et le compte connecte est "
                "de type « %s » : provisionner avec `--type worker`" % (type_compte or "?")
            )
        elif statut == 422:
            cause = "le serveur refuse ces criteres : %s" % _detail(charge)
        elif statut == 401:
            cause = "jeton refuse juste apres la connexion : %s" % _detail(charge)
        elif statut == 429:
            cause = "plafond de requetes atteint : relancer plus tard"
        else:
            cause = "HTTP %d inattendu — %s" % (statut, _detail(charge))
        _publier(
            [
                "[ERREUR] ECRITURE REFUSEE : %s" % cause,
                "[COUT] %d requete(s), %.2f s" % (requetes, time.time() - debut),
                "[VERDICT] refus",
            ]
        )
        return 1

    # Un 200 ne prouve pas l'ecriture : on juge la CHARGE rendue.
    ecrite = charge if isinstance(charge, dict) else {}
    if ecrite.get("active") is not True:
        _publier(
            [
                "[ERREUR] 200 SANS VEILLE ACTIVE : la reponse dit %r — une veille"
                % (ecrite.get("active"),),
                "  inerte n'enverra aucun email, et l'afficher « enregistree » serait",
                "  le defaut que la carte de /jobs a corrige le 31/10/2026.",
                "[COUT] %d requete(s), %.2f s" % (requetes, time.time() - debut),
                "[VERDICT] refus",
            ]
        )
        return 1

    if str(ecrite.get("origin") or "") != origine:
        _publier(
            [
                "[ERREUR] PROVENANCE RÉÉCRITE : demandee %r, enregistree %r"
                % (origine, ecrite.get("origin")),
                "  `origin` est ecrit par `$setOnInsert` : une valeur differente veut",
                "  dire que la veille existait DEJA (seule la creation en pose une),",
                "  donc que ce compte a deja mesure une autre page de depart.",
                "[COUT] %d requete(s), %.2f s" % (requetes, time.time() - debut),
                "[VERDICT] refus",
            ]
        )
        return 1

    # ── 3. Relire ce que le serveur a enregistre ──────────────────────────
    try:
        statut, relecture = http(
            base, "GET", CHEMIN_ALERTES, None, token=jeton, timeout=timeout
        )
        requetes += 1
    except Premisse as erreur:
        print("[PREMISSE] %s — aucun verdict rendu ici" % erreur)
        return 2

    lue = relecture if isinstance(relecture, dict) else {}
    ecarts = []
    if statut != 200:
        ecarts.append("GET /api/job-alerts a rendu HTTP %d (%s)" % (statut, _detail(relecture)))
    else:
        if lue.get("active") is not True:
            ecarts.append("la veille relue n'est pas active (%r)" % (lue.get("active"),))
        if str(lue.get("origin") or "") != origine:
            ecarts.append(
                "la provenance relue est %r au lieu de %r" % (lue.get("origin"), origine)
            )
        if (lue.get("category") or None) != corps["category"]:
            ecarts.append(
                "la categorie relue est %r au lieu de %r" % (lue.get("category"), corps["category"])
            )
        if (lue.get("city") or None) != corps["city"]:
            ecarts.append("la ville relue est %r au lieu de %r" % (lue.get("city"), corps["city"]))

    duree = time.time() - debut
    if ecarts:
        _publier(
            ["[ERREUR] LA VEILLE ECRITE NE SE RELIT PAS TELLE QUELLE :"]
            + [" - " + ecart for ecart in ecarts]
            + ["[COUT] %d requete(s), %.2f s" % (requetes, duree), "[VERDICT] refus"]
        )
        return 1

    _publier(
        [
            "[OK] connexion : compte %s (type %s)" % (email, type_compte or "?"),
            "[OK] veille ECRITE et RELUE : active, origine %s, categorie %s, ville %s, pays %s"
            % (origine, lue.get("category"), lue.get("city"), lue.get("country")),
            "  Les quatre series de provenance et la jauge de fraicheur la liront au",
            "  prochain passage de `metriques-collecte.yml` (07:48 UTC) : c'est la",
            "  mesure qui compte, pas cette ecriture.",
            "[COUT] %d requete(s), %.2f s" % (requetes, duree),
            "[VERDICT] conforme",
        ]
    )
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Ecrit une veille emploi reelle en production (compte travailleur CI)"
    )
    parser.add_argument("--base", default=BASE_PAR_DEFAUT, help="Origine de l'API")
    parser.add_argument("--categorie", default=CATEGORIE_PAR_DEFAUT)
    parser.add_argument("--ville", default=VILLE_PAR_DEFAUT)
    parser.add_argument("--pays", default=PAYS_PAR_DEFAUT)
    parser.add_argument(
        "--origine",
        default="metier",
        help="Provenance declaree : %s" % " | ".join(ORIGINES),
    )
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args(argv)

    return verifier(
        base=args.base,
        categorie=args.categorie,
        ville=args.ville,
        pays=args.pays,
        origine=args.origine,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    sys.exit(main())
