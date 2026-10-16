from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


# The product name is still being decided: change it here and in
# app/src/config/product.js.
PRODUCT_NAME = "GrantFlow"


def product_env(name: str, default: str = "") -> str:
    """Read GRANTFLOW_<name>, falling back to the legacy NOAH_<name>."""
    value = os.getenv(f"GRANTFLOW_{name}")
    if value is None:
        value = os.getenv(f"NOAH_{name}", default)
    return value.strip()


def _flag(value: str) -> bool:
    return value.lower() not in {"0", "false", "no", "off", ""}


@dataclass(frozen=True)
class Settings:
    """Runtime configuration loaded once when the API starts."""

    title: str
    version: str
    cors_origins: tuple[str, ...]
    frontend_directory: Path
    environment: str = "development"
    auth_mode: str = "development"
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: str = ""
    entra_api_scope: str = ""
    entra_admin_role: str = "GrantFlow.Administrator"
    public_app_url: str = "http://localhost:8000/app/"
    # Email-and-password accounts. Each sign-up creates its own firm.
    signup_enabled: bool = True
    session_secret: str = ""
    session_hours: int = 12
    # Where browsers reach this API; OAuth providers redirect back to it.
    public_api_url: str = "http://localhost:8000"
    # "Continue with Google" / "Continue with Microsoft" (any work account).
    google_client_id: str = ""
    google_client_secret: str = ""
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    # "organizations": any Microsoft work account (a multitenant app).
    # A tenant ID: only that directory (a single-tenant app, e.g. your own).
    microsoft_tenant: str = "organizations"
    # Encrypts firms' SSO client secrets at rest (a Fernet key).
    encryption_key: str = ""
    # Sign-in codes and invitations. Without SMTP they are printed to the log.
    email_from: str = f"{PRODUCT_NAME} <no-reply@grantflow.local>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def microsoft_enabled(self) -> bool:
        return bool(self.microsoft_client_id and self.microsoft_client_secret)

    @classmethod
    def from_environment(cls) -> "Settings":
        backend_directory = Path(__file__).resolve().parents[1]
        repository_root = backend_directory.parents[1]
        origins = tuple(
            origin.strip()
            for origin in product_env(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if origin.strip()
        )
        return cls(
            title=f"{PRODUCT_NAME} API",
            version="1.0.0",
            cors_origins=origins,
            frontend_directory=repository_root / "app" / "dist",
            environment=product_env("ENVIRONMENT", "development").lower(),
            auth_mode=product_env("AUTH_MODE", "development").lower(),
            entra_tenant_id=os.getenv("ENTRA_TENANT_ID", "").strip(),
            entra_client_id=os.getenv("ENTRA_CLIENT_ID", "").strip(),
            entra_client_secret=os.getenv("ENTRA_CLIENT_SECRET", "").strip(),
            entra_api_scope=os.getenv(
                "ENTRA_API_SCOPE",
                (
                    f"api://{os.getenv('ENTRA_CLIENT_ID', '').strip()}/access_as_user"
                    if os.getenv("ENTRA_CLIENT_ID", "").strip()
                    else ""
                ),
            ).strip(),
            entra_admin_role=os.getenv(
                "ENTRA_ADMIN_ROLE",
                "GrantFlow.Administrator",
            ).strip(),
            public_app_url=product_env(
                "PUBLIC_APP_URL",
                "http://localhost:8000/app/",
            ),
            signup_enabled=_flag(product_env("SIGNUP_ENABLED", "true")),
            session_secret=product_env("SESSION_SECRET"),
            session_hours=int(product_env("SESSION_HOURS", "12") or 12),
            public_api_url=product_env("PUBLIC_API_URL", "http://localhost:8000").rstrip("/"),
            google_client_id=product_env("GOOGLE_CLIENT_ID"),
            google_client_secret=product_env("GOOGLE_CLIENT_SECRET"),
            microsoft_client_id=product_env("MICROSOFT_CLIENT_ID"),
            microsoft_client_secret=product_env("MICROSOFT_CLIENT_SECRET"),
            microsoft_tenant=product_env("MICROSOFT_TENANT", "organizations") or "organizations",
            encryption_key=product_env("ENCRYPTION_KEY"),
            email_from=product_env("EMAIL_FROM", f"{PRODUCT_NAME} <no-reply@grantflow.local>"),
            smtp_host=product_env("SMTP_HOST"),
            smtp_port=int(product_env("SMTP_PORT", "587") or 587),
            smtp_username=product_env("SMTP_USERNAME"),
            smtp_password=product_env("SMTP_PASSWORD"),
            smtp_starttls=_flag(product_env("SMTP_STARTTLS", "true")),
        )
