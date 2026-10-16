import { API_BASE_URL } from "../config/runtime.js";

const DEV_ROLE_KEY = "grantflowDevelopmentRole";
const SESSION_KEY = "grantflowSession";

let config = null;
let principal = null;
// True once this page holds a GrantFlow session (password, emailed code,
// Google, Microsoft or firm SSO). Such a page must never fall back to
// another identity when the session ends.
let grantflowSession = false;
let accessToken = null;
let msal = null;
let account = null;
let InteractionRequiredAuthError = null;

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function developmentHeaders(headers = {}) {
  const role = localStorage.getItem(DEV_ROLE_KEY);
  return role ? { ...headers, "X-GrantFlow-Development-Role": role } : headers;
}

async function loadPrincipal(headers = {}) {
  const response = await fetch(apiUrl("/auth/me"), { headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.detail?.code || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  principal = await response.json();
  return principal;
}

/* GrantFlow sessions. Stored per browser so a refresh keeps you signed in
   until the token expires. */
function readSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (stored?.token && stored.expiresAt * 1000 > Date.now()) return stored;
  } catch { /* corrupt or unavailable storage */ }
  localStorage.removeItem(SESSION_KEY);
  return null;
}

function sessionToken() {
  return readSession()?.token || null;
}

function storeSession({ token, expiresAt }) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt }));
}

function errorFromResponse(response, body) {
  const error = new Error(body.detail?.code || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = body.detail?.code || null;
  return error;
}

async function postJson(path, payload) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw errorFromResponse(response, body);
  return body;
}

async function postAccount(path, payload) {
  const body = await postJson(path, payload);
  storeSession(body);
  grantflowSession = true;
  principal = body.principal;
  return principal;
}

/* Which sign-in door this page is: the firm workspace (administrators and
   grant advisers) or the client portal (client contributors). */
export function signInDoor() {
  return /\/client\/?$/.test(window.location.pathname) ? "client" : "firm";
}

export function doorUrl(door) {
  return `${import.meta.env.BASE_URL}${door === "client" ? "client/" : ""}`;
}

export function signUpWithPassword({ organizationName, displayName, email, password }) {
  return postAccount("/auth/signup", { organizationName, displayName, email, password });
}

export function signInWithPassword({ email, password }) {
  return postAccount("/auth/login", { email, password });
}

export function requestPasswordReset(email) {
  return postJson("/auth/password/forgot", { email });
}

/* From a reset or invitation link: set the password and sign in. */
export function resetPassword(token, password) {
  return postAccount("/auth/password/reset", { token, password });
}

/* A ?reset= token in the address bar, removed once read. */
export function takeResetToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("reset");
  if (!token) return null;
  url.searchParams.delete("reset");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return token;
}

/* Whether this work email's firm signs in through its own SSO. */
export function discoverEmail(email) {
  return postJson("/auth/discover", { email });
}

export function sendEmailCode(email, audience) {
  return postJson("/auth/email-code", { email, audience });
}

export function verifyEmailCode(email, audience, code) {
  return postAccount("/auth/email-code/verify", { email, audience, code });
}

/* Full-page navigation, kept on an object so tests can observe it. */
export const browser = {
  go(url) {
    window.location.assign(url);
  },
};

/* Leaves the page: the provider sends the browser back with ?login=… */
export function startProviderSignIn(provider, audience, params = {}) {
  const query = new URLSearchParams({ audience, ...params });
  browser.go(apiUrl(`/auth/oidc/${provider}/start?${query}`));
}

/* Pick up the one-time result of a Google / Microsoft / SSO redirect. */
async function takeRedirectResult() {
  const url = new URL(window.location.href);
  const login = url.searchParams.get("login");
  const failure = url.searchParams.get("login_error");
  if (!login && !failure) return null;
  const provider = url.searchParams.get("provider");
  ["login", "login_error", "provider"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  if (failure) return { error: { code: failure, provider } };
  try {
    await postAccount("/auth/exchange", { code: login });
    return { principal };
  } catch (error) {
    return { error: { code: error.code || "sign_in_expired" } };
  }
}

async function acquireAccessToken() {
  if (!msal || !account) return null;
  try {
    const result = await msal.acquireTokenSilent({
      account,
      scopes: config.scopes,
    });
    accessToken = result.accessToken;
    return accessToken;
  } catch (error) {
    if (
      (InteractionRequiredAuthError && error instanceof InteractionRequiredAuthError)
      || error?.name === "InteractionRequiredAuthError"
    ) {
      await msal.acquireTokenRedirect({ account, scopes: config.scopes });
      return null;
    }
    throw error;
  }
}

export async function initializeIdentity() {
  const response = await fetch(apiUrl("/auth/config"));
  if (!response.ok) throw new Error("The identity service is unavailable.");
  config = await response.json();
  grantflowSession = false;
  principal = null;

  const redirect = await takeRedirectResult();
  if (redirect?.principal) return { config, principal };
  const loginError = redirect?.error || null;

  const token = sessionToken();
  if (token) {
    try {
      await loadPrincipal({ Authorization: `Bearer ${token}` });
      grantflowSession = true;
      return { config, principal };
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) throw error;
      localStorage.removeItem(SESSION_KEY);
    }
  }

  if (config.mode === "development") {
    const role = localStorage.getItem(DEV_ROLE_KEY);
    if (!role) return { config, principal: null, loginError };
    await loadPrincipal(developmentHeaders());
    return { config, principal };
  }

  if (!config.tenantId || !config.clientId || !config.scopes?.length) {
    // GrantFlow's own sign-in methods work without the workspace Entra tenant.
    return { config, principal: null, loginError };
  }
  const library = await import("@azure/msal-browser");
  InteractionRequiredAuthError = library.InteractionRequiredAuthError;
  msal = new library.PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
      postLogoutRedirectUri: `${window.location.origin}${import.meta.env.BASE_URL}`,
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  });
  await msal.initialize();
  const msalRedirect = await msal.handleRedirectPromise();
  account = msalRedirect?.account || msal.getAllAccounts()[0] || null;
  if (!account) return { config, principal: null, loginError };
  await acquireAccessToken();
  await loadPrincipal({ Authorization: `Bearer ${accessToken}` });
  return { config, principal };
}

export async function signIn(role = "administrator") {
  if (config?.mode === "development") {
    localStorage.setItem(DEV_ROLE_KEY, role);
    await loadPrincipal(developmentHeaders());
    return principal;
  }
  await msal.loginRedirect({
    scopes: config.scopes,
    prompt: "select_account",
  });
  return null;
}

export async function signOut() {
  principal = null;
  accessToken = null;
  if (grantflowSession || localStorage.getItem(SESSION_KEY)) {
    grantflowSession = false;
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  if (config?.mode === "development") {
    localStorage.removeItem(DEV_ROLE_KEY);
    return;
  }
  if (msal) await msal.logoutRedirect({ account });
}

export function currentIdentity() {
  return { config, principal };
}

export async function authenticatedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (grantflowSession) {
    const token = sessionToken();
    if (!token) return sessionEnded();
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    return response.status === 401 ? sessionEnded() : response;
  }
  if (config?.mode === "entra") {
    if (!accessToken) await acquireAccessToken();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  } else {
    const role = localStorage.getItem(DEV_ROLE_KEY);
    if (role) headers.set("X-GrantFlow-Development-Role", role);
  }
  return fetch(url, { ...options, headers });
}

function sessionEnded() {
  localStorage.removeItem(SESSION_KEY);
  window.location.reload();
  return new Promise(() => {}); // the page is reloading to the sign-in screen
}
