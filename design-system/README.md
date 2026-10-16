# @grantflow/ui

The shared component and token library for GrantFlow. The application
imports its source directly during development, while the package build emits
ES and UMD bundles for other consumers.

## Structure

```text
design-system/
  src/
    components/       Reusable React components
    lib/              Formatting and class-name helpers
    app.css           Semantic application styles
    tokens.css        Colour, type, spacing, and state tokens
    index.js          Public package exports
  fonts/              Licensed webfont assets
  guides/             Interaction and domain presentation guidance
  demo.html           Component catalogue
```

## Build

```bash
npm install
npm run build
```

Build output is written to `dist/` and is not source-controlled.

## Components

| Component | Purpose |
|---|---|
| `Button` | Primary, secondary, chip, and text actions |
| `Card` | Standard bordered surface |
| `Modal` | Accessible dialog shell |
| `Tabs` | Application section navigation |
| `DropZone` | Drag-and-browse file input |
| `EmptyState` | Empty workflow guidance |
| `StatusPill` | Semantic workflow status |
| `FindingCard` | Cross-document validation finding |
| `TipLayer` | Shared contextual tooltips |
| `Value` | Amount or date with explicit provenance |

Formatting helpers and source labels are exported from `src/index.js`.

## Styling contract

Components emit semantic classes whose visual rules live in `src/app.css`.
Colour, typography, radius, and state styling come from CSS custom properties
in `src/tokens.css`.

- Use an existing component before creating a local variant.
- Use tokens instead of literal colours or spacing values.
- Preserve provenance by rendering sourced figures with `Value`.
- Render missing financial data as missing, never as zero.
- Add a component only when the pattern is reusable across workflows.

## Extending the library

1. Add the component under `src/components/`.
2. Give it a focused prop contract and accessible native semantics.
3. Add semantic styles using existing tokens.
4. Export it from `src/index.js`.
5. Add it to `demo.html` when visual behavior needs a catalogue example.
6. Run `npm run build` and the application test suite.
