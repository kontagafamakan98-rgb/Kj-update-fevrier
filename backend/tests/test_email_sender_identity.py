"""
Identité d'envoi des emails transactionnels (Brevo).

Ce que ces tests verrouillent, et pourquoi :

  • Brevo envoie sous l'identité déclarée dans le payload : si l'expéditeur est
    une adresse Gmail, ni SPF, ni DKIM, ni DMARC du domaine ne s'appliquent ;
  • l'adresse d'envoi du domaine (noreply@…) n'a PAS de boîte : sans Reply-To,
    une réponse à un reçu de paiement rebondit silencieusement ;
  • une valeur de Reply-To VIDÉE ne doit produire aucun en-tête — Brevo refuse
    un replyTo vide (400), ce qui transformerait une variable effacée en panne
    d'envoi.
"""
from contextlib import ExitStack
from unittest.mock import patch

import kojo_email


class _FakeBrevoResponse:
    ok = True
    status_code = 201
    text = '{"messageId": "<test>"}'

    def json(self):
        return {"messageId": "<test>"}


def send_and_capture(**module_patches):
    """Exécute l'envoi réel, en interceptant seulement l'appel HTTP à Brevo."""
    with ExitStack() as stack:
        stack.enter_context(patch("kojo_email.brevo_is_configured", return_value=True))
        post = stack.enter_context(
            patch("kojo_email.requests.post", return_value=_FakeBrevoResponse())
        )
        for name, value in module_patches.items():
            stack.enter_context(patch(f"kojo_email.{name}", value))
        kojo_email.send_email_via_brevo_api(
            "destinataire@example.com", "Sujet", "corps"
        )

    return post.call_args.kwargs["json"]


def test_expediteur_du_domaine_et_reponses_vers_la_boite_de_contact():
    payload = send_and_capture(
        BREVO_SENDER_EMAIL="noreply@kojoforafrica.cc.cd",
        BREVO_REPLY_TO_EMAIL="boite-lue@example.com",
    )

    assert payload["sender"]["email"] == "noreply@kojoforafrica.cc.cd"
    assert payload["replyTo"]["email"] == "boite-lue@example.com"
    assert payload["to"] == [{"email": "destinataire@example.com"}]


def test_reply_to_vide_ne_produit_pas_d_en_tete_invalide():
    payload = send_and_capture(BREVO_REPLY_TO_EMAIL="")

    assert "replyTo" not in payload
