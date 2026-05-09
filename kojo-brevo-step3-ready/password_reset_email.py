from brevo_mailer import send_brevo_email


def send_password_reset_email(to_email, code, expires_in_minutes=10):
    subject = "Code de réinitialisation KOJO"

    html_content = f"""
    <div style=\"font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#ffffff;color:#111827;\">
      <h2 style=\"margin:0 0 16px 0;\">Réinitialisation de mot de passe KOJO</h2>
      <p>Bonjour,</p>
      <p>Voici votre code de réinitialisation :</p>
      <div style=\"font-size:32px;font-weight:700;letter-spacing:6px;padding:16px 20px;background:#f3f4f6;border-radius:12px;display:inline-block;margin:12px 0 20px 0;\">{code}</div>
      <p>Ce code expire dans <strong>{expires_in_minutes} minutes</strong>.</p>
      <p>Si vous n'avez pas demandé cette réinitialisation, ignorez simplement ce message.</p>
      <p>KOJO</p>
    </div>
    """

    text_content = (
        f"Code de réinitialisation KOJO: {code}. "
        f"Ce code expire dans {expires_in_minutes} minutes. "
        f"Si vous n'avez pas demandé cette réinitialisation, ignorez ce message."
    )

    return send_brevo_email(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
        tags=["password-reset", "kojo"],
    )
