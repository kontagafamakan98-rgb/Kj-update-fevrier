# -*- coding: utf-8 -*-
"""Preuve d'échec du garde « le backend servi est-il celui de ce commit ? »
(`backend/scripts/check_deployed_revision.py`).

Ce qui est verrouillé ici, c'est ce qui DÉCIDE : le verdict ne peut pas être un
succès quand la révision servie est absente, différente, ou quand le service ne
répond pas — et chaque refus NOMME son coupable (le champ muet, le SHA servi, le
SHA attendu, le code HTTP), parce qu'un « échec » indistinct enverrait chercher
la cause au mauvais endroit.

Le garde est chargé PAR CHEMIN et interrogé avec un `fetch` injecté : aucun test
ne touche le réseau, donc la preuve dit la même chose sur un poste et sur un
runner. Deux capacités du garde y sont aussi exercées en vrai :
  • il ATTEND un déploiement en cours (une révision qui devient la bonne au
    2ᵉ essai est un succès), sans transformer un refus en succès ;
  • il refuse une invocation qui ne dit pas quoi comparer (code 2) au lieu de
    conclure sur du vide.
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "backend" / "scripts" / "check_deployed_revision.py"
DOCKERFILE = REPO_ROOT / "backend" / "Dockerfile"

SHA_ATTENDU = "4781ca2e76fa719408b8d7e9c07b0e06c90042ed"
SHA_SERVI = "51d2ac521e91a2ac7ba7bb4ddb82dfd346972f02"


def _charger_garde():
    spec = importlib.util.spec_from_file_location("check_deployed_revision", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def garde():
    return _charger_garde()


def _reponse(payload, statut=200):
    """Un `fetch` injecté : renvoie (statut, corps) comme le vrai."""
    def fetch(_url, _timeout=None):
        if isinstance(payload, Exception):
            raise payload
        corps = payload if isinstance(payload, (str, bytes)) else json.dumps(payload)
        return statut, corps.encode("utf-8") if isinstance(corps, str) else corps
    return fetch


class TestVerdict:
    def test_accepte_la_revision_attendue(self, garde):
        ok, message = garde.comparer(SHA_ATTENDU, SHA_ATTENDU)
        assert ok is True
        assert SHA_ATTENDU[:12] in message

    def test_refuse_une_revision_differente_en_nommant_les_deux(self, garde):
        """Le cas « déploiement sauté » : le service tourne le commit précédent.
        Le refus doit nommer les DEUX révisions, sinon on ne sait pas laquelle a
        gagné."""
        ok, message = garde.comparer(SHA_ATTENDU, SHA_SERVI)
        assert ok is False
        assert SHA_SERVI[:12] in message
        assert SHA_ATTENDU[:12] in message
        assert "≠" in message

    @pytest.mark.parametrize("muette", ["", "   ", "inconnue", "unknown", "none"])
    def test_refuse_une_revision_non_annoncee_en_nommant_le_champ(self, garde, muette):
        """Une image antérieure à ce mécanisme : le champ se tait. Le refus doit
        dire QUE c'est le champ qui manque (et quoi faire), pas « échec »."""
        ok, message = garde.comparer(SHA_ATTENDU, muette)
        assert ok is False
        assert "AUCUNE révision" in message
        assert "inconnue" in message  # la valeur qui doit alerter, citée
        assert "déploy" in message.lower() or "Redéployer" in message

    def test_la_reponse_reelle_est_lue_champ_par_champ(self, garde):
        assert garde.revision_annoncee({"revision": SHA_ATTENDU}) == SHA_ATTENDU
        assert garde.revision_annoncee({"revision": " inconnue "}) == ""
        assert garde.revision_annoncee({"version": "1.0.2"}) == ""  # pas de révision
        assert garde.revision_annoncee("pas un dict") == ""


class TestInterrogation:
    def test_refuse_une_reponse_non_json_en_nommant_la_cause(self, garde):
        payload, erreur = garde.interroger("https://exemple.test/health",
                                           fetch=_reponse("<html>502 Bad Gateway</html>"))
        assert payload is None
        assert "non JSON" in erreur

    def test_refuse_un_statut_non_200_en_nommant_le_code(self, garde):
        payload, erreur = garde.interroger("https://exemple.test/health",
                                           fetch=_reponse({}, statut=503))
        assert payload is None
        assert "503" in erreur

    def test_refuse_une_exception_reseau_en_la_nommant(self, garde):
        payload, erreur = garde.interroger("https://exemple.test/health",
                                           fetch=_reponse(TimeoutError("timed out")))
        assert payload is None
        assert "TimeoutError" in erreur


class TestAttenteDuDeploiement:
    def test_attend_que_la_revision_devienne_la_bonne(self, garde):
        """Un déploiement en cours : l'ancienne image répond encore. Le garde
        doit attendre, pas conclure au premier essai."""
        reponses = [{"revision": SHA_SERVI}, {"revision": SHA_ATTENDU}]
        appels = []

        def fetch(_url, _timeout=None):
            appels.append(1)
            return 200, json.dumps(reponses[min(len(appels) - 1, len(reponses) - 1)]).encode()

        ok, journal = garde.verifier_servi(
            "https://exemple.test/health", SHA_ATTENDU,
            fetch=fetch, tentatives=5, delai=0, dormir=lambda _s: None, log=lambda *_a: None,
        )
        assert ok is True
        assert len(appels) == 2
        assert len(journal) == 2

    def test_echoue_apres_le_nombre_de_tentatives_sans_boucler(self, garde):
        appels = []

        def fetch(_url, _timeout=None):
            appels.append(1)
            return 200, json.dumps({"revision": SHA_SERVI}).encode()

        ok, journal = garde.verifier_servi(
            "https://exemple.test/health", SHA_ATTENDU,
            fetch=fetch, tentatives=3, delai=0, dormir=lambda _s: None, log=lambda *_a: None,
        )
        assert ok is False
        assert len(appels) == 3
        assert SHA_SERVI[:12] in journal[-1] and SHA_ATTENDU[:12] in journal[-1]

    def test_un_service_injoignable_ne_passe_pas(self, garde):
        ok, journal = garde.verifier_servi(
            "https://exemple.test/health", SHA_ATTENDU,
            fetch=_reponse(ConnectionError("refused")), tentatives=2, delai=0,
            dormir=lambda _s: None, log=lambda *_a: None,
        )
        assert ok is False
        assert "aucune réponse exploitable" in journal[-1]


class TestInvocation:
    def test_refuse_de_conclure_sans_revision_attendue(self, garde):
        """Un garde qui ne sait pas quoi comparer ÉCHOUE (code 2) : passer serait
        un faux vert du même genre que le ✓ ambigu qu'il remplace."""
        for manquant in ("", "   ", "abc"):
            with pytest.raises(SystemExit) as refus:
                garde._valider_attendu(manquant)
            assert refus.value.code == 2

    def test_le_cli_sort_en_0_quand_la_revision_correspond(self, garde, monkeypatch):
        monkeypatch.setattr(garde, "interroger",
                            lambda _u, fetch=None: ({"revision": SHA_ATTENDU}, None))
        assert garde.main(["--attendu", SHA_ATTENDU, "--url", "https://exemple.test/health",
                           "--tentatives", "1", "--delai", "0"]) == 0

    def test_le_cli_sort_en_1_et_nomme_la_revision_servie(self, garde, monkeypatch, capsys):
        monkeypatch.setattr(garde, "interroger",
                            lambda _u, fetch=None: ({"revision": SHA_SERVI}, None))
        code = garde.main(["--attendu", SHA_ATTENDU, "--url", "https://exemple.test/health",
                           "--tentatives", "1", "--delai", "0"])
        sortie = capsys.readouterr().out
        assert code == 1
        assert "::error title=Révision déployée ≠ attendue::" in sortie
        assert SHA_SERVI[:12] in sortie and SHA_ATTENDU[:12] in sortie


class TestLeServiceAnnonceSaRevision:
    """Le service doit pouvoir RÉPONDRE à la question : c'est la moitié du
    mécanisme, et elle se prouve sur l'app réelle (client ASGI), pas sur un dict."""

    @pytest.mark.asyncio
    async def test_les_deux_health_checks_publient_la_revision(self, client):
        import kojo_settings

        attendue = kojo_settings.APP_REVISION or "inconnue"
        for route in ("/health", "/api/health"):
            corps = (await client.get(route)).json()
            assert corps["revision"] == attendue, route

    @pytest.mark.asyncio
    async def test_le_payload_de_health_ne_perd_pas_les_champs_existants(self, client):
        corps = (await client.get("/api/health")).json()
        for champ in ("status", "database", "version", "paydunya_circuit", "revision"):
            assert champ in corps, champ

    def test_la_revision_est_injectee_au_build(self):
        """Le lien entre les deux propriétaires du nom : la CI passe
        `--build-arg KOJO_GIT_SHA`, le Dockerfile doit la promouvoir en variable
        d'environnement — sans quoi /health publierait « inconnue » à jamais et le
        garde refuserait TOUS les déploiements (faux rouge permanent)."""
        texte = DOCKERFILE.read_text(encoding="utf-8")
        assert "ARG KOJO_GIT_SHA" in texte
        assert "ENV KOJO_GIT_SHA=$KOJO_GIT_SHA" in texte
        # La variable que kojo_settings lit réellement (même nom des deux côtés).
        settings = (REPO_ROOT / "backend" / "kojo_settings.py").read_text(encoding="utf-8")
        assert 'os.environ.get("KOJO_GIT_SHA"' in settings
