# -*- coding: utf-8 -*-
"""Régression : le garde des bits exécutables (check-exec-bits.py).

Le job `mobile-build` exécute `./gradlew assembleDebug`. Le bit exécutable de
`gradlew` est porté par git (mode 100755), pas par un poste de travail : c'est
le checkout du runner qui le matérialise. Sans ce garde, une perte du mode ne se
voit qu'après plusieurs minutes d'installation (Node, Java 21, SDK Android) et
se manifeste par un « Permission denied » qui ne désigne pas la cause.

Ce test verrouille les trois pannes que le script doit distinguer :

- mode git perdu (100644) → message avec la commande de réparation ;
- mode git correct mais bit absent après checkout → message distinct (c'est le
  checkout qui est en cause, pas le dépôt) ;
- shebang absent ou terminé par un CR (CRLF) → échec même avec le bit.

Il verrouille aussi deux exigences de sûreté : un fichier NON SUIVI et un git
INDISPONIBLE doivent faire ÉCHOUER le garde, jamais le faire passer en silence.
Enfin, il vérifie que le `gradlew` du dépôt réel est bien conforme : c'est la
non-régression qui protège le job mobile.
"""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SCRIPT = REPO_ROOT / ".github" / "scripts" / "check-exec-bits.py"

GRADLEW = "frontend/android/gradlew"


def _load_check():
    """Charge check-exec-bits.py comme module importable (script stdlib)."""
    spec = importlib.util.spec_from_file_location("check_exec_bits", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def check():
    return _load_check()


def _git(repo, *args):
    """Exécute une commande git dans un dépôt de test (jamais sur le vrai dépôt)."""
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def _repo_with_gradlew(tmp_path, content=b"#!/bin/sh\necho ok\n", mode=None):
    """Crée un dépôt git minimal contenant frontend/android/gradlew.

    ``mode`` fait varier le mode ENREGISTRÉ DANS GIT : None (ce que `git add`
    décide), "100755" (bit posé dans l'index) ou "100644" (bit retiré).

    Le fichier sur disque est toujours posé à 0755, comme le fait un vrai
    checkout quand l'index dit 100755. Deux échecs vus en CI (Linux) venaient de
    là : avec un fichier en 0644 et un index en 100755, `git rm --cached` refuse
    d'agir — « staged content different from both the file and the HEAD » — et la
    sonde d'exécutabilité du garde échoue, à juste titre, au lieu de tester ce
    que le cas visait. Windows ne pouvait pas le montrer : son système de
    fichiers n'a pas de bit exécutable, donc le mode du disque y est toujours
    « exécutable » pour Python.
    """
    repo = tmp_path / "depot"
    target = repo / "frontend" / "android" / "gradlew"
    target.parent.mkdir(parents=True)
    target.write_bytes(content)
    os.chmod(target, 0o755)
    _git(repo.parent, "init", "-q", str(repo))
    _git(repo, "add", GRADLEW)
    if mode == "100755":
        _git(repo, "update-index", "--chmod=+x", GRADLEW)
    elif mode == "100644":
        _git(repo, "update-index", "--chmod=-x", GRADLEW)
    return repo, target


def _always_executable(_path):
    return True


def _never_executable(_path):
    return False


class TestDepotReel:
    def test_gradlew_du_depot_est_executable(self, check):
        """Non-régression : le vrai gradlew doit passer le garde tel quel."""
        errors, info = check.check_path(REPO_ROOT, GRADLEW)
        assert not errors, errors
        assert "mode git 100755" in info

    def test_mode_reel_dans_l_index(self, check):
        """Le mode est bien dans l'INDEX (pas seulement sur le disque)."""
        mode, error = check.git_index_mode(REPO_ROOT, GRADLEW)
        assert error is None
        assert mode == check.EXECUTABLE_MODE

    # Le passage du garde sur le dépôt réel n'est pas rejoué ici : l'étape
    # « Check executable bits (gradlew) » du job APK le fait à chaque push.

    def test_le_workflow_invoque_le_gradlew_directement(self, check):
        """Si le workflow appelait `sh gradlew`, ce garde perdrait son objet."""
        workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        assert "./gradlew assembleDebug" in workflow, (
            "le step APK n'invoque plus ./gradlew directement : REQUIRED_EXECUTABLE "
            "et ce test doivent être revus"
        )


class TestModeGit:
    def test_mode_100644_est_signale_avec_la_reparation(self, check, tmp_path):
        repo, _ = _repo_with_gradlew(tmp_path, mode="100644")
        errors, info = check.check_path(repo, GRADLEW)
        assert info is None
        assert any("au lieu de 100755" in e for e in errors), errors
        assert any("update-index --chmod=+x" in e for e in errors), errors

    @pytest.mark.skipif(
        os.name != "nt",
        reason="Comportement propre a NTFS : sur POSIX, `git add` enregistre "
        "100755 des que le fichier est executable, donc il n'y a rien a signaler. "
        "Ce cas documente la perte de mode typique d'un commit fait sous Windows.",
    )
    def test_mode_par_defaut_non_executable_est_signale(self, check, tmp_path):
        """Sous Windows, `git add` enregistre 100644 : le garde doit refuser."""
        repo, _ = _repo_with_gradlew(tmp_path)
        errors, _ = check.check_path(repo, GRADLEW)
        assert any("100755" in e for e in errors), errors

    def test_fichier_non_suivi_par_git_est_signale(self, check, tmp_path):
        repo, target = _repo_with_gradlew(tmp_path, mode="100755")
        # -f : sans lui, git refuse si l'index et le fichier ont divergé (cas vu
        # en CI sur un runner Linux).
        _git(repo, "rm", "--cached", "-q", "-f", GRADLEW)
        assert target.exists(), "le fichier reste sur le disque, seul l'index change"
        errors, _ = check.check_path(repo, GRADLEW)
        assert any("n'est pas suivi par git" in e for e in errors), errors

    def test_git_indisponible_ne_passe_pas_en_silence(self, check):
        """Un garde qui ne peut pas conclure doit échouer, pas rassurer."""

        def run_absent(*_args, **_kwargs):
            raise FileNotFoundError("git")

        errors, _ = check.check_path(REPO_ROOT, GRADLEW, run=run_absent)
        assert any("introuvable" in e for e in errors), errors

    def test_git_en_erreur_ne_passe_pas_en_silence(self, check):
        class _Proc:
            returncode = 128
            stdout = ""
            stderr = "fatal: not a git repository\n"

        errors, _ = check.check_path(REPO_ROOT, GRADLEW, run=lambda *a, **k: _Proc())
        assert any("git ls-files a échoué" in e for e in errors), errors


class TestBitApresCheckout:
    def test_mode_correct_mais_bit_absent_apres_checkout(self, check, tmp_path):
        """Le cas symétrique : le dépôt est sain, le poste d'exécution non."""
        repo, _ = _repo_with_gradlew(tmp_path, mode="100755")
        errors, _ = check.check_path(repo, GRADLEW, is_executable=_never_executable)
        assert len(errors) == 1, errors
        assert "après le checkout" in errors[0]
        assert "100755" in errors[0], "le message doit disculper le dépôt (mode correct)"

    def test_mode_perdu_et_bit_absent_cumulent_les_deux_causes(self, check, tmp_path):
        repo, _ = _repo_with_gradlew(tmp_path, mode="100644")
        errors, _ = check.check_path(repo, GRADLEW, is_executable=_never_executable)
        assert len(errors) == 2, errors

    def test_fichier_absent_est_signale(self, check, tmp_path):
        repo, target = _repo_with_gradlew(tmp_path, mode="100755")
        target.unlink()
        errors, _ = check.check_path(repo, GRADLEW)
        assert errors == [f"{GRADLEW} est absent du dépôt"], errors


class TestShebang:
    def test_shebang_le_rend_exploitable(self, check, tmp_path):
        repo, _ = _repo_with_gradlew(tmp_path, mode="100755", content=b"#!/bin/sh\necho ok\n")
        errors, info = check.check_path(repo, GRADLEW, is_executable=_always_executable)
        assert not errors, errors
        assert "shebang exploitable" in info

    def test_shebang_crlf_est_signale_meme_avec_le_bit(self, check, tmp_path):
        """CRLF + bit posé = « bad interpreter » : le piège le plus vicieux."""
        repo, _ = _repo_with_gradlew(
            tmp_path, mode="100755", content=b"#!/bin/sh\r\necho ok\r\n"
        )
        errors, _ = check.check_path(repo, GRADLEW, is_executable=_always_executable)
        assert len(errors) == 1, errors
        assert "CR" in errors[0] and "CRLF" in errors[0]
        assert "eol=lf" in errors[0], "le message doit pointer la règle à conserver"

    def test_shebang_absent_est_signale(self, check, tmp_path):
        repo, _ = _repo_with_gradlew(tmp_path, mode="100755", content=b"echo ok\n")
        errors, _ = check.check_path(repo, GRADLEW, is_executable=_always_executable)
        assert any("shebang" in e for e in errors), errors

    def test_lecture_brute_detecte_le_cr_seul(self, check):
        """Le contrôle porte sur les OCTETS : un « \r » isolé suffit."""
        assert check.shebang_error(b"#!/bin/sh\n") is None
        assert "CR" in check.shebang_error(b"#!/bin/sh\r\n")


class TestLigneDeCommande:
    def test_main_retourne_1_et_annote_le_fichier(self, check, tmp_path, capsys):
        repo, _ = _repo_with_gradlew(tmp_path, mode="100644")
        assert check.main(["--repo-root", str(repo)]) == 1
        captured = capsys.readouterr()
        assert f"::error file={GRADLEW}::" in captured.err
        assert "Permission denied" in captured.err

    def test_main_injecte_la_racine(self, check, tmp_path, capsys):
        """--repo-root doit réellement déplacer la vérification."""
        repo, _ = _repo_with_gradlew(tmp_path, mode="100755")
        capsys.readouterr()
        assert check.main(["--repo-root", str(repo)]) == 0
        assert str(repo) in capsys.readouterr().out


class TestSortieNonUtf8:
    """Le garde doit CONCLURE, pas planter, quelle que soit la console.

    Régression réelle : le chemin de succès se terminait par un emoji, absent de
    cp1252 → `UnicodeEncodeError` et code de sortie 1, indistinguable d'un échec
    de vérification. pytest ne pouvait pas le voir : il capture la sortie sans
    encodeur de console. D'où ces deux tests en SOUS-PROCESSUS, avec un encodage
    de sortie hostile.
    """

    @staticmethod
    def _run(repo_root):
        env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--repo-root", str(repo_root)],
            capture_output=True,
            env=env,
        )

    def test_succes_sous_console_cp1252(self):
        proc = self._run(REPO_ROOT)
        sortie = (proc.stdout + proc.stderr).decode("utf-8", "replace")
        assert proc.returncode == 0, sortie
        assert "UnicodeEncodeError" not in sortie
        assert "[OK]" in sortie

    def test_echec_reel_sous_console_cp1252(self, tmp_path):
        """Le pire cas serait un échec transformé en plantage : code 1 quand même,
        mais message d'annotation perdu."""
        repo, _ = _repo_with_gradlew(tmp_path, mode="100644")
        proc = self._run(repo)
        sortie = (proc.stdout + proc.stderr).decode("utf-8", "replace")
        assert proc.returncode == 1, sortie
        assert "UnicodeEncodeError" not in sortie
        assert f"::error file={GRADLEW}::" in sortie
