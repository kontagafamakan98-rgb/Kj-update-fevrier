# -*- coding: utf-8 -*-
"""Mise en service de la sauvegarde externe : ce que l'outil PROUVE, et ce qu'il refuse.

Le sujet est un dépôt chiffré sur un bucket S3/R2. Quatre choses peuvent être
fausses sans que personne ne s'en aperçoive avant le jour de la restauration :
un bucket PUBLIC, des clés qui n'écrivent pas, une phrase secrète qui ne
déchiffre pas, un secret GitHub absent. Chacune a son test ici, et le test juge
le VERDICT (code + message), pas la forme du code.

Ce qui est aussi prouvé : la liste des six secrets est LUE dans le workflow
(jamais recopiée — un septième secret ajouté demain serait sinon ignoré), et
aucune valeur n'est jamais imprimée.
"""
import subprocess
from pathlib import Path

import pytest

import sys

RACINE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RACINE / "backend" / "scripts"))

import preparer_sauvegarde_externe as outil  # noqa: E402

WORKFLOW = RACINE / ".github" / "workflows" / "backup-db.yml"

SIX = {
    "MONGO_URL",
    "BACKUP_S3_BUCKET",
    "BACKUP_S3_ENDPOINT",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_KEY",
    "BACKUP_PASSPHRASE",
}


class _Corps:
    def __init__(self, octets):
        self._octets = octets

    def read(self):
        return self._octets


class _FauxS3:
    """Client S3 minimal : garde ce qui est écrit, pour que la relecture soit
    RÉELLE (un faux qui rend toujours le même tampon ne prouverait rien)."""

    def __init__(self, alteration=False):
        self.objets = {}
        self.alteration = alteration
        self.effaces = []

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.objets[Key] = bytes(Body)

    def get_object(self, Bucket, Key):
        octets = self.objets[Key]
        return {"Body": _Corps(octets + b"!" if self.alteration else octets)}

    def delete_object(self, Bucket, Key):
        self.effaces.append(Key)
        self.objets.pop(Key, None)


def _valeurs(**remplacements):
    base = {
        "MONGO_URL": "mongodb+srv://lecture:canari-mot-de-passe@cluster/kojo_db",
        "BACKUP_S3_BUCKET": "kojo-sauvegardes",
        "BACKUP_S3_ENDPOINT": "https://compte.r2.cloudflarestorage.com",
        "BACKUP_S3_ACCESS_KEY_ID": "AKIA-CANARI-ID",
        "BACKUP_S3_SECRET_KEY": "canari-secret-cle",
        "BACKUP_PASSPHRASE": "phrase-de-test-solide",
    }
    base.update(remplacements)
    return base


def test_les_six_secrets_sont_lus_dans_le_workflow_pas_recopies():
    """La liste vient du workflow : le jour où il en lit un septième, l'outil le
    pose aussi. Recopier six noms ici rendrait ce décalage invisible."""
    attendus = outil.secrets_attendus(WORKFLOW.read_text(encoding="utf-8"))
    assert set(attendus) == SIX


def test_un_secret_vide_compte_comme_absent_et_un_externe_n_est_pas_exige():
    """`--mongo-externe` : la valeur ne passe pas par ce poste, donc elle n'est
    pas exigée ICI — mais elle reste exigée dans GitHub (voir plus bas)."""
    assert outil.manquantes(_valeurs(MONGO_URL=""), sorted(SIX)) == ["MONGO_URL"]
    assert outil.manquantes(_valeurs(MONGO_URL=""), sorted(SIX), ("MONGO_URL",)) == []


def test_un_secret_vide_compte_comme_absent():
    """Un secret vide n'est pas un secret : le workflow le refuse, donc l'outil
    doit le refuser aussi — deux juges qui divergent laissent un rouge incompris."""
    assert outil.manquantes(_valeurs(BACKUP_PASSPHRASE="   "), sorted(SIX)) == ["BACKUP_PASSPHRASE"]
    assert outil.manquantes(_valeurs(), sorted(SIX)) == []


def test_le_fichier_de_valeurs_tolere_commentaires_et_guillemets(tmp_path):
    fichier = tmp_path / "secrets.env"
    fichier.write_text(
        "# commentaire\n\nBACKUP_S3_BUCKET=\"kojo-sauvegardes\"\n"
        "export BACKUP_PASSPHRASE='phrase solide'\nMONGO_URL=mongodb://x\n",
        encoding="utf-8",
    )
    valeurs = outil.lire_fichier(fichier)
    assert valeurs["BACKUP_S3_BUCKET"] == "kojo-sauvegardes"
    assert valeurs["BACKUP_PASSPHRASE"] == "phrase solide"
    assert valeurs["MONGO_URL"] == "mongodb://x"
    assert "commentaire" not in valeurs


class TestPrive:
    def test_un_bucket_public_est_refuse(self):
        code, ligne = outil.verdict_prive(200)
        assert code == 1
        assert "PUBLIC" in ligne

    @pytest.mark.parametrize("statut", [401, 403, 404])
    def test_une_lecture_anonyme_refusee_prouve_le_prive(self, statut):
        """404 compte : le fournisseur masque l'existence, et le confondre avec
        « objet absent » ferait passer un bucket public pour privé."""
        code, ligne = outil.verdict_prive(statut)
        assert code == 0
        assert "privé" in ligne

    def test_une_lecture_impossible_n_est_pas_un_vert(self):
        code, ligne = outil.verdict_prive(None, "", "timeout")
        assert code == 2
        assert "PAS jugé" in ligne

    def test_r2_refuse_l_anonyme_en_400_avec_le_motif_authorization(self):
        """Mesuré le 21/10/2026 sur le vrai bucket : R2 ne répond pas 403 mais
        400 avec `<Message>Authorization</Message>`. Le statut seul ne suffit
        donc pas — et un 400 sans ce motif n'est PAS un refus."""
        code, ligne = outil.verdict_prive(
            400, "<?xml version=\"1.0\"?><Error><Code>InvalidArgument</Code>"
                 "<Message>Authorization</Message></Error>"
        )
        assert code == 0
        assert "privé" in ligne

    def test_un_400_sans_motif_n_est_pas_un_refus(self):
        """Une requête incomprise n'est pas une requête refusée : la compter
        comme privée donnerait un vert sur une surface aveugle."""
        code, ligne = outil.verdict_prive(400, "<Error><Message>Malformed</Message></Error>")
        assert code == 2
        assert "PREMISSE" in ligne


class TestCycle:
    def test_le_cycle_complet_passe(self):
        assert outil.verdict_cycle(True, True, True, True)[0] == 0

    def test_des_cles_qui_n_ecrivent_pas_sont_nommees(self):
        code, ligne = outil.verdict_cycle(False, False, False, False)
        assert code == 1
        assert "ÉCRIRE" in ligne

    def test_un_objet_altere_est_refuse(self):
        code, ligne = outil.verdict_cycle(True, True, True, False)
        assert code == 1
        assert "altère" in ligne


class TestPhraseSecrete:
    def test_la_phrase_est_eprouvee_par_un_vrai_chiffrement(self):
        """Chiffrer réussit avec n'importe quelle phrase ; c'est le
        DÉCHIFFREMENT qui prouve qu'on garde la bonne."""
        ok, motif = outil.eprouver_phrase_secrete("phrase-de-test-solide")
        if ok is None:
            pytest.skip(f"openssl indisponible ({motif})")
        assert ok is True, motif

    def test_une_phrase_qui_ne_dechiffre_pas_est_un_rouge(self):
        code, ligne = outil.verdict_phrase_secrete(False, "bad decrypt")
        assert code == 1
        assert "IRRÉCUPÉRABLE" in ligne

    def test_une_phrase_non_eprouvee_est_une_premisse(self):
        assert outil.verdict_phrase_secrete(None, "openssl introuvable")[0] == 2


class TestBoutEnBout:
    def test_un_bucket_prive_et_utilisable_rend_zero(self, monkeypatch):
        faux = _FauxS3()
        monkeypatch.setattr(outil, "_client_s3", lambda valeurs: faux)
        monkeypatch.setattr(outil, "_lecture_anonyme", lambda url: (403, "", ""))
        monkeypatch.setattr(outil, "eprouver_phrase_secrete", lambda phrase, openssl="openssl": (True, ""))

        code, lignes = outil.verifier(_valeurs(), sorted(SIX))

        assert code == 0, lignes
        # L'objet de contrôle ne reste pas : un bac à sable qui laisse ses
        # déchets finirait par coûter plus cher que la sauvegarde.
        assert faux.objets == {}
        assert faux.effaces

    def test_un_bucket_public_rend_un_rouge_nomme(self, monkeypatch):
        faux = _FauxS3()
        monkeypatch.setattr(outil, "_client_s3", lambda valeurs: faux)
        monkeypatch.setattr(outil, "_lecture_anonyme", lambda url: (200, "", ""))
        monkeypatch.setattr(outil, "eprouver_phrase_secrete", lambda phrase, openssl="openssl": (True, ""))

        code, lignes = outil.verifier(_valeurs(), sorted(SIX))

        assert code == 1
        assert any("PUBLIC" in ligne for ligne in lignes)

    def test_un_bucket_absent_nomme_le_remède(self, monkeypatch):
        class _Absent(_FauxS3):
            def put_object(self, **kwargs):
                raise RuntimeError("An error occurred (NoSuchBucket): The specified bucket does not exist")

        monkeypatch.setattr(outil, "_client_s3", lambda valeurs: _Absent())

        code, lignes = outil.verifier(_valeurs(), sorted(SIX))

        assert code == 1
        assert "n'existe pas" in lignes[0]
        # Le remède est celui du fournisseur, pas « réessayez ».
        assert "Create bucket" in lignes[0]

    def test_aucune_valeur_de_secret_n_est_imprimee(self, monkeypatch, capsys):
        """Le fichier de valeurs contient une chaîne de connexion et deux clés :
        un outil qui les recopie dans un journal les publie dans le run."""
        def _panne(valeurs):
            raise RuntimeError("client indisponible")

        monkeypatch.setattr(outil, "_client_s3", _panne)
        monkeypatch.setattr(
            outil.sys, "argv",
            [
                "outil",
                "--fichier", str(_ecrire_fichier_de_test()),
                # Le workflow est passé en clair : `main` doit lire la même
                # liste que les tests, pas s'en remettre au répertoire courant.
                "--workflow", str(WORKFLOW),
            ],
        )

        code = outil.main()
        sortie = capsys.readouterr()
        assert code == 2
        for secret in ("canari-mot-de-passe", "AKIA-CANARI-ID", "canari-secret-cle", "phrase-de-test-solide"):
            assert secret not in sortie.out + sortie.err


def _ecrire_fichier_de_test():
    import tempfile

    chemin = Path(tempfile.mkdtemp()) / "secrets.env"
    chemin.write_text(
        "\n".join(f"{nom}={valeur}" for nom, valeur in _valeurs().items()) + "\n",
        encoding="utf-8",
    )
    return chemin


def test_le_verdict_dit_ce_qui_n_est_pas_juge_ici(monkeypatch):
    """Un vert qui tairait que `MONGO_URL` n'a pas été vue serait un vert
    partiel présenté comme complet."""
    faux = _FauxS3()
    monkeypatch.setattr(outil, "_client_s3", lambda valeurs: faux)
    monkeypatch.setattr(outil, "_lecture_anonyme", lambda url: (403, "", ""))
    monkeypatch.setattr(outil, "eprouver_phrase_secrete", lambda phrase, openssl="openssl": (True, ""))

    code, lignes = outil.verifier(_valeurs(MONGO_URL=""), sorted(SIX), ("MONGO_URL",))

    assert code == 0, lignes
    assert any("Non jugé ici" in ligne and "MONGO_URL" in ligne for ligne in lignes)


def test_mongo_externe_absent_de_github_reste_un_rouge(monkeypatch):
    """Ne pas poser MONGO_URL ici ne dispense pas de vérifier qu'elle EST dans
    GitHub : un run de 02:40 qui sort en 2 faute de secret ne sauvegarde rien."""
    monkeypatch.setattr(
        outil.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(args=a, returncode=0, stdout=b"", stderr=b""),
    )
    monkeypatch.setattr(
        outil, "_gh",
        lambda *a, **k: '[{"name":"BACKUP_S3_BUCKET"},{"name":"BACKUP_PASSPHRASE"}]',
    )

    code, lignes = outil.poser_secrets(
        _valeurs(MONGO_URL=""), sorted(SIX), "owner/repo", ("MONGO_URL",)
    )

    assert code == 1
    assert "MONGO_URL" in lignes[0]


def test_aucun_secret_n_est_pose_quand_un_manque(monkeypatch):
    """Poser cinq secrets sur six produirait un run rouge à 02:40 sans dire
    pourquoi : on refuse AVANT d'écrire, en nommant l'absent."""
    appels = []
    monkeypatch.setattr(outil.subprocess, "run", lambda *a, **k: appels.append(a))

    code, lignes = outil.poser_secrets(
        _valeurs(BACKUP_S3_SECRET_KEY=""), sorted(SIX), "owner/repo"
    )

    assert code == 2
    assert "BACKUP_S3_SECRET_KEY" in lignes[0]
    assert appels == []


def test_secrets_poses_mais_absents_de_la_liste_sont_un_rouge(monkeypatch):
    """Une pose qu'on n'a pas RELUE n'est pas une pose : `gh` peut réussir et le
    secret ne pas apparaître (mauvais dépôt, mauvais environnement)."""
    monkeypatch.setattr(
        outil.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(args=a, returncode=0, stdout=b"", stderr=b""),
    )
    monkeypatch.setattr(outil, "_gh", lambda *a, **k: "[]")

    code, lignes = outil.poser_secrets(_valeurs(), sorted(SIX), "owner/repo")

    assert code == 1
    assert "ABSENT" in lignes[0]
