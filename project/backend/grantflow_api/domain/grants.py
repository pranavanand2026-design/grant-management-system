from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit


class InvalidGrantBundle(ValueError):
    pass


REQUIRED_OBJECTS = ("client", "grant")
REQUIRED_COLLECTIONS = (
    "milestones",
    "budgetCategories",
    "reportingObligations",
)


def _is_safe_evidence_url(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 2_048:
        return False
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username


def validate_grant_bundle(bundle: dict[str, Any]) -> None:
    """Enforce the minimum contract shared by every grant program."""

    missing_objects = [
        field for field in REQUIRED_OBJECTS
        if not isinstance(bundle.get(field), dict)
    ]
    missing_collections = [
        field for field in REQUIRED_COLLECTIONS
        if not isinstance(bundle.get(field), list)
    ]
    if missing_objects or missing_collections:
        missing = ", ".join(missing_objects + missing_collections)
        raise InvalidGrantBundle(
            f"Grant bundle does not satisfy the normalized contract: {missing}."
        )

    reference = bundle["grant"].get("projectReferenceNumber")
    if not reference:
        raise InvalidGrantBundle(
            "Grant bundle requires grant.projectReferenceNumber."
        )

    for requirement in bundle.get("evidenceRequirements") or []:
        if not isinstance(requirement, dict):
            raise InvalidGrantBundle("Evidence requirements must be objects.")
        documents = requirement.get("documents") or []
        if not isinstance(documents, list):
            raise InvalidGrantBundle("Evidence documents must be a list.")
        for document in documents:
            if isinstance(document, str):
                continue
            if not isinstance(document, dict) or not _is_safe_evidence_url(
                document.get("url")
            ):
                raise InvalidGrantBundle(
                    "Evidence links must use an HTTPS URL without embedded credentials."
                )
