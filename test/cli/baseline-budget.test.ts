import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fixture, type Sandbox, sandbox } from "./helpers.js";

const HTML_BAD = `<div class="flex lg:my-10 old-1 old-2">\n  <p class="text-{{ color }}">x</p>\n</div>\n`;

describe("cssert baseline", () => {
  let sb: Sandbox;
  const base = ["--css", "dist/app.css", "--html", "templates/*.html"];
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("templates/bad.html", HTML_BAD);
  });

  it("prints help and rejects unknown subcommands", async () => {
    expect((await sb.run(["baseline"])).stdout).toContain("Usage: cssert baseline");
    expect((await sb.run(["baseline", "--help"])).code).toBe(0);
    expect((await sb.run(["baseline", "create", "--help"])).code).toBe(0);
    expect((await sb.run(["baseline", "wat"])).code).toBe(2);
  });

  it("freezes only the findings that fail the check, and check applies them", async () => {
    expect((await sb.run(["check", ...base])).code).toBe(1);

    const create = await sb.run(["baseline", "create", ...base]);
    expect(create.code).toBe(0);
    expect(create.stdout).toContain(".cssert/baseline.json");
    expect(create.stdout).toContain("2 finding(s) frozen, 1 not failing the check left out");
    const baseline = JSON.parse(sb.read(".cssert/baseline.json"));
    expect(baseline.entries).toEqual([
      { className: "old-1", kind: "missing" },
      { className: "old-2", kind: "missing" },
    ]);

    const check = await sb.run(["check", ...base]);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("2 suppressed by baseline");

    // A new missing class still fails.
    sb.write("templates/new.html", `<p class="brand-new">`);
    const again = await sb.run(["check", ...base]);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("brand-new");
    expect(again.stdout).not.toContain("old-1");
  });

  it("freezes dynamic-suspect findings with --fail-on-dynamic or --kind all", async () => {
    const dynamic = { className: "text-{{ color }}", kind: "dynamic-suspect" };

    await sb.run(["baseline", "create", ...base, "--fail-on-dynamic"]);
    expect(JSON.parse(sb.read(".cssert/baseline.json")).entries).toContainEqual(dynamic);

    await sb.run(["baseline", "create", ...base, "--kind", "all"]);
    expect(JSON.parse(sb.read(".cssert/baseline.json")).entries).toContainEqual(dynamic);

    await sb.run(["baseline", "create", ...base, "--kind", "dynamic-suspect"]);
    expect(JSON.parse(sb.read(".cssert/baseline.json")).entries).toEqual([dynamic]);

    expect((await sb.run(["baseline", "create", ...base, "--kind", "wat"])).code).toBe(2);
  });

  it("previews without writing with --dry-run", async () => {
    const create = await sb.run(["baseline", "create", ...base, "--dry-run"]);
    expect(create.code).toBe(0);
    expect(create.stdout).toContain("Would write baseline to .cssert/baseline.json");
    expect(existsSync(join(sb.dir, ".cssert/baseline.json"))).toBe(false);

    await sb.run(["baseline", "create", ...base]);
    sb.write("templates/bad.html", `<div class="flex old-2">`);
    const prune = await sb.run(["baseline", "prune", ...base, "--dry-run"]);
    expect(prune.stdout).toContain("(dry run): 1 resolved, 1 remaining");
    expect(JSON.parse(sb.read(".cssert/baseline.json")).entries).toHaveLength(2);
  });

  it("writes to a custom --baseline path, tolerating its absence until created", async () => {
    const custom = ["--baseline", "ci/known.json"];
    const before = await sb.run(["check", ...base, ...custom]);
    expect(before.code).toBe(1); // the findings, not a usage error
    expect(before.stderr).toContain("no baseline at ci/known.json");
    expect((await sb.run(["check", ...base, ...custom, "--require-baseline"])).code).toBe(2);

    expect((await sb.run(["baseline", "create", ...base, ...custom])).code).toBe(0);
    expect(existsSync(join(sb.dir, "ci/known.json"))).toBe(true);
    expect((await sb.run(["check", ...base, ...custom])).code).toBe(0);
    expect((await sb.run(["check", ...base, ...custom, "--require-baseline"])).code).toBe(0);
  });

  it("ignores the baseline with --no-baseline and an empty --baseline", async () => {
    await sb.run(["baseline", "create", ...base]);
    expect((await sb.run(["check", ...base])).code).toBe(0);
    expect((await sb.run(["check", ...base, "--no-baseline"])).code).toBe(1);
    expect((await sb.run(["check", ...base, "--baseline", ""])).code).toBe(1);
    expect((await sb.run(["check", ...base, "--no-baseline", "--require-baseline"])).code).toBe(2);
  });

  it("continues when a config-declared baseline does not exist yet", async () => {
    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["dist/app.css"],
        html: ["templates/*.html"],
        baseline: ".cssert/baseline.json",
      }),
    );
    const res = await sb.run(["check"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('run "cssert baseline create"');
  });

  it("reads the baseline path from the config file", async () => {
    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["dist/app.css"],
        html: ["templates/*.html"],
        baseline: "conf/base.json",
      }),
    );
    expect((await sb.run(["baseline", "create"])).code).toBe(0);
    expect(existsSync(join(sb.dir, "conf/base.json"))).toBe(true);
    expect((await sb.run(["check"])).code).toBe(0);
  });

  it("prunes resolved entries", async () => {
    await sb.run(["baseline", "create", ...base]);
    sb.write("templates/bad.html", `<div class="flex old-2">`);
    const prune = await sb.run(["baseline", "prune", ...base]);
    expect(prune.code).toBe(0);
    expect(prune.stdout).toContain("1 resolved, 1 remaining");
    expect(prune.stdout).toContain("- old-1 (missing)");
    expect(JSON.parse(sb.read(".cssert/baseline.json")).entries).toEqual([
      { className: "old-2", kind: "missing" },
    ]);
  });

  it("fails prune when there is no baseline", async () => {
    const res = await sb.run(["baseline", "prune", ...base]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("Baseline not found");
  });

  it("rejects corrupt baseline files", async () => {
    sb.write(".cssert/baseline.json", "{ nope");
    expect((await sb.run(["check", ...base])).code).toBe(2);
    sb.write(".cssert/baseline.json", JSON.stringify({ version: 9 }));
    const res = await sb.run(["check", ...base]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("Invalid baseline");
  });
});

describe("cssert budget", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
  });

  it("prints help and validates flags", async () => {
    expect((await sb.run(["budget", "--help"])).stdout).toContain("Usage: cssert budget");
    expect((await sb.run(["budget", "--css", "dist/*.css", "--wat"])).code).toBe(2);
    expect((await sb.run(["budget", "--css", "dist/*.css", "--max-drop", "lots"])).code).toBe(2);
    expect((await sb.run(["budget", "--css", "dist/*.css", "--format", "sarif"])).code).toBe(2);
    expect((await sb.run(["budget"])).code).toBe(2);
  });

  it("creates a snapshot on first run and passes on an unchanged build", async () => {
    const first = await sb.run(["budget", "--css", "dist/*.css"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("created .cssert/budget.json");
    const snapshot = JSON.parse(sb.read(".cssert/budget.json"));
    expect(snapshot.total.classes).toBeGreaterThan(20);
    expect(snapshot.files["dist/app.css"].gzipBytes).toBeGreaterThan(0);

    const second = await sb.run(["budget", "--css", "dist/*.css"]);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("within budget");
    expect(second.stdout).toContain("✓ classes");
  });

  it("fails when the build shrinks and passes again after --update", async () => {
    await sb.run(["budget", "--css", "dist/*.css"]);
    sb.write("dist/app.css", ".flex { display: flex }");
    const over = await sb.run(["budget", "--css", "dist/*.css"]);
    expect(over.code).toBe(1);
    expect(over.stdout).toContain("✗ classes");
    expect(over.stdout).toContain("over budget");

    const loose = await sb.run(["budget", "--css", "dist/*.css", "--max-drop", "100%"]);
    expect(loose.code).toBe(0);

    const update = await sb.run(["budget", "--css", "dist/*.css", "--update"]);
    expect(update.code).toBe(0);
    expect(update.stdout).toContain("Snapshot updated");
    expect(JSON.parse(sb.read(".cssert/budget.json")).total.classes).toBe(1);
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(0);
  });

  it("supports JSON output, custom snapshot paths and config values", async () => {
    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["dist/*.css"],
        budget: { snapshot: "ci/budget.json", maxDrop: "50%" },
      }),
    );
    const first = await sb.run(["budget", "--format", "json"]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ created: true });
    expect(existsSync(join(sb.dir, "ci/budget.json"))).toBe(true);

    sb.write("dist/extra.css", ".zzz { color: red }");
    const second = await sb.run(["budget", "--format", "json"]);
    expect(second.code).toBe(0);
    const json = JSON.parse(second.stdout);
    expect(json.ok).toBe(true);
    expect(json.comparison.addedFiles).toEqual(["dist/extra.css"]);

    sb.write("dist/app.css", ".flex {}");
    expect((await sb.run(["budget", "--snapshot", "ci/budget.json"])).code).toBe(1);
  });

  it("rejects corrupt snapshots and invalid budget config", async () => {
    sb.write(".cssert/budget.json", "{ nope");
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(2);
    sb.write(".cssert/budget.json", JSON.stringify({ version: 1, total: {} }));
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ budget: [] }));
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ budget: { snapshot: 1 } }));
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ budget: { maxDrop: [] } }));
    expect((await sb.run(["budget", "--css", "dist/*.css"])).code).toBe(2);
  });
});
