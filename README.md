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

### What this finds in practice

Reported from a Django + Tailwind v4 + daisyUI codebase (35 templates, 27
rendered pages) that adopted cssert in CI:

- **The first run found 7 dead class names used in about 200 places** — leftovers
  from a daisyUI v4 → v5 upgrade that nobody had noticed, because every page
  still rendered and only looked slightly wrong.
- **Two past incidents were reproduced and both failed the check**: a
  hand-written `.mention` rule deleted from `style.css`, and a Prettier run that
  reflowed a template until `tooltip-right menu-active` became
  `tooltip-rightmenu-active`.
- **The dev-server trap is caught by the same mechanism**: add a new template
  while a Tailwind dev server is running, and the classes that appear for the
  first time in that file are never scanned. The page works for whoever has the
  old stylesheet cached and breaks in production.

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

## What a green run does and does not prove

`✓ no missing classes` is a statement about the files cssert was given, and
only about *existence*. Quote this section in your own CI design notes.

**A green run proves**, for every document you passed in: every literal class
in a scanned attribute is defined by at least one selector in the stylesheets
you passed in.

**A green run does not prove:**

- **That the rule actually applies.** A class can exist and still lose to
  another selector's specificity, sit behind a media query that never matches,
  or declare the wrong value. cssert compares names, not computed style.
- **That the class is on the right element.** A `class` attribute you forgot
  to write is not a missing class; it is missing markup, and nothing here sees
  it.
- **That the pages you did not render are fine.** A template that no scanned
  document exercises is simply not part of the result. The summary reports the
  document count for this reason, `--min-documents` turns a truncated input set
  into a failure, and the count of documents that still contain unresolved
  class expressions says how much of the input could not be resolved.
- **That both branches were taken.** Rendering `{% if expired %}` once only
  covers the branch your fixture data happened to hit.

For "this class exists *and* resolves to this value", use
[`expectClass`](#explicit-assertions).

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

  --css <glob>              Built CSS files (repeatable, comma-separated allowed)
  --html <glob>             HTML documents to check (repeatable)
  --config <path>           Config file (default: cssert.config.{ts,js,mjs,json} in cwd)
  --root <dir>              Base directory for every relative path
  --baseline <path>         Baseline file (default: .cssert/baseline.json when present)
  --no-baseline             Ignore the baseline for this run
  --require-baseline        Fail when the baseline file does not exist
  --format <fmt>            human | json | github | sarif (default: human)
  --annotate-occurrences    github: annotate every usage, not one per class
  --output <path>           Write the report to a file instead of stdout
  --attributes <list>       HTML attributes to scan (default: class)
  --ignore <pattern>        Extra class or /regex/ to ignore (repeatable)
  --allow <pattern>         Class or /regex/ that may be absent from the CSS (repeatable)
  --hook <pattern>          Class that is expected to have no styles (repeatable)
  --strict-parse            Treat CSS parse warnings as errors
  --max-warnings <n>        Fail when parse warnings exceed <n>
  --fail-on-dynamic         Also fail when dynamic-suspect tokens are found
  --min-documents <n>       Fail when fewer than <n> HTML documents were scanned
  --min-stylesheets <n>     Fail when fewer than <n> stylesheets were scanned
  --no-color                Disable colours
```

A class counts as defined when it appears in **any** selector of any
stylesheet, including as an ancestor (`.group:hover .foo` defines `group`),
so Tailwind's `group`/`peer` markers are not false positives.

### Where relative paths point

Paths **in a config file** are resolved against the directory containing that
config file, the way eslint, vitest and tsc resolve theirs. Paths **passed as
flags** are resolved against the working directory. So the same config gives
the same result from anywhere, which matters when `node_modules` lives in a
subdirectory:

```sh
cssert check                                        # from the repo root
cd frontend && cssert check --config ../cssert.config.mjs   # same result
```

Override the base with `root` in the config (relative to the config file) or
`--root` on the command line (relative to cwd; applies to flags too). Set
`resolveFrom: "cwd"` to get the pre-0.2 behaviour back.

### `cssert baseline create | prune`

The first run on an existing project usually reports many findings. Freeze
them and fail only on new ones:

```sh
npx @cssert/cli baseline create --css "dist/**/*.css" --html "build/**/*.html"
npx @cssert/cli check ...        # .cssert/baseline.json is applied automatically
npx @cssert/cli baseline prune   # drop entries that have been fixed
```

```
  --kind <k>     failing (default) | missing | dynamic-suspect | all
  --dry-run      Report what would change without writing the file
```

#### What to freeze, and what not to

**A baseline is the list of debt you intend to pay off**, so only put things in
it that would otherwise fail the build. That is what `--kind failing` (the
default) does: `missing` findings, plus `dynamic-suspect` ones only when you
run with `--fail-on-dynamic`.

Freezing dynamic-suspect findings otherwise makes the file rot. The key of such
an entry is the whole template expression:

```json
{ "className": "{% if inv.status == 'active' %}badge-info{% else %}badge-ghost{% endif %}",
  "kind": "dynamic-suspect" }
```

Edit one character of that condition and the key changes: the entry stops
matching and a stale line stays behind. The fix for those findings is to render
the page, not to freeze the expression.

#### Recommended first run

1. `cssert check` — look at the real list before freezing anything.
2. `cssert baseline create` — freeze what fails, and commit
   `.cssert/baseline.json` in its own commit so the diff is reviewable.
3. Fix classes in batches. After each batch, `cssert baseline prune` drops the
   entries that no longer occur and prints `N resolved, M remaining`; commit
   that alongside the fix. `--dry-run` shows the same summary without writing.
4. When the file reaches zero entries, delete it and add `--require-baseline`
   only if you want the absence itself to be an error.

A baseline that does not exist yet is not an error: cssert notes it on stderr
and continues, so you can write the config before you freeze anything. Use
`--no-baseline` for a one-off run that shows everything, and
`--require-baseline` in CI if a missing file should fail.

Entries are keyed by class name and kind, so moving a usage to another template
does not create a new finding.

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
  hooks: ["sidebar-collapse-tooltip"],   // queried from JS; correctly has no styles
  attributes: ["class", ":class"],
  baseline: ".cssert/baseline.json",
  minDocuments: 27,                      // a truncated artefact must not pass
  budget: { snapshot: ".cssert/budget.json", maxDrop: "10%" },
  // root: "..",                         // rebase this file's relative paths
  // resolveFrom: "cwd",                 // pre-0.2 resolution
});
```

Command-line flags override the config file. In JSON configs, strings of the
form `"/^js-/"` are treated as regular expressions. TypeScript configs load
natively on Node 22.18+/24+; on older runtimes install `jiti` or use `.mjs`.

`ignore`, `allow` and `hooks` all keep a class out of the report and differ in
what they record:

| key | meaning |
| --- | --- |
| `ignore` | Not cssert's business (another library owns it, a script toggles it). Dropped before the comparison. |
| `allow` | Known to be absent, tolerated for now. |
| `hooks` | A script/test handle with no styling. Absence from the CSS is the *correct* state. |

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

`--format github` emits **one annotation per class**, anchored at the first
occurrence, with the remaining count in the message
(`… is not defined in any stylesheet (and 65 other places).`). GitHub displays
only a limited number of annotations per check run, and the first run on an
existing project — when the report is longest — is exactly when one noisy class
would otherwise crowd out every other finding. Pass `--annotate-occurrences`
to annotate every usage instead. The human format always lists every
occurrence.

When the HTML and the CSS are produced by different jobs, the checking job
receives both as artefacts — and an artefact that failed to download leaves an
empty directory. `--min-documents` makes that a failure instead of a green run;
see the [Django recipe](docs/recipes/django.md#5-github-actions) for a complete
three-job workflow.

## Library usage

### Deriving findings

```ts
import { audit, loadStylesheet } from "@cssert/cli";

const result = audit({
  stylesheets: [{ path: "dist/app.css", css }],
  documents: [{ path: "index.html", html }],
});
result.findings; // [{ className, kind: "missing" | "dynamic-suspect", occurrences, sources }]
```

Label your documents with `source` and each finding reports the distinct labels
it was seen under. The CLI labels every document with the input glob that
matched it, so a finding whose `sources` contains only your template glob is a
page you never rendered:

```sh
cssert check --html "build/rendered/**/*.html,templates/**/*.html" --format json \
  | jq '.findings[] | select(.sources == ["templates/**/*.html"]) | .className'
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

## Upgrading from 0.1

Four defaults changed. All four are about being usable rather than correct in
the abstract; each has an opt-out.

| Change | Restore the old behaviour |
| --- | --- |
| Relative paths in a config file resolve against the config file's directory, not cwd | `resolveFrom: "cwd"` in the config |
| `--format github` emits one annotation per class, not per occurrence | `--annotate-occurrences` |
| A baseline file that does not exist is a note on stderr, not exit 2 | `--require-baseline` |
| `baseline create` freezes only the kinds that fail the check | `--kind all` |

Check the first one before you upgrade: if your config file is not at the
directory you run cssert from, its globs now point somewhere else. Run
`cssert check` once and confirm the scanned document count is unchanged.

Additions: `root` / `--root`, `--no-baseline`, `--min-documents`,
`--min-stylesheets`, `hooks` / `--hook`, `baseline --kind` / `--dry-run`,
`sources` on JSON findings, `documentsWithDynamic` in the summary, and
`--version` now naming the package.

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
`scripts/build-fixtures.sh` regenerates them. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, [docs/decisions.md](docs/decisions.md)
for design decisions beyond the specification, and
[docs/releasing.md](docs/releasing.md) for how versions reach npm.

## Name

The name is a nod to thingsinjars/cssert (2011), which approached the same
problem from the rendering side.

## License

MIT © 2026 Shinya Okano
