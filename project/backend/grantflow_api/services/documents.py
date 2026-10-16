from __future__ import annotations

import os
import tempfile
import zipfile
from io import BytesIO
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import UploadFile


class InvalidUpload(ValueError):
    pass


class DocumentExtractionError(RuntimeError):
    pass


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 2_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_COMPRESSION_RATIO = 100


def _validate_office_archive(contents: bytes) -> None:
    """Reject malformed, encrypted, or explosively compressed Office files."""

    try:
        with zipfile.ZipFile(BytesIO(contents)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise InvalidUpload("The Office document contains too many files.")

            total_uncompressed = 0
            total_compressed = 0
            for entry in entries:
                if entry.flag_bits & 0x1:
                    raise InvalidUpload("Encrypted Office documents are not supported.")
                total_uncompressed += entry.file_size
                total_compressed += entry.compress_size
                if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                    raise InvalidUpload(
                        "The Office document expands beyond the safe processing limit."
                    )

            ratio = total_uncompressed / max(total_compressed, 1)
            if ratio > MAX_ARCHIVE_COMPRESSION_RATIO:
                raise InvalidUpload(
                    "The Office document is compressed beyond the safe processing limit."
                )
    except zipfile.BadZipFile as exc:
        raise InvalidUpload("The Office document is not a valid DOCX/XLSX file.") from exc


async def extract_uploaded_document(
    upload: UploadFile,
    suffixes: tuple[str, ...],
    extractor: Callable[[str], dict[str, Any]],
    document_label: str,
) -> dict[str, Any]:
    """Validate an upload, expose it to a path-based extractor, and clean up."""

    filename = upload.filename or ""
    suffix = Path(filename).suffix.lower()
    if suffix not in suffixes:
        accepted = ", ".join(suffixes)
        raise InvalidUpload(
            f"Please upload a {document_label} file ({accepted})."
        )

    contents = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise InvalidUpload(
            f"The uploaded file exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."
        )
    if not contents:
        raise InvalidUpload("The uploaded file is empty.")
    if suffix in {".docx", ".xlsx", ".xlsm"}:
        _validate_office_archive(contents)

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
            temporary.write(contents)
            temporary_path = temporary.name
        return extractor(temporary_path)
    except (ValueError, NotImplementedError):
        raise
    except Exception as exc:
        raise DocumentExtractionError(f"Failed to extract: {exc}") from exc
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.remove(temporary_path)
