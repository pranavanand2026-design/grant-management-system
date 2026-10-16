from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from ..auth import Principal, require_firm_staff
from ..domain import InvalidGrantBundle, validate_grant_bundle
from ..repositories import RevisionConflict
from ..schemas import DeleteResponse, RevisionResponse

router = APIRouter(
    prefix="/grants",
    tags=["grants"],
    dependencies=[Depends(require_firm_staff)],
)


def _repository(request: Request):
    return request.app.state.grants


@router.get(
    "",
    response_model=list[dict[str, Any]],
    summary="List grants",
    description="Returns the normalized grant bundles of the signed-in firm.",
)
def list_grants(
    request: Request,
    principal: Principal = Depends(require_firm_staff),
) -> list[dict[str, Any]]:
    return _repository(request).list(principal.organization_id)


@router.post(
    "",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    summary="Create a grant",
    description="Persists a reviewed, normalized grant bundle.",
)
def create_grant(
    request: Request,
    grant: dict[str, Any] = Body(...),
    principal: Principal = Depends(require_firm_staff),
) -> dict[str, Any]:
    try:
        validate_grant_bundle(grant)
    except InvalidGrantBundle as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_grant_bundle", "message": str(exc)},
        ) from exc
    return _repository(request).create(grant, principal.organization_id)


@router.put(
    "/{grant_id}",
    response_model=RevisionResponse,
    summary="Update a grant",
    description=(
        "Updates a grant only when its _rev matches the stored revision. "
        "A stale write receives HTTP 409 and does not overwrite newer work."
    ),
)
def update_grant(
    grant_id: int,
    request: Request,
    grant: dict[str, Any] = Body(...),
    principal: Principal = Depends(require_firm_staff),
) -> RevisionResponse:
    expected_revision = grant.pop("_rev", None)
    grant.pop("_dbId", None)
    try:
        validate_grant_bundle(grant)
        revision = _repository(request).update(
            grant_id,
            grant,
            expected_revision,
            principal.organization_id,
        )
    except InvalidGrantBundle as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_grant_bundle", "message": str(exc)},
        ) from exc
    except RevisionConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "revision_conflict",
                "message": "The grant was changed elsewhere. Nothing was overwritten.",
                "currentRevision": exc.current_revision,
                "submittedRevision": expected_revision,
            },
        ) from exc

    if revision is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "grant_not_found", "grantId": grant_id},
        )
    return RevisionResponse(database_id=grant_id, revision=revision)


@router.delete(
    "/{grant_id}",
    response_model=DeleteResponse,
    summary="Delete a grant",
)
def delete_grant(
    grant_id: int,
    request: Request,
    principal: Principal = Depends(require_firm_staff),
) -> DeleteResponse:
    if not _repository(request).delete(grant_id, principal.organization_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "grant_not_found", "grantId": grant_id},
        )
    return DeleteResponse(deleted=grant_id)
