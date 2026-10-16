/* Editable milestone-by-category plan with live reconciliation. */

import { money, esc, valueHtml } from "@gf-ui";
import { saveGrantIfPersisted } from "../api.js";
import { $, $$, el, onActivate } from "../lib/dom.js";
import { shortCatName, periodLabel } from "../lib/format.js";
import {
  categoryActual, categoryFunnel, cellActual, cellActualTrace, cellPlanned,
  colAllocated, grandAllocated, marginForce, rowAllocated, setCellPlanned,
} from "../lib/funnel.js";
import { openGrant, session } from "../store.js";

function goToReviewRange(g, m, c) {
  const end = m.plannedAchievementDate ? m.plannedAchievementDate.slice(0, 7) : "";
  const start = m.startDate ? m.startDate.slice(0, 7) : end;
  openGrant(g.id, "actuals", {
    actualsView: "tag",
    tagFilterOverride: {
      q: "", period: "", periodFrom: start, periodTo: end,
      category: "", decision: "", needsOnly: false, warningsOnly: false,
    },
    tagContextNote: null,
    tagFilterOverrideNote: null,
  });
}

/* One cell's actual: attributed from tagged statement rows plus anything
   entered directly. */
function paintActualLine(g, m, c, td) {
  const a = cellActual(g, m.number, c.name);
  const node = document.createElement("div");
  node.className = "ac-actual-row";
  if (a && (a.attributed > 0 || a.entered > 0)) {
    node.classList.add("filled");
    const span = document.createElement("span");
    span.className = "ac-actual ac-linked";
    span.innerHTML = valueHtml({
      value: a.attributed + a.entered,
      format: "money",
      source: "derived",
      sourceDetail: { note: "Recognised from statement amounts attributed to this milestone and category." },
    });
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    const trace = cellActualTrace(g, m.number, c.name);
    const shown = trace.slice(0, 6).map((t) => `${periodLabel(t.period)} ${money(t.amount)}`);
    if (trace.length > 6) shown.push(`+${trace.length - 6} more period${trace.length - 6 === 1 ? "" : "s"}`);
    if (a.entered > 0) shown.push(`legacy direct entry ${money(a.entered)}`);
    span.dataset.tip = shown.join(" · ") + ". Click to review or tag more.";
    span.dataset.tipsrc = "Actual · attributed from statement rows";
    onActivate(span, () => goToReviewRange(g, m, c));
    node.appendChild(span);
    td.appendChild(node);
    return;
  }
  const tagLink = document.createElement("button");
  tagLink.type = "button";
  tagLink.className = "ac-tag-link";
  tagLink.textContent = "Tag →";
  tagLink.dataset.tip = "Review statement rows within this milestone's date range.";
  tagLink.dataset.tipsrc = "Actual";
  tagLink.onclick = () => goToReviewRange(g, m, c);
  node.appendChild(tagLink);
  td.appendChild(node);
}

export function renderExpenditure(g, body) {
  if (!g.allocations) g.allocations = {};
  const EXP_UNDO = session.EXP_UNDO;
  EXP_UNDO.length = 0;

  const cats = g.budgetCategories || [];
  const mss = g.milestones || [];
  const isOpenCol = (colIdx) => cats[colIdx].total !== 0;
  const anyRowBudgets = mss.some((m) => m.estimatedCost != null);

  let totalActual = 0, totalUnassigned = 0;
  cats.forEach((c) => {
    totalActual += categoryActual(g, c.name);
    totalUnassigned += categoryFunnel(g, c.name).awaiting;
  });

  const headline = el(`<div class="alloc-headline"></div>`);
  let grandTotalTd = null;
  function paintHeadline(override) {
    const allocated = grandAllocated(g, override);
    const total = g.grant.totalProjectCost;
    headline.innerHTML = `
      <span><small>Project budget</small><b>${valueHtml({
        value: total, format: "money", source: "derived",
        sourceDetail: { note: "Sum of the agreement's category funding limits." },
        missing: { reason: "No supported project budget is available." },
      })}</b></span>
      <span><small>Planned</small><b>${valueHtml({
        value: allocated, format: "money", source: "derived",
        sourceDetail: { note: "Sum of planned milestone-category allocations." },
      })}</b></span>
      <span><small>Recognised actual</small><b>${valueHtml({
        value: totalActual, format: "money", source: "derived",
        sourceDetail: { note: "Statement amounts already assigned to milestones." },
      })}</b></span>
      <span><small>${total == null || total - allocated >= 0 ? "Available to plan" : "Plan over budget"}</small><b>${
        valueHtml({
          value: total == null ? null : total - allocated, format: "money", source: "derived",
          sourceDetail: { note: "Project budget less planned allocations." },
          missing: { reason: "Available cash cannot be calculated without a project budget." },
        })
      }</b></span>
      ${totalUnassigned > 0 ? `<span><small>Eligible, not placed</small><b>${valueHtml({
        value: totalUnassigned, format: "money", source: "derived",
        sourceDetail: { note: "Tagged eligible statement amounts not yet assigned to a milestone." },
      })}</b></span>` : ""}`;
    if (grandTotalTd) grandTotalTd.innerHTML = valueHtml({
      value: allocated, format: "money", source: "derived",
      sourceDetail: { note: "Sum of planned milestone-category allocations." },
    });
  }
  paintHeadline();
  body.appendChild(headline);

  /* The two silent failure modes, made loud. */
  {
    const warnings = [];
    cats.forEach((c) => {
      const funnel = categoryFunnel(g, c.name);
      funnel.overPeriods.forEach(({ period, over }) => warnings.push({
        kind: "double",
        html: `<b>${esc(shortCatName(c.name))} · ${esc(periodLabel(period))}</b> — ${valueHtml({
          value: over, format: "money", source: "derived",
          sourceDetail: { note: "Attributed actual less tagged eligible amount for this category and period." },
        })} attributed twice.`,
        filter: { category: c.name, period },
      }));
      const actual = categoryActual(g, c.name);
      if (c.total != null && c.total !== 0 && actual > c.total) warnings.push({
        kind: "ceiling",
        html: `<b>${esc(shortCatName(c.name))}</b> — ${valueHtml({
          value: actual, format: "money", source: "derived",
          sourceDetail: { note: "Recognised actual from attributed statement amounts." },
        })} recognised exceeds the contractual ${valueHtml({
          value: c.total, format: "money", source: "agreement",
        })} ceiling by ${valueHtml({
          value: actual - c.total, format: "money", source: "derived",
          sourceDetail: { note: "Recognised actual less the contractual category limit." },
        })}.`,
        filter: { category: c.name },
      });
    });
    if (warnings.length) {
      const box = el(`<div class="alloc-warnings"></div>`);
      warnings.forEach((w) => {
        const row = el(`<button type="button" class="alloc-warning ${w.kind}">⚠ <span>${w.html}</span><span class="go">Review →</span></button>`);
        onActivate(row, () => openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: w.filter }));
        box.appendChild(row);
      });
      body.appendChild(box);
    }
  }

  if (!anyRowBudgets) body.appendChild(el(`<p class="alloc-note">
    Milestone estimates aren't available for this grant — the Budget column reflects category ceilings only.</p>`));
  else body.appendChild(el(`<p class="alloc-note">
    Each cell shows <b>PLAN</b> above <b>ACTUAL</b>. Select a plan to edit; select an actual to review that milestone's transaction dates.</p>`));

  const scroll = el(`<div class="alloc-scroll"></div>`);
  const table = document.createElement("table");
  table.className = "alloc-grid";
  scroll.appendChild(table);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(el(`<th class="gutter">§9</th>`));
  headRow.appendChild(el(`<th class="title">Milestone</th>`));
  const catHeadCells = cats.map((c, index) => {
    const th = el(`<th class="cat"><span>${esc(shortCatName(c.name))}</span><small>${
      c.total == null ? "limit unavailable" : c.total === 0 ? "closed" : `${valueHtml({
        value: c.total, format: "money", source: "agreement",
      })} limit`
    }</small></th>`);
    if (c.total === 0) {
      th.classList.add("unavail");
      th.dataset.tip = "Closed — the funding agreement provides no budget for this category.";
    } else {
      const strength = Math.max(5, 13 - index * 2);
      th.style.background = `color-mix(in oklch, var(--brand) ${strength}%, var(--card))`;
      th.dataset.tip = `${money(c.total)} contractual category limit.`;
      th.dataset.tipsrc = "Funding agreement";
    }
    headRow.appendChild(th);
    return th;
  });
  headRow.appendChild(el(`<th class="sep">Milestone<br />plan</th>`));
  headRow.appendChild(el(`<th>Milestone<br />limit</th>`));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  const cellRefs = [];
  const rowTotalEls = [];

  function paintRowTotal(rowIdx, override) {
    const m = mss[rowIdx];
    const total = rowAllocated(g, m, override);
    const td = rowTotalEls[rowIdx];
    const budget = m.estimatedCost;
    const over = budget != null && total > budget;
    td.classList.remove("breach", "warn");
    const totalHtml = valueHtml({
      value: total, format: "money", source: "derived",
      sourceDetail: { note: "Sum of planned category allocations for this milestone." },
    });
    if (!over) { td.innerHTML = totalHtml; return; }
    const force = marginForce(m.estimatedCostSource);
    td.classList.add(force === "contractual" ? "breach" : "warn");
    const overHtml = valueHtml({
      value: total - budget, format: "money", source: "derived",
      sourceDetail: { note: "Planned row total less the milestone margin." },
    });
    td.innerHTML = `${totalHtml}<span class="delta">${force === "contractual" ? `over ceiling by ${overHtml}` : `+${overHtml} over estimate`}</span>`;
  }

  function wireCell(m, c, rowIdx, colIdx) {
    const span = document.createElement("span");
    span.className = "ac-input";
    span.contentEditable = "true";
    span.spellcheck = false;
    span.tabIndex = 0;

    function refresh() {
      const v = cellPlanned(g, m.number, c.name);
      span.classList.toggle("filled", v != null);
      span.innerHTML = v == null ? "" : valueHtml({
        value: v, format: "money", source: "manual",
        sourceDetail: { note: "Your planned allocation for this milestone and category." },
      });
    }
    refresh();

    function commit() {
      const before = cellPlanned(g, m.number, c.name);
      const raw = span.textContent.trim();
      let next;
      if (raw === "") next = null;
      else { const n = parseFloat(raw.replace(/[^0-9.-]/g, "")); next = isNaN(n) ? before : n; }
      if (next === before) { refresh(); paintRowTotal(rowIdx); paintColFooter(colIdx); paintHeadline(); return; }
      setCellPlanned(g, m.number, c.name, next);
      EXP_UNDO.push({ undo: () => {
        setCellPlanned(g, m.number, c.name, before);
        refresh(); paintRowTotal(rowIdx); paintColFooter(colIdx); paintHeadline();
      } });
      refresh();
      paintRowTotal(rowIdx); paintColFooter(colIdx); paintHeadline();
      saveGrantIfPersisted(g);
    }

    span.addEventListener("focus", () => {
      const v = cellPlanned(g, m.number, c.name);
      span.textContent = v == null ? "" : String(v);
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    span.addEventListener("input", () => {
      const raw = span.textContent.trim();
      const n = raw === "" ? null : parseFloat(raw);
      const override = { mNumber: m.number, catName: c.name, value: raw === "" ? null : (isNaN(n) ? null : n) };
      paintRowTotal(rowIdx, override); paintColFooter(colIdx, override); paintHeadline(override);
    });
    span.addEventListener("blur", commit);
    span.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault(); refresh(); paintRowTotal(rowIdx); paintColFooter(colIdx); paintHeadline(); span.blur();
      } else if (e.key === "Enter") { e.preventDefault(); moveFocus(span, rowIdx, colIdx, "down"); }
      else if (e.key === "Tab") { e.preventDefault(); moveFocus(span, rowIdx, colIdx, e.shiftKey ? "left" : "right"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(span, rowIdx, colIdx, "up"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(span, rowIdx, colIdx, "down"); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const sel = window.getSelection();
        const len = span.textContent.length;
        const atStart = sel.anchorOffset === 0 && sel.focusOffset === 0;
        const atEnd = sel.anchorOffset === len && sel.focusOffset === len;
        if (e.key === "ArrowLeft" && atStart) { e.preventDefault(); moveFocus(span, rowIdx, colIdx, "left"); }
        else if (e.key === "ArrowRight" && atEnd) { e.preventDefault(); moveFocus(span, rowIdx, colIdx, "right"); }
      }
    });
    return span;
  }

  /* Commit the cell being left before computing where focus goes next. */
  function moveFocus(fromSpan, rowIdx, colIdx, dir) {
    fromSpan.blur();
    const rows = mss.length, colsN = cats.length;
    let r = rowIdx, c = colIdx;
    if (dir === "up") r -= 1;
    else if (dir === "down") r += 1;
    else if (dir === "left") { c -= 1; while (c >= 0 && !isOpenCol(c)) c -= 1; if (c < 0) { r -= 1; c = colsN - 1; while (c >= 0 && !isOpenCol(c)) c -= 1; } }
    else if (dir === "right") { c += 1; while (c < colsN && !isOpenCol(c)) c += 1; if (c >= colsN) { r += 1; c = 0; while (c < colsN && !isOpenCol(c)) c += 1; } }
    if (r < 0 || r >= rows || c < 0 || c >= colsN) return;
    const target = cellRefs[r][c];
    if (target) target.focus();
  }

  mss.forEach((m, rowIdx) => {
    const tr = document.createElement("tr");
    tr.appendChild(el(`<td class="gutter">M${m.number}</td>`));
    tr.appendChild(el(`<td class="title" title="${esc(m.title)}">${esc(m.title)}</td>`));
    const rowRefs = [];
    cats.forEach((c, colIdx) => {
      const td = document.createElement("td");
      td.className = "ac-cell";
      if (c.total === 0) {
        td.className = "ac-cell unavail";
        const st = el(`<span class="ac-static">${valueHtml({ value: 0, format: "money", source: "agreement" })}</span>`);
        st.dataset.tip = "This category has no funding under the agreement.";
        st.dataset.tipsrc = "Funding agreement · closed category";
        td.appendChild(st);
        rowRefs.push(null);
      } else {
        const span = wireCell(m, c, rowIdx, colIdx);
        td.appendChild(span);
        paintActualLine(g, m, c, td);
        rowRefs.push(span);
      }
      tr.appendChild(td);
    });
    cellRefs.push(rowRefs);

    const rowTotalTd = el(`<td class="sep rowtotal"></td>`);
    const rowBudgetTd = m.estimatedCost == null
      ? el(`<td class="rowbudget">${valueHtml({
          value: null,
          missing: { reason: "No milestone cost estimate was supplied.", fix: "Enter an estimate only when a source supports it." },
        })}</td>`)
      : el(`<td class="rowbudget">${valueHtml({
          value: m.estimatedCost, format: "money", source: m.estimatedCostSource || "manual",
          sourceDetail: { note: "Milestone estimate used as an advisory planning margin." },
        })}</td>`);
    rowTotalEls.push(rowTotalTd);
    tr.appendChild(rowTotalTd);
    tr.appendChild(rowBudgetTd);
    tbody.appendChild(tr);
  });
  mss.forEach((m, rowIdx) => paintRowTotal(rowIdx));

  const tfoot = document.createElement("tfoot");
  const allocTr = el(`<tr><td colspan="2" class="flabel">Allocated</td></tr>`);
  const budgTr = el(`<tr><td colspan="2" class="flabel">Category limit</td></tr>`);
  const remTr = el(`<tr><td colspan="2" class="flabel">Remaining</td></tr>`);
  const colAllocEls = [], colRemEls = [];
  cats.forEach((c) => {
    const a = document.createElement("td"); allocTr.appendChild(a); colAllocEls.push(a);
    const b = el(`<td class="dim">${valueHtml({
      value: c.total, format: "money", source: "agreement",
      missing: { reason: `No contractual category limit was extracted for ${c.name}.`, fix: "Review the agreement before allocating expenditure." },
    })}</td>`); budgTr.appendChild(b);
    const r = document.createElement("td"); remTr.appendChild(r); colRemEls.push(r);
  });
  allocTr.appendChild(el(`<td class="sep" style="font-weight:700"></td>`));
  budgTr.appendChild(el(`<td class="sep"></td>`));
  remTr.appendChild(el(`<td class="sep"></td>`));
  tfoot.append(allocTr, budgTr, remTr);

  /* The actuals block: what tagging has actually produced, per category. */
  const actTr = el(`<tr class="actline"><td colspan="2" class="flabel">Actual</td></tr>`);
  const awaitTr = el(`<tr><td colspan="2" class="flabel">Eligible, not placed</td></tr>`);
  let grandActual = 0, grandAwaiting = 0;
  cats.forEach((c) => {
    const actual = categoryActual(g, c.name);
    const funnel = categoryFunnel(g, c.name);
    grandActual += actual; grandAwaiting += funnel.awaiting;

    const a = document.createElement("td");
    if (actual > 0) {
      const overCeiling = c.total != null && c.total !== 0 && actual > c.total;
      a.innerHTML = `<span class="fc-link">${valueHtml({
        value: actual, format: "money", source: "derived",
        sourceDetail: { note: "Recognised from statement amounts attributed to milestones." },
      })}</span>`;
      if (overCeiling) {
        a.className = "breach";
        $("span", a).dataset.tip = `Recognised actuals exceed this category's ${money(c.total)} contractual limit by ${money(actual - c.total)}.`;
        $("span", a).dataset.tipsrc = "Actual · contractual ceiling";
      }
      onActivate($("span", a), () => openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: { category: c.name } }));
      $("span", a).tabIndex = 0;
    } else {
      a.innerHTML = valueHtml({
        value: 0, format: "money", source: "derived",
        sourceDetail: { note: "No actual expenditure is recognised in this category." },
      });
      a.className = "dim";
    }
    actTr.appendChild(a);

    const w = document.createElement("td");
    if (funnel.awaiting > 0) {
      w.innerHTML = `<span class="fc-link warn">${valueHtml({
        value: funnel.awaiting, format: "money", source: "derived",
        sourceDetail: { note: "Tagged eligible statement amounts not yet attributed to milestones." },
      })}</span>`;
      $("span", w).dataset.tip = "Tagged eligible under this category, not yet attributed to a milestone.";
      $("span", w).dataset.tipsrc = "Step ① done, step ② pending";
      $("span", w).tabIndex = 0;
      onActivate($("span", w), () => openGrant(g.id, "actuals", { actualsView: "attribute", attributeFilter: { category: c.name } }));
    } else {
      w.innerHTML = valueHtml({
      value: 0, format: "money", source: "derived",
        sourceDetail: { note: "No tagged eligible expenditure remains unassigned in this category." },
      });
      w.className = "dim";
    }
    awaitTr.appendChild(w);
  });
  const grandActualTd = el(`<td class="sep" style="font-weight:700">${valueHtml({
    value: grandActual, format: "money", source: "derived",
    sourceDetail: { note: "Sum of recognised actual expenditure across categories." },
  })}</td>`);
  actTr.appendChild(grandActualTd);
  awaitTr.appendChild(el(`<td class="sep">${valueHtml({
    value: grandAwaiting, format: "money", source: "derived",
    sourceDetail: { note: "Sum of tagged eligible expenditure awaiting milestone attribution." },
  })}</td>`));
  tfoot.append(actTr, awaitTr);
  table.appendChild(tfoot);

  function paintColFooter(colIdx, override) {
    const c = cats[colIdx];
    const allocTd = colAllocEls[colIdx], remTd = colRemEls[colIdx], th = catHeadCells[colIdx];
    allocTd.className = ""; remTd.className = ""; th.classList.remove("breach", "warn");
    if (c.total === 0) {
      allocTd.innerHTML = valueHtml({ value: 0, format: "money", source: "derived" });
      allocTd.className = "dim";
      remTd.innerHTML = valueHtml({ value: 0, format: "money", source: "derived" });
      remTd.className = "dim";
      return;
    }
    const allocated = colAllocated(g, c, override);
    allocTd.innerHTML = valueHtml({
      value: allocated, format: "money", source: "derived",
      sourceDetail: { note: `Sum of planned ${shortCatName(c.name)} allocations.` },
    });
    if (c.total == null) {
      allocTd.className = "dim";
      remTd.innerHTML = valueHtml({
        value: null,
        missing: { reason: "Remaining cannot be calculated without a contractual category limit.", fix: "Review the agreement." },
      });
      return;
    }
    const over = allocated > c.total;
    if (!over) {
      allocTd.className = "dim"; remTd.className = "dim";
      remTd.innerHTML = valueHtml({
        value: c.total - allocated, format: "money", source: "derived",
        sourceDetail: { note: "Contractual category ceiling less planned allocations." },
      });
      return;
    }
    const force = marginForce(c.source);
    const cls = force === "contractual" ? "breach" : "warn";
    allocTd.className = cls; remTd.className = cls; th.classList.add(cls);
    remTd.innerHTML = valueHtml({
      value: c.total - allocated, format: "money", source: "derived",
      sourceDetail: { note: "Contractual category ceiling less planned allocations." },
    });
  }
  cats.forEach((c, colIdx) => paintColFooter(colIdx));
  grandTotalTd = allocTr.querySelector("td.sep");
  grandTotalTd.innerHTML = valueHtml({
    value: grandAllocated(g), format: "money", source: "derived",
    sourceDetail: { note: "Sum of planned milestone-category allocations." },
  });

  body.appendChild(scroll);
}
