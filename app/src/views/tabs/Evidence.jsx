import { useState } from "react";
import { spCacheFor, spLoadChildren, spLoadGrants, spLoadRoot, saveGrantIfPersisted } from "../../api.js";
import { EvidenceDocuments } from "../../components/EvidenceDocuments.jsx";
import { evidenceGaps } from "../../lib/derive.js";
import { attachEvidence, attachEvidenceFile } from "../../lib/evidence.js";
import { fmtBytes, fmtDate, ISO } from "../../lib/format.js";
import { bump, session, state } from "../../store.js";

/* ----- the grant's SharePoint evidence folder -----
   One folder per grant in the consultancy's evidence site; milestone
   evidence lives in subfolders of it. The tool lists what is actually
   there — names, dates, sizes, verbatim. */

function SpFileRow({ f, extra }) {
  return (
    <div className="sp-file">
      <span className="sp-file-name"><a href={f.webUrl} target="_blank" rel="noopener noreferrer">{f.name}</a></span>
      <span className="sp-file-meta">{f.modified ? fmtDate(f.modified.slice(0, 10)) : ""}{f.size != null ? " · " + fmtBytes(f.size) : ""}</span>
      {extra || null}
    </div>
  );
}

function EvidenceFolder({ g }) {
  if (!g.spFolderPath) {
    const SP_GRANTS = session.SP_GRANTS;
    if (!SP_GRANTS) spLoadGrants();
    return (
      <div className="sp-section" data-connected="false">
        <div className="sp-head">
          <span className="sp-chev" aria-hidden="true">▰</span>
          <h3>Connect project folder</h3><span className="sp-head-sub">SharePoint</span>
        </div>
        <div className="sp-link-form">
          <p className="sp-note">Choose the existing SharePoint folder for this grant. Its milestone folders and files will appear here automatically.</p>
          {!SP_GRANTS && <p className="sp-note">Loading folders…</p>}
          {SP_GRANTS && (SP_GRANTS.error || !SP_GRANTS.folder) && (
            <p className="sp-note sp-error">{String(SP_GRANTS.error || "Unexpected response from the backend.")}</p>
          )}
          {SP_GRANTS && !SP_GRANTS.error && SP_GRANTS.folder && <>
            {(SP_GRANTS.items || []).filter((x) => x.folder).length === 0 && (
              <p className="sp-note">No grant folders yet under “{SP_GRANTS.folder.name}”.</p>
            )}
            {(SP_GRANTS.items || []).filter((x) => x.folder).map((f) => (
              <button key={f.id} type="button" className="sp-folder-head" onClick={() => {
                g.spFolderPath = SP_GRANTS.folder.name + "/" + f.name;
                session.SP_CACHE.delete(g.id);
                saveGrantIfPersisted(g);
                bump();
              }}>
                <span className="sp-chev" aria-hidden="true">▰</span>
                <span className="sp-folder-name">{f.name}</span>
                <span className="sp-folder-count">Use this folder →</span>
              </button>
            ))}
          </>}
        </div>
      </div>
    );
  }

  const cache = spCacheFor(g);
  if (!cache.root && !cache.error && !cache.loading) spLoadRoot(g);
  const folderUrl = (cache.root && cache.root.folder && cache.root.folder.webUrl) || null;

  return (
    <div className="sp-section" data-connected="true">
      <div className="sp-head">
        <span className="sp-chev" aria-hidden="true">▰</span>
        <div>
          <h3>{cache.root?.folder?.name || g.spFolderPath.split("/").pop()}</h3>
          <p className="sp-note">{g.spFolderPath}</p>
        </div>
        <span className="sp-head-sub">● Connected</span>
        <div className="sp-linkbar">
          {folderUrl
            ? <a className="sp-link" href={folderUrl} target="_blank" rel="noopener noreferrer">Open folder ↗</a>
            : null}
          <button type="button" className="btn-chip ghost sp-refresh"
            onClick={() => { session.SP_CACHE.delete(g.id); bump(); }}>Sync</button>
          <button type="button" className="btn-chip ghost" onClick={() => {
            g.spFolderPath = null;
            session.SP_CACHE.delete(g.id);
            session.SP_GRANTS = null;
            saveGrantIfPersisted(g);
            bump();
          }}>Disconnect</button>
        </div>
      </div>

      {!cache.root && !cache.error && <p className="sp-note">Opening project folder…</p>}
      {cache.error === "not_configured" && (
        <p className="sp-note sp-error">SharePoint evidence is not connected. Complete the setup in Workspace settings.</p>
      )}
      {cache.error && cache.error !== "not_configured" && (
        <p className="sp-note sp-error">Couldn't read the folder: {String(cache.error)}</p>
      )}
      {cache.root && <FolderContents g={g} cache={cache} />}
    </div>
  );
}

function FolderContents({ g, cache }) {
  const folders = cache.root.items.filter((x) => x.folder);
  const files = cache.root.items.filter((x) => !x.folder);
  return (
    <>
      {!folders.length && !files.length && (
        <p className="sp-note">The folder is empty. Files and milestone subfolders added in SharePoint show up here.</p>
      )}
      {folders.map((f) => {
        const open = cache.children.has(f.id);
        const entry = cache.children.get(f.id);
        return (
          <div key={f.id} className={"sp-folder" + (open ? " open" : "")}>
            <button type="button" className="sp-folder-head" onClick={() => {
              if (open) { cache.children.delete(f.id); bump(); }
              else spLoadChildren(g, f);
            }}>
              <span className="sp-chev">{open ? "▾" : "▸"}</span>
              <span className="sp-folder-name">{f.name}</span>
              <span className="sp-folder-count">{f.childCount != null ? f.childCount + " item" + (f.childCount === 1 ? "" : "s") : ""}</span>
            </button>
            {open && entry && <>
              {entry.loading && <p className="sp-note">Loading…</p>}
              {entry.error && <p className="sp-note sp-error">{String(entry.error)}</p>}
              {entry.items && !entry.items.length && <p className="sp-note">Empty.</p>}
              {entry.items && entry.items.map((it) => it.folder
                ? <div className="sp-file" key={it.id}><span className="sp-file-name"><span aria-hidden="true">▰</span> <a href={it.webUrl} target="_blank" rel="noopener noreferrer">{it.name}</a></span><span className="sp-file-meta">{it.childCount != null ? it.childCount + " items" : ""}</span></div>
                : <SpFileRow key={it.id} f={it} />)}
            </>}
          </div>
        );
      })}
      {files.map((f) => <SpFileRow key={f.id} f={f} />)}
    </>
  );
}

export function Evidence({ g }) {
  const reps = g.reportingObligations
    .filter((r) => ISO.test(r.dueDate || "") && r.status !== "submitted")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const gaps = evidenceGaps(g);
  const groups = new Map();
  gaps.forEach((req) => {
    const m = g.milestones.find((x) => x.number === req.milestoneNumber);
    const rep = reps.find((r) => m && m.plannedAchievementDate && r.periodEndDate && m.plannedAchievementDate <= r.periodEndDate) || null;
    const key = rep ? `Blocking ${rep.reportType} — due ${fmtDate(rep.dueDate)}` : "Not yet blocking a report";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(req);
  });
  const done = g.evidenceRequirements.filter((r) => r.satisfied);

  return (
    <>
      <EvidenceFolder g={g} />
      {!gaps.length && (
        <div className="banner" style={{ background: "var(--on-track-bg)", borderColor: "#CBE9DC", color: "var(--on-track)" }}>
          Every measurable outcome has evidence. Nothing blocks the next report.
        </div>
      )}
      {[...groups.entries()].map(([label, reqs]) => (
        <div className="ev-group blocking" key={label}>
          <h3>⚠ {label}</h3>
          {reqs.map((req) => (
            <div className="ev-row" key={req.id}>
              <span className="ev-outcome"><b>M{req.milestoneNumber}</b>{req.outcome}<br />
                <span style={{ color: "var(--ink-3)", fontSize: "12px" }}>No document.</span></span>
              <button className="ev-upload" onClick={() => attachEvidence(g, req)}>
                {g.spFolderPath ? "Link evidence" : "Upload evidence"}
              </button>
            </div>
          ))}
        </div>
      ))}
      {done.length > 0 && (
        <div className="ev-group complete">
          <h3>Complete</h3>
          {done.map((req) => (
            <div className="ev-row" key={req.id}>
              <span className="ev-outcome"><b>M{req.milestoneNumber}</b>{req.outcome}</span>
              <EvidenceDocuments documents={req.documents} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* Pick a file from the grant's evidence folder as the document behind an
   outcome. The stored evidence is a pointer — name + SharePoint URL — never
   a copy. Rendered at App level while state.evPicker is set. */
export function EvidencePicker() {
  const [, force] = useState(0);
  const ctx = state.evPicker;
  if (!ctx) return null;
  const { g, req } = ctx;
  const cache = spCacheFor(g);
  if (!cache.root && !cache.error && !cache.loading) spLoadRoot(g, () => force((n) => n + 1));
  const milestone = g.milestones.find((m) => m.number === req.milestoneNumber);
  const preferredFolder = cache.root?.items.find((item) => item.folder && (
    new RegExp(`(^|\\b)M${req.milestoneNumber}(\\b|\\s|[-–—_])`, "i").test(item.name)
    || (milestone?.name && item.name.toLowerCase().includes(milestone.name.toLowerCase()))
  ));
  if (preferredFolder && !cache.children.has(preferredFolder.id)) {
    spLoadChildren(g, preferredFolder, () => force((n) => n + 1));
  }

  const close = () => { state.evPicker = null; bump(); };
  const attach = (f) => {
    req.documents.push({ name: f.name, url: f.webUrl, source: "sharepoint" });
    req.satisfied = true;
    saveGrantIfPersisted(g);
    close();
  };
  const fileRow = (f) => (
    <SpFileRow key={f.id} f={f} extra={
      <button type="button" className="btn-chip sp-attach" onClick={() => attach(f)}>Link this file</button>
    } />
  );

  return (
    <div className="sp-picker-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sp-picker" role="dialog" aria-label="Link evidence from SharePoint"
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <div className="sp-picker-head"><b>Choose evidence</b>
          <button type="button" className="sp-picker-close" aria-label="Close" onClick={close}>✕</button></div>
        <p className="sp-picker-sub">
          <span>SharePoint</span> / {g.spFolderPath} / <b>M{req.milestoneNumber}</b><br />
          Link a file to “{req.outcome}”
        </p>
        <div className="sp-picker-body">
          {!cache.root && !cache.error && <p className="sp-note">Loading the evidence folder…</p>}
          {cache.error === "not_configured" && <p className="sp-note sp-error">SharePoint evidence is not connected. Complete the setup in Workspace settings.</p>}
          {cache.error && cache.error !== "not_configured" && <p className="sp-note sp-error">Couldn't read the folder: {String(cache.error)}</p>}
          {cache.root && <>
            {cache.root.items.filter((x) => x.folder).map((fold) => {
              const entry = cache.children.get(fold.id);
              const open = !!entry;
              return (
                <div key={fold.id}>
                  <button type="button" className="sp-folder-head" onClick={() => {
                    if (open) { cache.children.delete(fold.id); force((n) => n + 1); }
                    else spLoadChildren(g, fold, () => force((n) => n + 1));
                  }}>
                    <span className="sp-chev">{open ? "▾" : "▸"}</span>
                    <span className="sp-folder-name">{fold.name}</span>
                    <span className="sp-folder-count">{fold.childCount != null ? fold.childCount + " item" + (fold.childCount === 1 ? "" : "s") : ""}</span>
                  </button>
                  {open && entry.loading && <p className="sp-note">Loading…</p>}
                  {open && entry.error && <p className="sp-note sp-error">{String(entry.error)}</p>}
                  {open && entry.items && entry.items.filter((x) => !x.folder).map(fileRow)}
                </div>
              );
            })}
            {cache.root.items.filter((x) => !x.folder).map(fileRow)}
            {!cache.root.items.length && <p className="sp-note">The folder is empty.</p>}
          </>}
        </div>
        <div className="sp-picker-foot">
          <button type="button" className="btn-chip ghost" onClick={() => {
            const { g: g2, req: req2 } = ctx;
            close();
            attachEvidenceFile(g2, req2);
          }}>Upload from computer instead</button>
        </div>
      </div>
    </div>
  );
}
