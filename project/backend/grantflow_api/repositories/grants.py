from __future__ import annotations

from typing import Any, Protocol

import storage


class GrantRepository(Protocol):
    """Persistence boundary for normalized grant bundles.

    Every operation is scoped to one organization: a grant outside it reads
    as missing, so one firm can never see or change another firm's grants.
    """

    def initialize(self) -> None: ...

    def list(self, organization_id: int) -> list[dict[str, Any]]: ...

    def create(self, grant: dict[str, Any], organization_id: int) -> dict[str, Any]: ...

    def get(self, grant_id: int, organization_id: int) -> dict[str, Any] | None: ...

    def update(
        self,
        grant_id: int,
        grant: dict[str, Any],
        expected_revision: int | None,
        organization_id: int,
    ) -> int | None: ...

    def delete(self, grant_id: int, organization_id: int) -> bool: ...


class RevisionConflict(RuntimeError):
    def __init__(self, current_revision: int):
        self.current_revision = current_revision
        super().__init__(f"Stored revision is {current_revision}.")


class SQLiteGrantRepository:
    """Local repository implementation.

    API routes depend on GrantRepository rather than SQLite directly, so a
    managed database can replace this implementation without changing HTTP or
    domain modules.
    """

    def initialize(self) -> None:
        storage.init_db()

    def list(self, organization_id: int) -> list[dict[str, Any]]:
        return storage.list_grants(organization_id)

    def create(self, grant: dict[str, Any], organization_id: int) -> dict[str, Any]:
        return storage.save_grant(grant, organization_id)

    def get(self, grant_id: int, organization_id: int) -> dict[str, Any] | None:
        return storage.get_grant(grant_id, organization_id)

    def update(
        self,
        grant_id: int,
        grant: dict[str, Any],
        expected_revision: int | None,
        organization_id: int,
    ) -> int | None:
        try:
            return storage.update_grant(
                grant_id, grant, organization_id, expected_revision
            )
        except storage.RevConflict as exc:
            raise RevisionConflict(exc.current_rev) from exc

    def delete(self, grant_id: int, organization_id: int) -> bool:
        return storage.delete_grant(grant_id, organization_id)
