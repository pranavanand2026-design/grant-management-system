const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || "").trim();

export const API_BASE_URL = configuredApiBase.replace(/\/+$/, "")
  || (import.meta.env.DEV ? "http://localhost:8000" : "");

const configuredDate = (import.meta.env.VITE_REFERENCE_DATE || "").trim();
export const REFERENCE_DATE = configuredDate
  ? new Date(`${configuredDate}T00:00:00`)
  : new Date();
