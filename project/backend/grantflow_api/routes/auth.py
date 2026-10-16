from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse

from ..auth import Principal, Role, current_principal
from ..auth.service import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    PASSWORD_TENANT,
    hash_password,
    new_account_object_id,
)
from ..auth.sign_in import AUDIENCES, SignInError
from ..repositories import EmailTaken
from ..schemas import (
    AuthConfigResponse,
    DiscoverRequest,
    DiscoverResponse,
    EmailCodeRequest,
    EmailCodeVerifyRequest,
    ForgotPasswordRequest,
    LoginCodeRequest,
    PrincipalResponse,
    ResetPasswordRequest,
    SessionResponse,
    SignInRequest,
    SignUpRequest,
)

router = APIRouter(prefix="/auth", tags=["identity"])

OIDC_COOKIE = "grantflow_oidc"


def _principal_response(principal: Principal) -> PrincipalResponse:
    return PrincipalResponse(
        tenantId=principal.tenant_id,
        objectId=principal.object_id,
        email=principal.email,
        displayName=principal.display_name,
        role=principal.role.value,
        organizationId=principal.organization_id,
        organizationName=principal.organization_name,
        microsoftIntegrations=principal.in_primary_organization,
        clientName=principal.client_name,
    )


def _account_principal(user: dict) -> Principal:
    return Principal(
        tenant_id=user["tenantId"],
        object_id=user["objectId"],
        email=user["email"],
        display_name=user["displayName"],
        role=Role(user["role"]),
        organization_id=user["organizationId"],
        organization_name=user["organizationName"],
        client_name=user.get("clientName"),
        grant_ids=tuple(user.get("grantIds") or ()),
    )


def _session(request: Request, user: dict) -> SessionResponse:
    session = request.app.state.accounts.issue_session(user)
    return SessionResponse(
        **session,
        principal=_principal_response(_account_principal(user)),
    )


def _refused(error: SignInError) -> HTTPException:
    return HTTPException(
        status_code=error.status,
        detail={"code": error.code, **error.detail},
    )


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _app_url(request: Request, audience: str, **params: str) -> str:
    base = request.app.state.settings.public_app_url.rstrip("/") + "/"
    if audience == "client":
        base += "client/"
    return f"{base}?{urlencode(params)}" if params else base


@router.get(
    "/config",
    response_model=AuthConfigResponse,
    summary="Get browser sign-in configuration",
)
def auth_config(request: Request) -> AuthConfigResponse:
    settings = request.app.state.settings
    return AuthConfigResponse(
        mode=settings.auth_mode,
        tenantId=settings.entra_tenant_id or None,
        clientId=settings.entra_client_id or None,
        scopes=[settings.entra_api_scope] if settings.entra_api_scope else [],
        signupEnabled=settings.signup_enabled,
        providers=request.app.state.sign_in.providers(),
    )


# -- firm sign-up and passwords ------------------------------------------------


@router.post(
    "/signup",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a firm workspace with a password",
    description=(
        "Creates a private firm workspace with the caller as its administrator, "
        "stores a scrypt hash of the password, and returns a session token."
    ),
)
def sign_up(payload: SignUpRequest, request: Request) -> SessionResponse:
    if not request.app.state.settings.signup_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "signup_disabled"},
        )
    if not MIN_PASSWORD_LENGTH <= len(payload.password) <= MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "weak_password", "minimumLength": MIN_PASSWORD_LENGTH},
        )
    email = _normalize_email(payload.email)
    existing = request.app.state.access.find_user_by_email(email)
    if existing:
        # Someone invited to a firm should accept that, not start an empty firm.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "already_invited" if existing.get("status") == "invited" else "email_already_registered"},
        )
    try:
        user = request.app.state.access.create_account(
            payload.organizationName.strip(),
            {
                "tenantId": PASSWORD_TENANT,
                "objectId": new_account_object_id(),
                "displayName": payload.displayName.strip(),
                "role": Role.ADMINISTRATOR.value,
                "grantIds": [],
            },
            email,
            hash_password(payload.password),
        )
    except EmailTaken as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "email_already_registered"},
        ) from exc
    return _session(request, user)


@router.post(
    "/login",
    response_model=SessionResponse,
    summary="Sign in to a firm workspace with email and password",
)
def sign_in(payload: SignInRequest, request: Request) -> SessionResponse:
    accounts = request.app.state.accounts
    email = _normalize_email(payload.email)
    if accounts.throttle.blocked(email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "too_many_attempts"},
        )
    credential = request.app.state.access.find_password_credential(email)
    if not accounts.check_password(credential, payload.password):
        accounts.throttle.record_failure(email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials"},
        )
    user = request.app.state.access.find_user(
        credential["tenantId"],
        credential["objectId"],
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials"},
        )
    accounts.throttle.reset(email)
    try:
        user = request.app.state.sign_in.admit_password_user(user)
    except SignInError as error:
        raise _refused(error) from error
    return _session(request, user)


@router.post(
    "/password/forgot",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Email a password reset link",
    description="Always answers 202 so it never reveals who has an account.",
)
def forgot_password(payload: ForgotPasswordRequest, request: Request) -> dict:
    request.app.state.sign_in.request_password_reset(_normalize_email(payload.email))
    return {"sent": True}


@router.post(
    "/password/reset",
    response_model=SessionResponse,
    summary="Set a new password from a reset or invitation link, and sign in",
)
def reset_password(payload: ResetPasswordRequest, request: Request) -> SessionResponse:
    try:
        user = request.app.state.sign_in.reset_password(payload.token, payload.password)
    except SignInError as error:
        raise _refused(error) from error
    return _session(request, user)


@router.post(
    "/discover",
    response_model=DiscoverResponse,
    summary="Decide where an email signs in: the firm's SSO or an emailed link",
)
def discover(payload: DiscoverRequest, request: Request) -> DiscoverResponse:
    found = request.app.state.sign_in.discover(_normalize_email(payload.email))
    return DiscoverResponse(
        route=found["route"],
        sso={"key": "sso", "label": found["sso"]["label"]} if found["sso"] else None,
        ssoRequired=found["ssoRequired"],
    )


# -- emailed one-time codes ------------------------------------------------------


@router.post(
    "/email-code",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Email a sign-in link and one-time code",
    description=(
        "Sends a single-use sign-in link and six-digit code when the address "
        "belongs to someone with an account (for `audience`, if given). Always "
        "answers 202 so it never reveals who has an account."
    ),
)
def send_email_code(payload: EmailCodeRequest, request: Request) -> dict:
    request.app.state.sign_in.send_email_code(
        _normalize_email(payload.email),
        payload.audience,
    )
    return {"sent": True}


@router.post(
    "/email-code/verify",
    response_model=SessionResponse,
    summary="Sign in with an emailed one-time code",
)
def verify_email_code(payload: EmailCodeVerifyRequest, request: Request) -> SessionResponse:
    try:
        user = request.app.state.sign_in.verify_email_code(
            _normalize_email(payload.email),
            payload.audience,
            payload.code,
        )
    except SignInError as error:
        raise _refused(error) from error
    return _session(request, user)


# -- Google, Microsoft and firm SSO ---------------------------------------------


@router.get(
    "/oidc/{provider}/start",
    summary="Begin signing in with Google, Microsoft or the firm's SSO",
    description=(
        "Browser navigation, not an API call: redirects to the provider. "
        "`provider` is google, microsoft, or sso (the firm of `email`)."
    ),
    response_class=RedirectResponse,
)
def start_oidc(
    provider: str,
    request: Request,
    audience: str = Query("firm"),
    intent: str = Query("signin", pattern="^(signin|signup)$"),
    email: str | None = Query(default=None, max_length=254),
    organizationName: str | None = Query(default=None, max_length=120),
    displayName: str | None = Query(default=None, max_length=120),
):
    if audience not in AUDIENCES:
        audience = "firm"
    try:
        started = request.app.state.sign_in.start_oidc(
            provider,
            audience,
            intent=intent,
            email=_normalize_email(email) if email else None,
            organization_name=organizationName,
            display_name=displayName,
        )
    except SignInError as error:
        return RedirectResponse(_app_url(request, audience, login_error=error.code), 303)
    response = RedirectResponse(started.url, 303)
    response.set_cookie(
        OIDC_COOKIE,
        started.browser_binding,
        max_age=600,
        path="/auth/oidc",
        httponly=True,
        samesite="lax",
        secure=request.app.state.settings.public_api_url.startswith("https://"),
    )
    return response


@router.get(
    "/oidc/callback",
    summary="Provider redirect target that completes an OIDC sign-in",
    response_class=RedirectResponse,
)
def finish_oidc(
    request: Request,
    state: str = Query(default="", max_length=200),
    code: str = Query(default="", max_length=4000),
    error: str | None = Query(default=None, max_length=200),
):
    sign_in_service = request.app.state.sign_in
    audience = "firm"
    try:
        if error or not state or not code:
            # Cancelled at the provider, or a malformed callback.
            audience = sign_in_service.abandon_oidc(state)
            raise SignInError("sign_in_cancelled", 400)
        user, audience = sign_in_service.finish_oidc(
            state,
            code,
            request.cookies.get(OIDC_COOKIE),
        )
        target = _app_url(
            request,
            audience,
            login=sign_in_service.issue_login_code(user, audience),
        )
    except SignInError as failure:
        params = {"login_error": failure.code}
        if failure.detail.get("provider"):
            params["provider"] = failure.detail["provider"]
        target = _app_url(request, audience, **params)
    response = RedirectResponse(target, 303)
    response.delete_cookie(OIDC_COOKIE, path="/auth/oidc")
    return response


@router.post(
    "/exchange",
    response_model=SessionResponse,
    summary="Trade the one-time code from an OIDC redirect for a session",
)
def exchange_login_code(payload: LoginCodeRequest, request: Request) -> SessionResponse:
    try:
        user = request.app.state.sign_in.redeem_login_code(payload.code)
    except SignInError as error:
        raise _refused(error) from error
    return _session(request, user)


@router.get(
    "/me",
    response_model=PrincipalResponse,
    summary="Get the signed-in workspace identity",
)
def me(principal: Principal = Depends(current_principal)) -> PrincipalResponse:
    return _principal_response(principal)
