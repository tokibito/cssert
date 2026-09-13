# Fixtures

Real build output from the frameworks cssert targets. Hand-written CSS cannot
reproduce the quirks of actual output (nesting, `var()` indirection,
`@property`, escaped digits), so these files are generated and committed.

| File | Generator | Source |
| --- | --- | --- |
| `tailwind-v4.css` | `@tailwindcss/cli` 4.3.x (flattened selectors) | `src/tailwind-v4/` |
| `tailwind-v4.0-nested.css` | `@tailwindcss/cli` 4.0.x (`&` nesting) | `src/tailwind-v4/` |
| `tailwind-v3.css` | `tailwindcss` 3.4.x | `src/tailwind-v3/` |
| `unocss.css` | `@unocss/cli` 66.x with `presetWind3` | `src/unocss/` |
| `plain/styles.css` | hand-written, CSS Modules style hashes | — |

Regenerate with `scripts/build-fixtures.sh` (needs network access). Only our
own sources are used as input; no third-party project code is included.
