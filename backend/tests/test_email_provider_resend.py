"""
Fournisseur Resend : contrat d'appel, contrat d'erreur, et le point de règle.

Ce que ces tests verrouillent, et pourquoi :

  • l'endpoint et l'en-tête d'authentification SONT le contrat de Resend
    (`POST https://api.resend.com/emails`, `Authorization: Bearer re_…`) : les
    réécrire ailleurs, c'est deux vérités pour un même envoi ;
  • l'expéditeur porte un nom d'affichage (« KOJO <noreply@…> ») et `reply_to`
    n'est posé que s'il est NON VIDE — Resend rejette une valeur vide, donc une
    variable effacée deviendrait une panne d'envoi au lieu d'un repli ;
  • un refus de Resend doit dire LAQUELLE des deux causes il a (clé ou domaine
    non vérifié) : sans ça, on cherche côté DNS ce qui est côté clé ;
  • `send_email_via_active_provider` est le SEUL juge du fournisseur. L'OTP et
    les alertes owner (tickets, circuit breaker, décaissement bloqué) doivent le
    traverser : sinon passer à Resend laisserait la moitié des emails sur Brevo,
    et ces alertes-là sont best-effort — elles se tairaient en silence.
"""
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import kojo_email


class _FakeResendResponse:
    """Réponse Resend minimale : `{"id": "..."}` sur 200."""

    ok = True
    status_code = 200
    text = '{"id": "email-test-id"}'

    def json(self):
        return {"id": "email-test-id"}


def _envoi_avec_capture(**patches_du_module):
    """Exécute l'envoi réel, en interceptant seulement l'appel HTTP à Resend.

    Tous les patchs restent posés PENDANT l'appel (ExitStack) : un `with`
    imbriqué rendrait la main avant l'envoi, et la fonction relirait les
    valeurs réelles — un test qui passe en ne mesurant rien.
    """
    with ExitStack() as pile:
        post = pile.enter_context(
            patch("kojo_email.requests.post", return_value=_FakeResendResponse())
        )
        for nom, valeur in patches_du_module.items():
            pile.enter_context(patch(f"kojo_email.{nom}", valeur))
        kojo_email.send_email_via_resend_api(
            "destinataire@example.com", "Sujet", "corps", "<p>corps</p>"
        )
    return post.call_args


class TestContratDAppel:
    def test_endpoint_cle_bearer_et_charge_utile(self):
        appel = _envoi_avec_capture(
            RESEND_API_KEY="re_cle_de_test",
            RESEND_SENDER_EMAIL="noreply@kojoforafrica.cc.cd",
        )

        assert appel.args[0] == "https://api.resend.com/emails"
        assert appel.kwargs["headers"]["Authorization"] == "Bearer re_cle_de_test"
        assert appel.kwargs["headers"]["Content-Type"] == "application/json"
        payload = appel.kwargs["json"]
        assert payload["from"] == "KOJO <noreply@kojoforafrica.cc.cd>"
        assert payload["to"] == ["destinataire@example.com"]
        assert payload["subject"] == "Sujet"
        assert payload["html"] == "<p>corps</p>"
        assert payload["text"] == "corps"

    def test_html_absent_retombe_sur_le_texte(self):
        with patch("kojo_email.requests.post", return_value=_FakeResendResponse()) as post, \
             patch("kojo_email.RESEND_API_KEY", "re_cle_de_test"), \
             patch("kojo_email.RESEND_SENDER_EMAIL", "noreply@kojoforafrica.cc.cd"), \
             patch("kojo_email.RESEND_SENDER_NAME", "KOJO"):
            kojo_email.send_email_via_resend_api("destinataire@example.com", "Sujet", "corps")

        assert post.call_args.kwargs["json"]["html"] == "<pre>corps</pre>"

    def test_nom_d_expediteur_et_reply_to(self):
        appel = _envoi_avec_capture(
            RESEND_API_KEY="re_cle_de_test",
            RESEND_SENDER_EMAIL="noreply@kojoforafrica.cc.cd",
            RESEND_SENDER_NAME="KOJO Support",
            RESEND_REPLY_TO_EMAIL="boite-lue@example.com",
        )

        payload = appel.kwargs["json"]
        assert payload["from"] == "KOJO Support <noreply@kojoforafrica.cc.cd>"
        assert payload["reply_to"] == "boite-lue@example.com"

    def test_reply_to_vide_ne_produit_pas_de_valeur_invalide(self):
        appel = _envoi_avec_capture(
            RESEND_API_KEY="re_cle_de_test",
            RESEND_SENDER_EMAIL="noreply@kojoforafrica.cc.cd",
            RESEND_REPLY_TO_EMAIL="",
        )

        assert "reply_to" not in appel.kwargs["json"]


class TestContratDErreur:
    def test_configuration_incomplete_nomme_les_variables(self):
        with patch("kojo_email.RESEND_API_KEY", ""), \
             patch("kojo_email.RESEND_SENDER_EMAIL", ""), \
             patch("kojo_email.requests.post") as post:
            with pytest.raises(HTTPException) as exc:
                kojo_email.send_email_via_resend_api("destinataire@example.com", "Sujet", "corps")

        assert exc.value.status_code == 503
        assert "RESEND_API_KEY" in exc.value.detail
        assert "RESEND_SENDER_EMAIL" in exc.value.detail
        post.assert_not_called()

    def test_transport_indisponible_502(self):
        import requests as _requests

        with patch("kojo_email.RESEND_API_KEY", "re_cle_de_test"), \
             patch("kojo_email.RESEND_SENDER_EMAIL", "noreply@kojoforafrica.cc.cd"), \
             patch("kojo_email.requests.post", side_effect=_requests.RequestException("Resend down")):
            with pytest.raises(HTTPException) as exc:
                kojo_email.send_email_via_resend_api("destinataire@example.com", "Sujet", "corps")

        assert exc.value.status_code == 502
        assert "Transport Resend" in exc.value.detail

    @pytest.mark.parametrize("statut", [401, 403])
    def test_refus_nomme_la_cle_et_le_domaine(self, statut):
        refus = _FakeResendResponse()
        refus.ok = False
        refus.status_code = statut
        refus.text = '{"message": "domain not verified"}'

        with patch("kojo_email.RESEND_API_KEY", "re_cle_de_test"), \
             patch("kojo_email.RESEND_SENDER_EMAIL", "noreply@kojoforafrica.cc.cd"), \
             patch("kojo_email.requests.post", return_value=refus):
            with pytest.raises(HTTPException) as exc:
                kojo_email.send_email_via_resend_api("destinataire@example.com", "Sujet", "corps")

        assert exc.value.status_code == 502
        assert "RESEND_API_KEY" in exc.value.detail
        assert "domaine" in exc.value.detail

    def test_refus_autre_que_401_403(self):
        refus = _FakeResendResponse()
        refus.ok = False
        refus.status_code = 422
        refus.text = '{"message": "invalid from"}'

        with patch("kojo_email.RESEND_API_KEY", "re_cle_de_test"), \
             patch("kojo_email.RESEND_SENDER_EMAIL", "noreply@kojoforafrica.cc.cd"), \
             patch("kojo_email.requests.post", return_value=refus):
            with pytest.raises(HTTPException) as exc:
                kojo_email.send_email_via_resend_api("destinataire@example.com", "Sujet", "corps")

        assert exc.value.status_code == 502
        assert "Resend" in exc.value.detail


class TestPointDeRegleUnique:
    """Le fournisseur est décidé à UN endroit, pour TOUS les envois."""

    SENDERS = (
        "send_email_via_brevo_api",
        "send_email_via_resend_api",
        "send_email_via_gmail_api",
    )

    @pytest.mark.parametrize(
        "fournisseur,attendu",
        [
            ("brevo", "send_email_via_brevo_api"),
            ("resend", "send_email_via_resend_api"),
            ("gmail", "send_email_via_gmail_api"),
        ],
    )
    @pytest.mark.asyncio
    async def test_le_fournisseur_actif_recoit_l_envoi(self, fournisseur, attendu):
        with ExitStack() as pile:
            pile.enter_context(patch("kojo_email.EMAIL_PROVIDER", fournisseur))
            mocks = {
                nom: pile.enter_context(patch(f"kojo_email.{nom}", return_value={"id": "x"}))
                for nom in self.SENDERS
            }
            await kojo_email.send_email_via_active_provider(
                "destinataire@example.com", "Sujet", "corps"
            )

        mocks[attendu].assert_called_once()
        assert mocks[attendu].call_args.args[0] == "destinataire@example.com"
        # Les autres fournisseurs n'ont PAS été touchés : un envoi, un seul
        # canal — c'est ce qu'un double envoi (Brevo ET Resend) violerait.
        for nom, mock in mocks.items():
            if nom != attendu:
                mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_fournisseur_inconnu_retombe_sur_brevo(self):
        # Une valeur mal orthographiée ne doit pas ÉTEINDRE les emails : elle
        # retombe sur le défaut (comportement d'avant ce point de règle).
        with patch("kojo_email.EMAIL_PROVIDER", "resnd"), \
             patch("kojo_email.send_email_via_brevo_api", return_value={"id": "x"}) as brevo:
            await kojo_email.send_email_via_active_provider("destinataire@example.com", "Sujet", "corps")

        brevo.assert_called_once()

    @pytest.mark.asyncio
    async def test_mode_none_n_envoie_rien(self):
        with patch("kojo_email.EMAIL_PROVIDER", "none"), \
             patch("kojo_email.send_email_via_brevo_api") as brevo, \
             patch("kojo_email.send_email_via_resend_api") as resend:
            resultat = await kojo_email.send_email_via_active_provider("destinataire@example.com", "Sujet", "corps")

        assert resultat is None
        brevo.assert_not_called()
        resend.assert_not_called()


@pytest.mark.asyncio
class TestLOTPSuitLeFournisseurActif:
    async def test_send_otp_passe_par_le_point_de_regle(self, client):
        """Le code OTP ne choisit plus son fournisseur lui-même.

        Le test juge l'EFFET : la route d'envoi d'OTP doit aboutir au point de
        règle, donc suivre EMAIL_PROVIDER comme les alertes owner. Une branche
        `if EMAIL_PROVIDER == …` remise dans la route ferait tomber ce test.
        """
        with patch("kojo_email.send_email_via_active_provider", new_callable=AsyncMock) as envoi:
            resp = await client.post(
                "/api/auth/email/send-otp",
                json={"email": "fournisseur-actif@example.com", "purpose": "signup"},
            )

        assert resp.status_code == 200, resp.text
        envoi.assert_called_once()
        assert envoi.call_args.args[0] == "fournisseur-actif@example.com"
        assert "vérification" in envoi.call_args.args[1].lower()


@pytest.mark.asyncio
class TestAlertesOwnerSuiventLeFournisseurActif:
    async def test_ticket_support_passe_par_le_point_de_regle(self, client):
        """Le ticket support envoyait Brevo en dur : il doit suivre le réglage.

        L'alerte vit dans `kojo_support_tickets` (propriétaire unique de
        l'ouverture d'un ticket, partagé avec l'escalade WhatsApp) : c'est donc
        LUI que le test remplace, et pas le routeur qui l'appelle.
        """
        with patch("kojo_support_tickets.send_email_via_active_provider", new_callable=AsyncMock) as envoi, \
             patch("kojo_support_tickets.OWNER_EMAIL", "owner@example.com"), \
             patch("kojo_support_tickets.notify_user_localized", AsyncMock()), \
             patch("kojo_support_tickets.resolve_owner_id", AsyncMock(return_value="owner-1")):
            resp = await client.post(
                "/api/support/tickets",
                json={
                    "full_name": "Client Test",
                    "email": "client@example.com",
                    "phone": "+221700000000",
                    "reason": "bug",
                    "message": "Le bouton ne répond pas.",
                },
            )

        assert resp.status_code in (200, 201), resp.text
        envoi.assert_called_once()
        assert envoi.call_args.args[0] == "owner@example.com"
