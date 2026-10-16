from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import (
    Authenticator,
    PasswordAccounts,
    SessionAwareAuthenticator,
    build_authenticator,
)
from .config import Settings
from .repositories import (
    AccessRepository,
    AuditRepository,
    GrantRepository,
    SQLiteAccessRepository,
    SQLiteAuditRepository,
    SQLiteGrantRepository,
)
from .routes import admin, auth, extraction, grants, portal, sharepoint, system
from .auth.sign_in import SignInService
from .services.mail import build_email_sender
from .services.oidc import OidcClient
from .services.secret_box import SecretBox


def create_app(
    settings: Settings | None = None,
    grant_repository: GrantRepository | None = None,
    access_repository: AccessRepository | None = None,
    audit_repository: AuditRepository | None = None,
    authenticator: Authenticator | None = None,
    oidc: OidcClient | None = None,
    mail=None,
) -> FastAPI:
    """Build the API with replaceable configuration and persistence."""

    resolved_settings = settings or Settings.from_environment()
    repository = grant_repository or SQLiteGrantRepository()
    access = access_repository or SQLiteAccessRepository()
    audit = audit_repository or SQLiteAuditRepository()
    repository.initialize()
    access.initialize()
    audit.initialize()

    app = FastAPI(
        title=resolved_settings.title,
        version=resolved_settings.version,
        description=(
            "Extracts supported grant documents, cross-checks their facts, "
            "persists reviewed grant bundles, and browses linked evidence."
        ),
        openapi_tags=[
            {"name": "system", "description": "Health and supported programs."},
            {"name": "identity", "description": "Sign-up, sign-in and current access."},
            {"name": "administration", "description": "Firm people, clients and sign-in settings."},
            {"name": "extraction", "description": "Document extraction and cross-checking."},
            {"name": "grants", "description": "Reviewed grant workspace persistence."},
            {"name": "evidence", "description": "SharePoint evidence browsing."},
            {"name": "client portal", "description": "Client contributors' deadlines and uploads."},
        ],
    )
    app.state.settings = resolved_settings
    app.state.grants = repository
    app.state.access = access
    app.state.audit = audit
    workspace_authenticator = authenticator or build_authenticator(resolved_settings)
    app.state.accounts = PasswordAccounts(
        _session_secret(resolved_settings, access),
        resolved_settings.session_hours,
    )
    app.state.authenticator = SessionAwareAuthenticator(
        app.state.accounts,
        workspace_authenticator,
    )
    app.state.sign_in = SignInService(
        resolved_settings,
        access,
        oidc or OidcClient(
            allow_private_hosts=resolved_settings.environment != "production",
        ),
        mail or build_email_sender(resolved_settings),
        SecretBox(_encryption_key(resolved_settings, access)),
        hashing_secret=app.state.accounts.secret,
    )

    if resolved_settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(resolved_settings.cors_origins),
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(system.router)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(portal.router)
    app.include_router(extraction.router)
    app.include_router(grants.router)
    app.include_router(sharepoint.router)

    if resolved_settings.frontend_directory.is_dir():
        index = resolved_settings.frontend_directory / "index.html"

        # The client portal's sign-in door is the same single-page app.
        @app.get("/app/client", include_in_schema=False)
        @app.get("/app/client/", include_in_schema=False)
        def client_portal() -> FileResponse:
            return FileResponse(index)

        app.mount(
            "/app",
            StaticFiles(
                directory=str(resolved_settings.frontend_directory),
                html=True,
            ),
            name="app",
        )
    return app


def _session_secret(settings: Settings, access: AccessRepository) -> str:
    if settings.session_secret:
        return settings.session_secret
    if settings.environment == "production":
        raise RuntimeError("GRANTFLOW_SESSION_SECRET is required in production.")
    return access.development_session_secret()


def _encryption_key(settings: Settings, access: AccessRepository) -> str:
    if settings.encryption_key:
        return settings.encryption_key
    if settings.environment == "production":
        raise RuntimeError("GRANTFLOW_ENCRYPTION_KEY is required in production.")
    return access.development_secret("encryption_key", SecretBox.generate_key)
