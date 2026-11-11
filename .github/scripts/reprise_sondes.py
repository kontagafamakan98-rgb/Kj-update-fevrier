#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UNE SONDE QUI N'A PAS MESURÉ NE DOIT PAS RESTER UN ROUGE : elle se REPREND.

── Ce que ce script existe pour empêcher ────────────────────────────────────
Mesuré le 11/11/2026 : entre 14:43 et 15:38 UTC, six sondes planifiées du dépôt
sont passées au rouge EN MÊME TEMPS, sans que rien n'ait changé — `main` était
le même commit depuis le 3 novembre. Aucune n'avait rendu de verdict : leurs
jobs ont échoué AVANT la sonde (une annotation de run dit
`unable to access 'https://github.com/…': The requested URL returned error: 403`,
c'est-à-dire `actions/checkout`, et les cinq autres n'ont publié aucun
`::error` de sonde). GitHub publiait au même moment « Actions is experiencing
degraded availability », et tout run relancé mourait en `startup_failure` —
y compris `backend-health-probe`, une sonde fetch qui n'installe pas de
navigateur. Relancées à la main une fois la plateforme rétablie, les six sondes
ont rendu 0. L'alerte, elle, avait déjà ouvert l'issue #301 « 6 sondes de
production en échec » : six accusations pour zéro mesure.

Ce script est la REPRISE AUTOMATIQUE, et elle est bornée par construction :

  * une sonde dont le dernier run sur la branche par défaut a échoué
    (`failure`, `timed_out` ou `startup_failure`) est relancée — la même
    commande que `gh run rerun`, donc le même commit, le même workflow, le même
    verdict attendu ;
  * TROIS tentatives au plus (`MAX_TENTATIVES`) : au-delà, le rouge est un
    verdict, pas un blip, et il reste rouge — c'est ce qui empêche la reprise de
    masquer une panne réelle ;
  * rien de plus vieux que 24 h (`FENETRE_HEURES`) n'est repris : une sonde
    rouge d'hier n'a pas à être relancée aujourd'hui par surprise ;
  * `success` n'est jamais repris, `cancelled` non plus (un run annulé n'a pas
    échoué : il n'a rien fait, et le relancer à la place de son planificateur
    serait une décision humaine) ;
  * le script ne se reprend PAS lui-même (sinon un rouge de reprise se
    relancerait toutes les 30 min).

── Trois sorties, jamais deux ───────────────────────────────────────────────
    0  verdict rendu : chaque sonde a été relancée, ou n'avait pas à l'être ;
    2  PRÉMISSE : jeton absent, dépôt non nommé, ou aucune sonde lue — la
       reprise n'a rien pu faire, et elle le dit au lieu de se taire.

Ce que ce script ne fait PAS, écrit pour ne pas le croire plus fort :
  * il ne juge pas la production — il relit des runs ;
  * il ne remplace pas l'alerte : `alerte_sondes.py` reste le seul à publier
    une issue, et il lit le DERNIER run, donc la tentative reprise ;
  * il ne rend pas une plateforme indisponible : pendant une panne d'Actions,
    une reprise échoue aussi. Elle est simplement retentée au passage suivant,
    dans la limite des trois tentatives.

Usage :
    GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo python .github/scripts/reprise_sondes.py
    … --racine . --branche main --simulation   (aucune écriture, pour un essai)
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Les accents des noms de sonde ne doivent pas tuer le script sous une console
# cp1252 (même garde que alerte_sondes.py).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

RACINE_DEFAUT = Path(__file__).resolve().parents[2]
WORKFLOWS = Path(".github") / "workflows"
CE_SCRIPT = Path(__file__).name

# Une sonde relancée trois fois sans succès a rendu son verdict : ce n'est plus
# un blip de plateforme, et la relancer encore reviendrait à ne jamais l'écouter.
MAX_TENTATIVES = 3

# Au-delà d'un jour, relancer serait un effet de bord surprise sur une sonde
# dont personne ne parle plus.
FENETRE_HEURES = 24

CONCLUSIONS_A_REPRENDRE = ("failure", "timed_out", "startup_failure")


class Premisse(RuntimeError):
    """La reprise ne peut pas juger — jamais un succès muet."""


def _alerte():
    """Le module d'alerte, chargé sur place : MÊME découverte des sondes.

    La liste des sondes n'est pas recopiée ici : une sonde déposée demain est
    reprise sans qu'on touche à ce fichier, exactement comme elle est alertée.
    """
    nom = "alerte_sondes"
    if nom in sys.modules:
        return sys.modules[nom]
    chemin = Path(__file__).with_name("alerte_sondes.py")
    specification = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(specification)
    module.registre = True  # type: ignore[attr-defined]
    sys.modules[nom] = module
    specification.loader.exec_module(module)
    return module


def sondes(racine: Path = RACINE_DEFAUT) -> list[dict]:
    """Les sondes PLANIFIÉES du dépôt, la reprise elle-même exclue.

    La découverte est celle de l'alerte (un `schedule:` + un `cron:`), pour
    qu'il n'existe pas deux définitions de « sonde » dans le dépôt.
    """
    alerte = _alerte()
    trouvees = []
    for sonde in alerte.sondes(racine):
        texte = (racine / WORKFLOWS / sonde["fichier"]).read_text(encoding="utf-8")
        if CE_SCRIPT in texte:
            # Sinon un rouge de reprise se relancerait toutes les 30 minutes.
            continue
        trouvees.append(sonde)
    return trouvees


def dernier_run(fichier: str, *, token: str, depot: str, branche: str, http=None):
    """Le dernier run d'une sonde sur la branche par défaut, ou `None`.

    Returns:
        dict | None: `{id, conclusion, tentative, url, cree_le}` ; `None` quand
        la sonde n'a JAMAIS tourné (l'API rend une liste vide, ou 404).
    """
    alerte = _alerte()
    http = http or alerte.requete
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
        "id": run.get("id"),
        "conclusion": (run.get("conclusion") or "").lower(),
        "tentative": int(run.get("run_attempt") or 1),
        "url": run.get("html_url") or "",
        "cree_le": run.get("created_at") or "",
    }


def a_reprendre(run: dict | None, *, maintenant: datetime | None = None) -> tuple[bool, str]:
    """Faut-il relancer ce run ? Rend `(oui/non, motif)` — le motif est publié.

    Un booléen seul ferait poser la question « pourquoi celui-là et pas
    l'autre » à chaque lecture des journaux.
    """
    if run is None:
        return False, "aucun run sur cette branche"
    conclusion = (run.get("conclusion") or "").lower()
    if conclusion not in CONCLUSIONS_A_REPRENDRE:
        return False, f"conclusion « {conclusion or 'en cours'} » : rien à reprendre"
    tentative = int(run.get("tentative") or 1)
    if tentative >= MAX_TENTATIVES:
        return False, f"{tentative} tentative(s) déjà faites : c'est un verdict, pas un blip"
    cree_le = run.get("cree_le") or ""
    if cree_le:
        try:
            date = datetime.fromisoformat(cree_le.replace("Z", "+00:00"))
        except ValueError:
            date = None
        if date is not None:
            maintenant = maintenant or datetime.now(timezone.utc)
            if maintenant - date > timedelta(hours=FENETRE_HEURES):
                return False, f"run de plus de {FENETRE_HEURES} h : hors reprise"
    return True, f"{conclusion} (tentative {tentative}/{MAX_TENTATIVES})"


def reprendre(run: dict, *, token: str, depot: str, http=None) -> None:
    """Relance le run ENTIER qui a échoué — mêmes commit, workflow et verdict."""
    alerte = _alerte()
    http = http or alerte.requete
    statut, charge = http(
        "POST", f"/repos/{depot}/actions/runs/{run['id']}/rerun", token=token
    )
    if statut not in (200, 201, 202, 204):
        raise Premisse(
            f"la reprise de {run.get('url') or run.get('id')} a été refusée "
            f"(API {statut}, {str(charge.get('message', ''))[:120]})"
        )


def main(argv: list[str] | None = None, http=None) -> int:
    """ Lit les derniers runs des sondes et relance ceux qui n'ont pas mesuré."""
    analyseur = argparse.ArgumentParser(description="Reprise des sondes Kojo")
    analyseur.add_argument("--racine", default=str(RACINE_DEFAUT))
    analyseur.add_argument("--branche", default="main")
    analyseur.add_argument("--simulation", action="store_true", help="n'écrit rien")
    arguments = analyseur.parse_args(argv)

    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    depot = (os.environ.get("GITHUB_REPOSITORY") or "").strip()

    try:
        liste = sondes(Path(arguments.racine))
        print(f"[INFO] {len(liste)} sonde(s) planifiée(s) à reprendre")
        if not liste:
            raise Premisse("aucune sonde lue : c'est la LECTURE qui est cassée")
        if not token:
            raise Premisse("GITHUB_TOKEN absent : aucune sonde ne peut être relancée")
        if not depot:
            raise Premisse("GITHUB_REPOSITORY absent : le dépôt n'est pas nommé")

        reprises = 0
        for sonde in liste:
            run = dernier_run(
                sonde["fichier"], token=token, depot=depot,
                branche=arguments.branche, http=http,
            )
            oui, motif = a_reprendre(run)
            if not oui:
                print(f"[SKIP] {sonde['fichier']} : {motif}")
                continue
            if arguments.simulation:
                print(f"[SIMU] {sonde['fichier']} : {motif} — serait relancée")
                reprises += 1
                continue
            reprendre(run, token=token, depot=depot, http=http)
            reprises += 1
            print(f"[REPRISE] {sonde['fichier']} : {motif} — {run.get('url', '')}")

        print(f"[OK] {len(liste)} sonde(s) lue(s), {reprises} reprise(s)")
        return 0

    except Premisse as premisse:
        print(f"[ECHEC] la reprise ne peut pas conclure : {premisse}")
        print(f"::error title=Reprise des sondes::elle ne peut pas conclure — {premisse}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
