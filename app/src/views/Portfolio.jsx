import { useState } from "react";
import { esc, money } from "@gf-ui";
import { loadStoredGrants } from "../api.js";
import {
  chipCount, PORT, PORT_CHIPS, PORT_SORTS, PORT_STATUS, portRow, savePortFilters,
} from "../lib/issues.js";
import { daysUntil, dueText, fmtDate, ISO } from "../lib/format.js";
import { DATA, openGrant, session } from "../store.js";

/* The portfolio: attention strip, work queue, all-grants table — all built
   from the one issue list so they can never disagree. */
export function Portfolio({ onAddGrant }) {
  const [, force] = useState(0);
  const repaint = () => force((n) => n + 1);

  const rows = DATA.grants.map(portRow);
  const clients = new Set(DATA.grants.map((g) => g.client.displayName || g.client.name)).size;

  return (
    <section className="view" id="view-home">
      <header className="port-head">
        <div>
          <h1 className="page-title">Grant portfolio</h1>
          <p className="port-sub">
            {DATA.grants.length
              ? `${DATA.grants.length} grant${DATA.grants.length === 1 ? "" : "s"} across ${clients} client${clients === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <button className="btn-primary" type="button" onClick={onAddGrant}>Add grant</button>
      </header>

      <div id="port-notice">
        {session.STORE_STATE === "loading" && <p className="port-loading" role="status">Loading saved grants…</p>}
        {session.STORE_STATE === "error" && (
          <div className="port-error" role="alert">
            <span>The backend can't be reached, so uploaded grants aren't shown — only the built-in sample grants. Changes made now won't be saved.</span>
            <button type="button" className="btn-chip" onClick={() => loadStoredGrants()}>Retry</button>
          </div>
        )}
      </div>

      <AttnStrip rows={rows} repaint={repaint} />
      <Queue rows={rows} />
      <PortTable rows={rows} repaint={repaint} onAddGrant={onAddGrant} />
    </section>
  );
}

function AttnStrip({ rows, repaint }) {
  if (!DATA.grants.length) return <div id="attn-strip" />;
  const cells = PORT_CHIPS.map((c) => ({ c, n: chipCount(rows, c.key) })).filter((x) => x.n > 0);
  return (
    <div id="attn-strip" role="group" aria-label="Portfolio attention summary">
      {!cells.length && <p className="attn-none">No open issues across the portfolio.</p>}
      {cells.map(({ c, n }) => (
        <button key={c.key} type="button" className={`attn-cell ${c.sev}`}
          aria-pressed={PORT.kinds.has(c.key)}
          onClick={() => {
            if (PORT.kinds.has(c.key)) PORT.kinds.delete(c.key); else PORT.kinds.add(c.key);
            savePortFilters();
            repaint();
          }}>
          <span className="attn-n">{n}</span><span className="attn-lab">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

function Queue({ rows }) {
  if (!DATA.grants.length) return <section id="queue-section" />;
  const q = rows
    .filter((r) => r.top && r.top.rank <= 8)
    .sort((a, b) => a.top.rank - b.top.rank || cmpDue(a, b));
  return (
    <section id="queue-section" aria-labelledby="queue-head">
      <h2 className="port-section-head" id="queue-head">Needs attention <span className="port-badge">{q.length}</span></h2>
      {!q.length && <NothingDue rows={rows} />}
      {q.map((r, i) => <QueueRow key={r.g.id + i} r={r} />)}
    </section>
  );
}
function cmpDue(a, b) {
  const da = a.rep && ISO.test(a.rep.dueDate || "") ? a.rep.dueDate : "9999-12-31";
  const db = b.rep && ISO.test(b.rep.dueDate || "") ? b.rep.dueDate : "9999-12-31";
  return da.localeCompare(db);
}
function NothingDue({ rows }) {
  const nxt = rows
    .filter((r) => r.rep && ISO.test(r.rep.dueDate || ""))
    .sort((a, b) => a.rep.dueDate.localeCompare(b.rep.dueDate))[0];
  return (
    <p className="queue-clear">
      Nothing needs your attention right now.
      {nxt ? ` Next deadline: ${nxt.rep.reportType} for ${nxt.g.displayName}, due ${fmtDate(nxt.rep.dueDate)}.` : ""}
    </p>
  );
}
function QueueRow({ r }) {
  const { g, issues, top } = r;
  const sev = PORT_STATUS[top.rank].sev;
  const also = issues.slice(1).filter((i) => i.rank <= 8);
  const whyTip = (top.tip ? top.tip + "\n" : "") + top.why;
  return (
    <article className={`q-row ${sev}`}
      onClick={(e) => { if (!e.target.closest("button, a")) openGrant(g.id); }}>
      <div className="q-main">
        <div className="q-who">
          <span className="q-client">{g.client.displayName || g.client.name}</span>
          <button type="button" className="q-grant"
            onClick={(e) => { e.stopPropagation(); openGrant(g.id); }}>{g.displayName}</button>
        </div>
        <p className="q-issue">
          <span data-tip={whyTip} data-tipsrc="Why this is listed" dangerouslySetInnerHTML={{ __html: top.text }} />
        </p>
        {top.money && <p className="q-money" dangerouslySetInnerHTML={{ __html: top.money }} />}
        {also.length > 0 && (
          <div className="q-also">
            <span className="q-also-head">Also requires attention</span>
            <ul>
              {also.slice(0, 3).map((i, idx) => (
                <li key={idx}>
                  <button type="button" className="q-also-link"
                    onClick={(e) => { e.stopPropagation(); i.go(); }}
                    dangerouslySetInnerHTML={{ __html: i.text }} />
                </li>
              ))}
              {also.length > 3 && <li className="q-also-more">+{also.length - 3} more inside the grant</li>}
            </ul>
          </div>
        )}
      </div>
      <div className="q-side">
        <button type="button" className="btn-chip q-go"
          onClick={(e) => { e.stopPropagation(); top.go(); }}>{top.actionLabel}</button>
      </div>
    </article>
  );
}

function PortTable({ rows, repaint, onAddGrant }) {
  if (!DATA.grants.length) {
    return (
      <section id="all-grants">
        <div className="empty">
          <h3>No grants yet</h3>
          <p>Upload a funding agreement to build the first dashboard.</p>
          <button className="btn-primary" onClick={onAddGrant}>Add grant</button>
        </div>
      </section>
    );
  }

  const q = PORT.q.trim().toLowerCase();
  const filtersOn = q || PORT.kinds.size || PORT.life !== "all";
  let shown = rows.filter((r) => {
    if (PORT.life !== "all" && r.life !== PORT.life) return false;
    if (PORT.kinds.size && !r.issues.some((i) => PORT.kinds.has(i.kind))) return false;
    if (q) {
      const hay = `${r.g.client.displayName || ""} ${r.g.client.name || ""} ${r.g.displayName} ${r.g.grant.projectReferenceNumber || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp = PORT_SORTS[PORT.sort] || PORT_SORTS.attention;
  shown = shown.slice().sort((a, b) => cmp(a, b) * PORT.dir);

  const sortBtn = (key, label) => (
    <th scope="col" className={key === "funds" ? "num" : undefined} data-sortkey={key}
      aria-sort={PORT.sort === key ? (PORT.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => {
        if (PORT.sort === key) PORT.dir = -PORT.dir;
        else { PORT.sort = key; PORT.dir = 1; }
        savePortFilters(); repaint();
      }} dangerouslySetInnerHTML={{ __html: label }} />
    </th>
  );

  return (
    <section id="all-grants" aria-labelledby="all-grants-head">
      <h2 className="port-section-head" id="all-grants-head">All grants</h2>
      <div className="port-controls">
        <input type="search" id="port-q" placeholder="Search client, grant or reference…"
          aria-label="Search grants by client, grant name or reference number"
          value={PORT.q}
          onChange={(e) => { PORT.q = e.target.value; savePortFilters(); repaint(); }} />
        <select id="port-life" aria-label="Filter by project state" value={PORT.life}
          onChange={(e) => { PORT.life = e.target.value; savePortFilters(); repaint(); }}>
          <option value="all">All states</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="not_started">Not yet started</option>
        </select>
        <span className="port-matches" id="port-matches" aria-live="polite">
          {filtersOn ? `Showing ${shown.length} of ${rows.length} grants` : `${rows.length} grants`}
        </span>
        {filtersOn && (
          <button type="button" className="btn-chip ghost" id="port-clear"
            onClick={() => {
              PORT.q = ""; PORT.kinds.clear(); PORT.life = "all";
              savePortFilters(); repaint();
            }}>Clear filters</button>
        )}
      </div>
      <div className="card port-card"><div className="port-scroll">
        <table className="port-table">
          <thead><tr>
            {sortBtn("client", "Client &amp; grant")}
            {sortBtn("deadline", "Next report")}
            {sortBtn("attention", "Attention")}
            {sortBtn("funds", "Maximum funds")}
            <th scope="col"><span className="vis-hidden">Open</span></th>
          </tr></thead>
          <tbody>
            {shown.map((r) => <TableRow key={r.g.id} r={r} />)}
            {session.STORE_STATE === "loading" && (
              <tr className="pt-sk" aria-hidden="true">
                <td><span className="sk" style={{ width: "60%" }} /><span className="sk" style={{ width: "38%" }} /></td>
                <td><span className="sk" style={{ width: "55%" }} /></td>
                <td><span className="sk" style={{ width: "42%" }} /></td>
                <td className="num"><span className="sk" style={{ width: "34%", marginLeft: "auto" }} /></td><td></td>
              </tr>
            )}
            {!shown.length && session.STORE_STATE !== "loading" && (
              <tr className="pt-empty"><td colSpan={5}>No grants match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div></div>
    </section>
  );
}

function TableRow({ r }) {
  const [openIssues, setOpenIssues] = useState(false);
  const { g, issues, status, rep, life } = r;
  const sevGlyph = status.sev === "breach" || status.sev === "warn" ? "⚠ " : status.sev === "done" ? "✓ " : "";
  let nextHtml;
  if (rep && ISO.test(rep.dueDate || "")) {
    const d = daysUntil(rep.dueDate);
    const dateSev = d < -365 ? "" : d < 0 ? "pt-over" : d <= 7 ? "pt-soon" : "";
    nextHtml = `<span class="pt-date ${dateSev}">${dueText(rep.dueDate)}</span><span class="pt-type">${esc(rep.reportType)}</span>`;
  } else if (rep) {
    nextHtml = `<span class="pt-date pt-undated">${esc(rep.dueDate || "No fixed date")}</span><span class="pt-type">${esc(rep.reportType)}</span>`;
  } else {
    const anyUnsub = (g.reportingObligations || []).some((x) => x.status !== "submitted");
    nextHtml = `<span class="pt-none">${anyUnsub ? "No dated reports pending" : "All reports submitted"}</span>`;
  }
  const more = issues.length - 1;
  return (
    <>
      <tr className={`port-row ${life === "completed" ? "pt-done" : ""}`}
        onClick={(e) => { if (!e.target.closest("button, a")) openGrant(g.id); }}>
        <td className="pt-who">
          <span className="pt-client">{g.client.displayName || g.client.name}</span>
          <span className="pt-grant">{g.displayName}</span>
        </td>
        <td className="pt-next" dangerouslySetInnerHTML={{ __html: nextHtml }} />
        <td className="pt-attn">
          <span className={`st st-${status.sev || "none"}`}>{sevGlyph}{status.label}</span>
          {more > 0 && (
            <button type="button" className="pt-more" aria-expanded={openIssues}
              onClick={(e) => { e.stopPropagation(); setOpenIssues(!openIssues); }}>+{more} more</button>
          )}
        </td>
        <td className="num pt-funds" dangerouslySetInnerHTML={{ __html: money(g.grant.maximumFunds) ?? '<span class="v-missing">—</span>' }} />
        <td className="pt-act">
          <button type="button" className="pt-open" aria-label={`Open ${g.displayName}`}
            onClick={(e) => { e.stopPropagation(); openGrant(g.id); }}>Open grant</button>
        </td>
      </tr>
      {more > 0 && openIssues && (
        <tr className="pt-issues"><td colSpan={5}>
          <ul className="pt-issue-list">
            {issues.map((i, idx) => (
              <li key={idx}>
                <button type="button" onClick={i.go}>
                  <span className="pt-issue-text" dangerouslySetInnerHTML={{ __html: i.text }} />
                  <span className="pt-issue-act">{i.actionLabel} →</span>
                </button>
              </li>
            ))}
          </ul>
        </td></tr>
      )}
    </>
  );
}
