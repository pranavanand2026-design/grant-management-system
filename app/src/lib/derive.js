/* Read-only grant status and reporting derivations. */

import { esc } from "@gf-ui";
import { daysUntil, ISO, TODAY, fmtDate } from "./format.js";
import { categoryActual } from "./funnel.js";

/* A grant's lifecycle phase relative to today. */
export function lifecycle(g) {
  const todayIso = TODAY.toISOString().slice(0, 10);
  const start = g.grant.projectStartDate, end = g.grant.projectEndDate;
  if (start && todayIso < start) return "not_started";
  if (end && todayIso > end) return "completed";
  return "active";
}

export function catUsed(g) {
  const used = {};
  (g.budgetCategories || []).forEach((c) => { used[c.name] = 0; });
  let any = false;
  g.quarters.forEach((q) => {
    if (!q.eligibleByCategory) return;
    any = true;
    Object.entries(q.eligibleByCategory).forEach(([k, v]) => {
      if (used[k] != null) used[k] += v;
    });
  });
  return any ? used : null;
}

export function overCeilingCats(g) {
  const used = catUsed(g);
  if (!used) return [];
  return (g.budgetCategories || [])
    .filter((c) => c.total != null && used[c.name] > c.total)
    .map((c) => ({ name: c.name, used: used[c.name], ceiling: c.total }));
}

export function nextReport(g) {
  return (g.reportingObligations || [])
    .filter((r) => ISO.test(r.dueDate || "") && r.status !== "submitted")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
}

export function evidenceGaps(g) { return (g.evidenceRequirements || []).filter((r) => !r.satisfied); }

/* A document entry is either a bare filename or a {name,url} pointer. */
export function docLabel(d) {
  return String(typeof d === "string" ? d : d?.name || "Evidence document");
}

export function docUrl(d) {
  if (!d || typeof d === "string") return null;
  try {
    const parsed = new URL(String(d.url));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function gapsBlocking(g, report) {
  if (!report || !report.periodEndDate) return [];
  const msByNum = {};
  (g.milestones || []).forEach((m) => { msByNum[m.number] = m; });
  return evidenceGaps(g).filter((r) => {
    const m = msByNum[r.milestoneNumber];
    return m && m.plannedAchievementDate && m.plannedAchievementDate <= report.periodEndDate;
  });
}

export function unresolvedFindings(g) {
  return (g.validationFindings || []).filter((f) => f.severity === "warning" && !f.resolution && !f.dismissed);
}

export function capSpend(g, cap) {
  /* eligible expenditure falling in the cap's financial year (Jul-Jun) */
  const [y0] = cap.financialYear.split("/");
  const start = `${y0}-07-01`, end = `${Number(y0) + 1}-06-30`;
  let sum = 0, any = false;
  (g.quarters || []).forEach((q) => {
    if (q.eligibleExpenditure == null) return;
    if (q.periodStart >= start && q.periodStart <= end) { sum += q.eligibleExpenditure * (g.grant.grantPercentage || 50) / 100; any = true; }
  });
  return any ? sum : null;
}

export function breachedCaps(g) {
  return (g.annualCaps || []).filter((c) => {
    const s = capSpend(g, c);
    return s != null && c.cappedAmount != null && s > c.cappedAmount;
  });
}

export function gatedPayment(g) {
  const rep = nextReport(g);
  if (!rep) return null;
  const q = g.quarters.find((x) => x.reportDueDate === rep.dueDate);
  if (!q || q.eligibleExpenditure == null) return null;
  return { amount: q.eligibleExpenditure * (g.grant.grantPercentage || 50) / 100, quarter: q };
}

export function overdueReports(g) {
  return (g.reportingObligations || [])
    .filter((r) => ISO.test(r.dueDate || "") && r.status !== "submitted" && daysUntil(r.dueDate) < 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* One entry per category over its contractual category limit — reported quarterly
   figures or recognised actuals; recognised carries the wording when both. */
export function ceilingBreaches(g) {
  const out = new Map();
  overCeilingCats(g).forEach((o) =>
    out.set(o.name, { name: o.name, used: o.used, ceiling: o.ceiling, basis: "reported" }));
  (g.budgetCategories || []).forEach((c) => {
    if (c.total == null || c.total === 0) return;
    const actual = categoryActual(g, c.name);
    if (actual > c.total) out.set(c.name, { name: c.name, used: actual, ceiling: c.total, basis: "recognised" });
  });
  return [...out.values()];
}

export function upcomingObligations(g) {
  return (g.reportingObligations || [])
    .filter((r) => r.status !== "submitted")
    .map((r) => {
      const dated = ISO.test(r.dueDate || "");
      return { r, dated, days: dated ? daysUntil(r.dueDate) : null };
    })
    .sort((a, b) => {
      if (a.dated && b.dated) return a.r.dueDate.localeCompare(b.r.dueDate);
      return a.dated === b.dated ? 0 : a.dated ? -1 : 1;
    });
}

export function deadlineSeverity(days) {
  if (days == null) return "plain";
  if (days <= 7) return "breach";
  if (days <= 30) return "warn";
  return "plain";
}

export function statusLine(g) {
  const life = lifecycle(g);
  if (life === "not_started") return `Not yet started — begins ${fmtDate(g.grant.projectStartDate)}.`;
  if (life === "completed") return `Completed — ended ${fmtDate(g.grant.projectEndDate)}.`;
  const todayIso = TODAY.toISOString().slice(0, 10);
  const reached = g.milestones.filter((m) => m.plannedAchievementDate && m.plannedAchievementDate <= todayIso).length;
  return `Active — ${reached} of ${g.milestones.length} milestones reached.`;
}
