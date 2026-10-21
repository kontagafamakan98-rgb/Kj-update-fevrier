# -*- coding: utf-8 -*-
"""La sonde de sauvegardes Atlas juge des FAITS, et refuse de juger sans eux.

Ce que ces cas verrouillent, et pourquoi chacun existe :

  * `backupEnabled` seul ne suffit pas — un cluster peut sauvegarder par
    snapshots et n'avoir AUCUNE restauration continue (PITR). C'est le cas
    piégeux : la case « Cloud Backup » est cochée, le RPO est de plusieurs
    heures ;
  * un palier partagé (M0/M2/M5) ne fournit pas PITR : dire « activez PITR »
    serait un remède impossible. Le message doit nommer le palier ;
  * une réponse sans les deux champs (schéma déplacé, corps tronqué) ne vaut
    PAS « sauvegarde désactivée » : la sonde doit se taire et sortir en 2,
    sinon elle crierait au loup — ou, pire, passerait pour un vert ;
  * 401/403/404/réseau = prémisse, aucun verdict. Une surface aveugle se
    déclare ;
  * le workflow quotidien lance bien cette sonde, sans `continue-on-error`
    (une étape qui ne peut pas échouer ne surveille rien) ;
  * le runbook est DATÉ et dit ce qu'il ne prouve pas.
"""
import importlib.util
import os
from pathlib import Path

import pytest

RACINE = Path(__file__).resolve().parents[2]
SCRIPT = RACINE / "backend" / "scripts" / "check_atlas_backups.py"
WORKFLOW = RACINE / ".github" / "workflows" / "atlas-backups-probe.yml"
RUNBOOK = RACINE / "backend" / "SAUVEGARDES_ATLAS.md"


def _charger():
    spec = importlib.util.spec_from_file_location("check_atlas_backups", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def sonde():
    return _charger()


def _cluster(backup=True, pit=True, palier="M10"):
    return {
        "name": "kojo-prod",
        "backupEnabled": backup,
        "pitEnabled": pit,
        "replicationSpecs": [
            {"regionConfigs": [{"electableSpecs": {"instanceSize": palier}}]}
        ],
    }


# ── Ce que la sonde juge ────────────────────────────────────────────────────

def test_sauvegardes_et_pitr_actives_donnent_un_vert(sonde):
    code, lignes = sonde.analyser(200, _cluster())
    texte = "\n".join(lignes)
    assert code == 0
    assert "backupEnabled=True" in texte and "pitEnabled=True" in texte
    assert "PITR" in texte


def test_pitr_desactivee_fait_echouer_en_la_nommant(sonde):
    code, lignes = sonde.analyser(200, _cluster(pit=False))
    texte = "\n".join(lignes)
    assert code == 1
    assert "CONTINUE" in texte and "PITR" in texte
    assert "M10" in texte  # le palier qui la permet est nommé


def test_un_palier_partage_est_nomme_au_lieu_de_recevoir_un_remède_impossible(sonde):
    code, lignes = sonde.analyser(200, _cluster(pit=False, palier="M0"))
    texte = "\n".join(lignes)
    assert code == 1
    assert "M0" in texte
    assert "ne la fournit pas" in texte


def _cluster_partage(backup=True, pit=True, palier="M0"):
    """La forme RÉELLE d'un cluster partagé (M0), relevée le 19/10/2026 : pas de
    `replicationSpecs`, le palier vit dans `providerSettings.instanceSizeName`."""
    return {
        "name": "Kojo",
        "backupEnabled": backup,
        "pitEnabled": pit,
        "providerSettings": {"providerName": "TENANT", "instanceSizeName": palier},
    }


def test_le_palier_d_un_cluster_partage_se_lit_dans_providerSettings(sonde):
    # Sans cette lecture, le cluster réel sortait « palier inconnu » (mesuré le
    # 19/10/2026) et le remède publié était impossible sur un M0.
    assert sonde._palier(_cluster_partage(palier="M0")) == "M0"
    # Les deux formes restent lues : un cluster dédié n'a pas de providerSettings.
    assert sonde._palier(_cluster(palier="M20")) == "M20"


def test_sauvegardes_desactivees_font_echouer(sonde):
    code, lignes = sonde.analyser(200, _cluster(backup=False))
    texte = "\n".join(lignes)
    assert code == 1
    assert "DÉSACTIVÉES" in texte
    # Palier dédié : le remède Atlas est le bon, et le palier est nommé.
    assert "M10" in texte and "Atlas → Backup → Enable" in texte


def test_sauvegardes_desactivees_sur_un_palier_partage_ne_demandent_pas_l_impossible(sonde):
    code, lignes = sonde.analyser(200, _cluster_partage(backup=False, palier="M0"))
    texte = "\n".join(lignes)
    assert code == 1
    assert "M0" in texte
    assert "AUCUNE sauvegarde continue" in texte
    # Le remède impossible ne doit PAS être proposé sur ce palier.
    assert "Atlas → Backup → Enable" not in texte, texte
    # Les deux remèdes réels sont nommés : changer de palier, ou sauvegarder
    # dehors (la procédure existe et a un exercice daté).
    assert "M10" in texte and "mongodump" in texte
    assert "SAUVEGARDES_ATLAS.md" in texte


def test_un_champ_absent_ne_se_lit_pas_desactive_mais_illisible(sonde):
    """Un schéma déplacé rend la sonde muette ET bruyante, jamais verte."""
    code, lignes = sonde.analyser(200, {"name": "kojo-prod"})
    assert code == 2
    assert "refuse de conclure" in "\n".join(lignes)


def test_un_booleen_sous_forme_de_chaine_est_refuse(sonde):
    """`"true"` n'est pas `true` : deviner ferait un faux vert."""
    document = _cluster()
    document["pitEnabled"] = "true"
    code, _ = sonde.analyser(200, document)
    assert code == 2


def test_cle_refusee_est_une_premisse(sonde):
    code, lignes = sonde.analyser(401, {})
    texte = "\n".join(lignes)
    assert code == 2
    assert "prémisse" in texte.lower() or "PREMISSE" in texte
    assert "aucun verdict" in texte.lower()


def test_cluster_introuvable_est_une_premisse(sonde):
    code, lignes = sonde.analyser(404, {})
    assert code == 2
    assert "introuvable" in "\n".join(lignes)


def test_atlas_injoignable_est_une_premisse(sonde):
    code, lignes = sonde.analyser(None, "Connection refused")
    assert code == 2
    assert "injoignable" in "\n".join(lignes)


def test_corps_non_json_est_une_premisse(sonde):
    code, _ = sonde.analyser(200, "<html>403</html>")
    assert code == 2


# ── Le point d'entrée ───────────────────────────────────────────────────────

VARIABLES = ("ATLAS_PUBLIC_KEY", "ATLAS_PRIVATE_KEY", "ATLAS_PROJECT_ID", "ATLAS_CLUSTER")


def test_sans_cles_la_sonde_sort_en_2_en_nommant_ce_qui_manque(sonde, monkeypatch, capsys):
    for nom in VARIABLES:
        monkeypatch.delenv(nom, raising=False)
    monkeypatch.setattr("sys.argv", ["check_atlas_backups.py"])
    code = sonde.main()
    capture = capsys.readouterr()
    assert code == 2
    assert "ATLAS_PUBLIC_KEY" in capture.err
    assert "aucun verdict" in capture.err.lower()


def test_avec_cles_le_verdict_de_l_api_est_rendu(sonde, monkeypatch, capsys):
    for nom in VARIABLES:
        monkeypatch.setenv(nom, "valeur-de-test")
    monkeypatch.setattr("sys.argv", ["check_atlas_backups.py"])
    monkeypatch.setattr(sonde, "lire_cluster", lambda *a, **k: (200, _cluster(pit=False), ""))
    code = sonde.main()
    capture = capsys.readouterr()
    assert code == 1
    assert "::error title=Sauvegardes Atlas désactivées::" in capture.out


class TestLaPremisseNEnterrePasLAutreMoitie:
    """Le 21/10/2026, les clés `ATLAS_*` refusées (401) ont rendu un run MUET sur
    la sauvegarde externe, qui venait pourtant d'aboutir : « on ne sait rien » là
    où un âge était mesurable. La moitié qui se mesure se publie, et le code
    reste 2 — un fait rassurant à côté d'un refus ne fait pas un vert.
    """

    def _lancer(self, sonde, monkeypatch, capsys, dernier):
        for nom in VARIABLES:
            monkeypatch.setenv(nom, "valeur-de-test")
        monkeypatch.setattr("sys.argv", ["check_atlas_backups.py"])
        monkeypatch.setattr(sonde, "lire_cluster", lambda *a, **k: (401, {}, ""))
        monkeypatch.setattr(sonde, "dernier_succes_externe", lambda *a, **k: dernier)
        code = sonde.main()
        return code, capsys.readouterr().out

    def _il_y_a(self, heures):
        from datetime import datetime, timedelta, timezone

        instant = datetime.now(timezone.utc) - timedelta(hours=heures)
        return instant.isoformat().replace("+00:00", "Z")

    def test_une_cle_refusee_publie_quand_meme_l_age_de_la_sauvegarde(
        self, sonde, monkeypatch, capsys
    ):
        code, sortie = self._lancer(sonde, monkeypatch, capsys, ("ok", self._il_y_a(2)))
        assert code == 2, sortie  # la prémisse Atlas reste une prémisse
        assert "[MESURÉ] Sauvegarde EXTERNE : il y a 2 h" in sortie, sortie
        assert "fraîche" in sortie, sortie
        assert "::error title=Sauvegardes Atlas non vérifiables::" in sortie, sortie

    def test_une_cle_refusee_dit_aussi_qu_aucune_sauvegarde_n_a_abouti(
        self, sonde, monkeypatch, capsys
    ):
        code, sortie = self._lancer(sonde, monkeypatch, capsys, ("ok", None))
        assert code == 2, sortie
        assert "[MESURÉ] Aucune sauvegarde EXTERNE n'a jamais abouti" in sortie, sortie

    def test_une_cle_refusee_et_une_api_illisible_le_disent_separement(
        self, sonde, monkeypatch, capsys
    ):
        code, sortie = self._lancer(
            sonde, monkeypatch, capsys, ("illisible", "API GitHub injoignable")
        )
        assert code == 2, sortie
        assert "[MESURÉ] Sauvegarde EXTERNE non jugeable : API GitHub" in sortie, sortie

    def test_la_ligne_mesuree_nomme_une_sauvegarde_perimee_sans_la_verdir(self, sonde):
        import time as _time

        ligne = sonde.fraicheur_externe_mesuree(
            "2026-10-19T04:00:00Z", _time.time(), seuil_heures=36
        )
        assert "PÉRIMÉE" in ligne and "il y a " in ligne, ligne
        assert "ne remplace pas le verdict Atlas" in ligne, ligne


def test_le_chemin_interroge_porte_le_projet_et_le_cluster(sonde):
    """Le projet et le cluster viennent de l'environnement, pas d'une valeur en dur."""
    url = sonde.url_cluster("projet-42", "cluster-kojo")
    assert url == (
        "https://cloud.mongodb.com/api/atlas/v2/groups/projet-42/clusters/cluster-kojo"
    )


# ── Le câblage : le workflow et le runbook ──────────────────────────────────

def test_le_workflow_lance_la_sonde_chaque_jour_et_peut_echouer():
    texte = WORKFLOW.read_text(encoding="utf-8")
    assert "schedule:" in texte and "cron:" in texte
    assert "backend/scripts/check_atlas_backups.py" in texte
    assert "continue-on-error" not in texte, (
        "une étape qui ne peut pas échouer ne surveille rien"
    )
    assert "ATLAS_PUBLIC_KEY" in texte and "secrets." in texte
    assert "workflow_dispatch" in texte


def test_le_workflow_epingle_ses_actions_a_une_version():
    import re
    texte = WORKFLOW.read_text(encoding="utf-8")
    references = re.findall(r"uses:\s*([^\s#]+)", texte)
    assert references, "aucune action référencée : le câblage ne tournerait pas"
    for reference in references:
        assert re.search(r"@v?\d+(\.\d+)*$|@[0-9a-f]{7,40}$", reference), (
            f"référence non épinglée : {reference}"
        )


# ── La sauvegarde EXTERNE : le seul recours d'un palier partagé ───────────────
# M0 ne fournit pas de sauvegarde continue. Exiger un Cloud Backup y est
# impossible ; exiger un vert serait un silence. La sonde juge donc la FRAÎCHEUR
# d'une sauvegarde externe VÉRIFIÉE, lue dans l'historique du workflow.

class TestSauvegardeExterne:
    def test_aucun_succes_n_est_pas_un_vert(self, sonde):
        code, ligne = sonde.juger_sauvegarde_externe(None, maintenant=0)
        assert code == 1
        assert "Aucune sauvegarde EXTERNE" in ligne
        # Le refus dit quoi poser : sans ça, il faudrait deviner l'entrée.
        assert "MONGO_URL" in ligne and sonde.WORKFLOW_SAUVEGARDE in ligne

    def test_une_sauvegarde_recente_donne_un_vert_en_nommant_l_age(self, sonde):
        maintenant = sonde._instant("2026-10-19T06:00:00Z")
        code, ligne = sonde.juger_sauvegarde_externe("2026-10-19T00:00:00Z", maintenant)
        assert code == 0, ligne
        assert "il y a 6 h" in ligne
        # Le vert ne prétend pas qu'Atlas sauvegarde : il dit ce qui existe.
        assert "aucune sauvegarde continue" in ligne

    def test_une_sauvegarde_perimee_est_refusee_en_nommant_les_deux_durees(self, sonde):
        maintenant = sonde._instant("2026-10-20T16:00:00Z")
        code, ligne = sonde.juger_sauvegarde_externe("2026-10-19T00:00:00Z", maintenant)
        assert code == 1, ligne
        assert "40 h" in ligne and "36 h" in ligne

    def test_un_horodatage_illisible_n_est_pas_recent(self, sonde):
        code, ligne = sonde.juger_sauvegarde_externe("hier-soir", maintenant=0)
        assert code == 1
        assert "ILLISIBLE" in ligne

    def test_une_date_dans_le_futur_est_refusee(self, sonde):
        maintenant = sonde._instant("2026-10-19T00:00:00Z")
        code, ligne = sonde.juger_sauvegarde_externe("2026-10-21T00:00:00Z", maintenant)
        assert code == 1
        assert "FUTUR" in ligne

    def test_un_cluster_partage_sans_sauvegarde_bascule_sur_l_externe(
        self, sonde, monkeypatch, capsys
    ):
        """Le câblage, pas seulement la règle : c'est `main()` qui décide."""
        for nom in sonde.VARIABLES:
            monkeypatch.setenv(nom, "valeur-factice")
        monkeypatch.setattr(
            sonde, "lire_cluster",
            lambda *a, **k: (200, _cluster_partage(backup=False, palier="M0"), ""),
        )
        maintenant = sonde._instant("2026-10-19T06:00:00Z")
        monkeypatch.setattr(
            sonde, "dernier_succes_externe",
            lambda *a, **k: ("ok", "2026-10-19T04:00:00Z"),
        )
        monkeypatch.setattr(sonde.time, "time", lambda: maintenant)
        monkeypatch.setattr("sys.argv", ["check_atlas_backups.py"])
        code = sonde.main()
        sortie = capsys.readouterr().out
        assert code == 0, sortie
        assert "Sauvegarde EXTERNE vérifiée il y a 2 h" in sortie, sortie
        # Le remède impossible ne doit pas survivre à côté du vert.
        assert "Atlas → Backup → Enable" not in sortie, sortie

    def test_un_cluster_dedie_sans_sauvegarde_ne_bascule_pas_sur_l_externe(
        self, sonde, monkeypatch, capsys
    ):
        """Sur un palier dédié, Atlas PEUT sauvegarder : c'est ce qu'on exige."""
        for nom in sonde.VARIABLES:
            monkeypatch.setenv(nom, "valeur-factice")
        monkeypatch.setattr(
            sonde, "lire_cluster", lambda *a, **k: (200, _cluster(backup=False), "")
        )
        monkeypatch.setattr(
            sonde, "dernier_succes_externe",
            lambda *a, **k: ("ok", "2026-10-19T04:00:00Z"),
        )
        monkeypatch.setattr("sys.argv", ["check_atlas_backups.py"])
        code = sonde.main()
        sortie = capsys.readouterr().out
        assert code == 1, sortie
        assert "Atlas → Backup → Enable" in sortie, sortie

    def test_le_workflow_de_sauvegarde_existe_et_verifie_par_restauration(self):
        """Une fraîcheur jugée sur un workflow qui ne sauvegarde pas serait un
        vert sans mesure : le contrat est vérifié ici."""
        texte = (RACINE / ".github" / "workflows" / "backup-db.yml").read_text(
            encoding="utf-8"
        )
        assert "cron:" in texte and "workflow_dispatch" in texte
        assert "mongodump" in texte and "mongorestore" in texte
        # La preuve qu'une archive est une sauvegarde : elle est RESTAURÉE et
        # comparée, par le script dont l'exercice daté se sert déjà.
        assert "exercice_restauration.py" in texte
        # Et comparée à la SOURCE elle-même, pas à une recopie : sans ce mode,
        # le script détruisait la base restaurée pour la recopier depuis la
        # source, et le run devenait vert sans avoir jugé l'archive.
        assert "--deja-restauree" in texte, (
            "le run doit juger l'archive restaurée (`--deja-restauree`), pas une "
            "copie faite par le script"
        )
        # Un reste d'un run échoué apparaîtrait sinon comme une collection « EN
        # TROP » — un écart qui ne dit rien de la sauvegarde du jour.
        assert 'drop_database("kojo_verif")' in texte, (
            "la base de travail doit être vidée avant restauration"
        )
        # Données personnelles : jamais en clair hors du runner.
        assert "openssl enc -aes-256-cbc" in texte
        assert "s3 cp" in texte
        assert "continue-on-error" not in texte, (
            "une étape qui ne peut pas échouer ne sauvegarde rien"
        )


def test_le_runbook_est_date_et_dit_ce_qu_il_ne_prouve_pas():
    texte = RUNBOOK.read_text(encoding="utf-8")
    assert "18/10/2026" in texte, "un exercice sans date ne prouve rien"
    assert "exit" in texte.lower() or "code" in texte.lower()
    for code in ("**0**", "**1**", "**2**"):
        assert code in texte, f"sortie {code} non documentée"
    assert "n'a pas été exécuté" in texte, (
        "le runbook doit dire que le chemin Atlas/PITR n'a pas été exercé"
    )
    assert "mongorestore" in texte and "mongodump" in texte
    for nom in VARIABLES:
        assert nom in texte, f"secret {nom} non documenté"


def test_le_runbook_ne_contient_aucun_secret():
    """Un runbook qui cite une clé est une fuite, même en exemple crédible."""
    texte = RUNBOOK.read_text(encoding="utf-8")
    assert "mongodb+srv://" not in texte, "une URL Atlas réelle ne se documente pas ici"
    assert not os.environ.get("ATLAS_PRIVATE_KEY"), "prémisse de test : aucune clé ne doit être posée"
