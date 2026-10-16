/* Calendar-scaled milestone timeline and zoom interaction. */

import { esc, fmtDate, money } from "@gf-ui";
import { $, $$, el } from "../lib/dom.js";
import { DAY, TODAY } from "../lib/format.js";

const TL = { ppd: null, fitPpd: null };

export function renderTimeline(g, opts) {
  opts = opts || {};
  const onHover = opts.onHover || (() => {});
  const onClick = opts.onClick || (() => {});
  const LABEL_W = 240;

  const wrap = el(`<div class="tl-wrap">
    <div class="tl-toolbar">
      <span class="tl-toolbar-label">Milestone timeline</span>
      <div class="tl-zoom" aria-label="Timeline zoom">
        <button type="button" class="btn-chip" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" class="btn-chip" data-zoom="fit">Fit</button>
        <button type="button" class="btn-chip" data-zoom="in" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="tl-scroller"><div class="tl-inner">
      <div class="tl-bands"></div><div class="tl-axis"></div><div class="tl-rows"></div>
    </div></div>
    <div class="tl-hint">Hover to isolate a milestone. A diamond means the source has no start date.</div>
  </div>`);
  wrap.liftRow = (num) => {
    $$(".tl-row", wrap).forEach((r) => r.classList.toggle("dim", Number(r.dataset.ms) !== num));
    $(".tl-rows", wrap).classList.toggle("hovering", num != null);
    $$(".tl-bar, .tl-diamond", wrap).forEach((el2) =>
      el2.classList.toggle("lifted", Number(el2.dataset.ms) === num));
  };
  wrap.redraw = () => {}; // overwritten below once there's something to draw

  const sorted = g.milestones.slice().sort((a, b) => a.number - b.number);
  const withDates = sorted.filter((m) => m.plannedAchievementDate);
  if (!withDates.length) return wrap;

  const knownStarts = [g.grant.projectStartDate, ...sorted.map((m) => m.startDate)].filter(Boolean).sort();
  const knownEnds = [g.grant.projectEndDate, ...withDates.map((m) => m.plannedAchievementDate)].filter(Boolean).sort();
  const firstKnownDate = knownStarts[0] || knownEnds[0];
  const t0 = new Date(firstKnownDate + "T00:00:00").getTime() - 14 * DAY;
  const t1 = new Date(knownEnds[knownEnds.length - 1] + "T00:00:00").getTime() + 21 * DAY;
  const span = Math.max((t1 - t0) / DAY, 1);
  const todayIso = TODAY.toISOString().slice(0, 10);
  const todayMs = new Date(todayIso + "T00:00:00").getTime();
  const todayInRange = todayMs > t0 && todayMs < t1;

  // jsdom (tests) has no canvas — fall back to a rough width estimate there.
  const canvasCtx = document.createElement("canvas").getContext("2d");
  if (canvasCtx) canvasCtx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  const measureCtx = canvasCtx || { measureText: (t) => ({ width: t.length * 6 }) };

  function draw() {
    const scroller = $(".tl-scroller", wrap);
    const avail = scroller.clientWidth - LABEL_W || 700;
    TL.fitPpd = avail / span;
    if (!TL.ppd || TL.ppd < TL.fitPpd) TL.ppd = TL.fitPpd;
    const ppd = TL.ppd;
    const width = Math.round(span * ppd);
    const inner = $(".tl-inner", wrap);
    inner.style.width = LABEL_W + width + "px";
    const x = (iso) => Math.round(((new Date(iso + "T00:00:00") - t0) / DAY) * ppd);

    /* year bands + quarter gridlines, full height, behind everything */
    const bands = $(".tl-bands", wrap);
    bands.innerHTML = "";
    bands.style.left = LABEL_W + "px";
    bands.style.width = width + "px";
    bands.style.overflow = "hidden";
    const y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    for (let y = y0; y <= y1; y++) {
      const left = Math.max(x(`${y}-01-01`), 0), right = Math.min(x(`${y + 1}-01-01`), width);
      if (right <= left) continue;
      bands.appendChild(el(`<div class="tl-band" style="left:${left}px;width:${right - left}px;background:${(y - y0) % 2 ? "var(--sunken)" : "var(--card)"}"></div>`));
    }
    for (let d = new Date(t0); d.getTime() < t1; d.setMonth(d.getMonth() + 3)) {
      const m = d.getMonth();
      if (m % 3 !== 0) continue;
      const iso = `${d.getFullYear()}-${String(m + 1).padStart(2, "0")}-01`;
      bands.appendChild(el(`<div class="tl-qline" style="left:${x(iso)}px"></div>`));
    }

    /* axis: measure real text width, place year > quarter > month > week,
       cull anything that would collide */
    const axis = $(".tl-axis", wrap);
    axis.innerHTML = "";
    axis.style.marginLeft = LABEL_W + "px";
    axis.style.width = width + "px";
    const placed = [];
    if (todayInRange) {
      const todayX = x(todayIso);
      const w = measureCtx.measureText("today").width;
      placed.push({ left: todayX - 2, right: todayX + w + 6 });
    }
    function tryPlace(cx, text, cls) {
      const w = measureCtx.measureText(text).width;
      const left = cx - w / 2, right = cx + w / 2;
      if (placed.some((p) => left < p.right + 10 && right > p.left - 10)) return false;
      placed.push({ left, right });
      axis.appendChild(el(`<div class="ax ${cls || ""}" style="left:${cx}px">${esc(text)}</div>`));
      return true;
    }
    for (let y = y0; y <= y1; y++) {
      const iso = `${y}-01-01`;
      const d = new Date(iso + "T00:00:00");
      if (d.getTime() >= t0 && d.getTime() <= t1) tryPlace(x(iso), String(y), "yr");
    }
    if (ppd * 30 >= 8) {
      for (let d = new Date(t0); d.getTime() < t1; d.setMonth(d.getMonth() + 3)) {
        const m = d.getMonth();
        if (m === 0) continue;
        const iso = `${d.getFullYear()}-${String(m + 1).padStart(2, "0")}-01`;
        tryPlace(x(iso), `Q${Math.floor(m / 3) + 1} '${String(d.getFullYear()).slice(2)}`);
      }
    }
    if (ppd * 30 >= 34) {
      for (let d = new Date(t0); d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
        const m = d.getMonth();
        if (m % 3 === 0) continue;
        const iso = `${d.getFullYear()}-${String(m + 1).padStart(2, "0")}-01`;
        tryPlace(x(iso), d.toLocaleDateString("en-AU", { month: "short" }));
      }
    }
    if (ppd >= 12) {
      for (let d = new Date(t0); d.getTime() < t1; d.setDate(d.getDate() + 7)) {
        if (d.getDate() <= 7) continue;
        const iso = d.toISOString().slice(0, 10);
        tryPlace(x(iso), String(d.getDate()) + " " + d.toLocaleDateString("en-AU", { month: "short" }));
      }
    }

    const rows = $(".tl-rows", wrap);
    rows.innerHTML = "";
    sorted.forEach((m) => {
      const row = el(`<div class="tl-row" data-ms="${m.number}">
        <div class="tl-label" title="${esc(m.title)}"><span class="n">M${m.number}</span><span class="t">${esc(m.title)}</span></div>
        <div class="tl-canvas"></div></div>`);
      row.addEventListener("mouseenter", () => { wrap.liftRow(m.number); onHover(m.number); });
      row.addEventListener("mouseleave", () => { wrap.liftRow(null); onHover(null); });
      const canvas = $(".tl-canvas", row);
      const end = m.plannedAchievementDate;
      if (!end) { rows.appendChild(row); return; }
      const lines = [`End: ${fmtDate(end)}`];
      lines.unshift(`Start: ${m.startDate ? fmtDate(m.startDate) : "Not in agreement"}`);
      if (m.estimatedCost != null) lines.push(`Estimated cost: ${money(m.estimatedCost)}`);
      const tip = lines.join("\n");

      if (m.startDate) {
        const left = x(m.startDate);
        const w = Math.max(x(end) - left, 4);
        const bar = el(`<button type="button" class="tl-bar" data-ms="${m.number}" style="left:${left}px;width:${w}px" data-tip="${esc(tip)}" aria-label="M${m.number} ${esc(m.title)}. ${esc(tip.replaceAll("\n", ". "))}"></button>`);
        bar.onclick = () => onClick(m.number);
        canvas.appendChild(bar);
        canvas.appendChild(el(`<div class="tl-tick" style="left:${left + w - 1}px"></div>`));
      } else {
        const di = el(`<button type="button" class="tl-diamond" data-ms="${m.number}" style="left:${x(end) - 4.5}px" data-tip="${esc(tip)}" aria-label="M${m.number} ${esc(m.title)}. No start date; due-date marker. ${esc(tip.replaceAll("\n", ". "))}"></button>`);
        di.onclick = () => onClick(m.number);
        canvas.appendChild(di);
      }
      rows.appendChild(row);
    });

    $$(".tl-today", inner).forEach((n) => n.remove());
    if (todayInRange) {
      inner.appendChild(el(`<div class="tl-today" style="left:${LABEL_W + x(todayIso)}px"><span class="tl-today-lab">today</span></div>`));
    }
  }

  // The caller appends wrap after this returns, so clientWidth would read 0
  // if measured now — requestAnimationFrame runs once layout is real.
  TL.ppd = null;
  wrap.redraw = draw;
  requestAnimationFrame(draw);

  const scroller = $(".tl-scroller", wrap);
  function zoom(factor) {
    const viewWidth = Math.max(scroller.clientWidth - LABEL_W, 1);
    const midpointDate = (scroller.scrollLeft + viewWidth / 2) / TL.ppd;
    TL.ppd = factor === "fit" ? TL.fitPpd
      : Math.max(TL.fitPpd, Math.min(TL.ppd * factor, TL.fitPpd * 24));
    draw();
    scroller.scrollLeft = Math.max(0, midpointDate * TL.ppd - viewWidth / 2);
  }
  $("[data-zoom=out]", wrap).onclick = () => zoom(1 / 1.5);
  $("[data-zoom=fit]", wrap).onclick = () => zoom("fit");
  $("[data-zoom=in]", wrap).onclick = () => zoom(1.5);

  return wrap;
}
