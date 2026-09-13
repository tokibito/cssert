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

## Quick start

```sh
npm install --save-dev cssert
npx cssert check --css "dist/**/*.css" --html "build/rendered/**/*.html"
```

```
  ✗ lg:my-10          templates/pricing.html:42:18
                      templates/pricing.html:88:10
  ✗ bg-brand-500      templates/base.html:12:6
  ⚠ text-{{ color }}  templates/card.html:7:22   (dynamic class construction suspected)

  2 missing, 1 dynamic-suspect  ·  scanned 128 document(s) / 3 stylesheet(s)
```

Exit codes: `0` no violations, `1` violations, `2` usage or config error,
`3` internal error. `--format json` emits a machine-readable report;
`--output <path>` writes it to a file.

### Configuration

`cssert.config.ts` (or `.js`, `.mjs`, `.json`) in the working directory:

```ts
import { defineConfig } from "cssert";

export default defineConfig({
  css: ["dist/**/*.css"],
  html: ["build/rendered/**/*.html", "templates/**/*.html"],
  ignore: [/^js-/, "legacy-banner"],
  allow: [],
  attributes: ["class", ":class"],
  baseline: ".cssert/baseline.json",
});
```

Command-line flags override the config file. In JSON configs, strings of the
form `"/^js-/"` are treated as regular expressions.

### Dynamic class names

Tokens containing template syntax (`{{ }}`, `{% %}`, `${ }`, `<% %>`) cannot
be checked and are reported separately as *dynamic-suspect*. They do not fail
the check unless you pass `--fail-on-dynamic`. The best fix is to render your
templates and check the rendered HTML instead (see recipes below); the second
best is to make the class list static.

## Library usage

```ts
import { audit, loadStylesheet } from "cssert";

const result = audit({
  stylesheets: [{ path: "dist/app.css", css }],
  documents: [{ path: "index.html", html }],
});
result.findings; // [{ className, kind: "missing" | "dynamic-suspect", occurrences }]

const sheet = loadStylesheet(css);
sheet.hasClass("md:p-4");            // subject presence
sheet.match("hover:underline");      // matches with pseudo / conditions / layers
sheet.resolveVar("--color-red-500"); // follows var() chains, detects cycles
```

Everything in the core is pure: no I/O, no exceptions. Problems while parsing
are returned as warnings.

## Name

The name is a nod to thingsinjars/cssert (2011), which approached the same
problem from the rendering side.

## License

MIT © 2026 Shinya Okano
