/* Compliance arithmetic and decision-state regression tests. */

import { describe, expect, it } from "vitest";
import { money } from "@gf-ui";
import {
  daysInMonth, dueText, parseAmt, parseFlexibleDate, periodBounds, periodLabel,
  shortCatName, titleCase, draftNameFrom,
} from "../lib/format.js";
import {
  attributedForPeriod, candidatesForPeriod, categoryActual, categoryFunnel,
  cellActual, eligibleByCategoryPeriod, rowHardWarnings, rowNeedsDecision,
  rowStatus, statementEntryFromExtract,
} from "../lib/funnel.js";
import { docLabel, docUrl } from "../lib/derive.js";
import { grantIssues, portRow } from "../lib/issues.js";

describe("formatting", () => {
  it("money renders en-AU with $ and no decimals", () => {
    expect(money(250000)).toBe("$250,000");
    expect(money(0)).toBe("$0");
    expect(money(null)).toBeNull();
  });
  it("period arithmetic never uses UTC date rollbacks", () => {
    expect(daysInMonth(2024, 2)).toBe(29);   // leap year
    expect(daysInMonth(2100, 2)).toBe(28);   // century non-leap
    expect(periodBounds("2022-02")).toEqual(["2022-02-01", "2022-02-28"]);
    expect(periodBounds("2024-02")).toEqual(["2024-02-01", "2024-02-29"]);
  });
  it("periodLabel is en-AU short month + year", () => {
    expect(periodLabel("2022-04")).toMatch(/Apr.*2022/);
  });
  it("parseAmt strips currency formatting", () => {
    expect(parseAmt("$1,234.50")).toBe(1234.5);
    expect(parseAmt("")).toBeNull();
    expect(parseAmt("abc")).toBeNull();
  });
  it("parseFlexibleDate accepts ISO, dd/mm/yyyy and d Mon yyyy", () => {
    expect(parseFlexibleDate("2022-04-29")).toBe("2022-04-29");
    expect(parseFlexibleDate("29/04/2022")).toBe("2022-04-29");
    expect(parseFlexibleDate("29 Apr 2022")).toBe("2022-04-29");
    expect(parseFlexibleDate("31/02/2022")).toBeNull();
  });
  it("shortCatName strips the Expenditure suffix", () => {
    expect(shortCatName("Labour Expenditure")).toBe("Labour");
    expect(shortCatName("SMP/PMP Expenditure")).toBe("SMP");
  });
  it("dueText past a year says unresolved, not a day count", () => {
    expect(dueText("2019-01-01")).toContain("unresolved");
  });
  it("titleCase handles Pty Ltd", () => {
    expect(titleCase("EXAMPLE RECIPIENT PTY. LTD")).toContain("Pty");
  });
  it("draftNameFrom takes up to three long words", () => {
    expect(draftNameFrom("Commission pilot equipment for regional deployment")).toBe("Commission Pilot Equipment");
  });
  it("evidence links allow HTTPS only and keep labels as text", () => {
    expect(docUrl({ name: "Evidence", url: "javascript:alert(1)" })).toBeNull();
    expect(docUrl({
      name: "Evidence",
      url: "https://contoso.sharepoint.com/evidence/file.pdf",
    })).toBe("https://contoso.sharepoint.com/evidence/file.pdf");
    expect(docLabel({
      name: "<img src=x onerror=alert(1)>",
      url: "https://contoso.sharepoint.com/evidence/file.pdf",
    })).toBe("<img src=x onerror=alert(1)>");
  });
});

function grantFixture() {
  return {
    id: "g1",
    displayName: "Test",
    client: { name: "X", displayName: "X" },
    grant: { projectStartDate: "2022-02-14", projectEndDate: "2022-11-13", grantPercentage: 50, totalProjectCost: 100000 },
    milestones: [
      { number: 1, title: "M1", startDate: "2022-02-14", plannedAchievementDate: "2022-04-29", activities: [], measurableOutcomes: [] },
      { number: 2, title: "M2", startDate: null, plannedAchievementDate: "2022-05-13", activities: [], measurableOutcomes: [] },
    ],
    budgetCategories: [
      { name: "Labour Expenditure", total: 50000, source: "agreement" },
      { name: "Other", total: 0, source: "agreement" },
    ],
    quarters: [],
    reportingObligations: [],
    annualCaps: [],
    evidenceRequirements: [],
    validationFindings: [],
    statements: [{
      id: "s1", filename: "cf.xlsx", rows: [
        { id: "r1", period: "2022-03", account: "Wages", amount: 1000, category: "Labour Expenditure", eligible: 800, isRollup: null },
        { id: "r2", period: "2022-03", account: "Rent", amount: 500, category: null, eligible: null, isRollup: null },
        { id: "r3", period: "2022-03", account: "Eligible rollup", amount: 900, category: "Labour Expenditure", eligible: null, isRollup: true },
        { id: "r4", period: "2022-04", account: "Wages", amount: 700, category: "Ineligible", eligible: null, isRollup: null },
      ],
    }],
    attributions: { "Labour Expenditure::2022-03": { 1: 500 } },
    directEntries: {},
    allocations: {},
  };
}

describe("the funnel", () => {
  it("rowNeedsDecision: category alone is not done", () => {
    expect(rowNeedsDecision({ category: "X", eligible: null, isRollup: null })).toBe(true);
    expect(rowNeedsDecision({ category: "Ineligible", eligible: null, isRollup: null })).toBe(false);
    expect(rowNeedsDecision({ category: "X", eligible: 5, isRollup: null })).toBe(false);
    expect(rowNeedsDecision({ category: null, eligible: null, isRollup: true })).toBe(false);
  });
  it("rollup rows never enter eligible totals", () => {
    const g = grantFixture();
    const elig = eligibleByCategoryPeriod(g);
    expect(elig["Labour Expenditure::2022-03"]).toBe(800);
    expect(Object.keys(elig)).toHaveLength(1);
  });
  it("categoryFunnel separates awaiting from over per period", () => {
    const g = grantFixture();
    const f = categoryFunnel(g, "Labour Expenditure");
    expect(f.tagged).toBe(800);
    expect(f.attributed).toBe(500);
    expect(f.awaiting).toBe(300);
    expect(f.over).toBe(0);
    // Now over-attribute in a different period: it must not net off.
    g.attributions["Labour Expenditure::2022-05"] = { 1: 200 };
    const f2 = categoryFunnel(g, "Labour Expenditure");
    expect(f2.awaiting).toBe(300);
    expect(f2.over).toBe(200);
    expect(f2.overPeriods).toEqual([{ period: "2022-05", over: 200 }]);
  });
  it("cellActual is null when nothing reached the cell, never zero", () => {
    const g = grantFixture();
    expect(cellActual(g, 2, "Labour Expenditure")).toBeNull();
    expect(cellActual(g, 1, "Labour Expenditure")).toEqual({ attributed: 500, entered: 0 });
    expect(categoryActual(g, "Labour Expenditure")).toBe(500);
  });
  it("attributedForPeriod sums the milestone map", () => {
    const g = grantFixture();
    expect(attributedForPeriod(g, "Labour Expenditure", "2022-03")).toBe(500);
  });
  it("candidatesForPeriod: overlap by window, undated always offered", () => {
    const g = grantFixture();
    const { candidates, undated } = candidatesForPeriod(g, "2022-03");
    expect(candidates.map((m) => m.number)).toEqual([1]);
    expect(undated.map((m) => m.number)).toEqual([2]);
    const late = candidatesForPeriod(g, "2022-08");
    expect(late.candidates).toHaveLength(0);
    expect(late.undated.map((m) => m.number)).toEqual([2]);
  });
  it("rowStatus preserves the three decision states", () => {
    expect(rowStatus({ isRollup: true }).key).toBe("rollup");
    expect(rowStatus({ category: null, eligible: null, isRollup: null }).key).toBe("unreviewed");
    expect(rowStatus({ category: "Ineligible", eligible: null, isRollup: null }).key).toBe("excluded");
    expect(rowStatus({ category: "X", eligible: null, isRollup: null }).key).toBe("needs_amount");
    expect(rowStatus({ category: "X", amount: 100, eligible: 100, isRollup: null }).key).toBe("full");
    const partial = rowStatus({ category: "X", amount: 100, eligible: 40, isRollup: null });
    expect(partial.key).toBe("partial");
    expect(partial.needsNote).toBe(true);
    expect(rowStatus({ category: "X", amount: 100, eligible: 140, isRollup: null }).key).toBe("warning");
  });
  it("rowHardWarnings flags negative, over-source and category-less amounts", () => {
    expect(rowHardWarnings({ amount: 100, eligible: -5, category: "X", isRollup: null }).map((w) => w.key)).toContain("negative");
    expect(rowHardWarnings({ amount: 100, eligible: 200, category: "X", isRollup: null }).map((w) => w.key)).toContain("over");
    expect(rowHardWarnings({ amount: 100, eligible: 50, category: null, isRollup: null }).map((w) => w.key)).toContain("nocat");
  });
  it("statementEntryFromExtract keeps rows verbatim with neutral defaults", () => {
    const entry = statementEntryFromExtract({
      sheet: "S", periods: ["2022-10", "2023-01"], period_start: "2022-10", period_end: "2023-01",
      rows: [{ id: "a", period: "2022-10", account: "X", amount: 5, section: null, suspectedRollup: true }],
    }, "f.xlsx", "2022-11-13");
    expect(entry.outOfWindowAfter).toEqual(["2023-01"]);
    expect(entry.rows[0].isRollup).toBe(false);
    expect(entry.rows[0].category).toBeNull();
  });
});

describe("the attention model", () => {
  it("a clean active grant has no issues", () => {
    const g = grantFixture();
    g.statements = []; g.attributions = {};
    const r = portRow(g);
    expect(r.issues).toHaveLength(0);
    expect(r.status.label).toMatch(/No open issues|Completed|Not started/);
  });
  it("pending statement decisions rank 7", () => {
    const g = grantFixture();
    const issues = grantIssues(g);
    const review = issues.filter((i) => i.kind === "review");
    expect(review.length).toBeGreaterThan(0);
    expect(Math.min(...issues.map((i) => i.rank))).toBeLessThanOrEqual(7);
  });
  it("issues sort by rank ascending", () => {
    const g = grantFixture();
    const issues = grantIssues(g);
    const ranks = issues.map((i) => i.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
