---
category: Calendar
---

# Reporting calendar

Every unsubmitted, dated reporting obligation across the whole portfolio,
in two interchangeable views (`.cal-toggle`, `role="tablist"`): a flat
chronological list, and a month grid.

## List view

```html
<div class="cal-row" role="button" tabindex="0">
  <div class="cal-date"><div class="m">AUG</div><div class="d">12</div></div>
  <div class="cal-copy">
    <h4>Quarterly report · Pilot Line Automation</h4>
    <p>Acme Robotics Pty Ltd · covering 1 Apr 2024 – 30 Jun 2024</p>
  </div>
</div>
```

## Month view

```html
<div class="cal-month">
  <div class="cal-nav">
    <button class="cal-nav-btn" aria-label="Previous month">‹</button>
    <div class="cal-nav-label">August 2024</div>
    <button class="cal-nav-btn" aria-label="Next month">›</button>
  </div>
  <div class="cal-grid">
    <div class="cal-dow">Sun</div><!-- ×7 -->
    <div class="cal-cell cal-cell-empty"></div>
    <div class="cal-cell today has-due">
      <span class="cal-daynum">12</span>
      <span class="cal-dots"><span class="cal-dot warn"></span></span>
    </div>
  </div>
</div>
<div class="cal-day-panel">
  <h4>12 Aug 2024</h4>
  <!-- .cal-row entries for that day, label/copy only, no date badge (redundant with the heading) -->
</div>
```

- A day cell is only clickable (`role="button"`) if something is due that
  day — don't make every date interactive.
- Dot color carries the same urgency scale as everywhere else: `breach`
  (overdue), `warn` (due within 7 days), plain (further out) — reuse that
  exact three-step scale, don't invent a fourth.
- Only one day panel open at a time; selecting a new day (or navigating
  months) closes the previous one.
- `.cal-month` is an unstyled wrapper — its look comes entirely from its
  styled children (`.cal-nav`, `.cal-grid`, `.cal-dow`, `.cal-cell`).
