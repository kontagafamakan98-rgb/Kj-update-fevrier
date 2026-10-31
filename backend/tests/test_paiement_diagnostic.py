# -*- coding: utf-8 -*-
"""Régression : `/health` dit POURQUOI le paiement est dans l'état où il est.

CE QUE CES PREUVES FERMENT (31/10/2026). `/health` publiait, pour le paiement,
`paydunya_circuit: {"state": "closed", "consecutive_failures": 0}` — une paire
qui se lit EXACTEMENT PAREIL dans trois situations que rien ne rapproche :

  * les clés PayDunya sont absentes, donc AUCUN paiement ne peut aboutir ;
  * les clés sont posées et aucun paiement n'a eu lieu depuis le redémarrage ;
  * les clés sont posées et le dernier paiement a réussi.

L'audit du 31/10 l'a écrit tel quel : « `paydunya_circuit: closed`, 0 échec
consécutif ; mode live non vérifiable sans secret ». Le bloc `paiement` sépare
ces trois états — `configured`, `state` (`ok` / `echec` / `inconnu`), `cause`
classée, `motif` actionnable, dates des derniers appels — sans jamais publier
une clé, le mode test/live, ni une référence de facture.

Ce que ces cas VÉRIFIENT, dans l'ordre où le code les traverse :

  * clés absentes ⇒ `echec` + `non_configure`, et le motif NOMME les variables
    à poser (un « echec » sans remède ne se répare pas) ;
  * configuré mais jamais appelé ⇒ `inconnu`, JAMAIS `ok` (règle du dépôt : un
    vert qui n'a rien mesuré est un silence) ;
  * appel réussi ⇒ `ok`, statut et date de succès ;
  * 401/403 ⇒ `cles_refusees`, 429 ⇒ `quota`, 5xx ⇒ `fournisseur` : trois
    remèdes, trois motifs ;
  * échec réseau ⇒ `reseau`, et NI l'URL appelée NI l'identifiant de facture ne
    sortent (le message de `requests` les contient) ;
  * réponse non-JSON ⇒ `illisible` ;
  * au seuil d'échecs le circuit s'ouvre, et le motif DIT le refroidissement ;
  * un succès après un échec remet le compteur à zéro sans effacer la trace ;
  * `/health` publie le bloc complet, et AUCUNE valeur de clé n'apparaît dans
    cette réponse PUBLIQUE.

Ce que ces cas ne mesurent PAS : qu'un paiement réel aboutit chez PayDunya.
Cela demande les clés de production et une transaction ; le fait publié ici est
« le dernier appel a abouti », qui est la condition nécessaire et vérifiable.
"""
import json

import pytest
import requests

import kojo_payments
from kojo_payments import MOTIFS_PAR_CAUSE, MOTIFS_PAR_STATUT, diagnostic

# Des clés SYNTHÉTIQUES, jamais d'un vrai compte : leur valeur est
# reconnaissable, ce qui permet d'affirmer qu'aucune ne fuit dans `/health`.
CLES = {
    "PAYDUNYA_MASTER_KEY": "master-cle-factice",
    "PAYDUNYA_PRIVATE_KEY": "privee-cle-factice",
    "PAYDUNYA_TOKEN": "jeton-factice",
}
URL_FACTICE = "https://app.paydunya.com/api/v1/checkout-invoice/confirm/INV-424242"


def _remettre_a_zero() -> None:
    """État mémoire et circuit neufs : deux cas ne partagent jamais un compteur."""
    kojo_payments.reinitialiser_diagnostic()
    kojo_payments._paydunya_circuit.update(
        state="closed", consecutive_failures=0, opened_at=0.0
    )


@pytest.fixture(autouse=True)
def etat_neuf(monkeypatch):
    # Clés posées par défaut : « configuré » est le cas nominal, et les cas qui
    # parlent de configuration le retirent explicitement.
    for nom, valeur in CLES.items():
        monkeypatch.setattr(kojo_payments, nom, valeur)
    _remettre_a_zero()
    yield
    _remettre_a_zero()


class _Reponse:
    """Une réponse PayDunya scriptée : statut, corps, ou JSON illisible."""

    def __init__(self, statut=200, corps=None, illisible=False):
        self.status_code = statut
        self._corps = {"response_code": "00"} if corps is None else corps
        self._illisible = illisible

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(
                f"{self.status_code} pour {URL_FACTICE}", response=self
            )

    def json(self):
        if self._illisible:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._corps


def _appel(monkeypatch, reponse):
    """Appelle le point unique des sorties PayDunya avec une réponse scriptée."""
    monkeypatch.setattr(
        kojo_payments.requests, "request", lambda *args, **kwargs: reponse
    )
    return kojo_payments._paydunya_call("GET", URL_FACTICE)


def _echec(monkeypatch, exc):
    def _leve(*args, **kwargs):
        raise exc

    monkeypatch.setattr(kojo_payments.requests, "request", _leve)
    with pytest.raises((requests.RequestException, ValueError)):
        kojo_payments._paydunya_call("GET", URL_FACTICE)


class TestLEtatPublie:
    def test_cles_absentes_se_lisent_echec_et_nomment_les_variables(self, monkeypatch):
        monkeypatch.setattr(kojo_payments, "PAYDUNYA_MASTER_KEY", "")

        bloc = diagnostic()

        assert bloc["configured"] is False
        assert bloc["state"] == "echec", "une clé absente n'est pas un silence"
        assert bloc["cause"] == "non_configure"
        assert "PAYDUNYA_MASTER_KEY" in bloc["motif"], (
            "le motif doit nommer la variable à poser, sinon il ne se répare pas"
        )
        assert bloc["last_success_at"] is None

    def test_jamais_appele_se_lit_inconnu_jamais_ok(self):
        bloc = diagnostic()

        assert bloc["configured"] is True
        assert bloc["state"] == "inconnu", (
            "« configuré et jamais appelé » rendu `ok` ferait passer un silence "
            "pour un paiement qui marche"
        )
        assert bloc["last_call_at"] is None and bloc["last_success_at"] is None
        assert bloc["motif"] == ""

    def test_un_appel_reussi_se_lit_ok_et_date_son_succes(self, monkeypatch):
        _appel(monkeypatch, _Reponse(200, {"response_code": "00", "status": "completed"}))

        bloc = diagnostic()

        assert bloc["state"] == "ok"
        assert bloc["last_status"] == 200
        assert bloc["last_success_at"] and bloc["last_success_at"] == bloc["last_call_at"]
        assert bloc["motif"] == "", "un état sain n'a pas de motif"

    def test_un_refus_de_cles_se_lit_cles_refusees(self, monkeypatch):
        _echec(monkeypatch, requests.HTTPError(f"401 pour {URL_FACTICE}", response=_Reponse(401)))

        bloc = diagnostic()

        assert bloc["state"] == "echec"
        assert bloc["cause"] == "cles_refusees" and bloc["last_status"] == 401
        assert "PAYDUNYA_MASTER_KEY" in bloc["motif"], (
            "le remède est de renouveler la clé, et le motif doit le dire"
        )

    def test_un_quota_se_lit_quota(self, monkeypatch):
        _echec(monkeypatch, requests.HTTPError(f"429 pour {URL_FACTICE}", response=_Reponse(429)))

        bloc = diagnostic()

        assert bloc["cause"] == "quota" and bloc["last_status"] == 429
        assert "quota" in bloc["motif"].lower()

    def test_une_panne_fournisseur_se_lit_fournisseur(self, monkeypatch):
        _echec(monkeypatch, requests.HTTPError(f"503 pour {URL_FACTICE}", response=_Reponse(503)))

        bloc = diagnostic()

        assert bloc["cause"] == "fournisseur"
        assert "fournisseur" in bloc["motif"]

    def test_une_panne_reseau_ne_publie_ni_url_ni_reference(self, monkeypatch):
        """`requests` met l'URL dans son message : elle ne doit pas sortir."""
        _echec(
            monkeypatch,
            requests.ConnectionError(f"Max retries exceeded with url: {URL_FACTICE}"),
        )

        bloc = diagnostic()
        publie = json.dumps(bloc)

        assert bloc["cause"] == "reseau" and bloc["last_status"] is None
        assert "INV-424242" not in publie, "une référence de facture fuit dans /health"
        assert "paydunya.com" not in publie, "l'URL appelée fuit dans /health"

    def test_une_reponse_non_json_se_lit_illisible(self, monkeypatch):
        with pytest.raises(ValueError):
            _appel(monkeypatch, _Reponse(200, illisible=True))

        bloc = diagnostic()

        assert bloc["cause"] == "illisible" and bloc["last_status"] == 200
        assert "journal" in bloc["motif"], "le remède est de lire le journal applicatif"


class TestLeCircuitEtLeDiagnostic:
    def test_au_seuil_le_circuit_s_ouvre_et_le_motif_dit_le_refroidissement(
        self, monkeypatch
    ):
        monkeypatch.setattr(kojo_payments, "PAYDUNYA_CIRCUIT_FAILURE_THRESHOLD", 2)
        for _ in range(2):
            _echec(monkeypatch, requests.ConnectionError("réseau"))

        bloc = diagnostic()

        assert bloc["circuit"] == "open" and bloc["consecutive_failures"] == 2
        assert bloc["state"] == "echec"
        assert "circuit ouvert" in bloc["motif"]
        assert bloc["remaining_cooldown_seconds"] > 0
        assert "réouverture automatique" in bloc["motif"], (
            "un motif qui alarmerait sans dire que rien n'est à faire côté Kojo "
            "enverrait quelqu'un réparer une panne fournisseur"
        )

    def test_un_succes_remet_le_compteur_sans_effacer_la_trace(self, monkeypatch):
        _echec(monkeypatch, requests.HTTPError(f"500 pour {URL_FACTICE}", response=_Reponse(500)))
        echec = diagnostic()["last_failure_at"]
        assert echec

        _appel(monkeypatch, _Reponse(200))
        bloc = diagnostic()

        assert bloc["state"] == "ok" and bloc["consecutive_failures"] == 0
        assert bloc["last_failure_at"] == echec, (
            "effacer la trace d'une panne récente ferait perdre la reprise qui "
            "vient d'avoir lieu — `state` dit déjà `ok`"
        )

    def test_chaque_cause_et_chaque_statut_ont_un_motif(self):
        assert set(MOTIFS_PAR_CAUSE) == {
            "non_configure",
            "reseau",
            "illisible",
            "cles_refusees",
            "quota",
            "fournisseur",
            "requete_refusee",
            "circuit_ouvert",
        }
        for cause, motif in MOTIFS_PAR_CAUSE.items():
            assert motif.strip(), f"la cause {cause} n'a pas de motif"
            assert "http" not in motif.lower(), f"le motif {cause} cite une URL"
        for statut, motif in MOTIFS_PAR_STATUT.items():
            assert motif.strip(), f"le statut {statut} n'a pas de motif"


class TestLaReponseDeHealth:
    @pytest.fixture(scope="class")
    def client(self):
        from fastapi.testclient import TestClient

        import server

        return TestClient(server.app)

    def test_health_publie_le_bloc_paiement_complet(self, client):
        reponse = client.get("/health")

        assert reponse.status_code == 200
        bloc = reponse.json().get("paiement")
        assert isinstance(bloc, dict), "/health ne publie pas de bloc `paiement`"
        assert set(bloc) == {
            "configured",
            "state",
            "cause",
            "motif",
            "last_status",
            "consecutive_failures",
            "failure_threshold",
            "circuit",
            "remaining_cooldown_seconds",
            "last_call_at",
            "last_failure_at",
            "last_success_at",
        }
        assert bloc["state"] in {"ok", "echec", "inconnu"}

    def test_health_ne_publie_aucune_valeur_de_cle(self, client):
        """`/health` est PUBLIQUE : les clés PayDunya y donneraient le compte."""
        corps = client.get("/health").text

        for valeur in CLES.values():
            assert valeur not in corps, f"la clé « {valeur} » apparaît dans /health"

    def test_le_monitor_publie_le_meme_diagnostic(self, client):
        """Un moniteur d'infra doit pouvoir lire POURQUOI, pas seulement QUE."""
        reponse = client.get("/monitor/paydunya")

        assert reponse.status_code == 200
        assert reponse.json().get("paiement") == diagnostic()
