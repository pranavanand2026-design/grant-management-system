# API

FastAPI generates the executable API reference:

- Swagger UI: `/docs`
- ReDoc: `/redoc`
- OpenAPI schema: `/openapi.json`

The tables below explain the workflow around those endpoints. OpenAPI remains
the source of truth for request fields and response schemas.

## Conventions

- JSON is used except for multipart document uploads.
- Dates inside normalized bundles use `YYYY-MM-DD`.
- Money values are numbers in Australian dollars.
- Missing values use `null`; zero is a real value.
- `_dbId` is the persistence identifier.
- `_rev` is the optimistic revision supplied on update.
- Errors use an HTTP status plus a `detail` value. Structured domain errors
  include a stable `code`.

## System

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Health and version |
| `GET` | `/grant-types` | Registered programs and implementation status |

## Identity

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/auth/config` | Public | Sign-in options: social providers, sign-up, Entra configuration |
| `POST` | `/auth/signup` | Public | Create a firm with a password; returns a session |
| `POST` | `/auth/login` | Public | Firm staff password sign-in; returns a session |
| `POST` | `/auth/discover` | Public | Whether a work email's firm uses its own SSO |
| `POST` | `/auth/email-code` | Public | Email a one-time code (always 202) |
| `POST` | `/auth/email-code/verify` | Public | Sign in with the code; returns a session |
| `GET` | `/auth/oidc/{google\|microsoft\|sso}/start` | Browser | Redirect to the provider (`audience=firm\|client`, `intent=signin\|signup`) |
| `GET` | `/auth/oidc/callback` | Browser | Provider redirect target; returns to the app with a one-time `login` code |
| `POST` | `/auth/exchange` | Public | Trade the one-time `login` code for a session |
| `GET` | `/auth/me` | Authenticated | Resolved identity, organization and role |

Send a session token as `Authorization: Bearer <token>`. Every sign-in method
ends in the same GrantFlow session. Sign-in refusals return a stable
`detail.code` such as `wrong_portal`, `no_account`, `email_not_verified`,
`sso_required` or `invalid_code`. Repeated failed password sign-ins for one
email return HTTP 429.

Grant, extraction and client-portal endpoints only ever see the caller's firm.
Grant endpoints require firm staff (administrator or grant adviser).

## Administration

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/admin/users` | Firm staff | The firm's people and clients |
| `POST` | `/admin/people` | Firm staff¹ | Invite an administrator, grant adviser or client contributor |
| `PATCH` | `/admin/users/{user_id}` | Firm staff¹ | Change role, client organisation or grant access |
| `DELETE` | `/admin/users/{user_id}` | Firm staff¹ | Remove access |
| `GET` | `/admin/sign-in` | Administrator | Verified domains, SSO connection, redirect URI |
| `POST` | `/admin/sign-in/domains` | Administrator | Claim a domain; returns its DNS TXT record |
| `POST` | `/admin/sign-in/domains/{domain}/verify` | Administrator | Check DNS and verify |
| `DELETE` | `/admin/sign-in/domains/{domain}` | Administrator | Release a domain |
| `PUT` | `/admin/sign-in/sso` | Administrator | Connect the firm's OpenID Connect provider |
| `DELETE` | `/admin/sign-in/sso` | Administrator | Disconnect it |

¹ Grant advisers manage client contributors only; firm staff changes need an
administrator.

## Client portal

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/portal/grants` | Assigned deadlines and evidence requests only |
| `POST` | `/portal/grants/{grant_id}/reports/{report_index}/uploads` | Upload to the relevant report folder |

The recipient projection excludes financial, allocation, actuals and internal
review data.

## Extraction

| Method | Path | Input | Purpose |
|---|---|---|---|
| `POST` | `/extract` | `file`, `grant_type` | Extract a funding agreement |
| `POST` | `/extract/attachment` | `file` | Extract milestone planning data |
| `POST` | `/extract/calculator` | `file` | Extract a project budget calculator |
| `POST` | `/extract/statement` | `file` | Extract statement account-period rows |
| `POST` | `/cross-validate` | JSON sources | Compare sources and return findings plus a normalized bundle |

An agreement extraction must expose an `entities` object before it can enter
cross-validation.

## Grants

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/grants` | List normalized grant bundles |
| `POST` | `/grants` | Persist a reviewed grant |
| `PUT` | `/grants/{grant_id}` | Update a grant at an expected revision |
| `DELETE` | `/grants/{grant_id}` | Delete a grant |

The minimum normalized persistence contract is:

```json
{
  "client": {},
  "grant": {
    "projectReferenceNumber": "GRANT-001"
  },
  "milestones": [],
  "budgetCategories": [],
  "reportingObligations": []
}
```

Operational collections such as `allocations`, `statements`, `attributions`,
and `evidenceRequirements` are added during review and use.

### Revision conflicts

Clients send the last observed revision:

```json
{
  "_rev": 4,
  "client": {},
  "grant": {},
  "milestones": [],
  "budgetCategories": [],
  "reportingObligations": []
}
```

If the stored revision has changed, the API returns `409 revision_conflict`.
The submitted payload is not applied.

## Evidence

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sharepoint/status` | Verify evidence connection |
| `GET` | `/sharepoint/grants` | List grant folders under the configured root |
| `GET` | `/sharepoint/list?path=...` | Browse a folder by path |
| `GET` | `/sharepoint/list?itemId=...` | Browse a child folder by drive item ID |
| `POST` | `/sharepoint/setup` | Select the approved evidence site and root folder |
| `POST` | `/sharepoint/provision/{grant_id}` | Create the standard folder hierarchy |

The browser stores references to SharePoint items; it does not copy SharePoint
file content into the grant bundle.
