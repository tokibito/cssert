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
false reassurance principle 5 forbids. (Extended in D30: a glob that matches
*fewer* files than expected is just as silent, which is what `--min-documents`
is for.)

## D18. Baselines are keyed by class name and kind, not by position

A baseline entry says "this class is known to be missing", so a second usage
of the same class in another template is the same known problem, not a new
one. Keying by file/line would make baselines churn on every unrelated edit.
`baseline prune` drops entries whose class no longer produces a finding.

## D19. An explicitly configured baseline must exist; the default may not

**Superseded by D31 in 0.2.0.** `check` silently skips the default
`.cssert/baseline.json` when it is absent, so first-time users are not forced
to create one. A path given via `--baseline` or the config file is a statement
of intent, and a missing file there is a usage error (exit 2) rather than a
silent no-op.

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

**Amended by D29 in 0.2.0: the GitHub format now folds to one annotation per
class; SARIF still emits one result per occurrence.** GitHub workflow commands
and SARIF results are emitted per occurrence, not per class, so every usage is
annotated in the pull request. A finding without occurrences (possible when a
baseline or ignore list is edited by hand) is still emitted once without a
location. SARIF carries the class name as a partial fingerprint so viewers can
group alerts.

## D23. Recipes render first, then check

The Django/Rails/Laravel recipes all dump rendered HTML via the framework's
own request machinery rather than checking templates. Rendering resolves
`{% if %}`/`<%= %>` inside class attributes, which is exactly what the
dynamic-suspect classification cannot verify.

## D24. The package is published as `@cssert/cli`

`npm publish` of the bare name `cssert` is rejected with 403 by the registry's
typosquat protection ("too similar to existing packages assert, cssesc"). The
name is not taken; it is unpublishable. Scoped names are exempt from that
check and the `@cssert` organisation is already owned, so the package lives at
`@cssert/cli` with `publishConfig.access: public`. The binary, the config
file name and all report output keep the name `cssert`. Future sub-packages
(`@cssert/vitest`, …) sit next to it as planned.

## D25. Provenance is enabled through `NPM_CONFIG_PROVENANCE`, not a CLI flag

`changeset publish` (v3) has no `--provenance` option, so the script suggested
by the spec fails at publish time. The release workflow sets
`NPM_CONFIG_PROVENANCE=true` instead, which npm reads for every publish that
changesets runs. Trusted publishing (OIDC) supplies the identity; no
`NPM_TOKEN` exists in the repository.

## D26. `setup-node` runs without `registry-url` in the release workflow

With `registry-url` set, `actions/setup-node` writes
`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` to `.npmrc` and fills
the variable with a placeholder. The publish then authenticates with that
placeholder rather than the OIDC token and the registry answers 404. Trusted
publishing needs no `.npmrc` entry at all, so the option is omitted.

## D27. The release workflow publishes with the npm CLI, not through changesets

`changesets/action`'s `publish` input runs `changeset publish`, which detects
the pnpm workspace file and shells out to `pnpm publish`; in CI that returned
404 from the registry under OIDC. The workflow therefore uses the action only
for the "Version Packages" PR and publishes in its own step with the current
npm CLI (`npm install -g npm@latest`), which implements trusted publishing and
provenance directly. The step is idempotent: it exits early when the version
in `package.json` already exists on the registry, and `changeset tag` still
creates the `@cssert/cli@x.y.z` git tag.

## D28. Config paths resolve against the config file; flags against cwd

Resolving every glob against the working directory made a config file's
meaning depend on where it was invoked from. In a repository whose npm root is
a subdirectory, `cd frontend && cssert check --config ../cssert.config.mjs`
matched nothing and said so in a way that reads like a build problem. eslint,
vitest and tsc all resolve config-relative, so that is now the default:
`Roots.config` for values read out of the config file, `Roots.flag` for values
typed on the command line, where "the file I pointed at from here" is the
obvious reading. Reported paths are relative to the base that found them, which
is what makes the output identical from any directory.

`root` in a config file rebases only that file's own paths, because it is a
statement about the file. `--root` is given at invocation time and so rebases
flags too. `resolveFrom: "cwd"` restores the 0.1 behaviour for projects that
depended on it.

## D29. The GitHub format annotates once per class

A check run displays a limited number of annotations. One class used in 85
places therefore hid every other finding — worst on the first run, when the
report is longest and the reader has the least context. The annotation is now
anchored at the first occurrence and carries the remaining count in its text
("and 65 other places"), so N classes produce N annotations.
`--annotate-occurrences` restores the old behaviour. The human format still
lists every occurrence: a terminal has no such cap, and the occurrence list is
how you find the class.

SARIF is unchanged. Code scanning deduplicates by fingerprint and is built to
ingest large result sets, so per-occurrence results stay more useful there.

## D30. cssert reports how much it could not verify

`✓ no missing classes` means "no problems in what I was given", and the
distance between that and "no problems" is the whole risk of an SSR setup: a
page nobody rendered is silently out of scope. Three things make that visible
rather than assumed. The summary counts documents that still contain
unresolved class expressions, so a partly rendered input set says so on a green
run. `--min-documents`/`--min-stylesheets` turn a truncated input set into
`report.errors` and exit 1 — an artefact download that produced an empty
directory must not pass. And findings carry the input glob they were seen
under (`sources`), so a class that appears only under the template glob is a
page that was never rendered.

Run-level errors live in `Report.errors` rather than being synthesised as
findings: they are not about a class, and a baseline must never be able to
suppress one.

## D31. A missing baseline is a note, not an error

D19 made a configured-but-absent baseline exit 2. That penalised the natural
order of work — write the config, then freeze the findings — and the first run
of every new project hit it. Absence now writes one line to stderr and the
check continues without suppression, which fails *louder* rather than quieter:
nothing is hidden. `--require-baseline` is there for pipelines that want the
absence itself to fail, and `--no-baseline` (or an empty path) is the explicit
"show me everything this time", replacing the workaround of renaming
`.cssert/` — which used to fail with EISDIR.

## D32. `baseline create` freezes only what fails

A baseline is the list of debt you intend to pay off. Freezing
dynamic-suspect findings by default put entries in it that could not fail the
build (without `--fail-on-dynamic`) and that rot: their key is the whole
template expression, so editing one character of a `{% if %}` condition changes
the key, the entry stops matching, and a stale line stays behind. The default
`--kind failing` freezes the kinds that fail under the current options;
`--kind all` keeps the old behaviour for projects that do run with
`--fail-on-dynamic`.

## D33. `hooks` is `allow` with a documented reason

A class that a script queries but never styles is not "unchecked" (`ignore`)
and not "tolerated for now" (`allow`) — its absence from the CSS is correct.
`hooks` behaves exactly like `allow` and exists so the config file says which
of the three a given entry is. Deliberately not a new finding kind: reporting
"this hook now has styles" would change the baseline schema for a rare case.
