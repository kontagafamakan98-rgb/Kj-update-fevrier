#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérifie que les durées de conservation publiées sont celles que le code applique.

PRIVACY.md est un document que PERSONNE ne relit quand le code change, et c'est
exactement pourquoi les durées qu'il publie dérivent. Avant ce garde, trois
chiffres vivaient chacun à un seul endroit sans que rien ne les relie :
`expireAfterSeconds=0` dans l'index TTL, la durée réellement écrite dans le
document à la création (48 h pour un paiement, 10 minutes pour un code OTP), et
le chiffre recopié dans un document. Un délai qui changeait dans le code
laissait la politique publiée annoncer l'ancien, en silence, indéfiniment — un
document de conformité qui ment sans que rien ne rougisse.

La durée est maintenant possédée une fois (`backend/kojo_retention.py`, que
`kojo_core.create_database_indexes` utilise pour créer les index). Ce script ne
recopie donc rien : il IMPORTE le module réel, engendre le tableau, et le
compare au bloc délimité de PRIVACY.md. Une divergence est nommée ligne par
ligne — quelle collection, quelle colonne, ce que dit le code, ce que dit le
document — parce qu'un « le document ne correspond pas » oblige à recouper
soi-même, donc finit ignoré.

Ce que ce garde NE couvre pas, dit plutôt que tu : les phrases de PRIVACY.md
qui ne sont pas des durées (droits, écarts connus, journalisation) sont du
texte humain. Le bloc engendré est la seule partie qu'il tient, et le document
le dit à l'endroit où il compte.

Un garde qui ne peut pas conclure (module non importable, marqueurs absents)
ÉCHOUE : passer en silence serait pire qu'échouer.

Usage :
  python3 .github/scripts/check-privacy-policy.py            # vérifie
  python3 .github/scripts/check-privacy-policy.py --write    # régénère le bloc
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

DEBUT = "<!-- CONSERVATION:DEBUT -->"
FIN = "<!-- CONSERVATION:FIN -->"

# Le tableau, colonne par colonne. L'ordre de cette liste EST celui du document :
# deux ordres différents rendraient la comparaison ligne à ligne inutile.
COLONNES = (
    "Collection",
    "Champ indexé",
    "Durée de conservation",
    "Durée portée par",
    "Filtre de l'index",
    "Ce que la purge supprime",
)


def _reconfigure_sortie():
    """Rend la sortie UTF-8 : le document et les verdicts portent des accents,
    et un poste Windows en cp1252 ferait planter le script sur son propre
    rapport au lieu de signaler la divergence qu'il a trouvée."""
    for flux in (sys.stdout, sys.stderr):
        if hasattr(flux, "reconfigure"):
            try:
                flux.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _charger_regles(repo_root: Path):
    """Importe le module RÉEL de conservation (pas une copie du tableau).

    Une copie prouverait que la copie s'accorde avec le document, ce qui
    n'apprend rien sur le code que la production exécute.
    """
    # `kojo_retention` importe `kojo_settings`, qui REFUSE de se charger sans
    # JWT_SECRET dès qu'APP_ENV vaut « production » — le défaut hors `.env`.
    # Or ce n'est pas la question posée ici : ce garde lit des DURÉES, jamais un
    # secret. Sans ce minimum, il échouerait dans un checkout CI (aucun `.env`)
    # et sur tout poste non configuré, pour une raison étrangère à sa fonction.
    # `setdefault` : un environnement déjà configuré n'est pas touché, donc une
    # durée surchargée par variable d'environnement reste comparée telle quelle.
    os.environ.setdefault("APP_ENV", "test")
    os.environ.setdefault("JWT_SECRET", "check-privacy-policy-needs-no-secret")

    backend = repo_root / "backend"
    if not (backend / "kojo_retention.py").is_file():
        raise RuntimeError(f"backend/kojo_retention.py introuvable sous {repo_root}")
    sys.path.insert(0, str(backend))
    import kojo_retention  # noqa: E402  (après l'ajout du chemin)

    return kojo_retention


def _rendre_filtre(partial) -> str:
    if not partial:
        return "aucun (toute la collection)"
    morceaux = []
    for cle, valeur in partial.items():
        if isinstance(valeur, dict) and "$exists" in valeur:
            morceaux.append(f"`{cle}` présent")
        else:
            morceaux.append(f"`{cle}` = `{valeur}`")
    return " et ".join(morceaux)


def _cellules(regle, retention) -> tuple:
    return (
        f"`{regle.collection}`",
        f"`{regle.ttl_field}`" + ("" if regle.date_portee_par_le_document
                                 else " (date de création)"),
        retention.formater_duree(
            regle.lifetime, retention.unite_du_symbole(regle.porte_par)
        ),
        f"`{regle.porte_par}`",
        _rendre_filtre(regle.partial),
        regle.portee,
    )


def _rendre_tableau(retention) -> str:
    """Le tableau complet, engendré cellule par cellule depuis les règles."""
    lignes = [
        "| " + " | ".join(COLONNES) + " |",
        "| " + " | ".join("---" for _ in COLONNES) + " |",
    ]
    for regle in retention.RETENTION_RULES:
        lignes.append("| " + " | ".join(_cellules(regle, retention)) + " |")
    return "\n".join(lignes)


def _rendre_bloc(retention) -> str:
    return f"{DEBUT}\n{_rendre_tableau(retention)}\n{FIN}"


# ── La SECONDE surface qui publie les durées : la page /privacy ───────────────
# PRIVACY.md n'est lu que par ceux qui ouvrent le dépôt ; la page publique est ce
# qu'un visiteur et un moteur lisent vraiment. Les deux surfaces sortent de la
# même règle (backend/kojo_retention.py) : comparer la page au CODE, et non au
# document, évite qu'une durée corrigée d'un côté laisse l'autre annoncer
# l'ancienne — l'écart exact que ce garde existe pour supprimer.
PAGE_CONFIDENTIALITE = "frontend/src/i18n/fr.json"
CLE_DUREES_PUBLIEES = "privacyRetentionBody"
# Motif d'une durée TELLE QU'ELLE EST PUBLIÉE : « 10 minutes », « 48 heures »,
# « 90 jours ». Sert à refuser un chiffre que le code n'applique pas — sans lui,
# une durée retirée du code survivrait dans la page sans que rien ne rougisse.
DUREE_PUBLIEE = re.compile(r"\d+\s*(?:minutes?|heures?|jours?)")


def _verifier_page_publique(repo_root: Path, retention, regles) -> list:
    """Les durées de la page /privacy sont-elles celles du code ?

    Rend la liste des écarts (vide si tout concorde). Un fichier absent ou
    illisible EST un écart : la page publie des durées, donc leur vérification
    ne peut pas disparaître en silence.
    """
    chemin = repo_root / PAGE_CONFIDENTIALITE
    if not chemin.is_file():
        return [
            f"{PAGE_CONFIDENTIALITE} introuvable : les durées publiées par la page "
            f"/privacy ne sont plus vérifiables"
        ]
    try:
        dictionnaire = json.loads(chemin.read_text(encoding="utf-8"))
    except Exception as exc:  # JSON cassé : le build échouerait aussi, mais ici on le dit
        return [f"{PAGE_CONFIDENTIALITE} illisible ({exc}) : durées de la page non vérifiables"]

    texte = dictionnaire.get(CLE_DUREES_PUBLIEES)
    if not isinstance(texte, str) or not texte.strip():
        return [
            f"{PAGE_CONFIDENTIALITE} : clé « {CLE_DUREES_PUBLIEES} » absente ou vide — "
            f"la page /privacy ne publie plus aucune durée"
        ]

    attendues = {
        retention.formater_duree(regle.lifetime, retention.unite_du_symbole(regle.porte_par))
        for regle in regles
    }
    messages = [
        f"page /privacy : la durée « {duree} » du code n'est pas publiée par "
        f"« {CLE_DUREES_PUBLIEES} »"
        for duree in sorted(duree for duree in attendues if duree not in texte)
    ]
    messages += [
        f"page /privacy : la durée « {publiee} » n'est portée par AUCUNE règle de "
        f"conservation — le code n'applique pas ce chiffre"
        for publiee in sorted({m.group(0) for m in DUREE_PUBLIEE.finditer(texte)} - attendues)
    ]
    return messages


def _lignes_du_tableau(bloc: str) -> dict:
    """{collection: {colonne: valeur}} — pour comparer cellule par cellule."""
    trouves = {}
    for ligne in bloc.splitlines():
        ligne = ligne.strip()
        if not ligne.startswith("|"):
            continue
        cellules = [c.strip() for c in ligne.strip("|").split("|")]
        if len(cellules) != len(COLONNES):
            continue
        if set(cellules[0]) <= set("- ") or cellules[0] == COLONNES[0]:
            continue  # séparateur ou en-tête
        trouves[cellules[0]] = dict(zip(COLONNES, cellules))
    return trouves


def _diagnostiquer(attendu: str, actuel: str) -> list:
    """Nomme chaque divergence : collection, colonne, ce que dit le code."""
    messages = []
    lignes_code = _lignes_du_tableau(attendu)
    lignes_doc = _lignes_du_tableau(actuel)

    for collection in lignes_code:
        if collection not in lignes_doc:
            messages.append(
                f"ligne ABSENTE du document pour {collection} : le code la conserve "
                f"({', '.join(lignes_code[collection][c] for c in COLONNES[1:4])}), "
                f"la politique ne la publie pas"
            )
    for collection in lignes_doc:
        if collection not in lignes_code:
            messages.append(
                f"ligne INCONNUE du code : {collection} est publiée alors qu'aucune "
                f"règle de conservation ne la décrit — soit le document invente, soit "
                f"une règle a été retirée du code"
            )
    for collection in lignes_code:
        if collection not in lignes_doc:
            continue
        for colonne in COLONNES[1:]:
            attendu_cellule = lignes_code[collection][colonne]
            if attendu_cellule != lignes_doc[collection][colonne]:
                messages.append(
                    f"{collection}, colonne « {colonne} » : "
                    f"le code dit « {attendu_cellule} », "
                    f"le document dit « {lignes_doc[collection][colonne]} »"
                )

    if not messages:
        # Un écart de mise en forme (marqueurs, lignes vides) : la comparaison
        # cellule par cellule ne le voit pas, l'égalité du bloc si.
        messages.append(
            "les cellules s'accordent mais le bloc diffère : mise en forme, "
            "marqueurs ou lignes vides — régénérer avec --write"
        )
    return messages


def main(argv=None) -> int:
    _reconfigure_sortie()

    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument(
        "--repo-root",
        default=str(Path(__file__).resolve().parents[2]),
        help="racine du dépôt (défaut : deux niveaux au-dessus de ce script)",
    )
    parseur.add_argument(
        "--write", action="store_true", help="régénère le bloc du document"
    )
    args = parseur.parse_args(argv)
    repo_root = Path(args.repo_root).resolve()

    doc = repo_root / "PRIVACY.md"
    if not doc.is_file():
        print(f"[ECHEC] PRIVACY.md introuvable : {doc}", file=sys.stderr)
        return 1

    try:
        retention = _charger_regles(repo_root)
    except Exception as exc:  # module cassé, dépendance absente, chemin faux
        print(
            f"[ECHEC] impossible de lire les règles de conservation : {exc}",
            file=sys.stderr,
        )
        print(
            "::error::check-privacy-policy : le garde ne peut pas conclure, donc il "
            "échoue — un garde silencieux ne prouve rien",
            file=sys.stderr,
        )
        return 1

    regles = retention.RETENTION_RULES
    attendu = _rendre_bloc(retention)
    texte = doc.read_text(encoding="utf-8")

    # La page publique est vérifiée AVANT toute écriture, y compris en --write :
    # régénérer le document pendant que la page contredit le code laisserait
    # croire que les deux surfaces s'accordent.
    ecarts_page = _verifier_page_publique(repo_root, retention, regles)
    if args.write and ecarts_page:
        for message in ecarts_page:
            print(f"[ECHEC] {message}", file=sys.stderr)
            print(f"::error file={PAGE_CONFIDENTIALITE}::{message}", file=sys.stderr)
        print(
            "\nRien n'a été régénéré : la page /privacy et "
            "backend/kojo_retention.py ne disent pas la même chose. Corriger "
            "« privacyRetentionBody » (src/i18n/fr.json) à partir du code, jamais "
            "l'inverse.",
            file=sys.stderr,
        )
        return 1

    if args.write:
        debut, fin = texte.find(DEBUT), texte.find(FIN)
        if debut == -1 or fin == -1 or fin < debut:
            print(
                f"[ECHEC] marqueurs {DEBUT} / {FIN} absents de PRIVACY.md : "
                f"rien à régénérer",
                file=sys.stderr,
            )
            return 1
        # `newline=""` : sans cela, `write_text` traduit `\n` en `\r\n` sous
        # Windows, alors que `.gitattributes` fixe `*.md text eol=lf`. Un
        # `--write` sur un poste Windows convertissait donc le document ENTIER,
        # en silence : git normalise au commit, donc `git diff` ne le montre
        # pas — la même classe de panne que « restauré à l'empreinte » sur un
        # fichier muté (AGENTS.md).
        doc.write_text(
            texte[:debut] + attendu + texte[fin + len(FIN):],
            encoding="utf-8",
            newline="",
        )
        print(f"[OK] bloc régénéré ({len(regles)} règle(s)) dans {doc}")
        return 0

    debut, fin = texte.find(DEBUT), texte.find(FIN)
    if debut == -1 or fin == -1 or fin < debut:
        print(
            f"[ECHEC] marqueurs {DEBUT} / {FIN} absents de PRIVACY.md : le bloc "
            f"engendré n'est plus délimité, donc plus vérifiable",
            file=sys.stderr,
        )
        print("::error file=PRIVACY.md::marqueurs du bloc de conservation absents", file=sys.stderr)
        return 1

    actuel = texte[debut:fin + len(FIN)]
    ecarts_doc = _diagnostiquer(attendu, actuel) if actuel != attendu else []
    # Les DEUX surfaces sont rapportées ensemble, jamais l'une après l'autre :
    # n'annoncer que la première ferait corriger, puis relancer, puis découvrir
    # la seconde — et un garde qui cache un écart sur deux finit par être ignoré.
    if ecarts_doc or ecarts_page:
        for message in ecarts_doc:
            print(f"[ECHEC] {message}", file=sys.stderr)
            print(f"::error file=PRIVACY.md::{message}", file=sys.stderr)
        for message in ecarts_page:
            print(f"[ECHEC] {message}", file=sys.stderr)
            print(f"::error file={PAGE_CONFIDENTIALITE}::{message}", file=sys.stderr)
        print(
            "\nUne durée publiée n'est pas celle que le code applique "
            "(PRIVACY.md et/ou la page /privacy). Régénérer le document : "
            "python3 .github/scripts/check-privacy-policy.py --write",
            file=sys.stderr,
        )
        return 1

    # Marqueurs ASCII uniquement dans les verdicts (convention des autres
    # scripts CI du dépôt : un caractère hors cp1252 ferait planter la sortie).
    portees = ", ".join(
        f"{r.collection}="
        f"{retention.formater_duree(r.lifetime, retention.unite_du_symbole(r.porte_par))}"
        for r in regles
    )
    print(f"[OK] {len(regles)} duree(s) publiee(s) == celles du code : {portees}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
