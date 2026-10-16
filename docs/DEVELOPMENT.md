# Development standards

## Principles

### Keep domain logic independent

Calculations must not depend on React, DOM nodes, HTTP requests, or SQLite.
Transport and storage modules may call domain functions; domain modules do not
call transport or storage.

### Normalize once

Program extractors own document differences. After cross-validation, all
workflows consume the normalized grant bundle.

### One source for each calculation

Allocation, eligibility, attribution, remaining balances, and recognised
actuals belong in the funnel module. Do not reproduce formulas in a view.

### Make invalid states explicit

Use `null` for missing values, explicit decision states for review, structured
errors at API boundaries, and revision conflicts for concurrent writes.

### Depend on interfaces at infrastructure boundaries

Routes use `GrantRepository`. A managed database implementation should replace
the local repository without altering domain or route behavior.

### Prefer small public surfaces

Modules should export the minimum functions required by their consumers.
Avoid cross-feature imports into component internals.

## Comments

Comments are appropriate when they explain:

- A compliance or accounting invariant
- Why an apparently simpler implementation would be incorrect
- A source-format irregularity
- A browser or concurrency constraint
- The contract at an infrastructure boundary

Comments should not:

- Restate a function name or obvious syntax
- Describe historical implementation work
- Preserve abandoned behavior
- Substitute for clear names and focused functions

Public Python modules and non-obvious exported functions should have concise
docstrings. React components need comments only when they enforce a domain or
interaction invariant.

## Repository map

```text
app/
  src/api/             Browser API clients grouped by capability
  src/config/          Runtime configuration
  src/domain/          Program-independent grant operations
  src/islands/         Interaction-heavy financial surfaces
  src/lib/             Pure calculations and small utilities
  src/views/           React application views

design-system/
  src/components/      Shared UI components
  src/tokens.css       Design tokens
  src/app.css          Semantic application styles

project/backend/
  grantflow_api/routes/     FastAPI transport layer
  grantflow_api/services/   Application services
  grantflow_api/domain/     Normalized domain contracts
  grantflow_api/repositories/ Persistence interfaces and implementations
  extractors/          Program-specific document parsers
  tests/               API architecture and extractor tests

project/grants/         Local, ignored source-document fixtures
```

## Runtime configuration

| Variable | Purpose | Local default |
|---|---|---|
| `VITE_API_BASE_URL` | Browser API origin | `http://localhost:8000` in development; same origin in production |
| `VITE_REFERENCE_DATE` | Optional fixed date for demonstrations | Unset; the application uses the current date |
| `GRANTFLOW_CORS_ORIGINS` | Comma-separated allowed browser origins | Local Vite origins |
| `GRANTFLOW_DATABASE_PATH` | SQLite path for local persistence | `project/backend/grants.db` |
| `GRANTFLOW_ENVIRONMENT` | Runtime safety boundary | `development` |
| `GRANTFLOW_AUTH_MODE` | `development` or Microsoft `entra` authentication for the primary workspace | `development` |
| `GRANTFLOW_SIGNUP_ENABLED` | Allow email-and-password sign-up | `true` |
| `GRANTFLOW_SESSION_SECRET` | Signing key for password sessions (32+ characters; required in production) | Generated and kept in the local database |
| `GRANTFLOW_SESSION_HOURS` | Session lifetime for every sign-in method | `12` |
| `GRANTFLOW_PUBLIC_API_URL` | Browser-facing API address; OAuth providers redirect to `<it>/auth/oidc/callback` | `http://localhost:8000` |
| `GRANTFLOW_GOOGLE_CLIENT_ID` / `_SECRET` | Enables **Continue with Google** | Unset |
| `GRANTFLOW_MICROSOFT_CLIENT_ID` / `_SECRET` | Enables **Continue with Microsoft** | Unset |
| `GRANTFLOW_MICROSOFT_TENANT` | `organizations` for any Microsoft work account, or one tenant ID to admit only that directory | `organizations` |
| `GRANTFLOW_ENCRYPTION_KEY` | Fernet key for firms' stored SSO secrets (required in production) | Generated and kept in the local database |
| `GRANTFLOW_SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `_STARTTLS` | Delivers sign-in codes and invitations (required in production) | Unset: emails print to the server log |
| `GRANTFLOW_EMAIL_FROM` | Sender address | `GrantFlow <no-reply@grantflow.local>` |
| `ENTRA_TENANT_ID` | GrantFlow Microsoft Entra tenant | None |

Each `GRANTFLOW_*` variable also accepts its earlier `NOAH_*` name.
| `ENTRA_CLIENT_ID` | Browser/API application identifier | None |
| `ENTRA_CLIENT_SECRET` | Server credential for invitations and Graph | None |
| `ENTRA_API_SCOPE` | Exposed API scope requested by the browser | `api://<client-id>/access_as_user` |
| `SP_TENANT_ID` | Microsoft Entra tenant | None |
| `SP_CLIENT_ID` | Microsoft Graph application | None |
| `SP_CLIENT_SECRET` | Microsoft Graph credential | None |
| `SP_SITE_ID` | SharePoint evidence site | None |
| `SP_ROOT_FOLDER` | Root evidence folder | `Grant Evidence` |

Production should leave `VITE_REFERENCE_DATE` unset so deadlines use the real
date. Secrets belong in runtime configuration, never source control. Source
agreements and financial workbooks belong under `project/grants/input/`,
which is ignored as client-confidential data.

## Tests

Every change should run:

```bash
cd app && npm test && npm run build
cd project/backend && ../../.venv/bin/python -m unittest discover -s tests -v
```

Install backend test dependencies with:

```bash
../../.venv/bin/pip install -r project/backend/requirements-dev.txt
```

Changes to grant extraction require golden-fixture tests. Changes to
calculation modules require pure unit tests. Changes to navigation or dense
interaction surfaces require a rendered workflow test.

Tests that depend on private fixtures must skip with a clear reason when those
fixtures are absent; they must not turn a clean checkout red.

## Definition of done

- Normalized contract preserved
- Provenance preserved
- No duplicated financial calculation
- API documentation updated
- Relevant tests added or updated
- Frontend and design-system builds pass
- No secrets, databases, uploads, caches, or generated output added to source
