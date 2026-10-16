from __future__ import annotations

import secrets
from typing import Callable, Protocol

import storage

EmailTaken = storage.EmailTaken
DomainClaimed = storage.DomainClaimed


class AccessRepository(Protocol):
    """Persistence boundary for firms, people, sign-in methods and assignments."""

    def initialize(self) -> None: ...

    # people
    def list_users(self, organization_id: int) -> list[dict]: ...
    def find_user(self, tenant_id: str, object_id: str) -> dict | None: ...
    def find_user_by_email(self, email: str) -> dict | None: ...
    def save_user(self, user: dict) -> dict: ...
    def delete_user(self, user_id: int, organization_id: int) -> bool: ...
    def mark_signed_in(self, user_id: int) -> None: ...

    # firms
    def get_organization(self, organization_id: int) -> dict | None: ...
    def create_account(
        self,
        organization_name: str,
        user: dict,
        email: str,
        password_hash: str | None = None,
        identity: tuple[str, str] | None = None,
    ) -> dict: ...

    # sign-in methods
    def find_password_credential(self, email: str) -> dict | None: ...
    def set_password(self, user_id: int, email: str, password_hash: str) -> None: ...
    def find_identity_user(self, provider: str, subject: str) -> dict | None: ...
    def link_identity(
        self,
        provider: str,
        subject: str,
        user_id: int,
        email: str,
    ) -> None: ...
    def save_email_code(
        self,
        email: str,
        audience: str,
        code_hash: str,
        expires_at: int,
    ) -> None: ...
    def check_email_code(
        self,
        email: str,
        audience: str,
        matches: Callable[[str], bool],
        now: int,
        max_attempts: int,
    ) -> bool: ...
    def save_oidc_state(self, state: str, data: dict, expires_at: int) -> None: ...
    def pop_oidc_state(self, state: str, now: int) -> dict | None: ...
    def save_login_code(self, code_hash: str, data: dict, expires_at: int) -> None: ...
    def pop_login_code(self, code_hash: str, now: int) -> dict | None: ...

    # firm domains and SSO
    def list_domains(self, organization_id: int) -> list[dict]: ...
    def add_domain(self, organization_id: int, domain: str, token: str) -> None: ...
    def mark_domain_verified(self, organization_id: int, domain: str) -> bool: ...
    def delete_domain(self, organization_id: int, domain: str) -> bool: ...
    def verified_domain_owner(self, domain: str) -> int | None: ...
    def get_sso_connection(self, organization_id: int) -> dict | None: ...
    def get_sso_connection_by_id(self, connection_id: int) -> dict | None: ...
    def save_sso_connection(self, organization_id: int, connection: dict) -> dict: ...
    def delete_sso_connection(self, organization_id: int) -> bool: ...

    # server keys kept locally in development
    def development_secret(self, name: str, generate: Callable[[], str]) -> str: ...


class SQLiteAccessRepository:
    def initialize(self) -> None:
        storage.init_db()

    def list_users(self, organization_id: int) -> list[dict]:
        return storage.list_workspace_users(organization_id)

    def find_user(self, tenant_id: str, object_id: str) -> dict | None:
        return storage.find_workspace_user(tenant_id, object_id)

    def save_user(self, user: dict) -> dict:
        return storage.save_workspace_user(user)

    def delete_user(self, user_id: int, organization_id: int) -> bool:
        return storage.delete_workspace_user(user_id, organization_id)

    def find_user_by_email(self, email: str) -> dict | None:
        return storage.find_workspace_user_by_email(email)

    def mark_signed_in(self, user_id: int) -> None:
        return storage.mark_signed_in(user_id)

    def get_organization(self, organization_id: int) -> dict | None:
        return storage.get_organization(organization_id)

    def create_account(
        self,
        organization_name: str,
        user: dict,
        email: str,
        password_hash: str | None = None,
        identity: tuple[str, str] | None = None,
    ) -> dict:
        return storage.create_account(organization_name, user, email, password_hash, identity)

    def find_password_credential(self, email: str) -> dict | None:
        return storage.find_password_credential(email)

    def set_password(self, user_id: int, email: str, password_hash: str) -> None:
        return storage.set_password(user_id, email, password_hash)

    def find_identity_user(self, provider: str, subject: str) -> dict | None:
        return storage.find_identity_user(provider, subject)

    def link_identity(self, provider: str, subject: str, user_id: int, email: str) -> None:
        return storage.link_identity(provider, subject, user_id, email)

    def save_email_code(
        self,
        email: str,
        audience: str,
        code_hash: str,
        expires_at: int,
    ) -> None:
        return storage.save_email_code(email, audience, code_hash, expires_at)

    def check_email_code(
        self,
        email: str,
        audience: str,
        matches: Callable[[str], bool],
        now: int,
        max_attempts: int,
    ) -> bool:
        return storage.check_email_code(email, audience, matches, now, max_attempts)

    def save_oidc_state(self, state: str, data: dict, expires_at: int) -> None:
        return storage.save_oidc_state(state, data, expires_at)

    def pop_oidc_state(self, state: str, now: int) -> dict | None:
        return storage.pop_oidc_state(state, now)

    def save_login_code(self, code_hash: str, data: dict, expires_at: int) -> None:
        return storage.save_login_code(code_hash, data, expires_at)

    def pop_login_code(self, code_hash: str, now: int) -> dict | None:
        return storage.pop_login_code(code_hash, now)

    def list_domains(self, organization_id: int) -> list[dict]:
        return storage.list_domains(organization_id)

    def add_domain(self, organization_id: int, domain: str, token: str) -> None:
        return storage.add_domain(organization_id, domain, token)

    def mark_domain_verified(self, organization_id: int, domain: str) -> bool:
        return storage.mark_domain_verified(organization_id, domain)

    def delete_domain(self, organization_id: int, domain: str) -> bool:
        return storage.delete_domain(organization_id, domain)

    def verified_domain_owner(self, domain: str) -> int | None:
        return storage.verified_domain_owner(domain)

    def get_sso_connection(self, organization_id: int) -> dict | None:
        return storage.get_sso_connection(organization_id)

    def get_sso_connection_by_id(self, connection_id: int) -> dict | None:
        return storage.get_sso_connection_by_id(connection_id)

    def save_sso_connection(self, organization_id: int, connection: dict) -> dict:
        return storage.save_sso_connection(organization_id, connection)

    def delete_sso_connection(self, organization_id: int) -> bool:
        return storage.delete_sso_connection(organization_id)

    def development_secret(self, name: str, generate: Callable[[], str]) -> str:
        """A key kept in the local database so it survives restarts.

        Production must supply it through the environment instead.
        """
        key = f"development_{name}"
        value = storage.get_setting(key)
        if not value:
            value = generate()
            storage.set_setting(key, value)
        return value

    def development_session_secret(self) -> str:
        return self.development_secret("session_secret", lambda: secrets.token_urlsafe(48))
