import { esc, fmtDate, money, SOURCE_LABELS } from "../lib/format.js";

/* <Value> — provenance-aware rendering for sourced figures.
   Every sourced figure renders through here; nothing else is allowed to
   format one:
     agreement → plain (contractual is the default; no mark)
     manual    → a filled trailing dot
     budget_calculator / statement → a short leading tick (ingested)
     derived   → no visual glyph; tooltip shows the arithmetic and source
     null      → em-dash in tertiary ink — never a zero, never a blank
   Both a React component (Value) and an HTML-string form (valueHtml) exist,
   because several surfaces compose issue text as HTML strings. */

export function formatValue(value, format) {
  if (value == null) return null;
  if (format === "money") return money(value);
  if (format === "date") return fmtDate(value);
  if (format === "percent") return `${value}%`;
  if (typeof format === "function") return format(value);
  return esc(String(value));
}

export function valueTooltip(opts) {
  const d = opts.sourceDetail || {};
  if (opts.value == null) {
    const m = opts.missing || {};
    return {
      tip: m.reason || "No source document provides this value.",
      src: m.fix || (opts.source ? "Fill from the " + (SOURCE_LABELS[opts.source] || opts.source) : ""),
    };
  }
  switch (opts.source) {
    case "budget_calculator":
      return {
        tip: d.note || "From the Project Budget Calculator. Application-time phasing, not contractual.",
        src: "Project Budget Calculator · advisory",
      };
    case "application_attachment":
      return {
        tip: d.note || "From the Mandatory Attachment: Milestones. Planning information, not contractual.",
        src: "Mandatory Attachment: Milestones · advisory",
      };
    case "manual":
      return {
        tip: d.note || `Entered by you${d.enteredAt ? ", " + fmtDate(d.enteredAt) : ""}.`,
        src: "Manual entry · advisory",
      };
    case "statement":
      return {
        tip: d.note || [d.account, d.filename, d.period].filter(Boolean).join(" · ") || "From an uploaded statement.",
        src: "Cash flow statement",
      };
    case "derived":
      return { tip: d.note || "Computed by the tool.", src: "Derived from contractual inputs" };
    default:
      return null; // agreement: plain, no tooltip needed
  }
}

export const MARK = {
  manual: '<span class="mk mk-manual" aria-hidden="true"></span>',
  ingested: '<span class="mk mk-ingested" aria-hidden="true"></span>',
};

export function valueHtml(opts) {
  const display = formatValue(opts.value, opts.format);
  const numCls = (opts.format === "money" || opts.format === "percent") ? " v-num" : "";
  const t = valueTooltip(opts);
  const tipAttrs = t
    ? ` data-tip="${esc(t.tip)}" data-tipsrc="${esc(t.src)}" aria-label="${esc(t.tip)}"`
    : "";
  if (display == null) return `<span class="v v-missing${numCls}"${tipAttrs}>—</span>`;
  switch (opts.source) {
    case "manual":
      return `<span class="v v-manual${numCls}"${tipAttrs}>${display}${MARK.manual}</span>`;
    case "budget_calculator":
    case "application_attachment":
    case "statement":
      return `<span class="v v-ingested${numCls}"${tipAttrs}>${MARK.ingested}${display}</span>`;
    case "derived":
      return `<span class="v v-derived${numCls}"${tipAttrs}>${display}</span>`;
    default:
      return `<span class="v${numCls}">${display}</span>`;
  }
}

/* Compatibility helper for concise value call sites. */
export function pv(display, kind, tipTitle, tipBody, source) {
  const srcMap = { advisory: source || "attachment", derived: "derived", plain: "agreement" };
  return valueHtml({
    value: kind === "missing" ? null : (display ?? null),
    format: (v) => v,
    source: kind === "missing" ? source : srcMap[kind] || "agreement",
    sourceDetail: { note: tipBody || tipTitle || undefined },
    missing: { reason: tipBody || tipTitle, fix: source ? "Fill from the " + (SOURCE_LABELS[source] || source) : undefined },
  });
}
export const pvMoney = (v, kind, body, source) => pv(money(v), v == null ? "missing" : kind, null, body, source);

/** React component form. Props: { value, format, source, sourceDetail, missing } */
export function Value(props) {
  return <span dangerouslySetInnerHTML={{ __html: valueHtml(props) }} />;
}
Value.html = valueHtml;
