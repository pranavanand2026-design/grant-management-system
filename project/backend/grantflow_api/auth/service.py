from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
import uuid
from collections import defaultdict, deque
from threading import Lock
from typing import Protocol

import jwt
from fastapi import HTTPException, Request, status
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError

from ..config import Settings
from .models import Identity, Role


class Authenticator(Protocol):
    def authenticate(self, request: Request, token: str | None) -> Identity: ...


class DevelopmentAuthenticator:
    """Local identity provider. It is unavailable when GRANTFLOW_AUTH_MODE=entra."""

    def authenticate(self, request: Request, token: str | None) -> Identity:
        requested_role = request.headers.get(
            "X-GrantFlow-Development-Role",
            Role.ADMINISTRATOR.value,
        )
        try:
            role = Role(requested_role)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "invalid_development_role"},
            ) from exc
        if role == Role.CLIENT_CONTRIBUTOR:
            return Identity(
                tenant_id="development",
                object_id="client-preview",
                email="client@example.com",
                display_name="Client preview",
                development_role=role,
            )
        if role == Role.GRANT_ADVISER:
            return Identity(
                tenant_id="development",
                object_id="adviser-preview",
                email="adviser@grantflow.local",
                display_name="Grant adviser preview",
                development_role=role,
            )
        return Identity(
            tenant_id="development",
            object_id="grantflow-local",
            email="local@grantflow.local",
            display_name="Local Administrator",
            development_role=role,
        )


class EntraAuthenticator:
    def __init__(self, settings: Settings):
        if not settings.entra_tenant_id or not settings.entra_client_id:
            raise RuntimeError(
                "ENTRA_TENANT_ID and ENTRA_CLIENT_ID are required in Entra mode."
            )
        self.tenant_id = settings.entra_tenant_id
        self.client_id = settings.entra_client_id
        self.issuer = (
            f"https://login.microsoftonline.com/{self.tenant_id}/v2.0"
        )
        self.keys = PyJWKClient(
            f"https://login.microsoftonline.com/{self.tenant_id}/discovery/v2.0/keys"
        )

    def authenticate(self, request: Request, token: str | None) -> Identity:
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "authentication_required"},
            )
        try:
            key = self.keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=self.client_id,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "iss", "aud", "tid", "oid"]},
            )
        except PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "invalid_access_token"},
            ) from exc
        if claims["tid"] != self.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "wrong_tenant"},
            )
        return Identity(
            tenant_id=claims["tid"],
            object_id=claims["oid"],
            email=claims.get("preferred_username") or claims.get("email") or "",
            display_name=claims.get("name") or "Microsoft user",
            token_roles=tuple(claims.get("roles") or ()),
        )


def build_authenticator(settings: Settings) -> Authenticator:
    if settings.auth_mode == "development":
        if settings.environment == "production":
            raise RuntimeError("Development authentication cannot run in production.")
        return DevelopmentAuthenticator()
    if settings.auth_mode == "entra":
        return EntraAuthenticator(settings)
    raise RuntimeError(f"Unsupported GRANTFLOW_AUTH_MODE: {settings.auth_mode}")


# ---------------------------------------------------------------------------
# GrantFlow email-and-password accounts
# ---------------------------------------------------------------------------

PASSWORD_TENANT = "grantflow"
SESSION_ISSUER = "grantflow"
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256

# scrypt from the standard library: memory-hard, no extra dependency.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return "$".join((
        "scrypt",
        str(_SCRYPT_N),
        str(_SCRYPT_R),
        str(_SCRYPT_P),
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    ))


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = encoded.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=32,
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, base64.b64decode(expected))


# Verified against when the email is unknown, so a miss costs the same time as
# a wrong password and response timing doesn't reveal which accounts exist.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def new_account_object_id() -> str:
    return str(uuid.uuid4())


class LoginThrottle:
    """Slows password guessing: a few failures per email lock it briefly."""

    def __init__(self, max_failures: int = 8, window_seconds: int = 15 * 60):
        self.max_failures = max_failures
        self.window = window_seconds
        self.failures: dict[str, deque[float]] = defaultdict(deque)
        self.lock = Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        attempts = self.failures[key]
        while attempts and now - attempts[0] > self.window:
            attempts.popleft()
        return attempts

    def blocked(self, key: str) -> bool:
        with self.lock:
            return len(self._recent(key, time.monotonic())) >= self.max_failures

    def record_failure(self, key: str) -> None:
        with self.lock:
            now = time.monotonic()
            self._recent(key, now).append(now)

    def reset(self, key: str) -> None:
        with self.lock:
            self.failures.pop(key, None)


class PasswordAccounts:
    """Checks passwords and issues the signed session tokens GrantFlow trusts.

    Every sign-in method (password, emailed code, Google, Microsoft, firm SSO)
    ends with one of these sessions.
    """

    def __init__(self, secret: str, session_hours: int):
        if len(secret) < 32:
            raise RuntimeError("GRANTFLOW_SESSION_SECRET must be at least 32 characters.")
        self.secret = secret
        self.session_seconds = session_hours * 3600
        self.throttle = LoginThrottle()

    def check_password(self, credential: dict | None, password: str) -> bool:
        if credential is None:
            verify_password(password, _DUMMY_HASH)
            return False
        return verify_password(password, credential["passwordHash"])

    def issue_session(self, user: dict) -> dict:
        now = int(time.time())
        expires = now + self.session_seconds
        token = jwt.encode(
            {
                "iss": SESSION_ISSUER,
                "aud": SESSION_ISSUER,
                "tid": user["tenantId"],
                "sub": user["objectId"],
                "iat": now,
                "exp": expires,
            },
            self.secret,
            algorithm="HS256",
        )
        return {"token": token, "expiresAt": expires}

    @staticmethod
    def is_session_token(token: str) -> bool:
        try:
            claims = jwt.decode(token, options={"verify_signature": False})
        except PyJWTError:
            return False
        return claims.get("iss") == SESSION_ISSUER

    def authenticate(self, token: str) -> Identity:
        try:
            claims = jwt.decode(
                token,
                self.secret,
                algorithms=["HS256"],
                audience=SESSION_ISSUER,
                issuer=SESSION_ISSUER,
                options={"require": ["exp", "iat", "iss", "aud", "sub", "tid"]},
            )
        except PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "session_expired"},
            ) from exc
        return Identity(
            tenant_id=claims["tid"],
            object_id=claims["sub"],
            email="",
            display_name="",
        )


class SessionAwareAuthenticator:
    """GrantFlow session tokens first; everything else goes to the workspace's
    configured provider (Microsoft Entra or local development)."""

    def __init__(self, accounts: PasswordAccounts, fallback: Authenticator):
        self.accounts = accounts
        self.fallback = fallback

    def authenticate(self, request: Request, token: str | None) -> Identity:
        if token and self.accounts.is_session_token(token):
            return self.accounts.authenticate(token)
        return self.fallback.authenticate(request, token)
