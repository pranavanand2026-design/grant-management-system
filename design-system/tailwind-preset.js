/*
 * GrantFlow tokens as a Tailwind preset for consumers that prefer utility
 * classes over the component API. The values reference the
 * same CSS custom properties defined in src/tokens.css, so the two stay in sync
 * — import tokens.css once at the app root, then use utilities like
 * `bg-surface`, `text-ink`, `text-on-track`, `rounded-nc`.
 */
export default {
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        sunken: "var(--sunken)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        brand: "var(--brand)",
        "brand-pale": "var(--brand-pale)",
        surface: "var(--surface)",
        "on-track": "var(--on-track)",
        "on-track-bg": "var(--on-track-bg)",
        "at-risk": "var(--at-risk)",
        "at-risk-bg": "var(--at-risk-bg)",
        over: "var(--over)",
        "over-bg": "var(--over-bg)",
      },
      borderRadius: {
        nc: "var(--radius)",
      },
      fontFamily: {
        sans: "var(--sans)",
        mono: "var(--mono)",
      },
    },
  },
};
