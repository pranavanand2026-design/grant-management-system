"""OpenID Connect sign-in: Google, Microsoft and each firm's own provider.

Authorization-code flow with PKCE and a nonce. Every ID token is verified
against the provider's published keys, audience, issuer, expiry and nonce
before GrantFlow trusts anything in it.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import secrets
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit

import httpx
import jwt
from jwt import PyJWKSet
from jwt.exceptions import PyJWTError

# Asymmetric algorithms only: never "none" or a shared-secret HMAC.
SIGNING_ALGORITHMS = ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384")
METADATA_TTL_SECONDS = 3600

GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
MICROSOFT_DISCOVERY = (
    "https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"
)
MICROSOFT_ANY_TENANT = ("organizations", "common")


class OidcError(RuntimeError):
    """Sign-in with an external provider failed; `code` is safe to show."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


@dataclass(frozen=True)
class ExternalProfile:
    provider: str
    subject: str
    email: str
    email_trusted: bool
    name: str
    # Microsoft only: the directory the person signed in from, and their
    # app roles in it.
    tenant: str = ""
    roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class OidcProvider:
    key: str
    label: str
    discovery_url: str
    client_id: str
    client_secret: str
    # Checks the token's issuer; receives (claims, metadata).
    issuer_valid: Callable[[dict, dict], bool]
    # Builds the GrantFlow profile from verified claims.
    profile: Callable[[dict], ExternalProfile]
    scopes: str = "openid email profile"
    extra_authorize_params: tuple[tuple[str, str], ...] = ()


def google_provider(client_id: str, client_secret: str) -> OidcProvider:
    def profile(claims: dict) -> ExternalProfile:
        return ExternalProfile(
            provider="google",
            subject=claims["sub"],
            email=(claims.get("email") or "").lower(),
            email_trusted=claims.get("email_verified") is True,
            name=claims.get("name") or "",
        )

    return OidcProvider(
        key="google",
        label="Google",
        discovery_url=GOOGLE_DISCOVERY,
        client_id=client_id,
        client_secret=client_secret,
        issuer_valid=lambda claims, _meta: claims.get("iss") in GOOGLE_ISSUERS,
        profile=profile,
        extra_authorize_params=(("prompt", "select_account"),),
    )


def microsoft_provider(
    client_id: str,
    client_secret: str,
    tenant: str = "organizations",
) -> OidcProvider:
    """Microsoft Entra work or school accounts.

    With tenant "organizations" any directory can sign in (a multitenant app).
    With a tenant ID only that directory can (a single-tenant app).
    """
    pinned = tenant not in MICROSOFT_ANY_TENANT

    def issuer_valid(claims: dict, _meta: dict) -> bool:
        signed_in_tenant = claims.get("tid")
        return (
            bool(signed_in_tenant)
            and (not pinned or signed_in_tenant == tenant)
            and claims.get("iss") == f"https://login.microsoftonline.com/{signed_in_tenant}/v2.0"
        )

    def profile(claims: dict) -> ExternalProfile:
        # Entra's `email` claim is editable by tenant admins and is not proof
        # of ownership across tenants. Trust it when Microsoft marks the
        # domain as verified (the xms_edov optional claim), or when the app
        # only admits the operator's own directory.
        email = claims.get("email") or (claims.get("preferred_username") if pinned else "")
        return ExternalProfile(
            provider="microsoft",
            subject=f"{claims['tid']}:{claims['oid']}",
            email=(email or "").lower(),
            email_trusted=pinned or claims.get("xms_edov") in (True, "1", 1, "true"),
            name=claims.get("name") or "",
            tenant=claims["tid"],
            roles=tuple(claims.get("roles") or ()),
        )

    return OidcProvider(
        key="microsoft",
        label="Microsoft",
        discovery_url=MICROSOFT_DISCOVERY.format(tenant=tenant),
        client_id=client_id,
        client_secret=client_secret,
        issuer_valid=issuer_valid,
        profile=profile,
        extra_authorize_params=(("prompt", "select_account"),),
    )


def firm_provider(
    connection: dict,
    client_secret: str,
    trusted_domains: Callable[[], set[str]],
) -> OidcProvider:
    """A firm's own identity provider (Okta, Entra, Google Workspace, Auth0…).

    The firm's provider is authoritative only for the email domains the firm
    has verified with GrantFlow.
    """
    issuer = connection["issuer"].rstrip("/")
    key = f"sso:{connection['id']}"

    def profile(claims: dict) -> ExternalProfile:
        email = (claims.get("email") or "").lower()
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        return ExternalProfile(
            provider=key,
            subject=claims["sub"],
            email=email,
            email_trusted=(
                claims.get("email_verified") is not False
                and domain in trusted_domains()
            ),
            name=claims.get("name") or "",
        )

    return OidcProvider(
        key=key,
        label=connection["displayName"],
        discovery_url=f"{issuer}/.well-known/openid-configuration",
        client_id=connection["clientId"],
        client_secret=client_secret,
        issuer_valid=lambda claims, meta: (
            claims.get("iss") == meta.get("issuer")
            and meta.get("issuer", "").rstrip("/") == issuer
        ),
        profile=profile,
    )


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


class OidcClient:
    def __init__(self, http: httpx.Client | None = None, *, allow_private_hosts: bool = False):
        self.http = http or httpx.Client(timeout=10, follow_redirects=False)
        # Firms type their own issuer URL, so outside development the server
        # refuses plain HTTP and private addresses (no reaching internal hosts).
        self.allow_private_hosts = allow_private_hosts
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def _check_url(self, url: str) -> None:
        parts = urlsplit(url)
        if self.allow_private_hosts and parts.scheme in ("http", "https"):
            return
        if parts.scheme != "https" or not parts.hostname:
            raise OidcError("provider_misconfigured", "Provider URLs must use HTTPS.")
        try:
            addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, 443)}
        except OSError as exc:
            raise OidcError("provider_unreachable", f"Cannot resolve {parts.hostname}.") from exc
        for address in addresses:
            ip = ipaddress.ip_address(address.split("%")[0])
            if not ip.is_global:
                raise OidcError("provider_misconfigured", "Provider URLs must be public.")

    # -- metadata -----------------------------------------------------------

    def _get_json(self, url: str, *, refresh: bool = False) -> dict:
        now = time.monotonic()
        with self._lock:
            cached = self._cache.get(url)
        if cached and not refresh and now - cached[0] < METADATA_TTL_SECONDS:
            return cached[1]
        self._check_url(url)
        try:
            response = self.http.get(url)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OidcError("provider_unreachable", f"Could not load {url}.") from exc
        with self._lock:
            self._cache[url] = (now, data)
        return data

    def metadata(self, provider: OidcProvider) -> dict:
        meta = self._get_json(provider.discovery_url)
        for field in ("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"):
            if not meta.get(field):
                raise OidcError("provider_misconfigured", f"Discovery is missing {field}.")
        return meta

    # -- flow ---------------------------------------------------------------

    def authorization_url(
        self,
        provider: OidcProvider,
        *,
        redirect_uri: str,
        state: str,
        nonce: str,
        code_challenge: str,
        login_hint: str | None = None,
    ) -> str:
        meta = self.metadata(provider)
        params = {
            "response_type": "code",
            "client_id": provider.client_id,
            "redirect_uri": redirect_uri,
            "scope": provider.scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            **dict(provider.extra_authorize_params),
        }
        if login_hint:
            params["login_hint"] = login_hint
        separator = "&" if "?" in meta["authorization_endpoint"] else "?"
        return f"{meta['authorization_endpoint']}{separator}{urlencode(params)}"

    def complete(
        self,
        provider: OidcProvider,
        *,
        code: str,
        redirect_uri: str,
        code_verifier: str,
        nonce: str,
    ) -> ExternalProfile:
        meta = self.metadata(provider)
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
        auth = None
        methods = meta.get("token_endpoint_auth_methods_supported") or ["client_secret_basic"]
        if "client_secret_basic" in methods:
            auth = (provider.client_id, provider.client_secret)
        else:
            form |= {"client_id": provider.client_id, "client_secret": provider.client_secret}
        self._check_url(meta["token_endpoint"])
        try:
            response = self.http.post(meta["token_endpoint"], data=form, auth=auth)
        except httpx.HTTPError as exc:
            raise OidcError("provider_unreachable") from exc
        if response.status_code != 200:
            raise OidcError("code_exchange_failed", response.text[:300])
        id_token = (response.json() or {}).get("id_token")
        if not id_token:
            raise OidcError("code_exchange_failed", "The provider returned no ID token.")
        claims = self._verify_id_token(provider, meta, id_token, nonce)
        try:
            return provider.profile(claims)
        except KeyError as exc:
            raise OidcError("invalid_id_token", f"Missing claim {exc}.") from exc

    def _verify_id_token(self, provider: OidcProvider, meta: dict, token: str, nonce: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
        except PyJWTError as exc:
            raise OidcError("invalid_id_token") from exc
        algorithm = header.get("alg")
        if algorithm not in SIGNING_ALGORITHMS:
            raise OidcError("invalid_id_token", f"Unsupported signing algorithm {algorithm}.")
        key = self._signing_key(meta["jwks_uri"], header.get("kid"))
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=provider.client_id,
                leeway=60,
                options={
                    "require": ["exp", "iat", "iss", "aud", "sub"],
                    "verify_iss": False,  # checked below; Microsoft's varies per tenant
                },
            )
        except PyJWTError as exc:
            raise OidcError("invalid_id_token", str(exc)) from exc
        if not provider.issuer_valid(claims, meta):
            raise OidcError("invalid_id_token", "Unexpected token issuer.")
        if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
            raise OidcError("invalid_id_token", "Nonce mismatch.")
        return claims

    def _signing_key(self, jwks_uri: str, kid: str | None):
        for refresh in (False, True):  # refetch once in case keys rotated
            try:
                keys = PyJWKSet.from_dict(self._get_json(jwks_uri, refresh=refresh))
            except PyJWTError as exc:
                raise OidcError("provider_misconfigured", "Unreadable signing keys.") from exc
            for key in keys.keys:
                if kid is None or key.key_id == kid:
                    return key.key
        raise OidcError("invalid_id_token", "Unknown signing key.")
