#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UNE SONDE ROUGE DOIT DEVENIR UNE ALERTE, PAS UN ÉTAT.

── Ce que ce script existe pour empêcher ────────────────────────────────────
Mesuré le 27/10/2026 : `POST /api/support/robot/chat` rendait **502 en une
seconde, cinq fois sur cinq** — l'assistant de `/support` et du canal WhatsApp
était muet. Le dépôt le SAVAIT : le run `ai-assistant-probe` du 26/10 14:31 était
**rouge**, et il l'est resté. Ce qui a manqué n'est ni un test ni une sonde :
c'est quelqu'un qui l'apprenne. Treize sondes planifiées mesuraient la
production, aucune ne parlait à personne.

Ce script est le DESTINATAIRE. Une fois par jour, il lit la conclusion du
dernier run de CHAQUE sonde planifiée du dépôt et :

  * **rien n'est rouge, aucune issue ouverte** → il n'écrit RIEN. Pas un
    commentaire, pas une coche verte : un canal qui parle tous les jours devient
    un canal qu'on ne lit plus.
  * **au moins une sonde est rouge** → il ouvre UNE issue, ou met à jour celle
    qui existe déjà. Le titre est stable, le corps dit quelles sondes, avec
    quelle conclusion, et le lien du run à ouvrir.
  * **tout est revenu vert et une issue est ouverte** → il la ferme avec la
    date du rétablissement. Une alerte qui ne se referme jamais finit par être
    un décor.

── Trois sorties, jamais deux ───────────────────────────────────────────────
    0  verdict rendu (rouge signalé, ou tout vert) — l'alerte a fait son travail ;
    2  PRÉMISSE : le script ne peut pas juger (jeton absent, API illisible,
       moins de `MIN_SONDES` sondes lues, aucun run lu). Il tente alors de le
       DIRE dans l'issue d'alerte et sort en 2 : une surveillance aveugle qui
       se tait est exactement la panne du 27/10, une couche plus haut.

Aucun vert n'est rendu sous les planchers de lecture : une liste vide de sondes
(chemin déplacé, mise en forme changée) est une prémisse, pas « tout va bien ».

── Ce que ce script ne fait PAS, écrit pour ne pas le croire plus fort ──────
  * Il ne LANCE pas les sondes : il lit leurs runs. Une sonde cassée dans son
    propre verdict reste un problème de cette sonde-là.
  * Il ne juge pas le produit : une production verte sur treize sondes peut
    avoir zéro mission terminée (cf. `AUDIT-GENERAL-2026-10-27.md`).
  * Il ne lit que la branche par défaut : un run rouge sur une branche de travail
    est le problème de cette PR, dont les checks sont déjà bloquants.

Usage :
    GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo python .github/scripts/alerte_sondes.py
    … --racine . --branche main --simulation   (aucune écriture, pour un essai)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Les accents des noms de sonde ne doivent pas tuer le script sous une console
# cp1252 (même garde que check-informative-steps.py et check-guard-mutations.py).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

API = "https://api.github.com"
RACINE_DEFAUT = Path(__file__).resolve().parents[2]
WORKFLOWS = Path(".github") / "workflows"

# Le marqueur qui rend l'issue retrouvable sans étiquette à créer : une issue
# d'alerte est reconnue par son corps, pas par un titre qu'un humain peut
# reformuler ni par un label que personne n'a posé.
MARQUEUR = "<!-- kojo-sondes-sante -->"
MARQUEUR_EMPREINTE = "<!-- empreinte: "
TITRE = "Sondes de production en échec"

# Conclusions qui disent qu'une sonde a REFUSÉ quelque chose. `cancelled` et
# `skipped` n'en sont pas : un run annulé n'a rien jugé, et le compter comme un
# rouge apprendrait à ignorer l'alerte.
CONCLUSIONS_ECHEC = ("failure", "startup_failure", "timed_out")
CONCLUSIONS_NON_JUGEES = ("cancelled", "skipped", "neutral", "")

# Plancher de lecture : 13 workflows planifiés le 27/10/2026. Sous huit, ce n'est
# pas le dépôt qui a cessé d'avoir des sondes, c'est la LECTURE qui est cassée.
MIN_SONDES = 8

NOM = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)
CRON = re.compile(r"^\s*-\s*cron:\s*['\"]?[\d*/,\- ]+['\"]?\s*$", re.MULTILINE)
SCHEDULE = re.compile(r"^\s*schedule:\s*$", re.MULTILINE)


class Premisse(RuntimeError):
    """Le script ne peut pas juger — jamais un vert, jamais un rouge muet."""


# ── Lecture du dépôt : QUELLES sondes existent ──────────────────────────────


def est_sonde(texte: str) -> bool:
    """Un workflow est une sonde s'il est PLANIFIÉ (bloc `schedule:` + un cron).

    La liste n'est pas recopiée : une sonde ajoutée demain est surveillée sans
    qu'on touche à ce fichier, et une sonde retirée cesse d'être attendue. Un
    nom gravé ici serait une liste d'espoirs.
    """
    return bool(NOM.search(texte) and SCHEDULE.search(texte) and CRON.search(texte))


def sondes(racine: Path = RACINE_DEFAUT) -> list[dict]:
    """Les travaux PLANIFIÉS du dépôt, triés par nom de fichier.

    Tout job planifié compte, pas seulement ceux qui s'appellent `*-probe` : une
    sauvegarde quotidienne qui échoue mérite la même oreille qu'une sonde, et
    distinguer les deux demanderait une liste de noms — exactement ce que ce
    script refuse de recopier.

    L'ALERTE ELLE-MÊME est exclue, et retrouvée par ce qu'elle contient (le nom
    de ce script dans un `run:`) plutôt que par son propre nom de fichier : sinon
    elle se surveillerait, lirait son run EN COURS chaque matin et publierait un
    « non jugée » quotidien — le bruit qui apprend à ignorer l'alerte.

    Args:
        racine: racine du dépôt (injectable : le test lit un arbre temporaire).

    Returns:
        list[dict]: `{fichier, nom}` — `fichier` est le nom de fichier que
        l'API Actions accepte dans son chemin, `nom` le libellé humain.
    """
    dossier = racine / WORKFLOWS
    ce_script = Path(__file__).name
    trouvees: list[dict] = []
    for chemin in sorted(dossier.glob("*.yml")):
        texte = chemin.read_text(encoding="utf-8")
        if not est_sonde(texte) or ce_script in texte:
            continue
        nom = NOM.search(texte)
        trouvees.append({
            "fichier": chemin.name,
            "nom": nom.group(1).strip().strip("\"'") if nom else chemin.stem,
        })
    return trouvees


# ── Lecture de la CI : QUE DIT CHAQUE SONDE ─────────────────────────────────


def requete(methode: str, chemin: str, corps=None, *, token: str, timeout: int = 20):
    """Un appel à l'API GitHub. Rend `(statut, charge)` ; ne lève que sur réseau.

    Le jeton part en en-tête, jamais dans l'URL ni dans un journal. Un statut
    non 2xx est RENDU (pas levé) : `404` a un sens précis ici — un workflow
    jamais exécuté — et l'appelant seul peut le classer.
    """
    donnees = json.dumps(corps).encode("utf-8") if corps is not None else None
    requete_http = urllib.request.Request(
        f"{API}{chemin}",
        data=donnees,
        method=methode,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "KojoAlerteSondes/1.0",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(requete_http, timeout=timeout) as reponse:
            brut = reponse.read().decode("utf-8")
            return reponse.status, (json.loads(brut) if brut.strip() else {})
    except urllib.error.HTTPError as erreur:
        brut = erreur.read().decode("utf-8", "replace")
        try:
            charge = json.loads(brut) if brut.strip() else {}
        except ValueError:
            charge = {"message": brut[:200]}
        return erreur.code, charge
    except (urllib.error.URLError, TimeoutError, OSError) as erreur:
        raise Premisse(f"API GitHub injoignable ({type(erreur).__name__})")


def dernier_run(fichier: str, *, token: str, depot: str, branche: str, http=requete):
    """Le dernier run d'une sonde sur la branche par défaut, ou `None`.

    Returns:
        dict | None: `{conclusion, url, cree_le, statut}` ; `None` quand la
        sonde n'a JAMAIS tourné (l'API rend une liste vide, ou 404 pour un
        workflow sans run). Ce cas n'est pas un échec : il est publié à part,
        parce qu'une sonde qui n'a jamais tourné ne protège rien.
    """
    chemin = (
        f"/repos/{depot}/actions/workflows/{urllib.parse.quote(fichier)}/runs"
        f"?branch={urllib.parse.quote(branche)}&per_page=1"
    )
    statut, charge = http("GET", chemin, token=token)

    if statut == 404:
        return None
    if statut != 200:
        raise Premisse(
            f"l'API rend {statut} pour {fichier} ({str(charge.get('message', ''))[:120]})"
        )

    runs = (charge.get("workflow_runs") or []) if isinstance(charge, dict) else []
    if not runs:
        return None
    run = runs[0]
    return {
        "conclusion": (run.get("conclusion") or "").lower(),
        "statut": (run.get("status") or "").lower(),
        "url": run.get("html_url") or "",
        "cree_le": run.get("created_at") or "",
        "tete": (run.get("head_sha") or "")[:8],
    }


# ── Le verdict ──────────────────────────────────────────────────────────────


def juger(entrees: list[dict]) -> dict:
    """Classe chaque sonde : en échec, verte, non jugée, jamais exécutée.

    Args:
        entrees: `[{fichier, nom, run}]`, `run` valant `None` si aucun run.

    Returns:
        dict: `{echecs, vertes, non_jugees, jamais_executees}` — quatre listes,
        jamais fondues : « annulée », « jamais lancée » et « rouge » ne se
        réparent pas de la même façon.
    """
    verdict = {"echecs": [], "vertes": [], "non_jugees": [], "jamais_executees": []}
    for entree in entrees:
        run = entree.get("run")
        ligne = {
            "fichier": entree["fichier"],
            "nom": entree.get("nom") or entree["fichier"],
            "conclusion": (run or {}).get("conclusion", ""),
            "statut": (run or {}).get("statut", ""),
            "url": (run or {}).get("url", ""),
            "cree_le": (run or {}).get("cree_le", ""),
            "tete": (run or {}).get("tete", ""),
        }
        if run is None:
            verdict["jamais_executees"].append(ligne)
        elif ligne["conclusion"] in CONCLUSIONS_ECHEC:
            verdict["echecs"].append(ligne)
        elif ligne["conclusion"] == "success":
            verdict["vertes"].append(ligne)
        else:
            verdict["non_jugees"].append(ligne)
    return verdict


def empreinte(verdict: dict) -> str:
    """Une signature stable des ÉCHECS : même panne, même empreinte.

    Elle porte le run lui-même (URL), pas la date du jour : une panne qui dure
    ne doit pas réécrire l'issue chaque matin, sinon le fil devient du bruit et
    le premier commentaire utile est noyé.
    """
    cle = "|".join(
        f"{echec['fichier']}:{echec['conclusion']}:{echec['url']}"
        for echec in sorted(verdict["echecs"], key=lambda item: item["fichier"])
    )
    return hashlib.sha256(cle.encode("utf-8")).hexdigest()[:16]


def _ligne_tableau(ligne: dict) -> str:
    run = f"[{ligne['conclusion'] or ligne['statut'] or '?'}]({ligne['url']})" if ligne["url"] else "—"
    return f"| `{ligne['fichier']}` | {ligne['nom']} | {run} | {ligne['tete'] or '—'} |"


def corps_issue(verdict: dict, *, depot: str, branche: str, maintenant: str | None = None) -> str:
    """Le corps de l'issue : ce qui est rouge, ce qui n'a pas été jugé, le lien."""
    maintenant = maintenant or datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    parties = [
        MARQUEUR,
        f"### {len(verdict['echecs'])} sonde(s) de production en échec",
        "",
        f"Mesuré le {maintenant} sur `{branche}` ({depot}). "
        "Cette issue est ouverte et mise à jour par `.github/workflows/sondes-sante.yml` : "
        "elle se referme d'elle-même quand tout repasse au vert.",
        "",
        "| Sonde | Nom | Dernier run | Commit |",
        "|---|---|---|---|",
    ]
    parties += [_ligne_tableau(ligne) for ligne in verdict["echecs"]]
    parties.append("")

    if verdict["non_jugees"]:
        parties += [
            "**Non jugées** (run annulé, sauté ou en cours — rien n'a été mesuré) :",
            "",
        ]
        parties += [
            f"- `{ligne['fichier']}` — {ligne['conclusion'] or ligne['statut'] or 'sans conclusion'}"
            for ligne in verdict["non_jugees"]
        ]
        parties.append("")

    if verdict["jamais_executees"]:
        parties += [
            "**Jamais exécutées** sur cette branche (une sonde qui n'a jamais tourné "
            "ne protège rien) :",
            "",
        ]
        parties += [f"- `{ligne['fichier']}`" for ligne in verdict["jamais_executees"]]
        parties.append("")

    parties += [
        f"<sub>{len(verdict['vertes'])} autre(s) sonde(s) verte(s) le même jour — "
        "un vert de sonde ne prouve pas que le produit se porte bien.</sub>",
        "",
        f"{MARQUEUR_EMPREINTE}{empreinte(verdict)} -->",
    ]
    return "\n".join(parties)


def corps_premisse(motif: str, *, maintenant: str | None = None) -> str:
    """Le corps de l'issue quand la SURVEILLANCE elle-même ne peut pas conclure."""
    maintenant = maintenant or datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    return "\n".join([
        MARQUEUR,
        "### La surveillance des sondes ne peut pas conclure",
        "",
        f"Mesuré le {maintenant} : {motif}",
        "",
        "Aucun verdict n'est rendu — et ce n'est pas un vert. Tant que ce motif "
        "est là, une sonde rouge peut passer inaperçue : c'est exactement ce qui "
        "s'est produit le 26/10/2026 avec l'assistant support.",
        "",
        f"{MARQUEUR_EMPREINTE}premisse -->",
    ])


# ── L'écriture : UNE issue, jamais de doublon ───────────────────────────────


def _issue_ouverte(depot: str, token: str, http) -> dict | None:
    """L'issue d'alerte déjà ouverte, reconnue par son MARQUEUR.

    Le titre n'est pas le critère : un humain peut le reformuler, et deux
    alertes au même titre deviendraient deux fils. Le marqueur est dans le corps,
    que personne ne réécrit par accident.
    """
    statut, reponse = http("GET", f"/repos/{depot}/issues?state=open&per_page=100", token=token)
    if statut != 200:
        raise Premisse(f"impossible de lister les issues ouvertes (API {statut})")
    for issue in reponse if isinstance(reponse, list) else []:
        if "pull_request" in issue:
            continue
        if MARQUEUR in (issue.get("body") or ""):
            return issue
    return None


def gerer_issue(verdict: dict | None, *, depot: str, branche: str, token: str,
                motif_premisse: str = "", http=requete, simulation: bool = False) -> str:
    """Ouvre, met à jour, ferme — ou n'écrit rien du tout.

    Returns:
        str: `"ouverte"`, `"mise a jour"`, `"inchangee"`, `"fermee"`, `"rien"`
        ou `"simulation"`. Un compte-rendu, pas un verdict.
    """
    existante = _issue_ouverte(depot, token, http)

    if verdict is None:
        # Une PRÉMISSE ne remplace jamais une alerte réelle : si une issue dit
        # déjà qu'une sonde est rouge, l'écraser par « je ne peux pas juger »
        # effacerait le seul fait actionnable du fil. On la laisse, et le run
        # rougit en parallèle (sortie 2).
        if existante is not None:
            return "inchangee"
        corps = corps_premisse(motif_premisse)
        empreinte_voulue = "premisse"
        rouge = True
    else:
        corps = corps_issue(verdict, depot=depot, branche=branche)
        empreinte_voulue = empreinte(verdict)
        rouge = bool(verdict["echecs"])

    if simulation:
        return "simulation"

    if rouge:
        if existante is None:
            statut, charge = http(
                "POST",
                f"/repos/{depot}/issues",
                corps={"title": TITRE, "body": corps},
                token=token,
            )
            if statut not in (200, 201):
                raise Premisse(f"l'issue n'a pas pu être ouverte (API {statut})")
            return "ouverte"
        if f"{MARQUEUR_EMPREINTE}{empreinte_voulue} -->" in (existante.get("body") or ""):
            # Même panne qu'hier : l'issue dit déjà tout, on ne la réécrit pas.
            return "inchangee"
        statut, _ = http(
            "PATCH",
            f"/repos/{depot}/issues/{existante['number']}",
            corps={"body": corps},
            token=token,
        )
        if statut not in (200, 201):
            raise Premisse(f"l'issue n'a pas pu être mise à jour (API {statut})")
        return "mise a jour"

    # Tout est vert (ou seule une prémisse reste) : on ferme en le DISANT.
    if existante is None:
        return "rien"
    if verdict is not None and not verdict["echecs"]:
        http(
            "POST",
            f"/repos/{depot}/issues/{existante['number']}/comments",
            corps={"body": (
                "Rétabli : toutes les sondes planifiées ont rendu un run vert. "
                "Cette issue se referme d'elle-même."
            )},
            token=token,
        )
        statut, _ = http(
            "PATCH",
            f"/repos/{depot}/issues/{existante['number']}",
            corps={"state": "closed", "state_reason": "completed"},
            token=token,
        )
        if statut not in (200, 201):
            raise Premisse(f"l'issue n'a pas pu être fermée (API {statut})")
        return "fermee"
    return "inchangee"


# ── Programme ───────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    """Lit les sondes, juge, et n'écrit que si quelque chose casse."""
    analyseur = argparse.ArgumentParser(description="Alerte des sondes de production Kojo")
    analyseur.add_argument("--racine", default=str(RACINE_DEFAUT))
    analyseur.add_argument("--branche", default="main")
    analyseur.add_argument("--simulation", action="store_true", help="n'écrit rien")
    arguments = analyseur.parse_args(argv)

    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    depot = (os.environ.get("GITHUB_REPOSITORY") or "").strip()

    liste = sondes(Path(arguments.racine))
    print(f"[INFO] {len(liste)} sonde(s) planifiée(s) lue(s) dans {WORKFLOWS}/")
    for sonde in liste:
        print(f"   - {sonde['fichier']} ({sonde['nom']})")

    try:
        if len(liste) < MIN_SONDES:
            raise Premisse(
                f"{len(liste)} sonde(s) lue(s), sous le plancher de {MIN_SONDES} : "
                "c'est la LECTURE qui est cassée, pas le dépôt qui a cessé d'en avoir"
            )
        if not token:
            raise Premisse("GITHUB_TOKEN absent : aucune sonde ne peut être lue")
        if not depot:
            raise Premisse("GITHUB_REPOSITORY absent : le dépôt n'est pas nommé")

        entrees = []
        for sonde in liste:
            entrees.append({
                **sonde,
                "run": dernier_run(
                    sonde["fichier"], token=token, depot=depot, branche=arguments.branche
                ),
            })

        verdict = juger(entrees)
        lus = len(verdict["echecs"]) + len(verdict["vertes"]) + len(verdict["non_jugees"])
        if lus == 0:
            raise Premisse(
                "aucun run lu pour aucune sonde : la CI n'a jamais tourné, ou la "
                "branche est mauvaise — rien n'a été mesuré"
            )

        for ligne in verdict["echecs"]:
            print(f"[ROUGE] {ligne['fichier']} : {ligne['conclusion']} — {ligne['url']}")
        for ligne in verdict["non_jugees"]:
            print(f"::warning title=Sonde non jugée::{ligne['fichier']} — "
                  f"{ligne['conclusion'] or ligne['statut'] or 'sans conclusion'}")
        for ligne in verdict["jamais_executees"]:
            print(f"::warning title=Sonde jamais exécutée::{ligne['fichier']} n'a aucun run "
                  f"sur {arguments.branche} : elle ne protège rien")

        resultat = gerer_issue(
            verdict,
            depot=depot,
            branche=arguments.branche,
            token=token,
            simulation=arguments.simulation,
        )
        print(
            f"[OK] {len(verdict['vertes'])} verte(s), {len(verdict['echecs'])} en échec, "
            f"{len(verdict['non_jugees'])} non jugée(s), "
            f"{len(verdict['jamais_executees'])} jamais exécutée(s) — issue : {resultat}"
        )
        return 0

    except Premisse as premisse:
        print(f"[ECHEC] la surveillance ne peut pas conclure : {premisse}")
        print(f"::error title=Alerte des sondes::la surveillance ne peut pas conclure — {premisse}")
        # Une surveillance aveugle se DIT : on tente de l'écrire dans l'issue,
        # puis on sort en 2 pour que le run soit rouge aussi.
        if token and depot and not arguments.simulation:
            try:
                gerer_issue(
                    None,
                    depot=depot,
                    branche=arguments.branche,
                    token=token,
                    motif_premisse=str(premisse),
                )
            except Premisse as erreur:
                print(f"[ECHEC] l'issue n'a pas pu être écrite non plus : {erreur}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
