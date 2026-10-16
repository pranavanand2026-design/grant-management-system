/* Boot smoke test: the app mounts in jsdom with a mocked backend, renders
   the portfolio, opens a grant, and walks the tabs without crashing. */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { DATA, openGrant, session, state } from "../store.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const grantBundle = {
  _dbId: 1, _rev: 1, id: "grant_db_1",
  displayName: "Example Grant",
  client: { name: "EXAMPLE RECIPIENT PTY LTD", displayName: "Example Recipient", abn: "00000000000" },
  documents: { agreement: true },
  grant: {
    grantType: "bff", projectTitle: "Example commercialisation project", projectReferenceNumber: "GRANT-001",
    projectStartDate: "2026-01-01", projectEndDate: "2027-06-30",
    maximumFunds: 250000, grantPercentage: 50, totalProjectCost: 500000,
  },
  completeness: {},
  milestones: [
    { number: 1, title: "Pilot equipment commissioned", startDate: "2026-01-01", plannedAchievementDate: "2026-06-30", estimatedCost: 150000, activities: [{ sequence: 1, description: "Commission pilot equipment", source: "agreement" }], measurableOutcomes: [{ sequence: 1, description: "Commissioning accepted" }] },
    { number: 2, title: "Pilot operations completed", startDate: "2026-07-01", plannedAchievementDate: "2026-12-31", estimatedCost: 100000, activities: [], measurableOutcomes: [] },
  ],
  budgetCategories: [{ name: "Labour Expenditure", year1: null, year2: null, total: 200000, source: "agreement" }],
  allocations: {}, statements: [], attributions: {}, directEntries: {},
  quarters: [],
  reportingObligations: [{ reportType: "Progress report", dueDate: "2026-07-31", periodStartDate: "2026-01-01", periodEndDate: "2026-06-30" }],
  annualCaps: [{ financialYear: "2025/26", cappedAmount: 125000 }],
  evidenceRequirements: [{ id: "ev1", milestoneNumber: 1, outcome: "Commissioning accepted", required: true, satisfied: false, documents: [] }],
  validationFindings: [],
};

function mockFetch(url) {
  const u = String(url);
  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (u.includes("/sharepoint/status")) return json({ connected: false, reason: "not_configured" });
  if (u.includes("/sharepoint/")) return json({ folder: { name: "Grant Evidence" }, items: [] });
  if (u.endsWith("/grants")) return json([grantBundle]);
  if (u.includes("/grant-types")) return json({ ac: { label: "AC", implemented: true } });
  return json({});
}

describe("app boot", () => {
  let container, root;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(mockFetch));
    vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    DATA.grants.length = 0;
    Object.assign(state, { view: "home", grantId: null, tab: "overview", msDetail: null, actualsView: "list", pendingStatement: null });
    session.STORE_STATE = "loading";
    session.DRAFT = null; session.PENDING = null; session.modalOpen = false;
    session.NAV_BACK.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root && root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });
    await act(async () => { await Promise.resolve(); });
  }

  it("renders the portfolio with a loaded grant", async () => {
    await mount();
    expect(container.textContent).toContain("Grant portfolio");
    expect(container.textContent).toContain("Example Grant");
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("All grants");
  });

  it("opens a grant and walks every tab without crashing", async () => {
    await mount();
    for (const tab of ["overview", "milestones", "expenditure", "actuals", "evidence"]) {
      await act(async () => { openGrant("grant_db_1", tab); });
      expect(container.querySelector("#view-grant")).toBeTruthy();
    }
    expect(container.textContent).toContain("Example Grant");
    // Expenditure island rendered the allocation grid.
    await act(async () => { openGrant("grant_db_1", "expenditure"); });
    expect(container.querySelector(".alloc-grid")).toBeTruthy();
    expect(container.textContent).toContain("Available to plan");
    const tag = [...container.querySelectorAll(".ac-tag-link")][0];
    await act(async () => { tag.click(); });
    expect(state.actualsView).toBe("tag");
    expect(state.tagFilterOverride).toMatchObject({ periodFrom: "2026-01", periodTo: "2026-06" });
    // Overview timeline island rendered rows.
    await act(async () => { openGrant("grant_db_1", "overview"); });
    expect(container.querySelector(".tl-wrap")).toBeTruthy();
    const deadline = container.querySelector(".deadline-card");
    await act(async () => { deadline.click(); });
    expect(state.view).toBe("calendar");
    expect(state.calView).toBe("month");
    expect(session.calSelected).toBe("2026-07-31");
    await act(async () => { container.querySelector("#view-calendar .crumb").click(); });
    expect(state.view).toBe("grant");
    expect(state.grantId).toBe("grant_db_1");
    expect(state.tab).toBe("overview");
  });

  it("milestone detail shows activities and outcomes", async () => {
    await mount();
    await act(async () => { openGrant("grant_db_1", "milestones", { msDetail: 1 }); });
    expect(container.textContent).toContain("Pilot equipment commissioned");
    expect(container.textContent).toContain("Commission pilot equipment");
    expect(container.textContent).toContain("Measurable outcomes");
    expect(container.textContent).toContain("Commissioning accepted");
  });

  it("calendar renders obligations in list and month views", async () => {
    await mount();
    const { show } = await import("../store.js");
    await act(async () => { show("calendar"); });
    expect(container.textContent).toContain("Progress report");
    await act(async () => { state.calView = "month"; show("calendar"); });
    expect(container.querySelector(".cal-grid")).toBeTruthy();
  });

  it("review screen mounts from a draft and creates a grant", async () => {
    await mount();
    const { startReview } = await import("../views/ReviewScreen.jsx");
    const merged = JSON.parse(JSON.stringify(grantBundle));
    merged.validationFindings = [
      { id: "f1", check: "x", severity: "warning", scope: "milestone", milestoneNumber: 1, title: "Dates differ", explanation: "", comparisons: [], options: [{ value: "agreement", label: "Use agreement" }] },
      { id: "f2", check: "y", severity: "pass", scope: "section", sectionKey: "milestones", title: "Counts match" },
    ];
    await act(async () => { startReview(merged, "Draft Name"); });
    expect(container.querySelector("#view-validate")).toBeTruthy();
    expect(container.textContent).toContain("Milestones");
    expect(container.textContent).toContain("Dates differ");
    expect(container.textContent).toContain("1 consistency check passed");
    const before = DATA.grants.length;
    const { createGrantFromDraft } = await import("../views/ReviewScreen.jsx");
    await act(async () => { await createGrantFromDraft(); });
    expect(DATA.grants.length).toBe(before + 1);
    expect(state.view).toBe("grant");
  });
});
