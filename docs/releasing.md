# Releasing

How a version of `@cssert/cli` gets to npm, and the pieces outside this
repository that it depends on. Nothing here is guessable from the code alone,
so read it before touching `.github/workflows/release.yml` or the npm
settings.

## The normal path

1. Every user-visible change lands with a changeset (`pnpm changeset`, see
   [CONTRIBUTING.md](../CONTRIBUTING.md)). Nobody edits `version` in
   `package.json` or `CHANGELOG.md` by hand.
2. On every push to `main`, the `release` workflow runs `changesets/action`.
   While changesets are pending it opens or updates a pull request called
   **Version Packages** (branch `changeset-release/main`) that bumps the
   version, deletes the consumed changesets and extends `CHANGELOG.md`.
3. Merging that pull request is the release decision. The workflow runs
   again, finds no pending changesets, and its **Publish to npm** step
   publishes the version from `package.json` with the npm CLI, creates the
   git tag `v<version>` with `changeset tag`, and pushes it.
4. The step is idempotent: when the version already exists on the registry it
   prints "already published" and exits 0, so re-running the workflow or
   pushing unrelated commits never publishes twice.

The registry needs a few seconds before `npm view` reports a new version;
that is not a failed publish.

## What the workflow relies on

**npm trusted publishing (OIDC).** There is no `NPM_TOKEN` anywhere and there
must not be one. Authentication comes from the GitHub Actions OIDC token,
exchanged by the npm CLI (`npm install -g npm@latest` in the workflow keeps
it at a version that supports this). The exchange only succeeds when the
package's trusted publisher configuration on npm matches the run exactly:

| Field                | Value                          |
| -------------------- | ------------------------------ |
| Publisher            | GitHub Actions                 |
| Organization or user | `tokibito`                     |
| Repository           | `cssert`                       |
| Workflow filename    | `release.yml` (file name only) |
| Environment          | empty                          |

It is configured per package at
<https://www.npmjs.com/package/@cssert/cli/access>. A mismatch shows up in the
run log as `OIDC token exchange error - package not found` followed by
`ENEEDAUTH`; the workflow itself is fine in that case, fix the npm side.
Renaming the workflow file requires updating this setting first.

**Provenance.** `NPM_CONFIG_PROVENANCE=true` makes every publish carry a
SLSA attestation. This also needs the OIDC token, so it comes for free with
trusted publishing and fails without it.

**`actions/setup-node` without `registry-url`.** With `registry-url` set,
setup-node writes a placeholder `_authToken` into `.npmrc`; npm then sends
that placeholder instead of using OIDC and the registry answers 404. Leave
the option out.

**Publishing with npm, not through changesets.** `changeset publish` detects
`pnpm-workspace.yaml` and shells out to `pnpm publish`, which failed with 404
under OIDC. The action is therefore used only for the Version Packages pull
request (no `publish` input), and the publish step is our own.

**GitHub repository setting.** *Settings → Actions → General → Workflow
permissions → "Allow GitHub Actions to create and approve pull requests"*
must be enabled, or the Version Packages pull request cannot be created and
the run fails with "GitHub Actions is not permitted to create or approve pull
requests". The workflow's own `permissions` block grants `contents: write`,
`pull-requests: write` and `id-token: write`; the repository default can
stay read-only.

## Versions

- `0.0.1` was published by hand to claim the name.
- `0.1.0` and later are published by the workflow only. Do not publish by
  hand; a manual publish bypasses provenance and leaves no matching tag.
- Version bumps follow the changesets: `patch` for fixes, `minor` for
  features while we are on `0.x`. `1.0.0` waits until the public API has been
  validated in real projects, as the design brief says.

## If something goes wrong

- **Run failed at the publish step, version not on npm.** Read the log of the
  `Publish to npm` step. Fix the cause, then re-run the workflow from the
  Actions tab; the step is safe to repeat.
- **Publish succeeded but no tag.** Run `pnpm changeset tag && git push --tags`
  from the merged commit.
- **A release has to be made by hand anyway** (registry outage, broken
  workflow): from the merged Version Packages commit run
  `pnpm build && npm publish --otp=<code>`. The account has 2FA, so the OTP
  is required, and only a maintainer can do it. Note it in the pull request
  or issue so the missing provenance is explained.
- **The bare name `cssert`** cannot be published: npm rejects it as too
  similar to `assert`/`cssesc` (see `docs/decisions.md`, D24). Do not try
  again; the scoped name is permanent.
