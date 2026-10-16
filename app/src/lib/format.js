/* App-specific date, period, and input formatting. */

import { ISO } from "@gf-ui";
import { REFERENCE_DATE } from "../config/runtime.js";

export { money, fmtDate, esc, ISO, SOURCE_LABELS } from "@gf-ui";

export const TODAY = REFERENCE_DATE;
export const DAY = 24 * 60 * 60 * 1000;

/* Display-only shortening — strips the common " Expenditure" suffix and
   abbreviates the one category whose full name doesn't fit narrow columns.
   Never used for matching/lookup. */
export function shortCatName(n) { return n.replace(" Expenditure", "").replace("SMP/PMP", "SMP"); }

export function daysUntil(iso) {
  if (!ISO.test(iso || "")) return null;
  return Math.round((new Date(iso + "T00:00:00") - TODAY) / DAY);
}
export function pct(n, d) { return d ? Math.round((n / d) * 100) : null; }

/* Never assume "in N days" is meaningful past a year out. */
export function relativeLabel(iso) {
  const d = daysUntil(iso);
  if (d == null || Math.abs(d) > 365) return null;
  if (d === 0) return "today";
  if (d > 0) return `in ${d} day${d === 1 ? "" : "s"}`;
  return `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
}

/* One hue, ramped by lightness only so weight follows magnitude. */
export function categoryTints(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    return `oklch(${48 + 30 * t}% 0.14 35)`;
  });
}

export function parseAmt(raw) {
  if (String(raw).trim() === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

export function parseFlexibleDate(text) {
  const t = (text || "").trim();
  if (ISO.test(t)) return t;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const day = Number(m[1]), mo = Number(m[2]), yr = Number(m[3]);
    const dt = new Date(yr, mo - 1, day);
    if (dt.getMonth() === mo - 1) return `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return null;
  }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const mo = months[m[2].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  return null;
}

export function detectFieldType(value) {
  if (value == null) return "missing";
  if (typeof value === "number") return "money";
  if (typeof value === "string") {
    if (ISO.test(value)) return "date";
    if (value.length > 90) return "prose";
  }
  return "text";
}

/* Integer month-length arithmetic — never Date/toISOString for a period
   boundary (UTC rollback bug in positive-offset timezones). */
export function daysInMonth(year, month1) { // month1 is 1-indexed
  const lens = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lens[month1 - 1];
}
export function periodBounds(period) { // "YYYY-MM" -> ["YYYY-MM-01", last day]
  const [y, m] = period.split("-").map(Number);
  return [period + "-01", period + "-" + String(daysInMonth(y, m)).padStart(2, "0")];
}
export function periodLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "numeric" });
}

/* Absolute date always, relative wording beside it. */
export function dueText(iso) {
  if (!ISO.test(iso || "")) return escStr(iso || "—");
  const d = daysUntil(iso), abs = fmtDateStr(iso);
  if (d < -365) return `${abs} · unresolved`;
  if (d < 0) return `${abs} · ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} overdue`;
  if (d === 0) return `${abs} · due today`;
  if (d <= 365) return `${abs} · in ${d} day${d === 1 ? "" : "s"}`;
  return abs;
}

export function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

export function draftNameFrom(title) {
  if (!title) return "";
  const words = title.split(" ").filter((w) => w.length > 3);
  return words.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || title;
}
export function titleCase(s) {
  return (s || "").toLowerCase().replace(/(^|\s|\.)([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\b(Pty|Ltd)\b\.?/gi, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
}

// local aliases used above (avoid importing into template literals repeatedly)
import { esc as escStr, fmtDate as fmtDateStr } from "@gf-ui";
