from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

import sharepoint

from ..auth import (
    PRIMARY_ORGANIZATION_ID,
    require_administrator,
    require_primary_organization,
)
from ..schemas import SharePointSetupRequest

router = APIRouter(
    prefix="/sharepoint",
    tags=["evidence"],
    dependencies=[Depends(require_primary_organization)],
)


def _graph_call(operation):
    try:
        return operation()
    except sharepoint.NotConnected as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "sharepoint_not_configured"},
        ) from exc
    except sharepoint.GraphError as exc:
        raise HTTPException(
            status_code=exc.status,
            detail={"code": "microsoft_graph_error", "message": exc.message},
        ) from exc


@router.get(
    "/status",
    response_model=dict,
    summary="Check the SharePoint evidence connection",
)
def connection_status():
    return sharepoint.status()


@router.post(
    "/setup",
    response_model=dict,
    summary="Select the evidence site and create the root folder",
)
def setup_sharepoint(
    payload: SharePointSetupRequest,
    _administrator=Depends(require_administrator),
):
    try:
        return sharepoint.configure_site(payload.siteUrl, payload.rootFolder)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_sharepoint_site", "message": str(exc)},
        ) from exc
    except sharepoint.NotConnected as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "sharepoint_credentials_not_configured"},
        ) from exc
    except sharepoint.GraphError as exc:
        raise HTTPException(
            status_code=exc.status,
            detail={"code": "microsoft_graph_error", "message": exc.message},
        ) from exc


@router.get(
    "/grants",
    response_model=dict,
    summary="List grant evidence folders",
)
def grant_folders():
    return _graph_call(sharepoint.list_grants)


@router.get(
    "/list",
    response_model=dict,
    summary="Browse an evidence folder",
)
def list_folder(
    path: str | None = Query(
        default=None,
        description="Path relative to the SharePoint drive root.",
    ),
    item_id: str | None = Query(
        default=None,
        alias="itemId",
        description="Drive item identifier for a child folder.",
    ),
):
    if item_id:
        return _graph_call(lambda: sharepoint.list_children(item_id))
    return _graph_call(lambda: sharepoint.list_folder(path or ""))


@router.post(
    "/provision/{grant_id}",
    response_model=dict,
    summary="Create the standard evidence folders for a grant",
)
def provision_grant(grant_id: int, request: Request):
    grant = request.app.state.grants.get(grant_id, PRIMARY_ORGANIZATION_ID)
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "grant_not_found"},
        )
    client = grant.get("client") or {}
    details = grant.get("grant") or {}
    return _graph_call(
        lambda: sharepoint.provision_grant(
            client.get("displayName") or client.get("name") or "Unassigned",
            details.get("projectReferenceNumber") or grant.get("displayName") or str(grant_id),
            grant.get("reportingObligations") or [],
        )
    )
