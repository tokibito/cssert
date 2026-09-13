import { beforeEach, describe, expect, it } from "vitest";
import { fixture, type Sandbox, sandbox } from "./helpers.js";

const HTML_OK = `<div class="flex md:p-4">x</div>\n`;
const HTML_DYNAMIC = `<div class="flex text-{{ color }}">x</div>\n`;

describe("input coverage", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("build/a.html", HTML_OK);
  });

  const base = ["check", "--css", "dist/app.css", "--html", "build/*.html"];

  it("fails when fewer documents arrived than --min-documents requires", async () => {
    expect((await sb.run([...base, "--min-documents", "1"])).code).toBe(0);
    const res = await sb.run([...base, "--min-documents", "20"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Only 1 HTML document(s) were scanned");
    expect(res.stdout).toContain("input coverage check failed");
  });

  it("fails when fewer stylesheets arrived than --min-stylesheets requires", async () => {
    const res = await sb.run([...base, "--min-stylesheets", "2"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Only 1 stylesheet(s) were scanned");
  });

  it("reports the coverage failure in json, github and sarif", async () => {
    const json = JSON.parse(
      (await sb.run([...base, "--min-documents", "9", "--format", "json"])).stdout,
    );
    expect(json.errors).toHaveLength(1);

    const gh = await sb.run([...base, "--min-documents", "9", "--format", "github"]);
    expect(gh.stdout).toContain("::error title=cssert%3A input coverage::");

    const sarif = JSON.parse(
      (await sb.run([...base, "--min-documents", "9", "--format", "sarif"])).stdout,
    );
    expect(sarif.runs[0].results[0].ruleId).toBe("cssert/input-coverage");
  });

  it("rejects a non-integer minimum", async () => {
    expect((await sb.run([...base, "--min-documents", "lots"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ minDocuments: 1.5 }));
    expect((await sb.run(base)).code).toBe(2);
  });

  it("counts documents that still contain unresolved class expressions", async () => {
    sb.write("build/b.html", HTML_DYNAMIC);
    const res = await sb.run(base);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("1 document(s) still contain unresolved class expressions");
    const json = JSON.parse((await sb.run([...base, "--format", "json"])).stdout);
    expect(json.summary.documentsWithDynamic).toBe(1);

    // A green run still says what it could not verify.
    await sb.run(["baseline", "create", ...base.slice(1), "--kind", "all"]);
    const green = await sb.run(base);
    expect(green.stdout).toContain("✓ no missing classes");
    expect(green.stdout).toContain("1 document(s) still contain unresolved class expressions");
  });
});

describe("negative globs", () => {
  it("excludes files matched by a ! pattern from every positive pattern", async () => {
    const sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("build/page.html", `<div class="flex gone">x</div>`);
    sb.write("build/vendor/page.html", `<div class="flex also-gone">x</div>`);
    const base = ["check", "--css", "dist/app.css", "--format", "json"];

    const all = JSON.parse((await sb.run([...base, "--html", "build/**/*.html"])).stdout);
    expect(all.summary.documents).toBe(2);

    const filtered = JSON.parse(
      (await sb.run([...base, "--html", "build/**/*.html,!**/vendor/**"])).stdout,
    );
    expect(filtered.summary.documents).toBe(1);
    expect(filtered.findings.map((f: { className: string }) => f.className)).toEqual(["gone"]);
  });

  it("errors when only negative patterns are given", async () => {
    const sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("build/page.html", `<div class="flex">x</div>`);
    const res = await sb.run(["check", "--css", "dist/app.css", "--html", "!build/**"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("No html files matched");
  });
});

describe("finding provenance", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("build/rendered/page.html", `<div class="flex rendered-gone">x</div>`);
    sb.write("templates/page.html", `<div class="flex rendered-gone template-only">x</div>`);
  });

  it("records which input glob each finding came from", async () => {
    const res = await sb.run([
      "check",
      "--css",
      "dist/app.css",
      "--html",
      "build/rendered/**/*.html,templates/**/*.html",
      "--format",
      "json",
    ]);
    expect(res.code).toBe(1);
    const bySource = Object.fromEntries(
      JSON.parse(res.stdout).findings.map((f: { className: string; sources: string[] }) => [
        f.className,
        f.sources,
      ]),
    );
    // Only in the raw templates: the page that uses it was never rendered.
    expect(bySource["template-only"]).toEqual(["templates/**/*.html"]);
    expect(bySource["rendered-gone"]).toEqual(["build/rendered/**/*.html", "templates/**/*.html"]);
  });
});

describe("hooks and github annotation folding", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
  });

  it("treats hooks like allow but keeps the intent in the config", async () => {
    sb.write("templates/a.html", `<div class="flex sidebar-collapse-tooltip">x</div>`);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/a.html"];
    expect((await sb.run(base)).code).toBe(1);
    expect((await sb.run([...base, "--hook", "sidebar-collapse-tooltip"])).code).toBe(0);

    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["dist/app.css"],
        html: ["templates/a.html"],
        hooks: ["sidebar-collapse-tooltip"],
      }),
    );
    expect((await sb.run(["check"])).code).toBe(0);
  });

  it("emits one github annotation per class unless --annotate-occurrences", async () => {
    for (let i = 0; i < 3; i++) {
      sb.write(`templates/p${i}.html`, `<div class="flex gone-1 gone-2">x</div>`);
    }
    const base = [
      "check",
      "--css",
      "dist/app.css",
      "--html",
      "templates/*.html",
      "--format",
      "github",
    ];
    const folded = (await sb.run(base)).stdout.split("\n").filter((l) => l.startsWith("::"));
    expect(folded).toHaveLength(2);
    expect(folded[0]).toContain("(and 2 other places).");

    const all = (await sb.run([...base, "--annotate-occurrences"])).stdout
      .split("\n")
      .filter((l) => l.startsWith("::"));
    expect(all).toHaveLength(6);
    expect(all[0]).not.toContain("other places");
  });
});
