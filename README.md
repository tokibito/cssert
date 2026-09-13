# cssert

[![npm](https://img.shields.io/npm/v/%40cssert%2Fcli)](https://www.npmjs.com/package/@cssert/cli)

Contract testing for **built** CSS. cssert compares your compiled stylesheet
with the HTML that uses it and reports utility classes that went missing from
the build output.

> **Status: early development. API is unstable.**

## This is not a tool for removing unused CSS

cssert works in the opposite direction. It does not look for CSS that nothing
uses; it looks for classes that your markup uses but your CSS no longer
defines. Nothing is rewritten, ever. cssert is strictly read-only.

## Why a linter cannot catch this

Utility-first frameworks such as Tailwind CSS scan your source files and emit
only the classes they find. A content path missing from the configuration, a
template living in an installed package, or a class name assembled at runtime
(`text-${color}`) silently produces markup that references classes the
stylesheet does not contain. Every source file is individually correct, so no
linter, type checker or template validator can see the problem. The defect is
a property of the **build artefact**, and the only reliable check is to test
the artefact itself.

cssert takes two public artefacts, the built CSS and the (ideally rendered)
HTML, and reports the difference. It has no dependency on any build tool,
framework internals or browser, so it works the same for Tailwind v3, Tailwind
v4, UnoCSS, PurgeCSS output and hand-written CSS.

## Quick start

```sh
npm install --save-dev @cssert/cli
npx cssert check --css "dist/**/*.css" --html "build/rendered/**/*.html"
```

The package is published as `@cssert/cli` (npm rejects the bare name
`cssert` as too similar to `assert`); the installed binary is `cssert`.
Without installing, run `npx @cssert/cli check ...`.

```
  ✗ lg:my-10          templates/pricing.html:42:18
                      templates/pricing.html:88:10
  ✗ bg-brand-500      templates/base.html:12:6
  ⚠ text-{{ color }}  templates/card.html:7:22   (dynamic class construction suspected)

  2 missing, 1 dynamic-suspect  ·  scanned 128 document(s) / 3 stylesheet(s)
```

Exit codes: `0` no violations, `1` violations, `2` usage or config error,
`3` internal error.

## Server-side rendering: check rendered pages, not templates

cssert's main audience is server-rendered applications, where the CSS build
and the templates live in different toolchains and drift apart quietly. Render
the pages you care about to files as part of CI, then check the files. Each
recipe shows a small "dump rendered HTML" command plus the cssert step:

- [Django](docs/recipes/django.md)
- [Rails](docs/recipes/rails.md)
- [Laravel](docs/recipes/laravel.md)

Checking raw templates also works, but template syntax inside `class`
attributes is reported as *dynamic-suspect* instead of verified.

## Commands

### `cssert check`

```
cssert check [options]

  --css <glob>           Built CSS files (repeatable, comma-separated allowed)
  --html <glob>          HTML documents to check (repeatable)
  --config <path>        Config file (default: cssert.config.{ts,js,mjs,json} in cwd)
  --baseline <path>      Baseline file (default: .cssert/baseline.json when present)
  --format <fmt>         human | json | github | sarif (default: human)
  --output <path>        Write the report to a file instead of stdout
  --attributes <list>    HTML attributes to scan (default: class)
  --ignore <pattern>     Extra class or /regex/ to ignore (repeatable)
  --allow <pattern>      Class or /regex/ that may be absent from the CSS (repeatable)
  --strict-parse         Treat CSS parse warnings as errors
  --max-warnings <n>     Fail when parse warnings exceed <n>
  --fail-on-dynamic      Also fail when dynamic-suspect tokens are found
  --no-color             Disable colours
```

A class counts as defined when it appears in **any** selector of any
stylesheet, including as an ancestor (`.group:hover .foo` defines `group`),
so Tailwind's `group`/`peer` markers are not false positives.

### `cssert baseline create | prune`

The first run on an existing project usually reports many findings. Freeze
them and fail only on new ones:

```sh
npx @cssert/cli baseline create --css "dist/**/*.css" --html "build/**/*.html"
npx @cssert/cli check ...        # .cssert/baseline.json is applied automatically
npx @cssert/cli baseline prune   # drop entries that have been fixed
```

Commit `.cssert/baseline.json` and shrink it over time. Entries are keyed by
class name, so moving a usage to another template does not create a new
finding.

### `cssert budget`

A misconfigured content path makes Tailwind emit almost nothing, and every
page still "works" in development because of the browser cache. `budget`
records the number of classes and the gzip size of the build and fails when
they drop by more than the allowed amount:

```sh
npx @cssert/cli budget --css "dist/**/*.css"                  # first run writes .cssert/budget.json
npx @cssert/cli budget --css "dist/**/*.css" --max-drop 10%   # later runs compare against it
npx @cssert/cli budget --css "dist/**/*.css" --update         # accept the current size
```

## Configuration

`cssert.config.ts` (or `.js`, `.mjs`, `.json`) in the working directory:

```ts
import { defineConfig } from "@cssert/cli";

export default defineConfig({
  css: ["dist/**/*.css"],
  html: ["build/rendered/**/*.html", "templates/**/*.html"],
  ignore: [/^js-/, "legacy-banner"],
  allow: [],
  attributes: ["class", ":class"],
  baseline: ".cssert/baseline.json",
  budget: { snapshot: ".cssert/budget.json", maxDrop: "10%" },
});
```

Command-line flags override the config file. In JSON configs, strings of the
form `"/^js-/"` are treated as regular expressions. TypeScript configs load
natively on Node 22.18+/24+; on older runtimes install `jiti` or use `.mjs`.

Default ignore patterns (extend with `ignore`, disable with
`useDefaultIgnore: false`): `js-*`, `is-*`, `has-*`, `active`, `disabled`,
`wp-*`, `woocommerce-*`, `swiper-*`, `leaflet-*`.

### Dynamic class names

Tokens containing template syntax (`{{ }}`, `{% %}`, `${ }`, `<% %>`) cannot
be checked and are reported separately as *dynamic-suspect*. They do not fail
the check unless you pass `--fail-on-dynamic`. The best fix is to render your
templates and check the rendered HTML; the second best is to make the class
list static. For attributes that hold expressions (Alpine's `:class`, Vue's
`:class`), list them in `attributes` and cssert reads the string literals
inside them.

## CI

GitHub Actions annotations and SARIF for code scanning:

```yaml
- run: npx @cssert/cli check --format github
# or
- run: npx @cssert/cli check --format sarif --output cssert.sarif || true
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: cssert.sarif
```

## Library usage

### Deriving findings

```ts
import { audit, loadStylesheet } from "@cssert/cli";

const result = audit({
  stylesheets: [{ path: "dist/app.css", css }],
  documents: [{ path: "index.html", html }],
});
result.findings; // [{ className, kind: "missing" | "dynamic-suspect", occurrences }]
```

### Explicit assertions

For classes that cannot be derived from HTML: safelisted classes, classes
built at runtime, and your own design tokens.

```ts
import { expectClass, loadStylesheet } from "@cssert/cli";

const sheet = loadStylesheet(css);

expectClass(sheet, "bg-brand-500").toExist();
expectClass(sheet, "bg-brand-500").toDeclare("background-color");
expectClass(sheet, "bg-brand-500").toResolveTo("background-color", "#0f62fe");
expectClass(sheet, "md:flex").under("(width >= 48rem)").toDeclare("display");
expectClass(sheet, "hover:underline").withPseudo(":hover").toExist();
expectClass(sheet, "debug-outline").not.toExist();
```

Failures throw `CssertAssertionError` with the selectors that were considered
and, for missing classes, similarly named classes that do exist.
`toResolveTo` compares after `var()` resolution, so Tailwind v4's
`background-color: var(--color-brand-500)` resolves to your `@theme` value.
`(min-width: 48rem)` and `(width >= 48rem)` are treated as the same condition.

**Assert your tokens, not the framework's utilities.** Checking that `p-4`
resolves to `1rem` tests Tailwind, not your project, and breaks on every
framework upgrade. Use `toResolveTo` for classes you own: `@theme` colours,
`@apply`-composed components, design-system classes.

### The stylesheet model

```ts
const sheet = loadStylesheet(css);
sheet.classes();                     // every class in any selector role
sheet.hasClass("md:p-4");            // subject presence
sheet.match("hover:underline");      // [{ selector, subject, layers, conditions, pseudo, declarations, order }]
sheet.declarationsFor("md:p-4", { condition: "(min-width: 48rem)" });
sheet.resolveVar("--color-red-500"); // follows var() chains, undefined on cycles
sheet.resolveValue("calc(var(--spacing) * 4)");
sheet.warnings;                      // parse problems, never exceptions
```

`declarationsFor` returns every declaration in source order and does not
guess the cascade winner; `pickWinner(decls, prop)` implements the simple
"last (important) wins" rule for declarations you already know to be
comparable.

## Non-goals

- Removing or suggesting removal of unused CSS
- Depending on Tailwind's internal APIs
- Running a browser or doing visual regression
- Linting, formatting or rewriting CSS
- Verifying framework utility values

## Development

```sh
pnpm install
pnpm test            # vitest
pnpm test:coverage
pnpm lint            # biome
pnpm typecheck
pnpm build           # tsup → dist/
```

Fixtures under `test/fixtures/` are real Tailwind v3/v4 and UnoCSS builds;
`scripts/build-fixtures.sh` regenerates them. Design decisions beyond the
specification are recorded in [docs/decisions.md](docs/decisions.md).

## Name

The name is a nod to thingsinjars/cssert (2011), which approached the same
problem from the rendering side.

## License

MIT © 2026 Shinya Okano
