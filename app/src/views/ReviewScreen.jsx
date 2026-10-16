import { useEffect, useLayoutEffect, useRef } from "react";
import { FindingCard, money, Value, valueTooltip } from "@gf-ui";
import { createGrant, saveGrantIfPersisted } from "../api.js";
import {
  buildGrantBundle,
  mergeReviewedGrant,
} from "../domain/grants.js";
import {
  detectFieldType, fmtDate, parseFlexibleDate,
} from "../lib/format.js";
import { bump, DATA, openGrant, session, show, state } from "../store.js";
import { openModal } from "../components/NewGrantModal.jsx";

export const REVIEW_DRAFT_KEY = "grantflowReviewDraft";

/* ---------------- draft lifecycle ---------------- */

function manualKey(...parts) { return parts.join("."); }
function isManual(key) { return !!(session.DRAFT && session.DRAFT._manual && session.DRAFT._manual[key]); }
function markManual(key) { if (session.DRAFT) session.DRAFT._manual[key] = true; }
function clearManual(key) { if (session.DRAFT && session.DRAFT._manual) delete session.DRAFT._manual[key]; }

export function saveReviewDraft() {
  if (!session.DRAFT) return;
  try {
    sessionStorage.setItem(REVIEW_DRAFT_KEY, JSON.stringify({
      draft: session.DRAFT, grantName: session.draftGrantName,
      hasAttachment: !!(session.PENDING && session.PENDING.attachment),
      statement: (session.PENDING && session.PENDING.statement) || null,
      statementFilename: (session.PENDING && session.PENDING.statementFilename) || null,
      editingDbId: session.EDITING_GRANT?._dbId || null,
    }));
  } catch (e) { /* storage unavailable */ }
}
export function clearReviewDraft() { try { sessionStorage.removeItem(REVIEW_DRAFT_KEY); } catch (e) { /* ignore */ } }

export function startReview(merged, initialName, editingGrant = null) {
  session.DRAFT = merged;
  session.EDITING_GRANT = editingGrant;
  session.DRAFT._manual = session.DRAFT._manual || {};
  session.DRAFT._collapsed = session.DRAFT._collapsed || {};
  session.draftGrantName = initialName;
  session.UNDO.length = 0;
  session.reviewMounted = false;
  saveReviewDraft();
  state.view = "validate";
  bump();
}

export function startEditReview(g) {
  // The review form works on a copy, so Back/Cancel never mutates the live
  // grant. Saving replaces only the reviewed agreement fields.
  startReview(JSON.parse(JSON.stringify(g)), g.displayName, g);
}

/* Silent restore: an in-progress review survives a stray reload. */
export function restoreReviewDraft() {
  try {
    const raw = sessionStorage.getItem(REVIEW_DRAFT_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || !saved.draft || !saved.draft.grant) return false;
    session.DRAFT = saved.draft;
    session.DRAFT._manual = session.DRAFT._manual || {};
    session.DRAFT._collapsed = session.DRAFT._collapsed || {};
    session.EDITING_GRANT = saved.editingDbId ? session.DRAFT : null;
    session.draftGrantName = saved.grantName || "";
    session.PENDING = {
      attachment: saved.hasAttachment ? {} : null,
      statement: saved.statement || null,
      statementFilename: saved.statementFilename || null,
      result: { merged: session.DRAFT, findings: session.DRAFT.validationFindings || [] },
    };
    session.reviewMounted = false;
    state.view = "validate";
    return true;
  } catch (e) { return false; /* corrupt draft */ }
}

export async function createGrantFromDraft() {
  if (!session.draftGrantName.trim()) {
    const input = document.querySelector("#rv-grant-name");
    if (input) input.focus();
    return;
  }
  const { bundle, clean } = buildGrantBundle({
    draft: session.DRAFT,
    displayName: session.draftGrantName,
    hasAttachment: !!session.PENDING?.attachment,
    statement: session.EDITING_GRANT ? null : session.PENDING?.statement,
    statementFilename: session.PENDING?.statementFilename,
  });
  if (session.EDITING_GRANT) {
    if (!confirm(`Save changes to “${session.draftGrantName.trim()}”?`)) return;
    const existing = DATA.grants.find((g) => g._dbId === session.EDITING_GRANT._dbId) || session.EDITING_GRANT;
    const updated = mergeReviewedGrant(existing, clean, bundle);
    Object.assign(existing, updated);
    const result = await saveGrantIfPersisted(existing);
    if (result === "offline") {
      alert("Backend unreachable — changes are kept in this browser session but were not saved.");
    } else if (result === "conflict") {
      alert("This grant changed in another tab. Reload before editing it again.");
      return;
    }
    clearReviewDraft(); session.DRAFT = null; session.PENDING = null; session.EDITING_GRANT = null;
    openGrant(existing.id);
    return;
  }
  try {
    const created = await createGrant(bundle);
    if (created) {
      bundle._dbId = created._dbId;
      bundle._rev = created._rev;
    }
  } catch { /* grant remains available in memory */ }
  DATA.grants.push(bundle);
  clearReviewDraft();
  session.DRAFT = null; session.PENDING = null; session.EDITING_GRANT = null;
  openGrant(bundle.id);
}

/* ---------------- editable value ---------------- */
/* Type-aware contentEditable field with explicit commit and revert behavior. */
function EditableValue({ mkey, get, set, fallbackSource, missing, format }) {
  const ref = useRef(null);
  const initialType = format || detectFieldType(get());
  const isProse = initialType === "prose";

  function display(v) {
    if (v == null) return "";
    if (initialType === "money") return money(v);
    if (initialType === "percent") return `${v}%`;
    if (initialType === "date") return fmtDate(v);
    return String(v);
  }
  function refresh(node) {
    const v = get();
    const manual = isManual(mkey);
    const source = v == null ? null : (manual ? "manual" : fallbackSource);
    node.classList.toggle("v-missing", v == null);
    node.classList.toggle("v-advisory", v != null && (source === "manual" || source === "attachment" || source === "application_attachment" || source === "budget_calculator"));
    node.classList.toggle("v-num", initialType === "money" || initialType === "percent");
    if (v == null) {
      const m = missing || {};
      node.dataset.tip = m.reason || "No source document provides this value.";
      node.dataset.tipsrc = m.fix || "Click to enter it manually.";
      node.textContent = "—";
    } else {
      const t = valueTooltip({ value: v, source });
      if (t) { node.dataset.tip = t.tip; node.dataset.tipsrc = t.src; }
      else { delete node.dataset.tip; delete node.dataset.tipsrc; }
      node.textContent = display(v);
    }
  }

  useLayoutEffect(() => {
    const node = ref.current;
    if (document.activeElement !== node) refresh(node);
  });

  const props = {
    ref,
    className: "fv" + (isProse ? " fv-prose" : ""),
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    tabIndex: 0,
    onFocus: () => {
      const node = ref.current;
      const v = get();
      node.textContent = v == null ? "" : String(v);
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    onKeyDown: (e) => {
      if (e.key === "Escape") { e.preventDefault(); refresh(ref.current); ref.current.blur(); }
      else if (e.key === "Enter" && !isProse) { e.preventDefault(); ref.current.blur(); }
    },
    onBlur: () => {
      const node = ref.current;
      const rawText = node.textContent.trim();
      const before = get();
      const wasManual = isManual(mkey);
      let next;
      if (rawText === "") next = null;
      else if (initialType === "money" || initialType === "percent") {
        const n = parseFloat(rawText.replace(/[^0-9.-]/g, ""));
        next = isNaN(n) ? rawText : n;
      } else if (initialType === "date" || (before == null && /^\d{4}-\d{2}-\d{2}$/.test(rawText))) {
        next = parseFlexibleDate(rawText) || rawText;
      } else next = rawText;

      if (next === before) { refresh(node); return; }
      set(next);
      markManual(mkey);
      session.UNDO.push({ undo: () => { set(before); if (!wasManual) clearManual(mkey); } });
      saveReviewDraft();
      bump();
    },
  };
  return isProse ? <div {...props} /> : <span {...props} />;
}

function FieldRow({ label, children }) {
  return <div className="frow"><span className="flabel">{label}</span>{children}</div>;
}

/* ---------------- findings plumbing ---------------- */
function findingsFor(scope, matcher) {
  return (session.DRAFT.validationFindings || []).filter(
    (f) => f.scope === scope && matcher(f) && f.severity !== "pass" && !f.dismissed);
}
function passedReviewFindings() {
  return (session.DRAFT.validationFindings || []).filter((f) => f.severity === "pass");
}
const onFindingChange = () => { saveReviewDraft(); bump(); };

function Section({ id, title, hasData, children }) {
  if (!hasData) return null;
  const secFindings = findingsFor("section", (f) => f.sectionKey === id);
  return (
    <section className="rv-section" data-section={id}>
      <h2 className="rv-h">{title}</h2>
      <div className="rv-findings">
        {secFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}
      </div>
      <div className="rv-body">{children}</div>
    </section>
  );
}

/* ---------------- sections ---------------- */
function SectionRecipient() {
  const DRAFT = session.DRAFT;
  return (
    <Section id="recipient" title="Recipient and agreement"
      hasData={!!(DRAFT.client && (DRAFT.client.name || DRAFT.client.abn))}>
      <FieldRow label="Recipient name">
        <EditableValue mkey={manualKey("client", "name")} get={() => DRAFT.client.name} set={(v) => { DRAFT.client.name = v; }}
          fallbackSource="agreement" missing={{ reason: "No recipient name found in Schedule 1." }} />
      </FieldRow>
      <FieldRow label="ABN">
        <EditableValue mkey={manualKey("client", "abn")} get={() => DRAFT.client.abn} set={(v) => { DRAFT.client.abn = v; }}
          fallbackSource="agreement" missing={{ reason: "No ABN found in Schedule 1." }} />
      </FieldRow>
      <FieldRow label="Agreement commencement">
        <EditableValue mkey={manualKey("grant", "agreementCommencementDate")} get={() => DRAFT.grant.agreementCommencementDate}
          set={(v) => { DRAFT.grant.agreementCommencementDate = v; }}
          fallbackSource="agreement" missing={{ reason: "Not specified in Schedule 1." }} />
      </FieldRow>
      <FieldRow label="Agreement end">
        <EditableValue mkey={manualKey("grant", "agreementEndDate")} get={() => DRAFT.grant.agreementEndDate}
          set={(v) => { DRAFT.grant.agreementEndDate = v; }}
          fallbackSource="agreement" missing={{ reason: "Not specified in Schedule 1." }} />
      </FieldRow>
    </Section>
  );
}

function SectionProject() {
  const DRAFT = session.DRAFT;
  return (
    <Section id="project" title="Project" hasData={!!DRAFT.grant}>
      <FieldRow label="Project title">
        <EditableValue mkey={manualKey("grant", "projectTitle")} get={() => DRAFT.grant.projectTitle} set={(v) => { DRAFT.grant.projectTitle = v; }}
          fallbackSource="agreement" missing={{ reason: "No project title found." }} />
      </FieldRow>
      <FieldRow label="Reference number">
        <EditableValue mkey={manualKey("grant", "projectReferenceNumber")} get={() => DRAFT.grant.projectReferenceNumber}
          set={(v) => { DRAFT.grant.projectReferenceNumber = v; }}
          fallbackSource="agreement" missing={{ reason: "No project reference number found." }} />
      </FieldRow>
      <FieldRow label="Project start">
        <EditableValue mkey={manualKey("grant", "projectStartDate")} get={() => DRAFT.grant.projectStartDate} set={(v) => { DRAFT.grant.projectStartDate = v; }}
          fallbackSource="agreement" missing={{ reason: "No project start date found." }} />
      </FieldRow>
      <FieldRow label="Project end">
        <EditableValue mkey={manualKey("grant", "projectEndDate")} get={() => DRAFT.grant.projectEndDate} set={(v) => { DRAFT.grant.projectEndDate = v; }}
          fallbackSource="agreement" missing={{ reason: "No project end date found." }} />
      </FieldRow>
      <FieldRow label="Outcomes">
        <EditableValue mkey={manualKey("grant", "projectOutcomes")} get={() => DRAFT.grant.projectOutcomes} set={(v) => { DRAFT.grant.projectOutcomes = v; }}
          fallbackSource="agreement" missing={{ reason: "No outcomes narrative found (Item 8)." }} />
      </FieldRow>
    </Section>
  );
}

function SectionFunding() {
  const DRAFT = session.DRAFT;
  return (
    <Section id="funding" title="Funding" hasData={!!DRAFT.grant}>
      <FieldRow label="Maximum funds">
        <EditableValue mkey={manualKey("grant", "maximumFunds")} get={() => DRAFT.grant.maximumFunds} set={(v) => { DRAFT.grant.maximumFunds = v; }}
          fallbackSource="agreement" missing={{ reason: "No maximum funds figure found." }} />
      </FieldRow>
      <FieldRow label="Grant percentage">
        <EditableValue mkey={manualKey("grant", "grantPercentage")} get={() => DRAFT.grant.grantPercentage} set={(v) => { DRAFT.grant.grantPercentage = v; }}
          fallbackSource="agreement" format="percent" missing={{ reason: "No grant percentage found." }} />
      </FieldRow>
      <FieldRow label="Total project cost">
        <EditableValue mkey={manualKey("grant", "totalProjectCost")} get={() => DRAFT.grant.totalProjectCost} set={(v) => { DRAFT.grant.totalProjectCost = v; }}
          fallbackSource={DRAFT.grant.totalProjectCostSource || "agreement"} missing={{ reason: "No supported total project cost could be derived from the agreement." }} />
      </FieldRow>
      <FieldRow label="Initial progress payment">
        <EditableValue mkey={manualKey("grant", "initialProgressPayment")} get={() => DRAFT.grant.initialProgressPayment} set={(v) => { DRAFT.grant.initialProgressPayment = v; }}
          fallbackSource="agreement" missing={{ reason: "Not specified (Item 12)." }} />
      </FieldRow>
      <FieldRow label="Retention amount">
        <EditableValue mkey={manualKey("grant", "retentionAmount")} get={() => DRAFT.grant.retentionAmount} set={(v) => { DRAFT.grant.retentionAmount = v; }}
          fallbackSource="agreement" missing={{ reason: "Not specified (Item 13)." }} />
      </FieldRow>
    </Section>
  );
}

/* ----- milestones ----- */
function MilestoneEditBody({ m, msFindings }) {
  const DRAFT = session.DRAFT;
  const dateFindings = msFindings.filter((f) => f.fieldKey !== "activities");
  const actFindings = msFindings.filter((f) => f.fieldKey === "activities");
  m.activities = m.activities || [];

  const commitActText = (a, node) => {
    const val = node.textContent.trim();
    if (val !== (a.description || "")) {
      a.description = val;
      markManual(manualKey("milestone", m.number, "activities"));
      saveReviewDraft();
    }
  };

  return (
    <>
      <div className="rv-ms-fields">
        <FieldRow label="Title">
          <EditableValue mkey={manualKey("milestone", m.number, "title")} get={() => m.title} set={(v) => { m.title = v; }}
            fallbackSource={m.titleSource || "agreement"} />
        </FieldRow>
        <FieldRow label="Start date">
          <EditableValue mkey={manualKey("milestone", m.number, "startDate")} get={() => m.startDate} set={(v) => { m.startDate = v; }}
            fallbackSource={m.startDateSource}
            missing={{
              reason: "The funding agreement does not specify milestone start dates.",
              fix: "Upload the Mandatory Attachment: Milestones, or enter one here.",
            }} />
        </FieldRow>
        <FieldRow label="Achievement date">
          <EditableValue mkey={manualKey("milestone", m.number, "plannedAchievementDate")} get={() => m.plannedAchievementDate}
            set={(v) => { m.plannedAchievementDate = v; }} fallbackSource="agreement" />
        </FieldRow>
        <FieldRow label="Estimated cost">
          <EditableValue mkey={manualKey("milestone", m.number, "estimatedCost")} get={() => m.estimatedCost} set={(v) => { m.estimatedCost = v; }}
            fallbackSource={m.estimatedCostSource}
            missing={{
              reason: "The funding agreement does not cost milestones.",
              fix: "Upload the Mandatory Attachment: Milestones, or enter an estimate here.",
            }} />
        </FieldRow>
      </div>

      {dateFindings.length > 0 && (
        <div className="rv-inline-findings">
          {dateFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}
        </div>
      )}

      <div className="rv-activities">
        <div className="rv-activities-head"><h3>Activities</h3>
          <button type="button" className="btn-chip" onClick={() => {
            m.activities.push({ sequence: m.activities.length + 1, description: "", source: "manual" });
            markManual(manualKey("milestone", m.number, "activities"));
            session.pendingFocus = { selector: `.rv-ms[data-ms="${m.number}"] .rv-act-row[data-idx="${m.activities.length - 1}"] .rv-act-text` };
            saveReviewDraft(); bump();
          }}>+ Add</button>
        </div>
        <div className="rv-act-list">
          {m.activities.map((a, idx) => (
            <ActivityRow key={idx} m={m} a={a} idx={idx} commit={commitActText} />
          ))}
        </div>
      </div>

      {actFindings.length > 0 && (
        <div className="rv-inline-findings">
          {actFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}
        </div>
      )}
    </>
  );
}

function ActivityRow({ m, a, idx, commit }) {
  const textRef = useRef(null);
  useLayoutEffect(() => {
    if (document.activeElement !== textRef.current) textRef.current.textContent = a.description || "";
  });
  return (
    <div className="rv-act-row" draggable data-idx={idx}
      onDragStart={(e) => { e.currentTarget.classList.add("dragging"); e.dataTransfer.setData("text/plain", String(idx)); }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (from === idx) return;
        const [moved] = m.activities.splice(from, 1);
        m.activities.splice(idx, 0, moved);
        markManual(manualKey("milestone", m.number, "activities"));
        saveReviewDraft(); bump();
      }}>
      <span className="rv-act-handle" aria-hidden="true">⠿</span>
      <span className="rv-act-text" contentEditable suppressContentEditableWarning spellCheck={false} tabIndex={0}
        ref={textRef}
        onKeyDown={(e) => {
          const node = textRef.current;
          if (e.key === "Enter") {
            e.preventDefault();
            a.description = node.textContent.trim();
            markManual(manualKey("milestone", m.number, "activities"));
            m.activities.splice(idx + 1, 0, { sequence: idx + 2, description: "", source: "manual" });
            session.pendingFocus = { selector: `.rv-ms[data-ms="${m.number}"] .rv-act-row[data-idx="${idx + 1}"] .rv-act-text` };
            saveReviewDraft(); bump();
          } else if (e.key === "Backspace" && node.textContent === "" && m.activities.length > 1) {
            e.preventDefault();
            m.activities.splice(idx, 1);
            markManual(manualKey("milestone", m.number, "activities"));
            const prevIdx = Math.max(0, idx - 1);
            session.pendingFocus = { selector: `.rv-ms[data-ms="${m.number}"] .rv-act-row[data-idx="${prevIdx}"] .rv-act-text`, caretEnd: true };
            saveReviewDraft(); bump();
          } else if (e.key === "Escape") {
            node.textContent = a.description || ""; node.blur();
          }
        }}
        onBlur={() => commit(a, textRef.current)} />
      <button type="button" className="rv-act-remove" aria-label="Remove activity" onClick={() => {
        m.activities.splice(idx, 1);
        markManual(manualKey("milestone", m.number, "activities"));
        saveReviewDraft(); bump();
      }}>✕</button>
    </div>
  );
}

function SectionMilestones() {
  const DRAFT = session.DRAFT;
  return (
    <Section id="milestones" title="Milestones" hasData={DRAFT.milestones && DRAFT.milestones.length > 0}>
      <div className="rv-milestones">
        {DRAFT.milestones.slice().sort((a, b) => a.number - b.number).map((m) => {
          const msFindings = findingsFor("milestone", (f) => f.milestoneNumber === m.number);
          const needsAttention = msFindings.some((f) => f.severity === "warning" && !f.resolution);
          if (!(m.number in DRAFT._collapsed)) DRAFT._collapsed[m.number] = !needsAttention;
          const collapsed = DRAFT._collapsed[m.number];
          const nAct = (m.activities || []).length;
          const nOut = (m.measurableOutcomes || []).length;
          return (
            <div key={m.number} className={"rv-ms" + (collapsed ? "" : " open")} data-ms={m.number}>
              <button type="button" className="rv-ms-head" onClick={() => {
                DRAFT._collapsed[m.number] = !DRAFT._collapsed[m.number];
                bump();
              }}>
                <span className="rv-ms-chevron">▸</span>
                <span className="rv-ms-num">{m.number}</span>
                <span className="rv-ms-title-wrap">
                  <span className="rv-ms-title">{m.title || ""}</span>
                  {needsAttention && <span className="rv-marker" title="Needs review">⚠</span>}
                </span>
                <span className="rv-ms-dates">{m.startDate ? fmtDate(m.startDate) + " – " : ""}{fmtDate(m.plannedAchievementDate) || "—"}</span>
              </button>
              <div className="rv-ms-sub">{m.estimatedCost != null ? money(m.estimatedCost) : "Cost not specified"} · {nAct} activit{nAct === 1 ? "y" : "ies"} · {nOut ? `${nOut} outcome${nOut === 1 ? "" : "s"}` : "No milestone outcomes supplied"}</div>
              <div className="rv-ms-body">
                {!collapsed && <MilestoneEditBody m={m} msFindings={msFindings} />}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SectionBudgetCategories() {
  const DRAFT = session.DRAFT;
  if (!(DRAFT.budgetCategories && DRAFT.budgetCategories.length > 0)) return null;
  let sumCeiling = 0, anyNullCeiling = false;
  DRAFT.budgetCategories.forEach((c) => {
    if (c.total == null) anyNullCeiling = true; else sumCeiling += c.total;
  });
  const agrTotal = DRAFT.grant.totalProjectCost;
  const consistent = agrTotal == null || anyNullCeiling ? null : Math.round(sumCeiling) === Math.round(agrTotal);

  const msSum = (DRAFT.milestones || []).reduce((s, m) => (m.estimatedCost != null ? s + m.estimatedCost : s), 0);
  const msAny = (DRAFT.milestones || []).some((m) => m.estimatedCost != null);
  let marginsHtml = null;
  if (msAny) {
    const catSum = anyNullCeiling ? null : sumCeiling;
    const same = catSum != null && Math.round(msSum) === Math.round(catSum);
    const advisoryEstimates = (DRAFT.milestones || []).every((m) =>
      m.estimatedCost == null || (m.estimatedCostSource && m.estimatedCostSource !== "agreement"));
    const scope = DRAFT.attachmentSummary?.coverage
      || (!same && msSum < catSum && advisoryEstimates ? "partial_or_phased" : null);
    const comparison = catSum == null ? "" : same ? '<span class="rv-ok">✓ Consistent.</span>'
      : scope === "partial_or_phased" ? '<span class="rv-info">ℹ Planning-source scope may be partial or phased.</span>'
      : `<span class="rv-warn">⚠ Differ by ${money(Math.abs(msSum - catSum))}.</span>`;
    marginsHtml = `Milestone estimates total ${money(msSum)}. Category ceilings total ${catSum != null ? money(catSum) : "—"}. ${comparison}`;
  }

  return (
    <Section id="budgetCategories" title="Budget categories" hasData>
      <table className="rv-table">
        <thead><tr><th>Category</th><th>Year 1</th><th>Year 2</th><th>Ceiling</th></tr></thead>
        <tbody>
          {DRAFT.budgetCategories.map((c, idx) => (
            <tr key={idx}>
              <td className="rv-cat-name">
                <EditableValue mkey={manualKey("category", idx, "name")} get={() => c.name} set={(v) => { c.name = v; }} fallbackSource="agreement" />
              </td>
              <td className="num">
                <EditableValue mkey={manualKey("category", idx, "year1")} get={() => c.year1} set={(v) => { c.year1 = v; }} fallbackSource="agreement" missing={{ reason: "No year 1 figure extracted." }} />
              </td>
              <td className="num">
                <EditableValue mkey={manualKey("category", idx, "year2")} get={() => c.year2} set={(v) => { c.year2 = v; }} fallbackSource="agreement" missing={{ reason: "No year 2 figure extracted." }} />
              </td>
              <td className="num">
                <EditableValue mkey={manualKey("category", idx, "total")} get={() => c.total} set={(v) => { c.total = v; }} fallbackSource="agreement"
                  missing={{ reason: "No ceiling could be read for this category.", fix: "A missing ceiling means unbounded — enter one if the agreement sets it." }} />
              </td>
            </tr>
          ))}
          <tr className="rv-total-row">
            <td>Total</td><td></td><td></td>
            <td className={"num" + (consistent === false ? " rv-amber" : "")}>
              <Value value={anyNullCeiling ? null : sumCeiling} format="money" source="derived"
                sourceDetail={{
                  note: anyNullCeiling
                    ? "One or more categories has no ceiling, so the total is unbounded."
                    : `Sum of ${DRAFT.budgetCategories.length} category ceilings`
                      + (consistent === false ? `. Differs from the agreement's stated total (${money(agrTotal)}) by ${money(Math.abs(sumCeiling - agrTotal))}.` : "."),
                }} />
            </td>
          </tr>
        </tbody>
      </table>
      {marginsHtml && <p className="rv-margins" dangerouslySetInnerHTML={{ __html: marginsHtml }} />}
    </Section>
  );
}

function SectionCaps() {
  const DRAFT = session.DRAFT;
  return (
    <Section id="caps" title="Periodic caps" hasData={DRAFT.annualCaps && DRAFT.annualCaps.length > 0}>
      <table className="rv-table rv-table-narrow">
        <thead><tr><th>Period</th><th>Capped amount</th></tr></thead>
        <tbody>
          {(DRAFT.annualCaps || []).map((c, idx) => (
            <tr key={idx}>
              <td><EditableValue mkey={manualKey("cap", idx, "financialYear")} get={() => c.financialYear} set={(v) => { c.financialYear = v; }} fallbackSource="agreement" /></td>
              <td className="num"><EditableValue mkey={manualKey("cap", idx, "cappedAmount")} get={() => c.cappedAmount} set={(v) => { c.cappedAmount = v; }} fallbackSource="agreement" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function SectionReporting() {
  const DRAFT = session.DRAFT;
  if (!(DRAFT.reportingObligations && DRAFT.reportingObligations.length > 0)) return null;
  const n = DRAFT.reportingObligations.length;
  if (!("reporting" in DRAFT._collapsed)) DRAFT._collapsed.reporting = true;
  const collapsed = DRAFT._collapsed.reporting;
  return (
    <Section id="reporting" title="Reporting obligations" hasData>
      <div className={"rv-collapsible" + (collapsed ? "" : " open")}>
        <button type="button" className="rv-collapsible-head" onClick={() => {
          DRAFT._collapsed.reporting = !DRAFT._collapsed.reporting; bump();
        }}><span className="rv-ms-chevron">▸</span> {n} reporting obligation{n === 1 ? "" : "s"}</button>
        <div className="rv-collapsible-body">
          {!collapsed && (
            <table className="rv-table">
              <thead><tr><th>Type</th><th>Due date</th><th>Period start</th><th>Period end</th></tr></thead>
              <tbody>
                {DRAFT.reportingObligations.map((r, idx) => (
                  <tr key={idx}>
                    <td><EditableValue mkey={manualKey("report", idx, "reportType")} get={() => r.reportType} set={(v) => { r.reportType = v; }} fallbackSource="agreement" /></td>
                    <td><EditableValue mkey={manualKey("report", idx, "dueDate")} get={() => r.dueDate} set={(v) => { r.dueDate = v; }} fallbackSource="agreement" /></td>
                    <td><EditableValue mkey={manualKey("report", idx, "periodStartDate")} get={() => r.periodStartDate} set={(v) => { r.periodStartDate = v; }} fallbackSource="agreement" missing={{ reason: "No period start given." }} /></td>
                    <td><EditableValue mkey={manualKey("report", idx, "periodEndDate")} get={() => r.periodEndDate} set={(v) => { r.periodEndDate = v; }} fallbackSource="agreement" missing={{ reason: "No period end given." }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Section>
  );
}

/* ---------------- the screen ---------------- */
export function ReviewScreen() {
  const DRAFT = session.DRAFT;
  const nameRef = useRef(null);

  useEffect(() => {
    if (!session.reviewMounted) {
      session.reviewMounted = true;
      requestAnimationFrame(() => nameRef.current && nameRef.current.focus());
    }
  }, []);

  useEffect(() => {
    if (session.pendingFocus) {
      const target = document.querySelector(session.pendingFocus.selector);
      if (target) {
        target.focus();
        if (session.pendingFocus.caretEnd) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
      session.pendingFocus = null;
    }
  });

  if (!DRAFT) return <section className="view" id="view-validate" />;

  const grantFindings = findingsFor("grant", () => true);
  const savingExisting = !!session.EDITING_GRANT;
  const actionLabel = savingExisting ? "Save changes" : "Create grant";
  const nameOk = session.draftGrantName.trim().length > 0;
  const passed = passedReviewFindings();

  const onBack = () => {
    const edited = session.EDITING_GRANT;
    clearReviewDraft(); session.DRAFT = null; session.PENDING = null; session.EDITING_GRANT = null;
    if (edited) openGrant(edited.id); else { show("home"); openModal(); }
  };

  return (
    <section className="view" id="view-validate">
      <div id="validate-body">
        <div className="rv-header">
          <div className="rv-header-row">
            <div className="rv-field-name">
              <label className="flabel" htmlFor="rv-grant-name">Display name<span className="rv-req">*</span></label>
              <input id="rv-grant-name" ref={nameRef} className="rv-name-input" type="text" placeholder="Name this grant" autoComplete="off"
                defaultValue={session.draftGrantName}
                onInput={(e) => { session.draftGrantName = e.target.value; saveReviewDraft(); bump(); }} />
              <div className="rv-name-help">Used in the sidebar and headers. The full project title is kept on file.</div>
            </div>
            <div className="rv-header-actions">
              <button className="btn-text" id="rv-back" onClick={onBack}>Back</button>
              <button className="btn-text" id="rv-create" disabled={!nameOk} onClick={createGrantFromDraft}>{actionLabel} ↓</button>
            </div>
          </div>
          <div className="rv-header-findings">
            {grantFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}
          </div>
        </div>

        <SectionRecipient />
        <SectionProject />
        <SectionFunding />
        <SectionMilestones />
        <SectionBudgetCategories />
        <SectionCaps />
        <SectionReporting />

        {passed.length > 0 && (
          <details className="rv-passed">
            <summary>▸ {passed.length} consistency check{passed.length === 1 ? "" : "s"} passed</summary>
            <div className="rv-passed-body">
              {passed.map((f) => (
                <div className="rv-passed-row" key={f.id}>✓ {f.title}{f.explanation ? <span> — {f.explanation}</span> : null}</div>
              ))}
            </div>
          </details>
        )}

        <div className="rv-footer">
          <button className="btn-secondary" id="rv-back2" onClick={onBack}>Back</button>
          <button className="btn-primary" id="rv-create2" disabled={!nameOk} onClick={createGrantFromDraft}>{actionLabel}</button>
        </div>
      </div>
    </section>
  );
}
