# Architecture

## Product boundary

Each grant management firm is an **organization** with its own private
workspace. Firm staff manage multiple recipient clients and grant agreements
inside it. A recipient client is part of the grant domain; it is not an
authenticated software tenant.

- Organization 1 is the *primary* workspace. It holds data created before
  organizations existed and is the workspace of anyone signing in through the
  server's Microsoft Entra tenant or local development mode.
- Every firm sign-up creates a new organization with the person as its
  administrator.
- Repositories scope every grant and user query by organization, so a grant in
  another organization reads as missing (HTTP 404).
- SharePoint evidence and Entra guest invitations run on the server's own
  Microsoft tenant and are limited to the primary workspace.

## Identity and authorization

```text
password · emailed code · Google · Microsoft · firm OIDC SSO
          │  (matched to one person by linked identity or provider-verified email)
          v
GrantFlow session token → organization + role → grant assignment → API projection
```

- Roles: `Administrator` and `Grant adviser` (firm staff), `Client
  contributor` (client portal, scoped to assigned grants). See
  [Identity and SharePoint setup](IDENTITY_AND_SHAREPOINT_SETUP.md).
- Every sign-in method ends in an HS256 session token signed with
  `GRANTFLOW_SESSION_SECRET`. Passwords are scrypt hashes; emailed codes are
  HMACs; firm SSO secrets are Fernet-encrypted.
- OIDC uses the authorization-code flow with PKCE, a nonce and a cookie that
  binds the flow to the starting browser. ID tokens are verified against the
  provider's keys, audience, issuer and expiry.
- The provider proves identity; the application decides data access.
- The backend never relies on hidden navigation as an authorization control.
- Recipient endpoints return purpose-built projections that omit internal and
  financial fields.

## System flow

```text
Funding agreement ─┐
Milestone source ──┼─> program extractors ─> cross-validation
Budget calculator ─┘                              │
                                                  v
                                      normalized grant bundle
                                                  │
                   ┌──────────────────────────────┼─────────────────────┐
                   v                              v                     v
            grant workspace             expenditure funnel       evidence links
                   │                              │                     │
                   └──────────────────── repository ────────────────────┘
```

Program-specific behavior stops at extraction. Portfolio, timeline,
expenditure, actuals, evidence, and reporting logic consume the normalized
bundle and must not parse source-document layouts.

## Backend dependency direction

```text
routes → services → extractors/domain
   │
   └────→ repository interface → SQLite implementation
```

- `grantflow_api/application.py` assembles the application.
- `grantflow_api/routes/` owns HTTP parameters, status codes, and OpenAPI metadata.
- `grantflow_api/services/` coordinates application operations such as temporary
  upload handling.
- `grantflow_api/domain/` enforces contracts shared by every grant program.
- `grantflow_api/repositories/` isolates persistence from routes and domain logic.
- `extractors/` contains one parser per funding program.
- `validation.py` compares extracted sources and produces review findings.

Replacing SQLite must require a new `GrantRepository` implementation, not route
changes.

## Frontend dependency direction

```text
views/components → api modules
       │
       ├─────────→ domain and calculation modules
       └─────────→ shared UI components
```

- `src/api/` separates grants, extraction, SharePoint, and HTTP configuration.
- `src/config/` contains environment-dependent values.
- `src/domain/` constructs and transforms normalized grant bundles.
- `src/lib/funnel.js` is the canonical expenditure arithmetic.
- `src/lib/derive.js` contains read-only grant status derivations.
- `src/lib/issues.js` builds the portfolio attention queue.
- `src/islands/` owns interaction-heavy tables and timeline rendering.
- `src/views/` composes user workflows.

No view should calculate an alternative version of a total already exposed by
the funnel or derivation modules.

## Scalability assessment

### Already extensible

- Multiple saved grants are first-class records.
- Sidebar and portfolio group grants by recipient client.
- Categories, milestones, reports, statement rows, and evidence requirements
  are data-driven collections.
- The program registry is self-describing.
- AC and BFF feed the same normalized contract.
- Cross-document findings retain their source and location.
- Persistence uses optimistic revisions to prevent silent stale writes.
- Financial totals have one canonical implementation.

### Deliberate constraints

- Client identity currently depends on extracted client fields and display
  names. A durable client identifier should be introduced before automated
  CRM/accounting integrations.
- The browser store is appropriate for one active workspace but is not an
  authorization boundary.
- SQLite is a local repository implementation, not a production scaling
  strategy.
- Document extraction is synchronous. A queue and worker can be introduced
  later without changing the normalized contract.
- Several financial surfaces use encapsulated DOM renderers. Their public
  inputs are stable, but internal changes require focused interaction tests.

## Core invariants

1. Every extracted program maps to the normalized grant bundle.
2. Sourced figures preserve provenance.
3. Planned and actual expenditure are separate values.
4. Eligibility has three explicit states.
5. Attribution cannot silently exceed reviewed eligible expenditure.
6. Agreement limits and advisory estimates use different severities.
7. Missing source data remains missing; it is never invented.
8. Storage revision conflicts never resolve with silent last-write-wins.
