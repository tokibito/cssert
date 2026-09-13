# @cssert/cli

## 0.2.0

### Minor Changes

- [#2](https://github.com/tokibito/cssert/pull/2) [`7d7558d`](https://github.com/tokibito/cssert/commit/7d7558d334efe0449757bd0aaa85c3dd6a51a17b) Thanks [@tokibito](https://github.com/tokibito)! - Reduce the friction of adopting cssert in a real project. Four defaults change;
  each has an opt-out, and `README.md` has an "Upgrading from 0.1" table.
  
  **Breaking: relative paths in a config file now resolve against the config
  file's directory**, not the working directory, the way eslint/vitest/tsc do.
  The same config gives the same result from any directory, which is what makes
  cssert usable when `node_modules` lives in a subdirectory
  (`cd frontend && cssert check --config ../cssert.config.mjs` used to match
  nothing). Globs passed as flags stay relative to cwd. New `root` (config,
  relative to the config file) and `--root` (CLI, relative to cwd) override the
  base; `resolveFrom: "cwd"` restores the old behaviour.
  
  **Breaking: `--format github` emits one annotation per class**, anchored at the
  first occurrence with the rest counted in the message
  (`… (and 65 other places).`). GitHub caps the annotations it displays per check
  run, so a single class used in 85 places used to hide every other finding —
  worst on the first run, when the report is longest. `--annotate-occurrences`
  restores per-occurrence annotations. Human and SARIF output are unchanged.
  
  **Breaking: a baseline file that does not exist no longer exits 2.** cssert
  notes it on stderr and continues without suppression, so you can write the
  config before freezing anything. `--require-baseline` makes the absence fatal;
  `--no-baseline` (or `--baseline ""`, which used to fail with EISDIR) ignores an
  existing baseline for one run.
  
  **Breaking: `baseline create` freezes only the kinds that fail the check**
  (`--kind failing`, the new default: `missing`, plus `dynamic-suspect` under
  `--fail-on-dynamic`). Freezing dynamic-suspect findings keyed by whole template
  expressions made baselines rot on any edit to the expression. `--kind all`
  restores the old behaviour; `--kind missing|dynamic-suspect` selects explicitly.
  
  Added:
  
  - `--min-documents` / `--min-stylesheets` (and `minDocuments` /
    `minStylesheets`) fail the run when fewer inputs arrived than expected, so a
    CI artefact that failed to download cannot pass as a green check. Reported in
    every format through the new `Report.errors`.
  - The summary counts documents that still contain unresolved class expressions,
    so a green run says how much of the input it could not resolve.
  - JSON findings carry `sources`: the input globs the finding was seen under.
    A finding listed only under your template glob is a page nobody rendered.
    `audit()` accepts `source` on each document.
  - `hooks` / `--hook` for classes that are supposed to have no styles —
    `allow` semantics, separate key so the config records the reason.
  - `baseline create|prune --dry-run`.
  - `--version` names the package (`cssert 0.2.0 (@cssert/cli)`).
  
  Docs: "What a green run does and does not prove" and a baseline operations
  guide in the README; the Django recipe gains a pytest-based rendering recipe,
  a note on rendering both branches of every `{% if %}`, and a complete
  three-job GitHub Actions workflow.

## 0.1.0

### Minor Changes

- [`d5fcbe4`](https://github.com/tokibito/cssert/commit/d5fcbe41a37fa1efb48c8638d47be14f687431ba) Thanks [@tokibito](https://github.com/tokibito)! - Add the `expectClass` assertion API (`cssert/assert`), GitHub Actions and
  SARIF report formats, and server-side rendering recipes for Django, Rails and
  Laravel.

- [`041d41f`](https://github.com/tokibito/cssert/commit/041d41f53a153c46317ffcdc41166a403aefd38c) Thanks [@tokibito](https://github.com/tokibito)! - Add `cssert baseline create|prune` to freeze existing findings and
  `cssert budget` to detect a build that lost too many classes or gzip bytes.

- [`18fd3ed`](https://github.com/tokibito/cssert/commit/18fd3ed87b110dfb8be050358b9fae1a86075464) Thanks [@tokibito](https://github.com/tokibito)! - Add the `cssert check` command with human and JSON reports, config file
  loading (`cssert.config.{ts,js,mjs,json}`), HTML class extraction with
  dynamic-token detection, and the `audit()` library API.
