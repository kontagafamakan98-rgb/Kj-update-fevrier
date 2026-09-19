#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Harnais de mutation GÉNÉRIQUE des gardes du dépôt.

Ce que ce script prouve, et qu'aucun test ne peut prouver à lui seul : quand on
neutralise une ligne du garde RÉEL, la preuve déclarée de ce garde ROUGIT.

Un test qui injecte une régression dans une fixture prouve que le garde sait
détecter cette régression *telle qu'il est écrit aujourd'hui* ; il ne prouve pas
que la ligne qui la détecte est bien celle qu'on croit. Inversement, un garde
dont on neutralise une règle et dont RIEN ne rougit est un garde qui porte une
règle morte — exactement le motif F17 de CI-COVERAGE.md, généralisé.

Le harnais est GÉNÉRIQUE : il ne connaît aucun garde en particulier. Tout vient
de `.github/scripts/guard-proofs.json` — quelle ligne neutraliser, quelle preuve
doit rougir, ce que sa sortie doit nommer. Ajouter un garde prouvé par mutation
est un ajout de DONNÉES, pas de code.

DISCIPLINE DE MUTATION (ACCEPTÉE ET APPLIQUÉE ICI) :
  * les fichiers sont lus et écrits en MODE BRUT (`open(..., "rb"/"wb")`) — un
    aller-retour texte convertit LF en CRLF sous Windows et « restauré »
    deviendrait faux sans que git le signale ;
  * la cible est restaurée dans un `finally`, puis son empreinte SHA-1 est
    comparée à celle d'avant : une restauration non vérifiée est une mutation
    laissée dans l'arbre ;
  * `PYTHONDONTWRITEBYTECODE=1` : sans lui, un `.pyc` compilé pendant la mutation
    survit à la restauration de la source (même seconde, même taille) ;
  * une mutation INTROUVABLE (le littéral a disparu) est un ÉCHEC, jamais un
    succès silencieux — sinon un refactor suffirait à éteindre la preuve.

Limite assumée : la mutation touche le fichier réel du dépôt (le temps de la
preuve). C'est le prix de la généralité : rejouer une suite de tests sur une
copie ne prouverait pas le garde réellement exécuté par la CI. La restauration
est vérifiée par empreinte, et le script refuse de rendre la main sans elle.

Usage :
    python .github/scripts/check-guard-mutations.py               # tous
    python .github/scripts/check-guard-mutations.py --runner node
    python .github/scripts/check-guard-mutations.py --list        # valide le spec
    python .github/scripts/check-guard-mutations.py --only ID
"""
import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("KOJO_ROOT", SCRIPT_DIR.parent.parent)).resolve()
SPEC = SCRIPT_DIR / "guard-proofs.json"

RUNNERS = ("node", "python")

# La sortie porte des flèches (→) et des accents. Sous Windows, la console est en
# cp1252 : un `print` lèverait UnicodeEncodeError et l'étape de CI locale
# échouerait pour une raison d'affichage. `backslashreplace` garde les accents
# justes localement et ne dégrade que les caractères absents du jeu — sur un
# runner Ubuntu (UTF-8) rien ne change.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")


def lire(path):
    with io.open(path, "rb") as flux:
        return flux.read()


def ecrire(path, data):
    with io.open(path, "wb") as flux:
        flux.write(data)


def empreinte(data):
    return hashlib.sha1(data).hexdigest()


class SpecInvalide(Exception):
    """Le registre ne dit pas une chose vérifiable."""


CHAMPS_GARDE = {"chemin", "role", "invoque_par", "preuve", "runner", "motif"}


def charger_spec(chemin=SPEC):
    """Charge et VALIDE le registre. Un spec invalide est une erreur, pas un
    succès vide : c'est la même règle que pour un garde sans périmètre."""
    if not Path(chemin).exists():
        raise SpecInvalide("registre introuvable : %s" % chemin)
    try:
        spec = json.loads(Path(chemin).read_text(encoding="utf-8"))
    except ValueError as exc:
        raise SpecInvalide("registre illisible (%s)" % exc)

    for cle in ("gardes", "mutations"):
        if not isinstance(spec.get(cle), list) or not spec[cle]:
            raise SpecInvalide("registre : « %s » doit être une liste non vide" % cle)

    chemins = set()
    for garde in spec["gardes"]:
        inconnus = set(garde) - CHAMPS_GARDE
        if inconnus:
            raise SpecInvalide("garde %s : champ inconnu %s" % (garde.get("chemin"), sorted(inconnus)))
        for requis in ("chemin", "role", "invoque_par"):
            if not garde.get(requis):
                raise SpecInvalide("garde %s : « %s » manquant" % (garde.get("chemin"), requis))
        if garde["role"] not in ("garde", "outil"):
            raise SpecInvalide("garde %s : role « %s » inconnu" % (garde["chemin"], garde["role"]))
        if garde["invoque_par"] not in ("ci", "test", "aucun"):
            raise SpecInvalide(
                "garde %s : invoque_par « %s » inconnu" % (garde["chemin"], garde["invoque_par"])
            )
        if garde["chemin"] in chemins:
            raise SpecInvalide("garde %s déclaré deux fois" % garde["chemin"])
        chemins.add(garde["chemin"])

    ids = set()
    for mutation in spec["mutations"]:
        for requis in ("id", "garde", "cible", "trouve", "remplace", "runner", "preuve",
                       "commande", "cwd", "attend"):
            if not mutation.get(requis):
                raise SpecInvalide("mutation %s : « %s » manquant" % (mutation.get("id", "?"), requis))
        if mutation["id"] in ids:
            raise SpecInvalide("mutation %s déclarée deux fois" % mutation["id"])
        ids.add(mutation["id"])
        if mutation["garde"] not in chemins:
            raise SpecInvalide(
                "mutation %s : garde « %s » absent du registre" % (mutation["id"], mutation["garde"])
            )
        if mutation["cible"] not in chemins:
            raise SpecInvalide(
                "mutation %s : cible « %s » absente du registre" % (mutation["id"], mutation["cible"])
            )
        if mutation["garde"] != mutation["cible"]:
            raise SpecInvalide(
                "mutation %s : le harnais ne mute que le garde lui-même (%s ≠ %s)"
                % (mutation["id"], mutation["garde"], mutation["cible"])
            )
        if mutation["runner"] not in RUNNERS:
            raise SpecInvalide(
                "mutation %s : runner « %s » inconnu" % (mutation["id"], mutation["runner"])
            )
        if mutation["trouve"] == mutation["remplace"]:
            raise SpecInvalide("mutation %s : « trouve » == « remplace » (aucun effet)" % mutation["id"])
    return spec


def commande_de(mutation):
    """La commande de preuve : `{python}` devient l'interpréteur courant (le venv
    du job, jamais un python3 implicite) et le premier mot est résolu sur le
    PATH. Sous Windows, `npx` est un `npx.cmd` : `subprocess` ne trouve pas le
    fichier sans extension et la preuve échouerait par « [WinError 2] », c'est-à-
    dire pour une raison qui n'a rien à voir avec le garde."""
    commande = [arg.replace("{python}", sys.executable) for arg in mutation["commande"]]
    resolu = shutil.which(commande[0])
    if resolu:
        commande[0] = resolu
    return commande


def executer(mutation, racine):
    """Applique la mutation, exécute la preuve, restaure. Retourne
    (ok, detail). L'état de l'arbre est TOUJOURS restauré, y compris si la
    preuve explose."""
    cible = racine / mutation["cible"]
    if not cible.exists():
        return False, "cible introuvable : %s" % mutation["cible"]

    original = lire(cible)
    initiale = empreinte(original)
    trouve = mutation["trouve"].encode("utf-8")
    occurrences = original.count(trouve)
    if occurrences != 1:
        return False, (
            "littéral à neutraliser trouvé %d fois dans %s (attendu 1) — la mutation "
            "ne vise plus rien : %r" % (occurrences, mutation["cible"], mutation["trouve"][:70])
        )

    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    try:
        ecrire(cible, original.replace(trouve, mutation["remplace"].encode("utf-8")))
        try:
            proc = subprocess.run(
                commande_de(mutation), cwd=str(racine / mutation["cwd"]),
                capture_output=True, env=env,
            )
        except OSError as exc:
            # Une preuve qui ne peut PAS tourner n'est pas une preuve : c'est un
            # échec nommé, jamais une exception qui laisserait la mutation en place.
            return False, "preuve non exécutable (%s) : %s" % (mutation["commande"][0], exc)
        sortie = (proc.stdout + proc.stderr).decode("utf-8", "replace")
    finally:
        ecrire(cible, original)

    restauree = empreinte(lire(cible))
    if restauree != initiale:
        return False, "RESTAURATION IMPOSSIBLE : %s (SHA-1 %s ≠ %s)" % (
            mutation["cible"], restauree, initiale,
        )
    if proc.returncode == 0:
        return False, (
            "la preuve %s est restée VERTE : neutraliser ce refus ne fait rougir personne "
            "(code 0)" % mutation["preuve"]
        )
    manquants = [motif for motif in mutation["attend"] if motif not in sortie]
    if manquants:
        # Montrer CE QUE la preuve a réellement imprimé : un motif devenu faux
        # (test renommé, refacteur) doit se réparer en un essai, pas en tâtonnant.
        extrait = "\n".join(
            ligne for ligne in sortie.splitlines()
            if "FAILED" in ligne or ligne.strip().startswith("×") or "failed" in ligne
        )[:800]
        return False, (
            "la preuve a rougi mais n'a pas nommé %s — le rouge ne vient pas de ce refus"
            "\n         sortie : %s" % (manquants, extrait or sortie[-400:])
        )
    return True, "rouge nommé (%s)" % ", ".join(mutation["attend"])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runner", choices=RUNNERS, help="ne rejoue que ce runner")
    parser.add_argument("--only", help="ne rejoue que cette mutation")
    parser.add_argument("--list", action="store_true", help="valide le registre sans muter")
    args = parser.parse_args(argv)

    try:
        spec = charger_spec()
    except SpecInvalide as exc:
        print("[ECHEC] %s" % exc)
        print("::error title=Registre de preuves invalide::%s" % exc)
        return 1

    mutations = spec["mutations"]
    if args.runner:
        mutations = [m for m in mutations if m["runner"] == args.runner]
        if not mutations:
            # Un filtre qui ne couvre rien est un faux vert : le runner demandé
            # n'a plus aucune mutation, donc l'étape de CI ne prouverait rien.
            print("[ECHEC] --runner %s ne sélectionne AUCUNE mutation" % args.runner)
            return 1
    if args.only:
        mutations = [m for m in mutations if m["id"] == args.only]
        if not mutations:
            print("[ECHEC] --only %s ne correspond à aucune mutation" % args.only)
            return 1

    if args.list:
        print("Registre valide : %d gardes, %d mutations" % (len(spec["gardes"]), len(spec["mutations"])))
        for mutation in spec["mutations"]:
            print("  [%s] %s → %s" % (mutation["runner"], mutation["id"], mutation["preuve"]))
        return 0

    print("Harnais de mutation des gardes — %d mutation(s) à rejouer" % len(mutations))
    echecs = []
    for mutation in mutations:
        ok, detail = executer(mutation, REPO_ROOT)
        print("  %s %s" % ("[OK]   " if ok else "[ECHEC]", mutation["id"]))
        print("         %s" % detail)
        if not ok:
            echecs.append(mutation["id"])
            print("::error title=Mutation sans preuve::%s — %s" % (mutation["id"], detail))

    print()
    if echecs:
        print("[ERR] %d mutation(s) sans preuve d'échec : %s" % (len(echecs), ", ".join(echecs)))
        return 1
    print("[OK] chaque mutation neutralise un garde et fait rougir SA preuve (%d/%d)." % (
        len(mutations), len(mutations),
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
