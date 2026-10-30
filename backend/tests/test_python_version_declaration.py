# -*- coding: utf-8 -*-
"""L'interpréteur du dépôt est DÉCLARÉ une fois, et ses autres déclarations s'y accordent.

POURQUOI CE FICHIER

Mesuré le 30/10/2026 : `python -m pytest tests` sur la machine de développement
(**Python 3.14.7**) rendait **un check requis rouge sur un arbre sain** —
`tests/test_core_surface.py::...test_aucun_nom_du_contrat_n_a_change_de_nature_ni_de_signature`,
onze écarts tous de la forme `() -> Optional[Any]` figé, `() -> Any | None`
observé. Depuis Python 3.14, `inspect.signature` rend les annotations via
`annotationlib`, qui applique PEP 604. La CI (3.11) ne voyait rien, et rien dans
le dépôt ne disait QUELLE version était la bonne : ni `.python-version`, ni
`engines`, ni `pyproject`. Un développeur tombait donc sur un rouge
inexpliquable, et la seule issue était de le deviner.

Le contrat de surface a été rendu INDÉPENDANT de l'interpréteur (cf.
`TestLeRenduDesUnions` dans `test_core_surface.py` — deux écritures d'une union
se comparent désormais pareil). Ce fichier-ci traite l'autre moitié du défaut :
la version que le dépôt VISE est écrite, une fois, et les endroits qui en
DÉPENDENT la relisent.

CE QUI EST VÉRIFIÉ

  * `.python-version` existe, porte une version nue (`3.11`), et rien d'autre ;
  * l'image DÉPLOYÉE (`backend/Dockerfile`, `FROM python:3.11-slim`) tourne sous
    cette version : c'est la seule qui décide de ce qui est servi ;
  * chaque JOB de workflow qui installe `requirements.lock` ou lance `pytest`
    le fait sous cette version. Le tri se fait par job et non par fichier : un
    job neuf écrit à 3.12 dans `ci.yml` doit rougir même si les autres jobs du
    même fichier sont à 3.11 — c'est exactement le trou qu'un contrôle par
    fichier laisserait ;
  * un job qui lance `pytest` SANS déclarer de version est refusé aussi : il
    tournerait sous l'interpréteur par défaut du runner, donc sous une version
    que personne n'a choisie.

CE QUI N'EST PAS VÉRIFIÉ, ET POURQUOI

Les workflows de SONDE qui ne font que des requêtes HTTP (assistant, sauvegardes
Atlas, santé du backend) tournent sous `3.12` : ils n'installent pas le lock et
ne lancent pas `pytest`, donc aucun de leurs résultats ne dépend de la version
visée. Le contrôle les ignore parce qu'il regarde ce qui en DÉPEND, pas ce qui
contient le mot « python » — un garde qui exigerait 3.11 partout rougirait sur
trois workflows légitimes et serait désarmé dans la semaine.

Rien ici ne lit l'interpréteur QUI EXÉCUTE le test : la vérification est du
texte, donc elle passe verte sur n'importe quelle machine — c'est la condition
pour que ce garde ne reproduise pas le défaut qu'il ferme.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
DECLARATION = RACINE / ".python-version"
DOCKERFILE = RACINE / "backend" / "Dockerfile"
WORKFLOWS = RACINE / ".github" / "workflows"

# Une version nue : « 3.11 », jamais « ^3.11 », « >=3.11 » ni « 3.11.7 » (une
# déclaration qui accepte une plage ne dit pas ce sur quoi le dépôt est jugé).
MOTIF_VERSION = re.compile(r"^\d+\.\d+$")

# `FROM python:3.11-slim`, `FROM python:3.11`, `FROM --platform=… python:3.11-slim`
MOTIF_IMAGE = re.compile(r"^[ \t]*FROM[ \t]+(?:--\S+[ \t]+)*python:(\d+\.\d+)", re.MULTILINE)

# `python-version: "3.11"` / `python-version: '3.11'` / `python-version: 3.11`
MOTIF_SETUP = re.compile(r"^[ \t]*python-version:[ \t]*[\"']?(\d+\.\d+)", re.MULTILINE)

# Un job installe le lock, ou lance pytest : deux faits qui DÉPENDENT de la
# version (les empreintes du lock sont celles des versions épinglées, et la
# suite juge des surfaces qui peuvent dépendre de l'interpréteur).
MOTIF_LOCK = re.compile(r"-r[ \t]+(?:backend/)?requirements\.lock")
MOTIF_PYTEST = re.compile(r"\bpytest\b")

# Les jobs sont les clés de premier niveau sous `jobs:` : deux espaces
# d'indentation, un identifiant, deux-points. Assez pour découper `ci.yml`
# (13 jobs) sans embarquer un analyseur YAML — et si un fichier ne se découpe
# pas, le plancher ci-dessous refuse de conclure au lieu de passer à vide.
MOTIF_JOB = re.compile(r"^  ([A-Za-z0-9_-]+):[ \t]*$", re.MULTILINE)

# Sous ces seuils, la lecture est cassée, pas le contrat.
MINIMUM_DE_JOBS_DEPENDANTS = 3
MINIMUM_DE_FICHIERS = 2


def declaration() -> str:
    """La version déclarée, ou un refus nommé."""
    assert DECLARATION.is_file(), (
        "%s est absent : la version que le dépôt vise ne serait écrite nulle "
        "part, et un interpréteur plus récent rendrait un check requis rouge "
        "sans que rien ne dise laquelle est la bonne" % DECLARATION.name
    )
    contenu = DECLARATION.read_text(encoding="utf-8").strip()
    assert MOTIF_VERSION.match(contenu), (
        "%s doit porter une version NUE (par exemple 3.11), pas %r : une plage "
        "ne dit pas sur quoi le dépôt est jugé" % (DECLARATION.name, contenu)
    )
    return contenu


def version_de_l_image() -> str:
    """La version de l'image DÉPLOYÉE, lue dans `backend/Dockerfile`."""
    assert DOCKERFILE.is_file(), "%s est absent : l'image servie n'est pas lisible" % DOCKERFILE
    trouvees = MOTIF_IMAGE.findall(DOCKERFILE.read_text(encoding="utf-8"))
    assert trouvees, (
        "aucun `FROM python:X.Y` dans backend/Dockerfile : le garde ne pourrait "
        "pas dire sous quelle version la production tourne"
    )
    distinctes = sorted(set(trouvees))
    assert len(distinctes) == 1, (
        "backend/Dockerfile déclare plusieurs versions de Python (%s) : une "
        "seule image est servie" % distinctes
    )
    return distinctes[0]


def _actif(corps: str) -> str:
    """Le corps d'un job SANS ses commentaires YAML.

    Un commentaire cite volontiers `pytest` ou `requirements.lock` pour
    expliquer une politique — mesuré le 30/10/2026 : les deux seules
    occurrences de ces mots dans le job `deploy-fly` sont dans la prose de sa
    politique, et il ne lance évidemment aucun test. Lire le texte brut ferait
    donc rougir un job qui ne dépend de rien.
    """
    return "\n".join(
        ligne for ligne in corps.splitlines() if not ligne.lstrip().startswith("#")
    )


def jobs_dependants() -> list[tuple[str, str, str]]:
    """[(fichier, job, version déclarée ou '')] pour les jobs qui en DÉPENDENT.

    Un job qui déclarerait DEUX versions est rendu ambigu (`3.11/3.12`) plutôt
    que résolu : choisir une des deux ferait passer un job contradictoire.
    """
    trouves = []
    for chemin in sorted(WORKFLOWS.glob("*.yml")):
        texte = chemin.read_text(encoding="utf-8")
        for job, corps in _jobs(texte):
            actif = _actif(corps)
            if not (MOTIF_LOCK.search(actif) or MOTIF_PYTEST.search(actif)):
                continue
            trouves.append((chemin.name, job, "/".join(sorted(set(MOTIF_SETUP.findall(corps))))))
    return trouves


def test_la_declaration_est_unique_et_nue():
    version = declaration()
    assert version == version_de_l_image(), (
        "la version DÉCLARÉE (%s) et celle de l'image DÉPLOYÉE (%s) diffèrent : "
        "les tests ne jugeraient pas l'interpréteur qui sert"
        % (version, version_de_l_image())
    )


def test_chaque_job_qui_en_depend_tourne_sous_la_version_declaree():
    version = declaration()
    dependants = jobs_dependants()

    assert len(dependants) >= MINIMUM_DE_JOBS_DEPENDANTS, (
        "seuls %d job(s) dépendant(s) de l'interpréteur ont été lus (%s) : la "
        "découpe des jobs est cassée, le contrôle ne mesurerait rien"
        % (len(dependants), dependants)
    )
    assert len({fichier for fichier, _, _ in dependants}) >= MINIMUM_DE_FICHIERS, (
        "les jobs dépendants ne viennent que d'un fichier (%s) : la lecture des "
        "workflows est incomplète" % sorted({fichier for fichier, _, _ in dependants})
    )

    ecarts = []
    for fichier, job, observee in dependants:
        if not observee:
            ecarts.append(
                "%s / %s : lance pytest ou installe le lock SANS `python-version` "
                "— il tournerait sous l'interpréteur par défaut du runner, que "
                "personne n'a choisi" % (fichier, job)
            )
        elif observee != version:
            ecarts.append(
                "%s / %s : %s, alors que le dépôt vise %s (`.python-version`, "
                "backend/Dockerfile)" % (fichier, job, observee, version)
            )

    assert ecarts == [], "des jobs ne tournent pas sous l'interpréteur déclaré :\n  - " + "\n  - ".join(ecarts)


def test_les_sondes_hors_perimetre_sont_vraiment_hors_perimetre():
    """Non-vacuité du choix : une sonde à 3.12 existe, et elle n'installe pas le lock.

    Ce cas empêche le garde de devenir un « 3.11 partout » par accident : il
    affirme que l'exemption est FONDÉE (les sondes ne dépendent pas de la
    version), pas qu'elle est commode.
    """
    versions_des_sondes = []
    for chemin in sorted(WORKFLOWS.glob("*.yml")):
        texte = chemin.read_text(encoding="utf-8")
        for job, corps in _jobs(texte):
            actif = _actif(corps)
            if MOTIF_LOCK.search(actif) or MOTIF_PYTEST.search(actif):
                continue
            versions_des_sondes.extend(MOTIF_SETUP.findall(corps))

    assert versions_des_sondes, (
        "aucun job hors périmètre lu : soit tous les workflows lancent pytest, "
        "soit la découpe des jobs est cassée"
    )
    autre = sorted({v for v in versions_des_sondes if v != declaration()})
    assert autre, (
        "tous les jobs hors périmètre tournent sous %s : l'exemption écrite en "
        "tête de fichier ne décrit plus rien, il faut la relire"
        % declaration()
    )


def _jobs(texte: str) -> list[tuple[str, str]]:
    """[(job, corps)] — la découpe utilisée par les deux contrôles ci-dessus."""
    positions = [(m.start(), m.group(1)) for m in MOTIF_JOB.finditer(texte)]
    return [
        (job, texte[debut:(positions[i + 1][0] if i + 1 < len(positions) else len(texte))])
        for i, (debut, job) in enumerate(positions)
    ]


if __name__ == "__main__":  # pragma: no cover - lecture à la main
    pytest.main([__file__, "-q"])
