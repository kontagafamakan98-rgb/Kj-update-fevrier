from fastapi import HTTPException
from password_reset_email import send_password_reset_email


def handle_password_reset_email(email, reset_code):
    try:
        send_password_reset_email(
            to_email=email,
            code=reset_code,
            expires_in_minutes=10,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Impossible d'envoyer l'email de réinitialisation: {exc}",
        ) from exc
