import { useEffect, useMemo, useState } from "react";
import { PRODUCT_NAME } from "../config/product.js";
import { fmtDate } from "../lib/format.js";
import {
  loadRecipientGrants,
  uploadRecipientDocument,
} from "../api/portal.js";

export function RecipientPortal({ principal, onSignOut }) {
  const [grants, setGrants] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadRecipientGrants().then(setGrants).catch((reason) => setError(reason.message));
  }, []);

  const next = useMemo(() => {
    if (!grants) return null;
    return grants
      .flatMap((grant) => grant.reports.map((report) => ({ grant, report })))
      .filter(({ report }) => report.status !== "submitted" && report.dueDate)
      .sort((a, b) => a.report.dueDate.localeCompare(b.report.dueDate))[0] || null;
  }, [grants]);

  return (
    <div className="recipient-shell">
      <header className="recipient-topbar">
        <div className="recipient-brand">
          <span className="wordmark">{PRODUCT_NAME}</span>
        </div>
        <div className="recipient-account">
          <span>
            <b>{principal.displayName}</b>
            <small>{principal.clientName || "Client portal"}</small>
          </span>
          <button type="button" className="btn-text" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="recipient-main">
        <section className="recipient-welcome">
          <p className="login-eyebrow">Client portal</p>
          <h1>Everything your grant adviser needs from you, in one place.</h1>
          <p>See upcoming reporting dates and upload requested documents securely.</p>
        </section>

        {error && <div className="recipient-alert breach" role="alert">{error}</div>}
        {!grants && !error && <p className="recipient-loading">Loading your deadlines…</p>}
        {grants?.length === 0 && (
          <div className="card recipient-empty">
            <h2>No grant assignments yet</h2>
            <p>Ask your grant adviser to assign your account to a grant.</p>
          </div>
        )}

        {next && <NextAction grant={next.grant} report={next.report} />}

        {grants?.map((grant) => (
          <GrantPortalCard key={grant.id} grant={grant} />
        ))}
      </main>
      <footer className="recipient-footer">
        Need help? Contact your grant adviser.
      </footer>
    </div>
  );
}

function NextAction({ grant, report }) {
  return (
    <section className="recipient-next" aria-labelledby="recipient-next-title">
      <div>
        <p className="recipient-next-label">Next reporting deadline</p>
        <h2 id="recipient-next-title">{report.reportType}</h2>
        <p>{grant.displayName} · {grant.reference}</p>
      </div>
      <div className="recipient-next-date">
        <span>{fmtDate(report.dueDate)}</span>
        <small>
          Covers {fmtDate(report.periodStartDate)}–{fmtDate(report.periodEndDate)}
        </small>
      </div>
    </section>
  );
}

function GrantPortalCard({ grant }) {
  return (
    <section className="recipient-grant">
      <header className="recipient-grant-head">
        <div>
          <p>{grant.clientName}</p>
          <h2>{grant.displayName}</h2>
        </div>
        <span className="recipient-reference">{grant.reference}</span>
      </header>

      <div className="recipient-columns">
        <div>
          <h3>Reporting deadlines</h3>
          <div className="recipient-report-list">
            {grant.reports.map((report) => (
              <ReportUpload key={report.index} grant={grant} report={report} />
            ))}
          </div>
        </div>
        <div>
          <h3>Evidence checklist</h3>
          <ul className="recipient-checklist">
            {grant.requests.length === 0 && (
              <li className="recipient-muted">No evidence requests are open.</li>
            )}
            {grant.requests.map((request) => (
              <li key={request.id} className={request.satisfied ? "done" : ""}>
                <span className="recipient-check" aria-hidden="true">
                  {request.satisfied ? "✓" : ""}
                </span>
                <span>
                  <b>M{request.milestoneNumber}</b> {request.description}
                  <small>
                    {request.satisfied
                      ? `${request.documentCount} document${request.documentCount === 1 ? "" : "s"} received`
                      : "Document required"}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ReportUpload({ grant, report }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [uploads, setUploads] = useState(report.uploads || []);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const result = await uploadRecipientDocument(grant.id, report.index, file);
      setUploads((current) => [result.event, ...current]);
      setMessage(`${file.name} received`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <article className="recipient-report">
      <div className="recipient-report-date">
        <b>{fmtDate(report.dueDate)}</b>
        <span>{report.reportType}</span>
        <small>
          {report.periodStartDate
            ? `${fmtDate(report.periodStartDate)}–${fmtDate(report.periodEndDate)}`
            : "Reporting period not specified"}
        </small>
      </div>
      <label className={`recipient-upload ${uploading ? "busy" : ""}`}>
        <input type="file" onChange={upload} disabled={uploading} />
        {uploading ? "Uploading…" : "Upload documents"}
      </label>
      {message && <p className="recipient-upload-status" role="status">{message}</p>}
      {uploads.length > 0 && (
        <ul className="recipient-uploaded">
          {uploads.map((item) => (
            <li key={item.id}>
              <span>{item.fileName}</span>
              <small>Received {item.createdAt}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
