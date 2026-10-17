# -*- coding: utf-8 -*-
"""Garde de la sonde email du fournisseur ACTIF (``/monitor/email``).

Ce qui est mesuré ici, et rien d'autre : le fournisseur qu'un envoi utiliserait
MAINTENANT est celui que la sonde juge, elle dit SON NOM, et elle rougit sur les
deux modes d'échec qui coûtent un utilisateur — le fournisseur MUET (transport,
clé refusée, config incomplète, `EMAIL_PROVIDER=none`) et l'expéditeur MAL
CONFIGURÉ (domaine Resend non vérifié, expéditeur Brevo inactif, jeton Gmail
révoqué).

Aucun réseau : les transports sont remplacés à l'endroit où la sonde les lit
(`kojo_email.requests.get`, `kojo_email.get_gmail_access_token`). Les tests du
composite remplacent les sondes là où `server.py` les utilise — patcher le
module de définition laisserait la référence importée intacte.

Le cas « clé restreinte » mérite d'être nommé : une clé Resend `sending_access`
est LÉGITIME et ne peut pas lire `/domains`. La sonde ne doit ni inventer un
rouge (les envois marchent) ni publier un vert muet : elle répond 200 en disant
que l'expéditeur n'a PAS été jugé.
"""
import contextlib
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient

import kojo_email
import server

DOMAINE = "kojoforafrica.cc.cd"
EXPEDITEUR_RESEND = "noreply@%s" % DOMAINE


def _patchs(contexte):
    """Applique plusieurs attributs dans un seul `with` (l'ordre n'importe pas)."""
    pile = contextlib.ExitStack()
    for cible, valeur in contexte.items():
        pile.enter_context(patch(cible, valeur))
    return pile


def _reponse(status=200, charge=None, texte=""):
    """Une réponse HTTP factice : statut, `.ok`, corps JSON et corps texte."""
    reponse = MagicMock()
    reponse.status_code = status
    reponse.ok = 200 <= status < 400
    reponse.text = texte
    reponse.json.return_value = charge if charge is not None else {}
    return reponse


@pytest.fixture(autouse=True)
def _cache_vide():
    """Le cache TTL (60 s) est GLOBAL : sans ce nettoyage, un cas servirait le
    verdict du précédent et passerait pour de mauvaises raisons."""
    kojo_email._email_health_cache.clear()
    yield
    kojo_email._email_health_cache.clear()


# ---------------------------------------------------------------------------
# Résolution : une seule règle, partagée par l'envoi et par la sonde
# ---------------------------------------------------------------------------

class TestResolutionDuFournisseur:
    def test_un_nom_connu_est_rendu_sans_note(self):
        for nom in ("brevo", "resend", "gmail", "none", "Resend", " BREVO "):
            with patch("kojo_email.EMAIL_PROVIDER", nom):
                provider, note = kojo_email.active_email_provider()
            assert provider == nom.strip().lower()
            assert note == ""

    def test_un_nom_inconnu_est_nomme_pas_avale(self):
        """`resnd` retombe sur Brevo — c'est le comportement d'avant, mais une
        faute de frappe qui se tait est une panne invisible."""
        with patch("kojo_email.EMAIL_PROVIDER", "resnd"):
            provider, note = kojo_email.active_email_provider()

        assert provider == "brevo"
        assert "resnd" in note and "inconnu" in note

    @pytest.mark.asyncio
    async def test_la_sonde_juge_le_fournisseur_que_l_envoi_utilise(self):
        """Le risque réel : deux résolutions divergentes. Sous `resnd`, l'envoi
        part par Brevo ET la sonde juge Brevo — les deux disent la même chose."""
        with patch("kojo_email.EMAIL_PROVIDER", "resnd"), \
             patch("kojo_email.send_email_via_brevo_api", return_value={"ok": 1}) as brevo, \
             patch("kojo_email.send_email_via_resend_api") as resend, \
             patch("kojo_email.brevo_is_configured", return_value=True), \
             patch("kojo_email.adresse_supprimee", return_value=None), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"senders": [{"email": "expediteur@x.test", "active": True}]}
             )):
            await kojo_email.send_email_via_active_provider("destinataire@example.com", "S", "C")
            verdict = kojo_email.active_email_provider_health_probe()

        assert brevo.call_count == 1
        assert resend.call_count == 0
        assert verdict["provider"] == "brevo"
        assert "resnd" in verdict["provider_note"]


# ---------------------------------------------------------------------------
# Resend : clé + domaine de l'expéditeur
# ---------------------------------------------------------------------------

def _resend_actif(**patchs):
    """Le contexte « Resend configuré et actif », surchargeable par test."""
    contexte = {
        "kojo_email.EMAIL_PROVIDER": "resend",
        "kojo_email.RESEND_API_KEY": "re_test",
        "kojo_email.RESEND_SENDER_EMAIL": EXPEDITEUR_RESEND,
    }
    contexte.update(patchs)
    return contexte


class TestMonitorEmailResend:
    @pytest.mark.asyncio
    async def test_domaine_verifie_200_et_nomme_le_fournisseur(self, client: AsyncClient):
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"data": [{"name": DOMAINE, "status": "verified"}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "email"
        assert data["provider"] == "resend"
        assert data["circuit"] == "ok"
        assert data["configured"] is True
        assert DOMAINE in data["detail"]

    @pytest.mark.asyncio
    async def test_domaine_absent_503(self, client: AsyncClient):
        """Le cas qui coûte un utilisateur : Resend n'écrit alors qu'à l'adresse
        du compte, donc tous les vrais destinataires échouent — clé valide."""
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"data": [{"name": "autre-domaine.test", "status": "verified"}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["circuit"] == "down"
        assert data["configured"] is True
        assert "absent" in data["detail"]

    @pytest.mark.asyncio
    async def test_domaine_non_verifie_503_et_dit_le_statut(self, client: AsyncClient):
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"data": [{"name": DOMAINE, "status": "pending"}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert "pending" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_partiellement_verifie_mais_envoi_actif_reste_vert(self, client: AsyncClient):
        """Juger sur le seul statut rendrait rouge un domaine qui envoie : la
        capacité `sending` est ce qui décide pour un email transactionnel."""
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"data": [{
                     "name": DOMAINE,
                     "status": "partially_verified",
                     "capabilities": {"sending": "enabled", "receiving": "disabled"},
                 }]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200
        assert "partially_verified" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_transport_503(self, client: AsyncClient):
        import requests as _requests

        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get",
                   side_effect=_requests.ConnectionError("Resend down")):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is True
        assert "Transport Resend" in data["detail"]

    @pytest.mark.asyncio
    async def test_non_configure_503_en_nommant_les_variables(self, client: AsyncClient):
        with _patchs(_resend_actif(**{"kojo_email.RESEND_API_KEY": ""})), \
             patch("kojo_email.requests.get") as get_mock:
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is False
        assert "RESEND_API_KEY" in data["detail"]
        assert get_mock.call_count == 0

    @pytest.mark.asyncio
    async def test_cle_restreinte_200_mais_dit_qu_elle_n_a_pas_juge(self, client: AsyncClient):
        """Une clé `sending_access` est légitime : Resend l'accepte et refuse la
        lecture. Vert sur la joignabilité, et le détail dit le trou de mesure —
        ni faux rouge, ni vert muet."""
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 401,
                 {},
                 texte='{"statusCode":401,"name":"restricted_api_key","message":"restricted"}',
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200
        data = resp.json()
        assert data["circuit"] == "ok"
        assert "NON JUGÉ" in data["detail"]

    @pytest.mark.asyncio
    async def test_cle_refusee_503(self, client: AsyncClient):
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 401, {}, texte='{"statusCode":400,"name":"validation_error","message":"API key is invalid"}'
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert "refusé la clé" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_reponse_illisible_503(self, client: AsyncClient):
        illisible = _reponse(200)
        illisible.json.side_effect = ValueError("pas du JSON")

        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=illisible):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert "illisible" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_cache_ttl_un_seul_appel(self, client: AsyncClient):
        with _patchs(_resend_actif()), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"data": [{"name": DOMAINE, "status": "verified"}]}
             )) as get_mock:
            premier = await client.get("/monitor/email")
            second = await client.get("/monitor/email")

        assert premier.status_code == 200 and second.status_code == 200
        assert get_mock.call_count == 1


# ---------------------------------------------------------------------------
# Brevo : l'expéditeur RÉELLEMENT utilisé, pas la variable de config
# ---------------------------------------------------------------------------

class TestMonitorEmailBrevo:
    @pytest.mark.asyncio
    async def test_expediteur_actif_200(self, client: AsyncClient):
        with patch("kojo_email.EMAIL_PROVIDER", "brevo"), \
             patch("kojo_email.BREVO_API_KEY", "cle-brevo"), \
             patch("kojo_email.BREVO_SENDER_EMAIL", "noreply@x.test"), \
             patch("kojo_email.PASSWORD_RESET_FROM_EMAIL", "noreply@x.test"), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"senders": [{"email": "noreply@x.test", "active": True}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "brevo"
        assert "noreply@x.test" in data["detail"]

    @pytest.mark.asyncio
    async def test_l_expediteur_juge_est_celui_qui_part(self, client: AsyncClient):
        """`PASSWORD_RESET_FROM_EMAIL` prime dans l'envoi : une sonde qui
        regarderait `BREVO_SENDER_EMAIL` verdirait sur une adresse inutilisée."""
        with patch("kojo_email.EMAIL_PROVIDER", "brevo"), \
             patch("kojo_email.BREVO_API_KEY", "cle-brevo"), \
             patch("kojo_email.BREVO_SENDER_EMAIL", "noreply@x.test"), \
             patch("kojo_email.PASSWORD_RESET_FROM_EMAIL", "alias@x.test"), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"senders": [{"email": "alias@x.test", "active": True}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200, resp.text
        assert "alias@x.test" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_expediteur_inactif_503(self, client: AsyncClient):
        with patch("kojo_email.EMAIL_PROVIDER", "brevo"), \
             patch("kojo_email.BREVO_API_KEY", "cle-brevo"), \
             patch("kojo_email.BREVO_SENDER_EMAIL", "noreply@x.test"), \
             patch("kojo_email.PASSWORD_RESET_FROM_EMAIL", "noreply@x.test"), \
             patch("kojo_email.requests.get", return_value=_reponse(
                 200, {"senders": [{"email": "noreply@x.test", "active": False}]}
             )):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is True
        assert "inactif" in data["detail"]

    @pytest.mark.asyncio
    async def test_expediteur_absent_503(self, client: AsyncClient):
        with patch("kojo_email.EMAIL_PROVIDER", "brevo"), \
             patch("kojo_email.BREVO_API_KEY", "cle-brevo"), \
             patch("kojo_email.BREVO_SENDER_EMAIL", "noreply@x.test"), \
             patch("kojo_email.PASSWORD_RESET_FROM_EMAIL", "noreply@x.test"), \
             patch("kojo_email.requests.get", return_value=_reponse(200, {"senders": []})):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert "absent" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_transport_503(self, client: AsyncClient):
        import requests as _requests

        with patch("kojo_email.EMAIL_PROVIDER", "brevo"), \
             patch("kojo_email.BREVO_API_KEY", "cle-brevo"), \
             patch("kojo_email.BREVO_SENDER_EMAIL", "noreply@x.test"), \
             patch("kojo_email.requests.get",
                   side_effect=_requests.ConnectionError("Brevo down")):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert "Transport Brevo" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Gmail : le refresh token est le vrai mode d'échec
# ---------------------------------------------------------------------------

class TestMonitorEmailGmail:
    @pytest.mark.asyncio
    async def test_jeton_obtenu_200(self, client: AsyncClient):
        with patch("kojo_email.EMAIL_PROVIDER", "gmail"), \
             patch("kojo_email.GMAIL_CLIENT_ID", "id"), \
             patch("kojo_email.GMAIL_CLIENT_SECRET", "secret"), \
             patch("kojo_email.GMAIL_REFRESH_TOKEN", "refresh"), \
             patch("kojo_email.GMAIL_SENDER_EMAIL", "expediteur@gmail.com"), \
             patch("kojo_email.get_gmail_access_token", return_value="ya29.jeton"):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "gmail"
        assert data["circuit"] == "ok"

    @pytest.mark.asyncio
    async def test_jeton_refuse_503(self, client: AsyncClient):
        from fastapi import HTTPException

        with patch("kojo_email.EMAIL_PROVIDER", "gmail"), \
             patch("kojo_email.GMAIL_CLIENT_ID", "id"), \
             patch("kojo_email.GMAIL_CLIENT_SECRET", "secret"), \
             patch("kojo_email.GMAIL_REFRESH_TOKEN", "refresh"), \
             patch("kojo_email.GMAIL_SENDER_EMAIL", "expediteur@gmail.com"), \
             patch("kojo_email.get_gmail_access_token",
                   side_effect=HTTPException(status_code=502, detail="refresh token révoqué")):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is True
        assert "Jeton Gmail refusé" in data["detail"]

    @pytest.mark.asyncio
    async def test_non_configure_503(self, client: AsyncClient):
        with patch("kojo_email.EMAIL_PROVIDER", "gmail"), \
             patch("kojo_email.GMAIL_CLIENT_ID", ""), \
             patch("kojo_email.GMAIL_CLIENT_SECRET", ""), \
             patch("kojo_email.GMAIL_REFRESH_TOKEN", ""), \
             patch("kojo_email.get_gmail_access_token") as jeton:
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        assert resp.json()["configured"] is False
        assert jeton.call_count == 0


# ---------------------------------------------------------------------------
# Aucun fournisseur : une panne d'email nommée, pas un mode silencieux
# ---------------------------------------------------------------------------

class TestMonitorEmailAucunFournisseur:
    @pytest.mark.asyncio
    async def test_email_provider_none_503_et_le_dit(self, client: AsyncClient):
        """`none` est un mode test/local ; en production, c'est « personne ne
        reçoit son code ». Un vert ici serait le silence qu'on veut éviter."""
        with patch("kojo_email.EMAIL_PROVIDER", "none"):
            resp = await client.get("/monitor/email")

        assert resp.status_code == 503
        data = resp.json()
        assert data["provider"] == "none"
        assert data["configured"] is False
        assert "aucun fournisseur actif" in data["detail"]


# ---------------------------------------------------------------------------
# Composite : le fournisseur email y entre, sans compter Brevo deux fois
# ---------------------------------------------------------------------------

def _sonde_email(ok=True, provider="resend"):
    return {
        "ok": ok,
        "configured": True,
        "detail": "sonde email de test" if ok else "email en panne",
        "provider": provider,
    }


@pytest.mark.asyncio
class TestCompositeAvecEmail:
    async def test_resend_actif_total_4(self, client: AsyncClient):
        with patch("server.active_email_provider_health_probe",
                   return_value=_sonde_email(True, "resend")), \
             patch("server.brevo_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "HTTP 200"}), \
             patch("server.cloudinary_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "ping ok"}):
            resp = await client.get("/monitor")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 4
        assert data["down"] == 0
        assert data["providers"]["email"]["circuit"] == "ok"
        assert data["providers"]["email"]["provider"] == "resend"
        assert "brevo" in data["providers"]

    async def test_brevo_actif_ne_compte_pas_deux_fois(self, client: AsyncClient):
        """Brevo actif : l'entrée `email` le juge déjà. Garder l'entrée `brevo`
        compterait la même panne deux fois et ferait pager un flap isolé, ce que
        le seuil existe pour éviter."""
        with patch("server.active_email_provider_health_probe",
                   return_value=_sonde_email(True, "brevo")), \
             patch("server.brevo_health_probe",
                   return_value={"ok": False, "configured": True, "detail": "HTTP 500"}), \
             patch("server.cloudinary_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "ping ok"}):
            resp = await client.get("/monitor")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["down"] == 0
        assert "brevo" not in data["providers"]

    async def test_email_seul_down_reste_200_au_seuil_par_defaut(self, client: AsyncClient):
        with patch("server.active_email_provider_health_probe",
                   return_value=_sonde_email(False, "resend")), \
             patch("server.brevo_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "HTTP 200"}), \
             patch("server.cloudinary_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "ping ok"}):
            resp = await client.get("/monitor")

        assert resp.status_code == 200
        data = resp.json()
        assert data["down"] == 1
        assert data["providers"]["email"]["circuit"] == "down"

    async def test_email_et_cloudinary_down_503(self, client: AsyncClient):
        with patch("server.active_email_provider_health_probe",
                   return_value=_sonde_email(False, "resend")), \
             patch("server.brevo_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "HTTP 200"}), \
             patch("server.cloudinary_health_probe",
                   return_value={"ok": False, "configured": True, "detail": "down"}):
            resp = await client.get("/monitor")

        assert resp.status_code == 503
        data = resp.json()
        assert data["circuit"] == "degraded"
        assert data["down"] == 2

    async def test_seuil_hors_bornes_refuse(self, client: AsyncClient):
        with patch("server.active_email_provider_health_probe",
                   return_value=_sonde_email(True, "resend")), \
             patch("server.brevo_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "HTTP 200"}), \
             patch("server.cloudinary_health_probe",
                   return_value={"ok": True, "configured": True, "detail": "ping ok"}):
            trop_haut = await client.get("/monitor?threshold=5")

        assert trop_haut.status_code == 422
