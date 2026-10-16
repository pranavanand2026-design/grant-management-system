from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

# The workspace served by the server's own Microsoft Entra tenant (and local
# development mode). Self-service sign-ups each get a separate organization.
PRIMARY_ORGANIZATION_ID = 1


class Role(StrEnum):
    """Who someone is in a firm's workspace.

    Firm staff are administrators (people, sign-in and workspace settings)
    or grant advisers (all grant work). Client contributors work at the
    client company that received a grant and only see grants assigned to them.
    """

    ADMINISTRATOR = "administrator"
    GRANT_ADVISER = "grant_adviser"
    CLIENT_CONTRIBUTOR = "client_contributor"

    @property
    def is_firm_staff(self) -> bool:
        return self in FIRM_ROLES

    @classmethod
    def _missing_(cls, value):
        # Role names stored or sent before GrantFlow defined its roles.
        return {
            "noah_administrator": cls.ADMINISTRATOR,
            "recipient_contributor": cls.CLIENT_CONTRIBUTOR,
        }.get(value)


FIRM_ROLES = frozenset({Role.ADMINISTRATOR, Role.GRANT_ADVISER})


@dataclass(frozen=True)
class Identity:
    tenant_id: str
    object_id: str
    email: str
    display_name: str
    token_roles: tuple[str, ...] = ()
    development_role: Role | None = None


@dataclass(frozen=True)
class Principal:
    tenant_id: str
    object_id: str
    email: str
    display_name: str
    role: Role
    organization_id: int = PRIMARY_ORGANIZATION_ID
    organization_name: str = ""
    client_name: str | None = None
    grant_ids: tuple[int, ...] = ()
    development_preview: bool = False

    @property
    def in_primary_organization(self) -> bool:
        return self.organization_id == PRIMARY_ORGANIZATION_ID

    def can_access_grant(self, grant_id: int) -> bool:
        """Grant-level access *within* the principal's organization.

        Repositories already hide other organizations' grants, so this only
        narrows a client contributor to the grants assigned to them.
        """
        return (
            self.role.is_firm_staff
            or self.development_preview
            or grant_id in self.grant_ids
        )
