import { useEffect, useRef, useState } from "react";
import { DropZone, Modal, money } from "@gf-ui";
import { crossValidate, extractDocument, fetchGrantTypes } from "../api.js";
import { draftNameFrom } from "../lib/format.js";
import { bump, pickFile, session } from "../store.js";
import { startReview } from "../views/ReviewScreen.jsx";

const DOCS = [
  { key: "agreement", label: "Funding agreement", req: "Required", accept: ".pdf,.docx",
    why: "Recipient, milestones, budget ceilings, annual caps and the reporting schedule.",
    endpoint: "/extract" },
  { key: "attachment", label: "Mandatory Attachment: Milestones", req: "Recommended", accept: ".docx",
    why: "Milestone dates and estimated costs. Without this, the timeline shows milestone deadlines but not their durations.",
    endpoint: "/extract/attachment" },
  { key: "statement", label: "Cashflow Statement", req: "Optional", accept: ".xlsx,.xlsm",
    why: "Actual project spend by account and period, imported straight into the Expenditure tab. Without this, the Expenditure tab shows budget ceilings only.",
    endpoint: "/extract/statement" },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function openModal() {
  session.PENDING = { agreement: null, attachment: null, statement: null };
  session.modalOpen = true;
  bump();
}
export function closeModal() {
  session.modalOpen = false;
  bump();
}

export function NewGrantModal() {
  const open = !!session.modalOpen;
  const [types, setTypes] = useState(null);
  const [program, setProgram] = useState("ac");
  const [log, setLog] = useState([]);          // {text, cls}
  const [zones, setZones] = useState({});      // key -> {state: "done"|"error"|"busy", text}
  const [canExtract, setCanExtract] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLog([]); setZones({}); setCanExtract(false); setProgram("ac");
    fetchGrantTypes().then(setTypes);
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  if (!open) return null;

  const pushLog = (text, cls) => setLog((l) => [...l, { text, cls: cls || "run" }]);
  const setZone = (key, z) => setZones((zs) => ({ ...zs, [key]: z }));

  async function uploadDoc(doc, file) {
    setZone(doc.key, { state: "busy", text: "Reading " + file.name + " …" });
    let res, data;
    try {
      ({ res, data } = await extractDocument(doc.endpoint, file, doc.key === "agreement" ? (program || "ac") : undefined));
    } catch (e) {
      setZone(doc.key, { state: "error", text: "Could not reach the backend on port 8000 — is it running?" });
      return;
    }
    if (!res.ok) {
      setZone(doc.key, { state: "error", text: data.detail || `Extraction failed (${res.status})` });
      pushLog(`${doc.label}: ${data.detail || "failed"}`, "fail");
      pushLog("You can retry with another file, or proceed without this document.", "run");
      return;
    }
    session.PENDING[doc.key] = data;
    setZone(doc.key, { state: "done", text: "✓ " + file.name });

    /* extraction feedback: one line per landmark, from the real result */
    if (doc.key === "agreement") {
      const e = data.entities;
      pushLog(`Reading grant details … found ${e.client.name || "no recipient name"}`, "ok"); await wait(120);
      pushLog(`Reading project sections …`, "ok"); await wait(90);
      pushLog(`Milestones … ${e.milestones.length} found`, "ok"); await wait(90);
      pushLog(`Budget … ${e.budgetCategories.length} categories, ${money(e.grant.totalProjectCost) || "no total"}`, "ok"); await wait(90);
      pushLog(`Annual caps … ${e.annualCaps.length} found`, "ok"); await wait(90);
      pushLog(`Reporting obligations … ${e.reportingObligations.length} found`, "ok");
      setCanExtract(true);
    } else if (doc.key === "attachment") {
      pushLog(`Reading Mandatory Attachment … ${data.milestones.length} milestones, estimates total ${money(data.total_estimated_cost) || "—"}`, "ok");
    } else if (doc.key === "statement") {
      session.PENDING.statementFilename = file.name;
      pushLog(`Reading Cashflow Statement … ${data.rows.length} account-period lines, ${money(data.total) || "—"} over ${data.sheet || "sheet"}`, "ok");
    }
  }

  async function onExtract() {
    if (!session.PENDING || !session.PENDING.agreement) return;
    pushLog("Cross-checking documents …");
    let result;
    try {
      result = await crossValidate({
        agreement: session.PENDING.agreement,
        attachment: session.PENDING.attachment,
      });
    } catch (e) {
      pushLog("Cross-check failed: " + e.message, "fail");
      return;
    }
    session.PENDING.result = result;
    session.modalOpen = false;
    startReview(result.merged, draftNameFrom(result.merged.grant.projectTitle));
  }

  return (
    <Modal open title="New grant" onClose={closeModal}>
      <label className="field-label" htmlFor="grant-program">Grant program</label>
      <select id="grant-program" value={program} onChange={(e) => setProgram(e.target.value)}>
        {types && Object.entries(types)
          .sort(([, a], [, b]) => Number(b.implemented) - Number(a.implemented))
          .map(([value, t]) => (
            <option key={value} value={value} disabled={!t.implemented}>
              {t.implemented ? t.label : t.label + " — Coming soon"}
            </option>
          ))}
      </select>

      <div className="dropzones" id="dropzones">
        {DOCS.map((doc) => {
          const z = zones[doc.key];
          return (
            <div className="dz" data-doc={doc.key} key={doc.key}>
              <div className="dz-head"><span>{doc.label}</span>
                <span className={"req" + (doc.req === "Required" ? " required" : "")}>{doc.req}</span></div>
              <DropZone className={z ? z.state === "done" ? "done" : z.state === "error" ? "error" : "" : ""}
                ariaLabel={`Upload ${doc.label}`}
                onBrowse={() => pickFile(doc.accept, (f) => uploadDoc(doc, f))}
                onFile={(f) => uploadDoc(doc, f)}>
                {z ? z.text : `Drop a ${doc.accept.split(",").map((x) => x.replace(".", "").toUpperCase()).join(" or ")}, or click to browse`}
              </DropZone>
              <div className="dz-why">{doc.why}</div>
            </div>
          );
        })}
      </div>

      <div className="extract-log" id="extract-log" hidden={!log.length} ref={logRef}>
        {log.map((l, i) => <div key={i} className={`log-line ${l.cls}`}>{l.text}</div>)}
      </div>

      <div className="modal-actions">
        <button className="btn-secondary" onClick={closeModal}>Cancel</button>
        <button className="btn-primary" disabled={!canExtract} onClick={onExtract}>Cross-check documents</button>
      </div>
    </Modal>
  );
}
