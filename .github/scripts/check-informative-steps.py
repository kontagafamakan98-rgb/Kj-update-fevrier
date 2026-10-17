#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refuse une étape de workflow qui ne peut pas échouer sans être DÉCLARÉE.

Pourquoi ce garde
-----------------
F9 (CI-COVERAGE.md) avait une cause unique : une étape qui publiait un rapport
sans pouvoir faire rougir le run. Elle a été retirée le 10/10/2026, et la sonde
SEO est désormais refusée hors `--strict` par `check-seo-probe-strict.py`. Mais
la famille est plus large que cette sonde : n'importe quelle étape peut redevenir
informative par la SYNTAXE — `continue-on-error: true`, une commande neutralisée
(`|| true`, `|| :`, `|| exit 0`), des erreurs ignorées (`set +e`) — et cette
syntaxe-là ne laisse aucune trace dans un verdict : le step est vert, le rapport
est publié, personne ne rougit.

Ce garde rend ces formes VISIBLES et EXIGE qu'elles soient déclarées, une par une,
avec leur motif. Une étape qui ne peut pas échouer reste possible — il y en a de
légitimes (mesurer le code de sortie d'un garde dans un harnais de mutation,
avaler l'invite interactive d'un outil d'outillage, `kill` un processus déjà
mort) —, mais elle ne peut plus être ANONYME. C'est la règle du registre des
preuves (`guard-proofs.json`), portée à la syntaxe des workflows : une exception
s'écrit, elle ne se contente pas d'exister.

Ce qu'il refuse
---------------
Dans tout workflow de `.github/workflows/`, pour chaque étape (et chaque job) :

1. une occurrence NON DÉCLARÉE d'une des formes ci-dessus — le refus nomme le
   fichier, la ligne, le job, l'étape et la forme ;
2. une déclaration PÉRIMÉE : une entrée du registre qui ne correspond plus à
   aucune occurrence (étape renommée, `|| true` retiré) — sinon le registre
   deviendrait une liste d'espoirs ;
3. un NOMBRE d'occurrences qui a changé dans une étape déclarée : une seconde
   neutralisation ajoutée à côté d'une neutralisation légitime serait une
   neutralisation non déclarée ;
4. une déclaration sans `motif`, ou dont le motif est trop court pour en être un ;
5. il REFUSE DE CONCLURE sous un plancher de lecture (mise en forme des workflows
   changée, mauvais répertoire) : un garde qui ne voit rien ne prouve rien.

Ce qu'il ne couvre pas, et qui est écrit ici pour ne pas être pris pour couvert :
qu'un SCRIPT soit informatif par construction (son mode par défaut ne bloque pas)
ne se lit pas dans la syntaxe d'un workflow. Ces surfaces-là ont leur propre garde
quand elles en méritent un (`check-seo-probe-strict.py` pour la sonde SEO,
`--require-secrets` pour la sonde email) et, quand ce sont des rapports assumés,
une décision écrite dans `AUDIT-VERIFICATIONS-NON-BLOQUANTES.md`. Ce garde tient
la surface SYNTAXIQUE de la CI.

Usage :
    python3 .github/scripts/check-informative-steps.py          # le dépôt
    python3 .github/scripts/check-informative-steps.py --list   # l'inventaire mesuré
    python3 .github/scripts/check-informative-steps.py --root DIR
Sortie : 0 si toutes les formes sont déclarées, 1 sinon (annotations `::error`).
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

# Les NOMS d'étapes lus dans les workflows contiennent des flèches et des accents
# (c'est le style du dépôt) : sous une console Windows en cp1252, `print` lèverait
# un UnicodeEncodeError et le garde mourrait au lieu de juger. Même garde que
# `check-guard-mutations.py`.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
REGISTRE = Path(__file__).resolve().parent / "informative-steps.json"

# Les formes qui rendent une étape incapable d'échouer, et le vocabulaire utilisé
# dans le registre. Ce sont des MOTIFS, pas des listes de lieux : le garde
# recalcule la liste à chaque exécution.
FORMES = {
    "continue-on-error": re.compile(r"^\s*continue-on-error:\s*(true|yes|on|1)\s*$", re.IGNORECASE),
    "commande neutralisee": re.compile(r"\|\|\s*(true|:|exit 0)\b"),
    "erreurs ignorees": re.compile(r"\bset\s+(\+e|\+o\s+errexit)\b"),
}

# Ce que le registre a le droit de nommer, et rien d'autre.
CHAMPS = ("fichier", "job", "etape", "forme", "nombre", "motif")

# Plancher de lecture : sous ce nombre d'étapes lues, c'est le LECTEUR qui est
# cassé, pas le dépôt qui a cessé d'avoir des étapes. Mesuré à 68 le 12/10/2026.
MIN_ETAPES = 40

# Plancher du motif : « outillage » n'en est pas un.
MIN_MOTIF = 40

JOB = re.compile(r"^ {2}(?P<nom>[A-Za-z0-9_-]+):\s*$")
ITEM = re.compile(r"^(?P<indent> *)- ")
CLE = re.compile(r"^(?P<indent> *)(?P<cle>[A-Za-z0-9_-]+):(?P<reste>.*)$")
BLOCS = ("|", ">", "|-", ">-", "|2", ">2")


def _indentation(ligne: str) -> int:
    return len(ligne) - len(ligne.lstrip(" "))


def _cle_de_lecture(ligne: str):
    return CLE.match(ligne)


def _nom_de_l_etape(ligne_item: str, bloc: list[str]) -> str:
    """Le `name:` d'une étape, sinon son `uses:`.

    Le premier élément de l'item porte le tiret (`- name: …`) : sans le retirer, la
    clé se lit `- name`, l'étape reste anonyme, et le registre ne peut plus la
    nommer — c'est la première chose que ce lecteur doit faire correctement.
    """
    premiere = ITEM.sub("", ligne_item, count=1)
    for ligne in [premiere] + bloc:
        correspondance = _cle_de_lecture(ligne)
        if not correspondance:
            continue
        if correspondance.group("cle") == "name":
            valeur = correspondance.group("reste").strip().strip("\"'")
            if valeur:
                return valeur
        if correspondance.group("cle") == "uses":
            return correspondance.group("reste").strip().strip("\"'")
    return ""


def occurrences(chemin: Path) -> tuple[list[dict], int]:
    """Les formes incapables d'échouer d'un workflow, et le nombre d'étapes lues.

    Chaque occurrence est `{fichier, job, etape, forme, ligne}`. Lecture ligne à
    ligne, sans PyYAML — même choix que `check-workflow-pins.py` et
    `check-seo-probe-strict.py`. Une étape va de son item `- ` au suivant de même
    niveau (ou moins indenté) ; son `run:` est un bloc scalaire déplié, dont chaque
    ligne est jugée séparément, parce que c'est là que vivent les `|| true`.
    """
    lignes = chemin.read_text(encoding="utf-8").splitlines()
    trouvees: list[dict] = []
    job = ""
    dans_jobs = False
    # Indentation des items de `steps:` du job courant. Ce n'est PAS « tout item » :
    # un cron (`    - cron: …`), une matrice ou une liste de chemins sont des items
    # eux aussi, et les compter comme des étapes ferait mentir le plancher de
    # lecture comme le nom des étapes.
    indent_steps: int | None = None
    etapes_lues = 0
    index = 0
    while index < len(lignes):
        ligne = lignes[index]
        if _indentation(ligne) == 0 and ligne.strip() == "jobs:":
            dans_jobs = True
            index += 1
            continue
        entete_job = JOB.match(ligne)
        if dans_jobs and entete_job:
            job = entete_job.group("nom")
            indent_steps = None
            index += 1
            continue
        cle = _cle_de_lecture(ligne)
        # `steps:` d'un job : indenté de 4 (convention de tous les workflows du
        # dépôt). Exiger cette indentation évite qu'une ligne `steps:` écrite dans
        # un bloc scalaire fasse croire que les items suivants sont des étapes.
        if (
            dans_jobs and cle and cle.group("cle") == "steps"
            and len(cle.group("indent")) == 4 and not cle.group("reste").strip()
        ):
            indent_steps = 6
            index += 1
            continue
        item = ITEM.match(ligne)
        if not item or indent_steps is None or _indentation(ligne) != indent_steps:
            # `continue-on-error` au niveau du JOB : hors de toute étape, donc
            # indenté plus haut que les items. Il rend TOUT le job incapable
            # d'échouer, y compris ses étapes de verdict.
            if FORMES["continue-on-error"].match(ligne) and _indentation(ligne) <= 4:
                trouvees.append({
                    "fichier": chemin.name, "job": job, "etape": f"<job {job}>",
                    "forme": "continue-on-error", "ligne": index + 1,
                })
            index += 1
            continue

        indent_item = _indentation(ligne)
        fin = index + 1
        while fin < len(lignes):
            if lignes[fin].strip() and _indentation(lignes[fin]) <= indent_item:
                break
            fin += 1
        bloc = lignes[index + 1:fin]
        etapes_lues += 1
        etape = _nom_de_l_etape(ligne, bloc) or f"<étape {etapes_lues} de {job}>"

        for decalage, contenu in enumerate(bloc):
            # `continue-on-error` de l'ÉTAPE : dans son bloc, indenté sous l'item.
            # (`bloc` exclut la ligne de l'item, d'où le +2 : son numéro de ligne
            # est `index + 1`.)
            if FORMES["continue-on-error"].match(contenu) and _indentation(contenu) > indent_item:
                trouvees.append({
                    "fichier": chemin.name, "job": job, "etape": etape,
                    "forme": "continue-on-error", "ligne": index + decalage + 2,
                })

        # Le `run:` de l'étape : une commande en ligne, ou un bloc scalaire déplié.
        #
        # La ligne de l'ITEM en fait partie : `- run: node x.js || true` (étape sans
        # `name:`) porte sa commande SUR le tiret, et une première version de ce
        # lecteur ne jugeait que les lignes SUIVANTES — la forme la plus courte
        # était donc invisible, c'est-à-dire exactement ce que ce garde existe pour
        # empêcher. Chaque ligne jugée porte sa ligne de fichier et l'indentation de
        # la CLÉ, dont dépend le dépliage du bloc scalaire.
        bloc_juge = [(index + 1, ITEM.sub("", ligne, count=1), indent_item + 2)]
        bloc_juge += [(index + decalage + 2, contenu, _indentation(contenu))
                      for decalage, contenu in enumerate(bloc)]
        for position, (numero_cle, texte_cle, indent_cle) in enumerate(bloc_juge):
            correspondance = _cle_de_lecture(texte_cle)
            if not (correspondance and correspondance.group("cle") == "run"):
                continue
            reste = correspondance.group("reste").strip()
            if reste and not reste.startswith(BLOCS):
                suite = [(numero_cle, reste)]
            else:
                suite = []
                suivant = position + 1
                while suivant < len(bloc_juge):
                    numero_suivant, texte_suivant, indent_suivante = bloc_juge[suivant]
                    if texte_suivant.strip() and indent_suivante <= indent_cle:
                        break
                    suite.append((
                        numero_suivant,
                        texte_suivant[indent_cle + 1:] if len(texte_suivant) > indent_cle else "",
                    ))
                    suivant += 1
            for numero, commande in suite:
                if commande.strip().startswith("#"):
                    continue
                for forme in ("commande neutralisee", "erreurs ignorees"):
                    if FORMES[forme].search(commande):
                        trouvees.append({
                            "fichier": chemin.name, "job": job, "etape": etape,
                            "forme": forme, "ligne": numero,
                        })
        index = fin
    return trouvees, etapes_lues


def charger_registre(chemin=REGISTRE) -> list[dict]:
    """Le registre VALIDÉ : un registre illisible est une erreur, pas un vert."""
    try:
        with io.open(chemin, encoding="utf-8") as flux:
            registre = json.load(flux)
    except (OSError, ValueError) as erreur:
        raise SystemExit(f"[ECHEC] registre illisible ({chemin}) : {erreur}")
    entrees = registre.get("declarations")
    if not isinstance(entrees, list) or not entrees:
        raise SystemExit(
            f"[ECHEC] registre sans « declarations » ({chemin}) : le garde ne peut pas "
            "juger ce qu'il ne peut pas lire"
        )
    for entree in entrees:
        for champ in CHAMPS:
            if entree.get(champ) in (None, ""):
                raise SystemExit(
                    f"[ECHEC] déclaration incomplète ({entree}) : le champ « {champ} » manque"
                )
        if entree["forme"] not in FORMES:
            raise SystemExit(
                f"[ECHEC] déclaration {entree['fichier']} → forme inconnue « {entree['forme']} » "
                f"(connues : {sorted(FORMES)})"
            )
    return entrees


def _cle(candidat: dict) -> tuple:
    return (candidat["fichier"], candidat["job"], candidat["etape"], candidat["forme"])


def _nomme(cle: tuple) -> str:
    return f"{cle[0]} | {cle[1]} | {cle[2]} | {cle[3]}"


def confronter(occurrences_mesurees: list[dict], declarations: list[dict]) -> list[str]:
    """Les refus : non déclarée, périmée, ou nombre qui a changé. Aucun verdict ici."""
    mesurees: dict[tuple, list[dict]] = {}
    for occurrence in occurrences_mesurees:
        mesurees.setdefault(_cle(occurrence), []).append(occurrence)

    declarees: dict[tuple, dict] = {}
    refus: list[str] = []
    for declaration in declarations:
        cle = _cle(declaration)
        if cle in declarees:
            refus.append(f"{_nomme(cle)} : déclaré deux fois")
            continue
        if len(declaration["motif"].strip()) < MIN_MOTIF:
            refus.append(
                f"{_nomme(cle)} : motif trop court pour en être un ({MIN_MOTIF} caractères "
                "minimum) — une exception s'explique"
            )
        declarees[cle] = declaration

    for cle, groupe in sorted(mesurees.items()):
        if cle not in declarees:
            refus.append(
                f"{cle[0]}:{groupe[0]['ligne']} | {cle[1]} | {cle[2]} | {cle[3]} : cette étape ne "
                "peut pas échouer et n'est PAS déclarée dans informative-steps.json. La rendre "
                "capable d'échouer, ou la déclarer avec son motif — un rapport qui ne peut pas "
                "échouer n'est pas une vérification (F9, CI-COVERAGE.md)."
            )
            continue
        attendu = declarees[cle]["nombre"]
        if len(groupe) != attendu:
            refus.append(
                f"{cle[0]}:{groupe[0]['ligne']} | {cle[1]} | {cle[2]} | {cle[3]} : "
                f"{len(groupe)} occurrence(s) mesurée(s), {attendu} déclarée(s) — une forme "
                "ajoutée à côté d'une forme déclarée est une forme non déclarée"
            )

    for cle in sorted(declarees):
        if cle not in mesurees:
            refus.append(
                f"{_nomme(cle)} : déclaration PÉRIMÉE (aucune occurrence mesurée) — retirer "
                "l'entrée, ou remettre la forme qu'elle décrit"
            )
    return refus


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    inventaire = "--list" in argv
    argv = [a for a in argv if a != "--list"]
    racine = REPO_ROOT
    if argv and argv[0] == "--root":
        racine = Path(argv[1])
    workflows = sorted((racine / ".github" / "workflows").glob("*.yml"))
    if not workflows:
        print(f"[ECHEC] aucun workflow lu dans {racine / '.github' / 'workflows'} — le garde ne peut rien vérifier.")
        print("::error title=Étapes informatives::aucun workflow lu — le garde ne peut pas conclure")
        return 1

    occurrences_mesurees: list[dict] = []
    etapes_lues = 0
    for chemin in workflows:
        try:
            trouvees, total = occurrences(chemin)
        except OSError as erreur:
            print(f"[ECHEC] {chemin} illisible ({erreur.strerror}) : le garde ne peut rien vérifier")
            print("::error title=Étapes informatives::workflow illisible — le garde ne peut pas conclure")
            return 1
        occurrences_mesurees.extend(trouvees)
        etapes_lues += total

    if etapes_lues < MIN_ETAPES:
        print(
            f"[ECHEC] {etapes_lues} étape(s) lue(s) dans {len(workflows)} workflow(s), sous le plancher "
            f"de {MIN_ETAPES} : c'est la LECTURE qui est cassée (mise en forme changée), pas le dépôt "
            "qui a cessé d'avoir des étapes."
        )
        print("::error title=Étapes informatives::plancher de lecture non atteint — refus de conclure")
        return 1

    if inventaire:
        print(f"Inventaire mesuré — {len(occurrences_mesurees)} occurrence(s) sur {etapes_lues} étape(s) lues :")
        for occurrence in sorted(occurrences_mesurees, key=_cle):
            print(f"   - {occurrence['fichier']}:{occurrence['ligne']} | {occurrence['job']} | "
                  f"{occurrence['etape']} | {occurrence['forme']}")
        return 0

    refus = confronter(occurrences_mesurees, charger_registre())
    if refus:
        print(f"[ECHEC] {len(refus)} écart(s) sur les étapes qui ne peuvent pas échouer :")
        for message in refus:
            print(f"   - {message}")
            print(f"::error title=Étapes informatives::{message}")
        return 1

    print(
        f"[OK] {len(occurrences_mesurees)} forme(s) « étape incapable d'échouer », toutes DÉCLARÉES "
        f"dans informative-steps.json ({etapes_lues} étape(s) lues dans {len(workflows)} workflow(s)) :"
    )
    for occurrence in sorted(occurrences_mesurees, key=_cle):
        print(f"   - {occurrence['fichier']} | {occurrence['job']} | {occurrence['etape']} | "
              f"{occurrence['forme']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
