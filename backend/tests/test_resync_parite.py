# -*- coding: utf-8 -*-
"""Le plancher de resync n'est pas plus bavard que le sondage remplacé.

Garde prouvé : `.github/scripts/check-resync-parite.py` (étape de
`workflow-lint`, check requis).

Ce qui est verrouillé ici, et pourquoi chacun compte :

1. LE FAIT — le plancher réel de `backend/kojo_live.py` tient la parité avec le
   seuil du sondage remplacé, lui-même LU dans
   `.github/scripts/check-fly-env-drift.py`. Aucune des deux valeurs n'est
   écrite dans ce fichier de test : le jour où le seuil bouge (parce que le
   sondage remplacé change), le verdict doit suivre — sinon deux contrats
   divergeraient en silence, ce qui est exactement l'incident du 18/10/2026
   côté battement de cœur.
2. LE REFUS — un plancher SOUS la parité est refusé en nommant les deux
   valeurs et le remède. C'est le cas mesuré à la pose : 10 s contre 30 s,
   trois fois plus bavard que le mécanisme remplacé.
3. LE SEUIL EST LU, PAS RECOPIÉ — le MÊME plancher (30 s) passe ou rougit
   selon le seul seuil de la sonde : 20 s → vert, 120 s → rouge. Un garde qui
   aurait `30000` en dur resterait vert dans les deux cas, et ce test-là est la
   preuve du contraire.
4. LE LECTEUR REFUSE DE CONCLURE — seuil introuvable ou déclaré deux fois,
   plancher déclaré deux fois ou nul, plancher que la borne ne consomme pas,
   fichier tronqué : chacun rend 1, jamais un vert muet.

La règle est PURE (`juger`) : l'horloge et les chemins n'y entrent pas, donc
ces cas s'écrivent sans dépôt réécrit et sans attente.
"""
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
RACINE = BACKEND_DIR.parent
SCRIPT = RACINE / ".github" / "scripts" / "check-resync-parite.py"


def _charger():
    """Charge le garde par chemin (son nom porte un tiret, pas un module Python)."""
    spec = importlib.util.spec_from_file_location("check_resync_parite", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def garde():
    return _charger()


def _lire(chemin):
    # Mode brut : même convention que le garde, et `read_text(newline=…)` n'existe
    # pas sur Python 3.11 (la CI), seulement sur le poste local.
    with open(chemin, "r", encoding="utf-8", newline="") as fichier:
        return fichier.read()


# ── Des textes SYNTHÉTIQUES, pour déplacer une valeur sans toucher au dépôt ──

def _live(valeur="30.0", borne=True):
    """Un module minimal : la déclaration, et la borne qui la consomme."""
    lignes = [
        "# Module de test : plancher de resync.",
        "%s = %s" % (garde_constante(), valeur),
    ]
    if borne:
        lignes += ["", "if ecoule < %s:" % garde_constante(), "    pass", ""]
    return "\n".join(lignes) + "\n" * 40


def garde_constante():
    return "RESYNC_MIN_INTERVAL_SECONDS"


def _sonde(seuil_ms=30000.0, declarations=1):
    """Une sonde minimale : le seuil du sondage remplacé, déclaré N fois."""
    lignes = ["# Sonde de test : seuil du sondage remplacé."]
    lignes += ["ANCIEN_SONDAGE_MS = %r" % float(seuil_ms) for _ in range(declarations)]
    return "\n".join(lignes) + "\n" * 40


def _bourrer(texte, plancher):
    """Complète un texte synthétique au-delà du plancher de LECTURE du garde.

    Les cas de règle passent des planchers réduits ; le CLI, lui, lit avec ceux
    de la production. Sans ce bourrage, le rouge viendrait de « fichier
    TRONQUÉ » et ne prouverait rien de la parité — un cas qui passe pour la
    mauvaise raison est un faux vert qui s'ignore.
    """
    if len(texte) >= plancher:
        return texte
    return texte + ("# ligne de remplissage\n" * ((plancher - len(texte)) // 22 + 1))


class TestLeFait:
    def test_le_plancher_reel_tient_la_parite(self, garde):
        code, lignes = garde.juger(
            _lire(garde.LIVE_FILE), _lire(garde.SONDE_FILE)
        )
        assert code == 0, lignes
        assert any("[OK]" in ligne for ligne in lignes), lignes

    def test_le_verdict_publie_les_deux_valeurs_lues(self, garde):
        """Un vert muet serait un vert sans mesure : les deux valeurs sortent."""
        code, lignes = garde.juger(
            _lire(garde.LIVE_FILE), _lire(garde.SONDE_FILE)
        )
        assert code == 0, lignes
        plancher = garde.declaration(_lire(garde.LIVE_FILE), garde.RESYNC_CONSTANTE)[0][0]
        seuil = garde.declaration(_lire(garde.SONDE_FILE), garde.SEUIL_CONSTANTE)[0][0]
        sortie = "\n".join(lignes)
        assert "%g s" % plancher in sortie, sortie
        assert "%g ms" % seuil in sortie, sortie
        # Ce que le fait DIT : le plancher n'est pas plus bavard que le sondage.
        assert plancher * 1000.0 >= seuil, (plancher, seuil)


class TestLeRefus:
    def test_un_plancher_sous_la_parite_est_refuse(self, garde):
        code, lignes = garde.juger(_live("10.0"), _sonde(30000.0), 100, 100)
        assert code == 1, lignes
        sortie = "\n".join(lignes)
        assert "SOUS la parité" in sortie, sortie
        assert "10 s" in sortie and "30000 ms" in sortie, sortie
        assert "RESYNC_MIN_INTERVAL_SECONDS" in sortie, sortie

    def test_un_plancher_nul_ne_borne_rien(self, garde):
        code, lignes = garde.juger(_live("0.0"), _sonde(30000.0), 100, 100)
        assert code == 1, lignes
        assert "nul ou négatif" in "\n".join(lignes)

    def test_une_borne_qui_ne_consomme_pas_le_plancher_est_refusee(self, garde):
        """Déclarer le plancher ne suffit pas : la comparaison doit le LIRE."""
        code, lignes = garde.juger(_live("30.0", borne=False), _sonde(30000.0), 100, 100)
        assert code == 1, lignes
        assert "AUCUNE borne ne le consomme" in "\n".join(lignes)

    def test_un_plancher_declare_deux_fois_est_refuse(self, garde):
        texte = _live("30.0") + "\nRESYNC_MIN_INTERVAL_SECONDS = 5.0\n"
        code, lignes = garde.juger(texte, _sonde(30000.0), 100, 100)
        assert code == 1, lignes
        assert "DÉCLARÉ 2 FOIS" in "\n".join(lignes)


class TestLeSeuilEstLuPasRecopie:
    """Le MÊME plancher passe ou rougit selon le seul seuil de la sonde."""

    @pytest.mark.parametrize(
        "seuil_ms, attendu",
        [(20000.0, 0), (30000.0, 0), (30001.0, 1), (120000.0, 1)],
    )
    def test_le_verdict_suit_le_seuil_de_la_sonde(self, garde, seuil_ms, attendu):
        code, lignes = garde.juger(_live("30.0"), _sonde(seuil_ms), 100, 100)
        assert code == attendu, (seuil_ms, lignes)

    def test_aucun_seuil_n_est_ecrit_dans_le_garde(self, garde):
        """30000 en dur serait un SECOND seuil : le garde doit le lire."""
        source = _lire(SCRIPT)
        assert "30000" not in source and "30_000" not in source, (
            "le garde porte un seuil de temps en dur : il le RECOPIE au lieu de "
            "le lire dans %s" % garde.SONDE_FILE.name
        )


class TestLeLecteurRefuseDeConclure:
    def test_un_seuil_introuvable_est_un_refus(self, garde):
        code, lignes = garde.juger(_live("30.0"), "# aucune déclaration\n" * 40, 100, 100)
        assert code == 1, lignes
        assert "n'a pas été trouvé" in "\n".join(lignes)

    def test_un_seuil_declare_deux_fois_est_un_refus(self, garde):
        code, lignes = garde.juger(_live("30.0"), _sonde(30000.0, declarations=2), 100, 100)
        assert code == 1, lignes
        assert "DÉCLARÉ 2 FOIS" in "\n".join(lignes)

    @pytest.mark.parametrize("cote", ["live", "sonde"])
    def test_un_fichier_tronque_est_un_refus(self, garde, cote):
        texte = _live("30.0") if cote == "live" else _sonde(30000.0)
        if cote == "live":
            code, lignes = garde.juger("x", texte, 100, 100)
        else:
            code, lignes = garde.juger(texte, "x", 100, 100)
        assert code == 1, lignes
        assert "TRONQUÉ" in "\n".join(lignes)


class TestCLI:
    def test_le_depot_reel_rend_0(self, garde):
        assert garde.main([]) == 0

    def test_un_fichier_absent_rend_1(self, garde, tmp_path):
        manquant = tmp_path / "absent.py"
        assert garde.main(["--live", str(manquant)]) == 1

    def test_un_ecart_rend_1_par_le_CLI(self, garde, tmp_path):
        """Le verdict est porté par la SORTIE du script, pas seulement par la règle."""
        live = tmp_path / "live.py"
        sonde = tmp_path / "sonde.py"
        # Bourrés au-delà des planchers de PRODUCTION : le rouge doit venir de la
        # parité, pas d'un fichier trop court.
        live.write_text(
            _bourrer(_live("5.0"), garde.PLANCHER_LIVE), encoding="utf-8", newline=""
        )
        sonde.write_text(
            _bourrer(_sonde(30000.0), garde.PLANCHER_SONDE),
            encoding="utf-8",
            newline="",
        )
        assert garde.main(["--live", str(live), "--sonde", str(sonde)]) == 1

    def test_la_parite_rend_0_par_le_CLI(self, garde, tmp_path):
        """Le pendant du cas ci-dessus : le même CLI sait dire oui."""
        live = tmp_path / "live.py"
        sonde = tmp_path / "sonde.py"
        live.write_text(
            _bourrer(_live("30.0"), garde.PLANCHER_LIVE), encoding="utf-8", newline=""
        )
        sonde.write_text(
            _bourrer(_sonde(30000.0), garde.PLANCHER_SONDE),
            encoding="utf-8",
            newline="",
        )
        assert garde.main(["--live", str(live), "--sonde", str(sonde)]) == 0
