from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from ..auth import (
    Principal,
    Role,
    require_administrator,
    require_firm_staff,
)
from ..auth.sign_in import SignInError
from ..repositories import DomainClaimed
from ..schemas import (
    DeleteResponse,
    DomainRequest,
    InvitePersonRequest,
    SsoConnectionRequest,
    UpdatePersonRequest,
)
from ..services import domains
from ..services.oidc import OidcError, firm_provider

router = APIRouter(
    prefix="/admin",
    tags=["administration"],
    dependencies=[Depends(require_firm_staff)],
)


def _forbidden(code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": code})


def _person_in_firm(request: Request, user_id: int, principal: Principal) -> dict:
    person = next(
        (
            user
            for user in request.app.state.access.list_users(principal.organization_id)
            if user["id"] == user_id
        ),
        None,
    )
    if not person:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "workspace_user_not_found"},
        )
    return person


def _may_manage(principal: Principal, role: Role) -> None:
    """Grant advisers look after clients; only administrators manage firm staff."""
    if role.is_firm_staff and principal.role != Role.ADMINISTRATOR:
        raise _forbidden("administrator_required")


def _check_grants(request: Request, principal: Principal, grant_ids: list[int]) -> None:
    grants = request.app.state.grants
    missing = [
        grant_id
        for grant_id in grant_ids
        if not grants.get(grant_id, principal.organization_id)
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "unknown_grant_assignments", "grantIds": missing},
        )


def _is_self(principal: Principal, person: dict) -> bool:
    return (
        person["tenantId"] == principal.tenant_id
        and person["objectId"] == principal.object_id
    )


def _other_administrators(request: Request, principal: Principal, person: dict) -> int:
    return sum(
        1
        for user in request.app.state.access.list_users(principal.organization_id)
        if user["role"] == Role.ADMINISTRATOR.value and user["id"] != person["id"]
    )


# -- people ---------------------------------------------------------------------


@router.get("/users", response_model=list[dict], summary="List the firm's people and clients")
def list_users(
    request: Request,
    principal: Principal = Depends(require_firm_staff),
):
    return request.app.state.access.list_users(principal.organization_id)


@router.post(
    "/people",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a grant adviser, administrator or client contributor",
    description=(
        "Adds the person and emails them a link to the right sign-in door. "
        "They sign in with that email address; there is no password to set."
    ),
)
def invite_person(
    payload: InvitePersonRequest,
    request: Request,
    principal: Principal = Depends(require_firm_staff),
) -> dict:
    role = Role(payload.role)
    _may_manage(principal, role)
    if role == Role.CLIENT_CONTRIBUTOR:
        if not (payload.clientName or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "client_name_required"},
            )
        _check_grants(request, principal, payload.grantIds)
    person = payload.model_dump()
    if role.is_firm_staff:
        person |= {"clientName": None, "grantIds": []}
    try:
        return request.app.state.sign_in.invite(
            principal.organization_id,
            person,
            invited_by=principal.display_name or principal.organization_name,
        )
    except SignInError as error:
        raise HTTPException(
            status_code=error.status,
            detail={"code": error.code},
        ) from error


@router.patch(
    "/users/{user_id}",
    response_model=dict,
    summary="Change someone's role, client organisation or grant access",
)
def update_person(
    user_id: int,
    payload: UpdatePersonRequest,
    request: Request,
    principal: Principal = Depends(require_firm_staff),
) -> dict:
    person = _person_in_firm(request, user_id, principal)
    current = Role(person["role"])
    _may_manage(principal, current)
    role = Role(payload.role) if payload.role else current
    _may_manage(principal, role)
    if role.is_firm_staff != current.is_firm_staff:
        # Moving someone between firm staff and the client portal is a new invitation.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "cannot_move_between_staff_and_clients"},
        )
    if (
        current == Role.ADMINISTRATOR
        and role != Role.ADMINISTRATOR
        and not _other_administrators(request, principal, person)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "last_administrator"},
        )
    grant_ids = person["grantIds"]
    if role == Role.CLIENT_CONTRIBUTOR and payload.grantIds is not None:
        _check_grants(request, principal, payload.grantIds)
        grant_ids = payload.grantIds
    return request.app.state.access.save_user({
        **person,
        "role": role.value,
        "clientName": (
            payload.clientName if payload.clientName is not None else person["clientName"]
        ) if role == Role.CLIENT_CONTRIBUTOR else None,
        "grantIds": grant_ids if role == Role.CLIENT_CONTRIBUTOR else [],
    })


@router.delete(
    "/users/{user_id}",
    response_model=DeleteResponse,
    summary="Remove someone's access",
)
def remove_user(
    user_id: int,
    request: Request,
    principal: Principal = Depends(require_firm_staff),
) -> DeleteResponse:
    person = _person_in_firm(request, user_id, principal)
    _may_manage(principal, Role(person["role"]))
    if _is_self(principal, person):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "cannot_remove_own_access"},
        )
    request.app.state.access.delete_user(user_id, principal.organization_id)
    return DeleteResponse(deleted=user_id)


# -- sign-in settings (administrators) -------------------------------------------


def _domain_view(item: dict) -> dict:
    return {**item, "record": domains.txt_record(item["domain"], item["verificationToken"])}


def _sso_view(connection: dict | None) -> dict | None:
    if not connection:
        return None
    return {key: value for key, value in connection.items() if key != "clientSecret"}


@router.get(
    "/sign-in",
    response_model=dict,
    summary="The firm's verified domains and SSO connection",
)
def sign_in_settings(
    request: Request,
    principal: Principal = Depends(require_administrator),
) -> dict:
    access = request.app.state.access
    return {
        "domains": [_domain_view(item) for item in access.list_domains(principal.organization_id)],
        "sso": _sso_view(access.get_sso_connection(principal.organization_id)),
        "redirectUri": request.app.state.sign_in.redirect_uri,
    }


@router.post(
    "/sign-in/domains",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Claim an email domain; returns the DNS record that proves it",
)
def add_domain(
    payload: DomainRequest,
    request: Request,
    principal: Principal = Depends(require_administrator),
) -> dict:
    try:
        domain = domains.normalize_domain(payload.domain)
    except domains.InvalidDomain as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_domain", "message": str(exc)},
        ) from exc
    access = request.app.state.access
    access.add_domain(principal.organization_id, domain, domains.new_verification_token())
    item = next(d for d in access.list_domains(principal.organization_id) if d["domain"] == domain)
    return _domain_view(item)


@router.post(
    "/sign-in/domains/{domain}/verify",
    response_model=dict,
    summary="Check the DNS record and mark the domain verified",
)
def verify_domain(
    domain: str,
    request: Request,
    principal: Principal = Depends(require_administrator),
    skipDns: bool = Query(
        default=False,
        description="Development only: mark verified without checking DNS.",
    ),
) -> dict:
    access = request.app.state.access
    item = next(
        (d for d in access.list_domains(principal.organization_id) if d["domain"] == domain.lower()),
        None,
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "domain_not_found"})
    development = request.app.state.settings.environment != "production"
    if not (skipDns and development) and not domains.dns_has_token(
        item["domain"], item["verificationToken"]
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "dns_record_not_found", "record": _domain_view(item)["record"]},
        )
    try:
        access.mark_domain_verified(principal.organization_id, item["domain"])
    except DomainClaimed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "domain_claimed_by_another_firm"},
        ) from exc
    item = next(d for d in access.list_domains(principal.organization_id) if d["domain"] == item["domain"])
    return _domain_view(item)


@router.delete(
    "/sign-in/domains/{domain}",
    response_model=dict,
    summary="Release an email domain",
)
def remove_domain(
    domain: str,
    request: Request,
    principal: Principal = Depends(require_administrator),
) -> dict:
    if not request.app.state.access.delete_domain(principal.organization_id, domain.lower()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "domain_not_found"})
    return {"deleted": domain.lower()}


@router.put(
    "/sign-in/sso",
    response_model=dict,
    summary="Connect the firm's own OpenID Connect identity provider",
    description=(
        "Works with Okta, Microsoft Entra, Google Workspace, Auth0, JumpCloud and any "
        "OIDC provider. The provider's discovery document is checked before saving."
    ),
)
def save_sso(
    payload: SsoConnectionRequest,
    request: Request,
    principal: Principal = Depends(require_administrator),
) -> dict:
    access = request.app.state.access
    sign_in_service = request.app.state.sign_in
    existing = access.get_sso_connection(principal.organization_id)
    if payload.clientSecret:
        secret = sign_in_service.secret_box.encrypt(payload.clientSecret)
    elif existing:
        secret = existing["clientSecret"]
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "client_secret_required"},
        )
    if payload.enforced and not any(
        item["verified"] for item in access.list_domains(principal.organization_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "verified_domain_required"},
        )
    connection = {
        "id": existing["id"] if existing else 0,
        "organizationId": principal.organization_id,
        "displayName": payload.displayName.strip(),
        "issuer": payload.issuer.strip().rstrip("/"),
        "clientId": payload.clientId.strip(),
        "clientSecret": secret,
        "enforced": payload.enforced,
        "autoJoin": payload.autoJoin,
    }
    try:
        sign_in_service.oidc.metadata(firm_provider(connection, "", lambda: set()))
    except OidcError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "sso_discovery_failed", "message": str(exc)},
        ) from exc
    return _sso_view(access.save_sso_connection(principal.organization_id, connection))


@router.delete(
    "/sign-in/sso",
    response_model=dict,
    summary="Disconnect the firm's identity provider",
)
def remove_sso(
    request: Request,
    principal: Principal = Depends(require_administrator),
) -> dict:
    if not request.app.state.access.delete_sso_connection(principal.organization_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "sso_not_configured"})
    return {"deleted": True}
