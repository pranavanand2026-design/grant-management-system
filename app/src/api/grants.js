import { bump, DATA, session, state } from "../store.js";
import { apiFetch, responseJson } from "./http.js";

const saveChains = new Map();

export function saveGrantIfPersisted(grant) {
  const previous = saveChains.get(grant) || Promise.resolve();
  const next = previous
    .then(() => persistGrant(grant))
    .catch(() => "offline");
  saveChains.set(grant, next);
  return next;
}

async function persistGrant(grant) {
  if (!grant._dbId) return "memory";
  if (grant._conflict) return "conflict";

  const { _dbId, _rev, _conflict, ...payload } = grant;
  try {
    const response = await apiFetch(`/grants/${_dbId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, _rev: _rev ?? 0 }),
    });
    if (response.ok) {
      grant._rev = (await response.json())._rev;
      return "saved";
    }
    if (response.status === 409) {
      grant._conflict = true;
      if (state.view === "grant" && state.grantId === grant.id) bump();
      return "conflict";
    }
    if (response.status === 404) {
      const recreated = await createGrant(payload);
      if (recreated) {
        grant._dbId = recreated._dbId;
        grant._rev = recreated._rev;
        return "saved";
      }
    }
    return "offline";
  } catch {
    return "offline";
  }
}

export async function createGrant(grant) {
  const response = await apiFetch("/grants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(grant),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function loadStoredGrants() {
  session.STORE_STATE = "loading";
  bump();
  try {
    const response = await apiFetch("/grants");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const grants = await response.json();
    grants.forEach((grant) => {
      if (!grant.grant || !grant.milestones) return;
      if (DATA.grants.some((candidate) => candidate._dbId === grant._dbId)) return;
      if (!grant.id) grant.id = `grant_db_${grant._dbId}`;
      DATA.grants.push(grant);
    });
    session.STORE_STATE = "done";
  } catch {
    session.STORE_STATE = "error";
  }
  bump();
}

export async function deleteGrantOnServer(grant) {
  if (!grant._dbId) return true;
  try {
    const response = await apiFetch(`/grants/${grant._dbId}`, {
      method: "DELETE",
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function resetDemoData() {
  const response = await apiFetch("/grants");
  const grants = await responseJson(response);
  await Promise.all(
    grants.map((grant) =>
      apiFetch(`/grants/${grant._dbId}`, { method: "DELETE" })
    )
  );
}
