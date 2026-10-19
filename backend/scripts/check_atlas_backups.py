#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Les sauvegardes continues de MongoDB Atlas sont-elles ACTIVES ? Ce script le demande à Atlas.

POURQUOI CETTE SONDE EXISTE : une sauvegarde « activée » dans un tableau de bord
n'est pas un fait mesuré. Atlas peut avoir `backupEnabled` vrai et `pitEnabled`
faux (sauvegardes par snapshot seulement, sans restauration à un instant), ou
les deux faux sur un palier partagé (M0/M2/M5 ne fournissent PAS la restauration
continue). Personne ne s'en aperçoit avant le jour où il faut restaurer — c'est
exactement le moment où il est trop tard. La procédure de restauration et le
drill exécuté vivent dans `backend/SAUVEGARDES_ATLAS.md`.

CE QUE LA SONDE INTERROGE : `GET /api/atlas/v2/groups/{groupId}/clusters/{nom}`
(API d'administration Atlas, authentification DIGEST par clés API). Le verdict
ne lit que deux champs — `backupEnabled` et `pitEnabled` — et REFUSE de conclure
s'il ne les lit pas : un changement de schéma côté Atlas doit rendre la sonde
muette et bruyante, jamais verte.

TROIS SORTIES, jamais deux :
  0  sauvegardes activées ET restauration continue (PITR) activée ;
  1  un des deux est faux — le message nomme lequel, le palier, et le remède ;
  2  impossible de juger (clés absentes, 401/403, réseau, réponse illisible).
     Une surface aveugle se DÉCLARE : elle ne vaut pas un vert.

Clés (variables d'environnement, jamais en argument de ligne de commande pour
qu'elles ne finissent pas dans l'historique du shell ni dans les logs) :
  ATLAS_PUBLIC_KEY, ATLAS_PRIVATE_KEY, ATLAS_PROJECT_ID, ATLAS_CLUSTER

Usage :
    ATLAS_PUBLIC_KEY=… ATLAS_PRIVATE_KEY=… ATLAS_PROJECT_ID=… ATLAS_CLUSTER=… \\
        python backend/scripts/check_atlas_backups.py
    python backend/scripts/check_atlas_backups.py --delai 20
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone

BASE_API = "https://cloud.mongodb.com/api/atlas/v2"
VARIABLES = ("ATLAS_PUBLIC_KEY", "ATLAS_PRIVATE_KEY", "ATLAS_PROJECT_ID", "ATLAS_CLUSTER")

# Paliers PARTAGÉS : Atlas n'y fournit pas la restauration continue, quelle que
# soit la case cochée. Les nommer évite de renvoyer « activez PITR » à quelqu'un
# dont le palier ne le permet pas : le remède est de changer de palier.
PALIERS_SANS_PITR = ("M0", "M2", "M5")


def _palier(document):
    """Palier du cluster (`M0`, `M10`, `M20`…) — LU, jamais deviné.

    DEUX formes selon le type de déploiement : un cluster DÉDIÉ porte le palier
    dans `replicationSpecs[].regionConfigs[].{electableSpecs,…}.instanceSize`,
    un cluster PARTAGÉ (M0/M2/M5, fournisseur TENANT) le porte dans
    `providerSettings.instanceSizeName`. Ne lire que la première rendait
    « palier inconnu » sur le cluster réel (M0, mesuré le 19/10/2026) — et le
    remède publié devenait « activer le Cloud Backup », impossible sur ce
    palier : exactement le remède impossible que cette sonde existe pour éviter.
    """
    specs = document.get("replicationSpecs") or []
    for spec in specs:
        for region in spec.get("regionConfigs") or []:
            for cle in ("electableSpecs", "readOnlySpecs", "analyticsSpecs"):
                instance = (region.get(cle) or {}).get("instanceSize")
                if instance:
                    return str(instance)
    provider = document.get("providerSettings") or {}
    for valeur in (provider.get("instanceSizeName"), document.get("instanceSizeName")):
        if valeur:
            return str(valeur)
    return ""


def _valeur_booleenne(document, champ):
    """Lit un booléen SANS le deviner : absent ou d'un autre type = illisible.

    `bool(None)` vaut False : un champ absent se lirait « sauvegarde
    desactivee » et la sonde crierait au loup sur une réponse tronquee, ou pire
    l'inverse selon le champ. On rend `None` pour dire « je n'ai pas lu ».
    """
    valeur = document.get(champ)
    return valeur if isinstance(valeur, bool) else None


def analyser(statut, corps):
    """Juge une réponse de l'API. Rend `(code, lignes)` — pur, donc testable."""
    if statut is None:
        return 2, [f"[PREMISSE] Atlas injoignable : {corps}"]
    if statut in (401, 403):
        return 2, [
            f"[PREMISSE] HTTP {statut} : les clés API Atlas sont refusées ou sans "
            "droit sur ce projet (rôle Project Read Only minimum). La sonde ne "
            "peut PAS juger les sauvegardes — aucun verdict n'est rendu ici."
        ]
    if statut == 404:
        return 2, [
            "[PREMISSE] HTTP 404 : projet ou cluster introuvable avec ces "
            "identifiants (ATLAS_PROJECT_ID / ATLAS_CLUSTER). Rien n'a été jugé."
        ]
    if statut != 200:
        return 2, [f"[PREMISSE] HTTP {statut} : réponse inattendue d'Atlas, aucun verdict rendu."]
    if not isinstance(corps, dict):
        return 2, ["[PREMISSE] Réponse Atlas illisible (pas un objet JSON) : aucun verdict rendu."]

    sauvegardes = _valeur_booleenne(corps, "backupEnabled")
    continu = _valeur_booleenne(corps, "pitEnabled")
    if sauvegardes is None or continu is None:
        return 2, [
            "[PREMISSE] La réponse Atlas ne porte pas `backupEnabled` ET `pitEnabled` "
            f"(lu : backupEnabled={sauvegardes!r}, pitEnabled={continu!r}). Un champ "
            "déplacé rendrait la sonde aveugle : elle refuse de conclure."
        ]

    palier = _palier(corps)
    nom = corps.get("name") or os.environ.get("ATLAS_CLUSTER", "?")
    lignes = [
        f"[INFO] Cluster {nom} — palier {palier or 'inconnu'} — "
        f"backupEnabled={sauvegardes}, pitEnabled={continu}"
    ]

    if not sauvegardes:
        if palier in PALIERS_SANS_PITR:
            # Un palier partagé ne fournit AUCUNE sauvegarde continue : cocher
            # « Backup » y est impossible, et proposer de le faire enverrait
            # l'exploitant dans un mur.
            lignes.append(
                f"[ERREUR] Sauvegardes DÉSACTIVÉES — et le palier {palier} (partagé) ne "
                "fournit AUCUNE sauvegarde continue : « Backup » n'y est pas activable. "
                "Deux remèdes : passer à un palier dédié (M10 minimum) pour activer "
                "Cloud Backup + PITR ; ou, tant qu'on reste en partagé, tenir une "
                "sauvegarde EXTERNE (mongodump quotidien vérifié — procédure et exercice "
                "daté dans backend/SAUVEGARDES_ATLAS.md)."
            )
        else:
            lignes.append(
                f"[ERREUR] Sauvegardes DÉSACTIVÉES sur ce cluster (palier "
                f"{palier or 'inconnu'}) : aucune restauration n'est possible. Remède : "
                "activer le Cloud Backup du cluster (Atlas → Backup → Enable)."
            )
        return 1, lignes

    if not continu:
        if palier in PALIERS_SANS_PITR:
            lignes.append(
                f"[ERREUR] Restauration CONTINUE (PITR) indisponible : le palier {palier} "
                "ne la fournit pas. Les snapshots seuls laissent une perte de données "
                "de plusieurs heures. Remède : passer à un palier dédié (M10 minimum), "
                "puis activer « Continuous Cloud Backup »."
            )
        else:
            lignes.append(
                "[ERREUR] Restauration CONTINUE (PITR) DÉSACTIVÉE alors que le palier "
                f"{palier or 'inconnu'} la permet. Remède : Atlas → Backup → "
                "« Continuous Cloud Backup » (PITR). Sans elle, le RPO est celui du "
                "dernier snapshot (jusqu'à 6 h de pertes)."
            )
        return 1, lignes

    lignes.append(
        "[OK] Sauvegardes activées ET restauration continue (PITR) activée : "
        "le RPO est celui du point de restauration choisi, pas du dernier snapshot."
    )
    return 0, lignes


# ── La sauvegarde EXTERNE : ce qui remplace l'impossible sur un palier partagé ─
# M0/M2/M5 ne fournit AUCUNE sauvegarde continue : exiger « activez Cloud
# Backup » y envoie l'exploitant dans un mur, et exiger un vert sans rien
# mesurer serait le silence que ce dépôt refuse. Sur ce palier, la seule
# restauration possible est donc une sauvegarde EXTERNE VÉRIFIÉE — et ce qui se
# juge d'elle, c'est sa FRAÎCHEUR : une sauvegarde d'il y a trois jours n'est
# pas une sauvegarde.
WORKFLOW_SAUVEGARDE = os.environ.get("BACKUP_WORKFLOW", "backup-db.yml")
FRAICHEUR_MAX_HEURES = float(os.environ.get("BACKUP_FRAICHEUR_MAX_HEURES", "36"))


def _instant(texte):
    """Instant epoch d'un horodatage ISO-8601 de GitHub, ou None."""
    try:
        valeur = datetime.fromisoformat(str(texte).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if valeur.tzinfo is None:
        valeur = valeur.replace(tzinfo=timezone.utc)
    return valeur.timestamp()


def juger_sauvegarde_externe(dernier_succes, maintenant, seuil_heures=FRAICHEUR_MAX_HEURES):
    """`(code, ligne)` — la fraîcheur d'une sauvegarde externe vérifiée.

    PURE : l'horloge est un paramètre, donc « vieille de 40 h » se juge sans
    attendre 40 h, et un horodatage illisible ne se lit jamais comme « récente ».
    """
    if not dernier_succes:
        return 1, (
            "[ERREUR] Aucune sauvegarde EXTERNE n'a jamais abouti : le workflow "
            f"{WORKFLOW_SAUVEGARDE} n'a aucun run réussi. Rien ne permettrait de "
            "restaurer — poser MONGO_URL et les accès du stockage (ou passer à un "
            "palier dédié, M10 minimum)."
        )
    instant = _instant(dernier_succes)
    if instant is None:
        return 1, (
            "[ERREUR] La date de la dernière sauvegarde externe est ILLISIBLE "
            f"({dernier_succes!r}) : sa fraîcheur n'est pas jugeable, donc pas un vert. "
            f"Vérifier la sortie du workflow {WORKFLOW_SAUVEGARDE}."
        )
    age = (maintenant - instant) / 3600.0
    if age < -1:
        return 1, (
            f"[ERREUR] La dernière sauvegarde externe est datée dans le FUTUR "
            f"({-age:.0f} h d'avance) : une horloge fausse rend la fraîcheur "
            "invérifiable. Corriger l'horodatage, puis rejouer."
        )
    if age > seuil_heures:
        return 1, (
            f"[ERREUR] Dernière sauvegarde EXTERNE il y a {age:.0f} h (seuil "
            f"{seuil_heures:.0f} h) : trop vieille pour être une sauvegarde. "
            f"Vérifier le workflow {WORKFLOW_SAUVEGARDE}."
        )
    return 0, (
        f"[OK] Sauvegarde EXTERNE vérifiée il y a {age:.0f} h (seuil "
        f"{seuil_heures:.0f} h) — Atlas n'offre aucune sauvegarde continue sur ce "
        "palier : celle-ci est la seule restauration possible."
    )


def dernier_succes_externe(depot=None, jeton=None):
    """`(etat, valeur)` du dernier run RÉUSSI du workflow de sauvegarde.

    `etat` vaut `ok` (alors `valeur` = horodatage ISO ou None si aucun run
    réussi) ou `illisible` (alors `valeur` = la raison). Cette distinction est
    le sujet : « aucun succès » est un fait à corriger, « API illisible » est une
    prémisse — les confondre rendrait la sonde aveugle ou menteuse.
    """
    depot = depot or os.environ.get("GITHUB_REPOSITORY", "")
    jeton = jeton or os.environ.get("GITHUB_TOKEN", "")
    if not depot or not jeton:
        return "illisible", (
            "GITHUB_REPOSITORY / GITHUB_TOKEN absents : l'historique du workflow "
            f"{WORKFLOW_SAUVEGARDE} n'a pas pu être lu."
        )
    url = (
        "https://api.github.com/repos/"
        f"{depot}/actions/workflows/{WORKFLOW_SAUVEGARDE}/runs"
        "?status=success&per_page=1"
    )
    try:
        import json
        import urllib.request

        requete = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {jeton}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(requete, timeout=15) as reponse:
            donnees = json.load(reponse)
    except Exception as exc:  # noqa: BLE001 - toute panne est une prémisse nommée
        return "illisible", f"API GitHub injoignable ({exc})"
    runs = donnees.get("workflow_runs") or []
    if not runs:
        return "ok", None
    return "ok", runs[0].get("created_at") or runs[0].get("run_started_at")


def sans_sauvegarde_sur_palier_partage(corps):
    """Le cas où la seule restauration possible est EXTERNE."""
    if not isinstance(corps, dict):
        return False
    return (
        _valeur_booleenne(corps, "backupEnabled") is False
        and _palier(corps) in PALIERS_SANS_PITR
    )


def url_cluster(projet, cluster):
    """URL d'un cluster dans l'API d'administration — testable sans réseau."""
    return f"{BASE_API}/groups/{projet}/clusters/{cluster}"


def lire_cluster(public, privee, projet, cluster, delai):
    """Interroge l'API Atlas. Rend `(statut, corps, erreur)` — jamais d'exception.

    Digest, pas Bearer : l'API d'administration Atlas n'accepte que
    l'authentification par clés (public key = utilisateur, private = mot de
    passe). `requests` est déjà une dépendance du backend.
    """
    try:
        import requests
        from requests.auth import HTTPDigestAuth
    except ImportError as exc:  # pragma: no cover - dépend de l'environnement
        return None, None, f"`requests` indisponible : {exc}"

    url = url_cluster(projet, cluster)
    try:
        reponse = requests.get(
            url,
            auth=HTTPDigestAuth(public, privee),
            timeout=delai,
            headers={"Accept": "application/vnd.atlas.2023-01-01+json"},
        )
    except Exception as exc:
        return None, None, str(exc)

    try:
        corps = reponse.json()
    except ValueError:
        corps = reponse.text[:200]
    return reponse.status_code, corps, ""


def _sortie_utf8():
    """Console Windows en cp1252 : sans cela, un accent sort en `\uFFFD`.

    Le message d'une prémisse doit être LISIBLE par celui qui la reçoit — un
    refus illisible se lit comme un bug de la sonde, pas comme une prémisse.
    """
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # flux redirigé sans reconfigure
            pass


def main():
    _sortie_utf8()
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument("--delai", type=int, default=15, help="délai d'attente Atlas (secondes)")
    args = parseur.parse_args()

    manquantes = [nom for nom in VARIABLES if not os.environ.get(nom)]
    if manquantes:
        print(
            "[PREMISSE] Sauvegardes Atlas NON VÉRIFIÉES : "
            + ", ".join(manquantes)
            + " absent(s). Une surface aveugle se déclare — elle ne vaut pas un vert. "
            "Rien n'a été jugé ici.",
            file=sys.stderr,
        )
        print(f"-> {os.path.basename(__file__)} sort en 2 (aucun verdict rendu).", file=sys.stderr)
        return 2

    statut, corps, erreur = lire_cluster(
        os.environ["ATLAS_PUBLIC_KEY"],
        os.environ["ATLAS_PRIVATE_KEY"],
        os.environ["ATLAS_PROJECT_ID"],
        os.environ["ATLAS_CLUSTER"],
        args.delai,
    )
    code, lignes = analyser(statut, corps if statut is not None else erreur)

    # Sur un palier PARTAGÉ sans sauvegarde, la seule restauration possible est
    # externe : on juge sa FRAÎCHEUR au lieu d'exiger un Cloud Backup impossible.
    if code == 1 and sans_sauvegarde_sur_palier_partage(corps):
        # La ligne qui demandait un Cloud Backup impossible cède la place au
        # verdict EXTERNE : garder les deux ferait lire un refus et un vert sur
        # la même situation.
        lignes = [
            ligne for ligne in lignes
            if not ligne.startswith("[ERREUR] Sauvegardes DÉSACTIVÉES")
        ]
        etat, valeur = dernier_succes_externe()
        if etat == "illisible":
            lignes.append(
                f"[PREMISSE] Sauvegarde EXTERNE non jugeable : {valeur} Aucun verdict "
                "n'est rendu sur la restauration possible."
            )
            code = 2
        else:
            code, ligne = juger_sauvegarde_externe(valeur, time.time())
            lignes.append(ligne)

    for ligne in lignes:
        print(ligne)

    if code == 1:
        if any("EXTERNE" in ligne for ligne in lignes):
            print(
                "\n::error title=Sauvegarde externe absente ou périmée::Atlas n'offre "
                "aucune sauvegarde continue sur ce palier, et aucune sauvegarde "
                "externe vérifiée et fraîche n'existe — voir "
                "backend/SAUVEGARDES_ATLAS.md."
            )
        else:
            print(
                "\n::error title=Sauvegardes Atlas désactivées::Les sauvegardes continues "
                "ne sont pas actives — voir backend/SAUVEGARDES_ATLAS.md."
            )
    elif code == 2:
        print(
            "\n::error title=Sauvegardes Atlas non vérifiables::La sonde n'a pas pu "
            "juger (prémisse), aucun verdict n'est rendu."
        )
    return code


if __name__ == "__main__":
    sys.exit(main())
