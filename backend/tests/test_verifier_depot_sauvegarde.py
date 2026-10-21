# -*- coding: utf-8 -*-
"""Relecture du dépôt de sauvegarde : ce que l'outil PROUVE, et ce qu'il refuse.

Le 21/10/2026, la preuve que l'objet déposé se relit a été faite à la main :
retéléchargement, empreinte identique, `openssl enc -d`, `gzip -t`. Une preuve
faite une fois n'est pas une preuve quotidienne, donc elle devient une étape du
workflow — et une étape qu'on peut croire ne vaut que si ses refus sont éprouvés.

Chaque cas ici juge le VERDICT (code + message) sur un vrai chiffrement openssl :
l'empreinte qui ne correspond plus, la phrase secrète qui n'ouvre pas, le clair
qui n'est pas gzip, le flux tronqué, et la relecture qui lit le fichier qu'on
vient d'envoyer (la prémisse qui rendrait la preuve vide).
"""
import gzip
import hashlib
import io
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "backend" / "scripts"))

import verifier_depot_sauvegarde as relecture  # noqa: E402

WORKFLOW = RACINE / ".github" / "workflows" / "backup-db.yml"

PHRASE = "phrase-de-test-qui-n-aucune-valeur"
AUTRE_PHRASE = "phrase-qui-n-ouvre-rien-du-tout"

openssl_absent = shutil.which("openssl") is None
sans_openssl = pytest.mark.skipif(
    openssl_absent, reason="openssl absent de ce poste : la moitié chiffrement n'est pas exerçable"
)


def _gzip(contenu: bytes) -> bytes:
    tampon = io.BytesIO()
    with gzip.GzipFile(fileobj=tampon, mode="wb", mtime=0) as flux:
        flux.write(contenu)
    return tampon.getvalue()


def _chiffrer(chemin_clair: Path, chemin_chiffre: Path, phrase: str = PHRASE) -> None:
    subprocess.run(
        [
            shutil.which("openssl"), "enc", "-aes-256-cbc", "-pbkdf2", "-salt",
            "-in", str(chemin_clair), "-out", str(chemin_chiffre),
            "-pass", "env:BACKUP_PASSPHRASE",
        ],
        env=dict(os.environ, BACKUP_PASSPHRASE=phrase),
        check=True,
        capture_output=True,
    )


def _sha256(chemin: Path) -> str:
    return hashlib.sha256(chemin.read_bytes()).hexdigest()


def _deposer(tmp_path: Path, clair: bytes, phrase: str = PHRASE) -> tuple[Path, str]:
    """Fabrique l'archive locale, la chiffre, et rend `(objet chiffré, empreinte)`."""
    archive = tmp_path / "kojo.archive"
    archive.write_bytes(clair)
    objet = tmp_path / "kojo.archive.enc"
    _chiffrer(archive, objet, phrase)
    return objet, _sha256(objet)


def _relire(monkeypatch, fichier: Path, empreinte: str, envoye: Path | None = None, phrase: str | None = PHRASE):
    if phrase is None:
        monkeypatch.delenv("BACKUP_PASSPHRASE", raising=False)
    else:
        monkeypatch.setenv("BACKUP_PASSPHRASE", phrase)
    arguments = ["--fichier", str(fichier), "--empreinte", empreinte]
    if envoye is not None:
        arguments += ["--envoye", str(envoye)]
    return relecture.main(arguments)


class TestLeDepotSeRelit:
    @sans_openssl
    def test_empreinte_dechiffrement_et_flux_gzip_prouves(self, tmp_path, monkeypatch, capsys):
        contenu = b"\x00" * 4096 + b"documents de kojo"
        objet, empreinte = _deposer(tmp_path, _gzip(contenu))
        # La « copie retéléchargée » est un AUTRE fichier : c'est ce que fait
        # `aws s3 cp` dans le workflow, et c'est ce que l'outil exige.
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes())

        code = _relire(monkeypatch, copie, empreinte, envoye=objet)
        sortie = capsys.readouterr().out

        assert code == 0, sortie
        assert "[OK] empreinte du dépôt identique" in sortie
        assert "flux gzip valide" in sortie
        assert str(len(contenu)) in sortie


class TestCeQuiEstRefuse:
    @sans_openssl
    def test_une_empreinte_differente_est_un_fait_faux_nomme(self, tmp_path, monkeypatch, capsys):
        objet, _ = _deposer(tmp_path, _gzip(b"archive du jour"))
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes() + b"\x00")

        code = _relire(monkeypatch, copie, _sha256(objet))
        sortie = capsys.readouterr().out

        assert code == 1, sortie
        assert "empreinte du dépôt DIFFÉRENTE" in sortie
        assert "::error title=Dépôt de sauvegarde non prouvé::" in sortie

    @sans_openssl
    def test_une_phrase_secrete_qui_n_ouvre_pas_est_refusee(self, tmp_path, monkeypatch, capsys):
        objet, empreinte = _deposer(tmp_path, _gzip(b"archive du jour"))
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes())

        code = _relire(monkeypatch, copie, empreinte, phrase=AUTRE_PHRASE)
        sortie = capsys.readouterr().out

        assert code == 1, sortie
        # Les DEUX formes du refus sont admises, et c'est mesuré : un mauvais mot
        # de passe en AES-CBC lève une erreur de padding la plupart du temps,
        # mais pas toujours (≈ 1 fois sur 256) — dans ce cas openssl rend des
        # octets quelconques et le refus devient « ce n'est pas du gzip ». Le
        # verdict est le même, et le message doit nommer la phrase secrète dans
        # les deux cas, sinon le rouge n'aide personne.
        assert "phrase secrète" in sortie, sortie
        # L'empreinte, elle, est bonne : le refus porte bien sur la phrase.
        assert "[OK] empreinte du dépôt identique" in sortie

    @sans_openssl
    def test_un_clair_qui_n_est_pas_gzip_est_refuse(self, tmp_path, monkeypatch, capsys):
        objet, empreinte = _deposer(tmp_path, b"ceci n'est pas une archive de mongodump")
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes())

        code = _relire(monkeypatch, copie, empreinte)
        sortie = capsys.readouterr().out

        assert code == 1, sortie
        assert "n'est pas un flux gzip" in sortie

    @sans_openssl
    def test_un_flux_gzip_tronque_est_refuse(self, tmp_path, monkeypatch, capsys):
        """Un flux qui COMMENCE bien et s'arrête : le cas que l'en-tête seul
        laisserait passer."""
        complet = _gzip(b"documents" * 2048)
        objet, empreinte = _deposer(tmp_path, complet[:-64])
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes())

        code = _relire(monkeypatch, copie, empreinte)
        sortie = capsys.readouterr().out

        assert code == 1, sortie
        assert "INCOMPLET" in sortie and "tronqu" in sortie


class TestLesPremisses:
    def test_relire_le_fichier_qu_on_vient_d_envoyer_ne_prouve_rien(self, tmp_path, monkeypatch, capsys):
        objet = tmp_path / "kojo.archive.enc"
        objet.write_bytes(b"peu importe")
        monkeypatch.setenv("BACKUP_PASSPHRASE", PHRASE)

        code = relecture.main(
            ["--fichier", str(objet), "--empreinte", "a" * 64, "--envoye", str(objet)]
        )
        capture = capsys.readouterr()

        assert code == 2, capture.err
        assert "ne prouve pas le dépôt" in capture.err
        # Rien n'a été jugé : aucun verdict « OK » ne doit sortir.
        assert "[OK]" not in capture.out

    def test_sans_fichier_rien_n_est_juge(self, tmp_path, monkeypatch, capsys):
        monkeypatch.setenv("BACKUP_PASSPHRASE", PHRASE)
        code = relecture.main(
            ["--fichier", str(tmp_path / "absent.enc"), "--empreinte", "a" * 64]
        )
        assert code == 2
        assert "[PREMISSE]" in capsys.readouterr().err

    def test_un_objet_de_zero_octet_est_une_premisse(self, tmp_path, monkeypatch, capsys):
        objet = tmp_path / "vide.enc"
        objet.write_bytes(b"")
        monkeypatch.setenv("BACKUP_PASSPHRASE", PHRASE)
        code = relecture.main(["--fichier", str(objet), "--empreinte", "a" * 64])
        assert code == 2
        assert "0 octet" in capsys.readouterr().err

    def test_une_empreinte_mal_formee_est_une_premisse(self, tmp_path, monkeypatch, capsys):
        objet = tmp_path / "objet.enc"
        objet.write_bytes(b"des octets")
        monkeypatch.setenv("BACKUP_PASSPHRASE", PHRASE)
        code = relecture.main(
            ["--fichier", str(objet), "--empreinte", "pas-une-empreinte"]
        )
        assert code == 2
        assert "SHA-256" in capsys.readouterr().err

    @sans_openssl
    def test_sans_phrase_secrete_l_empreinte_est_publiee_et_le_reste_est_une_premisse(
        self, tmp_path, monkeypatch, capsys
    ):
        objet, empreinte = _deposer(tmp_path, _gzip(b"archive"))
        copie = tmp_path / "relecture.enc"
        copie.write_bytes(objet.read_bytes())

        code = _relire(monkeypatch, copie, empreinte, phrase=None)
        capture = capsys.readouterr()

        assert code == 2, capture.out
        # La moitié qui se mesure se publie : l'empreinte est un fait, même si
        # le déchiffrement ne peut pas être jugé. Un 2 muet ferait lire « on ne
        # sait rien » là où un fait était mesuré.
        assert "[OK] empreinte du dépôt identique" in capture.out
        assert "BACKUP_PASSPHRASE" in capture.err


class TestLeWorkflowRelitLeDepot:
    """Le contrat du workflow : une étape qui existe, qui vient APRÈS le dépôt,
    qui lit la clé écrite par ce dépôt, et qui peut échouer."""

    @pytest.fixture()
    def texte(self):
        return WORKFLOW.read_text(encoding="utf-8")

    def test_la_relecture_vient_apres_le_depot_et_appelle_l_outil(self, texte):
        depot = texte.index("Déposer l'archive chiffrée")
        relire = texte.index("Relire le dépôt déposé")
        assert depot < relire, "la relecture doit suivre le dépôt : elle lit ce qui vient d'être écrit"
        assert "verifier_depot_sauvegarde.py" in texte[relire:]
        assert "--empreinte \"$(cat /tmp/kojo.archive.sha256)\"" in texte[relire:]

    def test_la_cle_deposee_est_ecrite_puis_relue(self, texte):
        """Recalculer la date dans la seconde étape relirait une autre clé pour un
        run qui traverse minuit UTC."""
        assert "printf '%s\\n' \"$cle\" > /tmp/kojo.cle" in texte
        assert 'cle="$(cat /tmp/kojo.cle)"' in texte
        assert texte.index("/tmp/kojo.cle") < texte.index('cle="$(cat /tmp/kojo.cle)"')

    def test_la_relecture_lit_une_autre_copie_que_l_envoi(self, texte):
        relire = texte[texte.index("Relire le dépôt déposé") :]
        assert "--fichier /tmp/relecture.enc" in relire
        assert "--envoye /tmp/kojo.archive.enc" in relire

    def test_aucune_etape_neutra_un_depot_qui_ne_se_relit_pas(self, texte):
        assert "continue-on-error" not in texte
        relire = texte[texte.index("Relire le dépôt déposé") :]
        assert "|| true" not in relire
