import { apiFetch, responseJson } from "./http.js";

export async function loadRecipientGrants() {
  const response = await apiFetch("/portal/grants");
  const data = await responseJson(response);
  if (!response.ok) throw new Error(data.detail?.code || "Could not load your grants.");
  return data;
}

export async function uploadRecipientDocument(grantId, reportIndex, file) {
  const body = new FormData();
  body.append("file", file);
  const response = await apiFetch(
    `/portal/grants/${grantId}/reports/${reportIndex}/uploads`,
    { method: "POST", body },
  );
  const data = await responseJson(response);
  if (!response.ok) {
    throw new Error(
      data.detail?.message
      || (data.detail?.code === "sharepoint_not_configured"
        ? "Evidence storage has not been connected yet. Contact your grant adviser."
        : data.detail?.code)
      || "The file could not be uploaded.",
    );
  }
  return data;
}
