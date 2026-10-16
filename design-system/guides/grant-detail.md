---
category: Grant detail
---

# Grant detail — tabs shell, overview, milestone list

Opening a grant swaps to a detail view: a breadcrumb + title header, a
`Tabs`-driven section switcher, and per-tab content. Tabs used here:
Overview, Milestones, Expenditure, Actuals, Evidence.

```html
<section class="view" id="view-grant">
  <div class="grant-head">
    <a href="#" class="crumb">Acme Robotics Pty Ltd</a>
    <div class="grant-title-row">
      <h1 class="grant-title">Pilot Line Automation</h1>
      <div class="grant-actions">
        <button type="button" class="btn-text grant-action-edit">Edit</button>
        <button type="button" class="btn-text grant-action-delete">Delete</button>
      </div>
    </div>
  </div>
  <nav class="tabs" id="grant-tabs" aria-label="Grant sections">
    <button class="tab active">Overview</button>
    <button class="tab">Milestones</button>
    <button class="tab">Expenditure</button>
    <button class="tab">Actuals</button>
    <button class="tab">Evidence</button>
  </nav>
  <div id="tab-body"><!-- active tab's content --></div>
</section>
```

A stale-data warning, when relevant, sits at the very top of `#tab-body`,
above every other block:

```html
<div class="conflict-banner">⚠ <span>This grant was changed in another tab…</span>
  <button type="button" class="btn-chip">Reload</button></div>
```

## Overview tab

Four stacked blocks, in this order — don't reorder or merge them:

1. **Status line** (`.ov-status`) — one sentence summarizing grant health.
2. **Upcoming deadlines** — a row of cards, one per obligation, big
   countdown numeral on the left:
   ```html
   <div class="deadlines">
     <h3 class="deadlines-head">Upcoming deadlines</h3>
     <div class="deadline-card warn">
       <div class="dl-when"><span class="dl-count">6d</span><span class="dl-date">12 Aug 2024</span></div>
       <div class="dl-body"><div class="dl-type">Quarterly report</div>
         <div class="dl-period">Covering 1 Apr – 30 Jun 2024</div></div>
     </div>
   </div>
   ```
   Severity classes: `on-track` / `warn` / `over` (mirrors the app's
   deadline-urgency scale, not just StatusPill's).
3. **Other attention items** (`.attention` → `.attn-row`) — one clickable
   row per open finding or evidence gap, arrow at the right edge (`→`).
4. **Milestone timeline** — see `timeline-gantt.md`.
5. **Budget row** (`.ov-budget`) — a single stacked horizontal bar, one
   segment per category sized by its ceiling share, with a darker "used"
   overlay per segment:
   ```html
   <div class="ov-budget">
     <div class="ov-budget-bar">
       <div class="ov-budget-seg" style="width:60%;background:#F0723F"><div class="used" style="width:40%"></div></div>
       <div class="ov-budget-seg" style="width:40%;background:#E8C547"></div>
     </div>
     <div class="ov-budget-labels">
       <div class="ov-budget-label"><span class="sw" style="background:#F0723F"></span>Labour · $300,000</div>
     </div>
     <p class="ov-margins">Milestone estimates total $500,000. Category ceilings total $500,000. <span class="rv-ok">✓ Consistent.</span></p>
   </div>
   ```
6. **Formal details** — a native `<details class="formal">` disclosure
   (collapsed by default) holding the full contractual field list as a
   `<dl class="formal-grid">` — recipient, ABN, dates, caps, reporting
   obligations. This is where "everything, verbatim" goes; don't surface
   every contractual field at the top level, fold it here.

## Milestone list (Milestones tab, list state)

`.ms-list` itself is an unstyled wrapper — its look comes entirely from its
styled `.ms-row` children.

```html
<div class="ms-list">
  <div class="ms-row" data-ms="3">
    <div class="ms-num">M3</div>
    <div class="ms-main">
      <div class="ms-title">Pilot deployment</div>
      <div class="ms-dates">5 Feb 2024 – 5 Aug 2024</div>
      <div class="ms-meta">$220,000 · 4 activities · <span class="warn">1 outcome awaiting evidence</span></div>
    </div>
    <div class="ms-status at-risk">Needs review</div>
  </div>
</div>
```

Hovering a row lifts the matching timeline bar (shared hover state between
the list and the timeline island above it) — if you rebuild this pattern,
keep list-row-hover and timeline-bar-lift wired together, that coupling is
the point of putting them on the same tab.

## Milestone detail (drilled into one milestone)

Replaces the list when a milestone is selected — a back-link, per-category
spend bars (`.ms-spend-row`, a progress track + remaining-budget label),
any open `FindingCard`s for that milestone, an activities checklist
(`.act-row`, checkbox + description, done items sink to the bottom), and a
measurable-outcomes list where each row either shows its satisfied evidence
(`✓ filename`) or an "Upload +" button (`.ev-upload`).
