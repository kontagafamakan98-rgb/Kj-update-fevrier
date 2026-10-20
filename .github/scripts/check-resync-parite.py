#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LE PLANCHER DE RESYNC TIENT-IL LA PARITÉ AVEC LE SONDAGE QU'IL REMPLACE ?

── Le fait, et pourquoi ce garde existe ────────────────────────────────────
Le bus temps réel ne rejoue rien (le pub/sub n'a pas d'historique) : chaque
interruption de l'abonnement ouvre une FENÊTRE AVEUGLE, et la réparation est une
relecture TOTALE des flux locaux (`resync`). Cette relecture est bornée par un
plancher, `RESYNC_MIN_INTERVAL_SECONDS` (`backend/kojo_live.py`), pour qu'un
Redis qui bat de l'aile ne transforme pas la réparation en tornade de requêtes.
La règle que le module ÉNONCE est explicite : relire à chaque reprise serait
« plus bavard que le sondage remplacé (2 req/min) ». Autrement dit, le plancher
doit valoir AU MOINS le délai de ce sondage — 30 s pour 2 requêtes par minute.

Or rien ne le vérifiait. Le plancher valait 10 s, c'est-à-dire TROIS FOIS plus
bavard que le sondage que le flux remplace : une rafale de reconnexions pouvait
légitimement produire six relectures par minute et par flux, chacune étant une
requête HTTP complète côté client. Le commentaire du module disait la bonne
règle, le code en appliquait une autre, et aucun test ne confrontait les deux —
exactement la famille F9/F17 (un fait qu'on croit mesuré parce qu'il est écrit).

── La règle ───────────────────────────────────────────────────────────────
Le seuil du sondage remplacé est LU là où il est déclaré une seule fois
(`ANCIEN_SONDAGE_MS` dans `.github/scripts/check-fly-env-drift.py`, que la sonde
en ligne et le test du repli client lisent déjà). Il n'est PAS recopié ici : un
second littéral serait un second seuil, et le jour où l'un bouge, deux contrats
divergeraient en silence — ce qui est précisément l'incident du 18/10/2026 côté
battement (deux sources, deux valeurs, 15 s contre 20 s).

Ce qui est REFUSÉ, nommément :
  * `RESYNC_MIN_INTERVAL_SECONDS * 1000 < ANCIEN_SONDAGE_MS` — le plancher est
    plus bavard que le sondage remplacé (c'est le cas mesuré à la pose : 10 s
    contre 30 s) ;
  * une constante DÉCLARÉE DEUX FOIS : la dernière gagne, donc le propriétaire
    a bougé en silence ;
  * une constante que RIEN NE CONSOMME (aucun `… < RESYNC_MIN_INTERVAL_SECONDS`
    dans le module) : un plancher que la borne n'utilise pas ne borne rien ;
  * un seuil INTROUVABLE ou DÉCLARÉ DEUX FOIS dans la sonde : le lecteur est
    cassé, donc aucun verdict n'est rendu ;
  * un module ou une sonde TRONQUÉS (sous les planchers de lecture) : la règle
    du dépôt est qu'un lecteur cassé ne rend pas un vert.

Sorties : 0 = parité mesurée (les deux valeurs sont publiées, un vert muet
serait un vert sans mesure) ; 1 = refus, avec la cause, les deux valeurs et le
remède.

Ce que ce garde ne voit pas, et qui se dit : il lit les SOURCES. Une surcharge
d'exécution de `RESYNC_MIN_INTERVAL_SECONDS` n'existe pas aujourd'hui (la
constante n'est pas lue depuis l'environnement), donc la source EST le contrat —
mais si elle devenait réglable sur Fly, c'est la sonde d'environnement qui
devrait juger la valeur déployée, pas ce garde.

Usage :
    python3 .github/scripts/check-resync-parite.py
    python3 .github/scripts/check-resync-parite.py --live chemin.py --sonde chemin.py
"""
import argparse
import re
import sys
from pathlib import Path

# Sortie terminal tolérante (cp1252 sous Windows, utf-8 sous le runner) : le
# garde publie des guillemets français et des flèches, jamais des mojibakes.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):  # repli Python sans reconfigure
    pass

RACINE = Path(__file__).resolve().parents[2]
LIVE_FILE = RACINE / "backend" / "kojo_live.py"
SONDE_FILE = RACINE / ".github" / "scripts" / "check-fly-env-drift.py"

RESYNC_CONSTANTE = "RESYNC_MIN_INTERVAL_SECONDS"
SEUIL_CONSTANTE = "ANCIEN_SONDAGE_MS"

# Planchers de LECTURE : les deux fichiers réels font plusieurs milliers de
# caractères. En dessous, c'est un fichier tronqué (ou le mauvais fichier), pas
# le sujet du garde — et un motif qui ne trouve plus rien passerait pour une
# parité respectée.
PLANCHER_LIVE = 4000
PLANCHER_SONDE = 20000


def lire_texte(chemin, plancher, etiquette):
    """`(texte, None)` ou `(None, raison)` — un fichier illisible se déclare."""
    try:
        with open(chemin, "r", encoding="utf-8", newline="") as fichier:
            texte = fichier.read()
    except OSError as exc:
        return None, "%s illisible (%s) : aucun verdict n'est rendu" % (etiquette, exc)
    if len(texte) < plancher:
        return None, (
            "%s TRONQUÉ (%d caractères lus, plancher %d) : le garde refuse de "
            "conclure sur un fichier qui n'est pas son sujet"
            % (etiquette, len(texte), plancher)
        )
    return texte, None


def declaration(texte, constante):
    """`[(valeur, ligne), …]` — les DÉCLARATIONS de `constante` en tête de ligne.

    On lit la déclaration (`RESYNC_MIN_INTERVAL_SECONDS = 30.0`), jamais une
    mention en commentaire : un module qui PARLE du plancher n'en déclare pas la
    valeur. La liste (et non la première valeur) permet de refuser un doublon
    au lieu de laisser la dernière gagner en silence.
    """
    motif = re.compile(r"^%s\s*=\s*([\d_.]+)" % re.escape(constante), re.MULTILINE)
    trouvees = []
    for trouvaille in motif.finditer(texte):
        brut = trouvaille.group(1).replace("_", "")
        try:
            valeur = float(brut)
        except ValueError:
            continue
        ligne = texte.count("\n", 0, trouvaille.start()) + 1
        trouvees.append((valeur, ligne))
    return trouvees


def est_consommee(texte):
    """La borne LIT-elle le plancher (`… < RESYNC_MIN_INTERVAL_SECONDS`) ?

    Sans ce contrôle, une constante déclarée mais remplacée par un littéral dans
    la comparaison resterait « respectée » tout en ne bornant plus rien.
    """
    return re.search(
        r"<\s*%s\b" % re.escape(RESYNC_CONSTANTE), texte
    ) is not None


def juger(texte_live, texte_sonde, plancher_live=PLANCHER_LIVE, plancher_sonde=PLANCHER_SONDE):
    """`(code, lignes)` — la parité du plancher, jugée contre le seuil LU. PURE.

    Aucune valeur de temps n'est écrite ici : le seuil vient du texte de la
    sonde, le plancher du module. Un test peut donc déplacer l'un ou l'autre et
    vérifier que le verdict SUIT — la preuve que rien n'est recopié.
    """
    lignes = []

    if len(texte_live) < plancher_live:
        lignes.append(
            "[ERREUR] backend/kojo_live.py TRONQUÉ (%d caractères lus, plancher %d) : "
            "le plancher de resync n'a pas été lu, donc aucun verdict n'est rendu."
            % (len(texte_live), plancher_live)
        )
        return 1, lignes
    if len(texte_sonde) < plancher_sonde:
        lignes.append(
            "[ERREUR] %s TRONQUÉ (%d caractères lus, plancher %d) : le seuil du "
            "sondage remplacé n'a pas été lu, donc aucun verdict n'est rendu."
            % (SONDE_FILE.name, len(texte_sonde), plancher_sonde)
        )
        return 1, lignes

    seuils = declaration(texte_sonde, SEUIL_CONSTANTE)
    if not seuils:
        lignes.append(
            "[ERREUR] Le seuil du sondage remplacé (%s) n'a pas été trouvé dans %s : "
            "le motif a bougé, donc le garde ne lit plus son sujet — corriger le "
            "motif, pas le verdict." % (SEUIL_CONSTANTE, SONDE_FILE.name)
        )
        return 1, lignes
    if len(seuils) > 1:
        lignes.append(
            "[ERREUR] %s est DÉCLARÉ %d FOIS dans %s (lignes %s) : deux seuils pour "
            "un même sondage remplacé, et la dernière déclaration gagne en silence. "
            "N'en garder qu'UNE."
            % (
                SEUIL_CONSTANTE,
                len(seuils),
                SONDE_FILE.name,
                ", ".join(str(ligne) for _, ligne in seuils),
            )
        )
        return 1, lignes
    seuil_ms = seuils[0][0]

    planchers = declaration(texte_live, RESYNC_CONSTANTE)
    if not planchers:
        lignes.append(
            "[ERREUR] %s n'est pas déclaré dans backend/kojo_live.py : le plancher de "
            "resync n'existe pas, donc la réparation du bus n'est bornée par rien. "
            "Le déclarer en tête de ligne (ex. `%s = …`)."
            % (RESYNC_CONSTANTE, RESYNC_CONSTANTE)
        )
        return 1, lignes
    if len(planchers) > 1:
        lignes.append(
            "[ERREUR] %s est DÉCLARÉ %d FOIS dans backend/kojo_live.py (lignes %s) : "
            "la dernière déclaration gagne, donc la borne appliquée n'est pas celle "
            "qu'on lit en premier. N'en garder qu'UNE."
            % (
                RESYNC_CONSTANTE,
                len(planchers),
                ", ".join(str(ligne) for _, ligne in planchers),
            )
        )
        return 1, lignes
    resync_s = planchers[0][0]
    if resync_s <= 0:
        lignes.append(
            "[ERREUR] %s vaut %g s : un plancher nul ou négatif ne borne rien du "
            "tout, chaque reprise relirait tous les flux. Poser au moins le délai "
            "du sondage remplacé." % (RESYNC_CONSTANTE, resync_s)
        )
        return 1, lignes

    if not est_consommee(texte_live):
        lignes.append(
            "[ERREUR] %s est déclaré mais AUCUNE borne ne le consomme dans "
            "backend/kojo_live.py (aucun `… < %s`) : un plancher que la réparation "
            "n'utilise pas ne borne rien, et sa valeur ne prouve rien."
            % (RESYNC_CONSTANTE, RESYNC_CONSTANTE)
        )
        return 1, lignes

    resync_ms = resync_s * 1000.0
    if resync_ms < seuil_ms:
        lignes.append(
            "[ERREUR] Plancher de resync %g s (%g ms) SOUS la parité avec le sondage "
            "remplacé (%g ms = 2 req/min par session, seuil LU dans %s) : une rafale "
            "de reconnexions relirait les flux PLUS SOUVENT que le sondage que le "
            "flux remplace, donc la réparation coûterait plus d'allers-retours que "
            "l'ancien mécanisme. Relever %s dans backend/kojo_live.py (au moins %g s)."
            % (
                resync_s,
                resync_ms,
                seuil_ms,
                SONDE_FILE.name,
                RESYNC_CONSTANTE,
                seuil_ms / 1000.0,
            )
        )
        return 1, lignes

    lignes.append(
        "[OK] Plancher de resync %g s (%g ms) — au moins la parité avec le sondage "
        "remplacé (%g ms, seuil LU dans %s, jamais recopié) ; déclaré une seule fois "
        "et consommé par la borne."
        % (resync_s, resync_ms, seuil_ms, SONDE_FILE.name)
    )
    if resync_ms > seuil_ms:
        lignes.append(
            "     note : +%g ms au-dessus de la parité (moins bavard que le sondage "
            "remplacé, ce que la règle autorise)." % (resync_ms - seuil_ms)
        )
    return 0, lignes


def main(argv=None):
    analyseur = argparse.ArgumentParser(
        description="Juge la parité du plancher de resync avec le sondage remplacé."
    )
    analyseur.add_argument("--live", default=str(LIVE_FILE), help="module du bus (backend/kojo_live.py)")
    analyseur.add_argument("--sonde", default=str(SONDE_FILE), help="sonde qui DÉCLARE le seuil remplacé")
    options = analyseur.parse_args(argv)

    texte_live, empechement = lire_texte(Path(options.live), PLANCHER_LIVE, "backend/kojo_live.py")
    if texte_live is None:
        print("[ERREUR] %s" % empechement)
        return 1
    texte_sonde, empechement = lire_texte(
        Path(options.sonde), PLANCHER_SONDE, SONDE_FILE.name
    )
    if texte_sonde is None:
        print("[ERREUR] %s" % empechement)
        return 1

    code, lignes = juger(texte_live, texte_sonde)
    for ligne in lignes:
        print(ligne)
    if code:
        print(
            "\n   → le plancher de resync est le SEUL frein de la réparation du bus : "
            "sous le sondage remplacé, il ne remplace qu'un aller-retour par un autre."
        )
    return code


if __name__ == "__main__":
    sys.exit(main())
