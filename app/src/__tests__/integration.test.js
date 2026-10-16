// @vitest-environment node
/* Full extraction and persistence workflow. It is opt-in when the backend and
   locally supplied synthetic fixtures are both available. */

import { File } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { crossValidate, extractDocument, loadStoredGrants } from "../api.js";
import { draftNameFrom } from "../lib/format.js";
import { DATA, session, state } from "../store.js";
import { createGrantFromDraft, startReview } from "../views/ReviewScreen.jsx";

globalThis.File = File;

const API = "http://localhost:8000";
const ROOT = resolve(import.meta.dirname, "../../..");
const BFF_FIXTURE = resolve(ROOT, "project/grants/input/Example BFF Grant Agreement.docx");
const STATEMENT_FIXTURE = resolve(
  ROOT,
  "project/grants/input/Example Cashflow Statement.xlsx",
);

async function backendUp() {
  try {
    const res = await fetch(API + "/", { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

const up = await backendUp();
const fixturesAvailable = existsSync(BFF_FIXTURE) && existsSync(STATEMENT_FIXTURE);
const suite = up && fixturesAvailable ? describe : describe.skip;

suite("end-to-end against the live backend", () => {
  let createdDbId = null;

  afterAll(async () => {
    if (createdDbId) await fetch(`${API}/grants/${createdDbId}`, { method: "DELETE" }).catch(() => {});
  });

  it("BFF agreement → extract → cross-validate → review → create → persisted", async () => {
    const bytes = readFileSync(BFF_FIXTURE);
    const file = new File([bytes], "Example BFF Grant Agreement.docx");
    const { res, data } = await extractDocument("/extract", file, "bff");
    expect(res.ok).toBe(true);
    expect(data.entities.client.name).toContain("EXAMPLE");
    expect(data.entities.milestones).toHaveLength(5);
    expect(data.entities.grant.totalProjectCost).toBe(500000);

    session.PENDING = { agreement: data, attachment: null, statement: null };
    const result = await crossValidate({ agreement: data, attachment: null });
    expect(result.merged.grant.projectReferenceNumber).toBe("GRANT-001");
    startReview(result.merged, draftNameFrom(result.merged.grant.projectTitle));
    expect(state.view).toBe("validate");
    expect(session.DRAFT.milestones).toHaveLength(5);

    session.draftGrantName = "E2E Test Grant";
    const before = DATA.grants.length;
    await createGrantFromDraft();
    expect(DATA.grants.length).toBe(before + 1);
    const g = DATA.grants[DATA.grants.length - 1];
    createdDbId = g._dbId;
    expect(g._dbId).toBeTruthy();
    expect(state.view).toBe("grant");
    expect(g.milestones[0].title).toBe("Pilot equipment commissioned");
    // Agreement-only BFF data has project outcomes but no milestone evidence.
    expect(Array.isArray(g.evidenceRequirements)).toBe(true);

    const xls = readFileSync(STATEMENT_FIXTURE);
    const stmt = await extractDocument("/extract/statement", new File([xls], "cf.xlsx"));
    expect(stmt.res.ok).toBe(true);
    expect(stmt.data.rows.length).toBeGreaterThan(100);

    const listed = await (await fetch(API + "/grants")).json();
    expect(listed.some((x) => x._dbId === g._dbId && x.displayName === "E2E Test Grant")).toBe(true);

    const count = DATA.grants.length;
    await loadStoredGrants();
    expect(DATA.grants.filter((x) => x._dbId === g._dbId)).toHaveLength(1);
    expect(DATA.grants.length).toBeGreaterThanOrEqual(count);

    const sp = await (await fetch(API + "/sharepoint/status")).json();
    expect(sp).toHaveProperty("connected");
  }, 30000);
});
