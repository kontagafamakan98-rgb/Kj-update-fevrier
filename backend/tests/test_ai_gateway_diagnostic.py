# -*- coding: utf-8 -*-
"""UNE PANNE DU GATEWAY NOMME SA CAUSE — SANS ACCÈS AUX JOURNAUX FLY.

Ce que ce fichier verrouille, et pourquoi il existe
---------------------------------------------------
Mesuré le 27/10/2026 : `POST /api/support/robot/chat` a rendu **502 en une
seconde, cinq fois sur cinq** (sonde de référence : trois questions, puis deux
appels directs), pendant que la sonde `ai-assistant-probe` était rouge depuis la
veille. Le refus était IMMÉDIAT (0,8–1,0 s contre un délai de 30 s), donc il ne
s'agissait ni d'un modèle lent ni d'un plafond de jetons : le gateway refusait
l'appel.

Trois réparations possibles, et trois personnes différentes : renouveler
`NEON_AI_GATEWAY_TOKEN` (401), recharger le crédit du compte (402), corriger le
modèle du catalogue (400/404). Le code les DISTINGUAIT déjà dans son journal
(`gateway HTTP <statut> : <corps>`) — mais lire ce journal demande un accès Fly,
et le site ne disait de sa propre panne que « L'assistant n'a pas pu répondre ».

Ce module publie donc la cause CLASSÉE sur `/health`, à côté du circuit PayDunya
qui suit la même règle. Ce qui est jugé ici :

  1. chaque genre d'échec pose la bonne cause et, quand il y a un statut HTTP,
     le bon statut — un 401 et un 402 ne demandent pas la même réparation ;
  2. le motif publié est ACTIONNABLE (il nomme le jeton, le crédit, le
     catalogue, le quota) ;
  3. le diagnostic ne porte JAMAIS le jeton, ni l'hôte de branche, ni le corps
     d'erreur — c'est une donnée de santé PUBLIQUE ;
  4. un succès remet le compteur consécutif à zéro mais n'efface pas la trace de
     l'échec précédent ;
  5. un gateway jamais appelé se lit `inconnu`, jamais `ok` : un silence n'est
     pas un vert (règle du dépôt, cf. les sondes de corpus vide) ;
  6. `/health` publie ce bloc — sans lui, le diagnostic existerait sans que
     personne ne le lise, ce qui est exactement la panne du 27/10.
"""

import json

import pytest
from httpx import AsyncClient

import kojo_ai_gateway as gateway
from kojo_ai_gateway import AiGatewayError, chat_completion, diagnostic, reinitialiser

# Des valeurs qui ne doivent JAMAIS apparaître dans un diagnostic publié : le
# jeton est le secret, l'hôte porte l'identifiant de branche Neon.
JETON = "nt_live_jeton_de_test_ne_doit_jamais_sortir"
HOTE = "https://branche-secrete-api.ai.example.tech"


class _Reponse:
    """Une réponse `requests` minimale : statut, corps, charge utile JSON."""

    def __init__(self, statut: int, corps: str = "", charge=None):
        self.status_code = statut
        self.text = corps
        self._charge = charge

    def json(self):
        if self._charge is None:
            raise ValueError("pas de JSON")
        return self._charge


def _repond(statut: int, corps: str = '{"error":{"message":"refus"}}'):
    """Un `requests.post` qui rend toujours le même statut."""

    def post(*args, **kwargs):
        return _Reponse(statut, corps)

    return post


def _repond_200(texte: str, finish_reason: str = "stop"):
    """Un `requests.post` qui rend une réponse exploitable."""

    def post(*args, **kwargs):
        return _Reponse(
            200,
            "",
            {
                "choices": [
                    {"message": {"content": texte}, "finish_reason": finish_reason}
                ]
            },
        )

    return post


@pytest.fixture(autouse=True)
def _gateway_configure_et_neuf(monkeypatch):
    """Un état neuf et un gateway configuré, pour chaque test.

    `reinitialiser()` est appelé AVANT et APRÈS : l'état est un global de
    module, et un test qui laisserait un échec derrière lui ferait lire à son
    voisin la panne d'un autre.
    """
    reinitialiser()
    monkeypatch.setattr(gateway, "AI_GATEWAY_BASE_URL", HOTE)
    monkeypatch.setattr(gateway, "AI_GATEWAY_TOKEN", JETON)
    monkeypatch.setattr(gateway, "AI_GATEWAY_MODEL", "claude-haiku-4-5")
    yield
    reinitialiser()


class TestClassementDeLaCause:
    """Chaque échec pose la cause et le statut qui permettent d'agir."""

    def test_un_jeton_refuse_nomme_le_jeton(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(401))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        etat = diagnostic()
        assert etat["state"] == "echec"
        assert etat["cause"] == "http"
        assert etat["last_status"] == 401
        assert etat["consecutive_failures"] == 1
        assert etat["last_failure_at"], "la date de l'échec est publiée"
        assert "401" in etat["motif"] and "jeton" in etat["motif"].lower()

    def test_un_credit_epuise_n_appelle_pas_la_meme_reparation(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(402))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        motif = diagnostic()["motif"]
        assert diagnostic()["last_status"] == 402
        assert "crédit" in motif.lower()
        # La distinction est le POINT : un motif commun aux deux renverrait
        # renouveler un jeton valide, ou recharger un compte qui n'est pas vide.
        assert motif != gateway.MOTIFS_PAR_STATUT[401]

    def test_un_modele_inconnu_nomme_le_catalogue(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(400))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        motif = diagnostic()["motif"]
        assert "catalogue" in motif.lower()
        assert "NEON_AI_GATEWAY_MODEL" in motif

    def test_un_429_nomme_le_modele_et_pas_le_quota_du_compte(self, monkeypatch):
        """Le 429 MESURÉ le 27/10/2026 n'était pas le quota du compte.

        Le corps du gateway disait « recursive/flint-v1.0:free is temporarily
        rate-limited upstream … or add your own key » : c'est le modèle LIBRE
        qui se met en file, pas le plafond du compte. Le motif doit donc envoyer
        vers le catalogue (changer de modèle), pas vers la facturation — et il
        reste distinct du 402.
        """
        monkeypatch.setattr(gateway.requests, "post", _repond(429))
        monkeypatch.setattr(gateway.time, "sleep", lambda s: None)

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        etat = diagnostic()
        assert etat["last_status"] == 429
        assert "saturé" in etat["motif"].lower()
        assert "NEON_AI_GATEWAY_MODEL" in etat["motif"]
        assert etat["motif"] != gateway.MOTIFS_PAR_STATUT[402]

    def test_un_gateway_en_panne_est_un_incident_fournisseur(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(502))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        motif = diagnostic()["motif"]
        assert "502" in motif and "fournisseur" in motif.lower()

    def test_une_panne_reseau_n_a_pas_de_statut(self, monkeypatch):
        def refuse(*args, **kwargs):
            raise gateway.requests.ConnectionError("connexion refusée")

        monkeypatch.setattr(gateway.requests, "post", refuse)

        with pytest.raises(AiGatewayError) as erreur:
            chat_completion([{"role": "user", "content": "Bonjour"}])

        etat = diagnostic()
        assert etat["cause"] == "reseau"
        assert etat["last_status"] is None
        assert "réseau" in etat["motif"].lower()
        # Le message d'erreur (journalisé) ne porte pas l'hôte de branche.
        assert "branche-secrete" not in str(erreur.value)

    def test_une_reponse_vide_et_une_reponse_tronquee_ont_leur_cause(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond_200("   "))
        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])
        assert diagnostic()["cause"] == "vide"

        monkeypatch.setattr(
            gateway.requests, "post", _repond_200("brouillon", finish_reason="length")
        )
        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])
        assert diagnostic()["cause"] == "tronquee"

    def test_un_gateway_non_configure_est_un_etat_pas_un_silence(self, monkeypatch):
        monkeypatch.setattr(gateway, "AI_GATEWAY_TOKEN", "")

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        etat = diagnostic()
        assert etat["configured"] is False
        assert etat["cause"] == "non_configure"
        assert "NEON_AI_GATEWAY_TOKEN" in etat["motif"]


class TestContinuiteDeLEtat:
    def test_le_compteur_monte_et_un_succes_le_remet_a_zero(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(401))
        for _ in range(2):
            with pytest.raises(AiGatewayError):
                chat_completion([{"role": "user", "content": "Bonjour"}])

        assert diagnostic()["consecutive_failures"] == 2
        assert diagnostic()["cause"] == "http"

        monkeypatch.setattr(gateway.requests, "post", _repond_200("La réponse."))
        assert chat_completion([{"role": "user", "content": "Bonjour"}]) == "La réponse."

        etat = diagnostic()
        assert etat["state"] == "ok"
        assert etat["consecutive_failures"] == 0
        assert etat["last_success_at"]
        # La trace de l'échec reste : c'est elle qui explique une reprise.
        assert etat["last_failure_at"]
        assert etat["motif"] == "", "un motif n'est publié que sur un échec en cours"

    def test_un_appel_jamais_fait_ne_se_lit_pas_comme_un_vert(self):
        etat = diagnostic()

        assert etat["state"] == "inconnu"
        assert etat["consecutive_failures"] == 0
        assert etat["last_failure_at"] is None
        assert etat["last_success_at"] is None

        # Le plancher qui compte : « inconnu » plutôt que « ok ».
        assert etat["state"] != "ok"


class TestLeDiagnosticEstPubliable:
    """C'est une donnée de santé PUBLIQUE : elle ne porte aucun secret."""

    def test_le_diagnostic_ne_porte_ni_jeton_ni_hote(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(401, f'{{"echo":"{JETON}"}}'))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        publie = json.dumps(diagnostic(), ensure_ascii=False)
        assert JETON not in publie
        assert "branche-secrete" not in publie
        assert "ai.example.tech" not in publie

    @pytest.mark.asyncio
    async def test_health_publie_la_cause_du_dernier_appel(self, client: AsyncClient, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(402))

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        reponse = await client.get("/health")

        assert reponse.status_code in (200, 503), reponse.text
        charge = reponse.json()
        assert "ai_gateway" in charge, "sans ce bloc, le diagnostic n'est lu par personne"
        bloc = charge["ai_gateway"]
        assert bloc["state"] == "echec"
        assert bloc["last_status"] == 402
        assert "crédit" in bloc["motif"].lower()
        assert bloc["consecutive_failures"] == 1
        assert bloc["model"] == "claude-haiku-4-5"
        # Le corps entier de la réponse ne porte ni le jeton ni l'hôte.
        assert JETON not in reponse.text
        assert "branche-secrete" not in reponse.text

    @pytest.mark.asyncio
    async def test_api_health_publie_le_meme_bloc(self, client: AsyncClient):
        """`/health` et `/api/health` partagent un payload : pas de dérive."""
        direct = (await client.get("/health")).json()
        via_api = (await client.get("/api/health")).json()

        assert direct["ai_gateway"] == via_api["ai_gateway"]


class TestModeleSature:
    """Un 429 du FOURNISSEUR est rejoué une fois (mesuré le 27/10/2026).

    Le log Fly disait, cinq fois : `gateway HTTP 429 … recursive/flint-v1.0:free
    is temporarily rate-limited upstream. Please retry shortly`. Le code rendait
    ce 429 au visiteur en 502 instantané, alors que le fournisseur demandait
    une seconde d'attente — et la sonde quotidienne restait rouge pour un
    modèle qui répondait deux fois sur trois.
    """

    def test_un_429_qui_passe_au_second_essai_rend_la_reponse(self, monkeypatch):
        essais = {"n": 0}

        def post(*args, **kwargs):
            essais["n"] += 1
            if essais["n"] == 1:
                return _Reponse(
                    429, '{"error":{"message":"temporarily rate-limited upstream"}}'
                )
            return _Reponse(
                200,
                "",
                {
                    "choices": [
                        {"message": {"content": "Voici comment faire."}, "finish_reason": "stop"}
                    ]
                },
            )

        attentes = []
        monkeypatch.setattr(gateway.requests, "post", post)
        monkeypatch.setattr(gateway.time, "sleep", lambda s: attentes.append(s))

        reponse = chat_completion([{"role": "user", "content": "Bonjour"}])

        assert reponse == "Voici comment faire."
        assert essais["n"] == 2, "le 429 doit être rejoué UNE fois"
        assert attentes and attentes[0] <= 5.0

        etat = diagnostic()
        assert etat["state"] == "ok"
        assert etat["consecutive_failures"] == 0, "un succès remet le compteur à zéro"

    def test_un_429_deux_fois_nomme_le_catalogue_jamais_le_jeton(self, monkeypatch):
        monkeypatch.setattr(gateway.requests, "post", _repond(429))
        monkeypatch.setattr(gateway.time, "sleep", lambda s: None)

        with pytest.raises(AiGatewayError):
            chat_completion([{"role": "user", "content": "Bonjour"}])

        etat = diagnostic()
        assert etat["cause"] == "http"
        assert etat["last_status"] == 429
        assert "NEON_AI_GATEWAY_MODEL" in etat["motif"]
        assert JETON not in json.dumps(etat, ensure_ascii=False)
        assert HOTE not in json.dumps(etat, ensure_ascii=False)

    def test_l_attente_du_429_est_bornee(self):
        """Un `Retry-After` déraisonnable ne bloque pas une requête publique."""

        class _AvecEntete:
            headers = {"Retry-After": "120"}

        class _SansEntete:
            headers = {}

        assert gateway._attente_429(_AvecEntete()) == 5.0
        assert gateway._attente_429(_SansEntete()) == 1.5
