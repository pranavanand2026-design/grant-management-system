from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .models import PRIMARY_ORGANIZATION_ID, Principal, Role

bearer = HTTPBearer(auto_error=False)


def _primary_organization_name(request: Request) -> str:
    organization = request.app.state.access.get_organization(PRIMARY_ORGANIZATION_ID)
    return organization["name"] if organization else ""


def current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Principal:
    token = credentials.credentials if credentials else None
    identity = request.app.state.authenticator.authenticate(request, token)
    settings = request.app.state.settings

    if identity.development_role:
        return Principal(
            tenant_id=identity.tenant_id,
            object_id=identity.object_id,
            email=identity.email,
            display_name=identity.display_name,
            role=identity.development_role,
            organization_id=PRIMARY_ORGANIZATION_ID,
            organization_name=_primary_organization_name(request),
            development_preview=(
                identity.development_role == Role.CLIENT_CONTRIBUTOR
            ),
        )

    if settings.entra_admin_role in identity.token_roles:
        return Principal(
            tenant_id=identity.tenant_id,
            object_id=identity.object_id,
            email=identity.email,
            display_name=identity.display_name,
            role=Role.ADMINISTRATOR,
            organization_id=PRIMARY_ORGANIZATION_ID,
            organization_name=_primary_organization_name(request),
        )

    user = request.app.state.access.find_user(
        identity.tenant_id,
        identity.object_id,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "workspace_access_not_assigned"},
        )
    return Principal(
        tenant_id=identity.tenant_id,
        object_id=identity.object_id,
        email=user["email"],
        display_name=user["displayName"],
        role=Role(user["role"]),
        organization_id=user.get("organizationId") or PRIMARY_ORGANIZATION_ID,
        organization_name=user.get("organizationName") or "",
        client_name=user.get("clientName"),
        grant_ids=tuple(user.get("grantIds") or ()),
    )


def require_firm_staff(
    principal: Principal = Depends(current_principal),
) -> Principal:
    """Administrators and grant advisers: everything about the firm's grants."""
    if not principal.role.is_firm_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "firm_staff_required"},
        )
    return principal


def require_administrator(
    principal: Principal = Depends(current_principal),
) -> Principal:
    """Firm people, sign-in configuration and workspace connections."""
    if principal.role != Role.ADMINISTRATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "administrator_required"},
        )
    return principal


def require_signed_in(
    principal: Principal = Depends(current_principal),
) -> Principal:
    return principal


def require_primary_organization(
    principal: Principal = Depends(require_firm_staff),
) -> Principal:
    """Microsoft-backed features (SharePoint, Entra guest invitations) run on
    the server's own Microsoft tenant, so only its workspace may use them."""
    if not principal.in_primary_organization:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "microsoft_integration_unavailable"},
        )
    return principal
