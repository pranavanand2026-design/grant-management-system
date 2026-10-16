"""Proving a firm controls an email domain before trusting it for sign-in."""

from __future__ import annotations

import re
import secrets

import dns.exception
import dns.resolver

RECORD_PREFIX = "_grantflow-verification"
VALUE_PREFIX = "grantflow-verification="

_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

# Shared mailbox providers: no firm can claim these for its sign-in.
PUBLIC_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "msn.com", "yahoo.com", "yahoo.com.au", "ymail.com", "icloud.com", "me.com",
    "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com",
    "bigpond.com", "bigpond.net.au", "optusnet.com.au", "hotmail.com.au",
    "outlook.com.au", "live.com.au", "fastmail.com", "yandex.com", "mail.com",
})


class InvalidDomain(ValueError):
    pass


def normalize_domain(value: str) -> str:
    domain = value.strip().lower().removeprefix("@").rstrip(".")
    if not _DOMAIN.match(domain):
        raise InvalidDomain("Enter a domain such as yourfirm.com.au.")
    if domain in PUBLIC_EMAIL_DOMAINS:
        raise InvalidDomain("Shared email providers can't be claimed by a firm.")
    return domain


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower()


def new_verification_token() -> str:
    return secrets.token_urlsafe(24)


def txt_record(domain: str, token: str) -> dict:
    return {
        "name": f"{RECORD_PREFIX}.{domain}",
        "type": "TXT",
        "value": f"{VALUE_PREFIX}{token}",
    }


def dns_has_token(domain: str, token: str) -> bool:
    expected = f"{VALUE_PREFIX}{token}"
    try:
        answers = dns.resolver.resolve(f"{RECORD_PREFIX}.{domain}", "TXT", lifetime=5)
    except (dns.exception.DNSException, OSError):
        return False
    for answer in answers:
        value = b"".join(answer.strings).decode(errors="ignore")
        if secrets.compare_digest(value, expected):
            return True
    return False
