/* Reviews source rows while keeping eligibility decisions explicit. */

import { esc, money, Value } from "@gf-ui";
import { saveGrantIfPersisted } from "../api.js";
import { $, $$, el, onActivate } from "../lib/dom.js";
import { parseAmt, periodLabel, shortCatName } from "../lib/format.js";
import {
  allStatementRows, attributedForPeriod, eligibleByCategoryPeriod,
  preparerComparison, rollupReference, rowHardWarnings, rowNeedsDecision,
  rowSourceMag, rowStatus,
} from "../lib/funnel.js";
import { bump, bumpKeepScroll, openGrant, session, state } from "../store.js";

let TAG_SAVE_STATE = "idle";
let TAG_EDITOR_FOCUS = false;

function paintTagSave() {
  const n = $("#tag-save");
  if (!n) return;
  const map = {
    idle: "", saving: "Saving…", saved: "All changes saved ✓",
    memory: "Sample grant — changes held in memory only",
    offline: "Backend unreachable — latest change is not saved",
    conflict: "Changed in another tab — saving paused",
  };
  n.textContent = map[TAG_SAVE_STATE] || "";
  n.classList.toggle("err", TAG_SAVE_STATE === "offline" || TAG_SAVE_STATE === "conflict");
  n.classList.toggle("ok", TAG_SAVE_STATE === "saved");
}
function saveAndTrack(g) {
  TAG_SAVE_STATE = g._dbId ? "saving" : "memory";
  paintTagSave();
  saveGrantIfPersisted(g).then((res) => {
    TAG_SAVE_STATE = res || (g._dbId ? "saved" : "memory");
    paintTagSave();
  });
}

function tagFilters(g) {
  if (!state.tagFilters || typeof state.tagFilters.period === "string") state.tagFilters = {};
  if (!state.tagFilters[g.id]) state.tagFilters[g.id] = {
    q: "", period: "", periodFrom: "", periodTo: "", category: "", decision: "",
    needsOnly: true, warningsOnly: false, view: "grouped", sort: "period",
  };
  return state.tagFilters[g.id];
}

function draftFrom(r) {
  return {
    decision: !r.category ? "unreviewed" : r.category === "Ineligible" ? "excluded" : "eligible",
    category: r.category && r.category !== "Ineligible" ? r.category : "",
    eligible: r.eligible != null ? String(r.eligible) : "",
    note: r.note || "",
  };
}

/* The most recent decided line for the same account in an earlier period. */
function previousDecision(g, r) {
  return allStatementRows(g).map((p) => p.row)
    .filter((x) => x.account === r.account && !x.isRollup && x.id !== r.id
      && x.period < r.period && x.category)
    .sort((a, b) => b.period.localeCompare(a.period))[0] || null;
}

/* Attribution consequences of a tagging change. */
function overageNotices(g, keys) {
  const eligibleNow = eligibleByCategoryPeriod(g);
  const notices = [];
  keys.forEach((key) => {
    const [cat, period] = key.split("::");
    const attributed = attributedForPeriod(g, cat, period);
    const elig = eligibleNow[key] || 0;
    if (attributed > elig + 0.005) notices.push({
      cat, period,
      html: `<b>${esc(shortCatName(cat))} · ${esc(periodLabel(period))}</b> —
        ${Value.html({ value: attributed, format: "money", source: "derived" })} attributed but only
        ${Value.html({ value: elig, format: "money", source: "derived" })} tagged eligible:
        a ${Value.html({ value: attributed - elig, format: "money", source: "derived" })} overage.
        Attribution was <b>not</b> changed.`,
    });
  });
  return notices.length ? notices : null;
}

/* Commit one decision — the change, its undo, the save, and the
   consequence check all live here so no path can skip one. */
function commitRowDecision(g, r, next) {
  const before = { category: r.category, eligible: r.eligible, note: r.note ?? null };
  const keys = new Set();
  if (before.category && before.category !== "Ineligible") keys.add(before.category + "::" + r.period);
  if (next.category && next.category !== "Ineligible") keys.add(next.category + "::" + r.period);
  session.TAG_UNDO.push({ gid: g.id, undo: () => {
    r.category = before.category;
    r.eligible = before.eligible;
    if (before.note == null) delete r.note; else r.note = before.note;
    state.tagNotice = overageNotices(g, keys);
    saveAndTrack(g);
    bump();
  } });
  r.category = next.category;
  r.eligible = next.category && next.category !== "Ineligible" ? next.eligible : null;
  if (next.note) r.note = next.note; else delete r.note;
  saveAndTrack(g);
  state.tagNotice = overageNotices(g, keys);
}

export function renderTagging(g, body) {
  const pairs = allStatementRows(g);
  if (!pairs.length) {
    const empty = el(`<div class="empty"><h3>No statement lines yet</h3>
      <p>Add a cash flow statement first — its account-period lines appear here for review.</p>
      <button class="btn-secondary" type="button">Go to statements</button></div>`);
    $("button", empty).onclick = () => { state.actualsView = "list"; bump(); };
    body.appendChild(empty);
    return;
  }

  const f = tagFilters(g);
  if (state.tagFilterOverride) {
    Object.assign(f, state.tagFilterOverride);
    state.tagContextNote = state.tagFilterOverrideNote || null;
    state.tagFilterOverride = null;
    state.tagFilterOverrideNote = null;
  }
  const openGroups = state.tagOpenGroups || (state.tagOpenGroups = new Set());
  const cats = g.budgetCategories || [];
  const rows = pairs.map((p) => p.row);
  const stmtOf = new Map(pairs.map((p) => [p.row.id, p.stmt]));
  const decidable = rows.filter((r) => !r.isRollup);
  const refCount = rows.length - decidable.length;
  const undecided = decidable.filter(rowNeedsDecision).length;
  const reviewed = decidable.length - undecided;
  const eligibleTotal = Object.values(eligibleByCategoryPeriod(g)).reduce((s, v) => s + v, 0);
  const eligibleLines = decidable.filter((r) => r.category && r.category !== "Ineligible" && r.eligible != null).length;
  const excludedRows = decidable.filter((r) => r.category === "Ineligible");
  const excludedSrc = excludedRows.reduce((s, r) => s + rowSourceMag(r), 0);
  const warnCount = decidable.filter((r) => rowHardWarnings(r).length).length;
  const comp = preparerComparison(g);

  body.appendChild(el(`<header class="rl-head">
    <h2 class="rl-title">Review statement lines</h2>
    <p class="rl-instruction">Choose one decision per line. Only eligible amounts move forward to attribution.</p>
  </header>`));

  /* Reconciliation summary. */
  const strip = el(`<div class="rl-summary"></div>`);
  const cells = [
    { html: Value.html({ value: rows.length, source: "derived",
        sourceDetail: { note: "All imported account-period lines, including reference rows." } }),
      lab: "imported", tip: refCount ? `${decidable.length} decidable lines plus ${refCount} preparer reference line${refCount === 1 ? "" : "s"}.` : null },
    { html: Value.html({ value: reviewed, source: "derived" }), lab: "reviewed" },
    { html: Value.html({ value: undecided, source: "derived" }), lab: "to review", sev: undecided ? "warn" : "",
      click: undecided ? () => { f.needsOnly = true; f.warningsOnly = false; bump(); } : null },
    { html: Value.html({ value: eligibleTotal, format: "money", source: "derived",
        sourceDetail: { note: `Sum of the ${eligibleLines} line${eligibleLines === 1 ? "" : "s"} you marked eligible.` } }),
      lab: "eligible identified" },
    { html: Value.html({ value: excludedRows.length, source: "derived" }), lab: "excluded",
      tip: excludedRows.length ? `${money(excludedSrc)} of source lines deliberately excluded from the grant.` : null },
    { html: Value.html({ value: warnCount, source: "derived" }), lab: warnCount === 1 ? "warning" : "warnings", sev: warnCount ? "breach" : "",
      click: warnCount ? () => { f.warningsOnly = true; f.needsOnly = false; bump(); } : null },
  ];
  cells.forEach((c) => {
    const inner = `<span class="rl-sum-n ${c.sev || ""}">${c.html || esc(c.n)}</span><span class="rl-sum-lab">${esc(c.lab)}</span>`;
    const cell = c.click
      ? el(`<button type="button" class="rl-sum-cell rl-sum-btn">${inner}</button>`)
      : el(`<span class="rl-sum-cell">${inner}</span>`);
    if (c.tip) { cell.dataset.tip = c.tip; cell.dataset.tipsrc = "Scope"; }
    if (c.click) cell.onclick = c.click;
    strip.appendChild(cell);
  });
  body.appendChild(strip);
  if (comp && Math.abs(comp.mine - comp.ref) > 0.005) {
    const diff = comp.mine - comp.ref;
    body.appendChild(el(`<p class="rl-compare" data-tip="Compared only over the ${comp.pairs} category-period${comp.pairs === 1 ? "" : "s"} that have a categorised preparer rollup line — anything wider would compare unlike scopes." data-tipsrc="Preparer comparison">
      Preparer ${Value.html({ value: comp.ref, format: "money", source: "statement" })} · your eligible
      ${Value.html({ value: comp.mine, format: "money", source: "derived" })} ·
      <span class="rv-warn">difference ${diff > 0 ? "+" : "−"}${Value.html({
        value: Math.abs(diff), format: "money", source: "derived",
      })}</span></p>`));
  }

  /* Attribution-consequence notices from the last save. */
  if (state.tagNotice && state.tagNotice.length) {
    const box = el(`<div class="rl-notices" role="alert"></div>`);
    state.tagNotice.forEach((n) => {
      const row = el(`<div class="rl-notice">⚠ <span>${n.html}</span>
        <button type="button" class="btn-chip">Review in Attribute</button>
        <button type="button" class="rl-notice-x" aria-label="Dismiss warning">✕</button></div>`);
      $(".btn-chip", row).onclick = () =>
        openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: { category: n.cat, period: n.period } });
      $(".rl-notice-x", row).onclick = () => { state.tagNotice = state.tagNotice.filter((x) => x !== n); bump(); };
      box.appendChild(row);
    });
    body.appendChild(box);
  }

  /* ----- toolbar ----- */
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const hasPeriodRange = !!(f.periodFrom || f.periodTo);
  const periodRangeLabel = hasPeriodRange
    ? `${f.periodFrom ? periodLabel(f.periodFrom) : "Earliest"}–${f.periodTo ? periodLabel(f.periodTo) : "Latest"}`
    : "";
  const toolbar = el(`<div class="rl-toolbar">
    <div class="rl-tools">
      <input type="search" class="rl-q" placeholder="Search source account…" aria-label="Search by source account label" value="${esc(f.q)}" />
      <select class="rl-f-period" aria-label="Filter by period"><option value="">All periods</option>
        ${hasPeriodRange ? `<option value="__range">${esc(periodRangeLabel)}</option>` : ""}
        ${periods.map((p) => `<option value="${p}">${esc(periodLabel(p))}</option>`).join("")}</select>
      <select class="rl-f-decision" aria-label="Filter by decision state">
        <option value="">Any decision</option>
        <option value="unreviewed">Not reviewed</option>
        <option value="needs_amount">Needs amount</option>
        <option value="full">Eligible — full</option>
        <option value="partial">Eligible — partial</option>
        <option value="needs_note">Needs explanation</option>
        <option value="excluded">Excluded from grant</option>
        <option value="warning">Amount warning</option>
        <option value="rollup">Reference lines</option>
      </select>
      <select class="rl-f-category" aria-label="Filter by grant category"><option value="">All categories</option>
        ${cats.map((c) => `<option value="${esc(c.name)}">${esc(shortCatName(c.name))}</option>`).join("")}
        <option value="Ineligible">Excluded lines</option></select>
      <select class="rl-f-sort" aria-label="Sort lines">
        <option value="period">Sort · period</option>
        <option value="amount">Sort · source amount</option>
        <option value="eligible">Sort · eligible amount</option>
        <option value="status">Sort · decision status</option>
        <option value="account">Sort · account</option>
      </select>
    </div>
    <div class="rl-tools rl-tools-2">
      <button type="button" class="rl-chip rl-needs" aria-pressed="${f.needsOnly}">Needs decision</button>
      <button type="button" class="rl-chip rl-warns" aria-pressed="${f.warningsOnly}">Warnings only</button>
      <button type="button" class="rl-chip rl-grouped" aria-pressed="${f.view === "grouped"}">Grouped by account</button>
      <span class="rl-count" aria-live="polite"></span>
      <button type="button" class="btn-chip ghost rl-clear" hidden>Clear filters</button>
      <span id="tag-save" role="status" class="rl-save"></span>
    </div>
  </div>`);
  $(".rl-f-period", toolbar).value = hasPeriodRange ? "__range" : f.period;
  $(".rl-f-decision", toolbar).value = f.decision;
  $(".rl-f-category", toolbar).value = f.category;
  $(".rl-f-sort", toolbar).value = f.sort;
  body.appendChild(toolbar);

  if (state.tagContextNote) {
    const note = el(`<p class="rl-context">${esc(state.tagContextNote)}
      <button type="button" class="btn-chip ghost">Show everything</button></p>`);
    $("button", note).onclick = () => {
      state.tagContextNote = null;
      Object.assign(f, {
        period: "", periodFrom: "", periodTo: "",
        warningsOnly: false, needsOnly: false, decision: "",
      });
      bump();
    };
    body.appendChild(note);
  }

  const scroll = el(`<div class="rl-scroll"></div>`);
  body.appendChild(scroll);
  body.appendChild(el(`<p class="rl-kbdhint">Enter opens a line · Esc closes the editor · ⌘Z undoes the last saved decision</p>`));

  const decisionMatches = (r, v) => {
    if (!v) return true;
    const st = rowStatus(r);
    return v === "needs_note" ? !!st.needsNote : st.key === v;
  };
  // The line being edited is always visible.
  const rowVisible = (r) =>
    (state.tagEditor && state.tagEditor.id === r.id) || (
    (!f.q || r.account.toLowerCase().includes(f.q.trim().toLowerCase())) &&
    (!f.period || r.period === f.period) &&
    (!f.periodFrom || String(r.period).slice(0, 7) >= f.periodFrom) &&
    (!f.periodTo || String(r.period).slice(0, 7) <= f.periodTo) &&
    (!f.category || r.category === f.category) &&
    (!f.decision || decisionMatches(r, f.decision)) &&
    (!f.needsOnly || rowNeedsDecision(r)) &&
    (!f.warningsOnly || rowHardWarnings(r).length > 0));

  const STATUS_ORDER = { warning: 0, needs_amount: 1, unreviewed: 2, partial: 3, full: 4, excluded: 5, rollup: 6 };
  const SORTS = {
    period: (a, b) => a.period.localeCompare(b.period) || a.account.localeCompare(b.account),
    amount: (a, b) => rowSourceMag(b) - rowSourceMag(a),
    eligible: (a, b) => (b.eligible || 0) - (a.eligible || 0),
    status: (a, b) => STATUS_ORDER[rowStatus(a).key] - STATUS_ORDER[rowStatus(b).key] || a.period.localeCompare(b.period),
    account: (a, b) => a.account.localeCompare(b.account) || a.period.localeCompare(b.period),
  };

  const filtersOn = () => !!(f.q || f.period || f.periodFrom || f.periodTo
    || f.category || f.decision || f.needsOnly || f.warningsOnly);

  /* Repaints the table region only — filter keystrokes must never rebuild
     the toolbar out from under the focused search box. */
  function paint() {
    const grouped = f.view === "grouped";
    const sorter = SORTS[f.sort] || SORTS.period;
    const shown = rows.filter(rowVisible).sort(sorter);
    scroll.innerHTML = "";

    $(".rl-count", toolbar).innerHTML = `Showing ${Value.html({ value: shown.length, source: "derived" })}
      of ${Value.html({ value: rows.length, source: "derived" })} lines`;
    $(".rl-clear", toolbar).hidden = !filtersOn();
    paintTagSave();

    if (!shown.length) {
      if (f.needsOnly && !undecided && !f.q && !f.period && !f.periodFrom && !f.periodTo
        && !f.category && !f.decision) {
        const done = el(`<div class="empty"><h3>All lines reviewed ✓</h3>
          <p>Every account-period line has a decision. Continue to Attribute, or show all lines to revisit one.</p>
          <button type="button" class="btn-secondary">Show all lines</button></div>`);
        $("button", done).onclick = () => { f.needsOnly = false; syncChips(); paint(); };
        scroll.appendChild(done);
      } else {
        const none = el(`<div class="empty"><h3>No lines match the current filters</h3>
          <button type="button" class="btn-secondary">Clear filters</button></div>`);
        $("button", none).onclick = clearFilters;
        scroll.appendChild(none);
      }
      return;
    }

    const table = document.createElement("table");
    table.className = "rl-table";
    const cols = grouped ? 6 : 7;
    table.innerHTML = `<thead><tr>
      ${grouped ? "" : `<th scope="col">Source account</th>`}
      <th scope="col">Period</th>
      <th scope="col" class="num">Source amount</th>
      <th scope="col">Decision</th>
      <th scope="col">Grant category</th>
      <th scope="col" class="num">Eligible</th>
      <th scope="col"><span class="vis-hidden">Review</span></th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    const orderedIds = [];
    function appendLine(r) {
      orderedIds.push(r.id);
      const st = rowStatus(r);
      const stmt = stmtOf.get(r.id);
      const sourceDetail = {
        account: r.account,
        filename: stmt?.filename,
        period: periodLabel(r.period),
      };
      const open = state.tagEditor && state.tagEditor.id === r.id;
      const glyph = st.sev === "breach" || st.sev === "warn" ? "⚠ " : "";
      const hasNote = r.note && !st.needsNote;
      const tr = el(`<tr class="rl-row st-${st.key} ${open ? "open" : ""}" data-id="${esc(r.id)}">
        ${grouped ? "" : `<td class="rl-acct" title="${esc(r.account)}">${esc(r.account)}</td>`}
        <td class="rl-period">${Value.html({ value: r.period, format: periodLabel, source: "statement", sourceDetail })}</td>
        <td class="num rl-amt">${Value.html({ value: r.amount, format: "money", source: "statement", sourceDetail })}</td>
        <td class="rl-dec"><span class="rl-st sev-${st.sev || "none"}">${glyph}${esc(st.label)}</span>
          ${st.needsNote ? `<span class="rl-neednote">needs explanation</span>` : ""}
          ${hasNote ? `<span class="rl-notedot" data-tip="${esc(r.note)}" data-tipsrc="Her note" aria-label="Note recorded"></span>` : ""}</td>
        <td class="rl-cat">${r.category && r.category !== "Ineligible"
          ? `<span title="${esc(r.category)}">${esc(shortCatName(r.category))}</span>` : ""}</td>
        <td class="num rl-elig">${
          st.key === "rollup" ? `<span class="rl-notset" data-tip="Reference only — never counted in totals." data-tipsrc="Preparer's rollup">reference</span>`
          : st.key === "excluded" ? `<span class="rl-zero">${Value.html({ value: 0, format: "money", source: "manual",
              sourceDetail: { note: "Explicitly excluded from this grant." } })}</span>`
          : r.eligible != null ? Value.html({ value: r.eligible, format: "money", source: "manual",
              sourceDetail: { note: "Eligible amount saved in the line decision." } })
          : st.key === "needs_amount" ? `<span class="rl-warntext">enter amount</span>`
          : `<span class="rl-notset">not set</span>`}</td>
        <td class="rl-act"><button type="button" class="rl-chev" aria-expanded="${open}"
          aria-label="Review ${esc(r.account)}, ${esc(periodLabel(r.period))}">${open ? "▾" : "▸"}</button></td>
      </tr>`);
      $(".rl-chev", tr).onclick = (e) => { e.stopPropagation(); toggleEditor(r); };
      tr.onclick = (e) => { if (!e.target.closest("button, a, input, select, textarea")) toggleEditor(r); };
      tr.tabIndex = 0;
      tr.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === tr) {
          e.preventDefault();
          toggleEditor(r);
        }
      });
      tbody.appendChild(tr);
      if (open) tbody.appendChild(editorRow(r, cols));
    }

    if (grouped) {
      const groupMap = new Map();
      shown.forEach((r) => {
        const k = r.account + " " + (r.section || "");
        if (!groupMap.has(k)) groupMap.set(k, { key: g.id + " " + k, account: r.account, section: r.section, rows: [] });
        groupMap.get(k).rows.push(r);
      });
      const allByKey = new Map();
      rows.forEach((r) => {
        const k = r.account + " " + (r.section || "");
        if (!allByKey.has(k)) allByKey.set(k, []);
        allByKey.get(k).push(r);
      });
      const groups = [...groupMap.values()];
      groups.forEach((grp) => {
        const all = allByKey.get(grp.account + " " + (grp.section || "")) || grp.rows;
        grp.decidable = all.filter((r) => !r.isRollup);
        grp.srcTotal = all.reduce((s, r) => s + rowSourceMag(r), 0);
        grp.eligTotal = all.reduce((s, r) => s + (!r.isRollup && r.category && r.category !== "Ineligible" && r.eligible != null ? r.eligible : 0), 0);
        grp.undecided = grp.decidable.filter(rowNeedsDecision).length;
      });
      groups.sort((a, b) => b.srcTotal - a.srcTotal);

      groups.forEach((grp) => {
        const complete = grp.decidable.length > 0 && grp.undecided === 0;
        const editingHere = state.tagEditor && grp.rows.some((r) => r.id === state.tagEditor.id);
        const collapsed = complete && !openGroups.has(grp.key) && !editingHere;
        const progress = grp.decidable.length === 0
          ? "reference only"
          : complete ? "✓ all reviewed"
          : `${Value.html({ value: grp.decidable.length - grp.undecided, source: "derived" })}
            of ${Value.html({ value: grp.decidable.length, source: "derived" })} reviewed`;
        const progressHtml = complete || grp.decidable.length === 0 ? esc(progress) : progress;
        const header = el(`<tr class="rl-group ${complete ? "complete" : ""}">
          <td colspan="${cols}"><div class="rl-group-in">
            <span class="rl-gchev" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>
            <span class="rl-gname" title="${esc(grp.account)}">${esc(grp.account)}</span>
            ${grp.section ? `<span class="rl-gsection" data-tip="The statement's own section heading for this account." data-tipsrc="Source classification">${esc(grp.section)}</span>` : ""}
            <span class="rl-gprogress ${complete ? "ok" : ""}">${progressHtml}</span>
            <span class="rl-gfigs">${Value.html({ value: grp.srcTotal, format: "money", source: "statement",
              sourceDetail: { account: grp.account } })} source${grp.eligTotal > 0
                ? ` · ${Value.html({ value: grp.eligTotal, format: "money", source: "derived" })} eligible` : ""}</span>
          </div></td></tr>`);
        if (complete) {
          header.tabIndex = 0;
          header.setAttribute("role", "button");
          header.setAttribute("aria-expanded", String(!collapsed));
          onActivate(header, () => {
            if (openGroups.has(grp.key)) openGroups.delete(grp.key); else openGroups.add(grp.key);
            paint();
          });
        }
        tbody.appendChild(header);
        if (!collapsed) grp.rows.forEach(appendLine);
      });
    } else {
      shown.forEach(appendLine);
    }

    scroll.appendChild(table);
    state.tagOrder = orderedIds;

    if (TAG_EDITOR_FOCUS) {
      TAG_EDITOR_FOCUS = false;
      const first = $(".rl-editor-tr .ed-decision input", scroll);
      if (first) first.focus();
    }
  }

  /* ----- the decision editor, inline under its line ----- */
  function toggleEditor(r) {
    const ed = state.tagEditor;
    if (ed && ed.id === r.id) { attemptClose(); return; }
    if (ed && ed.dirty && !confirm("Discard unsaved changes to the open line?")) return;
    state.tagEditor = { id: r.id, draft: draftFrom(r), dirty: false };
    paint();
  }
  function attemptClose() {
    const ed = state.tagEditor;
    if (ed && ed.dirty && !confirm("Discard unsaved changes to this line?")) return;
    state.tagEditor = null;
    paint();
  }

  function editorRow(r, cols) {
    const ed = state.tagEditor;
    const draft = ed.draft;
    const stmt = stmtOf.get(r.id);
    const src = rowSourceMag(r);
    const order = state.tagOrder || [];
    const idx = order.indexOf(r.id);
    const tr = el(`<tr class="rl-editor-tr"><td colspan="${cols}"></td></tr>`);
    const box = el(`<div class="rl-editor"></div>`);
    tr.firstElementChild.appendChild(box);

    /* -- source facts, verbatim -- */
    const refHere = draft.category ? rollupReference(g, draft.category, r.period) : null;
    box.appendChild(el(`<div class="ed-source">
      <h4 class="ed-acct">${esc(r.account)}</h4>
      <p class="ed-srcmeta">${r.section ? esc(r.section) + " · " : ""}${Value.html({
        value: r.period, format: periodLabel, source: "statement",
        sourceDetail: { account: r.account, filename: stmt?.filename },
      })} · monthly account total</p>
      <p class="ed-srcamt">${Value.html({ value: r.amount, format: "money", source: "statement",
        sourceDetail: { account: r.account, filename: stmt?.filename, period: periodLabel(r.period) },
      })}<span class="ed-srclab">source amount</span></p>
      <p class="ed-srcfile">${esc(stmt ? stmt.filename : "statement")}${stmt && stmt.sheet ? ` · sheet “${esc(stmt.sheet)}”` : ""}</p>
      ${refHere != null ? `<p class="ed-ref" data-tip="A rollup line the preparer computed themselves, tagged to this category — a reference beside your figure, never part of it." data-tipsrc="Preparer's figure">Preparer's figure for ${esc(shortCatName(draft.category))} · ${esc(periodLabel(r.period))}: <b>${Value.html({
        value: refHere, format: "money", source: "statement", sourceDetail: { filename: stmt?.filename },
      })}</b></p>` : ""}
    </div>`));

    const form = el(`<div class="ed-form"></div>`);
    box.appendChild(form);

    if (r.isRollup) {
      form.appendChild(el(`<p class="ed-rollup-note">This is the preparer's own pre-computed rollup — a reference figure, never counted in your totals. Assign it a grant category so it can sit beside your eligible figure for comparison.</p>`));
      const catRow = el(`<label class="ed-field">Grant category for comparison
        <select class="ed-cat"><option value="">— none —</option>
          ${cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}</select></label>`);
      $("select", catRow).value = r.category && r.category !== "Ineligible" ? r.category : "";
      form.appendChild(catRow);
      const actions = el(`<div class="ed-actions">
        <button type="button" class="btn-primary ed-save">Save</button>
        <button type="button" class="btn-chip ghost ed-cancel">Close</button></div>`);
      $(".ed-save", actions).onclick = () => {
        commitRowDecision(g, r, { category: $("select", catRow).value || null, eligible: null, note: "" });
        state.tagEditor = null;
        bumpKeepScroll();
      };
      $(".ed-cancel", actions).onclick = attemptClose;
      form.appendChild(actions);
      tr.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); attemptClose(); } });
      return tr;
    }

    /* -- her decision, three explicit choices -- */
    const decFs = el(`<fieldset class="ed-decision">
      <legend>Decision for this line</legend>
      <label><input type="radio" name="dec_${esc(r.id)}" value="eligible" /> Eligible</label>
      <label><input type="radio" name="dec_${esc(r.id)}" value="excluded" /> Excluded</label>
      <label><input type="radio" name="dec_${esc(r.id)}" value="unreviewed" /> Not reviewed</label>
    </fieldset>`);
    $$(`input[name="dec_${r.id}"]`, decFs).forEach((radio) => {
      radio.checked = radio.value === draft.decision;
      radio.onchange = () => { draft.decision = radio.value; ed.dirty = true; paintMode(); };
    });
    form.appendChild(decFs);

    /* -- eligible branch -- */
    const eligBox = el(`<div class="ed-eligible">
      <div class="ed-fieldrow">
        <label class="ed-field">Grant category
          <select class="ed-cat">
            <option value="">— choose a category —</option>
            ${cats.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.total === 0 ? " ($0 ceiling)" : ""}</option>`).join("")}
          </select></label>
        <label class="ed-field">Eligible amount
          <input class="ed-amt" type="text" inputmode="decimal" autocomplete="off"
            aria-describedby="ed-arith-${esc(r.id)}" /></label>
        <button type="button" class="btn-chip ed-full">Use full source amount (${Value.html({
          value: src, format: "money", source: "statement",
          sourceDetail: { account: r.account, filename: stmt?.filename, period: periodLabel(r.period) },
        })})</button>
      </div>
      <p class="ed-arith" id="ed-arith-${esc(r.id)}"></p>
      <label class="ed-field ed-notefield">Why this amount? <span class="ed-optional">kept with the line</span>
        <textarea class="ed-note" rows="2"></textarea></label>
    </div>`);
    const catSel = $(".ed-cat", eligBox), amtIn = $(".ed-amt", eligBox), noteIn = $(".ed-note", eligBox), arith = $(".ed-arith", eligBox);
    catSel.value = draft.category;
    amtIn.value = draft.eligible;
    noteIn.value = draft.note;
    catSel.onchange = () => { draft.category = catSel.value; ed.dirty = true; paintArith(); };
    amtIn.addEventListener("input", () => { draft.eligible = amtIn.value; ed.dirty = true; paintArith(); });
    noteIn.addEventListener("input", () => {
      draft.note = noteIn.value;
      ed.dirty = true;
      if (draft.decision === "eligible") paintArith();
    });
    $(".ed-full", eligBox).onclick = () => { draft.eligible = String(src); amtIn.value = String(src); ed.dirty = true; paintArith(); };
    form.appendChild(eligBox);

    /* -- excluded branch -- */
    const exclBox = el(`<div class="ed-excluded">
      <p class="ed-excl-note">Records a completed exclusion with eligible amount <b>${Value.html({
        value: 0, format: "money", source: "manual", sourceDetail: { note: "Explicit exclusion decision." },
      })}</b>. It is not treated as missing work.</p>
      <label class="ed-field ed-notefield">Reason <span class="ed-optional">optional, kept with the line</span>
        <textarea class="ed-note-excl" rows="2"></textarea></label>
    </div>`);
    $(".ed-note-excl", exclBox).value = draft.note;
    $(".ed-note-excl", exclBox).addEventListener("input", (e) => { draft.note = e.target.value; ed.dirty = true; });
    form.appendChild(exclBox);

    /* -- not-reviewed branch -- */
    const unrevBox = el(`<p class="ed-unrev-note">Leaves the line undecided. It stays in the needs-decision queue and is never treated as zero.</p>`);
    form.appendChild(unrevBox);

    function paintArith() {
      const v = parseAmt(draft.eligible);
      arith.className = "ed-arith";
      if (draft.eligible.trim() !== "" && v == null) {
        arith.classList.add("breach");
        arith.textContent = "Couldn't read that as a dollar amount.";
        amtIn.setAttribute("aria-invalid", "true");
        syncSaveState();
        return;
      }
      amtIn.removeAttribute("aria-invalid");
      if (v == null) {
        arith.textContent = "Enter an amount to complete this decision.";
        syncSaveState();
        return;
      }
      if (v < 0) {
        arith.classList.add("breach");
        arith.textContent = "The eligible amount cannot be negative.";
        syncSaveState();
        return;
      }
      if (v > src + 0.005) {
        arith.classList.add("breach");
        arith.innerHTML = `Source ${Value.html({ value: src, format: "money", source: "statement",
          sourceDetail: { account: r.account, filename: stmt?.filename, period: periodLabel(r.period) },
        })} · eligible ${Value.html({ value: v, format: "money", source: "manual" })} ·
          <b>${Value.html({ value: v - src, format: "money", source: "derived" })} over source</b>.
          You can save it, but it remains flagged.`;
        syncSaveState();
        return;
      }
      if (Math.abs(v - src) < 0.005) {
        arith.innerHTML = `${Value.html({ value: v, format: "money", source: "manual" })} eligible · full source amount`;
        syncSaveState();
        return;
      }
      arith.innerHTML = `${Value.html({ value: v, format: "money", source: "manual" })} eligible ·
        ${Value.html({ value: src - v, format: "money", source: "derived" })} not claimed${
          draft.note.trim() ? "" : ` · <span class="warn-ink">add an explanation</span>`}`;
      syncSaveState();
    }

    function paintMode() {
      eligBox.hidden = draft.decision !== "eligible";
      exclBox.hidden = draft.decision !== "excluded";
      unrevBox.hidden = draft.decision !== "unreviewed";
      if (draft.decision === "eligible") paintArith();
      else syncSaveState();
    }

    /* -- previous decision for this account, reference only -- */
    const prev = previousDecision(g, r);
    if (prev) {
      const prevText = prev.category === "Ineligible"
        ? "Excluded from grant"
        : `${esc(shortCatName(prev.category))} · ${prev.eligible != null
          ? `${Value.html({ value: prev.eligible, format: "money", source: "manual" })} of ${Value.html({
              value: rowSourceMag(prev), format: "money", source: "statement",
            })} eligible` : "no amount recorded"}`;
      const block = el(`<div class="ed-prev">
        <span>Previous decision for ${esc(r.account)} — ${esc(periodLabel(prev.period))}: <b>${prevText}</b></span>
        <button type="button" class="btn-chip">Use as starting point</button>
        <p class="ed-prev-note">A starting point only — this period is still yours to review.</p>
      </div>`);
      $("button", block).onclick = () => {
        draft.decision = prev.category === "Ineligible" ? "excluded" : "eligible";
        draft.category = prev.category !== "Ineligible" ? prev.category : "";
        draft.eligible = prev.eligible != null ? String(prev.eligible) : "";
        draft.note = prev.note || "";
        ed.dirty = true;
        catSel.value = draft.category; amtIn.value = draft.eligible; noteIn.value = draft.note;
        $$(`input[name="dec_${r.id}"]`, decFs).forEach((x) => { x.checked = x.value === draft.decision; });
        paintMode();
      };
      form.appendChild(block);
    }

    /* -- attribution already resting on this category-period -- */
    const attrOn = draft.category ? attributedForPeriod(g, draft.category, r.period) : 0;
    if (attrOn > 0) form.appendChild(el(`<p class="ed-attrhint">⚠ ${Value.html({
      value: attrOn, format: "money", source: "derived",
    })} is already attributed to milestones from ${esc(shortCatName(draft.category))} · ${esc(periodLabel(r.period))}. Changing eligibility can create an attribution overage — it will be flagged, never silently altered.</p>`));

    /* -- actions -- */
    const actions = el(`<div class="ed-actions">
      <button type="button" class="btn-primary ed-savenext">Save &amp; review next</button>
      <button type="button" class="btn-chip ed-save">Save</button>
      <button type="button" class="btn-chip ghost ed-cancel">Cancel</button>
      <span class="ed-progress">${idx >= 0 ? `Line ${Value.html({ value: idx + 1, source: "derived" })}
        of ${Value.html({ value: order.length, source: "derived" })} in this view` : ""}</span>
      <span class="ed-nav">
        <button type="button" class="btn-chip ed-prevline" aria-label="Previous line" ${idx <= 0 ? "disabled" : ""}>‹</button>
        <button type="button" class="btn-chip ed-nextline" aria-label="Next line" ${idx >= order.length - 1 ? "disabled" : ""}>›</button>
      </span>
    </div>`);
    function buildNext() {
      return {
        category: draft.decision === "eligible" ? (draft.category || null)
          : draft.decision === "excluded" ? "Ineligible" : null,
        eligible: draft.decision === "eligible" ? parseAmt(draft.eligible) : null,
        note: draft.note.trim(),
      };
    }
    function syncSaveState() {
      const amount = parseAmt(draft.eligible);
      const blocked = draft.decision === "eligible"
        && (!draft.category || amount == null || amount < 0);
      [$(".ed-savenext", actions), $(".ed-save", actions)].forEach((button) => {
        button.disabled = blocked;
        button.title = blocked ? "Choose a category and enter a valid eligible amount." : "";
      });
    }
    function save(goNext) {
      const amount = parseAmt(draft.eligible);
      if (draft.decision === "eligible" && !draft.category) {
        catSel.focus();
        return;
      }
      if (draft.decision === "eligible" && (amount == null || amount < 0)) {
        amtIn.focus();
        return;
      }
      commitRowDecision(g, r, buildNext());
      if (goNext) {
        const after = order.slice(idx + 1)
          .map((id) => rows.find((x) => x.id === id))
          .find((x) => x && rowNeedsDecision(x));
        state.tagEditor = after ? { id: after.id, draft: draftFrom(after), dirty: false } : null;
        if (after) TAG_EDITOR_FOCUS = true;
      } else {
        state.tagEditor = { id: r.id, draft: draftFrom(r), dirty: false };
      }
      bumpKeepScroll();
    }
    $(".ed-savenext", actions).onclick = () => save(true);
    $(".ed-save", actions).onclick = () => save(false);
    $(".ed-cancel", actions).onclick = attemptClose;
    const jump = (id) => {
      if (ed.dirty && !confirm("Discard unsaved changes to this line?")) return;
      const target = rows.find((x) => x.id === id);
      state.tagEditor = target ? { id, draft: draftFrom(target), dirty: false } : null;
      paint();
    };
    $(".ed-prevline", actions).onclick = () => { if (idx > 0) jump(order[idx - 1]); };
    $(".ed-nextline", actions).onclick = () => { if (idx < order.length - 1) jump(order[idx + 1]); };
    form.appendChild(actions);
    paintMode();

    amtIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(true); } });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); attemptClose(); }
    });
    return tr;
  }

  function clearFilters() {
    Object.assign(f, {
      q: "", period: "", periodFrom: "", periodTo: "",
      category: "", decision: "", needsOnly: false, warningsOnly: false,
    });
    state.tagContextNote = null;
    $(".rl-q", toolbar).value = "";
    $(".rl-f-period", toolbar).value = "";
    $(".rl-f-decision", toolbar).value = "";
    $(".rl-f-category", toolbar).value = "";
    syncChips();
    paint();
  }
  function syncChips() {
    $(".rl-needs", toolbar).setAttribute("aria-pressed", String(f.needsOnly));
    $(".rl-warns", toolbar).setAttribute("aria-pressed", String(f.warningsOnly));
    $(".rl-grouped", toolbar).setAttribute("aria-pressed", String(f.view === "grouped"));
  }
  $(".rl-q", toolbar).addEventListener("input", (e) => { f.q = e.target.value; paint(); });
  $(".rl-f-period", toolbar).onchange = (e) => {
    if (e.target.value === "__range") return;
    f.period = e.target.value;
    f.periodFrom = "";
    f.periodTo = "";
    state.tagContextNote = null;
    paint();
  };
  $(".rl-f-decision", toolbar).onchange = (e) => { f.decision = e.target.value; if (e.target.value) { f.needsOnly = false; f.warningsOnly = false; syncChips(); } paint(); };
  $(".rl-f-category", toolbar).onchange = (e) => { f.category = e.target.value; paint(); };
  $(".rl-f-sort", toolbar).onchange = (e) => { f.sort = e.target.value; paint(); };
  $(".rl-needs", toolbar).onclick = () => { f.needsOnly = !f.needsOnly; if (f.needsOnly) f.warningsOnly = false; syncChips(); paint(); };
  $(".rl-warns", toolbar).onclick = () => { f.warningsOnly = !f.warningsOnly; if (f.warningsOnly) f.needsOnly = false; syncChips(); paint(); };
  $(".rl-grouped", toolbar).onclick = () => { f.view = f.view === "grouped" ? "flat" : "grouped"; syncChips(); paint(); };
  $(".rl-clear", toolbar).onclick = clearFilters;

  paint();
}
