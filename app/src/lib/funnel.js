/* Canonical arithmetic for statement review, attribution, and allocation. */

import { money } from "@gf-ui";
import { periodBounds } from "./format.js";

/* ---------------- allocation grid (plan side) ---------------- */
export function marginForce(source) { return source === "agreement" ? "contractual" : "advisory"; }
export function allocKey(mNumber, catName) { return mNumber + "::" + catName; }
export function cellPlanned(g, mNumber, catName) {
  const a = g.allocations && g.allocations[allocKey(mNumber, catName)];
  return a && a.planned != null ? a.planned : null;
}
export function setCellPlanned(g, mNumber, catName, value) {
  if (!g.allocations) g.allocations = {};
  const key = allocKey(mNumber, catName);
  if (value == null) { delete g.allocations[key]; return; }
  const prev = g.allocations[key];
  g.allocations[key] = { planned: value, actual: prev ? (prev.actual ?? null) : null };
}
/* override lets the live (per-keystroke) preview compute what a total
   *would* be without touching committed state. */
export function plannedOr(g, mNumber, catName, override) {
  if (override && override.mNumber === mNumber && override.catName === catName) return override.value;
  return cellPlanned(g, mNumber, catName);
}
export function rowAllocated(g, m, override) {
  return (g.budgetCategories || []).reduce((s, c) => s + (plannedOr(g, m.number, c.name, override) || 0), 0);
}
export function colAllocated(g, c, override) {
  return (g.milestones || []).reduce((s, m) => s + (plannedOr(g, m.number, c.name, override) || 0), 0);
}
export function grandAllocated(g, override) {
  return (g.budgetCategories || []).reduce((s, c) => s + colAllocated(g, c, override), 0);
}

/* ---------------- statements ---------------- */
export function allStatementRows(g) {
  const out = [];
  (g.statements || []).forEach((stmt) => stmt.rows.forEach((row) => out.push({ stmt, row })));
  return out;
}

/* A row is "done" only once both halves of step ① are decided. */
export function rowNeedsDecision(r) {
  if (r.isRollup) return false;
  if (!r.category) return true;
  return r.category !== "Ineligible" && r.eligible == null;
}

/* Feeds step ②. Rollup rows never enter a total. */
export function eligibleByCategoryPeriod(g) {
  const out = {};
  allStatementRows(g).forEach(({ row: r }) => {
    if (r.isRollup) return;
    if (!r.category || r.category === "Ineligible" || r.eligible == null) return;
    const key = r.category + "::" + r.period;
    out[key] = (out[key] || 0) + r.eligible;
  });
  return out;
}

/* What the preparer's own rollup rows claim for this category-period. */
export function rollupReference(g, category, period) {
  let sum = null;
  allStatementRows(g).forEach(({ row: r }) => {
    if (r.isRollup && r.category === category && r.period === period) sum = (sum || 0) + r.amount;
  });
  return sum;
}

export function attributedForPeriod(g, category, period) {
  const byMs = (g.attributions || {})[category + "::" + period] || {};
  return Object.values(byMs).reduce((s, v) => s + (v || 0), 0);
}

/* A milestone is a candidate for a period when its window overlaps it at
   all; undated milestones are offered every period, in their own group. */
export function candidatesForPeriod(g, period) {
  const [periodStart, periodEnd] = periodBounds(period);
  const candidates = [], undated = [];
  (g.milestones || []).forEach((ms) => {
    if (!ms.startDate) { undated.push(ms); return; }
    if (ms.startDate <= periodEnd && (ms.plannedAchievementDate || "9999-12-31") >= periodStart) candidates.push(ms);
  });
  return { candidates, undated };
}

/* null means nothing has ever reached this cell — never zero. */
export function cellActual(g, milestoneNumber, categoryName) {
  let attributed = 0, any = false;
  Object.entries(g.attributions || {}).forEach(([key, byMs]) => {
    const [cat] = key.split("::");
    if (cat !== categoryName || byMs[milestoneNumber] == null) return;
    attributed += byMs[milestoneNumber]; any = true;
  });
  const entered = (g.directEntries || {})[milestoneNumber + "::" + categoryName];
  if (entered != null) any = true;
  return any ? { attributed, entered: entered || 0 } : null;
}

/* The trace behind a cell's figure: which periods contributed what. */
export function cellActualTrace(g, milestoneNumber, categoryName) {
  const parts = [];
  Object.entries(g.attributions || {}).forEach(([key, byMs]) => {
    const [cat, period] = key.split("::");
    if (cat !== categoryName || byMs[milestoneNumber] == null) return;
    parts.push({ period, amount: byMs[milestoneNumber] });
  });
  parts.sort((a, b) => a.period.localeCompare(b.period));
  return parts;
}

/* Category-level reconciliation: tagged, attributed, awaiting, over.
   awaiting and over are summed per period, separately. */
export function categoryFunnel(g, categoryName) {
  const eligible = eligibleByCategoryPeriod(g);
  let tagged = 0, attributed = 0, awaiting = 0, over = 0;
  const overPeriods = [];
  const periods = new Set();
  Object.keys(eligible).forEach((key) => {
    const [cat, period] = key.split("::");
    if (cat === categoryName) periods.add(period);
  });
  Object.keys(g.attributions || {}).forEach((key) => {
    const [cat, period] = key.split("::");
    if (cat === categoryName) periods.add(period);
  });
  periods.forEach((period) => {
    const e = eligible[categoryName + "::" + period] || 0;
    const a = attributedForPeriod(g, categoryName, period);
    tagged += e; attributed += a;
    if (a > e) { over += a - e; overPeriods.push({ period, over: a - e }); }
    else awaiting += e - a;
  });
  overPeriods.sort((a, b) => a.period.localeCompare(b.period));
  return { tagged, attributed, awaiting, over, overPeriods };
}

/* A category's recognised actual: attributed + entered directly. */
export function categoryActual(g, categoryName) {
  return (g.milestones || []).reduce((s, m) => {
    const a = cellActual(g, m.number, categoryName);
    return s + (a ? a.attributed + a.entered : 0);
  }, 0);
}

export function pendingDecisions(g) {
  const rows = allStatementRows(g).filter(({ row }) => rowNeedsDecision(row)).length;
  let awaiting = 0, awaitingCats = 0;
  (g.budgetCategories || []).forEach((c) => {
    const f = categoryFunnel(g, c.name);
    if (f.awaiting > 0) { awaiting += f.awaiting; awaitingCats += 1; }
  });
  return { rows, awaiting, awaitingCats };
}

/* ---------------- tagging row semantics ---------------- */
export function rowSourceMag(r) { return Math.abs(r.amount); }

/* Hard warnings: the decision as recorded disagrees with the source line. */
export function rowHardWarnings(r) {
  if (r.isRollup) return [];
  const w = [];
  if (r.eligible != null && r.eligible < 0)
    w.push({ key: "negative", text: "The eligible amount is negative." });
  if (r.eligible != null && r.eligible > rowSourceMag(r) + 0.005)
    w.push({
      key: "over", over: r.eligible - rowSourceMag(r),
      text: `Eligible amount is ${money(r.eligible - rowSourceMag(r))} greater than the imported source amount.`,
    });
  if (r.eligible != null && !r.category)
    w.push({ key: "nocat", text: "An eligible amount is recorded without a grant category." });
  return w;
}

export function rowStatus(r) {
  if (r.isRollup) return { key: "rollup", label: "Reference — preparer's rollup", sev: "ref" };
  const warns = rowHardWarnings(r);
  if (warns.length) {
    const over = warns.find((w) => w.key === "over");
    return {
      key: "warning", sev: "breach",
      label: over ? `Exceeds source by ${money(over.over)}` : warns[0].key === "negative" ? "Negative amount" : "Amount without category",
    };
  }
  if (!r.category) return { key: "unreviewed", label: "Not reviewed", sev: "" };
  if (r.category === "Ineligible") return { key: "excluded", label: "Excluded from grant", sev: "excl" };
  if (r.eligible == null) return { key: "needs_amount", label: "Needs amount", sev: "warn" };
  if (Math.abs(r.eligible - rowSourceMag(r)) < 0.005)
    return { key: "full", label: "Eligible — full amount", sev: "done" };
  return { key: "partial", label: "Eligible — partial", sev: "done", needsNote: !r.note };
}

/* Preparer rollups vs her eligible totals, only over comparable scopes. */
export function preparerComparison(g) {
  const eligible = eligibleByCategoryPeriod(g);
  let ref = 0, mine = 0, pairs = 0;
  const seen = new Set();
  allStatementRows(g).forEach(({ row: r }) => {
    if (!r.isRollup || !r.category || r.category === "Ineligible") return;
    const key = r.category + "::" + r.period;
    ref += r.amount;
    if (!seen.has(key)) { seen.add(key); mine += eligible[key] || 0; pairs += 1; }
  });
  return pairs ? { ref, mine, pairs } : null;
}

export function actualsSnapshot(g) {
  const rows = allStatementRows(g).map((x) => x.row);
  const undecided = rows.filter(rowNeedsDecision).length;
  const eligible = eligibleByCategoryPeriod(g);
  const tagged = Object.values(eligible).reduce((s, v) => s + v, 0);
  let attributed = 0;
  Object.values(g.attributions || {}).forEach((byMs) =>
    Object.values(byMs).forEach((v) => { attributed += v || 0; }));
  let awaiting = 0, over = 0;
  (g.budgetCategories || []).forEach((c) => {
    const f = categoryFunnel(g, c.name);
    awaiting += f.awaiting; over += f.over;
  });
  const recognised = (g.budgetCategories || []).reduce((s, c) => s + categoryActual(g, c.name), 0);
  return { rowCount: rows.length, statements: (g.statements || []).length, undecided, tagged, attributed, awaiting, over, recognised };
}

/* Build a grant statement entry from a raw /extract/statement result. */
export function statementEntryFromExtract(result, filename, projectEnd) {
  const afterWindow = (result.periods || []).filter((p) => projectEnd && p + "-01" > projectEnd);
  const rows = (result.rows || []).map((r) => ({
    id: r.id, period: r.period, account: r.account, amount: r.amount, section: r.section,
    category: null, eligible: null,
    isRollup: r.suspectedRollup ? false : null,
  }));
  return {
    id: "stmt_" + Date.now(), filename: filename || result.sheet || "statement",
    sheet: result.sheet, periodStart: result.period_start, periodEnd: result.period_end,
    outOfWindowAfter: afterWindow, outOfWindowAnswer: null, rows,
  };
}
