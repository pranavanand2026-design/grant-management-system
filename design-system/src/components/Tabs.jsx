import { cn } from "../lib/cn.js";

/**
 * Tabs — the underlined tab strip (`.tabs` / `.tab`).
 *
 * @param {object} props
 * @param {{key: string, label: string}[]} props.tabs
 * @param {string} props.active The active tab's key.
 * @param {(key: string) => void} props.onSelect
 * @param {string} [props.ariaLabel]
 */
export function Tabs({ tabs, active, onSelect, ariaLabel, className }) {
  return (
    <nav className={cn("tabs", className)} aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={cn("tab", t.key === active && "active")}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
