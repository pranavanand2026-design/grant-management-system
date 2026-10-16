---
category: Portfolio
---

# Portfolio dashboard — attention strip, work queue, all-grants table

The portfolio view (`#view-home`) is three stacked sections built from one
shared issue list per grant, so they can never disagree with each other:
an attention summary strip, a "needs attention" work queue, and a full
sortable/filterable grant table. Don't build a dashboard as isolated widgets
that could show conflicting numbers — derive all three from the same rows.

## Attention strip (`#attn-strip`)

A row of clickable chips, one per issue kind, each showing a count. Clicking
toggles that kind as an active filter (`aria-pressed`).

```html
<div id="attn-strip" role="group" aria-label="Portfolio attention summary">
  <button type="button" class="attn-cell breach" aria-pressed="false">
    <span class="attn-n">3</span><span class="attn-lab">Reports overdue</span>
  </button>
  <button type="button" class="attn-cell warn" aria-pressed="false">
    <span class="attn-n">5</span><span class="attn-lab">Evidence required</span>
  </button>
</div>
```

`sev` classes (`breach` / `warn` / etc.) drive the chip's ink, matching
`StatusPill`'s severity vocabulary. If nothing needs attention, show a plain
`<p class="attn-none">No open issues across the portfolio.</p>` — never an
empty strip.

## Work queue (`#queue-section`)

Ranked rows, most urgent first, each a full issue with why it's listed and
one primary action:

```html
<section id="queue-section" aria-labelledby="queue-head">
  <h2 class="port-section-head" id="queue-head">Needs attention <span class="port-badge">7</span></h2>
  <article class="q-row breach">
    <div class="q-main">
      <div class="q-who">
        <span class="q-client">Acme Robotics Pty Ltd</span>
        <button type="button" class="q-grant">Pilot Line Automation</button>
      </div>
      <p class="q-issue">Quarterly report overdue by 12 days</p>
      <p class="q-money">$67,000 at risk of late-claim rejection</p>
      <div class="q-also">
        <span class="q-also-head">Also requires attention</span>
        <ul><li><button type="button" class="q-also-link">Evidence missing for M3</button></li></ul>
      </div>
    </div>
    <div class="q-side"><button type="button" class="btn-chip q-go">Submit report</button></div>
  </article>
</section>
```

The row itself is clickable (opens the grant); the `q-go` chip inside is a
second, more specific action — clicking it must stop propagation so it
doesn't also fire the row click. When nothing needs attention, show
`<p class="queue-clear">Nothing needs your attention right now. Next
deadline: …</p>` instead of an empty section.

## All-grants table (`#all-grants`, `.port-table`)

A sortable table (`aria-sort` on `<th>`), with search + a project-state
filter above it, wrapped in a horizontally-scrolling card:

```html
<div class="port-controls">
  <input type="search" placeholder="Search client, grant or reference…" />
  <select aria-label="Filter by project state">
    <option value="all">All states</option>
    <option value="active">Active</option>
  </select>
  <span class="port-matches">Showing 8 of 14 grants</span>
  <button type="button" class="btn-chip ghost">Clear filters</button>
</div>
<div class="card port-card"><div class="port-scroll">
  <table class="port-table">
    <thead><tr>
      <th scope="col" aria-sort="ascending"><button type="button">Client &amp; grant</button></th>
      <th scope="col"><button type="button">Next report</button></th>
      <th scope="col"><button type="button">Attention</button></th>
      <th scope="col" class="num"><button type="button">Maximum funds</button></th>
      <th scope="col"><span class="vis-hidden">Open</span></th>
    </tr></thead>
    <tbody>
      <tr class="port-row">
        <td class="pt-who"><span class="pt-client">Acme Robotics Pty Ltd</span><span class="pt-grant">Pilot Line Automation</span></td>
        <td class="pt-next"><span class="pt-date pt-soon">Due in 6 days</span><span class="pt-type">Quarterly report</span></td>
        <td class="pt-attn"><span class="st st-warn">⚠ At risk</span><button type="button" class="pt-more">+2 more</button></td>
        <td class="num pt-funds">$500,000</td>
        <td class="pt-act"><button type="button" class="pt-open">Open grant</button></td>
      </tr>
    </tbody>
  </table>
</div></div>
```

- A whole `<tr>` is clickable (`pt-*` cells), but every interactive element
  inside it stops propagation so nested buttons/links work independently.
- `pt-more` expands an inline `<tr class="pt-issues">` beneath the row
  listing every issue — don't build a second modal for "see more" on a
  table row, expand in place.
- A completed grant gets `.pt-done` on its `<tr>` (dimmed, not hidden).
- The `<td>` wrappers (`pt-who`, `pt-next`, `pt-attn`) carry no styling of
  their own — the look comes entirely from their styled children
  (`pt-client`, `pt-grant`, `pt-date`, `.st`) and the table's own cell
  rules. Don't invent bespoke padding/color for the `<td>` itself.
- A loading table shows skeleton rows (`<tr class="pt-sk">` with `<span
  class="sk">` shimmer blocks matching each column's width) rather than a
  spinner overlay.
