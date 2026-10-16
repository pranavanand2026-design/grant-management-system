from __future__ import annotations

from typing import Protocol

import storage


class AuditRepository(Protocol):
    """Append-only boundary for security-relevant workspace events."""

    def initialize(self) -> None: ...

    def record_upload(self, event: dict) -> dict: ...

    def list_uploads(self, grant_id: int) -> list[dict]: ...


class SQLiteAuditRepository:
    def initialize(self) -> None:
        storage.init_db()

    def record_upload(self, event: dict) -> dict:
        return storage.record_upload_event(event)

    def list_uploads(self, grant_id: int) -> list[dict]:
        return storage.list_upload_events(grant_id)
