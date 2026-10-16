import { Button, FindingCard, money, StatusPill, Tabs, Value } from "@gf-ui";
import { deleteGrantOnServer, saveGrantIfPersisted } from "../api.js";
import { EvidenceDocuments } from "../components/EvidenceDocuments.jsx";
import { Island } from "../components/Island.jsx";
import {
  ceilingBreaches, deadlineSeverity, evidenceGaps, lifecycle,
  unresolvedFindings, upcomingObligations,
} from "../lib/derive.js";
import { fmtDate, pct, shortCatName } from "../lib/format.js";
import { categoryActual, cellActual, cellPlanned, pendingDecisions } from "../lib/funnel.js";
import { renderTimeline } from "../islands/timeline.js";
import { renderExpenditure } from "../islands/expenditure.js";
import { attachEvidence } from "../lib/evidence.js";
import { Actuals } from "./tabs/Actuals.jsx";
import { Evidence } from "./tabs/Evidence.jsx";
import { bump, currentGrant, DATA, goBack, openGrant, session, show, state, useAppVersion } from "../store.js";
import { startEditReview } from "./ReviewScreen.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "milestones", label: "Milestones" },
  { key: "expenditure", label: "Expenditure" },
  { key: "actuals", label: "Actuals" },
  { key: "evidence", label: "Evidence" },
];

export function GrantView() {
  const version = useAppVersion();
  const g = currentGrant();
  if (!g) return <section className="view" id="view-grant" />;

  async function onDelete() {
    if (!confirm(`Delete “${g.displayName}”?\n\nThis permanently removes the grant and its locally stored statements, evidence links, and review decisions.`)) return;
    const ok = await deleteGrantOnServer(g);
    if (!ok) { alert("Backend unreachable — the grant was not deleted."); return; }
    const index = DATA.grants.indexOf(g);
    if (index >= 0) DATA.grants.splice(index, 1);
    session.SP_CACHE.delete(g.id);
    show("home");
  }

  return (
    <section className="view" id="view-grant">
      <div className="grant-head">
        <button type="button" className="crumb" onClick={goBack}
          aria-label="Back to previous view">Back</button>
        <div className="grant-title-row">
          <h1 className="grant-title">{g.displayName}</h1>
          <div className="grant-actions">
            <Button variant="text" className="grant-action-edit" onClick={() => startEditReview(g)}>Edit</Button>
            <Button variant="text" className="grant-action-delete" onClick={onDelete}>Delete</Button>
          </div>
        </div>
      </div>
      <Tabs tabs={TABS} active={state.tab} ariaLabel="Grant sections"
        onSelect={(tab) => { state.tab = tab; state.msDetail = null; bump(); }} />
      <div id="tab-body">
        {g._conflict && (
          <div className="conflict-banner">⚠ <span>This grant was changed in another tab. This tab stopped saving so it can't overwrite that work — the last change made here was <b>not</b> saved. Reload to continue from the latest saved state.</span>
            <Button variant="chip" onClick={() => location.reload()}>Reload</Button>
          </div>
        )}
        {state.tab === "overview" && <Overview g={g} version={version} />}
        {state.tab === "milestones" && (state.msDetail ? <MilestoneDetail g={g} /> : <Milestones g={g} version={version} />)}
        {state.tab === "expenditure" && (
          <Island deps={[g.id, version]} build={(node) => renderExpenditure(g, node)} />
        )}
        {state.tab === "actuals" && <Actuals g={g} version={version} />}
        {state.tab === "evidence" && <Evidence g={g} />}
      </div>
    </section>
  );
}

/* ----- overview ----- */
function Overview({ g, version }) {
  const items = upcomingObligations(g);
  const gaps = evidenceGaps(g);
  const findings = unresolvedFindings(g);
  const ceilings = ceilingBreaches(g);
  const pending = pendingDecisions(g);
  const life = lifecycle(g);
  const caps = g.annualCaps || [];
  const reports = g.reportingObligations || [];
  const nextDated = items.find((x) => x.dated) || null;
  const openKinds = ceilings.length + gaps.length + findings.length
    + (pending.awaiting > 0 ? 1 : 0) + (pending.rows > 0 ? 1 : 0);
  const otherIssues = [
    ...ceilings.map((c) => ({
      key: `ceiling-${c.name}`, severity: "breach", action: "Review",
      content: <><b>{shortCatName(c.name)}</b> recognised actuals exceed the contractual{" "}
        <Value value={c.ceiling} format="money" source="agreement" /> ceiling by{" "}
        <Value value={c.used - c.ceiling} format="money" source="derived"
          sourceDetail={{ note: "Recognised actuals less the contractual category limit." }} />.</>,
      go: () => openGrant(g.id, "expenditure"),
    })),
    ...(gaps.length ? [{
      key: "evidence", severity: "warn", action: "Attach",
      content: <><Value value={gaps.length} source="derived"
        sourceDetail={{ note: "Measurable outcomes with no linked evidence." }} /> outcome{gaps.length === 1 ? "" : "s"} need evidence.</>,
      go: () => openGrant(g.id, "evidence"),
    }] : []),
    ...(pending.awaiting > 0 ? [{
      key: "awaiting", severity: "warn", action: "Attribute",
      content: <><Value value={pending.awaiting} format="money" source="derived"
        sourceDetail={{ note: "Eligible statement amounts not yet placed against milestones." }} /> is tagged eligible and still needs a milestone.</>,
      go: () => openGrant(g.id, "actuals", { actualsView: "attribute" }),
    }] : []),
    ...(pending.rows > 0 ? [{
      key: "review", severity: "warn", action: "Continue",
      content: <><Value value={pending.rows} source="derived"
        sourceDetail={{ note: "Imported statement lines without a completed review decision." }} /> statement line{pending.rows === 1 ? "" : "s"} still need a decision.</>,
      go: () => openGrant(g.id, "actuals", { actualsView: "tag" }),
    }] : []),
    ...(findings.length ? [{
      key: "findings", severity: "warn", action: "Resolve",
      content: <><Value value={findings.length} source="derived"
        sourceDetail={{ note: "Unresolved warnings found while comparing source documents." }} /> source conflict{findings.length === 1 ? "" : "s"} need review.</>,
      go: () => {
        const first = findings[0];
        if (first.milestoneNumber) openGrant(g.id, "milestones", { msDetail: first.milestoneNumber });
        else startEditReview(g);
      },
    }] : []),
  ];

  return (
    <>
      <div className="ov-status">
        {life === "completed" ? <>
          <b>Project complete.</b>{" "}Ended <Value value={g.grant.projectEndDate} format="date" source="agreement" />.
        </> : life === "not_started" ? <>
          <b>Not started.</b>{" "}Begins <Value value={g.grant.projectStartDate} format="date" source="agreement" />.
        </> : nextDated && nextDated.days < 0 ? <>
          <b>Action needed.</b>{" "}{nextDated.r.reportType} is{" "}
          <Value value={Math.abs(nextDated.days)} source="derived"
            format={(n) => `${n} day${n === 1 ? "" : "s"}`}
            sourceDetail={{ note: "Calendar days since the contractual due date." }} /> overdue
          {ceilings.length ? " and a contractual spending ceiling has been exceeded" : ""}.
        </> : ceilings.length ? <>
          <b>Action needed.</b>{" "}Recognised expenditure has exceeded a contractual ceiling.
        </> : openKinds ? <>
          <b>On track overall.</b>{" "}<Value value={openKinds} source="derived"
            format={(n) => `${n} item${n === 1 ? "" : "s"}`}
            sourceDetail={{ note: "Open evidence, source-review and expenditure decisions." }} /> need attention.
        </> : <>
          <b>On track.</b>{" "}No open compliance issues.
        </>}
      </div>

      {items.length > 0 && (
        <div className="deadlines">
          <h3 className="deadlines-head">Reporting deadlines</h3>
          {items.slice(0, 2).map(({ r, dated, days }, i) => {
            const sev = deadlineSeverity(days);
            const count = !dated ? null : Math.abs(days);
            const statusLabel = !dated ? "date unavailable"
              : days < 0 ? "days overdue" : days === 0 ? "due today" : "days remaining";
            const openInCalendar = () => {
              if (!dated) return;
              const [year, month] = r.dueDate.split("-").map(Number);
              state.calView = "month";
              session.calMonth = new Date(year, month - 1, 1);
              session.calSelected = r.dueDate;
              show("calendar");
            };
            return (
              <div className={`deadline-card ${sev}`} key={i}
                role={dated ? "button" : undefined} tabIndex={dated ? 0 : undefined}
                aria-label={dated ? `Open ${r.reportType} due ${fmtDate(r.dueDate)} in the reporting calendar` : undefined}
                onClick={openInCalendar}
                onKeyDown={(e) => {
                  if (dated && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    openInCalendar();
                  }
                }}>
                <div className="dl-when">
                  {dated
                    ? <><span className="dl-date">Due</span>
                      <span className="dl-count"><Value value={r.dueDate}
                        format={(iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", {
                          day: "numeric", month: "short",
                        })} source="agreement" /></span>
                      <span className="dl-date"><Value value={r.dueDate}
                        format={(iso) => iso.slice(0, 4)} source="agreement" /></span></>
                    : <span className="dl-count dl-nodate"><Value value={null}
                        missing={{ reason: "The agreement does not provide a fixed due date.", fix: "Review the obligation wording in Formal details." }} /></span>}
                </div>
                <div className="dl-body">
                  <div className="dl-type">{r.reportType}</div>
                  <div className="dl-period">
                    {r.periodStartDate ? <><Value value={r.periodStartDate} format="date" source="agreement" /> –{" "}
                      <Value value={r.periodEndDate} format="date" source="agreement" /></>
                      : dated ? "No reporting period specified" : (r.dueDate || "No fixed date")}
                  </div>
                </div>
                <div className="dl-when">
                  {dated && days !== 0 && <span className="dl-count"><Value value={count} source="derived"
                    sourceDetail={{ note: "Calendar distance from the January 2021 demo date." }} /></span>}
                  <span className="dl-date">{statusLabel}</span>
                  {dated && <span className="dl-date">Open calendar →</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {otherIssues.length > 0 && (
        <div className="attention">
          {otherIssues.map((it, i) => (
            <button key={it.key || i} type="button"
              className={`attn-row ${it.severity === "breach" ? "over" : ""}`} onClick={it.go}>
              <span>{it.content}</span><span className="go">{it.action} →</span>
            </button>
          ))}
        </div>
      )}

      <Island deps={[g.id, version]} build={(node) => {
        node.appendChild(renderTimeline(g, {
          onClick: (num) => { state.tab = "milestones"; state.msDetail = num; bump(); },
        }));
      }} />

      <BudgetRow g={g} />

      <details className="formal"><summary>Formal details — funding agreement{" "}
        <Value value={g.grant.projectReferenceNumber} source="agreement"
          missing={{ reason: "No agreement reference was extracted.", fix: "Edit the reviewed agreement details." }} />
      </summary>
        <dl className="formal-grid">
          <dt>Project title</dt><dd>{g.grant.projectTitle || ""}</dd>
          <dt>Reference number</dt><dd><Value value={g.grant.projectReferenceNumber} source="agreement" /></dd>
          <dt>Recipient</dt><dd>{g.client.name || ""}</dd>
          <dt>ABN</dt><dd><Value value={g.client.abn} source="agreement"
            missing={{ reason: "No ABN was extracted from the agreement.", fix: "Edit the recipient details." }} /></dd>
          <dt>Agreement commencement</dt><dd><Value value={g.grant.agreementCommencementDate} source="agreement" /></dd>
          <dt>Agreement end</dt><dd><Value value={g.grant.agreementEndDate} source="agreement" /></dd>
          <dt>Project start</dt><dd><Value value={g.grant.projectStartDate} format="date" source="agreement" /></dd>
          <dt>Project end</dt><dd><Value value={g.grant.projectEndDate} format="date" source="agreement" /></dd>
          <dt>Maximum funds</dt><dd><Value value={g.grant.maximumFunds} format="money" source="agreement" /></dd>
          <dt>Grant percentage</dt><dd><Value value={g.grant.grantPercentage} format="percent" source="agreement" /></dd>
          <dt>Initial progress payment</dt><dd><Value value={g.grant.initialProgressPayment} format="money" source="agreement" /></dd>
          <dt>Retention amount</dt><dd><Value value={g.grant.retentionAmount} format="money" source="agreement" /></dd>
        </dl>
        {(g.budgetCategories || []).length > 0 && <>
          <div className="formal-sub">Category funding limits</div>
          <ul className="formal-list">{g.budgetCategories.map((c) =>
            <li key={c.name}><span>{shortCatName(c.name)}</span><span><Value value={c.total} format="money" source="agreement"
              missing={{ reason: `No contractual category limit was extracted for ${c.name}.`, fix: "Review the agreement before allocating expenditure." }} /></span></li>)}</ul>
        </>}
        {caps.length > 0 && <>
          <div className="formal-sub">Periodic caps</div>
          <ul className="formal-list">{caps.map((c, i) =>
            <li key={i}><span>FY <Value value={c.financialYear} source="agreement" /></span>
              <span><Value value={c.cappedAmount} format="money" source="agreement" /></span></li>)}</ul>
        </>}
        {reports.length > 0 && <>
          <div className="formal-sub">Reporting obligations</div>
          <ul className="formal-list">{reports.map((r, i) =>
            <li key={i}><span>{r.reportType}</span><span><Value value={r.dueDate}
              format={/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate || "") ? "date" : undefined}
              source="agreement" missing={{ reason: "This obligation has no fixed due date.", fix: "Read the full agreement wording." }} /></span></li>)}</ul>
        </>}
      </details>
    </>
  );
}

/* Budget, in one row: a single stacked bar sized by category ceiling. */
function BudgetRow({ g }) {
  const cats = (g.budgetCategories || []).filter((c) => c.total !== 0 && c.total != null);
  const sorted = cats.slice().sort((a, b) => (b.total || 0) - (a.total || 0));
  const tints = sorted.map((_, i) => i === 0
    ? "var(--brand)"
    : `color-mix(in oklch, var(--brand) ${Math.max(28, 68 - i * 16)}%, var(--ink-3))`);
  const ceilingTotal = sorted.reduce((s, c) => s + (c.total || 0), 0);
  const actuals = Object.fromEntries(sorted.map((c) => [c.name, categoryActual(g, c.name)]));

  const msSum = (g.milestones || []).reduce((s, m) => (m.estimatedCost != null ? s + m.estimatedCost : s), 0);
  const msAny = (g.milestones || []).some((m) => m.estimatedCost != null);
  let comparison = null;
  if (msAny) {
    const same = Math.round(msSum) === Math.round(ceilingTotal);
    const advisoryEstimates = (g.milestones || []).every((m) =>
      m.estimatedCost == null || (m.estimatedCostSource && m.estimatedCostSource !== "agreement"));
    const scope = g.attachmentSummary?.coverage
      || (!same && msSum < ceilingTotal && advisoryEstimates ? "partial_or_phased" : null);
    comparison = same ? <StatusPill sev="done">Within ceilings</StatusPill>
      : scope === "partial_or_phased" ? <StatusPill sev="none">Planning scope may be partial</StatusPill>
      : <StatusPill sev="warn">Review the difference</StatusPill>;
  }

  return (
    <div className="ov-budget">
      {sorted.length > 0 && ceilingTotal > 0 && <>
        <div className="ov-budget-bar">
          {sorted.map((c, i) => {
            const w = pct(c.total, ceilingTotal);
            const actual = actuals[c.name];
            const usedPct = actual > 0 ? Math.min(pct(actual, c.total), 100) : null;
            return (
              <div key={c.name} className="ov-budget-seg" style={{ width: w + "%", background: tints[i] }}>
                {usedPct != null && <div className="used" style={{ width: usedPct + "%" }} />}
              </div>
            );
          })}
        </div>
        <div className="ov-budget-labels">
          {sorted.map((c, i) => (
            <div key={c.name} className={`ov-budget-label ${actuals[c.name] > c.total ? "breach" : ""}`}>
              <span className="sw" style={{ background: tints[i] }} />{shortCatName(c.name)} · ceiling{" "}
              <Value value={c.total} format="money" source="agreement" />
              {actuals[c.name] > 0 && <> · <Value value={actuals[c.name]} format="money" source="derived"
                sourceDetail={{ note: "Recognised from statement amounts attributed to milestones." }} /> recognised</>}
            </div>
          ))}
        </div>
      </>}
      {msAny && (
        <p className="ov-margins">
          Milestone estimates <Value value={msSum} format="money" source="derived"
            sourceDetail={{ note: "Sum of available milestone planning estimates." }} /> · category ceilings{" "}
          <Value value={ceilingTotal} format="money" source="derived"
            sourceDetail={{ note: "Sum of contractual category funding limits." }} /> · {comparison}
        </p>
      )}
      {!Object.values(actuals).some((n) => n > 0) && (
        <p className="ov-noexp">No actual expenditure recognised yet.{" "}
          <button type="button" className="btn-text" onClick={() => openGrant(g.id, "actuals")}>Add a statement →</button>
        </p>
      )}
    </div>
  );
}

/* ----- milestones tab: timeline + list, shared selection ----- */
function Milestones({ g, version }) {
  let timelineWrap = null;   // the island's wrap element (liftRow lives on it)
  let listNode = null;

  return (
    <>
      <Island deps={[g.id, version]} build={(node) => {
        timelineWrap = renderTimeline(g, {
          onHover: (num) => {
            if (!listNode) return;
            [...listNode.querySelectorAll(".ms-row")].forEach((r) =>
              r.classList.toggle("dim", num != null && Number(r.dataset.ms) !== num));
          },
          onClick: (num) => {
            const row = listNode && listNode.querySelector(`.ms-row[data-ms="${num}"]`);
            if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
          },
        });
        node.appendChild(timelineWrap);
      }} />
      <div className="ms-list" ref={(n) => { listNode = n; }}>
        {g.milestones.slice().sort((a, b) => a.number - b.number).map((m) => {
          const gaps = g.evidenceRequirements.filter((r) => r.milestoneNumber === m.number && !r.satisfied).length;
          const hasFinding = unresolvedFindings(g).some((f) => f.milestoneNumber === m.number);
          const status = hasFinding || gaps ? "at-risk" : "on-track";
          const statusLabel = hasFinding ? "Needs review" : gaps ? "At risk" : "On track";
          const range = m.startDate
            ? `${fmtDate(m.startDate)} – ${fmtDate(m.plannedAchievementDate)}`
            : fmtDate(m.plannedAchievementDate) ? `Due ${fmtDate(m.plannedAchievementDate)}` : "No dates in agreement";
          return (
            <div key={m.number} className="ms-row" role="button" tabIndex={0} data-ms={m.number}
              onClick={() => { state.msDetail = m.number; bump(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.msDetail = m.number; bump(); } }}
              onMouseEnter={() => timelineWrap && timelineWrap.liftRow(m.number)}
              onMouseLeave={() => timelineWrap && timelineWrap.liftRow(null)}>
              <div className="ms-num">M{m.number}</div>
              <div className="ms-main">
                <div className="ms-title">{m.title}</div>
                <div className="ms-dates">{range}</div>
                <div className="ms-meta">
                  {m.estimatedCost != null
                    ? <Value value={m.estimatedCost} format="money" source={m.estimatedCostSource} />
                    : <span style={{ color: "var(--ink-3)" }}>Cost not specified</span>}
                  {" "}· {m.activities.length} activit{m.activities.length === 1 ? "y" : "ies"}
                  {gaps > 0 && <> · <span className="warn">{gaps} outcome{gaps === 1 ? "" : "s"} awaiting evidence</span></>}
                </div>
              </div>
              <div className={`ms-status ${status}`}>{statusLabel}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* One bar per category this milestone has an allocation under. */
function MilestoneSpendBars({ g, m }) {
  const rows = (g.budgetCategories || [])
    .filter((c) => c.total !== 0 && c.total != null)
    .map((c) => {
      const allocated = cellPlanned(g, m.number, c.name);
      if (allocated == null || allocated <= 0) return null;
      const a = cellActual(g, m.number, c.name);
      const spent = a ? a.attributed + a.entered : 0;
      return { c, allocated, spent };
    })
    .filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="ms-section ms-spend">
      <div className="ms-section-head"><h3>Spend by category</h3></div>
      {rows.map(({ c, allocated, spent }) => {
        const remaining = allocated - spent;
        const over = remaining < 0;
        const p = allocated > 0 ? Math.min(spent / allocated, 1) * 100 : 0;
        const go = () => openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: { category: c.name, milestoneNumber: m.number } });
        return (
          <div key={c.name} className="ms-spend-row" role="button" tabIndex={0}
            data-tip="Click to tag transactions against this milestone and category." data-tipsrc="Spend"
            onClick={go}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}>
            <span className="ms-spend-label">{shortCatName(c.name)}</span>
            <div className="ms-spend-track" title={`${money(spent)} of ${money(allocated)} allocated`}>
              <div className={`ms-spend-fill ${over ? "over" : ""}`} style={{ width: p + "%" }} />
            </div>
            <span className={`ms-spend-remaining ${over ? "over" : ""}`}>
              {over ? "−" + money(Math.abs(remaining)) + " over" : money(remaining) + " remaining"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MilestoneDetail({ g }) {
  const m = g.milestones.find((x) => x.number === state.msDetail);
  if (!m) return <Milestones g={g} version={0} />;
  const findings = unresolvedFindings(g).filter((f) => f.milestoneNumber === m.number);
  const dateFindings = findings.filter((f) => f.fieldKey !== "activities");
  const actFindings = findings.filter((f) => f.fieldKey === "activities");
  const done = m.activities.filter((a) => a.complete).length;
  const onFindingChange = () => { saveGrantIfPersisted(g); bump(); };

  const withReq = m.measurableOutcomes.map((o) => ({
    o, req: g.evidenceRequirements.find((r) => r.milestoneNumber === m.number && r.outcome === o.description),
  }));
  withReq.sort((a, b) => Number(!!a.req?.satisfied) - Number(!!b.req?.satisfied));

  const costNote = (
    `From the application attachment${
      m.startDateRaw && m.startDateRaw !== m.startDate
        ? ` (given as “${m.startDateRaw}”)`
        : ""
    }. Estimated costs are for assessment purposes only and are not contractual.`
  );

  return (
    <div className="ms-detail">
      <a href="#" className="back crumb" onClick={(e) => { e.preventDefault(); state.msDetail = null; bump(); }}>Milestones</a>
      <h2>M{m.number} · {m.title}</h2>
      <div className="ms-meta">
        {m.startDate ? <>{fmtDate(m.startDate)} – </> : null}
        {fmtDate(m.plannedAchievementDate)}
        {m.estimatedCost != null
          ? <>{" · "}<Value value={m.estimatedCost} format="money"
            source={m.estimatedCostSource} sourceDetail={{ note: costNote }} /></>
          : null}
      </div>

      <MilestoneSpendBars g={g} m={m} />

      {dateFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}

      <div className="ms-section">
        <div className="ms-section-head"><h3>Activities</h3><span className="count">{done} of {m.activities.length}</span></div>
        {m.activities.slice().sort((a, b) => (a.complete === b.complete ? 0 : a.complete ? 1 : -1)).map((a, i) => (
          <label key={i} className={`act-row ${a.complete ? "done" : ""}`}>
            <input type="checkbox" checked={!!a.complete}
              onChange={(e) => { a.complete = e.target.checked; saveGrantIfPersisted(g); bump(); }} />
            <span>{a.description}</span>
          </label>
        ))}
        {m.attachmentActivities && m.attachmentActivities.length > 0 && (
          <p style={{ color: "var(--ink-2)", fontSize: "12.5px", margin: "8px 0 0" }}>
            The attachment describes this milestone differently: {m.attachmentActivities.join("; ")}
          </p>
        )}
      </div>
      {actFindings.map((f) => <FindingCard key={f.id} finding={f} onChange={onFindingChange} />)}

      <div className="ms-section">
        <div className="ms-section-head"><h3>Measurable outcomes</h3></div>
        {withReq.map(({ o, req }, i) => (
          <div className="out-row" key={i}>
            <span>{o.description}</span>
            {req && req.satisfied
              ? <EvidenceDocuments documents={req.documents} />
              : <button className="ev-upload" onClick={() => req && attachEvidence(g, req)}>Upload +</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
