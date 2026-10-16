import { cn } from "../lib/cn.js";
import { SOURCE_LABELS } from "../lib/format.js";

/**
 * FindingCard — one cross-validation finding, self-contained: its own title,
 * explanation, source comparisons and resolution options. Resolving records
 * the choice; dismissing records that she saw it. Neither blocks.
 *
 * Mutates the finding object (resolution / dismissed) exactly like the
 * component, then calls `onChange` so the owner can save and re-render.
 *
 * @param {object} props
 * @param {object} props.finding
 * @param {() => void} [props.onChange]
 */
export function FindingCard({ finding: f, onChange }) {
  const sevCls = f.severity === "pass" ? "pass" : f.severity === "info" ? "info" : "";
  const icon = f.severity === "pass" ? "✓" : f.severity === "info" ? "ℹ" : "⚠";
  const open = f.severity === "warning" && !f.resolution && !f.dismissed;
  const chosen = f.resolution ? (f.options || []).find((o) => o.value === f.resolution) : null;
  return (
    <div className={cn("finding-card", sevCls)}>
      <h3>{icon} {f.title}</h3>
      {f.comparisons && f.comparisons.length > 0 && (
        <div className="finding-vals">
          {f.comparisons.map((c, i) => (
            <div className="finding-val" key={i}>
              <div className="src">{SOURCE_LABELS[c.source] || c.source}</div>
              {Array.isArray(c.value)
                ? <ul>{c.value.map((v, j) => <li key={j}>{String(v)}</li>)}</ul>
                : String(c.value)}
            </div>
          ))}
        </div>
      )}
      {f.explanation && <p className="finding-note">{f.explanation}</p>}
      {open && (
        <div className="finding-actions">
          {(f.options || []).map((opt) => (
            <button key={opt.value} type="button" className="btn-chip"
              onClick={() => { f.resolution = opt.value; onChange && onChange(); }}>
              {opt.label}
            </button>
          ))}
          <button type="button" className="btn-chip ghost"
            onClick={() => { f.dismissed = true; onChange && onChange(); }}>
            Dismiss
          </button>
        </div>
      )}
      {f.resolution && (
        <p className="finding-resolved">Resolved: {chosen ? chosen.label : f.resolution}</p>
      )}
    </div>
  );
}
