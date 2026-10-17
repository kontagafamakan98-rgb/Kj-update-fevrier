# -*- coding: utf-8 -*-
"""Régression : le garde d'ÉTAT DE RÉFÉRENCE (.github/scripts/check-etat-reference.py).

Pourquoi une preuve, et pourquoi celle-ci : ce garde existe pour attraper une
mutation DÉCLARÉE laissée en place dans l'arbre (le harnais écrit dans un fichier
réel, restaure, et vérifie sa restauration — mais un processus TUÉ entre les deux
ne restaure rien, et rien ne le dit). Un garde dont rien ne prouve qu'il sait
rougir pourrait être aveugle exactement là, et la suite locale repasserait verte
sur un dépôt muté.

Ce que ces tests exercent :

  * les DÉCISIONS, sur des arbres de fixture (racine, registre et registre des
    preuves injectés) : dérive refusée et nommée, mutation en place reconnue,
    cible sans état de référence, entrée périmée, déclaration muette, plancher ;
  * la DÉCLARATION elle-même : `--enregistrer` n'adopte jamais un état qui porte
    une mutation déclarée — c'est la porte par laquelle un enregistrement réflexe
    blanchirait ce que le garde existe pour attraper ;
  * la PORTE LOCALE : le garde RÉEL, exécuté sur l'arbre RÉEL, doit sortir en 0,
    et refuser (en le disant) sur un arbre dérivé. C'est ce dernier point qui rend
    une mutation laissée en place incapable de survivre à une suite locale.

Ce qui n'est PAS mesuré ici : le contenu du registre réel (ses empreintes) — un
test qui les recopierait serait une seconde vérité à tenir à jour, et le garde
réel les juge déjà à chaque exécution.
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GARDE = REPO_ROOT / ".github" / "scripts" / "check-etat-reference.py"
REGISTRE = REPO_ROOT / ".github" / "scripts" / "etat-reference.json"
PREUVES = REPO_ROOT / ".github" / "scripts" / "guard-proofs.json"

# Motif d'adoption des fixtures : assez long pour la règle (40 caractères), et il
# dit ce qu'il fait — un placeholder muet serait refusé, c'est le sujet d'un test.
MOTIF = "état de référence des fixtures : le contenu est celui que ce test vient d'écrire"
DATE = "2026-10-16"

# Les fixtures ont deux fichiers : le plancher réel (60) les refuserait tous, et
# ce n'est pas ce qu'ils mesurent. Le plancher est donc injecté à 0 ici, et c'est
# la porte locale qui exerce le plancher RÉEL du garde.
SANS_PLANCHER = 0


@pytest.fixture(scope="module")
def garde():
    """Le garde RÉEL, chargé par chemin : ses règles sont exécutées, jamais
    recopiées (même choix que la preuve de la sonde email)."""
    spec = importlib.util.spec_from_file_location("check_etat_reference", GARDE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _ecrire(chemin, contenu):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(contenu, encoding="utf-8")


class Arbre:
    """Un dépôt minimal : des cibles de mutation, un registre des preuves, un
    registre d'état de référence. Rien ici ne touche le dépôt réel."""

    def __init__(self, garde, racine, cibles=("a/guard-a.js", "b/guard-b.py"),
                 surfaces=(), motif=MOTIF, date=DATE, referencer=True):
        self.garde = garde
        self.racine = racine
        self.cibles = list(cibles)
        for cible in self.cibles:
            _ecrire(racine / cible, "contenu de %s\n" % cible)
        spec = {
            "gardes": [
                {"chemin": cible, "role": "garde", "invoque_par": "test"}
                for cible in self.cibles
            ],
            "mutations": [
                {
                    "id": "fixture:%s" % cible,
                    # trouve/remplace sont l'ancre de la mutation DÉCLARÉE : c'est
                    # elle qui permet au garde de nommer une mutation en place.
                    "trouve": "contenu de %s\n" % cible,
                    "remplace": "NEUTRALISE\n",
                    "garde": cible,
                    "cible": cible,
                }
                for cible in self.cibles
            ],
            "rejeux": [{"nom": "runner-python", "runner": "python"}],
        }
        self.chemin_preuves = racine / ".github" / "scripts" / "guard-proofs.json"
        _ecrire(self.chemin_preuves, json.dumps(spec, ensure_ascii=False, indent=1))
        self.chemin_registre = racine / ".github" / "scripts" / "etat-reference.json"
        registre = {
            "doc": ["fixture : les règles du registre tiennent en une ligne"],
            "reference": {"etablie_le": date, "motif": motif, "fichiers": {}},
            "hors_perimetre": list(surfaces),
        }
        _ecrire(self.chemin_registre, json.dumps(registre, ensure_ascii=False, indent=1))
        if referencer:
            refus, registre = self.enregistrer()
            assert refus == [], refus

    def charger(self):
        return (
            json.loads(self.chemin_registre.read_text(encoding="utf-8")),
            json.loads(self.chemin_preuves.read_text(encoding="utf-8")),
        )

    def ecrire(self, chemin, contenu):
        _ecrire(self.racine / chemin, contenu)

    def juger(self, plancher=SANS_PLANCHER):
        registre, preuves = self.charger()
        refus, lues, _cibles = self.garde.juger(
            registre, preuves, racine=self.racine, plancher=plancher
        )
        return refus, lues

    def enregistrer(self, motif=MOTIF, chemins=()):
        """Le geste de DÉCLARATION, écrit comme le fait le CLI : la fonction
        rend le registre adopté, le CLI l'écrit — les deux moitiés vivent ici
        pour que les fixtures se comportent comme l'outil réel."""
        registre, preuves = self.charger()
        refus, nouveau = self.garde.enregistrer(
            registre, preuves, motif, chemins, racine=self.racine, aujourd_hui=DATE
        )
        if not refus:
            self.garde.ecrire_registre(self.chemin_registre, nouveau)
        return refus, nouveau


@pytest.fixture
def arbre(garde, tmp_path):
    return Arbre(garde, tmp_path)


def surface(chemin, motif=MOTIF, remede="rien à faire : la fixture le déclare", date=DATE):
    return {"chemin": chemin, "motif": motif, "remede": remede, "date": date}


class TestPerimetre:
    """Le périmètre n'est pas recopié : il se DÉRIVE des mutations déclarées."""

    def test_le_perimetre_se_derive_des_mutations_declarees(self, garde, arbre):
        _registre, preuves = arbre.charger()

        assert garde.cibles_mutees(preuves) == sorted(arbre.cibles)
        assert garde.perimetre(preuves, [], arbre.racine) == sorted(arbre.cibles)

    def test_la_machinerie_declaree_est_exclue_du_perimetre(self, garde, arbre):
        _registre, preuves = arbre.charger()
        surfaces = [surface(arbre.cibles[0])]

        assert garde.perimetre(preuves, surfaces, arbre.racine) == [arbre.cibles[1]]
        # Exclue donc non jugée… mais sa cible reste DÉCLARÉE : l'exclusion ne
        # doit pas passer pour périmée (défaut mesuré à la pose de ce garde).
        assert garde.surfaces_perimees({"hors_perimetre": surfaces},
                                       garde.cibles_mutees(preuves), arbre.racine) == []

    def test_un_perimetre_sans_mutation_est_refuse(self, garde, arbre):
        with pytest.raises(garde.PerimetreIntrouvable):
            garde.cibles_mutees({"mutations": []})

    def test_une_cible_absente_de_la_reference_est_refusee(self, garde, arbre):
        registre, preuves = arbre.charger()
        registre["reference"]["fichiers"].pop(arbre.cibles[1])

        refus, _lues, _cibles = garde.juger(
            registre, preuves, racine=arbre.racine, plancher=SANS_PLANCHER
        )

        assert len(refus) == 1
        assert "surface NON déclarée" in refus[0]
        assert arbre.cibles[1] in refus[0]

    def test_une_entree_qui_ne_vise_plus_aucune_mutation_est_perimee(self, garde, arbre):
        registre, preuves = arbre.charger()
        registre["reference"]["fichiers"]["orphelin/plus-mute.js"] = "0" * 64
        arbre.ecrire("orphelin/plus-mute.js", "contenu orphelin\n")

        refus, _lues, _cibles = garde.juger(
            registre, preuves, racine=arbre.racine, plancher=SANS_PLANCHER
        )

        assert any("PÉRIMÉE" in ligne and "orphelin/plus-mute.js" in ligne for ligne in refus)


class TestDerive:
    """Un écart à la référence est refusé, nommé, et son remède est écrit."""

    def test_un_fichier_a_sa_reference_est_accepte(self, arbre):
        refus, lues = arbre.juger()

        assert refus == []
        assert lues == len(arbre.cibles)

    def test_une_derive_non_declaree_est_refusee_et_nommee(self, arbre):
        arbre.ecrire(arbre.cibles[0], "contenu modifié sans le dire\n")

        refus, _lues = arbre.juger()

        assert len(refus) == 1
        assert "DÉRIVE NON DÉCLARÉE" in refus[0]
        assert arbre.cibles[0] in refus[0]
        # Le refus nomme le REMÈDE : une dérive volontaire se déclare, sinon on
        # chercherait le geste à faire.
        assert "--enregistrer" in refus[0]

    def test_une_mutation_en_place_est_nommee(self, arbre):
        arbre.ecrire(arbre.cibles[0], "NEUTRALISE\n")

        refus, _lues = arbre.juger()

        assert len(refus) == 1
        assert "MUTATION ENCORE EN PLACE" in refus[0]
        assert "fixture:%s" % arbre.cibles[0] in refus[0]
        assert "git checkout" in refus[0]

    def test_un_fichier_de_reference_disparu_est_refuse(self, arbre):
        (arbre.racine / arbre.cibles[1]).unlink()

        refus, lues = arbre.juger()

        assert any("DISPARU" in ligne and arbre.cibles[1] in ligne for ligne in refus)
        assert lues == len(arbre.cibles) - 1

    def test_une_empreinte_qui_n_en_est_pas_une_est_refusee(self, garde, arbre):
        registre, preuves = arbre.charger()
        registre["reference"]["fichiers"][arbre.cibles[0]] = "pas-une-empreinte"

        refus, lues, _cibles = garde.juger(
            registre, preuves, racine=arbre.racine, plancher=SANS_PLANCHER
        )

        assert any("empreinte illisible" in ligne for ligne in refus)
        # Une empreinte illisible n'est PAS un fichier jugé : la compter ferait
        # croire à une lecture qui n'a pas eu lieu.
        assert lues == len(arbre.cibles) - 1


class TestDeclaration:
    """Une déclaration qui ne dit rien est refusée : motif, date, remède."""

    @staticmethod
    def _refus(garde, arbre, registre):
        preuves = arbre.charger()[1]
        refus, _lues, _cibles = garde.juger(
            registre, preuves, racine=arbre.racine, plancher=SANS_PLANCHER
        )
        return " ".join(refus)

    def test_un_motif_trop_court_est_refuse(self, garde, arbre):
        registre = arbre.charger()[0]
        registre["reference"]["motif"] = "court"

        assert "MUETTE" in self._refus(garde, arbre, registre)

    def test_une_date_illisible_est_refusee(self, garde, arbre):
        registre = arbre.charger()[0]
        registre["reference"]["etablie_le"] = "hier"

        assert "date illisible" in self._refus(garde, arbre, registre)

    def test_une_surface_sans_remede_est_refusee(self, garde, arbre):
        registre = arbre.charger()[0]
        registre["hors_perimetre"] = [surface("fichiers ajoutés", remede="")]

        assert "remede" in self._refus(garde, arbre, registre)

    def test_une_surface_perimee_est_refusee(self, garde, arbre):
        # Un fichier qui existe et n'est la cible d'AUCUNE mutation : cette
        # exclusion ne déclare plus rien, elle est périmée.
        arbre.ecrire("hors/ordinaire.js", "contenu ordinaire\n")
        registre = arbre.charger()[0]
        registre["hors_perimetre"] = [surface("hors/ordinaire.js")]

        assert "PÉRIMÉE" in self._refus(garde, arbre, registre)

    def test_un_champ_inconnu_est_refuse(self, garde, arbre):
        registre = arbre.charger()[0]
        registre["surfaces_aveugles"] = []

        assert "champ(s) inconnu(s)" in self._refus(garde, arbre, registre)


class TestPlancher:
    def test_sous_le_plancher_le_garde_refuse_de_conclure(self, garde, arbre):
        refus, lues, _cibles = garde.juger(
            *arbre.charger(), racine=arbre.racine, plancher=len(arbre.cibles) + 1
        )

        assert lues == len(arbre.cibles)
        assert any("PLANCHER DE LECTURE" in ligne for ligne in refus)


class TestEnregistrer:
    """Le seul geste qui déplace la référence — et ce qu'il refuse."""

    def test_enregistrer_adopte_seulement_les_chemins_nommes(self, garde, arbre):
        avant, _preuves = arbre.charger()
        arbre.ecrire(arbre.cibles[0], "contenu nouveau de a\n")
        arbre.ecrire(arbre.cibles[1], "contenu nouveau de b\n")

        refus, apres = arbre.enregistrer(chemins=[arbre.cibles[0]])

        assert refus == []
        fichiers = apres["reference"]["fichiers"]
        assert fichiers[arbre.cibles[0]] != avant["reference"]["fichiers"][arbre.cibles[0]]
        # L'autre cible garde SON empreinte : ce qui n'a pas été déclaré reste
        # refusé au tour suivant, et c'est voulu.
        assert fichiers[arbre.cibles[1]] == avant["reference"]["fichiers"][arbre.cibles[1]]

    def test_enregistrer_refuse_un_chemin_hors_perimetre(self, arbre):
        refus, _registre = arbre.enregistrer(chemins=["frontend/src/pages/Home.js"])

        assert any("hors périmètre" in ligne for ligne in refus)

    def test_enregistrer_refuse_un_motif_trop_court(self, arbre):
        refus, _registre = arbre.enregistrer(motif="parce que")

        assert any("motif trop court" in ligne for ligne in refus)

    def test_enregistrer_refuse_d_adopter_une_mutation_en_place(self, arbre):
        arbre.ecrire(arbre.cibles[1], "NEUTRALISE\n")

        refus, _registre = arbre.enregistrer()

        assert any("MUTATION EN PLACE" in ligne for ligne in refus)

    def test_enregistrer_elargit_le_perimetre_a_une_nouvelle_cible(self, garde, arbre):
        arbre.ecrire("c/guard-c.js", "contenu de c/guard-c.js\n")
        preuves = arbre.charger()[1]
        preuves["mutations"].append({
            "id": "fixture:c/guard-c.js",
            "trouve": "contenu de c/guard-c.js\n",
            "remplace": "NEUTRALISE\n",
            "garde": "c/guard-c.js",
            "cible": "c/guard-c.js",
        })
        _ecrire(arbre.chemin_preuves, json.dumps(preuves, ensure_ascii=False, indent=1))

        refus, registre = arbre.enregistrer()

        assert refus == []
        assert "c/guard-c.js" in registre["reference"]["fichiers"]
        assert arbre.juger()[0] == []


class TestPorteLocale:
    """Le garde RÉEL, sur l'arbre RÉEL — la raison d'être de ce fichier.

    Un garde qui n'existe que dans une étape de CI laisse survivre une mutation
    laissée en place jusqu'à la poussée, ou pour toujours si rien n'est poussé.
    Ces trois tests passent par le CLI, donc par la porte que la suite locale
    exerce telle quelle.
    """

    @staticmethod
    def _lancer(*arguments, racine=None):
        """(code, sortie) du garde réel, en sous-processus.

        `PYTHONIOENCODING` côté enfant et un décodage tolérant côté parent : la
        règle du dépôt pour les sous-processus Python.
        """
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        proc = subprocess.run(
            [sys.executable, str(GARDE), *arguments],
            cwd=str(racine or REPO_ROOT),
            capture_output=True,
            env=env,
        )
        return proc.returncode, (proc.stdout + proc.stderr).decode("utf-8", "replace")

    def test_le_garde_reel_ne_refuse_rien_sur_l_arbre_reel(self):
        code, sortie = self._lancer()

        assert code == 0, sortie
        assert "à leur état de référence" in sortie

    def test_le_garde_reel_refuse_une_derive_et_le_dit(self, arbre):
        arbre.ecrire(arbre.cibles[0], "contenu modifié sans le dire\n")

        code, sortie = self._lancer(
            "--racine", str(arbre.racine),
            "--registre", str(arbre.chemin_registre),
            "--preuves", str(arbre.chemin_preuves),
        )

        assert code == 1
        assert "DÉRIVE NON DÉCLARÉE" in sortie
        assert "État de référence dérivé" in sortie

    def test_le_garde_reel_refuse_de_conclure_sous_son_plancher(self, arbre):
        """Le plancher RÉEL (60), pas celui des fixtures : deux fichiers jugés ne
        suffisent pas, et le garde le dit au lieu de conclure."""
        code, sortie = self._lancer(
            "--racine", str(arbre.racine),
            "--registre", str(arbre.chemin_registre),
            "--preuves", str(arbre.chemin_preuves),
        )

        assert code == 1
        assert "PLANCHER DE LECTURE" in sortie
