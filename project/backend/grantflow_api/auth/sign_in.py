"""How people get into GrantFlow.

Two doors:
- the firm workspace, for administrators and grant advisers;
- the client portal, for client contributors.

A person is identified by their email address. They prove it with a
password, a one-time code emailed to them, Google, Microsoft, or their
firm's own identity provider. External sign-ins are matched to a person by
a previously linked identity, or by an email address the provider vouches
for — never by an unverified one.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from typing import Literal

from ..config import PRODUCT_NAME, Settings
from ..services import domains
from ..services.mail import EmailSender, Message
from ..services.oidc import (
    ExternalProfile,
    OidcClient,
    OidcError,
    OidcProvider,
    firm_provider,
    google_provider,
    microsoft_provider,
    new_pkce_pair,
)
from ..services.secret_box import SecretBox
from .models import PRIMARY_ORGANIZATION_ID, Role
from .service import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_TENANT,
    LoginThrottle,
    hash_password,
    new_account_object_id,
)

Audience = Literal["firm", "client"]
AUDIENCES = ("firm", "client")

EMAIL_CODE_SECONDS = 10 * 60
EMAIL_CODE_ATTEMPTS = 5
OIDC_STATE_SECONDS = 10 * 60
LOGIN_CODE_SECONDS = 2 * 60
PASSWORD_RESET_SECONDS = 60 * 60
INVITATION_SECONDS = 7 * 24 * 60 * 60


class SignInError(Exception):
    """A sign-in was refused. `code` is stable and safe to show the user."""

    def __init__(self, code: str, status: int = 403, **detail):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class OidcStart:
    url: str
    browser_binding: str


def _hash(secret: str, value: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def _now() -> int:
    return int(time.time())


class SignInService:
    def __init__(
        self,
        settings: Settings,
        access,
        oidc: OidcClient,
        mail: EmailSender,
        secret_box: SecretBox,
        hashing_secret: str,
    ):
        self.settings = settings
        self.access = access
        self.oidc = oidc
        self.mail = mail
        self.secret_box = secret_box
        self.hashing_secret = hashing_secret
        self.code_sends = LoginThrottle(max_failures=5, window_seconds=15 * 60)

    # -- what the sign-in page should offer --------------------------------

    def providers(self) -> list[dict]:
        offered = []
        if self.settings.google_enabled:
            offered.append({"key": "google", "label": "Google"})
        if self.settings.microsoft_enabled:
            offered.append({"key": "microsoft", "label": "Microsoft"})
        return offered

    def discover(self, email: str) -> dict:
        """Where the sign-in page sends this email next.

        "sso" when the email's domain belongs to a firm with its own identity
        provider; otherwise "magic_link". The answer depends only on the
        domain, so it never reveals whether the person has an account.
        """
        connection = self._domain_connection(email)
        if not connection:
            return {"route": "magic_link", "sso": None, "ssoRequired": False}
        return {
            "route": "sso",
            "sso": {"label": connection["displayName"]},
            "ssoRequired": connection["enforced"],
        }

    # -- emailed one-time codes --------------------------------------------

    def send_email_code(self, email: str, audience: Audience | None = None) -> None:
        """Email a sign-in link and code to someone who has an account.

        Always succeeds from the caller's view, so it can't reveal who has an
        account. Without an `audience` the person's own role picks the door.
        """
        if self.code_sends.blocked(email):
            return
        user = self.access.find_user_by_email(email)
        if not user or (audience and not self._fits(user, audience)):
            return
        door = self._door(user)
        try:
            self._check_sso_policy(user, method="email")
        except SignInError:
            return
        self.code_sends.record_failure(email)  # counts sends, not failures
        code = f"{secrets.randbelow(10**6):06d}"
        self.access.save_email_code(
            email,
            door,
            _hash(self.hashing_secret, f"{email}:{door}:{code}"),
            _now() + EMAIL_CODE_SECONDS,
        )
        link = self.issue_login_code(user, door, seconds=EMAIL_CODE_SECONDS, method="email")
        self.mail.send(Message(
            to=email,
            subject=f"Your {PRODUCT_NAME} sign-in link",
            body=(
                f"Hi {user['displayName']},\n\n"
                f"Sign in to {PRODUCT_NAME}:\n{self._door_url(door)}?login={link}\n\n"
                f"Or enter this code: {code}\n\n"
                "The link and code work once and expire in 10 minutes. "
                "If you didn't try to sign in, you can ignore this email."
            ),
        ))

    def verify_email_code(self, email: str, audience: Audience | None, code: str) -> dict:
        user = self.access.find_user_by_email(email)
        door = audience or (self._door(user) if user else "firm")
        expected = _hash(self.hashing_secret, f"{email}:{door}:{code.strip()}")
        ok = self.access.check_email_code(
            email,
            door,
            lambda stored: hmac.compare_digest(stored, expected),
            _now(),
            EMAIL_CODE_ATTEMPTS,
        )
        if not ok or not user:
            raise SignInError("invalid_code", 401)
        return self._admit(user, door, method="email")

    # -- passwords ------------------------------------------------------------

    def admit_password_user(self, user: dict) -> dict:
        return self._admit(user, "firm", method="password")

    # -- Google, Microsoft and firm SSO ---------------------------------------

    def start_oidc(
        self,
        provider_key: str,
        audience: Audience,
        *,
        intent: str = "signin",
        email: str | None = None,
        organization_name: str | None = None,
        display_name: str | None = None,
    ) -> OidcStart:
        provider, connection_id = self._provider_for_start(provider_key, email)
        if intent == "signup":
            if audience != "firm" or not self.settings.signup_enabled:
                raise SignInError("signup_disabled")
            if not (organization_name or "").strip():
                raise SignInError("organization_name_required", 422)
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        binding = secrets.token_urlsafe(32)
        verifier, challenge = new_pkce_pair()
        self.access.save_oidc_state(
            state,
            {
                "provider": provider.key,
                "connectionId": connection_id,
                "nonce": nonce,
                "verifier": verifier,
                "audience": audience,
                "intent": intent,
                "organizationName": (organization_name or "").strip()[:120],
                "displayName": (display_name or "").strip()[:120],
                "binding": _hash(self.hashing_secret, binding),
            },
            _now() + OIDC_STATE_SECONDS,
        )
        url = self.oidc.authorization_url(
            provider,
            redirect_uri=self.redirect_uri,
            state=state,
            nonce=nonce,
            code_challenge=challenge,
            login_hint=email,
        )
        return OidcStart(url=url, browser_binding=binding)

    def finish_oidc(self, state: str, code: str, browser_binding: str | None) -> tuple[dict, Audience]:
        saved = self.access.pop_oidc_state(state, _now())
        if not saved:
            raise SignInError("sign_in_expired", 400)
        # The flow must finish in the browser that started it (no login CSRF).
        if not browser_binding or not hmac.compare_digest(
            saved["binding"], _hash(self.hashing_secret, browser_binding)
        ):
            raise SignInError("sign_in_expired", 400)
        audience = saved["audience"]
        provider = self._provider_by_key(saved["provider"], saved.get("connectionId"))
        try:
            profile = self.oidc.complete(
                provider,
                code=code,
                redirect_uri=self.redirect_uri,
                code_verifier=saved["verifier"],
                nonce=saved["nonce"],
            )
        except OidcError as exc:
            raise SignInError(exc.code, 400) from exc
        user = self._resolve_external(profile, audience, saved)
        return self._admit(user, audience, method=profile.provider), audience

    def abandon_oidc(self, state: str) -> Audience:
        """Discard a flow the person cancelled; returns which door to send them back to."""
        saved = self.access.pop_oidc_state(state, _now()) if state else None
        return (saved or {}).get("audience", "firm")

    @property
    def redirect_uri(self) -> str:
        return f"{self.settings.public_api_url}/auth/oidc/callback"

    # -- one-time handoff from the OAuth callback to the browser app ---------

    def issue_login_code(
        self,
        user: dict,
        audience: Audience,
        *,
        seconds: int = LOGIN_CODE_SECONDS,
        method: str | None = None,
        purpose: str = "login",
    ) -> str:
        """A single-use token the browser trades for a session.

        Used for the hand-off after an OIDC redirect and for emailed sign-in
        links. `method` re-runs the door and SSO checks at redemption.
        """
        code = secrets.token_urlsafe(32)
        self.access.save_login_code(
            _hash(self.hashing_secret, code),
            {
                "tenantId": user["tenantId"],
                "objectId": user["objectId"],
                "audience": audience,
                "method": method,
                "purpose": purpose,
            },
            _now() + seconds,
        )
        return code

    def redeem_login_code(self, code: str) -> dict:
        data = self.access.pop_login_code(_hash(self.hashing_secret, code), _now())
        if not data or data.get("purpose", "login") != "login":
            raise SignInError("sign_in_expired", 400)
        user = self.access.find_user(data["tenantId"], data["objectId"])
        if not user:
            raise SignInError("no_account", 403)
        if data.get("method"):
            return self._admit(user, data["audience"], method=data["method"])
        return user

    # -- forgotten passwords and first passwords ------------------------------

    def request_password_reset(self, email: str) -> None:
        """Email a single-use reset link. Silent for unknown emails, clients and
        SSO-required staff, so it can't reveal who has an account."""
        if self.code_sends.blocked(email):
            return
        user = self.access.find_user_by_email(email)
        if not user or not Role(user["role"]).is_firm_staff:
            return
        try:
            self._check_sso_policy(user, method="password")
        except SignInError:
            return
        self.code_sends.record_failure(email)  # counts sends, not failures
        link = self._password_link(user, PASSWORD_RESET_SECONDS)
        self.mail.send(Message(
            to=email,
            subject=f"Reset your {PRODUCT_NAME} password",
            body=(
                f"Hi {user['displayName']},\n\n"
                f"Choose a new password here:\n{link}\n\n"
                "The link works once and expires in an hour. "
                "If you didn't ask to reset your password, you can ignore this email."
            ),
        ))

    def reset_password(self, token: str, password: str) -> dict:
        data = self.access.pop_login_code(_hash(self.hashing_secret, token), _now())
        if not data or data.get("purpose") != "password_reset":
            raise SignInError("reset_link_expired", 400)
        if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
            raise SignInError("weak_password", 422)
        user = self.access.find_user(data["tenantId"], data["objectId"])
        if not user:
            raise SignInError("reset_link_expired", 400)
        self._check_sso_policy(user, method="password")
        self.access.set_password(user["id"], user["email"], hash_password(password))
        return self._admit(user, "firm", method="password")

    def _password_link(self, user: dict, seconds: int) -> str:
        token = self.issue_login_code(user, "firm", seconds=seconds, purpose="password_reset")
        return f"{self._door_url('firm')}?reset={token}"

    # -- people ---------------------------------------------------------------

    def invite(self, organization_id: int, person: dict, invited_by: str) -> dict:
        """Add a firm member or client contributor; they sign in with that email."""
        email = person["email"].strip().lower()
        if self.access.find_user_by_email(email):
            raise SignInError("email_already_registered", 409)
        role = Role(person["role"])
        user = self.access.save_user({
            "tenantId": PASSWORD_TENANT,
            "objectId": new_account_object_id(),
            "email": email,
            "displayName": person["displayName"].strip(),
            "role": role.value,
            "clientName": person.get("clientName"),
            "grantIds": person.get("grantIds") or [],
            "organizationId": organization_id,
            "status": "invited",
        })
        what = (
            "share documents and see upcoming reporting deadlines for your grants"
            if role == Role.CLIENT_CONTRIBUTOR
            else f"join {user['organizationName']} as a grant adviser"
            if role == Role.GRANT_ADVISER
            else f"help administer {user['organizationName']}"
        )
        accounts = " or ".join(provider["label"] for provider in self.providers())
        if role == Role.CLIENT_CONTRIBUTOR:
            how = (
                f"Sign in at {self._door_url('client')} with {email}. We'll email you a "
                "secure sign-in link each time; there's no password to set up."
            )
        else:
            how = (
                "Accept the invitation and choose a password:\n"
                f"{self._password_link(user, INVITATION_SECONDS)}\n\n"
                "The link works once and expires in 7 days."
            )
            if accounts:
                how += f" You can also sign in with your {accounts} work account."
        self.mail.send(Message(
            to=email,
            subject=f"{invited_by} invited you to {PRODUCT_NAME}",
            body=(
                f"Hi {user['displayName']},\n\n"
                f"{invited_by} has invited you to {what}.\n\n"
                f"{how}\n"
            ),
        ))
        return user

    # -- internals ------------------------------------------------------------

    def _door(self, user: dict) -> Audience:
        return "firm" if Role(user["role"]).is_firm_staff else "client"

    def _door_url(self, door: Audience) -> str:
        base = self.settings.public_app_url.rstrip("/") + "/"
        return base + "client/" if door == "client" else base

    def _fits(self, user: dict, audience: Audience) -> bool:
        return Role(user["role"]).is_firm_staff == (audience == "firm")

    def _admit(self, user: dict, audience: Audience, *, method: str) -> dict:
        if not self._fits(user, audience):
            raise SignInError(
                "wrong_portal",
                403,
                portal="client" if audience == "firm" else "firm",
            )
        self._check_sso_policy(user, method=method)
        self.access.mark_signed_in(user["id"])
        return {**user, "status": "active"}

    def _domain_connection(self, email: str) -> dict | None:
        owner = self.access.verified_domain_owner(domains.email_domain(email))
        return self.access.get_sso_connection(owner) if owner else None

    def _check_sso_policy(self, user: dict, *, method: str) -> None:
        """A firm that requires SSO gets SSO for its own staff, whatever they try."""
        if not Role(user["role"]).is_firm_staff:
            return
        connection = self._domain_connection(user["email"])
        if (
            connection
            and connection["enforced"]
            and connection["organizationId"] == user["organizationId"]
            and method != f"sso:{connection['id']}"
        ):
            raise SignInError("sso_required", 403, provider=connection["displayName"])

    def _resolve_external(self, profile: ExternalProfile, audience: Audience, saved: dict) -> dict:
        user = self.access.find_identity_user(profile.provider, profile.subject)
        if user:
            return user
        if not profile.email or not profile.email_trusted:
            raise SignInError("email_not_verified", 403)

        user = self.access.find_user_by_email(profile.email)
        if user:
            self.access.link_identity(profile.provider, profile.subject, user["id"], profile.email)
            return user

        if audience == "firm" and self._is_workspace_administrator(profile):
            user = self.access.save_user({
                "tenantId": PASSWORD_TENANT,
                "objectId": new_account_object_id(),
                "email": profile.email,
                "displayName": profile.name or profile.email,
                "role": Role.ADMINISTRATOR.value,
                "grantIds": [],
                "organizationId": PRIMARY_ORGANIZATION_ID,
            })
            self.access.link_identity(profile.provider, profile.subject, user["id"], profile.email)
            return user

        if audience == "firm" and saved.get("intent") == "signup":
            return self.access.create_account(
                saved["organizationName"],
                {
                    "tenantId": PASSWORD_TENANT,
                    "objectId": new_account_object_id(),
                    "displayName": saved.get("displayName") or profile.name or profile.email,
                    "role": Role.ADMINISTRATOR.value,
                    "grantIds": [],
                },
                profile.email,
                identity=(profile.provider, profile.subject),
            )

        if audience == "firm":
            connection = self._domain_connection(profile.email)
            if connection and connection["autoJoin"]:
                user = self.access.save_user({
                    "tenantId": PASSWORD_TENANT,
                    "objectId": new_account_object_id(),
                    "email": profile.email,
                    "displayName": profile.name or profile.email,
                    "role": Role.GRANT_ADVISER.value,
                    "grantIds": [],
                    "organizationId": connection["organizationId"],
                })
                self.access.link_identity(profile.provider, profile.subject, user["id"], profile.email)
                return user

        raise SignInError("no_account", 403)

    def _is_workspace_administrator(self, profile: ExternalProfile) -> bool:
        """People in the workspace's own Entra tenant holding its admin app role
        administer the primary workspace, as with the workspace Entra sign-in."""
        settings = self.settings
        return (
            profile.provider == "microsoft"
            and bool(settings.entra_tenant_id)
            and profile.tenant == settings.entra_tenant_id
            and settings.entra_admin_role in profile.roles
        )

    def _provider_for_start(self, key: str, email: str | None) -> tuple[OidcProvider, int | None]:
        if key == "sso":
            connection = self._domain_connection(email or "")
            if not connection:
                raise SignInError("sso_not_configured", 404)
            return self._firm_provider(connection), connection["id"]
        return self._provider_by_key(key, None), None

    def _provider_by_key(self, key: str, connection_id: int | None) -> OidcProvider:
        settings = self.settings
        if key == "google" and settings.google_enabled:
            return google_provider(settings.google_client_id, settings.google_client_secret)
        if key == "microsoft" and settings.microsoft_enabled:
            return microsoft_provider(
                settings.microsoft_client_id,
                settings.microsoft_client_secret,
                settings.microsoft_tenant,
            )
        if key.startswith("sso:") and connection_id is not None:
            connection = self.access.get_sso_connection_by_id(connection_id)
            if connection:
                return self._firm_provider(connection)
        raise SignInError("provider_not_available", 404)

    def _firm_provider(self, connection: dict) -> OidcProvider:
        organization_id = connection["organizationId"]
        return firm_provider(
            connection,
            self.secret_box.decrypt(connection["clientSecret"]),
            lambda: {
                item["domain"]
                for item in self.access.list_domains(organization_id)
                if item["verified"]
            },
        )
