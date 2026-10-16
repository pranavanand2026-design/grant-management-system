from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

import validation
from extractors import PROGRAMS, budget_calculator, milestone_attachment, statement

from ..auth import require_firm_staff
from ..schemas import CrossValidationRequest
from ..services.documents import (
    DocumentExtractionError,
    InvalidUpload,
    extract_uploaded_document,
)

router = APIRouter(
    tags=["extraction"],
    dependencies=[Depends(require_firm_staff)],
)


async def _extract(
    upload: UploadFile,
    suffixes: tuple[str, ...],
    extractor,
    document_label: str,
):
    try:
        return await extract_uploaded_document(
            upload,
            suffixes,
            extractor,
            document_label,
        )
    except InvalidUpload as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        ) from exc
    except DocumentExtractionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.post(
    "/extract",
    response_model=dict,
    summary="Extract a funding agreement",
)
async def extract_agreement(
    file: UploadFile = File(...),
    grant_type: str = Form("ac"),
):
    program = PROGRAMS.get(grant_type)
    if not program:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unknown_grant_program",
                "supported": sorted(PROGRAMS),
            },
        )
    return await _extract(
        file,
        (".pdf", ".docx"),
        program.extract,
        "funding agreement",
    )


@router.post(
    "/extract/attachment",
    response_model=dict,
    summary="Extract a milestone attachment",
)
async def extract_attachment(file: UploadFile = File(...)):
    return await _extract(
        file,
        (".docx",),
        milestone_attachment.extract,
        "Word",
    )


@router.post(
    "/extract/calculator",
    response_model=dict,
    summary="Extract a project budget calculator",
)
async def extract_calculator(file: UploadFile = File(...)):
    return await _extract(
        file,
        (".xlsm", ".xlsx"),
        budget_calculator.extract,
        "Excel",
    )


@router.post(
    "/extract/statement",
    response_model=dict,
    summary="Extract a cashflow statement",
)
async def extract_statement(file: UploadFile = File(...)):
    return await _extract(
        file,
        (".xlsx", ".xlsm"),
        statement.extract,
        "Excel",
    )


@router.post(
    "/cross-validate",
    response_model=dict,
    summary="Cross-check extracted documents",
    description=(
        "Compares agreement, milestone and budget sources and returns both "
        "review findings and one normalized grant bundle."
    ),
)
def cross_validate(payload: CrossValidationRequest):
    if "entities" not in payload.agreement:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="'agreement' must contain an entities object.",
        )
    return validation.cross_validate(
        payload.agreement,
        payload.attachment,
        payload.calculator,
    )
