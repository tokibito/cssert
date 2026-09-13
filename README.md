# cssert

Contract testing for **built** CSS. cssert compares your compiled stylesheet
with the HTML that uses it and reports utility classes that went missing from
the build output.

> **Status: early development. API is unstable.**

## This is not a tool for removing unused CSS

cssert works in the opposite direction. It does not look for CSS that nothing
uses; it looks for classes that your markup uses but your CSS no longer
defines. Nothing is rewritten, ever. cssert is strictly read-only.

## Why

Utility-first frameworks such as Tailwind CSS scan your source files and emit
only the classes they find. A misconfigured scan path or a dynamically built
class name (`text-${color}`) silently produces markup that references classes
that do not exist in the stylesheet. No linter can catch this, because the
defect is a property of the build artefact, not of any single source file.
The only reliable check is to test the artefact itself.

cssert takes two public artefacts, the built CSS and the (ideally rendered)
HTML, and reports the difference. It has no dependency on any build tool,
framework internals or browser.

## Current scope (0.0.1)

The core parser and query model are available:

```ts
import { loadStylesheet } from "cssert";

const sheet = loadStylesheet(css);
sheet.hasClass("md:p-4");            // subject presence
sheet.match("hover:underline");      // matches with pseudo / conditions / layers
sheet.resolveVar("--color-red-500"); // follows var() chains, detects cycles
```

HTML extraction, the `cssert check` CLI, baselines and the assertion helpers
follow in the next releases.

## Name

The name is a nod to thingsinjars/cssert (2011), which approached the same
problem from the rendering side.

## License

MIT © 2026 Shinya Okano
