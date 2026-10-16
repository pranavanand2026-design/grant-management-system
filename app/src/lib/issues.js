/* Builds the actionable portfolio queue from normalized grant data. */

import { esc, money, pv } from "@gf-ui";
import { openGrant } from "../store.js";
import {
  breachedCaps, capSpend, ceilingBreaches, gapsBlocking, gatedPayment,
  lifecycle, nextReport, overdueReports, unresolvedFindings,
} from "./derive.js";
import { allStatementRows, categoryFunnel, pendingDecisions, rowHardWarnings } from "./funnel.js";
import { daysUntil, dueText, ISO, periodLabel, shortCatName } from "./format.js";

export const PORT_STATUS = {
  1: { label: "Report overdue", sev: "breach" },
  2: { label: "Limit exceeded", sev: "breach" },
  3: { label: "Duplicate attribution", sev: "breach" },
  4: { label: "Due soon", sev: "warn" },
  5: { label: "Evidence required", sev: "warn" },
  6: { label: "Document conflict", sev: "warn" },
  7: { label: "Needs review", sev: "warn" },
  8: { label: "Unresolved report", sev: "warn" },
  9: { label: "Due soon", sev: "" },
};

export function grantIssues(g) {
  const issues = [];
  const rep = nextReport(g);

  overdueReports(g).forEach((r) => {
    const ancient = daysUntil(r.dueDate) < -365;
    const isNext = rep && r.dueDate === rep.dueDate && r.reportType === rep.reportType;
    const pay = isNext && !ancient ? gatedPayment(g) : null;
    issues.push({
      kind: ancient ? "unresolved" : "overdue", rank: ancient ? 8 : 1,
      text: `${esc(r.reportType)} due ${dueText(r.dueDate)}`,
      money: pay
        ? pv(money(pay.amount), "derived", null,
            `${money(pay.quarter.eligibleExpenditure)} eligible expenditure × ${g.grant.grantPercentage}% grant percentage. Approximate: clause 7.5(b) pays the grant percentage of expenditure estimated for the coming quarter plus previously incurred expenditure — this figure is neither.`)
          + " reimbursement depends on this report"
        : null,
      why: "An overdue reporting obligation gates payment under the agreement.",
      actionLabel: "Review report readiness",
      go: () => openGrant(g.id, "overview"),
    });
  });

  ceilingBreaches(g).forEach((b) => issues.push({
    kind: "limits", rank: 2,
    text: `${esc(b.name)} is ${money(b.used - b.ceiling)} over its ${money(b.ceiling)} ceiling`,
    tip: b.basis === "recognised"
      ? "Recognised actuals from tagged statement rows against the contractual category limit."
      : "Reported quarterly eligible expenditure against the contractual category limit.",
    why: "A contractual category spending limit is exceeded.",
    actionLabel: "Open expenditure", go: () => openGrant(g.id, "expenditure"),
  }));
  breachedCaps(g).forEach((c) => {
    const s = capSpend(g, c);
    issues.push({
      kind: "limits", rank: 2,
      text: `FY ${esc(c.financialYear)} annual cap exceeded — ${money(s)} against the ${money(c.cappedAmount)} cap`,
      tip: `Eligible expenditure falling in FY ${c.financialYear} × ${g.grant.grantPercentage || 50}% grant percentage, against the agreement's capped amount for that year.`,
      why: "An annual capped amount in the agreement is exceeded.",
      actionLabel: "Open expenditure", go: () => openGrant(g.id, "expenditure"),
    });
  });

  (g.budgetCategories || []).forEach((c) => {
    categoryFunnel(g, c.name).overPeriods.forEach(({ period, over }) => issues.push({
      kind: "duplicate", rank: 3,
      text: `${esc(shortCatName(c.name))} · ${esc(periodLabel(period))} — ${money(over)} attributed beyond what was tagged eligible`,
      why: "More was attributed to milestones than was tagged eligible — the same dollars may be counted twice.",
      actionLabel: "Review attribution",
      go: () => openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: { category: c.name, period } }),
    }));
  });

  const gaps = rep ? gapsBlocking(g, rep) : [];
  const days = rep && ISO.test(rep.dueDate || "") ? daysUntil(rep.dueDate) : null;
  if (days != null && days >= 0 && days <= 30) {
    const unresolved = gaps.length + unresolvedFindings(g).length + pendingDecisions(g).rows;
    issues.push({
      kind: "duesoon", rank: unresolved ? 4 : 9,
      text: `${esc(rep.reportType)} due ${dueText(rep.dueDate)}`,
      why: unresolved
        ? "A report is due within 30 days while items on this grant are still unresolved."
        : "A report is due within 30 days.",
      actionLabel: "Review report readiness", go: () => openGrant(g.id, "overview"),
    });
  }
  if (gaps.length) issues.push({
    kind: "evidence", rank: 5, n: gaps.length,
    text: `${gaps.length} measurable outcome${gaps.length === 1 ? "" : "s"} in the current reporting period ${gaps.length === 1 ? "has" : "have"} no evidence`,
    why: "Evidence is required for outcomes falling in the period the next report covers — prevents report readiness.",
    actionLabel: "Open evidence", go: () => openGrant(g.id, "evidence"),
  });

  unresolvedFindings(g).forEach((f) => issues.push({
    kind: "conflicts", rank: 6,
    text: esc(f.title),
    why: "Two source documents disagree. The difference is recorded until you resolve it.",
    actionLabel: "Compare documents",
    go: () => f.milestoneNumber
      ? openGrant(g.id, "milestones", { msDetail: f.milestoneNumber })
      : openGrant(g.id, "overview"),
  }));

  const pend = pendingDecisions(g);
  if (pend.rows) issues.push({
    kind: "review", rank: 7, n: pend.rows,
    text: `${pend.rows} statement line${pend.rows === 1 ? "" : "s"} awaiting a review decision`,
    why: "Statement lines are half-decided — tagged without an eligible amount, or not reviewed at all.",
    actionLabel: "Continue reviewing",
    go: () => openGrant(g.id, "actuals", {
      actualsView: "tag",
      tagFilterOverride: { needsOnly: true, warningsOnly: false },
      tagFilterOverrideNote: "Opened from the portfolio — showing lines that still need a decision.",
    }),
  });
  const warnLines = allStatementRows(g).filter(({ row }) => rowHardWarnings(row).length).length;
  if (warnLines) issues.push({
    kind: "review", rank: 7, n: warnLines,
    text: `${warnLines} statement line${warnLines === 1 ? " has" : "s have"} an amount warning`,
    why: "An eligible amount disagrees with its imported source amount.",
    actionLabel: "Review warnings",
    go: () => openGrant(g.id, "actuals", {
      actualsView: "tag",
      tagFilterOverride: { warningsOnly: true, needsOnly: false },
      tagFilterOverrideNote: "Opened from the portfolio — showing lines with amount warnings.",
    }),
  });
  if (pend.awaiting > 0) issues.push({
    kind: "review", rank: 7, n: pend.awaitingCats,
    text: `${money(pend.awaiting)} tagged eligible, not yet attributed to milestones`,
    why: "Money tagged eligible hasn't been placed on a milestone, so the expenditure sheet doesn't recognise it yet.",
    actionLabel: "Continue attribution",
    go: () => openGrant(g.id, "actuals", { actualsView: "attribute" }),
  });

  issues.sort((a, b) => a.rank - b.rank);
  return issues;
}

export function portRow(g) {
  const issues = grantIssues(g);
  const life = lifecycle(g);
  const top = issues[0] || null;
  const status = top ? PORT_STATUS[top.rank]
    : life === "completed" ? { label: "Completed", sev: "done" }
    : life === "not_started" ? { label: "Not started", sev: "" }
    : { label: "No open issues", sev: "" };
  return { g, issues, life, top, status, rep: nextReport(g) };
}

/* Filters live for the session. */
export const PORT = { q: "", kinds: new Set(), life: "all", sort: "attention", dir: 1 };
const PORT_FILTER_KEY = "grantflowPortFilters";
(function restorePortFilters() {
  try {
    const s = JSON.parse(sessionStorage.getItem(PORT_FILTER_KEY) || "null");
    if (!s) return;
    PORT.q = s.q || ""; PORT.kinds = new Set(s.kinds || []); PORT.life = s.life || "all";
    PORT.sort = s.sort || "attention"; PORT.dir = s.dir === -1 ? -1 : 1;
  } catch (e) { /* corrupt saved filters — defaults */ }
})();
export function savePortFilters() {
  sessionStorage.setItem(PORT_FILTER_KEY, JSON.stringify(
    { q: PORT.q, kinds: [...PORT.kinds], life: PORT.life, sort: PORT.sort, dir: PORT.dir }));
}

export const PORT_CHIPS = [
  { key: "overdue", label: "Overdue reports", sev: "breach" },
  { key: "duesoon", label: "Due within 30 days", sev: "" },
  { key: "limits", label: "Spending limits exceeded", sev: "breach" },
  { key: "duplicate", label: "Duplicate attribution", sev: "breach" },
  { key: "evidence", label: "Evidence needed", sev: "warn" },
  { key: "conflicts", label: "Document conflicts", sev: "warn" },
  { key: "review", label: "Awaiting your decision", sev: "warn" },
  { key: "unresolved", label: "Historic unresolved reports", sev: "" },
];
export function chipCount(rows, kind) {
  return rows.reduce((s, r) =>
    s + r.issues.filter((i) => i.kind === kind).reduce((x, i) => x + (i.n || 1), 0), 0);
}

export function cmpNextDue(a, b) {
  const da = a.rep && ISO.test(a.rep.dueDate || "") ? a.rep.dueDate : "9999-12-31";
  const db = b.rep && ISO.test(b.rep.dueDate || "") ? b.rep.dueDate : "9999-12-31";
  return da.localeCompare(db);
}
export const PORT_SORTS = {
  attention: (a, b) => ((a.top ? a.top.rank : 99) - (b.top ? b.top.rank : 99))
    || ((a.life === "completed") - (b.life === "completed")) || cmpNextDue(a, b),
  deadline: cmpNextDue,
  client: (a, b) => (a.g.client.displayName || a.g.client.name || "").localeCompare(
      b.g.client.displayName || b.g.client.name || "") || a.g.displayName.localeCompare(b.g.displayName),
  funds: (a, b) => (b.g.grant.maximumFunds || 0) - (a.g.grant.maximumFunds || 0),
};
