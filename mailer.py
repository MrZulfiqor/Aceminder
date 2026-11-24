"""Aceminder email: sends the six-digit verification and password-reset codes.

Easiest setup is a Gmail account with an App Password (two lines in .env):
    GMAIL_ADDRESS=you@gmail.com
    GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
Any other provider works through SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM.

With nothing configured, codes are printed in the server window so the owner can still use
and test every flow on their own computer.
"""

import os
import smtplib
import ssl
import sys
import threading
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from html import escape

_lock = threading.Lock()
_state = {"state": "unchecked", "detail": ""}


class MailError(Exception):
    """Email could not be sent. The message is for the server owner, not the visitor."""


def _env(name):
    return os.environ.get(name, "").strip()


def settings():
    """Return the SMTP settings, or None when email is not set up."""
    gmail = _env("GMAIL_ADDRESS")
    if gmail and _env("GMAIL_APP_PASSWORD"):
        return {
            "host": "smtp.gmail.com", "port": 587, "user": gmail,
            # Google displays App Passwords in groups of four; the spaces are not part of it.
            "password": "".join(_env("GMAIL_APP_PASSWORD").split()),
            "from_name": "Aceminder", "from_address": gmail,
        }
    if _env("SMTP_HOST") and _env("SMTP_FROM"):
        name, address = parseaddr(_env("SMTP_FROM"))
        try:
            port = int(_env("SMTP_PORT") or "587")
        except ValueError:
            port = 587
        return {
            "host": _env("SMTP_HOST"), "port": port, "user": _env("SMTP_USER"),
            "password": _env("SMTP_PASSWORD"),
            "from_name": name or "Aceminder", "from_address": address,
        }
    return None


def configured():
    return settings() is not None


def status():
    with _lock:
        return dict(_state)


def _set_state(state, detail=""):
    with _lock:
        _state.update(state=state, detail=detail)


def _explain(error, config):
    """Turn an SMTP problem into advice the site owner can act on."""
    if isinstance(error, smtplib.SMTPAuthenticationError):
        if "gmail" in config["host"]:
            return (
                "Gmail refused the login. Use a 16-letter App Password from "
                "https://myaccount.google.com/apppasswords (2-Step Verification must be on), "
                "not your normal Gmail password."
            )
        return "The mail server refused the login. Check SMTP_USER and SMTP_PASSWORD."
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "The mail server refused that recipient address."
    if isinstance(error, (ssl.SSLError, smtplib.SMTPNotSupportedError)):
        return f"A secure connection to {config['host']}:{config['port']} failed. Check SMTP_PORT (587 or 465)."
    if isinstance(error, OSError) and not isinstance(error, smtplib.SMTPException):
        return f"Could not reach {config['host']}:{config['port']}. Check the internet connection or firewall."
    return f"The mail server reported a problem ({type(error).__name__})."


def _connect(config):
    context = ssl.create_default_context()
    if config["port"] == 465:
        server = smtplib.SMTP_SSL(config["host"], config["port"], timeout=20, context=context)
    else:
        server = smtplib.SMTP(config["host"], config["port"], timeout=20)
    try:
        if config["port"] != 465:
            server.starttls(context=context)
        if config["user"]:
            server.login(config["user"], config["password"])
    except Exception:
        server.close()
        raise
    return server


def check():
    """Log in to the mail server once so a wrong password is reported at startup."""
    config = settings()
    if config is None:
        _set_state("off")
        return False, "Email is not set up."
    try:
        with _connect(config):
            pass
    except (OSError, smtplib.SMTPException, ValueError) as error:
        detail = _explain(error, config)
        _set_state("error", detail)
        return False, detail
    _set_state("ok")
    return True, f"Signed in to {config['host']} as {config['user'] or config['from_address']}."


def send(to, subject, text, html):
    config = settings()
    if config is None:
        raise MailError("Email is not set up.")
    message = EmailMessage()
    message["From"] = formataddr((config["from_name"], config["from_address"]))
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = formatdate()
    message["Message-ID"] = make_msgid(domain=config["from_address"].rpartition("@")[2] or None)
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    try:
        with _connect(config) as server:
            server.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError) as error:
        detail = _explain(error, config)
        if not isinstance(error, smtplib.SMTPRecipientsRefused):
            _set_state("error", detail)
        print(f"EMAIL PROBLEM: {detail}", file=sys.stderr, flush=True)
        raise MailError(detail) from error
    _set_state("ok")


# ---------------------------------------------------------------- the code emails

TEXTS = {
    "English": {
        "verify_subject": "{code} is your Aceminder code",
        "verify_title": "Confirm your email",
        "verify_body": "Welcome to Aceminder! Enter this code to finish setting up your account:",
        "reset_subject": "{code} is your Aceminder password reset code",
        "reset_title": "Reset your password",
        "reset_body": "Enter this code in Aceminder to choose a new password:",
        "expires": "The code works for 10 minutes. Never share it with anyone.",
        "ignore": "Didn't ask for this? You can safely ignore this email.",
    },
    "Uzbek": {
        "verify_subject": "{code} — Aceminder kodingiz",
        "verify_title": "Emailingizni tasdiqlang",
        "verify_body": "Aceminderga xush kelibsiz! Hisobingizni yakunlash uchun ushbu kodni kiriting:",
        "reset_subject": "{code} — Aceminder parolini tiklash kodi",
        "reset_title": "Parolni tiklash",
        "reset_body": "Yangi parol tanlash uchun ushbu kodni Aceminderga kiriting:",
        "expires": "Kod 10 daqiqa amal qiladi. Uni hech kimga bermang.",
        "ignore": "Buni siz so‘ramadingizmi? Bu xatga e’tibor bermasangiz ham bo‘ladi.",
    },
    "Russian": {
        "verify_subject": "{code} — ваш код Aceminder",
        "verify_title": "Подтвердите email",
        "verify_body": "Добро пожаловать в Aceminder! Введите этот код, чтобы завершить регистрацию:",
        "reset_subject": "{code} — код для сброса пароля Aceminder",
        "reset_title": "Сброс пароля",
        "reset_body": "Введите этот код в Aceminder, чтобы выбрать новый пароль:",
        "expires": "Код действует 10 минут. Никому его не сообщайте.",
        "ignore": "Вы этого не запрашивали? Просто проигнорируйте письмо.",
    },
    "Spanish": {
        "verify_subject": "{code} es tu código de Aceminder",
        "verify_title": "Confirma tu email",
        "verify_body": "¡Te damos la bienvenida a Aceminder! Escribe este código para terminar de crear tu cuenta:",
        "reset_subject": "{code} es tu código para restablecer la contraseña",
        "reset_title": "Restablece tu contraseña",
        "reset_body": "Escribe este código en Aceminder para elegir una nueva contraseña:",
        "expires": "El código dura 10 minutos. No lo compartas con nadie.",
        "ignore": "¿No lo has pedido tú? Puedes ignorar este mensaje.",
    },
    "German": {
        "verify_subject": "{code} ist dein Aceminder-Code",
        "verify_title": "Bestätige deine E-Mail",
        "verify_body": "Willkommen bei Aceminder! Gib diesen Code ein, um dein Konto fertig einzurichten:",
        "reset_subject": "{code} ist dein Code zum Zurücksetzen des Passworts",
        "reset_title": "Passwort zurücksetzen",
        "reset_body": "Gib diesen Code in Aceminder ein, um ein neues Passwort zu wählen:",
        "expires": "Der Code gilt 10 Minuten. Gib ihn niemandem weiter.",
        "ignore": "Das warst nicht du? Dann kannst du diese E-Mail ignorieren.",
    },
    "French": {
        "verify_subject": "{code} est ton code Aceminder",
        "verify_title": "Confirme ton email",
        "verify_body": "Bienvenue sur Aceminder ! Saisis ce code pour terminer la création de ton compte :",
        "reset_subject": "{code} est ton code de réinitialisation Aceminder",
        "reset_title": "Réinitialise ton mot de passe",
        "reset_body": "Saisis ce code dans Aceminder pour choisir un nouveau mot de passe :",
        "expires": "Le code est valable 10 minutes. Ne le partage avec personne.",
        "ignore": "Tu n’as rien demandé ? Tu peux ignorer cet email.",
    },
}


def code_email(purpose, code, language="English"):
    """Return (subject, text, html) for a verification or password-reset code."""
    words = TEXTS.get(language, TEXTS["English"])
    kind = "reset" if purpose == "reset" else "verify"
    subject = words[f"{kind}_subject"].format(code=code)
    title, body = words[f"{kind}_title"], words[f"{kind}_body"]
    text = f"{title}\n\n{body}\n\n    {code}\n\n{words['expires']}\n{words['ignore']}\n\nAceminder\n"
    html = f"""<!doctype html>
<html><body style="margin:0;padding:28px 12px;background:#eef1f8;font-family:Arial,Helvetica,sans-serif;color:#101d33">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="padding:22px 30px;background:#0f1e3d;color:#f6c453;font-size:20px;font-weight:bold">Aceminder</td></tr>
<tr><td style="padding:30px">
<h1 style="margin:0 0 12px;font-size:24px">{escape(title)}</h1>
<p style="margin:0 0 22px;font-size:16px;line-height:1.5">{escape(body)}</p>
<p style="margin:0 0 22px;padding:18px;background:#fff6dd;border:1px solid #f0d48a;border-radius:14px;text-align:center;font-size:36px;font-weight:bold;letter-spacing:10px;font-family:Consolas,monospace">{escape(code)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#5f6b80">{escape(words['expires'])}</p>
<p style="margin:0;font-size:14px;line-height:1.5;color:#5f6b80">{escape(words['ignore'])}</p>
</td></tr></table></td></tr></table></body></html>"""
    return subject, text, html


def deliver_code(purpose, to, code, language):
    """Email the code, or print it in the server window when email is not set up."""
    if not configured():
        label = "password reset" if purpose == "reset" else "email verification"
        # ASCII only: some Windows consoles cannot print anything else.
        print(f"\n  *** Aceminder {label} code for {to}:  {code}  (valid 10 minutes) ***\n", flush=True)
        return
    send(to, *code_email(purpose, code, language))
