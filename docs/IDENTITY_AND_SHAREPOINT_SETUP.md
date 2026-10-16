# Identity and SharePoint setup

## Roles

Each grant management firm has its own private workspace. Within it:

| Role | Who | Access |
|---|---|---|
| `Administrator` | Firm staff who run the workspace | Everything grant advisers can do, plus firm people, sign-in settings and connections |
| `Grant adviser` | Firm staff doing the grant work | Every grant in the firm, document extraction, evidence, and inviting or updating clients |
| `Client contributor` | People at the client company that received a grant | Deadlines, evidence requests and report uploads for the grants assigned to them only |

Authorization is checked by the API on every request. One email address
belongs to one person in GrantFlow.

## Two sign-in doors

| Door | URL | For |
|---|---|---|
| Firm workspace | `/app/` | Administrators and grant advisers |
| Client portal | `/app/client/` | Client contributors |

A person who comes in the wrong door is told so and linked to the right one.
Invitations link to the right door automatically.

**Firm workspace (email first).** Staff enter their work email. If their firm
has verified that email domain and connected its own identity provider, they
are sent straight to it. Otherwise they choose a password, a one-time emailed
code, Google or Microsoft. New firms sign up here (with a password, Google or
Microsoft); the person signing up becomes the administrator.

**Client portal.** Clients use the work email their grant adviser has on file.
By default GrantFlow emails them a six-digit code (valid ten minutes, five
attempts). If that address is a Google Workspace or Microsoft 365 account they
can use **Continue with Google / Microsoft** instead.

### How external sign-ins are matched

Every Google, Microsoft or firm-SSO sign-in is matched to a GrantFlow person:

1. by an identity linked at an earlier sign-in; otherwise
2. by email address, **only if the provider vouches for it**: Google's
   `email_verified`; Microsoft's `xms_edov` claim (Entra lets tenant admins
   set arbitrary `email` values, so the plain claim is not proof); a firm's
   own provider only for the domains that firm has verified with GrantFlow;
3. otherwise, on the firm door, by signing up a new firm or — if the firm
   allows it — joining a firm whose verified domain matches, as a grant
   adviser.

Anything else is refused. A firm that **requires SSO** blocks every other
method (password, code, Google, Microsoft) for its staff at its domains.

## Local development

```bash
cp project/backend/.sharepoint.env.example project/backend/.sharepoint.env
./run.sh
```

In development the firm door offers **Continue as local administrator** and
**Preview as a grant adviser**, and the client portal offers **Preview the
client portal**. Without SMTP settings, sign-in codes and invitations are
printed to the server log instead of sent.

Development shortcuts refuse to start when `GRANTFLOW_ENVIRONMENT=production`.

## Continue with Google

1. In Google Cloud console, create an OAuth client of type **Web application**.
2. Add the authorized redirect URI `<GRANTFLOW_PUBLIC_API_URL>/auth/oidc/callback`,
   for example `https://grantflow.example.com/auth/oidc/callback`.
3. Set `GRANTFLOW_GOOGLE_CLIENT_ID` and `GRANTFLOW_GOOGLE_CLIENT_SECRET`.

## Continue with Microsoft

Two ways to set it up:

**Your own tenant only (reuse the workspace Entra app).** Set
`GRANTFLOW_MICROSOFT_CLIENT_ID`, `GRANTFLOW_MICROSOFT_CLIENT_SECRET` to the
workspace app's ID and secret and `GRANTFLOW_MICROSOFT_TENANT` to its tenant
ID. In that app registration, under **Authentication → Add a platform → Web**,
add the redirect URI `<GRANTFLOW_PUBLIC_API_URL>/auth/oidc/callback`. People
in the tenant who hold the `ENTRA_ADMIN_ROLE` app role sign straight into the
primary workspace as administrators; anyone else in the tenant needs an
invitation. Email addresses from your own directory are trusted, so
`xms_edov` is not required.

**Any organisation's Microsoft 365 (a multitenant app).** This lets staff and
clients of any firm sign in with Microsoft. Leave `GRANTFLOW_MICROSOFT_TENANT`
unset (it defaults to `organizations`) and register a separate app:

1. Create an app registration with **Accounts in any organizational directory
   (multitenant)**.
2. Add a **Web** redirect URI `<GRANTFLOW_PUBLIC_API_URL>/auth/oidc/callback`.
3. Create a client secret.
4. Under **Token configuration → Add optional claim → ID**, add `email` and
   `xms_edov`. Without `xms_edov`, GrantFlow can't trust the email address and
   first-time Microsoft sign-ins are refused.
5. Set `GRANTFLOW_MICROSOFT_CLIENT_ID` and `GRANTFLOW_MICROSOFT_CLIENT_SECRET`.

## A firm's own identity provider (SSO)

Firm administrators set this up themselves in **Settings → Sign-in**:

1. **Verify an email domain.** Add the domain; GrantFlow shows a TXT record
   (`_grantflow-verification.<domain>`) to add at the firm's DNS provider, then
   **Check DNS**. A domain can be verified by only one firm, and shared
   providers such as gmail.com can't be claimed.
2. **Connect the provider.** In Okta, Microsoft Entra, Google Workspace,
   Auth0, JumpCloud or any OpenID Connect provider, register GrantFlow as a web
   application with the redirect URI shown in Settings, then enter the issuer
   URL, client ID and client secret. GrantFlow checks the provider's discovery
   document before saving and stores the secret encrypted with
   `GRANTFLOW_ENCRYPTION_KEY`.
3. Optionally **add new staff automatically** (they join as grant advisers)
   and **require SSO** for everyone at the verified domains.

SAML-only providers are not supported yet; most SAML providers also offer
OpenID Connect.

## Workspace Microsoft Entra application (primary workspace)

The primary workspace can also be reached through a single-tenant Entra
application (`GRANTFLOW_AUTH_MODE=entra`), which also gives it SharePoint
evidence folders. Create one single-tenant app registration in the GrantFlow
Microsoft Entra tenant.

1. Add the SPA redirect URI for the application, for example
   `https://<host>/app/`.
2. Expose an API scope named `access_as_user`.
3. Add an application role:
   - Display name: `Administrator`
   - Value: `GrantFlow.Administrator`
   - Allowed member type: Users/Groups
4. Assign the administrator user or group to that role through the Enterprise
   Application.
5. Add the Microsoft Graph application permission `Sites.Selected` for the
   evidence site.
6. Grant tenant administrator consent.
7. Set the production environment values shown in
   `project/backend/.sharepoint.env.example`.

The backend validates signature, issuer, audience, expiry, tenant and object
identifier on every Entra access token. An authenticated user without the
administrator app role or a stored workspace membership is denied.

## Grant the selected SharePoint site

`Sites.Selected` consent does not itself select a site. A Microsoft 365
administrator must grant the application write access to the chosen evidence
site once. This can be performed with the Microsoft Graph site permissions API
or the equivalent SharePoint administration tooling.

Do not replace `Sites.Selected` with tenant-wide site access merely to avoid
this setup step.

## First administrator session

After the server configuration and selected-site permission are in place:

1. Sign in as the administrator.
2. Open **Settings → Microsoft SharePoint evidence**.
3. Enter the approved SharePoint site URL.
4. Confirm the root folder name.
5. Select **Connect evidence site**.
6. Select **Prepare all grant folders**.

The application stores the selected SharePoint site identifier and root folder
in local settings. Credentials remain in server configuration and must move to
Azure Key Vault in production.

The resulting hierarchy is:

```text
GrantFlow Grant Evidence/
  Recipient organisation/
    Grant reference/
      General agreement evidence/
      Reporting periods/
        Due date - Report type/
          Client uploads/
```

Folder and file references use Microsoft Graph item identifiers wherever they
are persisted. Recipient uploads are written by the backend only after
grant-level authorization.

## Invite people

From **Settings**:

- **Your firm** (administrators): invite grant advisers or administrators by
  work email, change roles, remove access. A firm always keeps at least one
  administrator.
- **Client access** (administrators and grant advisers): invite a client
  contributor with their organisation and the grants they should see.

GrantFlow emails the invitation with a link to the right door. There is no
password to set: they sign in with that email address.

## Production requirements

- Use `GRANTFLOW_ENVIRONMENT=production`.
- Use `GRANTFLOW_AUTH_MODE=entra` (or leave the primary workspace to
  GrantFlow's own sign-in methods).
- Configure SMTP (`GRANTFLOW_SMTP_*`) so sign-in codes and invitations are
  delivered; the server refuses to start in production without it.
- Set `GRANTFLOW_ENCRYPTION_KEY` (a Fernet key) from a secret store; changing
  it makes stored firm SSO secrets unreadable.
- Set `GRANTFLOW_PUBLIC_API_URL` to the HTTPS address browsers use, so
  provider redirects come back to the right place.
- Set a random `GRANTFLOW_SESSION_SECRET` of at least 32 characters from a
  secret store; rotating it signs every password user out.
- Store client secrets in Azure Key Vault or use a managed identity where the
  final Graph permission model supports it.
- Require HTTPS.
- Configure the exact production redirect URI.
- Apply Conditional Access and MFA to administrator accounts.
- Back the access repository with the production database.
- Add immutable upload and access audit events before accepting real evidence.
