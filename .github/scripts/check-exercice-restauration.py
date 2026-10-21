#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Le runbook est-il encore une PREUVE, ou le souvenir d'une preuve ?

── Le trou que ce garde ferme ──────────────────────────────────────────────
`backend/SAUVEGARDES_ATLAS.md` porte un exercice de restauration DATÉ
(§3, « Exercice exécuté — 18/10/2026 »). Ce document est ce qui autorise à dire
« on est prêt à restaurer ». Or une preuve ne vieillit pas comme une photo : au
bout d'un trimestre sans exercice, elle ne décrit plus une CAPACITÉ mais une
INTENTION — le dépôt a changé, les commandes ont bougé, la personne qui les a
lancées n'est plus forcément là. Rien dans le dépôt ne le disait : le runbook
restait « daté », donc vert à la lecture, indéfiniment. C'est exactement la
famille de F9 et F17 (un fait qu'on croit mesuré parce qu'il est écrit), et la
règle du dépôt est qu'une surface qui ne mesure plus se DÉCLARE au lieu de
passer pour un vert.

── La règle ───────────────────────────────────────────────────────────────
Le garde lit le runbook et en extrait le SEUL repère qui vaut preuve : un titre
de section (`##` ou `###`) qui nomme un exercice ET porte une date
`JJ/MM/AAAA`. Il retient le plus RÉCENT et juge son ÂGE contre la cadence que
le runbook annonce lui-même (§5.4 : un exercice par trimestre), plus une marge.

Ce qui est REFUSÉ, nommément :
  * un exercice plus vieux que la cadence (le seuil et l'âge sont écrits) ;
  * aucun exercice exécuté du tout — un runbook qui n'a que la procédure ne
    prouve rien, même s'il est long et bien écrit ;
  * un titre « non exécuté » (le §3bis, « préparé mais NON exécuté ») : un
    exercice préparé n'est pas un exercice fait, et le compter serait le
    mensonge le plus facile à commettre ici ;
  * une date ILLISIBLE ou impossible dans le titre : on ne devine pas une date ;
  * une date dans le FUTUR : elle rendrait l'âge négatif, donc le garde
    complaisant, sur une horloge fausse ou un chiffre tapé à l'envers ;
  * un runbook TRONQUÉ (sous son plancher de lecture) : un lecteur cassé ne
    doit pas rendre un vert, c'est la règle du dépôt pour tout garde.

Sorties : 0 = exercice mesuré et récent (l'âge est publié, un vert muet serait
un vert sans mesure) ; 1 = refus, avec la cause, le seuil et le remède.

Usage :
    python3 .github/scripts/check-exercice-restauration.py
    python3 .github/scripts/check-exercice-restauration.py --runbook chemin.md
"""
import argparse
import datetime as dt
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
RUNBOOK = RACINE / "backend" / "SAUVEGARDES_ATLAS.md"

# La cadence annoncée par le runbook (§5.4), en jours : un trimestre. Elle est
# VÉRIFIÉE contre le texte du runbook (`test_le_runbook_declare_la_cadence_...`)
# pour que changer la prose sans changer le seuil — ou l'inverse — rougisse.
CADENCE_JOURS = 90

# Marge de dix jours : un exercice lancé au 91e jour n'est pas un mensonge, un
# trimestre SAUTÉ en est un. Sans marge, le garde rougirait le jour même où
# l'exercice est dû, et un garde qui crie au mauvais moment apprend à être
# ignoré — c'est la leçon de `SILENCE_TIMEOUT_MS` côté flux.
GRACE_JOURS = 10
SEUIL_JOURS = CADENCE_JOURS + GRACE_JOURS

# Plancher de lecture : le runbook réel fait plusieurs milliers de caractères.
# En dessous, c'est un fichier tronqué (ou le mauvais fichier), pas un runbook.
PLANCHER_CARACTERES = 1500

DATE = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
EXERCICE = re.compile(r"\bexercices?\b", re.IGNORECASE)
# Un titre est CANDIDAT s'il porte une date ou s'il se DÉCLARE compte rendu
# (« exécuté », « préparé »). Sans ce filtre, les sous-titres de prose
# (« Ce que l'exercice prouve ») seraient écartés à chaque exécution : un bruit
# qui, à force, ferait lire un refus comme une formalité.
CANDIDAT = re.compile(r"ex[ée]cut|pr[ée]par", re.IGNORECASE)
# « non exécuté » / « non executee » : le titre du §3bis. Un exercice PRÉPARÉ
# n'a aucune valeur de preuve, et c'est la confusion la plus probable ici.
NON_EXECUTE = re.compile(r"non\s+ex[ée]cut[ée]", re.IGNORECASE)
TITRE = re.compile(r"^#{2,3}\s+\S")


def _date(titre):
    """`(date, None)` ou `(None, raison)` — une date se LIT, elle ne se devine pas."""
    trouvee = DATE.search(titre)
    if not trouvee:
        return None, "titre sans date JJ/MM/AAAA — une preuve datée doit porter sa date"
    jour, mois, annee = (int(g) for g in trouvee.groups())
    try:
        return dt.date(annee, mois, jour), None
    except ValueError:
        return None, "date impossible (%s) dans le titre" % trouvee.group(0)


def repartir(texte):
    """`(exercices, ecartes)` — ce qui vaut preuve, et ce qui a été écarté pourquoi.

    Ne lit QUE des titres de section : c'est le seul repère stable du runbook.
    Une date apparue dans un paragraphe (« relevé le 19/10/2026 ») n'est pas un
    exercice, et la prendre pour tel ferait rajeunir la preuve par accident.
    """
    exercices, ecartes = [], []
    for ligne in texte.splitlines():
        if not TITRE.match(ligne) or not EXERCICE.search(ligne):
            continue
        titre = ligne.strip()
        if not DATE.search(titre) and not CANDIDAT.search(titre):
            continue
        if NON_EXECUTE.search(titre):
            ecartes.append(
                (titre, "titre « non exécuté » : un exercice PRÉPARÉ n'est pas une preuve")
            )
            continue
        quand, raison = _date(titre)
        if raison:
            ecartes.append((titre, raison))
            continue
        exercices.append((quand, titre))
    return exercices, ecartes


def juger(texte, aujourdhui, seuil_jours=SEUIL_JOURS):
    """`(code, lignes)` — l'âge de la preuve, jugé contre le seuil. PURE.

    L'horloge est un paramètre : « vieux de quatre mois » se juge sans attendre
    quatre mois, et le test n'a pas à voyager dans le temps.
    """
    lignes = []
    if len(texte) < PLANCHER_CARACTERES:
        lignes.append(
            "[ERREUR] Runbook TRONQUÉ (%d caractères lus, plancher %d) : le garde "
            "refuse de conclure sur un fichier qui n'est pas le runbook."
            % (len(texte), PLANCHER_CARACTERES)
        )
        return 1, lignes

    exercices, ecartes = repartir(texte)
    for titre, raison in ecartes:
        lignes.append("[ECARTÉ] %s\n          → %s" % (titre, raison))

    if not exercices:
        lignes.append(
            "[ERREUR] Aucun exercice de restauration EXÉCUTÉ et DATÉ dans le runbook : "
            "« prêt à restaurer » n'est alors qu'une intention. Consigner un exercice "
            "au §3 de backend/SAUVEGARDES_ATLAS.md sous la forme "
            "« ## N. Exercice exécuté — JJ/MM/AAAA », puis relancer ce garde."
        )
        return 1, lignes

    quand, titre = max(exercices, key=lambda item: item[0])
    age = (aujourdhui - quand).days

    if age < -1:
        lignes.append(
            "[ERREUR] L'exercice daté du %s est dans le FUTUR (%d jour(s) d'avance) : "
            "une horloge fausse rendrait son âge négatif, donc le garde complaisant. "
            "Corriger la date du titre, puis relancer."
            % (quand.strftime("%d/%m/%Y"), -age)
        )
        return 1, lignes

    if age > seuil_jours:
        lignes.append(
            "[ERREUR] Dernier exercice de restauration il y a %d jour(s) (%s), seuil "
            "%d jour(s) = cadence de %d jour(s) + %d de marge : la preuve a PÉRIMÉ. "
            "Rejouer l'exercice (backend/scripts/exercice_restauration.py, ou un "
            "exercice PITR depuis Atlas), consigner la nouvelle date au §3 de "
            "backend/SAUVEGARDES_ATLAS.md, puis relancer ce garde."
            % (
                age,
                quand.strftime("%d/%m/%Y"),
                seuil_jours,
                CADENCE_JOURS,
                GRACE_JOURS,
            )
        )
        return 1, lignes

    lignes.append(
        "[OK] Exercice de restauration daté du %s — %d jour(s), seuil %d "
        "(cadence %d + marge %d) : la preuve décrit encore une capacité."
        % (quand.strftime("%d/%m/%Y"), age, seuil_jours, CADENCE_JOURS, GRACE_JOURS)
    )
    lignes.append("     repère lu : %s" % titre)
    return 0, lignes


def _sortie_utf8():
    """Console Windows en cp1252 : le runbook est du TEXTE, et une flèche ou un
    accent qu'elle ne sait pas écrire faisait tomber le garde en
    UnicodeEncodeError au lieu de rendre son verdict (mesuré le 21/10/2026).
    Un garde qui plante sur la prose qu'il juge ne juge rien.
    """
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # flux redirigé sans reconfigure
            pass


def main(argv=None):
    _sortie_utf8()
    analyseur = argparse.ArgumentParser(
        description="Juge la FRAÎCHEUR de l'exercice de restauration daté du runbook."
    )
    analyseur.add_argument(
        "--runbook",
        default=str(RUNBOOK),
        help="runbook à juger (défaut : backend/SAUVEGARDES_ATLAS.md)",
    )
    args = analyseur.parse_args(argv)

    chemin = Path(args.runbook)
    if not chemin.is_file():
        print(
            "[ERREUR] Runbook introuvable (%s) : aucun exercice daté n'a été lu, "
            "donc aucun verdict n'est rendu." % chemin
        )
        return 1

    with open(chemin, "r", encoding="utf-8", newline="") as fichier:
        texte = fichier.read()

    code, lignes = juger(texte, dt.date.today())
    for ligne in lignes:
        print(ligne)
    return code


if __name__ == "__main__":
    sys.exit(main())
