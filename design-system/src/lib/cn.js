// Tiny classname joiner: filters out falsey values and joins with a space.
export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}
