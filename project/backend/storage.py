"""
SQLite persistence for extracted grants.

The /extract endpoint stays stateless — it parses a PDF and forgets it. This
module is the one place that *remembers*: once the frontend has mapped an
extraction into a display grant, it POSTs that grant here so it survives a
page reload (or the browser tab closing) instead of living only in the tab's
memory. One row per saved grant; the grant's JSON is stored verbatim so the
storage layer never has to know the grant's shape.

sqlite3 is in the standard library, so this adds no dependency and the whole
store is a single file (grants.db) next to this module.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

DB_PATH = Path(
    os.environ.get("GRANTFLOW_DATABASE_PATH")
    or os.environ.get("NOAH_DATABASE_PATH")
    or Path(__file__).parent / "grants.db"
).expanduser()

# The workspace that existed before self-service sign-up. Grants and people
# created before organizations existed belong to it, as does anyone signing in
# through the server's Microsoft Entra tenant or local development mode.
PRIMARY_ORGANIZATION_ID = 1
PRIMARY_ORGANIZATION_NAME = "GrantFlow workspace"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS grants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                rev INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        # Migrate a database created before revision tracking existed.
        try:
            conn.execute("ALTER TABLE grants ADD COLUMN rev INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # column already there
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                object_id TEXT NOT NULL,
                email TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL,
                client_name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(tenant_id, object_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS grant_assignments (
                user_id INTEGER NOT NULL,
                grant_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, grant_id),
                FOREIGN KEY (user_id) REFERENCES workspace_users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS upload_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grant_id INTEGER NOT NULL,
                report_index INTEGER NOT NULL,
                tenant_id TEXT NOT NULL,
                object_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                file_item_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)",
            (PRIMARY_ORGANIZATION_ID, PRIMARY_ORGANIZATION_NAME),
        )
        # Migrate grants and people created before organizations existed.
        for table in ("grants", "workspace_users"):
            try:
                conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN organization_id INTEGER "
                    "REFERENCES organizations(id)"
                )
            except sqlite3.OperationalError:
                pass  # column already there
            conn.execute(
                f"UPDATE {table} SET organization_id = ? WHERE organization_id IS NULL",
                (PRIMARY_ORGANIZATION_ID,),
            )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_credentials (
                user_id INTEGER PRIMARY KEY REFERENCES workspace_users(id),
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        _init_sign_in_schema(conn)


def _init_sign_in_schema(conn: sqlite3.Connection) -> None:
    """Roles, linked sign-in identities, firm domains and SSO connections."""
    for column in (
        "status TEXT NOT NULL DEFAULT 'active'",
        "last_sign_in_at TEXT",
    ):
        try:
            conn.execute(f"ALTER TABLE workspace_users ADD COLUMN {column}")
        except sqlite3.OperationalError:
            pass  # column already there
    # Role renamed when client portal roles were defined.
    conn.execute(
        "UPDATE workspace_users SET role = 'client_contributor' "
        "WHERE role = 'recipient_contributor'"
    )
    # One person, one email address: it is how sign-in methods are matched.
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS workspace_users_email "
            "ON workspace_users(lower(email))"
        )
    except sqlite3.IntegrityError:
        pass  # legacy duplicates; the application layer still refuses new ones
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS user_identities (
            provider TEXT NOT NULL,
            subject TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES workspace_users(id),
            email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (provider, subject)
        );
        CREATE TABLE IF NOT EXISTS email_codes (
            email TEXT NOT NULL COLLATE NOCASE,
            audience TEXT NOT NULL,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (email, audience)
        );
        CREATE TABLE IF NOT EXISTS organization_domains (
            organization_id INTEGER NOT NULL REFERENCES organizations(id),
            domain TEXT NOT NULL COLLATE NOCASE,
            verification_token TEXT NOT NULL,
            verified_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (organization_id, domain)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS organization_domains_verified
            ON organization_domains(domain) WHERE verified_at IS NOT NULL;
        CREATE TABLE IF NOT EXISTS sso_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id),
            display_name TEXT NOT NULL,
            issuer TEXT NOT NULL,
            client_id TEXT NOT NULL,
            client_secret TEXT NOT NULL,
            enforced INTEGER NOT NULL DEFAULT 0,
            auto_join INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS oidc_states (
            state TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_codes (
            code_hash TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );
        """
    )


def get_setting(key: str, default=None):
    with _connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value) -> None:
    with _connect() as conn:
        if value is None:
            conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        else:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


class RevConflict(Exception):
    """The row was updated by someone else since the caller last read it."""

    def __init__(self, current_rev: int):
        self.current_rev = current_rev


# The stored grant JSON may carry its own "id" (a frontend slug), so the
# database row id travels under a reserved "_dbId" key that can't collide;
# the row's revision counter travels the same way, as "_rev".
def list_grants(organization_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, data, rev FROM grants WHERE organization_id = ? ORDER BY id",
            (organization_id,),
        ).fetchall()
    return [
        {**json.loads(row["data"]), "_dbId": row["id"], "_rev": row["rev"]}
        for row in rows
    ]


def save_grant(grant: dict, organization_id: int) -> dict:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO grants (data, organization_id) VALUES (?, ?)",
            (json.dumps(grant), organization_id),
        )
    return {**grant, "_dbId": cur.lastrowid, "_rev": 0}


def update_grant(
    grant_id: int,
    grant: dict,
    organization_id: int,
    expected_rev: int | None = None,
) -> int | None:
    """
    Update a grant in place. Returns the new revision, or None if no such row
    exists in the organization.

    When expected_rev is given, the write only lands if the row is still at
    that revision — otherwise RevConflict is raised and *nothing is written*.
    Two open tabs each hold the whole grant in memory and save it whole; an
    unconditional last-writer-wins would let a stale tab silently erase the
    other tab's committed work, which is precisely the kind of quiet data
    loss this product exists to prevent. (expected_rev=None keeps the write
    unconditional, for clients that predate revision tracking.)
    """
    with _connect() as conn:
        if expected_rev is None:
            cur = conn.execute(
                "UPDATE grants SET data = ?, rev = rev + 1 "
                "WHERE id = ? AND organization_id = ?",
                (json.dumps(grant), grant_id, organization_id))
            if not cur.rowcount:
                return None
            row = conn.execute("SELECT rev FROM grants WHERE id = ?", (grant_id,)).fetchone()
            return row["rev"]
        cur = conn.execute(
            "UPDATE grants SET data = ?, rev = rev + 1 "
            "WHERE id = ? AND organization_id = ? AND rev = ?",
            (json.dumps(grant), grant_id, organization_id, expected_rev))
        if cur.rowcount:
            return expected_rev + 1
        row = conn.execute(
            "SELECT rev FROM grants WHERE id = ? AND organization_id = ?",
            (grant_id, organization_id),
        ).fetchone()
        if row is None:
            return None
        raise RevConflict(row["rev"])


def delete_grant(grant_id: int, organization_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM grants WHERE id = ? AND organization_id = ?",
            (grant_id, organization_id),
        )
    return cur.rowcount > 0


def get_grant(grant_id: int, organization_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, data, rev FROM grants WHERE id = ? AND organization_id = ?",
            (grant_id, organization_id),
        ).fetchone()
    if row is None:
        return None
    return {**json.loads(row["data"]), "_dbId": row["id"], "_rev": row["rev"]}


def get_organization(organization_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, name FROM organizations WHERE id = ?",
            (organization_id,),
        ).fetchone()
    return {"id": row["id"], "name": row["name"]} if row else None


_USER_SELECT = """
    SELECT u.*, o.name AS organization_name,
           GROUP_CONCAT(a.grant_id) AS grant_ids
    FROM workspace_users u
    JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN grant_assignments a ON a.user_id = u.id
"""


def _user_row(row) -> dict:
    return {
        "id": row["id"],
        "tenantId": row["tenant_id"],
        "objectId": row["object_id"],
        "email": row["email"],
        "displayName": row["display_name"],
        "role": row["role"],
        "clientName": row["client_name"],
        "organizationId": row["organization_id"],
        "organizationName": row["organization_name"],
        "status": row["status"],
        "lastSignInAt": row["last_sign_in_at"],
        "grantIds": [
            int(value)
            for value in (row["grant_ids"] or "").split(",")
            if value
        ],
    }


def list_workspace_users(organization_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            _USER_SELECT
            + """
            WHERE u.organization_id = ?
            GROUP BY u.id
            ORDER BY lower(u.display_name), lower(u.email)
            """,
            (organization_id,),
        ).fetchall()
    return [_user_row(row) for row in rows]


def find_workspace_user(tenant_id: str, object_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            _USER_SELECT
            + " WHERE u.tenant_id = ? AND u.object_id = ? GROUP BY u.id",
            (tenant_id, object_id),
        ).fetchone()
    return _user_row(row) if row else None


def save_workspace_user(user: dict) -> dict:
    try:
        with _connect() as conn:
            _upsert_workspace_user(conn, user)
    except sqlite3.IntegrityError as exc:
        raise EmailTaken(user["email"]) from exc
    return find_workspace_user(user["tenantId"], user["objectId"])


def _upsert_workspace_user(conn: sqlite3.Connection, user: dict) -> int:
    conn.execute(
        """
        INSERT INTO workspace_users
            (tenant_id, object_id, email, display_name, role, client_name,
             organization_id, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, object_id) DO UPDATE SET
            email = excluded.email,
            display_name = excluded.display_name,
            role = excluded.role,
            client_name = excluded.client_name
        """,
        (
            user["tenantId"],
            user["objectId"],
            user["email"],
            user["displayName"],
            user["role"],
            user.get("clientName"),
            user["organizationId"],
            user.get("status", "active"),
        ),
    )
    row = conn.execute(
        "SELECT id FROM workspace_users WHERE tenant_id = ? AND object_id = ?",
        (user["tenantId"], user["objectId"]),
    ).fetchone()
    user_id = row["id"]
    conn.execute("DELETE FROM grant_assignments WHERE user_id = ?", (user_id,))
    conn.executemany(
        "INSERT INTO grant_assignments (user_id, grant_id) VALUES (?, ?)",
        [(user_id, int(grant_id)) for grant_id in user.get("grantIds", [])],
    )
    return user_id


def delete_workspace_user(user_id: int, organization_id: int) -> bool:
    with _connect() as conn:
        owned = conn.execute(
            "SELECT 1 FROM workspace_users WHERE id = ? AND organization_id = ?",
            (user_id, organization_id),
        ).fetchone()
        if not owned:
            return False
        conn.execute("DELETE FROM grant_assignments WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM password_credentials WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_identities WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM workspace_users WHERE id = ?", (user_id,))
    return True


class EmailTaken(Exception):
    """A password account already uses this email address."""


def create_account(
    organization_name: str,
    user: dict,
    email: str,
    password_hash: str | None = None,
    identity: tuple[str, str] | None = None,
) -> dict:
    """Create a firm and its first administrator in one step.

    The administrator signs in with a password, a linked external identity
    (provider, subject), or both.
    """
    try:
        with _connect() as conn:
            org = conn.execute(
                "INSERT INTO organizations (name) VALUES (?)",
                (organization_name,),
            )
            user_id = _upsert_workspace_user(
                conn,
                {**user, "email": email, "organizationId": org.lastrowid},
            )
            if password_hash:
                conn.execute(
                    "INSERT INTO password_credentials (user_id, email, password_hash) "
                    "VALUES (?, ?, ?)",
                    (user_id, email, password_hash),
                )
            if identity:
                conn.execute(
                    "INSERT INTO user_identities (provider, subject, user_id, email) "
                    "VALUES (?, ?, ?, ?)",
                    (*identity, user_id, email),
                )
    except sqlite3.IntegrityError as exc:
        raise EmailTaken(email) from exc
    return find_workspace_user(user["tenantId"], user["objectId"])


def set_password(user_id: int, email: str, password_hash: str) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO password_credentials (user_id, email, password_hash)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                email = excluded.email,
                password_hash = excluded.password_hash
            """,
            (user_id, email, password_hash),
        )


def find_password_credential(email: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT c.password_hash, u.tenant_id, u.object_id
            FROM password_credentials c
            JOIN workspace_users u ON u.id = c.user_id
            WHERE c.email = ?
            """,
            (email,),
        ).fetchone()
    if row is None:
        return None
    return {
        "passwordHash": row["password_hash"],
        "tenantId": row["tenant_id"],
        "objectId": row["object_id"],
    }


def find_workspace_user_by_email(email: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            _USER_SELECT + " WHERE lower(u.email) = lower(?) GROUP BY u.id",
            (email,),
        ).fetchone()
    return _user_row(row) if row else None


def find_identity_user(provider: str, subject: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            _USER_SELECT
            + """
            JOIN user_identities i ON i.user_id = u.id
            WHERE i.provider = ? AND i.subject = ?
            GROUP BY u.id
            """,
            (provider, subject),
        ).fetchone()
    return _user_row(row) if row else None


def link_identity(provider: str, subject: str, user_id: int, email: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO user_identities (provider, subject, user_id, email) "
            "VALUES (?, ?, ?, ?)",
            (provider, subject, user_id, email),
        )


def mark_signed_in(user_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE workspace_users SET status = 'active', "
            "last_sign_in_at = datetime('now') WHERE id = ?",
            (user_id,),
        )


def save_email_code(email: str, audience: str, code_hash: str, expires_at: int) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO email_codes (email, audience, code_hash, expires_at, attempts)
            VALUES (?, ?, ?, ?, 0)
            ON CONFLICT(email, audience) DO UPDATE SET
                code_hash = excluded.code_hash,
                expires_at = excluded.expires_at,
                attempts = 0
            """,
            (email, audience, code_hash, expires_at),
        )


def check_email_code(
    email: str,
    audience: str,
    matches: Callable[[str], bool],
    now: int,
    max_attempts: int,
) -> bool:
    """Consume the code if `matches(code_hash)`; count a failed attempt otherwise."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT code_hash, expires_at, attempts FROM email_codes "
            "WHERE email = ? AND audience = ?",
            (email, audience),
        ).fetchone()
        if row is None:
            return False
        if row["expires_at"] < now or row["attempts"] >= max_attempts:
            conn.execute(
                "DELETE FROM email_codes WHERE email = ? AND audience = ?",
                (email, audience),
            )
            return False
        if matches(row["code_hash"]):
            conn.execute(
                "DELETE FROM email_codes WHERE email = ? AND audience = ?",
                (email, audience),
            )
            return True
        conn.execute(
            "UPDATE email_codes SET attempts = attempts + 1 "
            "WHERE email = ? AND audience = ?",
            (email, audience),
        )
        return False


def list_domains(organization_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT domain, verification_token, verified_at FROM organization_domains "
            "WHERE organization_id = ? ORDER BY domain",
            (organization_id,),
        ).fetchall()
    return [
        {
            "domain": row["domain"],
            "verificationToken": row["verification_token"],
            "verified": row["verified_at"] is not None,
            "verifiedAt": row["verified_at"],
        }
        for row in rows
    ]


def add_domain(organization_id: int, domain: str, token: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO organization_domains "
            "(organization_id, domain, verification_token) VALUES (?, ?, ?)",
            (organization_id, domain, token),
        )


class DomainClaimed(Exception):
    """Another organization has already verified this domain."""


def mark_domain_verified(organization_id: int, domain: str) -> bool:
    try:
        with _connect() as conn:
            cur = conn.execute(
                "UPDATE organization_domains SET verified_at = datetime('now') "
                "WHERE organization_id = ? AND domain = ?",
                (organization_id, domain),
            )
    except sqlite3.IntegrityError as exc:
        raise DomainClaimed(domain) from exc
    return cur.rowcount > 0


def delete_domain(organization_id: int, domain: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM organization_domains WHERE organization_id = ? AND domain = ?",
            (organization_id, domain),
        )
    return cur.rowcount > 0


def verified_domain_owner(domain: str) -> int | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT organization_id FROM organization_domains "
            "WHERE domain = ? AND verified_at IS NOT NULL",
            (domain,),
        ).fetchone()
    return row["organization_id"] if row else None


def _sso_row(row) -> dict:
    return {
        "id": row["id"],
        "organizationId": row["organization_id"],
        "displayName": row["display_name"],
        "issuer": row["issuer"],
        "clientId": row["client_id"],
        "clientSecret": row["client_secret"],
        "enforced": bool(row["enforced"]),
        "autoJoin": bool(row["auto_join"]),
    }


def get_sso_connection(organization_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM sso_connections WHERE organization_id = ?",
            (organization_id,),
        ).fetchone()
    return _sso_row(row) if row else None


def get_sso_connection_by_id(connection_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM sso_connections WHERE id = ?",
            (connection_id,),
        ).fetchone()
    return _sso_row(row) if row else None


def save_sso_connection(organization_id: int, connection: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO sso_connections
                (organization_id, display_name, issuer, client_id, client_secret,
                 enforced, auto_join)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id) DO UPDATE SET
                display_name = excluded.display_name,
                issuer = excluded.issuer,
                client_id = excluded.client_id,
                client_secret = excluded.client_secret,
                enforced = excluded.enforced,
                auto_join = excluded.auto_join
            """,
            (
                organization_id,
                connection["displayName"],
                connection["issuer"],
                connection["clientId"],
                connection["clientSecret"],
                int(connection["enforced"]),
                int(connection["autoJoin"]),
            ),
        )
    return get_sso_connection(organization_id)


def delete_sso_connection(organization_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM sso_connections WHERE organization_id = ?",
            (organization_id,),
        )
    return cur.rowcount > 0


def _save_expiring(table: str, key_column: str, key: str, data: dict, expires_at: int) -> None:
    with _connect() as conn:
        conn.execute(f"DELETE FROM {table} WHERE expires_at < strftime('%s', 'now')")
        conn.execute(
            f"INSERT INTO {table} ({key_column}, data, expires_at) VALUES (?, ?, ?)",
            (key, json.dumps(data), expires_at),
        )


def _pop_expiring(table: str, key_column: str, key: str, now: int) -> dict | None:
    """Single use: the row is deleted whether or not it has expired."""
    with _connect() as conn:
        row = conn.execute(
            f"SELECT data, expires_at FROM {table} WHERE {key_column} = ?",
            (key,),
        ).fetchone()
        conn.execute(f"DELETE FROM {table} WHERE {key_column} = ?", (key,))
    if row is None or row["expires_at"] < now:
        return None
    return json.loads(row["data"])


def save_oidc_state(state: str, data: dict, expires_at: int) -> None:
    _save_expiring("oidc_states", "state", state, data, expires_at)


def pop_oidc_state(state: str, now: int) -> dict | None:
    return _pop_expiring("oidc_states", "state", state, now)


def save_login_code(code_hash: str, data: dict, expires_at: int) -> None:
    _save_expiring("login_codes", "code_hash", code_hash, data, expires_at)


def pop_login_code(code_hash: str, now: int) -> dict | None:
    return _pop_expiring("login_codes", "code_hash", code_hash, now)


def record_upload_event(event: dict) -> dict:
    with _connect() as conn:
        result = conn.execute(
            """
            INSERT INTO upload_events
                (grant_id, report_index, tenant_id, object_id, display_name,
                 file_item_id, file_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event["grantId"],
                event["reportIndex"],
                event["tenantId"],
                event["objectId"],
                event["displayName"],
                event["fileItemId"],
                event["fileName"],
            ),
        )
        row = conn.execute(
            "SELECT * FROM upload_events WHERE id = ?",
            (result.lastrowid,),
        ).fetchone()
    return {
        "id": row["id"],
        "grantId": row["grant_id"],
        "reportIndex": row["report_index"],
        "tenantId": row["tenant_id"],
        "objectId": row["object_id"],
        "displayName": row["display_name"],
        "fileItemId": row["file_item_id"],
        "fileName": row["file_name"],
        "createdAt": row["created_at"],
    }


def list_upload_events(grant_id: int) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM upload_events
            WHERE grant_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (grant_id,),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "grantId": row["grant_id"],
            "reportIndex": row["report_index"],
            "displayName": row["display_name"],
            "fileName": row["file_name"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]
