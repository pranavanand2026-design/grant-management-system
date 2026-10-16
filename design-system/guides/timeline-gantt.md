---
category: Timeline
---

# Milestone timeline (Gantt-style chart)

A real calendar-scaled horizontal timeline — month/year axis, not week
numbers — with per-milestone bars, zoom, and hover-linked list rows. Used on
the Overview tab (read-only) and the Milestones tab (linked to the list).

```html
<div class="tl-wrap">
  <div class="tl-toolbar">
    <span class="tl-toolbar-label">Milestone timeline</span>
    <div class="tl-zoom" aria-label="Timeline zoom">
      <button type="button" class="btn-chip" aria-label="Zoom out">−</button>
      <button type="button" class="btn-chip">Fit</button>
      <button type="button" class="btn-chip" aria-label="Zoom in">+</button>
    </div>
  </div>
  <div class="tl-scroller"><div class="tl-inner">
    <div class="tl-bands"></div>
    <div class="tl-axis"></div>
    <div class="tl-rows">
      <div class="tl-row" data-ms="3">
        <div class="tl-label" title="Pilot deployment"><span class="n">M3</span><span class="t">Pilot deployment</span></div>
        <div class="tl-canvas">
          <div class="tl-bar" data-ms="3" style="left:180px;width:120px"></div>
          <div class="tl-tick" style="left:299px"></div>
        </div>
      </div>
    </div>
  </div></div>
  <div class="tl-hint">Use the scrollbar to move across the timeline. Zoom only when you need more detail.</div>
</div>
```

Key behaviors worth preserving if you build something in this spirit:

- **Sticky left label column.** `.tl-label` (milestone number + truncated
  title) stays visible while `.tl-canvas` scrolls horizontally — the label
  never scrolls off-screen.
- **Real calendar axis.** `.tl-bands` are alternating year background bands;
  `.tl-axis` places year/quarter/month/week labels, culling any that would
  visually collide, densest at high zoom.
- **A milestone with no start date** renders as a diamond (`.tl-diamond`) at
  its due date instead of a bar — never invent a fake start date to force a
  bar.
- **Today marker**: a vertical line (`.tl-today`) with a small "today" label,
  only drawn when today falls inside the visible project period.
- **Zoom** scales pixels-per-day; "Fit" always returns to a level where the
  whole project period is visible with no horizontal scroll.
- **Hover a row** (`.tl-row`) or its bar simultaneously dims every other row
  (`.dim` class) and lifts the hovered bar/diamond (`.lifted`) — this
  hover-link is what connects the timeline to a milestone list beside it.
- Each bar carries a `data-tip` with start/end/estimated-cost — the tooltip
  is plain text lines, not a rich popover.
