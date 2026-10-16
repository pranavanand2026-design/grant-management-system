---
category: App shell
---

# App shell — sidebar rail + page structure

The whole app is one persistent left rail (`.rail`) plus a swapped main
section per route. This is the outermost frame everything else lives
inside — build any real screen with this shell, not a bare page.

## Sidebar rail (`.rail`)

```html
<aside class="rail">
  <div class="rail-logo">
    <span class="brand-ring"><img src="logo-mark.png" alt="" /></span>
    <span class="brand-word"><span class="bw-1">grantflow</span><span class="bw-2">grant compliance</span></span>
  </div>

  <nav class="rail-nav" aria-label="Main">
    <a href="#" class="rail-nav-link active">Portfolio</a>
    <a href="#" class="rail-nav-link">Reporting calendar</a>
    <a href="#" class="rail-nav-link">Settings</a>
  </nav>

  <div class="rail-clients-head">
    <h2 class="rail-section">Clients &amp; grants</h2>
    <button class="add-grant" type="button" aria-label="Add grant"><span aria-hidden="true">+</span></button>
  </div>
  <div class="rail-search">
    <input type="search" placeholder="Search…" aria-label="Search clients and grants" />
  </div>

  <div class="client-tree">
    <div class="client-group open">
      <button class="client-head"><span class="tw">▶</span> Acme Robotics Pty Ltd</button>
      <div class="client-kids">
        <button class="client-kid">GRANT-001 — Pilot Line Automation</button>
      </div>
    </div>
  </div>
</aside>
```

- Clients group their grants into collapsible sections (`.client-group.open`
  toggles `.client-kids`); a plain `<input type="search">` filters the whole
  tree by text, hiding non-matching groups (`display:none`, not removal).
- The rail is always present — a "screen" is whatever renders beside it,
  never a full-bleed page that replaces it.

## Page section pattern

Every route's content is one `<section class="view" id="view-...">`. A page
almost always opens with a title row:

```html
<header class="port-head">
  <div>
    <h1 class="page-title">Grant portfolio</h1>
    <p class="port-sub">14 grants across 6 clients</p>
  </div>
  <button class="btn-primary" type="button">Add grant</button>
</header>
```

`.page-title` is the one heading style used at the top of every route
(Portfolio, Calendar, Settings) — don't invent a second "page header" look.

## Card surfaces

`.card` is the one bordered-surface primitive (already a design-system
component). Two variants seen throughout the app: a plain padded card
(`<div class="card">…</div>`), and a card wrapping a scrollable table
(`<div class="card port-card"><div class="port-scroll">…</div></div>`) — the
scroll wrapper is what lets a wide table scroll horizontally inside a fixed
card without breaking the page layout.

## Empty state

Every list/section that can be empty uses the same block, not a bespoke
message:

```html
<div class="empty">
  <h3>No grants yet</h3>
  <p>Upload a funding agreement to build the first dashboard.</p>
  <button class="btn-primary">Add grant</button>
</div>
```
