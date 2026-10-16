import { Button } from "@gf-ui";
import { daysUntil, fmtDate, ISO, TODAY } from "../lib/format.js";
import { bump, DATA, goBack, openGrant, session, state } from "../store.js";

function allObligations() {
  const items = [];
  DATA.grants.forEach((g) => (g.reportingObligations || []).forEach((r) => {
    if (ISO.test(r.dueDate || "") && r.status !== "submitted") items.push({ g, r });
  }));
  return items;
}

function CalRow({ g, r, children }) {
  return (
    <div className="cal-row" role="button" tabIndex={0} style={{ cursor: "pointer" }}
      onClick={() => openGrant(g.id, "overview")}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openGrant(g.id, "overview"); } }}>
      {children}
      <div className="cal-copy">
        <h4>{r.reportType} · {g.displayName}</h4>
        <p>{g.client.displayName || g.client.name}{r.periodStartDate ? ` · covering ${fmtDate(r.periodStartDate)} – ${fmtDate(r.periodEndDate)}` : ""}</p>
      </div>
    </div>
  );
}

export function CalendarView() {
  return (
    <section className="view" id="view-calendar">
      <div className="cal-head">
        <div>
          <Button variant="text" className="crumb" onClick={goBack}>Back</Button>
          <h1 className="page-title">Reporting calendar</h1>
        </div>
        <div className="cal-toggle" role="tablist" aria-label="Calendar view">
          {["list", "month"].map((v) => (
            <button key={v} className={"cal-toggle-btn" + (state.calView === v ? " active" : "")}
              role="tab" aria-selected={state.calView === v}
              onClick={() => { state.calView = v; session.calSelected = null; bump(); }}>
              {v === "list" ? "List" : "Month"}
            </button>
          ))}
        </div>
      </div>
      <div className="card"><div id="calendar-body">
        {state.calView === "month" ? <MonthGrid /> : <ListView />}
      </div></div>
    </section>
  );
}

function ListView() {
  const items = allObligations().sort((a, b) => a.r.dueDate.localeCompare(b.r.dueDate));
  if (!items.length) return <div className="empty"><h3>Nothing scheduled</h3></div>;
  return items.map(({ g, r }, i) => {
    const d = new Date(r.dueDate + "T00:00:00");
    return (
      <CalRow key={i} g={g} r={r}>
        <div className="cal-date">
          <div className="m">{d.toLocaleDateString("en-AU", { month: "short" }).toUpperCase()}</div>
          <div className="d">{d.getDate()}</div>
        </div>
      </CalRow>
    );
  });
}

/* Month grid: a dot per report due that day, colour carrying urgency the
   same way the deadline cards do. One day open at a time. */
function MonthGrid() {
  if (!session.calMonth) session.calMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const byDate = new Map();
  allObligations().forEach((it) => {
    if (!byDate.has(it.r.dueDate)) byDate.set(it.r.dueDate, []);
    byDate.get(it.r.dueDate).push(it);
  });

  const year = session.calMonth.getFullYear(), month = session.calMonth.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysCount = new Date(year, month + 1, 0).getDate();
  const todayIso = TODAY.toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(<div key={"e" + i} className="cal-cell cal-cell-empty" />);
  for (let day = 1; day <= daysCount; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const due = byDate.get(iso) || [];
    const overdue = due.length > 0 && iso < todayIso;
    const soon = due.length > 0 && !overdue && daysUntil(iso) <= 7;
    const clickable = due.length > 0;
    cells.push(
      <div key={iso}
        className={`cal-cell ${iso === todayIso ? "today" : ""} ${due.length ? "has-due" : ""} ${session.calSelected === iso ? "selected" : ""}`}
        role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => { session.calSelected = session.calSelected === iso ? null : iso; bump(); } : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); session.calSelected = session.calSelected === iso ? null : iso; bump(); } } : undefined}>
        <span className="cal-daynum">{day}</span>
        {due.length > 0 && (
          <span className="cal-dots">
            {due.slice(0, 4).map((_, i) => <span key={i} className={`cal-dot ${overdue ? "breach" : soon ? "warn" : ""}`} />)}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="cal-month">
        <div className="cal-nav">
          <button className="cal-nav-btn" aria-label="Previous month"
            onClick={() => { session.calMonth = new Date(year, month - 1, 1); session.calSelected = null; bump(); }}>‹</button>
          <div className="cal-nav-label">{first.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}</div>
          <button className="cal-nav-btn" aria-label="Next month"
            onClick={() => { session.calMonth = new Date(year, month + 1, 1); session.calSelected = null; bump(); }}>›</button>
        </div>
        <div className="cal-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {cells}
        </div>
      </div>
      {session.calSelected && byDate.has(session.calSelected) && (
        <div className="cal-day-panel">
          <h4>{fmtDate(session.calSelected)}</h4>
          {byDate.get(session.calSelected).map(({ g, r }, i) => <CalRow key={i} g={g} r={r} />)}
        </div>
      )}
    </>
  );
}
