from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

import sharepoint

from ..auth import Principal, require_signed_in

router = APIRouter(prefix="/portal", tags=["client portal"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _accessible_grants(request: Request, principal: Principal) -> list[dict]:
    grants = request.app.state.grants.list(principal.organization_id)
    return [
        grant
        for grant in grants
        if principal.can_access_grant(grant["_dbId"])
    ]


def _portal_grant(grant: dict, uploads: list[dict]) -> dict:
    details = grant.get("grant") or {}
    client = grant.get("client") or {}
    reports = [
        {
            "index": index,
            "reportType": report.get("reportType"),
            "dueDate": report.get("dueDate"),
            "periodStartDate": report.get("periodStartDate"),
            "periodEndDate": report.get("periodEndDate"),
            "status": report.get("status"),
            "uploads": [
                upload
                for upload in uploads
                if upload["reportIndex"] == index
            ],
        }
        for index, report in enumerate(grant.get("reportingObligations") or [])
    ]
    requests = [
        {
            "id": item.get("id"),
            "milestoneNumber": item.get("milestoneNumber"),
            "description": item.get("outcome"),
            "satisfied": bool(item.get("satisfied")),
            "documentCount": len(item.get("documents") or []),
        }
        for item in grant.get("evidenceRequirements") or []
        if item.get("required", True)
    ]
    return {
        "id": grant["_dbId"],
        "displayName": grant.get("displayName"),
        "reference": details.get("projectReferenceNumber"),
        "clientName": client.get("displayName") or client.get("name"),
        "reports": reports,
        "requests": requests,
    }


@router.get(
    "/grants",
    response_model=list[dict],
    summary="List the signed-in recipient's deadlines and requests",
)
def recipient_grants(
    request: Request,
    principal: Principal = Depends(require_signed_in),
):
    return [
        _portal_grant(
            grant,
            request.app.state.audit.list_uploads(grant["_dbId"]),
        )
        for grant in _accessible_grants(request, principal)
    ]


@router.post(
    "/grants/{grant_id}/reports/{report_index}/uploads",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a recipient document to the relevant report folder",
)
async def upload_report_document(
    grant_id: int,
    report_index: int,
    request: Request,
    file: UploadFile = File(...),
    principal: Principal = Depends(require_signed_in),
):
    if not principal.can_access_grant(grant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "grant_not_found"},
        )
    grant = request.app.state.grants.get(grant_id, principal.organization_id)
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "grant_not_found"},
        )
    reports = grant.get("reportingObligations") or []
    if report_index < 0 or report_index >= len(reports):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "report_not_found"},
        )
    if not principal.in_primary_organization:
        # Uploads land in the server's own SharePoint tenant.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "sharepoint_not_configured"},
        )
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "upload_too_large", "maximumBytes": MAX_UPLOAD_BYTES},
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "empty_upload"},
        )
    client = grant.get("client") or {}
    details = grant.get("grant") or {}
    try:
        item = sharepoint.upload_report_file(
            client.get("displayName") or client.get("name") or "Unassigned",
            details.get("projectReferenceNumber") or grant.get("displayName") or str(grant_id),
            reports[report_index],
            report_index,
            file.filename or "upload",
            content,
        )
    except sharepoint.NotConnected as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "sharepoint_not_configured"},
        ) from exc
    except sharepoint.GraphError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "microsoft_graph_error", "message": exc.message},
        ) from exc
    event = request.app.state.audit.record_upload(
        {
            "grantId": grant_id,
            "reportIndex": report_index,
            "tenantId": principal.tenant_id,
            "objectId": principal.object_id,
            "displayName": principal.display_name,
            "fileItemId": item["id"],
            "fileName": item["name"],
        }
    )
    return {
        "uploaded": True,
        "file": item,
        "event": event,
        "grantId": grant_id,
        "reportIndex": report_index,
    }
