---
category: Evidence
---

# Evidence tracking

The Evidence tab has two parts: a live SharePoint folder browser (the tool
never stores evidence files itself, only links to where they really live),
and a gap list — which measurable outcomes still lack a document.

## Evidence folder (`.sp-section`)

Unlinked state — pick which SharePoint folder is this grant's evidence
folder:

```html
<div class="sp-section">
  <div class="sp-head"><h3>Evidence folder</h3><span class="sp-head-sub">SharePoint</span></div>
  <div class="sp-link-form">
    <p class="sp-note">Link this grant to its evidence folder in SharePoint…</p>
    <button type="button" class="btn-chip">Pilot Line Automation — GRANT-001</button>
  </div>
</div>
```

Linked state — a live, lazily-expanding folder tree, verbatim names/dates/
sizes, nothing cached beyond the session:

```html
<div class="sp-section">
  <div class="sp-head"><h3>Evidence folder</h3><span class="sp-head-sub">SharePoint</span>
    <div class="sp-linkbar">
      <a class="sp-link" href="#" target="_blank">Open in SharePoint ↗</a>
      <button type="button" class="btn-chip ghost sp-refresh">Refresh</button>
      <button type="button" class="btn-chip ghost">Change folder</button>
    </div>
  </div>
  <div class="sp-folder open">
    <button type="button" class="sp-folder-head">
      <span class="sp-chev">▾</span><span class="sp-folder-name">M3 — Pilot deployment</span>
      <span class="sp-folder-count">4 items</span>
    </button>
    <div class="sp-file">
      <span class="sp-file-name"><a href="#" target="_blank">deployment-report.pdf</a></span>
      <span class="sp-file-meta">12 Aug 2024 · 2.1 MB</span>
    </div>
  </div>
</div>
```

A folder is a plain disclosure — click the head to lazily fetch and expand
its children (`▸` → `▾`), never fetch the whole tree eagerly.

## Evidence gaps

Grouped by whether the gap is already blocking an upcoming report or not —
that grouping is the whole point (it tells her what's urgent vs.
housekeeping):

```html
<div class="ev-group blocking">
  <h3>⚠ Blocking Quarterly report — due 12 Aug 2024</h3>
  <div class="ev-row">
    <span class="ev-outcome"><b>M3</b>10 units deployed to customer site<br /><span style="color:var(--ink-3);font-size:12px">No document.</span></span>
    <button class="ev-upload">Upload +</button>
  </div>
</div>
<div class="ev-group complete">
  <h3>Complete</h3>
  <div class="ev-row">
    <span class="ev-outcome"><b>M2</b>Prototype validated</span>
    <span class="out-docs">✓ deployment-report.pdf</span>
  </div>
</div>
```

If nothing is missing, a single green confirmation banner replaces the gap
groups entirely: `<div class="banner">Every measurable outcome has
evidence. Nothing blocks the next report.</div>` — don't show an empty
"gaps" heading with nothing under it.

## Evidence picker (modal)

Clicking "Upload +" opens a scrim-backed picker (reuses the same SharePoint
tree browsing as the folder view) scoped to attaching one file as proof of
one specific outcome:

```html
<div class="sp-picker-scrim">
  <div class="sp-picker" role="dialog" aria-label="Link evidence from SharePoint">
    <div class="sp-picker-head"><b>Link evidence from SharePoint</b><button class="sp-picker-close" aria-label="Close">✕</button></div>
    <p class="sp-picker-sub">M3 · 10 units deployed to customer site</p>
    <div class="sp-picker-body"><!-- same folder/file rows as above, each with an "Attach" btn-chip --></div>
    <div class="sp-picker-foot">
      <button type="button" class="btn-chip ghost">Record an uploaded filename instead…</button>
    </div>
  </div>
</div>
```

The footer's fallback link matters: SharePoint being unreachable must never
block recording that evidence exists — it degrades to typing a filename by
hand rather than blocking the workflow.
