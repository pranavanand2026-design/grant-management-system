import { apiFetch, responseJson } from "./http.js";

async function request(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await responseJson(response);
  if (!response.ok) {
    const error = new Error(data.detail?.message || data.detail?.code || `HTTP ${response.status}`);
    error.code = data.detail?.code;
    error.detail = data.detail;
    throw error;
  }
  return data;
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

export function loadWorkspaceUsers() {
  return request("/admin/users");
}

/* Invites a grant adviser, administrator or client contributor by email. */
export function invitePerson(person) {
  return request("/admin/people", json("POST", person));
}

export function updatePerson(userId, changes) {
  return request(`/admin/users/${userId}`, json("PATCH", changes));
}

export function removeWorkspaceUser(userId) {
  return request(`/admin/users/${userId}`, { method: "DELETE" });
}

export function loadSignInSettings() {
  return request("/admin/sign-in");
}

export function addDomain(domain) {
  return request("/admin/sign-in/domains", json("POST", { domain }));
}

export function verifyDomain(domain, { skipDns = false } = {}) {
  const query = skipDns ? "?skipDns=true" : "";
  return request(`/admin/sign-in/domains/${encodeURIComponent(domain)}/verify${query}`, { method: "POST" });
}

export function removeDomain(domain) {
  return request(`/admin/sign-in/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
}

export function saveSsoConnection(connection) {
  return request("/admin/sign-in/sso", json("PUT", connection));
}

export function removeSsoConnection() {
  return request("/admin/sign-in/sso", { method: "DELETE" });
}
