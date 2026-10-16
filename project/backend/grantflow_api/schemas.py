from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    version: str


class GrantProgramResponse(BaseModel):
    label: str
    implemented: bool


class CrossValidationRequest(BaseModel):
    agreement: dict[str, Any] = Field(
        description="Funding-agreement extraction containing an entities object."
    )
    attachment: dict[str, Any] | None = Field(
        default=None,
        description="Optional milestone-attachment extraction.",
    )
    calculator: dict[str, Any] | None = Field(
        default=None,
        description="Optional budget-calculator extraction.",
    )


class RevisionResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    database_id: int = Field(alias="_dbId")
    revision: int = Field(alias="_rev")


class DeleteResponse(BaseModel):
    deleted: int


class ProviderOption(BaseModel):
    key: str
    label: str


class AuthConfigResponse(BaseModel):
    mode: str
    tenantId: str | None = None
    clientId: str | None = None
    scopes: list[str]
    signupEnabled: bool = False
    providers: list[ProviderOption] = Field(
        default_factory=list,
        description="Social sign-in options offered on both doors.",
    )


class PrincipalResponse(BaseModel):
    tenantId: str
    objectId: str
    email: str
    displayName: str
    role: str
    organizationId: int
    organizationName: str
    microsoftIntegrations: bool = Field(
        description="Whether this firm can use SharePoint evidence and Entra invitations.",
    )
    clientName: str | None = None


_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class SignUpRequest(BaseModel):
    organizationName: str = Field(min_length=2, max_length=120)
    displayName: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254, pattern=_EMAIL_PATTERN)
    password: str = Field(max_length=256)


class SignInRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


Audience = Literal["firm", "client"]
PersonRole = Literal["administrator", "grant_adviser", "client_contributor"]


class DiscoverRequest(BaseModel):
    email: str = Field(max_length=254, pattern=_EMAIL_PATTERN)


class DiscoverResponse(BaseModel):
    route: Literal["sso", "magic_link"] = Field(
        description="sso: send the browser to the firm's identity provider; "
        "magic_link: email a sign-in link and code.",
    )
    sso: ProviderOption | None = None
    ssoRequired: bool = False


class EmailCodeRequest(BaseModel):
    email: str = Field(max_length=254, pattern=_EMAIL_PATTERN)
    audience: Audience | None = Field(
        default=None,
        description="Restrict to one door; omit to let the person's role decide.",
    )


class EmailCodeVerifyRequest(EmailCodeRequest):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ForgotPasswordRequest(BaseModel):
    email: str = Field(max_length=254, pattern=_EMAIL_PATTERN)


class ResetPasswordRequest(BaseModel):
    token: str = Field(max_length=200)
    password: str = Field(max_length=256)


class LoginCodeRequest(BaseModel):
    code: str = Field(max_length=200)


class InvitePersonRequest(BaseModel):
    email: str = Field(max_length=254, pattern=_EMAIL_PATTERN)
    displayName: str = Field(min_length=1, max_length=120)
    role: PersonRole
    clientName: str | None = Field(default=None, max_length=120)
    grantIds: list[int] = Field(default_factory=list)


class UpdatePersonRequest(BaseModel):
    role: PersonRole | None = None
    clientName: str | None = Field(default=None, max_length=120)
    grantIds: list[int] | None = None


class DomainRequest(BaseModel):
    domain: str = Field(max_length=253)


class SsoConnectionRequest(BaseModel):
    displayName: str = Field(min_length=1, max_length=60)
    issuer: str = Field(max_length=500, pattern=r"^https?://")
    clientId: str = Field(min_length=1, max_length=300)
    clientSecret: str | None = Field(
        default=None,
        max_length=1000,
        description="Required when first connecting; omit to keep the stored secret.",
    )
    enforced: bool = False
    autoJoin: bool = False


class SessionResponse(BaseModel):
    token: str
    expiresAt: int
    principal: PrincipalResponse


class SharePointSetupRequest(BaseModel):
    siteUrl: str
    rootFolder: str = "GrantFlow Grant Evidence"
