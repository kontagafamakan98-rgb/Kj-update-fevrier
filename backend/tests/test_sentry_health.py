# -*- coding: utf-8 -*-
"""Régression : l'état de Sentry est PUBLIÉ par /health, sans le DSN.

CE QUE CES PREUVES FERMENT (31/10/2026). Deux audits de suite ont écrit la même
chose — « Sentry reste optionnel et invérifiable d'ici » —, et c'était exact :
`SENTRY_DSN` absent, `backend/server.py` ne remontait aucune erreur et RIEN ne
le disait ; un DSN présent mais refusé par `sentry_sdk.init()` était avalé par
un `except` local qui journalisait puis continuait. Le serveur se déclarait donc
en bonne santé dans les deux cas, et la seule lecture possible demandait un
accès aux secrets Fly.

`/health` publie désormais un bloc `sentry` : `configured`, `state` (`ok` /
`inactif` / `echec`), `motif`, `environment`. Trois états, parce que « le
monitoring n'est pas voulu » et « le monitoring est cassé » n'appellent pas le
même remède.

CE QUE CES CAS VÉRIFIENT, dans l'ordre où le serveur les traverse :

  * l'ABSENCE du DSN est un état (`inactif`), pas une erreur — et son motif
    nomme la variable à poser ;
  * un DSN posé et initialisé se lit `ok` avec `configured: True`, et la
    promesse de confidentialité est TENUE à l'initialisation
    (`send_default_pii=False`) ;
  * un DSN REFUSÉ se lit `echec` — et le message de l'exception n'est pas
    propagé, parce que `sentry_sdk` y recopie le DSN ;
  * un SDK absent se lit `echec` avec un motif qui nomme `requirements.txt` ;
  * le bloc est réellement dans la réponse de `/health`, et AUCUNE partie du
    DSN (clé publique, hôte d'ingestion, identifiant de projet) n'apparaît nulle
    part dans cette réponse publique ;
  * `server.py` ne garde pas une seconde initialisation concurrente : une seule
    source (`kojo_sentry`), sinon deux états pourraient diverger.

Ce que ces cas ne mesurent PAS : que les événements arrivent réellement dans un
projet Sentry. Cela demande un DSN de production et un accès au tableau de bord ;
le fait publié ici est « l'initialisation a réussi », qui est la condition
nécessaire et vérifiable depuis l'extérieur.
"""
import json
import sys

import pytest

import kojo_sentry
from kojo_sentry import MOTIFS, VARIABLE_DSN, diagnostic, initialiser

# Un DSN SYNTHÉTIQUE, jamais un vrai : sa clé, son hôte et son projet sont
# reconnaissables, ce qui permet d'affirmer qu'aucun des trois ne fuit.
DSN_FACTICE = "https://cle-publique-factice@o424242.ingest.sentry.io/7777777"
PARTIES_SECRETES = ("cle-publique-factice", "o424242", "ingest.sentry.io", "7777777")


@pytest.fixture(autouse=True)
def etat_neuf():
    """Chaque cas part d'un état vierge : le module retient l'initialisation."""
    kojo_sentry.reinitialiser()
    yield
    kojo_sentry.reinitialiser()


def _init_ok(appels):
    def _initialiseur(**options):
        appels.append(options)

    return _initialiseur


class TestLEtatPublie:
    def test_sans_dsn_l_etat_est_inactif_et_le_motif_nomme_la_variable(self, monkeypatch):
        monkeypatch.delenv(VARIABLE_DSN, raising=False)
        appels = []

        etat = initialiser(dsn=None, environnement="production",
                           initialiseur=_init_ok(appels))

        assert etat["state"] == "inactif" and etat["configured"] is False
        assert appels == [], "sans DSN, aucune initialisation ne doit être tentée"
        assert VARIABLE_DSN in diagnostic()["motif"]
        assert "ne remontent pas" in diagnostic()["motif"]

    def test_un_dsn_initialise_se_lit_ok_et_ne_transmet_aucune_pii(self):
        appels = []

        etat = initialiser(dsn=DSN_FACTICE, environnement="production",
                           initialiseur=_init_ok(appels))

        assert etat["state"] == "ok" and etat["configured"] is True
        assert etat["environment"] == "production"
        assert len(appels) == 1
        # La promesse de PRIVACY.md est TENUE à l'initialisation, pas seulement
        # écrite : sans ce drapeau, emails et téléphones partiraient à Sentry.
        assert appels[0]["send_default_pii"] is False
        assert appels[0]["dsn"] == DSN_FACTICE
        assert "remontent" in diagnostic()["motif"]

    def test_un_dsn_refuse_se_lit_echec_sans_propager_le_message(self):
        """`sentry_sdk` recopie le DSN dans ses erreurs : le message ne sort pas."""
        def _refuse(**options):
            raise ValueError(f"Invalid DSN: {options['dsn']} (project inconnu)")

        etat = initialiser(dsn=DSN_FACTICE, environnement="production",
                           initialiseur=_refuse)

        assert etat["state"] == "echec" and etat["configured"] is False
        bloc = diagnostic()
        assert VARIABLE_DSN in bloc["motif"]
        for partie in PARTIES_SECRETES:
            assert partie not in json.dumps(bloc), (
                f"« {partie} » fuit dans le bloc public : {bloc}"
            )

    def test_un_sdk_absent_se_lit_echec_et_nomme_requirements(self, monkeypatch):
        # `sys.modules[nom] = None` fait lever ImportError à l'import suivant :
        # c'est la panne réelle d'une image construite sans le paquet.
        monkeypatch.setitem(sys.modules, "sentry_sdk", None)

        etat = initialiser(dsn=DSN_FACTICE, environnement="production")

        assert etat["state"] == "echec" and etat["configured"] is False
        assert "requirements.txt" in diagnostic()["motif"]

    def test_chaque_cause_a_un_motif_et_aucun_ne_cite_le_dsn(self):
        """Le motif est une phrase ACTIONNABLE, pas un état recopié."""
        assert set(MOTIFS) == {"absent", "initialise", "import", "refus"}
        for cause, motif in MOTIFS.items():
            assert motif.strip(), f"la cause {cause} n'a pas de motif"
            assert "https://" not in motif, f"le motif {cause} cite une URL"
        assert kojo_sentry.motiver("cause-inconnue"), "une cause inconnue a un motif"


class TestLaReponseDeHealth:
    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        import server

        return TestClient(server.app)

    def test_le_bloc_sentry_est_dans_health(self, client, monkeypatch):
        monkeypatch.delenv(VARIABLE_DSN, raising=False)
        kojo_sentry.reinitialiser()

        reponse = client.get("/health")

        assert reponse.status_code == 200
        bloc = reponse.json().get("sentry")
        assert isinstance(bloc, dict), "/health ne publie pas de bloc `sentry`"
        assert set(bloc) == {"configured", "state", "motif", "environment"}
        assert bloc["state"] in {"ok", "inactif", "echec"}

    def test_aucune_partie_du_dsn_ne_sort_dans_health(self):
        """`/health` est PUBLIQUE : un DSN permet d'écrire de faux événements."""
        from fastapi.testclient import TestClient

        import server

        etat = initialiser(dsn=DSN_FACTICE, environnement="production",
                           initialiseur=lambda **options: None)
        assert etat["configured"] is True

        corps = TestClient(server.app).get("/health").text

        for partie in PARTIES_SECRETES:
            assert partie not in corps, (
                f"« {partie} » du DSN apparaît dans la réponse publique de /health"
            )

    def test_server_n_a_qu_une_seule_initialisation(self):
        """Une seconde initialisation dans `server.py` ferait diverger deux états."""
        from pathlib import Path

        source = (Path(__file__).resolve().parents[1] / "server.py").read_text(
            encoding="utf-8"
        )
        assert "sentry_sdk.init(" not in source, (
            "`server.py` appelle `sentry_sdk.init` lui-même : l'état publié par "
            "`/health` serait celui de `kojo_sentry`, pas celui du SDK"
        )
        assert "initialiser_sentry(" in source and "sentry_diagnostic()" in source
