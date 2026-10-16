import { cn } from "../lib/cn.js";

/**
 * Card — the bordered surface container (`.card`) every panel sits on.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function Card({ className, children, ...rest }) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}
