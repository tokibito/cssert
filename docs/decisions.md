# Design decisions

Decisions that go beyond (or deviate from) the written specification, with the
reasoning. Newest at the bottom.

## D1. HTML class names are taken literally; only the CSS side is unescaped

The specification asks for both sides to go through the same normalisation.
Both sides go through `normalizeClassName` (Unicode NFC). CSS escape decoding
(`unescapeCssIdentifier`) is applied only to selectors: a backslash inside an
HTML `class` attribute is a literal character, and decoding it would make
`content-['\\']`-style classes disagree between the two sides.

## D2. `Match.selector` is the nesting-expanded selector

The spec describes `selector` as the "original" selector string. For nested
rules (`.a { &:hover {} }`) the original `&:hover` is useless for reporting,
so the stored value is the fully resolved selector with escapes intact
(`.a:hover`). Combinator spacing is canonicalised (`.a > .b`, `.a .b`) so
that generators with different formatting produce the same string.

## D3. Conditions from non-`@media` at-rules carry their at-rule name

`@media` queries are stored bare (`(width >= 48rem)`) as the spec's example
shows. `@supports`, `@container`, `@starting-style`, `@scope` and unknown
block at-rules are stored with their name (`@supports (display: grid)`) so a
media query and a supports query with the same text are not confused.
`@keyframes`, `@font-face`, `@page` and similar are skipped entirely; their
"selectors" are not class selectors.

## D4. Anonymous `@layer {}` blocks are recorded as `<anonymous>`

The layer stack must keep its depth so that nested named layers line up.

## D5. Custom property resolution ignores conditional declarations

`resolveVar` only considers declarations that are not inside `@media`,
`@supports` or `@container`. Lookup order: requested scope, then
`:root`/`:host`/`html`, then `*`, then `@property` `initial-value`.
Tailwind v4 registers `--tw-*` properties via `@property` and sets them under
a `@supports` guard, so the `@property` fallback is what makes those resolve.
Picking a value from inside a media query would be a guess about which query
is active, which principle 5 forbids.

## D6. Pseudos on non-subject compounds and inside `:is()`/`:where()`

Each class occurrence records the pseudo-classes/elements of the compound it
sits in. Classes inside `:is()`, `:where()` (and vendor equivalents) are
analysed recursively; their subject status is inherited from the enclosing
compound, and the sibling pseudos of the wrapper are passed down. Classes
inside `:not()`/`:has()` are never subjects. For Tailwind v4's
`.group-hover\:underline:is(:where(.group):hover *)` this yields
`group` → `subject: false, pseudo: [":hover"]`.

## D7. `classes()` includes every role; `hasClass()` is subject-only

`classes()` is the set a build audit should compare against: a class that only
appears as an ancestor (`group`, `peer`, `dark`, `md:[&>*]:p-2 > *`) is still
defined by the stylesheet and doing something. `hasClass()` keeps the spec's
subject-only semantics for assertions that care about the element itself.

## D8. Empty rules count as a match; pure containers do not

`.foo {}` yields a match with no declarations, because the class was
deliberately written. `.foo { &:hover { … } }` yields only the `.foo:hover`
match; the outer block is just a container.

## D9. Fault-tolerant parsing uses `postcss-safe-parser`

Strict parsing is attempted first so the exact error position can be reported
as a `css-syntax` warning; the stylesheet is then re-parsed with
`postcss-safe-parser` and everything it recovers is used. This adds one small
dependency by the postcss author rather than a home-grown recovery strategy.

## D10. TypeScript is pinned to 5.x

TypeScript 7 (the Go-based compiler) is the npm `latest` tag at the time of
writing. The spec calls for 5.x and tsup's DTS build is validated against it,
so `typescript` is pinned to `^5.9`.

## D11. 0.0.1 ships only the core entry point

`package.json` in the spec lists a `bin` and a `./assert` export. Publishing
them before the files exist would ship a broken `bin` link, so they are added
in the milestones that implement them (M3 and M5).

## D12. CLI output is English

The spec's sample output annotates dynamic tokens in Japanese. The package is
published to a global registry, so all CLI text is English
(`(dynamic class construction suspected)`). Message shape follows the sample.

## D13. `dynamic-suspect` findings do not fail the build by default

Only `missing` findings produce exit code 1. Dynamic tokens cannot be fixed by
adding a class to the CSS; they are hints about template code. `--fail-on-dynamic`
(or `failOnDynamic` in the config) opts into failing on them.

## D14. `/pattern/flags` strings are regular expressions everywhere

`ignore` and `allow` accept `RegExp` objects in TS/JS configs, but JSON configs
and command-line flags can only carry strings. A string that looks like
`/…/flags` is converted with `new RegExp`; anything else matches exactly.

## D15. Argument parsing uses `node:util` `parseArgs`

No CLI framework dependency. List flags (`--css`, `--html`, `--ignore`, …) are
repeatable and accept comma-separated values, which covers the `<glob...>` in
the spec without a variadic parser.

## D16. TypeScript config files load natively, with `jiti` as an optional fallback

`cssert.config.ts` is imported directly; Node 22.18+/24+ strip types out of
the box. On older runtimes the loader tries `jiti` if the project has it
installed and otherwise fails with exit 2 and a message that suggests
`.mjs`/`.json`. cssert does not depend on a TypeScript loader itself, to keep
CI installs small.

## D17. Empty glob matches are usage errors

`--css`/`--html` patterns that match nothing exit with code 2 instead of
reporting "no missing classes". A silently empty check is exactly the kind of
false reassurance principle 5 forbids.

## D18. Baselines are keyed by class name and kind, not by position

A baseline entry says "this class is known to be missing", so a second usage
of the same class in another template is the same known problem, not a new
one. Keying by file/line would make baselines churn on every unrelated edit.
`baseline prune` drops entries whose class no longer produces a finding.

## D19. An explicitly configured baseline must exist; the default may not

`check` silently skips the default `.cssert/baseline.json` when it is absent,
so first-time users are not forced to create one. A path given via
`--baseline` or the config file is a statement of intent, and a missing file
there is a usage error (exit 2) rather than a silent no-op.

## D20. Budget compares totals, only shrinkage fails, `--update` always passes

The budget guards against a build that silently emptied. It compares total
distinct classes and total gzip size against the snapshot; growth never fails
and raw byte size is reported but never enforced (minifier changes would make
it noisy). `--max-drop` accepts `10%` (both metrics) or `25` (absolute class
count). `--update` records the new measurement and exits 0 even when the drop
exceeded the threshold, because the operator is explicitly accepting it.

## D21. `expectClass(...).toExist()` means "defined anywhere"; `asSubject()` narrows

Following D7, the default expectation considers every selector role, so
`expectClass(sheet, "group").toExist()` passes for Tailwind output where
`group` only appears inside `:where(.group)`. `asSubject()` switches to the
spec's subject-only semantics. `toResolveTo` picks the winner with
`pickWinner` over the considered matches; when a class has declarations under
several conditions, narrow with `under()` first.

## D22. CI formats emit one entry per occurrence

GitHub workflow commands and SARIF results are emitted per occurrence, not
per class, so every usage is annotated in the pull request. A finding without
occurrences (possible when a baseline or ignore list is edited by hand) is
still emitted once without a location. SARIF carries the class name as a
partial fingerprint so viewers can group alerts.

## D23. Recipes render first, then check

The Django/Rails/Laravel recipes all dump rendered HTML via the framework's
own request machinery rather than checking templates. Rendering resolves
`{% if %}`/`<%= %>` inside class attributes, which is exactly what the
dynamic-suspect classification cannot verify.
