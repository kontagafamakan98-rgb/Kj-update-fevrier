#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sonde de COLLECTE des métriques Prometheus, en production.

CE QU'ELLE FERME, ET LA MESURE QUI L'A OUVERTE (30/10/2026). `GET /metrics`
publie six familles pour les veilles emploi : les quatre provenances
(`kojo_alertes_emploi{origine=…}`), le hors-vocabulaire, et la FRAÎCHEUR de
l'acquisition (`kojo_alertes_emploi_plus_recente_timestamp_seconds`). Mesuré ce
jour :

  * la route répond **401** sur `api.kojoforafrica.cc.cd` — donc un
    `METRICS_TOKEN` EST posé sur la machine Fly ;
  * l'origine du site répond **404** (Vercel ne proxifie que `/api/…`) : la
    même URL jugée au mauvais hôte se lirait comme une route disparue ;
  * le dépôt n'a AUCUN secret `METRICS_TOKEN` (`gh secret list`), et aucun
    collecteur n'est versionné : `backend/metrics/prometheus.yml` est une
    configuration que personne ne monte, et `backend/DEPLOY_FLYIO.md` disait la
    collecte « optionnelle ».

Autrement dit, les compteurs de provenance et la jauge de fraîcheur étaient
publiés dans le VIDE : personne ne pouvait les lire, et rien ne le disait. C'est
exactement la famille de défaut que l'alerte des sondes (`sondes-sante.yml`) a
fermée pour les crons — un run planifié rouge que personne ne voit —, restée
intacte ici.

CE QUE LA SONDE EST. Le LECTEUR QUOTIDIEN de ces chiffres, et la preuve qu'une
collecte a lieu : elle est planifiée (`.github/workflows/metriques-collecte.yml`),
son échec est donc relevé par l'alerte des sondes comme n'importe quel cron. Elle
n'écrit rien et ne remplace pas Prometheus — elle s'authentifie avec le jeton,
lit la réponse et juge quatre choses :

  1. la route est SERVIE et le jeton l'OUVRE (200 + exposition lisible). Un 401,
     un 503 et un 404 sont trois pannes DIFFÉRENTES : le remède n'est pas le
     même (poser le secret côté CI, le poser côté machine, corriger l'hôte) ;
  2. les SIX familles de veilles sont présentes — une série absente se lit comme
     une provenance qui n'existe pas, alors que c'est justement la question
     posée par ces pages ;
  3. toutes les lignes de l'exposition se lisent : un format cassé ne se voit
     pas sur les trois chiffres qu'on regarde à la main ;
  4. l'ÂGE de l'acquisition (`time() - plus_recente`) est sous le seuil que
     `METRIQUES.md` déclare (30 jours). `0` veut dire JAMAIS, et il est publié
     comme tel : la règle écrite pour cette jauge — `time() - valeur >
     30 * 86400` — n'alerte nulle part ailleurs, et une règle que personne ne
     lit ne déclenche rien.

Trois sorties, jamais deux :

  0  conforme : la chaîne de collecte fonctionne et l'acquisition est fraîche ;
  1  refus nommé : aucun jeton, route fermée ou perdue, famille absente,
     exposition illisible, acquisition tarie — avec la cause ET le remède ;
  2  prémisse : URL inutilisable ou transport injoignable — aucun verdict, et
     ce n'est PAS un vert.

Le COÛT de la passe (une requête, ses octets, sa durée) est publié sur le vert
comme sur le rouge, sur la sortie standard ET dans `$GITHUB_STEP_SUMMARY` : une
sonde qui ne publie son coût que le jour où elle échoue n'a servi à aucun
arbitrage.

Usage :
    METRICS_TOKEN=... python backend/scripts/check_metrics_collecte.py
    python backend/scripts/check_metrics_collecte.py [--url URL] [--age-max-jours 30]
"""

import argparse
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# L'hôte du BACKEND : /metrics vit hors `/api`, comme `/health` et `/monitor`.
# L'origine du site (`kojoforafrica.cc.cd`) répond 404 sur ce chemin — mesuré le
# 30/10/2026 —, et une sonde pointée là conclurait à une route disparue.
DEFAULT_URL = "https://api.kojoforafrica.cc.cd/metrics"
AGENT = "KojoMetricsCollecte/1.0"
NOM_DU_SECRET = "METRICS_TOKEN"

# Les familles que cette sonde existe pour lire (backend/kojo_metrics.py, et le
# contrat public `backend/METRIQUES.md`).
FAMILLE_PROVENANCE = "kojo_alertes_emploi"
FAMILLE_HORS_VOCABULAIRE = "kojo_alertes_emploi_hors_vocabulaire"
FAMILLE_FRAICHEUR = "kojo_alertes_emploi_plus_recente_timestamp_seconds"

# Les quatre étiquettes DÉCLARÉES par le module propriétaire
# (`kojo_job_alerts.ORIGINES_COMPTEES`, dérivées de `ORIGINES_ALERTE` +
# `ORIGINE_ABSENTE`). Elles sont recopiées ici parce que cette sonde tourne
# depuis une machine sans le dépôt backend installé — et
# `backend/tests/test_metrics_collecte.py` refuse que les deux listes divergent,
# pour que la copie ne puisse pas dériver en silence.
PROVENANCES_ATTENDUES = ("directe", "inconnue", "metier", "ville")

# Le seuil de l'alerte écrite dans METRIQUES.md : aucune veille créée depuis un
# mois (corpus vide compris, puisque la valeur vaut alors 0).
AGE_MAX_JOURS = 30
SECONDES_PAR_JOUR = 86400

# Une date « du futur » est un défaut d'écriture, pas une mesure fraîche ; la
# tolérance couvre le décalage d'horloge entre la machine Fly et le runner.
TOLERANCE_HORLOGE = 300

# Une ligne du format texte 0.0.4 : `nom{etiquettes} valeur [horodatage]`.
LIGNE_EXPOSITION = re.compile(
    r"^(?P<nom>[a-zA-Z_:][a-zA-Z0-9_:]*)(?P<etiquettes>\{[^{}]*\})?"
    r"\s+(?P<valeur>\S+)(?:\s+-?\d+)?$"
)
ETIQUETTE = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')


def _publier(lignes) -> None:
    """Écrit le rapport sur la sortie standard ET dans le résumé du job.

    La MÊME phrase sert les deux : un coût qui ne s'affiche que dans l'un des
    deux se lit à moitié.
    """
    texte = "\n".join(lignes)
    print(texte)
    chemin = os.environ.get("GITHUB_STEP_SUMMARY")
    if not chemin:
        return
    try:
        with open(chemin, "a", encoding="utf-8") as resume:
            resume.write(texte + "\n")
    except OSError:
        # Un résumé illisible n'est pas une raison de perdre le verdict.
        pass


def _detail(corps: str) -> str:
    """Cause lisible d'un refus : le `detail` du backend, sinon le corps brut."""
    texte = (corps or "").strip()
    if not texte:
        return "corps vide"
    return " ".join(texte.split())[:200]


def lire_exposition(corps: str):
    """Parse une exposition Prometheus : `(series, erreur)`.

    `series` associe un nom de famille à la liste de ses `(étiquettes, valeur)`.
    Une seule ligne illisible suffit à refuser : le format est la preuve que la
    route sert bien des métriques, et non un texte qui leur ressemble.
    """
    series = {}
    for numero, brute in enumerate((corps or "").splitlines(), start=1):
        ligne = brute.strip()
        if not ligne or ligne.startswith("#"):
            continue
        trouve = LIGNE_EXPOSITION.match(ligne)
        if not trouve:
            return None, "ligne %d illisible : %r" % (numero, ligne[:120])
        etiquettes = dict(ETIQUETTE.findall(trouve.group("etiquettes") or ""))
        try:
            valeur = float(trouve.group("valeur"))
        except ValueError:
            return None, "ligne %d : valeur non numerique (%r)" % (
                numero,
                trouve.group("valeur"),
            )
        series.setdefault(trouve.group("nom"), []).append((etiquettes, valeur))
    return series, ""


def _lire(url: str, jeton: str, timeout: int):
    """Lit `/metrics` : rend `(statut, corps, erreur)` — ne lève jamais."""
    requete = urllib.request.Request(
        url,
        headers={
            "User-Agent": AGENT,
            "Accept": "text/plain; version=0.0.4; charset=utf-8",
            # Le jeton est la seule preuve : Prometheus n'a pas de session.
            "Authorization": "Bearer %s" % jeton,
        },
    )
    try:
        with urllib.request.urlopen(requete, timeout=timeout) as reponse:
            return reponse.status, reponse.read().decode("utf-8", "replace"), None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, "", "%s: %s" % (type(exc).__name__, exc)


def _charge(lignes, erreurs: int, requetes: int, octets: int, duree: float) -> None:
    """Publie le COÛT de la passe — verdict vert compris."""
    _publier(
        lignes
        + [
            "[COUT] %d requete(s), %d octet(s), %.2f s, seuil de fraicheur %d jour(s)"
            % (requetes, octets, duree, AGE_MAX_JOURS),
            "[VERDICT] %s"
            % ("refus" if erreurs else "conforme"),
        ]
    )


def verifier(
    url: str = DEFAULT_URL,
    jeton: str = "",
    timeout: int = 20,
    age_max_jours: int = AGE_MAX_JOURS,
    maintenant=None,
) -> int:
    """Juge la chaîne de collecte en production. Rend 0, 1 (refus nommé) ou 2."""
    maintenant = time.time() if maintenant is None else maintenant

    if not (url or "").strip().lower().startswith(("http://", "https://")):
        print("[PREMISSE] URL inutilisable : %r — aucun verdict rendu ici" % (url,))
        return 2

    jeton = (jeton or os.environ.get(NOM_DU_SECRET) or "").strip()
    if not jeton:
        _charge(
            [
                "[ERREUR] AUCUN COLLECTEUR : le secret `%s` n'est pas declare cote CI."
                % NOM_DU_SECRET,
                "  La route /metrics est fermee par jeton : sans lui, les provenances et la",
                "  fraicheur des veilles ne sont lues par PERSONNE (mesure du 30/10/2026).",
                "  Remede : `gh secret set %s` avec la valeur posee sur la machine Fly"
                % NOM_DU_SECRET,
                "  (`fly secrets set %s=... -a kojo-backend`)." % NOM_DU_SECRET,
            ],
            1,
            0,
            0,
            0.0,
        )
        return 1

    debut = time.time()
    statut, corps, erreur = _lire(url, jeton, timeout)
    duree = time.time() - debut
    octets = len((corps or "").encode("utf-8"))

    if erreur:
        print("[PREMISSE] /metrics injoignable : %s — aucun verdict rendu ici" % erreur)
        return 2

    erreurs = []
    constats = []

    if statut == 401:
        erreurs.append(
            "jeton REFUSE (HTTP 401) : le secret `%s` de la CI ne vaut pas celui de la "
            "machine — %s" % (NOM_DU_SECRET, _detail(corps))
        )
    elif statut == 503:
        erreurs.append(
            "route FERMEE (HTTP 503) : aucun `%s` n'est pose sur la machine Fly "
            "(`fly secrets set %s=... -a kojo-backend`)"
            % (NOM_DU_SECRET, NOM_DU_SECRET)
        )
    elif statut == 404:
        erreurs.append(
            "route NON SERVIE (HTTP 404) : /metrics vit hors /api, sur l'hote du BACKEND "
            "(%s) — l'origine du site ne le proxifie pas" % DEFAULT_URL
        )
    elif statut != 200:
        erreurs.append("HTTP %d inattendu sur /metrics — %s" % (statut, _detail(corps)))

    series = {}
    if statut == 200:
        series, illisible = lire_exposition(corps)
        if illisible:
            series = {}
            erreurs.append("exposition ILLISIBLE : %s" % illisible)

    # ── Les quatre provenances, et le hors-vocabulaire ─────────────────────
    if statut == 200 and series:
        trouvees = {}
        for etiquettes, valeur in series.get(FAMILLE_PROVENANCE) or []:
            origine = (etiquettes.get("origine") or "").strip()
            if origine:
                trouvees[origine] = valeur
        manquantes = [origine for origine in PROVENANCES_ATTENDUES if origine not in trouvees]
        if manquantes:
            erreurs.append(
                "provenance(s) ABSENTE(S) : %s — une serie absente se lit comme une "
                "provenance qui n'existe pas" % ", ".join(manquantes)
            )
        else:
            constats.append(
                "[OK] provenance : %s (total %d)"
                % (
                    ", ".join("%s=%g" % (o, trouvees[o]) for o in PROVENANCES_ATTENDUES),
                    int(sum(trouvees.values())),
                )
            )

        hors = series.get(FAMILLE_HORS_VOCABULAIRE) or []
        if not hors:
            erreurs.append(
                "famille ABSENTE : %s — une valeur ecrite hors vocabulaire ne serait "
                "signalee nulle part" % FAMILLE_HORS_VOCABULAIRE
            )
        else:
            constats.append("[OK] hors vocabulaire : %g" % hors[0][1])

    # ── La FRAICHEUR de l'acquisition ──────────────────────────────────────
    if statut == 200 and series:
        valeurs = [valeur for _, valeur in series.get(FAMILLE_FRAICHEUR) or []]
        if not valeurs:
            erreurs.append(
                "famille ABSENTE : %s — l'acquisition ne se mesure plus dans le temps"
                % FAMILLE_FRAICHEUR
            )
        else:
            plus_recente = valeurs[0]
            if plus_recente <= 0:
                erreurs.append(
                    "acquisition JAMAIS DEMARREE : %s vaut 0 (aucune veille datee), donc "
                    "aucune page ville ou metier n'a produit d'alerte lisible"
                    % FAMILLE_FRAICHEUR
                )
            elif plus_recente > maintenant + TOLERANCE_HORLOGE:
                erreurs.append(
                    "date d'acquisition DANS LE FUTUR (%s) : la jauge est ecrite de travers"
                    % datetime.fromtimestamp(plus_recente, timezone.utc).isoformat()
                )
            else:
                age_jours = (maintenant - plus_recente) / SECONDES_PAR_JOUR
                quand = datetime.fromtimestamp(plus_recente, timezone.utc).isoformat()
                if age_jours > age_max_jours:
                    erreurs.append(
                        "acquisition TARIE depuis %.1f jour(s) (derniere veille : %s, seuil %d) "
                        "— les pages ville et metier ne produisent plus"
                        % (age_jours, quand, age_max_jours)
                    )
                else:
                    constats.append(
                        "[OK] fraicheur : derniere veille %s (age %.1f jour(s), seuil %d)"
                        % (quand, age_jours, age_max_jours)
                    )

    lignes = ["[OK] /metrics servi (HTTP %d, %d o, %.2f s)" % (statut, octets, duree)]
    lignes.extend(constats)
    if erreurs:
        lignes.append("")
        lignes.append("[ERREUR] LA COLLECTE DES METRIQUES N'EST PAS ETABLIE :")
        lignes.extend(" - " + erreur for erreur in erreurs)

    _charge(lignes, len(erreurs), 1, octets, duree)
    return 1 if erreurs else 0


def main():
    parser = argparse.ArgumentParser(
        description="Sonde de collecte des metriques Prometheus Kojo en production"
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="URL de /metrics (hote du backend)")
    parser.add_argument("--timeout", type=int, default=20, help="Delai d'attente (s)")
    parser.add_argument(
        "--age-max-jours",
        type=int,
        default=AGE_MAX_JOURS,
        help="Age maximal de la derniere veille avant refus (jours)",
    )
    args = parser.parse_args()

    sys.exit(verifier(args.url, timeout=args.timeout, age_max_jours=args.age_max_jours))


if __name__ == "__main__":
    main()
