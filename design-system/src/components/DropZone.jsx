import { useState } from "react";
import { cn } from "../lib/cn.js";

/**
 * DropZone — the file target (`.dz-zone`): click to browse or drop a file.
 * Keyboard-activatable like every row-as-button in the app.
 *
 * @param {object} props
 * @param {(file: File) => void} props.onFile Called with the dropped/picked file.
 * @param {() => void} [props.onBrowse] Called on click/Enter/Space instead of a
 *   built-in picker (the app routes through its shared hidden input).
 * @param {string} [props.ariaLabel]
 * @param {React.ReactNode} props.children Zone label text.
 */
export function DropZone({ onFile, onBrowse, ariaLabel, className, children, ...rest }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={cn("dz-zone", drag && "drag", className)}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      onClick={onBrowse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          onBrowse && onBrowse(e);
        }
      }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file && onFile) onFile(file);
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
