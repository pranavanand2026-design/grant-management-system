import { API_BASE_URL } from "../config/runtime.js";
import { authenticatedFetch } from "../auth/session.js";

export const API = API_BASE_URL;

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function apiFetch(path, options) {
  return authenticatedFetch(apiUrl(path), options);
}

export async function responseJson(response) {
  return response.json().catch(() => ({}));
}
