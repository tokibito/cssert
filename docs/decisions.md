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
