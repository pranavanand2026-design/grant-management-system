import { useState } from "react";
import { Button, DropZone, Value } from "@gf-ui";
import { extractDocument, saveGrantIfPersisted } from "../../api.js";
import { Island } from "../../components/Island.jsx";
import { periodLabel } from "../../lib/format.js";
import { actualsSnapshot, allStatementRows } from "../../lib/funnel.js";
import { renderAttribution } from "../../islands/attribution.js";
import { renderTagging } from "../../islands/tagging.js";
import { bump, openGrant, pickFile, state } from "../../store.js";

/* The actuals workflow: statement → review & tag → attribute → sheet. */
export function Actuals({ g, version }) {
  if (state.pendingStatement) return <StatementImportPreview g={g} />;

  const s = actualsSnapshot(g);
  const reviewed = s.rowCount - s.undecided
    - allStatementRows(g).filter(({ row }) => row.isRollup).length;
  const stations = [
    { key: "list", num: 1, label: "Statements",
      sub: s.statements
        ? <><Value value={s.rowCount} source="derived"
            sourceDetail={{ note: "Account-period lines imported from all statements." }} /> lines imported</>
        : "None yet — add one to begin" },
    { key: "tag", num: 2, label: "Review & tag",
      sub: !s.rowCount ? "Waiting on a statement"
        : s.undecided ? <><Value value={reviewed} source="derived" /> reviewed · <Value value={s.undecided}
            source="derived" /> remaining</>
        : "All lines reviewed ✓" },
    { key: "attribute", num: 3, label: "Attribute",
      warn: s.over > 0,
      sub: s.over > 0 ? <><Value value={s.over} format="money" source="derived" /> over — review</>
        : s.awaiting > 0 ? <><Value value={s.attributed} format="money" source="derived" /> attributed · <Value
            value={s.awaiting} format="money" source="derived" /> awaiting</>
        : s.attributed > 0
          ? <><Value value={s.attributed} format="money" source="derived" /> attributed{s.undecided ? " · tagging incomplete" : " ✓"}</>
          : "Waiting on tagged lines" },
  ];

  return (
    <>
      <div className="pipeline" role="tablist" aria-label="Actual expenditure workflow">
        {stations.map((st) => {
          const active = state.actualsView === st.key || (!state.actualsView && st.key === "list");
          return (
            <button key={st.key} type="button" role="tab" aria-selected={active}
              className={`pl-station ${active ? "active" : ""} ${st.warn ? "warn" : ""}`}
              onClick={() => { state.actualsView = st.key; state.attributeFilter = null; bump(); }}>
              <span className="pl-step" aria-hidden="true">{st.num}</span>
              <span className="pl-copy"><span className="pl-label">{st.label}</span>
                <span className="pl-sub">{st.sub}</span></span>
            </button>
          );
        })}
        <button type="button" className="pl-station pl-sheet" onClick={() => openGrant(g.id, "expenditure")}>
          <span className="pl-step" aria-hidden="true">4</span>
          <span className="pl-copy"><span className="pl-label">Expenditure sheet</span>
            <span className="pl-sub">{s.recognised > 0
              ? <><Value value={s.recognised} format="money" source="derived" /> recognised</>
              : "Nothing recognised yet"}</span></span>
        </button>
      </div>

      {state.actualsView === "tag" && (
        <Island deps={[g.id, version]} build={(node) => renderTagging(g, node)} />
      )}
      {state.actualsView === "attribute" && (
        <Island deps={[g.id, version]} build={(node) => renderAttribution(g, node)} />
      )}
      {(state.actualsView === "list" || !state.actualsView) && <StatementsList g={g} />}
    </>
  );
}

export async function processStatementFile(g, file) {
  let data;
  try {
    const { res, data: d } = await extractDocument("/extract/statement", file);
    data = d;
    if (!res.ok) throw new Error(data.detail || "Extraction failed (" + res.status + ")");
  } catch (e) {
    alert("Could not read this statement: " + e.message);
    return;
  }
  state.pendingStatement = { filename: file.name, result: data, rollupAnswers: {}, outOfWindowAnswer: null };
  bump();
}

function StatementsList({ g }) {
  const statements = g.statements || [];
  return (
    <>
      <DropZone className="stmt-dz" ariaLabel="Upload a cash flow statement"
        onBrowse={() => pickFile(".xlsx,.xlsm", (f) => processStatementFile(g, f))}
        onFile={(f) => processStatementFile(g, f)}>
        Drop an XLSX or XLSM, or click to browse
      </DropZone>
      {!statements.length && (
        <div className="empty"><h3>No statements yet</h3><p>Add a cash flow statement to start tagging actuals against this grant.</p></div>
      )}
      {statements.map((stmt) => (
        <div className="stmt-card" key={stmt.id}>
          <div className="stmt-card-head"><b>{stmt.filename}</b><span><Value value={stmt.periodStart}
            format={periodLabel} source="statement" sourceDetail={{ filename: stmt.filename }} /> – <Value
            value={stmt.periodEnd} format={periodLabel} source="statement" sourceDetail={{ filename: stmt.filename }} /></span></div>
          <div className="stmt-card-sub"><Value value={stmt.rows.length} source="derived"
            sourceDetail={{ note: `Lines imported from ${stmt.filename}.` }} /> rows{stmt.outOfWindowAnswer ? " · marked as " + stmt.outOfWindowAnswer : ""}</div>
        </div>
      ))}
    </>
  );
}

function statementOutOfWindowAfter(g, result) {
  const projectEnd = g.grant.projectEndDate;
  if (!projectEnd) return [];
  return result.periods.filter((p) => p + "-01" > projectEnd);
}

function StatementImportPreview({ g }) {
  const [, force] = useState(0);
  const pending = state.pendingStatement;
  const result = pending.result;
  const rollupRows = result.rows.filter((r) => r.suspectedRollup);
  const afterWindow = statementOutOfWindowAfter(g, result);

  function add() {
    const rows = result.rows.map((r) => ({
      id: r.id, period: r.period, account: r.account, amount: r.amount, section: r.section,
      category: null, eligible: null,
      isRollup: r.suspectedRollup ? !!pending.rollupAnswers[r.id] : null,
    }));
    if (!g.statements) g.statements = [];
    g.statements.push({
      id: "stmt_" + Date.now(), filename: pending.filename, sheet: result.sheet,
      periodStart: result.period_start, periodEnd: result.period_end,
      outOfWindowAfter: afterWindow, outOfWindowAnswer: pending.outOfWindowAnswer,
      rows,
    });
    g.documents = g.documents || {};
    g.documents.statement = true;
    state.pendingStatement = null;
    saveGrantIfPersisted(g);
    bump();
  }

  return (
    <div className="stmt-preview">
      <h3 className="stmt-preview-head">Importing {pending.filename}</h3>
      <dl className="stmt-preview-stats">
        <div><dt>Sheet</dt><dd>{result.sheet}</dd></div>
        <div><dt>Accounts</dt><dd><Value value={result.rows.length} source="statement"
          sourceDetail={{ filename: pending.filename }} /> rows</dd></div>
        <div><dt>Periods</dt><dd><Value value={result.period_start} format={periodLabel} source="statement"
          sourceDetail={{ filename: pending.filename }} /> – <Value value={result.period_end}
          format={periodLabel} source="statement" sourceDetail={{ filename: pending.filename }} /></dd></div>
        <div><dt>Total</dt><dd><Value value={result.total} format="money" source="statement"
          sourceDetail={{ filename: pending.filename }} /></dd></div>
      </dl>

      {afterWindow.length > 0 && (
        <div className="stmt-preview-note">
          <p><Value value={afterWindow.length} source="derived" /> period{afterWindow.length === 1 ? "" : "s"} in this statement fall after the project end date (<Value
            value={g.grant.projectEndDate} format="date" source="agreement" />). Is this a forecast, or realised actuals?</p>
          <div className="stmt-preview-choice">
            {["forecast", "actuals"].map((choice) => (
              <button key={choice} type="button"
                className={"btn-chip" + (pending.outOfWindowAnswer === choice ? " active" : "")}
                onClick={() => { pending.outOfWindowAnswer = choice; force((n) => n + 1); }}>
                {choice === "forecast" ? "Forecast" : "Actuals"}
              </button>
            ))}
          </div>
        </div>
      )}

      {rollupRows.length > 0 && <>
        <p className="stmt-preview-sub"><Value value={rollupRows.length} source="derived" /> row{rollupRows.length === 1 ? "" : "s"} may be the preparer's own pre-computed figure rather than a real transaction. Nothing is excluded either way — this only decides whether it's held out of her tagging totals and shown as a reference instead.</p>
        <div className="stmt-rollup-list">
          {rollupRows.map((r) => (
            <label className="stmt-rollup-row" key={r.id}>
              <input type="checkbox" checked={!!pending.rollupAnswers[r.id]}
                onChange={(e) => { pending.rollupAnswers[r.id] = e.target.checked; force((n) => n + 1); }} />
              <span className="rr-label">{r.account}</span>
              <span className="rr-period"><Value value={r.period} format={periodLabel} source="statement"
                sourceDetail={{ filename: pending.filename, account: r.account }} /></span>
              <span className="rr-amount"><Value value={r.amount} format="money" source="statement"
                sourceDetail={{ filename: pending.filename, account: r.account, period: periodLabel(r.period) }} /></span>
            </label>
          ))}
        </div>
      </>}

      <div className="stmt-preview-actions">
        <Button variant="secondary" onClick={() => { state.pendingStatement = null; bump(); }}>Cancel</Button>
        <Button variant="primary" onClick={add}>Add statement</Button>
      </div>
    </div>
  );
}
