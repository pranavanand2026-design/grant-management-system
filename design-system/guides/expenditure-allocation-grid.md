---
category: Expenditure
---

# Expenditure allocation grid

The milestone-to-budget link, held as a live spreadsheet: milestones down
the rows, categories across the columns, every cell independently editable.
This is the tool's single most important surface — read the project brief's
"HOLDS her judgments" framing before touching this pattern.

```html
<p class="alloc-headline"><b>$120,000</b> <span style="color:var(--ink-3)">unallocated of</span> $500,000</p>
<p class="alloc-actual-line"><b>$210,000</b> <span style="color:var(--ink-3)">actual recognised</span> · <a class="alloc-awaiting-link">$18,000 tagged, awaiting attribution</a></p>

<div class="alloc-warnings">
  <div class="alloc-warning ceiling">⚠ <span><b>Labour</b> — recognised actuals of $320,000 exceed the contractual $300,000 ceiling by $20,000 (Item 10).</span><span class="go">Review →</span></div>
</div>

<div class="alloc-scroll">
  <table class="alloc-grid">
    <thead><tr>
      <th class="gutter">§9</th><th class="title">Milestone</th>
      <th class="cat">Labour</th><th class="cat">Contract</th>
      <th class="sep">Total</th><th>Budget</th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="gutter">M3</td><td class="title">Pilot deployment</td>
        <td class="ac-cell">
          <span class="ac-input manual" contenteditable="true">$120,000</span>
          <div class="ac-actual-row"><span class="ac-actual ac-linked">$95,000</span></div>
        </td>
        <td class="ac-cell">
          <span class="ac-input" contenteditable="true"></span>
          <div class="ac-actual-row"><button type="button" class="ac-tag-link">Tag →</button></div>
        </td>
        <td class="sep rowtotal">$120,000</td>
        <td class="rowbudget">$130,000</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="2" class="flabel">Allocated</td><td>$120,000</td><td>$0</td><td class="sep" style="font-weight:700">$120,000</td></tr>
      <tr><td colspan="2" class="flabel">Budget (Item 10)</td><td class="dim">$300,000</td><td class="dim">$200,000</td><td class="sep"></td></tr>
      <tr><td colspan="2" class="flabel">Remaining</td><td class="dim">$180,000</td><td class="dim">$200,000</td><td class="sep"></td></tr>
      <tr class="actline"><td colspan="2" class="flabel">Actual</td><td><span class="fc-link">$95,000</span></td><td class="dim">$0</td><td class="sep" style="font-weight:700">$95,000</td></tr>
      <tr><td colspan="2" class="flabel">Awaiting attribution</td><td class="dim">$0</td><td class="dim">$0</td><td class="sep"></td></tr>
    </tfoot>
  </table>
</div>
```

Rules worth carrying into anything built in this spirit:

- **Two numbers per cell, never merged.** The top line
  (`.ac-input.manual`) is *her planned allocation* — a directly editable,
  contenteditable span. The line beneath it (`.ac-actual-row`) is the
  *actual*, and it's never typed — either a linked figure from tagged
  statement rows (`.ac-actual.ac-linked`, clickable, opens the tagging
  view) or a "Tag →" link (`.ac-tag-link`) when nothing's tagged yet.
  Planned and actual are visually stacked but never combined into one
  number.
- **A category with zero funding is visibly closed**, not just zero: the
  whole column gets `.unavail`, and its cells show a static `$0`
  (`.ac-static`), not an editable input — you cannot allocate into a
  category the agreement doesn't fund.
- **Row and column totals warn independently.** A row over its milestone's
  own cost estimate turns `.warn` or `.breach` (breach = the agreement's own
  number was exceeded, warn = a softer advisory estimate was) and appends
  an inline delta (`+$4,000 over estimate`). A column over its category
  ceiling does the same to the header cell and the footer's Allocated/
  Remaining row.
- **Keyboard-first editing.** Enter/Tab/arrow keys move focus
  cell-to-cell (skipping closed `.unavail` columns); Escape reverts an
  in-progress edit without committing. Every keystroke repaints that row's
  total, that column's footer, and the page headline live — not just on
  blur.
- **The footer is a small ledger of its own**: Allocated → Budget (Item
  10) → Remaining → Actual → Awaiting attribution, always in that order,
  always visible beneath the grid — never collapse it, it's the
  reconciliation the whole grid exists to produce.
