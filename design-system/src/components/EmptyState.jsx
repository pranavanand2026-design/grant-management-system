import { cn } from "../lib/cn.js";

/**
 * EmptyState — the `.empty` block: a heading, optional copy, optional action.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.children] Body copy / actions.
 */
export function EmptyState({ title, className, children }) {
  return (
    <div className={cn("empty", className)}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
