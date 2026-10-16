import { apiFetch, responseJson } from "./http.js";

export async function extractDocument(endpoint, file, grantType) {
  const form = new FormData();
  form.append("file", file);
  if (grantType) form.append("grant_type", grantType);
  const response = await apiFetch(endpoint.split("?")[0], {
    method: "POST",
    body: form,
  });
  return { res: response, data: await responseJson(response) };
}

export async function crossValidate(payload) {
  const response = await apiFetch("/cross-validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await responseJson(response);
  if (!response.ok) throw new Error(result.detail || response.status);
  return result;
}

export async function fetchGrantTypes() {
  const fallback = {
    ac: { label: "Accelerating Commercialisation (AC)", implemented: true },
    bff: { label: "Boosting Female Founders (BFF)", implemented: true },
  };
  try {
    const response = await apiFetch("/grant-types");
    return response.ok ? { ...fallback, ...await response.json() } : fallback;
  } catch {
    return fallback;
  }
}
