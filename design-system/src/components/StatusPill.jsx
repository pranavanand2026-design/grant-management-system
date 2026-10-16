import { cn } from "../lib/cn.js";

/**
 * StatusPill — a status word in the table's `.st` vocabulary. Severity picks
 * the ink: `breach` and `warn` carry the ⚠ glyph, `done` carries ✓.
 *
 * @param {object} props
 * @param {"breach"|"warn"|"done"|"none"|""} [props.sev="none"]
 * @param {React.ReactNode} props.children The status label.
 */
export function StatusPill({ sev = "none", className, children }) {
  const glyph = sev === "breach" || sev === "warn" ? "⚠ " : sev === "done" ? "✓ " : "";
  return (
    <span className={cn("st", `st-${sev || "none"}`, className)}>
      {glyph}
      {children}
    </span>
  );
}
