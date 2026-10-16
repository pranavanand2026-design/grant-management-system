import { useState } from "react";
import { PRODUCT_NAME } from "../config/product.js";
import { DATA, openGrant, show, state } from "../store.js";

/* The rail: brand, nav, clients & grants tree with search. Groups collapse
   per-click; the search filters whole groups by their text. */
export function Sidebar({ onAddGrant, principal, onSignOut }) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState(() => new Set());

  const groups = new Map();
  DATA.grants.forEach((g) => {
    const key = g.client.displayName || g.client.name || "Unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  });

  const navLinks = [
    {
      key: "home",
      label: "Portfolio",
      icon: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h5v4h-5zM11.5 4.5h5v4h-5zM3.5 11.5h5v4h-5zM11.5 11.5h5v4h-5z" /></svg>,
    },
    {
      key: "calendar",
      label: "Reporting calendar",
      icon: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3.5v2M14.5 3.5v2M3.5 7.5h13M4.5 4.5h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM6.5 10.5h2M11.5 10.5h2M6.5 13.5h2M11.5 13.5h2" /></svg>,
    },
    {
      key: "settings",
      label: "Settings",
      icon: <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM10 3.5v1.25M10 15.25v1.25M3.5 10h1.25M15.25 10h1.25M5.4 5.4l.9.9M13.7 13.7l.9.9M14.6 5.4l-.9.9M6.3 13.7l-.9.9" /></svg>,
    },
  ];

  return (
    <aside className="rail">
      <div className="rail-logo">
        <span className="brand-word"><span className="bw-1">{PRODUCT_NAME.toLowerCase()}</span><span className="bw-2">grant compliance</span></span>
      </div>

      <nav className="rail-nav" aria-label="Main">
        {navLinks.map((l) => (
          <a key={l.key} href="#"
            className={"rail-nav-link" + (state.view === l.key || (state.view === "grant" && l.key === "home") ? " active" : "")}
            onClick={(e) => { e.preventDefault(); show(l.key); }}>
            {l.icon}<span>{l.label}</span>
          </a>
        ))}
      </nav>

      <div className="rail-clients-head">
        <h2 className="rail-section">Clients &amp; grants</h2>
        <button className="add-grant" type="button" aria-label="Add grant" data-tip="Add grant"
          onClick={onAddGrant}><span aria-hidden="true">+</span></button>
      </div>
      <div className="rail-search">
        <input type="search" placeholder="Search…" aria-label="Search clients and grants"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="client-tree">
        {[...groups.entries()].map(([name, grants]) => {
          const hay = (name + " " + grants.map((g) => g.displayName).join(" ")).toLowerCase();
          const hidden = q.trim() && !hay.includes(q.trim().toLowerCase());
          const open = !closed.has(name);
          return (
            <div key={name} className={"client-group" + (open ? " open" : "")}
              style={hidden ? { display: "none" } : undefined}>
              <button className="client-head" onClick={() => {
                const next = new Set(closed);
                if (next.has(name)) next.delete(name); else next.add(name);
                setClosed(next);
              }}><span className="tw">▶</span><span>{name}</span><span aria-label={`${grants.length} grant${grants.length === 1 ? "" : "s"}`}>{grants.length}</span></button>
              <div className="client-kids">
                {grants.map((g) => (
                  <button key={g.id}
                    className={"client-kid" + (state.view === "grant" && state.grantId === g.id ? " active" : "")}
                    title={`${g.grant.projectReferenceNumber || ""} ${g.displayName}`.trim()}
                    onClick={() => openGrant(g.id)}>
                    {g.grant.projectReferenceNumber && <span>{g.grant.projectReferenceNumber}</span>}
                    <span>{g.displayName}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="rail-account">
        <span className="rail-avatar" aria-hidden="true">
          {(principal?.displayName || "A").slice(0, 1).toUpperCase()}
        </span>
        <span className="rail-account-copy">
          <b>{principal?.displayName || "Administrator"}</b>
          <small title={principal?.organizationName || undefined}>
            {principal?.role === "grant_adviser" ? "Grant adviser" : "Administrator"}
            {principal?.organizationName ? ` · ${principal.organizationName}` : ""}
          </small>
        </span>
        <button
          type="button"
          className="rail-signout"
          onClick={onSignOut}
          aria-label="Sign out"
          data-tip="Sign out"
        >↗</button>
      </div>
    </aside>
  );
}
