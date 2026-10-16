import { cn } from "../lib/cn.js";

const VARIANT_CLASS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  chip: "btn-chip",
  text: "btn-text",
};

/**
 * Button — the system's action control, in the app's own class vocabulary.
 *
 * @param {object} props
 * @param {"primary"|"secondary"|"chip"|"text"} [props.variant="primary"]
 *   `primary` is the one brand-filled call to action per screen, `secondary`
 *   is outlined, `chip` is the compact control used in toolbars and filters,
 *   `text` is a link-like button.
 * @param {boolean} [props.active=false] For `chip`: the selected state.
 * @param {boolean} [props.ghost=false] For `chip`: the quieter dismiss/clear style.
 * @param {React.ReactNode} props.children Button label.
 */
export function Button({ variant = "primary", active = false, ghost = false, className, children, ...rest }) {
  return (
    <button
      type="button"
      className={cn(VARIANT_CLASS[variant] || VARIANT_CLASS.primary,
        ghost && "ghost", active && "active", className)}
      aria-pressed={variant === "chip" && active ? true : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
