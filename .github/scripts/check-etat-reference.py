#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""État de RÉFÉRENCE des fichiers qu'une mutation peut laisser dérivés.

── Le trou que ce garde ferme ─────────────────────────────────────────────
Le harnais de mutation (`.github/scripts/check-guard-mutations.py`) ÉCRIT dans un
fichier réel du dépôt, exécute la preuve du garde, puis restaure — et VÉRIFIE la
restauration par empreinte. Tant que le processus va jusqu'au bout, une mutation
laissée dans l'arbre est donc impossible : la restauration est mesurée, pas
supposée.

Ce qui reste possible, et qui se produit : le processus MEURT entre l'écriture et
la restauration (Ctrl-C, expiration de la commande, runner annulé, coupure). Le
`finally` n'est alors pas exécuté, la source porte encore la ligne neutralisée, et
RIEN ne le dit : la suite locale passe sur un dépôt muté, et le garde muté peut
même y rester vert. Une mutation laissée en place est un mensonge silencieux —
même famille que F17 de CI-COVERAGE.md, appliquée cette fois à l'arbre de travail
lui-même.

── La règle ───────────────────────────────────────────────────────────────
Chaque fichier qu'une mutation peut toucher porte un ÉTAT DE RÉFÉRENCE : son
empreinte SHA-256, enregistrée dans `.github/scripts/etat-reference.json` avec la
date et le MOTIF de la dernière fois où cet état a été déclaré. Un écart à cette
référence est REFUSÉ — nommément, avec les deux empreintes et le remède — sauf
s'il a été DÉCLARÉ, c'est-à-dire adopté comme la nouvelle référence
(`--enregistrer`, qui exige un motif d'au moins 40 caractères). Il n'y a donc pas
de dérive muette : soit le fichier est à sa référence, soit quelqu'un a dit
pourquoi il ne l'est plus.

Le PÉRIMÈTRE, lui, n'est pas recopié : il se DÉRIVE du registre des preuves
(`guard-proofs.json` — la liste des mutations déclarées), auquel on retire la
machinerie déclarée hors périmètre (ce garde lui-même, qui ne peut pas se juger
pendant qu'on le mute). Ajouter une mutation demain élargit donc le périmètre
tout seul, et une cible de mutation absente de la référence est refusée comme
« surface NON déclarée » : une surface aveugle se déclare.

── Ce que ce garde refuse, nommément ──────────────────────────────────────
  * une dérive non déclarée, avec ses deux empreintes ;
  * une dérive qui est en réalité une MUTATION ENCORE EN PLACE : le registre des
    preuves dit alors quelle ligne a été neutralisée, et le refus la nomme ;
  * une cible de mutation absente de la référence (surface aveugle) ;
  * une entrée PÉRIMÉE : un fichier de référence disparu, ou une entrée qui ne
    correspond plus à aucune cible de mutation ;
  * une déclaration MUETTE : motif de moins de 40 caractères, date illisible,
    surface hors périmètre sans remède ;
  * et il REFUSE DE CONCLURE sous son plancher de lecture : un lecteur cassé
    rendrait tous ses refus muets.

── Pourquoi la référence n'est PAS le commit ──────────────────────────────
La règle « le fichier doit être celui de git » a l'air plus simple, et elle est
fausse ici : pendant qu'on travaille, l'arbre est LÉGITIMEMENT en avance sur le
commit. Un garde qui refuserait tout écart à HEAD refuserait le travail en cours,
donc apprendrait à être ignoré. La référence est un fait DATÉ et DÉCLARÉ, qu'on
déplace en le disant — pas un contrôle de propreté de l'arbre.

── La fin de ligne ne décide pas du verdict ───────────────────────────────
L'empreinte porte sur le contenu NORMALISÉ (CRLF → LF). `core.autocrlf=true` sur
un poste Windows et pas sur un runner Ubuntu : sans normalisation, le même
contenu commité rendrait deux empreintes et le garde refuserait en accusant la
fin de ligne (mesuré sur ce poste : 82 cibles sur 82 en LF, un clone neuf pouvant
en produire d'autres). Le harnais, lui, écrit en mode BRUT pour une autre raison —
rendre exactement les octets d'avant — et les deux règles ne se contredisent pas.

── Limite assumée ─────────────────────────────────────────────────────────
`--enregistrer` adopte ce que l'arbre porte : une mutation faite À LA MAIN, hors
registre, lui est indistinguable d'un changement voulu. Ce qu'il INTERDIT, et qui
est le cas réel, c'est d'adopter un état qui porte une mutation DÉCLARÉE (celle du
harnais) : on ne blanchit pas une mutation qu'on sait nommer.

Usage :
    python .github/scripts/check-etat-reference.py
    python .github/scripts/check-etat-reference.py --enregistrer \\
        --chemin <fichier> --motif "pourquoi ce nouvel état est la référence"
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(os.environ.get("KOJO_ROOT", SCRIPT_DIR.parent.parent)).resolve()
REGISTRE_DEFAUT = SCRIPT_DIR / "etat-reference.json"
PREUVES_DEFAUT = SCRIPT_DIR / "guard-proofs.json"

# PLANCHER DE LECTURE. Sous ce nombre de fichiers réellement jugés, le garde
# refuse de conclure : un périmètre cassé (registre tronqué, dérivation muette)
# rendrait tous ses refus silencieux tout en sortant en 0. Mesure du 16/10/2026 :
# 82 cibles de mutation, donc 82 fichiers jugés — le plancher est à 60 pour
# qu'une disparition massive soit vue, sans être si haut qu'un périmètre
# légitimement réduit paraisse cassé.
PLANCHER_FICHIERS = 60

# Un motif plus court que ça ne dit rien : même longueur que celle exigée des
# déclarations d'étapes informatives et des surfaces aveugles du corpus.
LONGUEUR_MOTIF = 40

CHAMPS_RACINE = {"doc", "reference", "hors_perimetre"}
CHAMPS_REFERENCE = {"etablie_le", "motif", "fichiers"}
CHAMPS_SURFACE = {"chemin", "motif", "remede", "date"}

FORMAT_EMPREINTE = re.compile(r"^[0-9a-f]{64}$")
FORMAT_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Nombre de refus ANNOTÉS sur le run. Tous les refus sont écrits sur la sortie
# standard (la liste complète est la preuve) ; l'annotation, elle, est plafonnée :
# un registre vidé produirait sinon des centaines d'annotations, et un journal de
# CI tronqué cacherait justement la ligne qui compte.
ANNOTATIONS_MAX = 10

REMISE = "python .github/scripts/check-etat-reference.py"

# La sortie porte des accents et des flèches : sous Windows la console est en
# cp1252 et un `print` lèverait UnicodeEncodeError — l'étape échouerait pour une
# raison d'affichage. La règle est celle du harnais, à l'identique.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="backslashreplace")


class PerimetreIntrouvable(Exception):
    """Le périmètre ne peut pas être dérivé : juger serait juger à vide."""


def est_fichier(racine, chemin):
    """Le chemin désigne-t-il un fichier du dépôt ?

    Tolérant par construction : une surface déclarée en PROSE (« les fichiers
    ajoutés au dépôt ») traverse ce test sans erreur, et un nom qui n'est pas un
    nom de fichier valide sur ce système (caractères réservés) doit rendre False
    plutôt que lever — un garde qui plante sur sa propre déclaration ne refuse
    rien, il disparaît.
    """
    try:
        return (racine / chemin).is_file()
    except OSError:
        return False


def lire_octets(chemin):
    """Les octets du fichier, en mode BRUT (aucune conversion de fin de ligne)."""
    with io.open(chemin, "rb") as flux:
        return flux.read()


def empreinte(octets):
    """SHA-256 du contenu NORMALISÉ (CRLF → LF) — voir l'en-tête.

    La normalisation n'est pas un confort : sans elle, le même fichier commité
    rendrait une empreinte sur un poste Windows (`core.autocrlf=true`) et une
    autre sur un runner Ubuntu, donc un refus qui accuserait la fin de ligne.
    """
    return hashlib.sha256(octets.replace(b"\r\n", b"\n")).hexdigest()


def empreinte_de(chemin):
    return empreinte(lire_octets(chemin))


def charger_json(chemin):
    """(données, None) ou (None, message de refus). Jamais d'exception."""
    try:
        texte = Path(chemin).read_text(encoding="utf-8")
    except OSError as exc:
        return None, "registre illisible : %s (%s)" % (chemin, exc)
    try:
        return json.loads(texte), None
    except ValueError as exc:
        return None, "registre illisible : %s (%s)" % (chemin, exc)


def cibles_mutees(preuves):
    """TOUTES les cibles de mutation déclarées : le périmètre BRUT.

    Il se DÉRIVE du registre des preuves — jamais recopié —, et il sert à deux
    choses distinctes qu'il ne faut pas confondre : ce que le garde JUGE (le
    périmètre moins les exclusions) et ce qu'une exclusion a le droit d'écarter.
    Confondre les deux rendait périmée toute exclusion de fichier : le fichier
    exclu n'étant plus dans le périmètre jugé, l'exclusion semblait ne plus rien
    déclarer. Mesuré à la pose de ce garde.
    """
    mutations = preuves.get("mutations") if isinstance(preuves, dict) else None
    if not isinstance(mutations, list) or not mutations:
        raise PerimetreIntrouvable(
            "registre des preuves sans « mutations » : le périmètre serait vide, donc "
            "le garde ne jugerait rien"
        )
    cibles = set()
    for mutation in mutations:
        cible = mutation.get("garde") or mutation.get("cible")
        if not cible:
            raise PerimetreIntrouvable("une mutation du registre des preuves ne nomme pas sa cible")
        cibles.add(cible)
    return sorted(cibles)


def perimetre(preuves, surfaces, racine=REPO_ROOT):
    """Les fichiers que le garde JUGE : les cibles de mutation, moins la
    machinerie déclarée hors périmètre.

    Une exclusion ne compte que si elle désigne un FICHIER existant : une surface
    déclarée en prose (« les fichiers ajoutés au dépôt ») n'exclut rien, elle dit
    ce qui n'est pas jugé. La distinction se lit ici, une fois.
    """
    exclusions = {
        surface["chemin"] for surface in surfaces
        if est_fichier(racine, surface["chemin"])
    }
    return sorted(set(cibles_mutees(preuves)) - exclusions)


def diagnostiquer(chemin, preuves, racine=REPO_ROOT):
    """La mutation DÉCLARÉE encore en place dans ce fichier, s'il y en a une.

    Le registre des preuves nomme, pour chaque mutation, le littéral neutralisé et
    son remplacement : un fichier qui a perdu le premier en portant le second est
    donc un fichier MUTÉ, et le refus peut le dire au lieu de parler d'une dérive
    anonyme. Sans ce lien, la cause la plus probable d'un écart serait la seule
    qu'on ne nommerait pas.
    """
    fichier = racine / chemin
    if not fichier.is_file():
        return []
    try:
        texte = fichier.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    trouvees = []
    for mutation in preuves.get("mutations") or []:
        if (mutation.get("garde") or mutation.get("cible")) != chemin:
            continue
        trouve, remplace = mutation.get("trouve"), mutation.get("remplace")
        if not trouve or not remplace:
            continue
        if texte.count(trouve) == 0 and texte.count(remplace) >= 1:
            trouvees.append(mutation.get("id") or "(mutation sans id)")
    return trouvees


def decrire_derive(chemin, actuel, attendu, preuves, racine=REPO_ROOT):
    """Le refus d'une dérive : la cause nommée, les deux empreintes, le remède."""
    mutation_en_place = diagnostiquer(chemin, preuves, racine)
    if mutation_en_place:
        return (
            "MUTATION ENCORE EN PLACE dans %s : %s — le littéral neutralisé manque et son "
            "remplacement est là. Restaurer le fichier (git checkout -- %s) ; si le "
            "changement est voulu, il n'est pas une mutation et se déclare : "
            "%s --enregistrer --chemin %s --motif \"…\""
            % (chemin, ", ".join(mutation_en_place), chemin, REMISE, chemin)
        )
    return (
        "DÉRIVE NON DÉCLARÉE : %s à l'empreinte %s, référence %s — si ce nouvel état est "
        "voulu, il se DÉCLARE (avec son motif) : %s --enregistrer --chemin %s --motif \"…\" ; "
        "sinon restaurer le fichier."
        % (chemin, actuel, attendu, REMISE, chemin)
    )


def valider_registre(registre):
    """Les refus de FORME du registre : champs inconnus, motif muet, date
    illisible, surface hors périmètre sans remède. Un registre qu'on ne peut pas
    lire ne prouve rien : chaque écart est refusé ici plutôt que de faire croire
    à un vert.

    Les entrées PÉRIMÉES, elles, ne se jugent pas ici : elles portent sur ce
    qu'un fichier du dépôt DEVRAIT être (registre des preuves, existence), donc
    sur le périmètre — c'est `juger` et `surfaces_perimees` qui les refusent.
    """
    refus = []
    if not isinstance(registre, dict):
        return ["registre sans objet JSON : l'état de référence n'est pas un objet"]

    inconnus = sorted(set(registre) - CHAMPS_RACINE)
    if inconnus:
        refus.append("champ(s) inconnu(s) à la racine du registre : %s" % inconnus)
    doc = registre.get("doc")
    if doc is not None and (not isinstance(doc, list) or not doc):
        refus.append("« doc » doit être une liste non vide : la règle doit s'écrire quelque part")

    reference = registre.get("reference")
    if not isinstance(reference, dict):
        return refus + ["« reference » manquante : le garde n'a pas d'état de référence à juger"]
    inconnus = sorted(set(reference) - CHAMPS_REFERENCE)
    if inconnus:
        refus.append("champ(s) inconnu(s) dans « reference » : %s" % inconnus)
    motif = reference.get("motif") or ""
    if len(str(motif).strip()) < LONGUEUR_MOTIF:
        refus.append(
            "référence MUETTE : « motif » fait %d caractère(s), %d exigé(s) — un état de "
            "référence adopté sans dire pourquoi n'est pas une déclaration"
            % (len(str(motif).strip()), LONGUEUR_MOTIF)
        )
    etablie = str(reference.get("etablie_le") or "")
    if not FORMAT_DATE.match(etablie):
        refus.append(
            "date illisible pour la référence : %r (AAAA-MM-JJ attendu) — une référence "
            "qu'on ne peut pas dater ne dit pas depuis quand elle tient" % (etablie,)
        )
    fichiers = reference.get("fichiers")
    if not isinstance(fichiers, dict):
        return refus + ["« reference.fichiers » doit être un objet {chemin: empreinte}"]

    surfaces = registre.get("hors_perimetre")
    if not isinstance(surfaces, list):
        return refus + [
            "« hors_perimetre » doit être une liste (elle peut être vide, mais elle doit "
            "EXISTER) : ce qui n'est pas jugé se déclare"
        ]
    for surface in surfaces:
        if not isinstance(surface, dict):
            refus.append("surface hors périmètre sans objet : %r" % (surface,))
            continue
        inconnus = sorted(set(surface) - CHAMPS_SURFACE)
        if inconnus:
            refus.append(
                "surface hors périmètre « %s » : champ(s) inconnu(s) %s"
                % (surface.get("chemin"), inconnus)
            )
        for champ in ("chemin", "motif", "remede", "date"):
            if not str(surface.get(champ) or "").strip():
                refus.append(
                    "surface hors périmètre « %s » : « %s » vide"
                    % (surface.get("chemin") or "?", champ)
                )
        if len(str(surface.get("motif") or "").strip()) < LONGUEUR_MOTIF:
            refus.append(
                "surface hors périmètre « %s » : motif de %d caractère(s), %d exigé(s) — "
                "déclarer une surface aveugle sans dire pourquoi, c'est la cacher"
                % (
                    surface.get("chemin"),
                    len(str(surface.get("motif") or "").strip()),
                    LONGUEUR_MOTIF,
                )
            )
        if not FORMAT_DATE.match(str(surface.get("date") or "")):
            refus.append(
                "surface hors périmètre « %s » : date illisible %r (AAAA-MM-JJ attendu)"
                % (surface.get("chemin"), surface.get("date"))
            )
    return refus


def surfaces_perimees(registre, cibles_declarees, racine=REPO_ROOT):
    """Une surface hors périmètre qui désigne un FICHIER existant sans qu'aucune
    mutation ne le vise ne déclare plus rien : elle se retire (ou la mutation
    qu'elle écartait est revenue). Une surface en prose (« les fichiers ajoutés »)
    n'est jamais périmée par ce chemin.

    La comparaison porte sur les cibles DÉCLARÉES, jamais sur le périmètre jugé :
    une exclusion retire sa cible de ce que le garde juge, et l'y comparer ferait
    passer toute exclusion de fichier pour périmée — c'est-à-dire pour un refus.
    """
    perimees = []
    for surface in registre.get("hors_perimetre") or []:
        chemin = surface.get("chemin") or ""
        if est_fichier(racine, chemin) and chemin not in cibles_declarees:
            perimees.append(
                "surface hors périmètre PÉRIMÉE : %s existe et n'est la cible d'aucune "
                "mutation — cette exclusion ne déclare plus rien" % chemin
            )
    return perimees


def juger(registre, preuves, racine=REPO_ROOT, plancher=PLANCHER_FICHIERS):
    """Le verdict : (refus, fichiers jugés, cibles du périmètre)."""
    refus = valider_registre(registre)
    if refus:
        return refus, 0, []
    reference = registre["reference"]["fichiers"]
    cibles = perimetre(preuves, registre["hors_perimetre"], racine)
    refus = surfaces_perimees(registre, cibles_mutees(preuves), racine)

    for cible in cibles:
        if cible not in reference:
            refus.append(
                "surface NON déclarée : %s est la cible d'une mutation déclarée et n'a pas "
                "d'état de référence — une surface aveugle se déclare : "
                "%s --enregistrer --chemin %s --motif \"…\"" % (cible, REMISE, cible)
            )

    declarees = cibles_mutees(preuves)
    lues = 0
    for chemin in sorted(reference):
        if chemin not in declarees:
            # Une entrée que plus aucune mutation ne vise ne protège plus rien :
            # soit sa mutation a disparu du registre des preuves, soit l'entrée a
            # été ajoutée à la main. Dans les deux cas, on ne la juge pas — on la
            # fait retirer, sinon la référence se remplirait d'entrées mortes.
            refus.append(
                "entrée PÉRIMÉE : %s est à l'état de référence et n'est la cible d'aucune "
                "mutation déclarée — réenregistrer pour la retirer : %s --enregistrer "
                "--motif \"…\"" % (chemin, REMISE)
            )
            continue
        fichier = racine / chemin
        if not fichier.is_file():
            refus.append(
                "fichier de référence DISPARU : %s est déclaré et n'existe plus — le "
                "restaurer, ou réenregistrer si sa disparition est voulue : %s "
                "--enregistrer --motif \"…\"" % (chemin, REMISE)
            )
            continue
        attendu = str(reference[chemin])
        if not FORMAT_EMPREINTE.match(attendu):
            refus.append(
                "empreinte illisible pour %s : %r (64 caractères hexadécimaux attendus) — "
                "une empreinte qui n'en est pas une ne peut rien refuser" % (chemin, attendu)
            )
            continue
        lues += 1
        actuel = empreinte_de(fichier)
        if actuel != attendu:
            refus.append(decrire_derive(chemin, actuel, attendu, preuves, racine))

    if lues < plancher:
        refus.append(
            "PLANCHER DE LECTURE : %d fichier(s) jugé(s) sur %d requis — sous ce plancher le "
            "garde ne conclut pas, sinon un périmètre cassé sortirait vert en ne jugeant rien"
            % (lues, plancher)
        )
    return refus, lues, cibles


def enregistrer(registre, preuves, motif, chemins=(), racine=REPO_ROOT, aujourd_hui=None):
    """(refus, registre mis à jour) — adopte l'état courant comme RÉFÉRENCE.

    Deux garde-fous, et ce sont eux qui font de ce geste une DÉCLARATION plutôt
    qu'un effacement de preuve :

      * un motif de 40 caractères au moins — on ne déplace pas une référence sans
        dire pourquoi ;
      * REFUS D'ADOPTER UNE MUTATION EN PLACE : si un fichier du périmètre porte
        encore une mutation déclarée, rien n'est écrit. C'est la porte par laquelle
        un `--enregistrer` réflexe blanchirait exactement ce que ce garde existe
        pour attraper.

    Sans `chemins`, la référence est refaite sur TOUT le périmètre (c'est ainsi
    qu'une entrée périmée se retire et qu'une cible nouvelle entre). Avec
    `chemins`, seuls ces fichiers sont adoptés ; les autres gardent leur
    empreinte, donc une dérive oubliée reste refusée au tour suivant.
    """
    motif = str(motif or "").strip()
    if len(motif) < LONGUEUR_MOTIF:
        return [
            "motif trop court (%d caractère(s), %d exigé(s)) : une référence adoptée sans "
            "motif lisible n'est pas une déclaration" % (len(motif), LONGUEUR_MOTIF)
        ], registre

    cibles = perimetre(preuves, registre["hors_perimetre"], racine)

    en_place = []
    for cible in cibles:
        en_place += diagnostiquer(cible, preuves, racine)
    if en_place:
        return [
            "REFUS D'ADRESSER UNE MUTATION EN PLACE : %s — une mutation déclarée qui n'a pas "
            "été restaurée n'est jamais la nouvelle référence. Restaurer d'abord "
            "(git checkout -- <fichier>), puis redécider." % ", ".join(sorted(en_place))
        ], registre

    adoptes = sorted(set(chemins)) if chemins else cibles
    if chemins:
        hors = sorted(set(chemins) - set(cibles))
        if hors:
            return [
                "chemin(s) hors périmètre : %s — le périmètre se dérive du registre des "
                "preuves, il ne s'élargit pas par un argument" % ", ".join(hors)
            ], registre
        absents = sorted(chemin for chemin in adoptes if not est_fichier(racine, chemin))
        if absents:
            return [
                "chemin(s) introuvable(s) : %s — on n'adopte pas l'état de ce qui n'existe pas"
                % ", ".join(absents)
            ], registre

    ancienne = registre["reference"]
    reference = dict(ancienne)
    reference["etablie_le"] = (aujourd_hui or date.today().isoformat())
    reference["motif"] = motif
    reference["fichiers"] = {
        chemin: empreinte_de(racine / chemin) for chemin in adoptes
    }
    if chemins:
        reference["fichiers"] = {
            **{c: e for c, e in ancienne["fichiers"].items() if c not in adoptes},
            **reference["fichiers"],
        }
    nouveau = dict(registre)
    nouveau["reference"] = reference
    return [], nouveau


def ecrire_registre(chemin, registre):
    """Écrit le registre tel quel, en UTF-8, avec un saut de ligne final.

    Indentation à 2 espaces, comme les registres voisins (guard-proofs.json,
    informative-steps.json, gate-perimetre.json) : un fichier de déclarations
    qu'on relit à la main ne doit pas changer de forme selon l'outil qui l'écrit.
    """
    Path(chemin).write_text(
        json.dumps(registre, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--enregistrer", action="store_true",
        help="adopter l'état courant comme nouvelle référence (exige --motif)",
    )
    parser.add_argument("--motif", default="", help="pourquoi ce nouvel état est la référence")
    parser.add_argument(
        "--chemin", action="append", default=[],
        help="n'adopter que ce fichier (répétable) ; sans lui, tout le périmètre",
    )
    parser.add_argument("--racine", default=None, help="racine du dépôt (tests, fixtures)")
    parser.add_argument("--registre", default=None, help="registre à lire (tests, fixtures)")
    parser.add_argument("--preuves", default=None, help="registre des preuves (tests, fixtures)")
    args = parser.parse_args(argv)

    racine = Path(args.racine).resolve() if args.racine else REPO_ROOT
    chemin_registre = Path(args.registre) if args.registre else REGISTRE_DEFAUT
    chemin_preuves = Path(args.preuves) if args.preuves else PREUVES_DEFAUT

    if (args.motif or args.chemin) and not args.enregistrer:
        print("[ECHEC] --motif ou --chemin sans --enregistrer : rien à enregistrer")
        return 2

    registre, erreur = charger_json(chemin_registre)
    if erreur:
        print("[ECHEC] %s" % erreur)
        print("::error title=État de référence illisible::%s" % erreur)
        return 1
    preuves, erreur = charger_json(chemin_preuves)
    if erreur:
        print("[ECHEC] %s" % erreur)
        print("::error title=Registre des preuves illisible::%s" % erreur)
        return 1

    if args.enregistrer:
        refus, nouveau = enregistrer(
            registre, preuves, args.motif, args.chemin, racine=racine
        )
        if refus:
            for ligne in refus:
                print("[ECHEC] %s" % ligne)
                print("::error title=État de référence non enregistré::%s" % ligne)
            return 1
        ecrire_registre(chemin_registre, nouveau)
        reference = nouveau["reference"]
        print(
            "[OK]  référence adoptée le %s : %d fichier(s) — motif « %s »"
            % (reference["etablie_le"], len(reference["fichiers"]), reference["motif"])
        )
        return 0

    try:
        refus, lues, cibles = juger(registre, preuves, racine)
    except PerimetreIntrouvable as exc:
        print("[ECHEC] %s" % exc)
        print("::error title=Périmètre introuvable::%s" % exc)
        return 1

    for index, ligne in enumerate(refus):
        print("[ECHEC] %s" % ligne)
        if index < ANNOTATIONS_MAX:
            print("::error title=État de référence dérivé::%s" % ligne)
    if len(refus) > ANNOTATIONS_MAX:
        print(
            "::error title=État de référence dérivé::%d autre(s) refus, non annoté(s) — la "
            "liste complète est ci-dessus" % (len(refus) - ANNOTATIONS_MAX)
        )
    if refus:
        print(
            "\n[ERR] %d refus sur %d fichier(s) jugé(s) — un fichier du dépôt s'écarte de son "
            "état de référence sans l'avoir déclaré." % (len(refus), lues)
        )
        return 1

    print(
        "[OK]  %d fichier(s) à leur état de référence (périmètre dérivé des mutations "
        "déclarées), référence du %s : « %s »"
        % (lues, registre["reference"]["etablie_le"], registre["reference"]["motif"])
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
