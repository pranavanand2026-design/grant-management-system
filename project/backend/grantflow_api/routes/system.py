from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from extractors import PROGRAMS

from ..auth import require_firm_staff
from ..schemas import GrantProgramResponse, HealthResponse

router = APIRouter(tags=["system"])


@router.get(
    "/",
    response_model=HealthResponse,
    summary="Check API health",
)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    return HealthResponse(
        service=settings.title,
        version=settings.version,
    )


@router.get(
    "/grant-types",
    response_model=dict[str, GrantProgramResponse],
    summary="List supported grant programs",
    dependencies=[Depends(require_firm_staff)],
)
def grant_types() -> dict[str, GrantProgramResponse]:
    return {
        key: GrantProgramResponse(
            label=program.label,
            implemented=program.implemented,
        )
        for key, program in PROGRAMS.items()
    }
