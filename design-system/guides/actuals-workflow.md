---
category: Actuals
---

# Actuals workflow — statement → review & tag → attribute → sheet

The quarterly workflow is a strict 4-station pipeline, always shown as one
horizontal strip at the top of the Actuals tab so she always knows where she
is and can jump between stations freely (nothing here gates progress).

```html
<div class="pipeline" role="tablist" aria-label="Actual expenditure workflow">
  <button type="button" role="tab" aria-selected="false" class="pl-station">
    <span class="pl-step">1</span>
    <span class="pl-copy"><span class="pl-label">Statements</span><span class="pl-sub">240 account-period lines</span></span>
  </button>
  <button type="button" role="tab" aria-selected="true" class="pl-station active">
    <span class="pl-step">2</span>
    <span class="pl-copy"><span class="pl-label">Review &amp; tag</span><span class="pl-sub">180 reviewed · 60 remaining</span></span>
  </button>
  <button type="button" role="tab" aria-selected="false" class="pl-station warn">
    <span class="pl-step">3</span>
    <span class="pl-copy"><span class="pl-label">Attribute</span><span class="pl-sub">$4,200 over — review</span></span>
  </button>
  <button type="button" class="pl-station pl-sheet">
    <span class="pl-step">4</span>
    <span class="pl-copy"><span class="pl-label">Expenditure sheet</span><span class="pl-sub">$210,000 currently recognised</span></span>
  </button>
</div>
```

Each station's `.pl-sub` line is always a live, real status sentence — never
a static label. Station 3 turns `.warn` the moment anything is
over-attributed, visible from station 1 without navigating there.

## Station 1 — Statements

A `DropZone` for the XLSX/XLSM upload, then imported statements as compact
cards:

```html
<div class="stmt-card">
  <div class="stmt-card-head"><b>Q1 cashflow.xlsx</b><span>Jan – Mar 2024</span></div>
  <div class="stmt-card-sub">86 rows</div>
</div>
```

**Import preview**, shown before a statement is committed — she confirms two
judgment calls before anything is added: whether any rows after the
project's end date are a forecast or realised actuals, and whether any
suspected pre-computed "rollup" rows (the preparer's own totals mixed into
the export) should be held out of her tagging totals:

```html
<div class="stmt-preview">
  <h3 class="stmt-preview-head">Importing Q1 cashflow.xlsx</h3>
  <dl class="stmt-preview-stats">
    <div><dt>Sheet</dt><dd>Cashflow</dd></div>
    <div><dt>Accounts</dt><dd>86 rows</dd></div>
  </dl>
  <div class="stmt-preview-choice">
    <button type="button" class="btn-chip active">Forecast</button>
    <button type="button" class="btn-chip">Actuals</button>
  </div>
  <div class="stmt-rollup-list">
    <label class="stmt-rollup-row"><input type="checkbox" />
      <span class="rr-label">Total eligible wages</span><span class="rr-period">Feb 2024</span><span class="rr-amount">$41,200</span></label>
  </div>
  <div class="stmt-preview-actions">
    <button class="btn-secondary">Cancel</button><button class="btn-primary">Add</button>
  </div>
</div>
```

## Station 2 — Review & tag

The densest surface in the app: a controlled reconciliation table where
**every row only ever shows a decision that's already been made** — nothing
inline-edits in the table itself, every change routes through one inline
decision editor.

**Summary strip** (`.rl-summary`) — six always-visible counters, several
clickable as instant filters (lines-imported / reviewed / to-review /
eligible-identified via `Value` with `source="derived"` / excluded /
warnings):

```html
<div class="rl-summary">
  <span class="rl-sum-cell"><span class="rl-sum-n">240</span><span class="rl-sum-lab">lines imported</span></span>
  <button type="button" class="rl-sum-cell rl-sum-btn"><span class="rl-sum-n warn">60</span><span class="rl-sum-lab">to review</span></button>
</div>
```

**Toolbar** — search + period/account/decision/category/sort selects, plus
two toggle chips (`Needs decision`, `Warnings only`, `aria-pressed`) and a
"Grouped by account" toggle that switches between a flat list and
account-grouped sections (a fully-reviewed account group collapses to one
summary line with a `▸`/`▾` chevron).

**Row** (`.rl-row`, carries a `st-<status>` class: `unreviewed` /
`needs_amount` / `partial` / `full` / `needs_note` / `excluded` /
`warning` / `rollup`):

```html
<tr class="rl-row st-warning">
  <td class="rl-acct">Wages — Site A</td>
  <td class="rl-period">Feb 2024</td>
  <td class="num rl-amt">$41,200</td>
  <td class="rl-dec"><span class="rl-st sev-warn">⚠ Amount warning</span></td>
  <td class="rl-cat">Labour</td>
  <td class="num rl-elig">$38,000</td>
  <td class="rl-act"><button type="button" class="rl-chev" aria-expanded="false">▸</button></td>
</tr>
```

Clicking a row (or its chevron) expands an **inline decision editor**
directly beneath it (`.rl-editor-tr` → `.rl-editor`), never a modal —
staying in the table keeps the surrounding rows visible for comparison:

```html
<div class="rl-editor">
  <div class="ed-source">
    <h4 class="ed-acct">Wages — Site A</h4>
    <p class="ed-srcamt">$41,200<span class="ed-srclab">source amount</span></p>
    <p class="ed-srcfile">Q1 cashflow.xlsx</p>
  </div>
  <div class="ed-form">
    <fieldset class="ed-decision">
      <legend>Her decision for this line</legend>
      <label><input type="radio" name="dec" /> Eligible</label>
      <label><input type="radio" name="dec" /> Excluded from grant</label>
      <label><input type="radio" name="dec" /> Leave not reviewed</label>
    </fieldset>
    <div class="ed-eligible">
      <div class="ed-fieldrow">
        <label class="ed-field">Grant category<select class="ed-cat"></select></label>
        <label class="ed-field">Eligible amount<input class="ed-amt" type="text" /></label>
        <button type="button" class="btn-chip ed-full">Use full source amount ($41,200)</button>
      </div>
      <p class="ed-arith">$38,000 eligible · $3,200 not claimed</p>
      <label class="ed-field ed-notefield">Why this amount? <textarea class="ed-note"></textarea></label>
    </div>
    <div class="ed-actions">
      <button type="button" class="btn-primary ed-savenext">Save &amp; review next</button>
      <button type="button" class="btn-chip ed-save">Save</button>
      <button type="button" class="btn-chip ghost ed-cancel">Cancel</button>
      <span class="ed-progress">Line 12 of 60 in this view</span>
      <span class="ed-nav"><button class="btn-chip ed-prevline">‹</button><button class="btn-chip ed-nextline">›</button></span>
    </div>
  </div>
</div>
```

The three decisions (**Eligible** / **Excluded** / **Leave not reviewed**)
are exhaustive and explicit radio choices, not a checkbox — "excluded" and
"undecided" are deliberately different states (see the project brief's
"three states of empty" rule), never conflated. The `<td>` wrappers
(`rl-dec`, `rl-act`) and section wrapper (`ed-eligible`) carry no styling of
their own — the look comes from their styled children (`.rl-st`, `.rl-chev`,
`.ed-field`); form controls inside `.ed-field` (`ed-cat`, `ed-note`, etc.)
are styled generically via `.ed-field select/input/textarea`, not by their
own class. Live arithmetic feedback
(`.ed-arith`) updates as she types the eligible amount, and turns
`.breach` red if it exceeds the source amount or can't parse as a number.
"Save & review next" jumps to the next undecided line automatically —
the fastest path through a long queue.

## Station 3 — Attribute

Groups by category, biggest money first; each category shows a progress
meter toward "fully placed":

```html
<section class="catgrp">
  <div class="catgrp-head">
    <span class="catgrp-name">Labour</span>
    <span class="catgrp-figs"><b>$38,000</b> of $41,200 placed · $3,200 to place</span>
    <a class="catgrp-sheet">View on sheet →</a>
  </div>
  <div class="catgrp-meter"><i style="width:92%"></i></div>

  <div class="attrib-panel">
    <div class="attrib-head">
      <span class="attrib-period">Feb 2024</span>
      <span class="attrib-elig">$41,200 eligible · 2 milestones running</span>
    </div>
    <div class="cand-row"><span class="cand-id">M3</span><span class="cand-title">Pilot deployment</span>
      <span class="cand-plan">plan $180,000</span><input class="cand-input filled" value="$38,000" /></div>
    <div class="remaining"><span>Remaining this period</span><b>$3,200</b></div>
  </div>
</section>
```

A fully-placed period folds to one line (`.period-done`, ticked ✓, showing
each milestone's placed chip) — click to reopen it. Exactly one running
milestone with nothing placed yet pre-fills the full eligible figure so
she's confirming a default, not typing from scratch — but nothing commits
until she does. `.remaining.negative` (red) is the same "same dollar
claimed twice" guard as the grid — never let attribution silently exceed
what was tagged eligible.
