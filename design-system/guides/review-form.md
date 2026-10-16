---
category: Review form
---

# Extraction review form

After an agreement PDF is extracted, everything the tool read gets shown as
one long editable form before a grant is created — the human has to see and
confirm every value before it becomes real. This is the app's other major
"trust" surface, distinct from the actuals workflow: it's about *verifying
an extraction*, not *constructing an actual from evidence*.

## Header

```html
<div class="rv-header">
  <div class="rv-header-row">
    <input class="rv-name-input" id="rv-grant-name" placeholder="Grant name" />
    <span class="rv-name-help">Shown in the sidebar and grant list</span>
    <div class="rv-header-actions">
      <button type="button" class="btn-secondary">Cancel</button>
      <button type="button" class="btn-primary">Create grant</button>
    </div>
  </div>
  <div class="rv-header-findings"><!-- unresolved FindingCards surfaced up-front --></div>
</div>
```

## Editable value pattern

Every extracted field renders through the same "editable value" — the
figure as extracted, its provenance tooltip, and a click-to-edit affordance
that marks the field manual once touched:

```jsx
<EditableValue mkey="category.0.total" get={() => c.total} set={(v) => c.total = v}
  fallbackSource="agreement"
  missing={{ reason: "No ceiling could be read for this category.",
             fix: "A missing ceiling means unbounded — enter one if the agreement sets it." }} />
```

Never invent a bare `<input>` for an extracted figure — always go through
this pattern so a manually-corrected value keeps its own provenance mark
(distinct from "the agreement said this") and a missing one explains *why*
it's missing, not just that it is.

## Collapsible milestone editor

Milestones list as collapsible rows, auto-expanded only when they need
attention (an unresolved finding), collapsed otherwise:

```html
<div class="rv-milestones">
  <div class="rv-ms open" data-ms="3">
    <button type="button" class="rv-ms-head">
      <span class="rv-ms-chevron">▾</span>
      <span class="rv-ms-num">3</span>
      <span class="rv-ms-title-wrap">
        <span class="rv-ms-title">Pilot deployment</span>
        <span class="rv-marker" title="Needs review">⚠</span>
      </span>
      <span class="rv-ms-dates">5 Feb 2024 – 5 Aug 2024</span>
    </button>
    <div class="rv-ms-sub">$220,000 · 4 activities · 2 outcomes</div>
    <div class="rv-ms-body">
      <div class="rv-activities">
        <div class="rv-activities-head">Activities</div>
        <div class="rv-act-list">
          <div class="rv-act-row"><span class="rv-act-handle">⠿</span><span class="rv-act-text">Deploy pilot units</span><button class="rv-act-remove">✕</button></div>
        </div>
      </div>
      <!-- inline FindingCards for this milestone's own disagreements -->
    </div>
  </div>
</div>
```

`.rv-act-list` itself is an unstyled wrapper — its look comes entirely from
its styled `.rv-act-row` children. `rv-act-handle` marks activity rows as reorderable (drag handle) — the
extracted activity order isn't assumed correct, she can fix it. A finding
tied to one field renders right where that field lives (`rv-inline-
findings`), not batched at the top — the correction happens in context.

## Tabular sections

Budget categories, periodic caps: plain `<table class="rv-table">` (or the
narrower `.rv-table-narrow` for a two-column cap list), each cell an
`EditableValue`, with a `.rv-total-row` footer summing the column and
flagging (`.rv-amber`) if the sum disagrees with the agreement's own stated
total. Long, rarely-touched sections (reporting obligations) collapse
behind a `.rv-collapsible-head` toggle the same way milestones do.
