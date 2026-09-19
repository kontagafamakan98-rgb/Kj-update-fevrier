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
    python .github/scripts/check-guard-mutations.py --list        # valide le spec
    python .github/scripts/check-guard-mutations.py --only ID     # une seule
    python .github/scripts/check-guard-mutations.py --etape NOM --changed-from
    python .github/scripts/check-guard-mutations.py --etape NOM --rejouer --changed-from

COÛT ET PÉRIMÈTRE — c'est la TABLE qui décide, pas le job, et le job ne désigne
plus un filtre : il DEMANDE à la table, par le nom d'une étape déclarée sous
`rejeux` (`--etape`), si son rejeu est dû, puis exécute ce que cette étape doit
(`--rejouer`). Il n'y a donc plus de « runner » passé en argument : nommer un
runner était la façon dont un job choisissait son filtre, et ce choix appartient
à la table. Les mutations Node pèsent l'essentiel d'une étape (~2,5 min, un
runner Vitest chacune) et les mutations Python ~17 s : une étape n'est due que
si le garde, la preuve, un module importé ou un fichier partagé du runner d'UNE
de ses mutations a changé — et elle ne rejoue alors que celles-là. La référence
de comparaison vient de `_base_du_changement`, la même fonction pour toutes les
étapes. Le verdict qu'un workflow relaie et le rejeu qu'il exécute ensuite sont
d'ailleurs la MÊME mesure (`etat_d_etape`) : deux calculs séparés seraient deux
occasions de diverger, et la divergence irait dans le sens du faux vert.

Trois règles vont dans le sens de l'erreur sûre : on rejoue TOUT quand la table
ou le harnais a bougé (c'est eux qui calculent la sélection), TOUT quand la base
de comparaison est introuvable, et TOUT sur `main` — un garde qui cesserait
d'être prouvé faute de changement détecté serait un faux vert de plus. Le
périmètre d'une mutation suit en revanche les dépendances DÉRIVÉES de la source
(imports relatifs, imports absolus du dépôt, chemins cités en clair), en
incluant trop plutôt que trop peu.
"""
import argparse
import ast
import hashlib
import io
import json
import os
import re
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


CHAMPS_GARDE = {"chemin", "role", "invoque_par", "preuve", "runner", "motif", "hors_mutation"}
CHAMPS_REJEU = {"nom", "runner", "porte_sur", "pourquoi"}


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

    # LES ETAPES DE REJEU : ce sont elles qui portent le PERIMETRE. Le workflow
    # ne choisit plus quel filtre appliquer a quel job — il demande a la table,
    # par le nom de l'etape, ce qu'il doit rejouer. Une etape declaree soit un
    # runner (les mutations qu'il couvre), soit des entrees du registre
    # (`porte_sur`) : dans les deux cas les FICHIERS sont derives, jamais
    # recopies.
    if not isinstance(spec.get("rejeux"), list) or not spec["rejeux"]:
        raise SpecInvalide("registre : « rejeux » doit etre une liste non vide")
    noms_etapes = set()
    for etape in spec["rejeux"]:
        inconnus = set(etape) - CHAMPS_REJEU
        if inconnus:
            raise SpecInvalide("etape %s : champ inconnu %s" % (etape.get("nom"), sorted(inconnus)))
        if not etape.get("nom"):
            raise SpecInvalide("etape sans nom dans « rejeux »")
        if etape["nom"] in noms_etapes:
            raise SpecInvalide("etape %s declaree deux fois" % etape["nom"])
        noms_etapes.add(etape["nom"])
        porte_sur = etape.get("porte_sur") or []
        if not etape.get("runner") and not porte_sur:
            raise SpecInvalide(
                "etape %s : ni runner ni porte_sur — elle ne dit pas ce qu'elle rejoue" % etape["nom"]
            )
        if etape.get("runner") and etape["runner"] not in RUNNERS:
            raise SpecInvalide(
                "etape %s : runner « %s » inconnu" % (etape["nom"], etape["runner"])
            )
        for chemin in porte_sur:
            if chemin not in chemins:
                raise SpecInvalide(
                    "etape %s : « %s » n'est pas une entree du registre" % (etape["nom"], chemin)
                )
        if etape.get("runner") and not any(
            mutation["runner"] == etape["runner"] for mutation in spec["mutations"]
        ):
            # Une étape qui declare un runner sans qu'aucune mutation ne porte ce
            # runner ne rejouerait RIEN en restant verte : c'est un faux vert de
            # la meme famille que l'ancien filtre de runner vide.
            raise SpecInvalide(
                "etape %s : aucune mutation de runner « %s » — elle ne prouverait rien"
                % (etape["nom"], etape["runner"])
            )
        if porte_sur and not etape.get("pourquoi"):
            # Une etape qui porte sur des ENTREES plutot que sur un runner doit
            # dire pourquoi : c'est la seule declaration du fichier qui ne soit
            # pas derivee d'un runner, donc celle qui pourrait devenir un fourre-
            # tout si on ne l'expliquait pas.
            raise SpecInvalide(
                "etape %s : porte sur des entrees sans « pourquoi »" % etape["nom"]
            )

    # Aucun runner declare ne doit rester sans etape : sinon ses mutations
    # seraient rejouees par personne, et la table le dirait sans que rien ne
    # rougisse. Les portees se DERIVENT de ce que les etapes declarent.
    couverts = {etape["runner"] for etape in spec["rejeux"] if etape.get("runner")}
    orphelins = sorted({mutation["runner"] for mutation in spec["mutations"]} - couverts)
    if orphelins:
        raise SpecInvalide(
            "runner(s) sans etape de rejeu declaree : %s — leurs mutations ne seraient "
            "rejouees nulle part" % orphelins
        )

    # EXHAUSTIVITE : chaque entree du registre est soit mutee, soit declaree
    # hors d'atteinte AVEC son motif. Sans cette regle, un garde ajoute demain
    # resterait sans preuve d'echec sans que rien ne le signale — le faux vert
    # que ce harnais existe pour fermer.
    mutes = {mutation["garde"] for mutation in spec["mutations"]}
    for garde in spec["gardes"]:
        mute = garde["chemin"] in mutes
        declare = bool(garde.get("hors_mutation"))
        if mute and declare:
            raise SpecInvalide(
                "garde %s : muté ET déclaré hors d'atteinte — l'un des deux ment"
                % garde["chemin"]
            )
        if not mute and not declare:
            raise SpecInvalide(
                "garde %s : ni mutation, ni motif d'exclusion — sa capacité à échouer n'est "
                "prouvée par rien" % garde["chemin"]
            )
    return spec


# Fichiers dont un changement invalide le FILTRE lui-même : la sélection est
# calculée à partir d'eux, donc quand ils bougent, une liste de « gardes
# touchés » ne dit plus rien de fiable — on rejoue tout.
SENSIBLES_AU_FILTRE = ("guard-proofs.json", "check-guard-mutations.py")


def fichiers_changes(depuis, racine=REPO_ROOT):
    """Les fichiers qui diffèrent entre `depuis` et l'arbre courant.

    UNE seule référence (`git diff REF`), PAS trois points : un clone superficiel
    n'a pas la base de fusion, et l'erreur dangereuse serait de SOUS-ESTIMER le
    changement — donc de sauter une mutation. Cette forme peut au pire en
    rapporter trop (y compris un changement non committé) : on paie une preuve de
    plus, jamais une de moins.
    """
    proc = subprocess.run(
        ["git", "diff", "--name-only", depuis],
        cwd=str(racine), capture_output=True,
    )
    if proc.returncode != 0:
        raise SpecInvalide(
            "git diff %s a échoué (%s) : un filtre qui ne peut pas lire le "
            "changement est un filtre qui pourrait ne rien rejouer"
            % (depuis, (proc.stderr or b"").decode("utf-8", "replace").strip() or "sans message")
        )
    return {
        ligne.strip().replace("\\", "/")
        for ligne in proc.stdout.decode("utf-8", "replace").splitlines()
        if ligne.strip()
    }


# Fichiers qui pesent sur TOUTE preuve d'un runner : config de collecte, points
# d'entree implicites, dependances installees. Un changement la-dedans peut
# changer le verdict d'une preuve sans que le garde ni elle aient bouge — les
# ignorer serait le trou par lequel le filtre sous-estimerait un changement.
FICHIERS_PARTAGES = {
    "python": ("backend/pytest.ini", "backend/tests/conftest.py"),
    "node": ("frontend/vite.config.js", "frontend/package.json",
             "frontend/package-lock.json"),
}

# Extensions qu'un chemin CITÉ dans une source peut désigner. Une preuve qui
# écrit « .github/scripts/x.py » dépend de ce fichier : le citer est la seule
# façon dont le dépôt dit ce lien, donc on le lit plutôt que de le supposer.
EXTENSIONS_CITEES = (".py", ".js", ".cjs", ".mjs", ".json", ".sh", ".yml", ".yaml")


def _resolution(chemin, racine):
    """Le chemin, normalisé en relatif POSIX, s'il existe dans le dépôt."""
    fichier = racine / chemin
    if fichier.is_file():
        return fichier.resolve().relative_to(racine.resolve()).as_posix()
    return None


def _imports_du_depot(chemin, racine):
    """Tout ce dont un fichier du dépôt DÉPEND, tel que sa source le dit.

    Un garde n'est pas seulement son fichier : `check-home-shell.js` et huit
    autres importent `site-meta.js`, donc modifier ce module partagé peut changer
    ce qu'ils refusent sans que ni le garde ni sa preuve n'ait bougé. Trois
    formes sont lues, et chacune a été rencontrée dans le dépôt :

      * l'import RELATIF (`./x`, `../x`, `from .x import y`) ;
      * l'import ABSOLU d'un module du dépôt (`import kojo_retention`,
        `from tests.conftest import ...`) — la moitié des preuves Python ;
      * un chemin CITÉ en clair (`".github/scripts/x.py"`), qui est la façon
        dont un garde désigne le fichier qu'il audite ou qu'il neutralise.

    Le sens de l'erreur est choisi : on inclut TROP, jamais trop peu — une
    mutation rejouée pour rien coûte des secondes, une mutation sautée à tort
    rend un garde aveugle en silence.
    """
    fichier = racine / chemin
    if not fichier.is_file():
        return set()
    if fichier.suffix not in (".py", ".js", ".cjs", ".mjs"):
        # Un JSON, une config, un shell : le dépôt n'y DÉCLARE pas ses
        # dépendances, et les lire comme du code ferait entrer des fichiers
        # cités par hasard dans la fermeture (mesuré : 103 fichiers au lieu de
        # 15 avant cette borne).
        return set()
    try:
        texte = fichier.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return set()

    trouves = set()

    # 1. Imports relatifs (JS et Python).
    for motif in re.findall(r"(?:from|require\()\s*['\"](\.[^'\"]+)['\"]", texte):
        base = fichier.parent / motif
        candidats = [base]
        candidats += [base.with_name(base.name + ext) for ext in (".js", ".cjs", ".mjs", ".py")]
        candidats.append(base / "__init__.py")
        for candidat in candidats:
            if candidat.is_file():
                trouves.add(candidat.resolve().relative_to(racine.resolve()).as_posix())
                break

    # 2. Imports absolus de modules du dépôt.
    for nom in re.findall(r"^\s*(?:import|from)\s+([A-Za-z_][\w.]*)", texte, re.M):
        if nom.startswith("kojo_") or nom.startswith("scripts") or nom.startswith("tests"):
            morceaux = nom.split(".")
            candidats = ["/".join(morceaux) + suffixe
                         for suffixe in (".py", "/__init__.py")]
            candidats += ["backend/" + c for c in list(candidats)]
            for candidat in candidats:
                resolu = _resolution(candidat, racine)
                if resolu:
                    trouves.add(resolu)
                    break

    # 3. Chemins cités en clair — dans une EXPRESSION, pas dans une docstring ni
    # dans un commentaire. La différence n'est pas cosmétique : le harnais
    # lui-même cite `site-meta.js` en prose, et compter cette prose comme une
    # dépendance relierait ses mutations à la moitié du dépôt (mesuré : 181
    # fichiers au lieu de 15), donc à un filtre qui ne filtre plus.
    try:
        arbre = ast.parse(texte)
    except SyntaxError:
        arbre = None
    if arbre is not None:
        prose = {
            id(noeud.value)
            for noeud in ast.walk(arbre)
            if isinstance(noeud, ast.Expr) and isinstance(noeud.value, ast.Constant)
            and isinstance(noeud.value.value, str)
        }
        for noeud in ast.walk(arbre):
            if not (isinstance(noeud, ast.Constant) and isinstance(noeud.value, str)):
                continue
            if id(noeud) in prose or not noeud.value.endswith(EXTENSIONS_CITEES):
                continue
            for candidat in (noeud.value, "backend/" + noeud.value, "frontend/" + noeud.value):
                resolu = _resolution(candidat, racine)
                if resolu:
                    trouves.add(resolu)
                    break

    return trouves


# Le registre nomme le runner par son cadriciel (`pytest`, `vitest`) ; le
# harnais, par sa famille de fichiers partagés (`python`, `node`). Les deux se
# lisent ici plutot que d'etre recopies dans chaque entree.
FAMILLE_DE_RUNNER = {"pytest": "python", "vitest": "node"}


def fichiers_impliques(entree, racine=REPO_ROOT):
    """Tout ce dont un changement peut modifier ce que cette entrée prouve :
    le garde (ou la cible), sa preuve, les fichiers partagés de son runner, et
    ce que ces fichiers importent ou citent — de proche en proche, puisqu'un
    module partagé peut lui-même en citer un autre.

    L'entrée est une mutation (`cible`) ou une entrée de `gardes` (`chemin`) :
    les deux formes se lisent ici, parce que le périmètre d'une étape de rejeu
    se calcule sur la seconde quand elle ne rejoue pas de mutation.
    """
    impliques = {entree.get("cible") or entree["chemin"]}
    if entree.get("preuve"):
        impliques.add(entree["preuve"])
    famille = FAMILLE_DE_RUNNER.get(entree.get("runner"), entree.get("runner"))
    impliques |= {
        chemin for chemin in FICHIERS_PARTAGES.get(famille, ())
        if (racine / chemin).is_file()
    }
    while True:
        avant = len(impliques)
        for chemin in sorted(impliques):
            impliques |= _imports_du_depot(chemin, racine)
        if len(impliques) == avant:
            return impliques


def _sensibles_touches(changes):
    """Les fichiers du filtre lui-même qui ont changé. Quand ils bougent, la
    sélection ne dit plus rien de fiable : c'est eux qui la calculent."""
    return sorted(
        fichier for fichier in SENSIBLES_AU_FILTRE
        if any(change == fichier or change.endswith("/" + fichier) for change in changes)
    )


def mutations_concernees(mutations, changes):
    """(mutations à rejouer, motif) pour un changement donné.

    Une mutation est rejouée si le GARDE qu'elle neutralise ou la PREUVE qui doit
    rougir a changé — c'est la seule chose qui puisse modifier ce qu'elle prouve.
    Si la TABLE ou le HARNAIS a changé, la sélection n'est plus une information
    fiable (c'est eux qui la calculent) : on rejoue tout.
    """
    touche = _sensibles_touches(changes)
    if touche:
        return list(mutations), (
            "la table ou le harnais a changé (%s) : le filtre ne peut plus être ce qui "
            "décide, tout est rejoué" % ", ".join(touche)
        )
    retenues = [
        mutation for mutation in mutations
        if fichiers_impliques(mutation) & changes
    ]
    return retenues, "garde, preuve ou module importé modifiés"


def etape_de(spec, nom):
    """L'étape de rejeu déclarée sous ce nom, ou une erreur nommée."""
    for etape in spec["rejeux"]:
        if etape["nom"] == nom:
            return etape
    raise SpecInvalide(
        "etape de rejeu inconnue : %r (declarées : %s)"
        % (nom, sorted(e["nom"] for e in spec["rejeux"]))
    )


def portee_de_l_etape(spec, etape, racine=REPO_ROOT):
    """Ce qu'une étape de rejeu couvre : (mutations à rejouer, fichiers dont le
    changement la rend due).

    Une étape de runner tient ses fichiers de SES mutations ; une étape qui ne
    rejoue pas de mutation (une preuve exécutée telle quelle) les tient des
    entrées qu'elle déclare porter. Dans les deux cas la dérivation est la même
    fonction : le périmètre n'est pas écrit deux fois.
    """
    if etape.get("runner"):
        a_rejouer = [m for m in spec["mutations"] if m["runner"] == etape["runner"]]
    else:
        a_rejouer = []
    fichiers = set()
    for entree in a_rejouer or [
        next(g for g in spec["gardes"] if g["chemin"] == chemin)
        for chemin in (etape.get("porte_sur") or [])
    ]:
        fichiers |= fichiers_impliques(entree, racine)
    return a_rejouer, fichiers


def _base_du_changement(demande=None, racine=REPO_ROOT):
    """La référence à laquelle comparer l'arbre, ou None pour rejouer ENTIER.

    C'est ICI que se règle la portée, et nulle part ailleurs : le workflow ne
    choisit plus quel filtre appliquer à quel job — il passe la référence que
    GitHub lui donne et c'est cette fonction qui décide. Deux règles, et elles
    vont dans le sens de l'erreur sûre :

      * invocation NU (sur `main`, en dispatch) → preuve entière ;
      * base introuvable (clone superficiel, SHA non récupérable) → preuve
        ENTIÈRE aussi, avec son motif affiché. Jamais moins.
    """
    if demande and demande != "auto":
        return demande, "référence passée en argument"
    if not demande:
        return None, "invocation sans filtre (push sur main, dispatch) : preuve ENTIÈRE due"
    vues = 0
    for ref in (os.environ.get("KOJO_MUTATIONS_DEPUIS"),
                os.environ.get("KOJO_BRANCHE_DE_BASE")):
        if not ref:
            continue
        vues += 1
        proc = subprocess.run(
            ["git", "fetch", "--depth=1", "origin", ref],
            cwd=str(racine), capture_output=True,
        )
        if proc.returncode == 0:
            return "FETCH_HEAD", "base de comparaison récupérée (%s)" % ref[:12]
    if not vues:
        # Sur `main` et en dispatch il n'y a pas de PR : c'est le rejeu entier
        # qui est dû, et le dire ainsi évite de faire croire à un échec.
        return None, "aucune base de PR fournie (push sur main, dispatch) : preuve ENTIÈRE due"
    return None, "base de comparaison introuvable : preuve ENTIÈRE due (jamais moins)"


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


def rejouer(mutations):
    """Exécute les mutations données et rend le code de sortie : 1 si une seule
    est restée verte sans motif, 0 sinon.

    Un rejeu VIDE n'est pas un échec ici : c'est le cas d'une étape à qui le
    verdict ne devait rien, et c'est `rejouer_l_etape` qui le dit. Ce qui reste
    un échec, c'est une mutation qui ne mord pas.
    """
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


def _publier_verdict(verdict, motif):
    """Rend le verdict à GitHub Actions, quand on tourne dans une étape : c'est
    ce qui permet au workflow de RELAYER une décision prise ici, au lieu de
    choisir lui-même quel filtre appliquer à quel job."""
    chemin = os.environ.get("GITHUB_OUTPUT")
    if not chemin:
        return
    with io.open(chemin, "a", encoding="utf-8", newline="\n") as flux:
        flux.write("rejeu=%s\n" % verdict)
        flux.write("motif=%s\n" % motif.replace("\n", " "))


def etat_d_etape(spec, nom, demande=None, racine=REPO_ROOT):
    """Le verdict d'une étape déclarée ET le rejeu qu'elle doit — la MÊME mesure.

    Le verdict qu'un workflow relaie et la liste de mutations qu'il exécutera
    ensuite sont calculés ici, une seule fois, par le même chemin : deux calculs
    séparés seraient deux occasions de diverger, et la divergence irait dans le
    sens du faux vert (une étape déclarée due qui ne rejoue rien, ou l'inverse).
    N'exécute aucune mutation : c'est une QUESTION à la table.

    Le périmètre porte sur des FICHIERS dérivés — ceux du garde, de sa preuve,
    des modules qu'ils importent ou citent, et des fichiers partagés du runner.
    Une étape de runner tient donc son verdict DE SES MUTATIONS : elle est due
    si l'une d'elles est concernée, et c'est exactement la liste qu'elle rejoue.
    Une étape sans runner (`porte_sur`) n'a pas de mutation à rejouer : son
    verdict vient des fichiers des entrées qu'elle déclare porter. Tout le reste
    (base introuvable, invocation nue) rend `oui` — jamais moins.

    Retourne (etape, verdict, motif, mutations dues, total du runner).
    """
    etape = etape_de(spec, nom)
    a_rejouer, fichiers = portee_de_l_etape(spec, etape, racine)
    base, motif_base = _base_du_changement(demande, racine)
    if base is None:
        return etape, "oui", motif_base, list(a_rejouer), len(a_rejouer)
    changes = fichiers_changes(base, racine)
    if etape.get("runner"):
        dues, motif_filtre = mutations_concernees(a_rejouer, changes)
        if dues:
            return etape, "oui", "%s (%s)" % (motif_base, motif_filtre), dues, len(a_rejouer)
    else:
        sensibles = _sensibles_touches(changes)
        touche = sorted(fichiers & changes)
        if sensibles:
            return etape, "oui", (
                "%s : la table ou le harnais a changé (%s), donc la portée n'est plus ce "
                "qui décide" % (motif_base, ", ".join(sensibles))
            ), [], 0
        if touche:
            return etape, "oui", "%s : %d fichier(s) modifié(s), dont %s" % (
                motif_base, len(changes), ", ".join(touche[:3])
            ), [], 0
    return etape, "non", (
        "%s : aucun de ses %d fichier(s) n'a bougé" % (motif_base, len(fichiers))
    ), [], len(a_rejouer)


def _dire_l_etape(etape, verdict, motif, dues, total):
    """Écrit le verdict d'une étape et le publie pour le workflow qui le relaie."""
    couvre = (
        "%d mutation(s) sur %d" % (len(dues), total) if etape.get("runner")
        else "preuve exécutée telle quelle"
    )
    print("Etape de rejeu « %s » (%s) → rejeu=%s — %s" % (etape["nom"], couvre, verdict, motif))
    if verdict == "non":
        print("::notice title=Rejeu non du::%s" % motif)
    _publier_verdict(verdict, motif)


def verdict_d_etape(spec, nom, demande=None, racine=REPO_ROOT):
    """Le verdict de portée d'une étape déclarée : `oui` (à rejouer) ou `non`,
    avec son motif. N'exécute aucune mutation, et ne rend que le verdict — c'est
    la question qu'un workflow pose pour ne même pas démarrer une étape qui
    n'est pas due."""
    _dire_l_etape(*etat_d_etape(spec, nom, demande, racine))
    return 0


def rejouer_l_etape(spec, nom, demande=None, racine=REPO_ROOT):
    """Exécute ce que l'étape doit : ses mutations dues, dérivées de la table.

    Une étape à qui le verdict ne doit rien n'exécute AUCUNE mutation et sort en
    0 : c'est un rejeu qui n'était pas dû, pas un rejeu raté — et le verdict est
    publié quand même, pour que la porte qui a laissé passer la dise.
    """
    etape = etape_de(spec, nom)
    if not etape.get("runner"):
        # Une étape qui porte sur des entrées déclarées n'exécute aucune mutation
        # du harnais : c'est le workflow qui lance sa preuve, sous la porte du
        # verdict. L'inviter à rejouer serait un rejeu qui ne prouve rien.
        raise SpecInvalide(
            "etape %s : elle ne rejoue aucune mutation du harnais (elle porte sur des "
            "preuves exécutées telles quelles) — c'est le workflow qui lance sa preuve"
            % nom
        )
    _, verdict, motif, dues, total = etat_d_etape(spec, nom, demande, racine)
    _dire_l_etape(etape, verdict, motif, dues, total)
    if verdict == "oui" and dues:
        return rejouer(dues)
    print(
        "[OK] aucun rejeu dû pour cette étape : rien n'a été exécuté "
        "(la preuve ENTIÈRE est due sur main)"
    )
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", help="ne rejoue que cette mutation")
    parser.add_argument("--list", action="store_true", help="valide le registre sans muter")
    parser.add_argument(
        "--etape",
        help="la seule porte d'entrée d'un job : le NOM d'une étape déclarée sous "
             "« rejeux ». Sans --rejouer, rend son verdict de portée (rejeu=oui|non, "
             "publié dans GITHUB_OUTPUT) et son motif ; avec --rejouer, exécute ce que "
             "cette étape doit",
    )
    parser.add_argument(
        "--rejouer", action="store_true",
        help="avec --etape : exécute les mutations dues de cette étape, dérivées de la "
             "table, au lieu de rendre seulement son verdict",
    )
    parser.add_argument(
        "--changed-from", nargs="?", const="auto", metavar="REF",
        help="avec --etape : la référence à laquelle comparer l'arbre. Nue, elle est "
             "DÉRIVÉE de l'environnement de la PR ; sans base trouvée (main, dispatch), "
             "la preuve ENTIÈRE est due",
    )
    args = parser.parse_args(argv)
    if args.rejouer and not args.etape:
        # `--rejouer` dit COMMENT exécuter ; `--etape` dit QUOI. Sans étape, il
        # ne reste qu'un filtre implicite — exactement ce que la table a pris.
        print("[ECHEC] --rejouer a besoin de --etape : c'est la table qui dit ce qui est dû")
        return 2
    if args.changed_from and not args.etape:
        # La portée se DEMANDE à la table, par le nom d'une étape : filtrer le
        # harnais entier depuis un job était la façon dont ce job choisissait son
        # filtre, et c'est ce choix qui n'a plus lieu d'être.
        print(
            "[ECHEC] --changed-from n'a de sens qu'avec --etape : la portée d'un rejeu "
            "se demande à la table, par le nom de l'étape"
        )
        return 2

    try:
        spec = charger_spec()
    except SpecInvalide as exc:
        print("[ECHEC] %s" % exc)
        print("::error title=Registre de preuves invalide::%s" % exc)
        return 1

    if args.etape:
        try:
            if args.rejouer:
                return rejouer_l_etape(spec, args.etape, args.changed_from)
            return verdict_d_etape(spec, args.etape, args.changed_from)
        except SpecInvalide as exc:
            print("[ECHEC] %s" % exc)
            print("::error title=Etape de rejeu inconnue::%s" % exc)
            return 1

    mutations = spec["mutations"]
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

    return rejouer(mutations)


if __name__ == "__main__":
    sys.exit(main())
