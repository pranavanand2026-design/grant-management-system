import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "../config/product.js";
import {
  addDomain,
  invitePerson,
  loadSignInSettings,
  loadWorkspaceUsers,
  provisionSharePointGrant,
  refreshSharePointStatus,
  removeDomain,
  removeSsoConnection,
  removeWorkspaceUser,
  saveSsoConnection,
  setupSharePoint,
  updatePerson,
  verifyDomain,
} from "../api.js";
import { currentIdentity, doorUrl } from "../auth/session.js";
import { DATA, session } from "../store.js";

const PV_KEY = "grantflowProvenance";

export const ROLE_LABELS = {
  administrator: "Administrator",
  grant_adviser: "Grant adviser",
  client_contributor: "Client contributor",
};

const PEOPLE_ERRORS = {
  email_already_registered: `Someone already uses that email in ${PRODUCT_NAME}.`,
  administrator_required: "Only administrators can do that.",
  last_administrator: "Your firm needs at least one administrator.",
  cannot_remove_own_access: "You can't remove your own access.",
  client_name_required: "Enter the client's organisation.",
  unknown_grant_assignments: "One of those grants no longer exists.",
};

const peopleError = (error) => PEOPLE_ERRORS[error.code] || error.message || "That didn't work. Try again.";

export function initProvenance() {
  const on = localStorage.getItem(PV_KEY) !== "off";
  document.body.classList.toggle("pv-off", !on);
  return on;
}

export function SettingsView({ principal }) {
  const [pvOn, setPvOn] = useState(() => localStorage.getItem(PV_KEY) !== "off");
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState("");
  const administrator = principal?.role === "administrator";
  // SharePoint runs on the server's own Microsoft tenant, which only its
  // primary workspace may use.
  const microsoft = principal?.microsoftIntegrations !== false;

  const reload = () => loadWorkspaceUsers().then(setUsers).catch((error) => setUsersError(peopleError(error)));
  useEffect(() => {
    if (administrator && microsoft && session.SP_STATUS === null) refreshSharePointStatus();
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [administrator, microsoft]);

  const staff = users.filter((user) => user.role !== "client_contributor");
  const clients = users.filter((user) => user.role === "client_contributor");
  const isMe = (user) => user.tenantId === principal?.tenantId && user.objectId === principal?.objectId;

  return (
    <section className="view settings-view" id="view-settings">
      <header className="settings-head">
        <div>
          <p className="settings-kicker">{principal?.organizationName || "Your firm"}</p>
          <h1 className="page-title">Workspace settings</h1>
          <p>People, client access and how your firm signs in.</p>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="people-heading">
        <div className="settings-section-head">
          <div>
            <h2 id="people-heading">Your firm</h2>
            <p>Administrators manage people, sign-in and connections. Grant advisers work on every grant and manage clients.</p>
          </div>
        </div>
        {administrator && (
          <InviteForm
            kind="staff"
            onInvited={reload}
            fields={(form, update) => (
              <label>
                <span>Role</span>
                <select value={form.role} onChange={(e) => update("role", e.target.value)}>
                  <option value="grant_adviser">Grant adviser</option>
                  <option value="administrator">Administrator</option>
                </select>
              </label>
            )}
          />
        )}
        {usersError && <p className="settings-empty" role="alert">{usersError}</p>}
        <PeopleList
          people={staff}
          describe={(user) => user.email}
          scope={(user) => administrator && !isMe(user) ? (
            <select aria-label={`Role for ${user.displayName}`} value={user.role}
              onChange={async (e) => {
                try {
                  await updatePerson(user.id, { role: e.target.value });
                  reload();
                } catch (error) {
                  setUsersError(peopleError(error));
                }
              }}>
              <option value="grant_adviser">Grant adviser</option>
              <option value="administrator">Administrator</option>
            </select>
          ) : <span>{ROLE_LABELS[user.role]}{isMe(user) ? " · you" : ""}</span>}
          canRemove={(user) => administrator && !isMe(user)}
          onChanged={reload}
          onError={(error) => setUsersError(peopleError(error))}
        />
      </section>

      <section className="settings-section" aria-labelledby="clients-heading">
        <div className="settings-section-head">
          <div>
            <h2 id="clients-heading">Client access</h2>
            <p>
              Client contributors sign in at the <a href={doorUrl("client")}>client portal</a> with
              the work email you invite. They only see deadlines and document requests for the grants you assign.
            </p>
          </div>
        </div>
        <InviteForm
          kind="client"
          onInvited={reload}
          fields={(form, update) => (
            <label>
              <span>Client organisation</span>
              <input required value={form.clientName} onChange={(e) => update("clientName", e.target.value)} />
            </label>
          )}
        />
        <PeopleList
          people={clients}
          describe={(user) => `${user.email} · ${user.clientName || "Client"}`}
          scope={(user) => <span>{user.grantIds.length} grant{user.grantIds.length === 1 ? "" : "s"}</span>}
          canRemove={() => true}
          onChanged={reload}
          onError={(error) => setUsersError(peopleError(error))}
          empty="No clients invited yet."
        />
      </section>

      {administrator && (
        <section className="settings-section" aria-labelledby="signin-heading">
          <div className="settings-section-head">
            <div>
              <h2 id="signin-heading">Sign-in</h2>
              <p>
                Everyone can sign in with a one-time email code{currentIdentity().config?.providers?.length
                  ? `, ${currentIdentity().config.providers.map((p) => p.label).join(" or ")}` : ""}.
                Connect your firm's own identity provider to send your staff through it.
              </p>
            </div>
          </div>
          <SignInSettings />
        </section>
      )}

      {administrator && microsoft && (
        <section className="settings-section" aria-labelledby="sharepoint-heading">
          <div className="settings-section-head">
            <div>
              <h2 id="sharepoint-heading">Microsoft SharePoint evidence</h2>
              <p>Connect once, then {PRODUCT_NAME} creates consistent grant folders automatically.</p>
            </div>
          </div>
          <SharePointSetup status={session.SP_STATUS} />
        </section>
      )}

      <section className="settings-section settings-quiet" aria-labelledby="display-heading">
        <div className="settings-section-head">
          <div>
            <h2 id="display-heading">Display</h2>
            <p>Personal presentation preferences for this browser.</p>
          </div>
        </div>
        <label className="setting-row settings-toggle">
          <span>
            <strong>Show provenance markers</strong>
            <small>Sourced and derived figures remain visibly distinct.</small>
          </span>
          <input type="checkbox" checked={pvOn} onChange={(event) => {
            const on = event.target.checked;
            setPvOn(on);
            localStorage.setItem(PV_KEY, on ? "on" : "off");
            document.body.classList.toggle("pv-off", !on);
          }} />
        </label>
      </section>
    </section>
  );
}

/* Invites someone by email. Staff join the firm workspace; clients get the
   client portal with access to the chosen grants. */
function InviteForm({ kind, fields, onInvited }) {
  const blank = { email: "", displayName: "", clientName: "", role: kind === "client" ? "client_contributor" : "grant_adviser", grantIds: [] };
  const [form, setForm] = useState(blank);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleGrant = (id) => update(
    "grantIds",
    form.grantIds.includes(id) ? form.grantIds.filter((grantId) => grantId !== id) : [...form.grantIds, id],
  );
  const savedGrants = DATA.grants.filter((grant) => grant._dbId);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await invitePerson(form);
      setForm(blank);
      setStatus(`Invitation emailed to ${form.email}.`);
      onInvited();
    } catch (error) {
      setStatus(peopleError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="access-invite" onSubmit={submit}>
      <div className="access-fields">
        <label>
          <span>Name</span>
          <input required value={form.displayName} onChange={(e) => update("displayName", e.target.value)} />
        </label>
        <label>
          <span>Work email</span>
          <input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </label>
        {fields(form, update)}
      </div>
      {kind === "client" && (
        <fieldset className="access-grants">
          <legend>Grant access</legend>
          {savedGrants.map((grant) => (
            <label key={grant._dbId}>
              <input type="checkbox" checked={form.grantIds.includes(grant._dbId)} onChange={() => toggleGrant(grant._dbId)} />
              <span>
                <b>{grant.displayName}</b>
                <small>{grant.grant.projectReferenceNumber}</small>
              </span>
            </label>
          ))}
          {!savedGrants.length && <p>Save a grant before inviting a client.</p>}
        </fieldset>
      )}
      <div className="access-actions">
        <button className="btn-primary" type="submit" disabled={saving || (kind === "client" && !form.grantIds.length)}>
          {saving ? "Sending…" : kind === "client" ? "Invite client" : "Invite to firm"}
        </button>
        {status && <span role="status">{status}</span>}
      </div>
    </form>
  );
}

function PeopleList({ people, describe, scope, canRemove, onChanged, onError, empty }) {
  if (!people.length) return empty ? <p className="settings-empty">{empty}</p> : null;
  return (
    <div className="access-list">
      {people.map((user) => (
        <article key={user.id}>
          <span className="access-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="access-person">
            <b>{user.displayName}{user.status === "invited" && <em className="access-pending">Invited</em>}</b>
            <small>{describe(user)}</small>
          </span>
          <span className="access-scope">{scope(user)}</span>
          {canRemove(user) ? (
            <button type="button" className="btn-text" onClick={async () => {
              try {
                await removeWorkspaceUser(user.id);
                onChanged();
              } catch (error) {
                onError(error);
              }
            }}>Remove</button>
          ) : <span />}
        </article>
      ))}
    </div>
  );
}

/* ---------------- sign-in: verified domains and the firm's own SSO ---------------- */

const SIGN_IN_ERRORS = {
  invalid_domain: null, // the server's message explains it
  dns_record_not_found: "We couldn't find that DNS record yet. DNS changes can take a while to appear — try again shortly.",
  domain_claimed_by_another_firm: "Another firm has already verified this domain.",
  verified_domain_required: "Verify at least one domain before requiring SSO.",
  client_secret_required: "Enter the client secret from your identity provider.",
  sso_discovery_failed: `${PRODUCT_NAME} couldn't read your provider's OpenID configuration. Check the issuer URL.`,
};

const signInError = (error) => SIGN_IN_ERRORS[error.code] || error.message || "That didn't work. Try again.";

function SignInSettings() {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");
  const development = currentIdentity().config?.mode === "development";
  const reload = () => loadSignInSettings().then(setSettings).catch((error) => setMessage(signInError(error)));
  useEffect(() => { reload(); }, []);

  const act = async (task, done) => {
    setMessage("");
    try {
      await task();
      if (done) setMessage(done);
      reload();
    } catch (error) {
      setMessage(signInError(error));
    }
  };

  if (!settings) return message ? <p className="settings-empty">{message}</p> : null;
  const clientUrl = new URL(doorUrl("client"), window.location.origin).href;

  return (
    <div className="signin-settings">
      <div className="signin-block">
        <h3>Client portal link</h3>
        <p>Share this with clients. Invitations include it automatically.</p>
        <code className="signin-copy">{clientUrl}</code>
      </div>

      <div className="signin-block">
        <h3>Your firm's email domains</h3>
        <p>Prove you own a domain (for example <i>yourfirm.com.au</i>) to route staff at that domain to your identity provider.</p>
        <DomainForm onAdd={(domain) => act(() => addDomain(domain))} />
        {settings.domains.map((item) => (
          <div key={item.domain} className="signin-domain">
            <div>
              <b>{item.domain}</b>
              <span className={item.verified ? "signin-status ok" : "signin-status"}>{item.verified ? "Verified" : "Waiting for DNS"}</span>
            </div>
            {!item.verified && (
              <div className="signin-record">
                <small>Add this TXT record at your DNS provider, then check it:</small>
                <code>{item.record.name}</code>
                <code>{item.record.value}</code>
              </div>
            )}
            <div className="signin-actions">
              {!item.verified && (
                <button type="button" className="btn-secondary" onClick={() => act(() => verifyDomain(item.domain), "Domain verified.")}>
                  Check DNS
                </button>
              )}
              {!item.verified && development && (
                <button type="button" className="btn-text" onClick={() => act(() => verifyDomain(item.domain, { skipDns: true }), "Domain marked verified (development).")}>
                  Mark verified (development)
                </button>
              )}
              <button type="button" className="btn-text" onClick={() => act(() => removeDomain(item.domain))}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="signin-block">
        <h3>Your identity provider (SSO)</h3>
        <p>
          Works with Okta, Microsoft Entra, Google Workspace, Auth0, JumpCloud and any OpenID Connect
          provider. Register {PRODUCT_NAME} as a web application there, with this redirect URI:
        </p>
        <code className="signin-copy">{settings.redirectUri}</code>
        <SsoForm
          // Fresh form after each save, so a typed secret never lingers on screen.
          key={JSON.stringify(settings.sso)}
          connection={settings.sso}
          onSave={(connection) => act(() => saveSsoConnection(connection), "Identity provider saved.")}
          onRemove={() => act(() => removeSsoConnection(), "Identity provider disconnected.")}
        />
      </div>
      {message && <p className="sp-setup-message" role="status">{message}</p>}
    </div>
  );
}

function DomainForm({ onAdd }) {
  const [domain, setDomain] = useState("");
  return (
    <form className="signin-inline" onSubmit={(event) => { event.preventDefault(); onAdd(domain); setDomain(""); }}>
      <input required placeholder="yourfirm.com.au" aria-label="Email domain" value={domain}
        onChange={(event) => setDomain(event.target.value)} />
      <button type="submit" className="btn-secondary">Add domain</button>
    </form>
  );
}

function SsoForm({ connection, onSave, onRemove }) {
  const [form, setForm] = useState(() => ({
    displayName: connection?.displayName || "",
    issuer: connection?.issuer || "",
    clientId: connection?.clientId || "",
    clientSecret: "",
    autoJoin: connection?.autoJoin ?? true,
    enforced: connection?.enforced ?? false,
  }));
  const update = (key) => (event) => setForm((current) => ({
    ...current,
    [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
  }));
  return (
    <form className="signin-sso" onSubmit={(event) => {
      event.preventDefault();
      onSave({ ...form, clientSecret: form.clientSecret || null });
    }}>
      <div className="access-fields">
        <label>
          <span>Name shown on sign-in</span>
          <input required maxLength={60} placeholder="Okta" value={form.displayName} onChange={update("displayName")} />
        </label>
        <label>
          <span>Issuer URL</span>
          <input required type="url" placeholder="https://yourfirm.okta.com" value={form.issuer} onChange={update("issuer")} />
        </label>
        <label>
          <span>Client ID</span>
          <input required value={form.clientId} onChange={update("clientId")} />
        </label>
        <label>
          <span>Client secret</span>
          <input type="password" autoComplete="off" required={!connection}
            placeholder={connection ? "Saved — leave blank to keep" : ""}
            value={form.clientSecret} onChange={update("clientSecret")} />
        </label>
      </div>
      <label className="signin-check">
        <input type="checkbox" checked={form.autoJoin} onChange={update("autoJoin")} />
        <span>Add new staff automatically as grant advisers when they sign in with a verified domain</span>
      </label>
      <label className="signin-check">
        <input type="checkbox" checked={form.enforced} onChange={update("enforced")} />
        <span>Require everyone at your verified domains to sign in through this provider</span>
      </label>
      <div className="access-actions">
        <button type="submit" className="btn-primary">{connection ? "Save changes" : "Connect provider"}</button>
        {connection && <button type="button" className="btn-text" onClick={onRemove}>Disconnect</button>}
      </div>
    </form>
  );
}

function SharePointSetup({ status }) {
  const [siteUrl, setSiteUrl] = useState("");
  const [rootFolder, setRootFolder] = useState(`${PRODUCT_NAME} Grant Evidence`);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const connect = async (event) => {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    try {
      await setupSharePoint(siteUrl, rootFolder);
      setMessage("Evidence site connected and root folder created.");
    } catch (error) {
      setMessage(error.message || "SharePoint could not be connected.");
    } finally {
      setWorking(false);
    }
  };

  const provision = async () => {
    setWorking(true);
    setMessage("");
    try {
      const grants = DATA.grants.filter((grant) => grant._dbId);
      await Promise.all(grants.map((grant) => provisionSharePointGrant(grant._dbId)));
      setMessage(`${grants.length} grant folder${grants.length === 1 ? "" : "s"} ready.`);
    } catch (error) {
      setMessage(error.message || "Grant folders could not be created.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="sp-setup">
      <ol className="sp-steps">
        <li className={status?.credentialsConfigured ? "done" : "current"}>
          <span>{status?.credentialsConfigured ? "✓" : "1"}</span>
          <div>
            <b>Microsoft application access</b>
            <small>
              {status?.credentialsConfigured
                ? "Application credentials are configured."
                : "Your system administrator must configure the Entra application once."}
            </small>
          </div>
        </li>
        <li className={status?.connected ? "done" : status?.credentialsConfigured ? "current" : ""}>
          <span>{status?.connected ? "✓" : "2"}</span>
          <div>
            <b>Select the evidence site</b>
            <small>
              {status?.connected
                ? `Connected to ${status.site}.`
                : `Choose the ${PRODUCT_NAME} SharePoint site and root folder.`}
            </small>
          </div>
        </li>
        <li className={status?.connected ? "current" : ""}>
          <span>3</span>
          <div>
            <b>Prepare grant folders</b>
            <small>Create reporting-period and client-upload folders consistently.</small>
          </div>
        </li>
      </ol>

      {status?.credentialsConfigured && !status?.connected && (
        <form className="sp-connect-form" onSubmit={connect}>
          <label>
            <span>SharePoint site URL</span>
            <input
              type="url"
              required
              placeholder="https://yourtenant.sharepoint.com/sites/Grants"
              value={siteUrl}
              onChange={(event) => setSiteUrl(event.target.value)}
            />
          </label>
          <label>
            <span>Evidence root folder</span>
            <input value={rootFolder} onChange={(event) => setRootFolder(event.target.value)} />
          </label>
          <button type="submit" className="btn-primary" disabled={working}>
            {working ? "Connecting…" : "Connect evidence site"}
          </button>
        </form>
      )}

      {status?.connected && (
        <div className="sp-connected-actions">
          <div>
            <b>{status.site}</b>
            <small>{status.rootFolder}</small>
          </div>
          {status.webUrl && <a className="btn-text" href={status.webUrl} target="_blank" rel="noreferrer">Open SharePoint ↗</a>}
          <button type="button" className="btn-primary" onClick={provision} disabled={working}>
            {working ? "Preparing…" : "Prepare all grant folders"}
          </button>
        </div>
      )}

      {!status?.credentialsConfigured && (
        <p className="sp-admin-note">
          Configure the Entra application values on the server, grant it access
          to the selected SharePoint site, then return here.
        </p>
      )}
      {message && <p className="sp-setup-message" role="status">{message}</p>}
    </div>
  );
}
