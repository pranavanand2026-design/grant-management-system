import { useEffect } from "react";
import { cn } from "../lib/cn.js";

/**
 * Modal — the app's dialog: a `.scrim` overlay with a `.modal` card.
 * Controlled: render when `open` is true; Escape and the ✕ button call
 * `onClose`.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.title] Header title.
 * @param {() => void} [props.onClose]
 * @param {React.ReactNode} props.children Body content (`.modal-body`).
 */
export function Modal({ open, title, onClose, className, children }) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="scrim">
      <div className={cn("modal", className)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
