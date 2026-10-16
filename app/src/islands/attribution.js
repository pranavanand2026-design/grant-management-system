/* Assigns reviewed eligible expenditure to milestone periods. */

import { esc, money } from "@gf-ui";
import { saveGrantIfPersisted } from "../api.js";
import { $, el, onActivate } from "../lib/dom.js";
import { periodLabel } from "../lib/format.js";
import {
  attributedForPeriod, candidatesForPeriod, eligibleByCategoryPeriod, rollupReference,
} from "../lib/funnel.js";
import { bump, openGrant, state } from "../store.js";

export function renderAttribution(g, body) {
  const filter = state.attributeFilter;
  const eligible = eligibleByCategoryPeriod(g);
  // Panels exist for every category-period that has tagged money OR
  // attributed money — an attribution whose tags were removed must not
  // vanish from view.
  const keySet = new Set(Object.keys(eligible));
  Object.entries(g.attributions || {}).forEach(([key, byMs]) => {
    if (Object.values(byMs).some((v) => v != null)) keySet.add(key);
  });
  let keys = [...keySet].sort((a, b) => {
    const [, pa] = a.split("::"), [, pb] = b.split("::");
    return pa.localeCompare(pb) || a.localeCompare(b);
  });

  if (filter) {
    const fm = filter.milestoneNumber != null ? g.milestones.find((x) => x.number === filter.milestoneNumber) : null;
    const parts = [];
    if (filter.category) parts.push(`<b>${esc(filter.category)}</b>`);
    if (filter.period) parts.push(`<b>${esc(periodLabel(filter.period))}</b>`);
    if (filter.milestoneNumber != null) parts.push(`<b>M${filter.milestoneNumber}${fm ? " · " + esc(fm.title) : ""}</b>`);
    const bar = el(`<div class="attrib-filter-bar">
      <span>Showing ${parts.join(" for ")}</span>
      <button type="button" class="btn-chip ghost">Show all</button>
    </div>`);
    $("button", bar).onclick = () => { state.attributeFilter = null; bump(); };
    body.appendChild(bar);
    keys = keys.filter((key) => {
      const [category, period] = key.split("::");
      if (filter.category && category !== filter.category) return false;
      if (filter.period && period !== filter.period) return false;
      if (filter.milestoneNumber != null) {
        const { candidates, undated } = candidatesForPeriod(g, period);
        if (!candidates.concat(undated).some((ms) => ms.number === filter.milestoneNumber)) return false;
      }
      return true;
    });
  }

  if (!keys.length) {
    body.appendChild(el(`<div class="empty"><h3>Nothing to attribute here yet</h3><p>${filter
      ? `Nothing tagged${filter.category ? " to " + esc(filter.category) : ""}${filter.milestoneNumber != null ? ` in a period M${filter.milestoneNumber} was running` : ""}${filter.period ? " in " + esc(periodLabel(filter.period)) : ""} yet. Tag some statement rows first.`
      : "Tag some statement rows to a category first."}</p></div>`));
    return;
  }

  const openPanels = state.attribOpen || (state.attribOpen = new Set());
  const byCatKeys = new Map();
  keys.forEach((key) => {
    const [category] = key.split("::");
    if (!byCatKeys.has(category)) byCatKeys.set(category, []);
    byCatKeys.get(category).push(key);
  });
  const catSections = [...byCatKeys.entries()].map(([category, ks]) => ({
    category, ks: ks.sort((a, b) => a.split("::")[1].localeCompare(b.split("::")[1])),
    total: ks.reduce((s, k) => s + (eligible[k] || 0), 0),
  })).sort((a, b) => b.total - a.total);

  catSections.forEach(({ category, ks, total: catTotal }) => {
    const catAttributed = ks.reduce((s, k) => {
      const [c, p] = k.split("::");
      return s + attributedForPeriod(g, c, p);
    }, 0);
    const catDoneWords = catAttributed >= catTotal && catTotal > 0 && catAttributed === catTotal
      ? "All placed ✓"
      : catAttributed > catTotal
        ? `${money(catAttributed - catTotal)} over`
        : `${money(catTotal - catAttributed)} to place`;
    const pct = catTotal > 0 ? Math.min(catAttributed / catTotal, 1) * 100 : 0;

    const section = el(`<section class="catgrp"></section>`);
    const head = el(`<div class="catgrp-head">
      <span class="catgrp-name">${esc(category)}</span>
      <span class="catgrp-figs"><b>${money(catAttributed)}</b> of ${money(catTotal)} placed · <span class="${catAttributed > catTotal ? "rv-warn" : ""}">${catDoneWords}</span></span>
      <a class="catgrp-sheet" role="button" tabindex="0">View on sheet →</a>
    </div>`);
    onActivate($(".catgrp-sheet", head), () => openGrant(g.id, "expenditure"));
    section.appendChild(head);
    section.appendChild(el(`<div class="catgrp-meter"><i style="width:${pct}%"></i></div>`));

    ks.forEach((key) => {
      const [, period] = key.split("::");
      const total = eligible[key] || 0;
      const byMs = (g.attributions || {})[key] || {};
      const attributed = attributedForPeriod(g, category, period);
      const settled = attributed > 0 && attributed === total;

      // A settled period folds to one line. Click to reopen.
      if (settled && !openPanels.has(key) && !filter) {
        const chips = Object.entries(byMs).filter(([, v]) => v != null)
          .map(([n, v]) => `<span class="pp-chip">M${esc(n)} ${money(v)}</span>`).join("");
        const line = el(`<button type="button" class="period-done">
          <span class="pp-period">${esc(periodLabel(period))}</span>
          <span class="pp-total">${money(total)}</span>
          <span class="pp-arrow">→</span> ${chips}
          <span class="pp-tick">✓</span></button>`);
        line.onclick = () => { openPanels.add(key); bump(); };
        section.appendChild(line);
        return;
      }

      const ref = rollupReference(g, category, period);
      const { candidates, undated } = candidatesForPeriod(g, period);

      const panel = el(`<div class="attrib-panel"></div>`);
      const phead = el(`<div class="attrib-head">
        <span class="attrib-period">${esc(periodLabel(period))}</span>
        <span class="attrib-elig">${money(total)} eligible · ${candidates.length} milestone${candidates.length === 1 ? "" : "s"} running</span>
        ${settled ? `<button type="button" class="attrib-fold" aria-label="Fold this period">Done — fold ↑</button>` : ""}
      </div>`);
      const foldBtn = $(".attrib-fold", phead);
      if (foldBtn) foldBtn.onclick = () => { openPanels.delete(key); bump(); };
      panel.appendChild(phead);
      if (ref != null) {
        const consistent = Math.round(ref) === Math.round(total);
        panel.appendChild(el(`<p class="attrib-ref">Preparer's own figure: ${money(ref)} ${consistent
          ? '<span class="rv-ok">✓ consistent</span>'
          : `<span class="rv-warn">⚠ differs by ${money(Math.abs(ref - total))}</span>`}</p>`));
      }

      const remEl = el(`<div class="remaining"><span>Remaining this period</span><b></b></div>`);
      function paintRemaining() {
        const alreadyNow = attributedForPeriod(g, category, period);
        const rem = total - alreadyNow;
        remEl.classList.toggle("negative", rem < 0);
        $("span", remEl).textContent = rem < 0
          ? "Over-attributed — more than was tagged eligible; the same dollars may be counted twice"
          : "Remaining this period";
        $("b", remEl).textContent = rem < 0 ? "−" + money(Math.abs(rem)) : money(rem);
      }

      const allCandidates = candidates.concat(undated);
      // Exactly one candidate and nothing attributed yet: pre-fill the full
      // figure so she's confirming, not typing — nothing commits on render.
      const singleCandidate = allCandidates.length === 1 && byMs[allCandidates[0].number] == null;

      function appendCandidateRow(ms, prefill) {
        const val = byMs[ms.number];
        const display = val != null ? val : (prefill ? total : null);
        const isFilterTarget = filter && filter.milestoneNumber === ms.number;
        const row = el(`<div class="cand-row ${isFilterTarget ? "cand-highlight" : ""}"><span class="cand-id">M${ms.number}</span><span class="cand-title">${esc(ms.title)}</span>
          <span class="cand-plan">plan ${ms.estimatedCost != null ? money(ms.estimatedCost) : "—"}${val ? ` · placed ${money(val)}` : ""}</span>
          <input class="cand-input ${val != null ? "filled" : ""} ${prefill ? "needs-confirm" : ""}" value="${display != null ? money(display) : ""}" /></div>`);
        const input = $("input", row);
        function commit() {
          const raw = input.value.trim();
          const before = (g.attributions || {})[key]?.[ms.number] ?? null;
          let next;
          if (raw === "") next = null;
          else { const n = parseFloat(raw.replace(/[^0-9.-]/g, "")); next = isNaN(n) ? before : n; }
          if (next === before) return;
          if (!g.attributions) g.attributions = {};
          if (!g.attributions[key]) g.attributions[key] = {};
          if (next == null) delete g.attributions[key][ms.number]; else g.attributions[key][ms.number] = next;
          saveGrantIfPersisted(g);
          paintRemaining();
          input.classList.remove("needs-confirm");
          input.classList.toggle("filled", next != null);
        }
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
        panel.appendChild(row);
      }

      if (singleCandidate) {
        appendCandidateRow(allCandidates[0], true);
      } else {
        candidates.forEach((ms) => appendCandidateRow(ms, false));
        if (undated.length) {
          panel.appendChild(el(`<p class="unfiltered-note">No start date in the agreement or worksheet — offered here unfiltered, every period, until one is supplied.</p>`));
          undated.forEach((ms) => appendCandidateRow(ms, false));
        }
      }

      paintRemaining();
      panel.appendChild(remEl);
      section.appendChild(panel);
    });

    body.appendChild(section);
  });
}
