import { bump, session } from "../store.js";
import { apiFetch, responseJson } from "./http.js";

function apiError(data, fallback) {
  if (typeof data?.detail === "string") return data.detail;
  return data?.detail?.message || data?.detail?.code || fallback;
}

export function spCacheFor(grant) {
  if (!session.SP_CACHE.has(grant.id)) {
    session.SP_CACHE.set(grant.id, {
      root: null,
      children: new Map(),
      error: null,
      loading: false,
    });
  }
  return session.SP_CACHE.get(grant.id);
}

export async function spLoadRoot(grant, onDone) {
  const cache = spCacheFor(grant);
  if (cache.loading) return;
  cache.loading = true;
  cache.error = null;
  try {
    const response = await apiFetch(
      `/sharepoint/list?path=${encodeURIComponent(grant.spFolderPath)}`
    );
    const data = await responseJson(response);
    if (!response.ok) {
      cache.error = response.status === 401
        ? "not_configured"
        : apiError(data, `Microsoft Graph returned ${response.status}.`);
    } else {
      cache.root = data;
    }
  } catch {
    cache.error = "Backend unreachable.";
  }
  cache.loading = false;
  onDone ? onDone() : bump();
}

export async function spLoadChildren(grant, item, onDone) {
  const cache = spCacheFor(grant);
  if (cache.children.has(item.id)) {
    if (onDone) onDone();
    return;
  }
  cache.children.set(item.id, { loading: true, items: null });
  onDone ? onDone() : bump();
  try {
    const response = await apiFetch(
      `/sharepoint/list?itemId=${encodeURIComponent(item.id)}`
    );
    const data = await responseJson(response);
    cache.children.set(
      item.id,
      response.ok
        ? { items: data.items }
        : { error: apiError(data, `HTTP ${response.status}`) },
    );
  } catch {
    cache.children.set(item.id, { error: "Backend unreachable." });
  }
  onDone ? onDone() : bump();
}

export async function spLoadGrants(onDone) {
  try {
    const response = await apiFetch("/sharepoint/grants");
    const data = await responseJson(response);
    session.SP_GRANTS = response.ok
      ? data
      : {
          error: response.status === 401
            ? "SharePoint isn't configured on the backend."
            : apiError(data, `HTTP ${response.status}`),
        };
  } catch {
    session.SP_GRANTS = { error: "Backend unreachable." };
  }
  onDone ? onDone() : bump();
}

export async function refreshSharePointStatus() {
  try {
    const response = await apiFetch("/sharepoint/status");
    session.SP_STATUS = await response.json();
  } catch {
    session.SP_STATUS = { offline: true };
  }
  bump();
}

export async function setupSharePoint(siteUrl, rootFolder) {
  const response = await apiFetch("/sharepoint/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteUrl, rootFolder }),
  });
  const data = await responseJson(response);
  if (!response.ok) throw new Error(data.detail?.message || data.detail?.code);
  session.SP_STATUS = data;
  bump();
  return data;
}

export async function provisionSharePointGrant(grantId) {
  const response = await apiFetch(`/sharepoint/provision/${grantId}`, {
    method: "POST",
  });
  const data = await responseJson(response);
  if (!response.ok) throw new Error(data.detail?.message || data.detail?.code);
  return data;
}
