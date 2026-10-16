"""Outgoing email: sign-in codes and invitations."""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from ..config import Settings

log = logging.getLogger("grantflow.mail")


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    body: str


class EmailSender(Protocol):
    def send(self, message: Message) -> None: ...


class ConsoleEmailSender:
    """Development sender: prints each message to the server log.

    `outbox` keeps the messages so tests can read the codes they contain.
    """

    def __init__(self):
        self.outbox: list[Message] = []

    def send(self, message: Message) -> None:
        self.outbox.append(message)
        log.warning(
            "\n--- email (not sent; configure GRANTFLOW_SMTP_HOST) ---\n"
            "To: %s\nSubject: %s\n\n%s\n---",
            message.to,
            message.subject,
            message.body,
        )


class SmtpEmailSender:
    def __init__(self, settings: Settings):
        self.settings = settings

    def send(self, message: Message) -> None:
        email = EmailMessage()
        email["From"] = self.settings.email_from
        email["To"] = message.to
        email["Subject"] = message.subject
        email.set_content(message.body)
        with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
            if self.settings.smtp_starttls:
                smtp.starttls()
            if self.settings.smtp_username:
                smtp.login(self.settings.smtp_username, self.settings.smtp_password)
            smtp.send_message(email)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.smtp_host:
        return SmtpEmailSender(settings)
    if settings.environment == "production":
        raise RuntimeError("GRANTFLOW_SMTP_HOST is required in production for sign-in emails.")
    return ConsoleEmailSender()
