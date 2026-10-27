# -*- coding: utf-8 -*-
"""Lock backend : des pins AVEC empreintes, et installés PARTOUT avec elles.

POURQUOI CE FICHIER

`requirements.txt` dit l'INTENTION (des plages, relues à la main) ;
`requirements.lock` dit ce qui est RÉELLEMENT installé, distribution par
distribution, avec l'empreinte SHA-256 de tous les fichiers publiés sur PyPI.
Un lock que personne n'installe est un document, pas une garantie : ces cas
jugent les DEUX moitiés, et chacun échoue sur l'état d'avant.

  1. le lock est COMPLET — chaque distribution déclarée par `requirements.txt`
     y figure, et sa version SATISFAIT la plage déclarée : un bump de plage
     sans régénération rougit ici, avant d'être déployé ;
  2. le lock est FERMÉ — une ligne = un pin `==` + au moins une empreinte
     sha256 ; aucune ligne libre (URL, chemin, `-r`), aucun doublon. Un lock qui
     contient une seule ligne non épinglée n'est plus un lock : `pip install
     --require-hashes` refuserait le fichier ENTIER, donc le déploiement ;
  3. l'INSTALLATION passe par lui, avec `--require-hashes` : `backend/Dockerfile`,
     les deux installs de `ci.yml`, `backup-db.yml` et le README — et AUCUNE
     installation de `requirements.txt` ne subsiste (un chemin oublié suffit à
     contourner le lock, et c'est celui-là qu'on ne relit pas) ;
  4. les CACHES suivent le lock : `cache-dependency-path` de `setup-python`
     pointe sur `requirements.lock`, sinon une dépendance épinglée peut être
     servie par un cache d'une autre version — le cache contredirait la preuve.

Ce que ces cas ne jugent pas : la FRAÎCHEUR des pins (il faudrait interroger
PyPI et comparer des versions publiées, ce que `dependency-audit` fait pour les
avis de sécurité). Et la génération du lock se fait sur un interpréteur 3.11
avec `scripts/maj_lock_requirements.py` : c'est le CONTENU qui est jugé ici, pas
la façon de le produire.
"""
import importlib.util
from pathlib import Path

import pytest
from packaging.requirements import Requirement

RACINE = Path(__file__).resolve().parents[2]
BACKEND = RACINE / "backend"
LOCK = BACKEND / "requirements.lock"
DECLARATIONS = BACKEND / "requirements.txt"
DOCKERFILE = BACKEND / "Dockerfile"
CI = RACINE / ".github" / "workflows" / "ci.yml"
BACKUP_CI = RACINE / ".github" / "workflows" / "backup-db.yml"
INDEX_CI = RACINE / ".github" / "workflows" / "index-db-probe.yml"
README = RACINE / "README.md"
GENERATEUR = "scripts/maj_lock_requirements.py"

# Planchers de lecture : un lock tronqué (ou un fichier de déclarations vidé)
# ferait passer les contrôles ci-dessous sans rien juger. Valeurs mesurées le
# 20/10/2026 (72 distributions verrouillées, 26 exigences déclarées).
MIN_DISTRIBUTIONS = 40
MIN_DECLARATIONS = 20


def _normaliser(nom: str) -> str:
    return nom.strip().lower().replace("_", "-").replace(".", "-")


def _lignes_utiles(chemin: Path):
    return [
        ligne.rstrip("\n")
        for ligne in chemin.read_text(encoding="utf-8").splitlines()
        if ligne.strip() and not ligne.lstrip().startswith("#")
    ]


def lire_lock() -> dict:
    """{nom normalisé: (nom, version, [empreintes])} — refus si forme inattendue."""
    entrees: dict = {}
    courant = None
    for ligne in _lignes_utiles(LOCK):
        if ligne.startswith((" ", "\t")):
            if courant is None:
                pytest.fail(f"empreinte sans distribution au-dessus : {ligne!r}")
            if "--hash=sha256:" not in ligne:
                pytest.fail(f"ligne de continuation qui n'est pas une empreinte : {ligne!r}")
            entrees[courant][2].append(ligne.strip().rstrip("\\").strip())
            continue
        morceau = ligne.rstrip("\\").strip()
        if "==" not in morceau:
            pytest.fail(
                f"ligne du lock qui n'est pas un pin : {ligne!r} — une seule ligne "
                "libre fait refuser TOUT le fichier par --require-hashes."
            )
        nom, version = morceau.split("==", 1)
        courant = _normaliser(nom)
        if courant in entrees:
            pytest.fail(f"distribution en double dans le lock : {nom!r}")
        entrees[courant] = [nom, version.strip(), []]
    return entrees


def lire_declarations() -> dict:
    """{nom normalisé: Requirement} depuis requirements.txt (plages, l'intention)."""
    declarations: dict = {}
    for ligne in _lignes_utiles(DECLARATIONS):
        if ligne.startswith("-"):
            pytest.fail(
                f"option inattendue dans requirements.txt : {ligne!r} — l'intention "
                "se déclare en exigences, les options vivent dans le lock."
            )
        exigence = Requirement(ligne.split("#", 1)[0].strip())
        declarations[_normaliser(exigence.name)] = exigence
    return declarations


class TestLeLockEstFerme:
    def test_chaque_distribution_porte_au_moins_une_empreinte(self):
        entrees = lire_lock()
        assert len(entrees) >= MIN_DISTRIBUTIONS, (
            f"seulement {len(entrees)} distribution(s) lues : le lock est tronqué, "
            "et un lock tronqué ne juge rien"
        )
        sans_empreinte = sorted(nom for nom, (_, _, h) in entrees.items() if not h)
        assert sans_empreinte == [], (
            f"distribution(s) sans empreinte : {sans_empreinte} — "
            "`--require-hashes` refuse le fichier entier."
        )

    def test_les_empreintes_sont_des_sha256_hexadecimaux(self):
        """Une empreinte tronquée ou d'un autre algorithme ne vérifie rien."""
        mauvaises = []
        for nom, (_, _, empreintes) in lire_lock().items():
            for ligne in empreintes:
                valeur = ligne.split("--hash=sha256:", 1)[1]
                if len(valeur) != 64 or any(c not in "0123456789abcdef" for c in valeur):
                    mauvaises.append((nom, ligne))
        assert mauvaises == [], f"empreinte(s) illisible(s) : {mauvaises[:3]}"

    def test_le_lock_nomme_son_outil_de_regeneration(self):
        """Un lock qu'on ne sait pas régénérer finit édité à la main."""
        texte = LOCK.read_text(encoding="utf-8")
        assert GENERATEUR in texte, (
            f"l'en-tête du lock doit dire comment le régénérer ({GENERATEUR}) : "
            "sans cela, le premier bump se fait à la main et la prochaine "
            "régénération réécrit tout."
        )
        assert (BACKEND / GENERATEUR).is_file(), f"{GENERATEUR} doit exister"


class TestLeLockEstComplet:
    def test_chaque_declaration_est_verrouillee_dans_sa_plage(self):
        declarations = lire_declarations()
        entrees = lire_lock()
        assert len(declarations) >= MIN_DECLARATIONS, (
            f"seulement {len(declarations)} exigence(s) déclarée(s) : "
            "un requirements.txt vidé rendrait ce contrôle vert sans rien juger"
        )

        absentes = sorted(nom for nom in declarations if nom not in entrees)
        assert absentes == [], (
            f"déclarée(s) dans requirements.txt mais absente(s) du lock : {absentes} — "
            "le lock est périmé (régénérer avec " + GENERATEUR + ")"
        )

        hors_plage = []
        for nom, exigence in declarations.items():
            version = entrees[nom][1]
            if not exigence.specifier.contains(version, prereleases=True):
                hors_plage.append(f"{exigence.name}{exigence.specifier} ≠ {version}")
        assert hors_plage == [], (
            "le lock ne satisfait plus la plage déclarée : " + ", ".join(hors_plage)
        )


class TestLInstallationPasseParLeLock:
    def test_le_dockerfile_installe_le_lock_avec_empreintes(self):
        texte = DOCKERFILE.read_text(encoding="utf-8")
        assert "pip install --no-cache-dir --require-hashes -r requirements.lock" in texte, (
            "l'image de production doit installer le LOCK avec --require-hashes : "
            "c'est le seul chemin qui vérifie les empreintes en déploiement"
        )
        assert "COPY requirements.txt requirements.lock ./" in texte, (
            "le lock doit être copié dans l'image, sinon le Dockerfile ne peut pas l'installer"
        )

    def test_la_ci_installe_le_lock_avec_empreintes(self):
        texte = CI.read_text(encoding="utf-8")
        installs = [
            ligne.strip()
            for ligne in texte.splitlines()
            if "pip install" in ligne and "-r requirements" in ligne
        ]
        assert installs, "ci.yml n'installe plus les dépendances backend : contrôle sans objet"
        mauvaises = [
            ligne for ligne in installs if "--require-hashes -r requirements.lock" not in ligne
        ]
        assert mauvaises == [], (
            f"installation(s) qui ne vérifient pas les empreintes : {mauvaises}"
        )
        assert len(installs) >= 2, (
            f"{len(installs)} installation(s) repérée(s) dans ci.yml, au moins deux "
            "attendues (job backend-tests et job frontend-build) — le relevé a "
            "perdu un chemin"
        )

    def test_le_job_de_sauvegarde_installe_le_lock_avec_empreintes(self):
        texte = BACKUP_CI.read_text(encoding="utf-8")
        assert "pip install --require-hashes -r requirements.lock" in texte, (
            "backup-db.yml restaure et compare des empreintes : son outillage "
            "s'installe vérifié, comme le reste"
        )

    def test_le_readme_installe_le_lock_avec_empreintes(self):
        texte = README.read_text(encoding="utf-8")
        assert "pip install --require-hashes -r requirements.lock" in texte, (
            "le setup local doit passer par le lock : un poste de développement "
            "qui installe d'autres versions que la production juge autre chose"
        )

    def test_la_sonde_des_index_installe_le_lock_avec_empreintes(self):
        texte = INDEX_CI.read_text(encoding="utf-8")
        assert "pip install --require-hashes -r requirements.lock" in texte, (
            "index-db-probe.yml juge la base de PRODUCTION : son outillage "
            "s'installe vérifié, comme le reste"
        )

    def test_aucune_installation_ne_contourne_le_lock(self):
        """LE contrôle : un chemin oublié suffit, et c'est celui qu'on ne relit pas."""
        coupables = []
        for chemin in (DOCKERFILE, CI, BACKUP_CI, INDEX_CI, README):
            for numero, ligne in enumerate(chemin.read_text(encoding="utf-8").splitlines(), 1):
                if "pip install" not in ligne:
                    continue
                if "-r requirements.txt" in ligne:
                    coupables.append(f"{chemin.name}:{numero} → {ligne.strip()}")
        assert coupables == [], (
            "installation(s) de requirements.txt (des plages, pas des pins) : "
            + " ; ".join(coupables)
        )

    def test_le_cache_de_python_suit_le_lock(self):
        texte = CI.read_text(encoding="utf-8")
        assert "cache-dependency-path: backend/requirements.lock" in texte, (
            "setup-python doit mettre en cache la clé du LOCK : le cache d'une "
            "autre version servirait des fichiers non vérifiés"
        )
        assert "cache-dependency-path: backend/requirements.txt" not in texte, (
            "un cache keyé sur les plages peut réutiliser une version que le lock "
            "n'épingle plus"
        )


class TestLOutilNePeutPasEcrireUnLockFaux:
    """Le script de régénération refuse d'écrire un lock qui ne vérifie rien.

    Un outil qui produit un fichier sans refus est un outil qui peut produire
    un lock incomplet en silence : `--require-hashes` refuserait alors TOUT le
    fichier, et la panne arriverait au déploiement, pas ici.
    """

    def _outil(self):
        chemin = BACKEND / GENERATEUR
        spec = importlib.util.spec_from_file_location("maj_lock_requirements", chemin)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_une_ligne_non_epinglee_est_refusee(self, monkeypatch):
        outil = self._outil()

        class Faux:
            stdout = "fastapi>=0.143.0\n"

        monkeypatch.setattr(outil.subprocess, "run", lambda *a, **k: Faux())
        with pytest.raises(SystemExit) as erreur:
            outil.freeze()
        assert "pin" in str(erreur.value), (
            "un freeze qui contient une plage doit être refusé : le lock qui en "
            "sortirait ne serait pas installable avec --require-hashes"
        )

    def test_une_distribution_sans_empreinte_est_refusee(self, monkeypatch):
        outil = self._outil()

        class Reponse:
            def __enter__(self):
                return self

            def __exit__(self, *_a):
                return False

            def read(self):
                return b'{"urls": []}'

        monkeypatch.setattr(outil.urllib.request, "urlopen", lambda *a, **k: Reponse())
        with pytest.raises(SystemExit) as erreur:
            outil.empreintes("inconnu", "1.0")
        assert "aucun fichier" in str(erreur.value), (
            "un pin sans fichier publié ne peut pas être vérifié : l'écrire "
            "donnerait un lock qui a l'air complet"
        )

    def test_une_distribution_absente_de_pypi_est_refusee(self, monkeypatch):
        outil = self._outil()

        def _introuvable(*_a, **_k):
            raise outil.urllib.error.HTTPError("https://pypi.org", 404, "absent", None, None)

        monkeypatch.setattr(outil.urllib.request, "urlopen", _introuvable)
        with pytest.raises(SystemExit) as erreur:
            outil.empreintes("fantome", "9.9.9")
        assert "404" in str(erreur.value)

    def test_le_lock_ecrit_est_trie_et_porte_les_empreintes(self, monkeypatch, tmp_path):
        outil = self._outil()
        cible = tmp_path / "requirements.lock"
        monkeypatch.setattr(outil, "freeze", lambda: [("zebre", "2.0"), ("a_b", "1.0")])
        monkeypatch.setattr(outil, "empreintes", lambda nom, version: ["ab" * 32, "cd" * 32])
        monkeypatch.setattr(outil, "LOCK_PATH", cible)

        assert outil.main() == 0
        texte = cible.read_text(encoding="utf-8")
        assert texte.index("a_b==1.0") < texte.index("zebre==2.0"), (
            "le lock doit être trié : deux régénérations identiques doivent produire "
            "le même fichier"
        )
        assert texte.count("--hash=sha256:") == 4, "une empreinte par fichier, pour chacun"
        assert "maj_lock_requirements.py" in texte, (
            "le lock écrit doit dire comment le régénérer"
        )
