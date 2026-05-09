import os
import requests

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


class BrevoEmailError(Exception):
    pass


def send_brevo_email(to_email, subject, html_content, text_content=None, reply_to=None, tags=None):
    api_key = os.getenv("BREVO_API_KEY", "").strip()
    sender_email = os.getenv("BREVO_SENDER_EMAIL", "").strip()
    sender_name = os.getenv("BREVO_SENDER_NAME", "KOJO").strip() or "KOJO"

    if not api_key:
        raise BrevoEmailError("BREVO_API_KEY manquant")
    if not sender_email:
        raise BrevoEmailError("BREVO_SENDER_EMAIL manquant")
    if not to_email:
        raise BrevoEmailError("Email destinataire manquant")

    payload = {
        "sender": {
            "email": sender_email,
            "name": sender_name,
        },
        "to": [
            {
                "email": to_email,
            }
        ],
        "subject": subject,
        "htmlContent": html_content,
    }

    if text_content:
        payload["textContent"] = text_content
    if reply_to:
        payload["replyTo"] = reply_to
    if tags:
        payload["tags"] = tags

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": api_key,
    }

    try:
        response = requests.post(BREVO_API_URL, headers=headers, json=payload, timeout=30)
    except requests.RequestException as exc:
        raise BrevoEmailError(f"Erreur réseau Brevo: {exc}") from exc

    if response.status_code >= 400:
        raise BrevoEmailError(
            f"Brevo a refusé l'envoi ({response.status_code}): {response.text[:500]}"
        )

    try:
        return response.json()
    except ValueError:
        return {"raw_response": response.text}
