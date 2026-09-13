import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { COMMANDS } from "../../src/cli/main.js";
import { fixture, type Sandbox, sandbox } from "./helpers.js";

const HTML_OK = `<div class="flex md:p-4 group"><span class="group-hover:underline">x</span></div>\n`;
const HTML_BAD = `<div class="flex lg:my-10 bg-brand-500 nope">\n  <p class="lg:my-10 text-{{ color }}">x</p>\n</div>\n`;

describe("cssert (top level)", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
  });

  it("prints usage with exit 0 for --help and no command", async () => {
    expect(await sb.run([])).toMatchObject({ code: 0 });
    const help = await sb.run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: cssert <command>");
  });

  it("prints the version with the package name", async () => {
    const res = await sb.run(["--version"]);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toMatch(/^cssert \d+\.\d+\.\d+ \(@cssert\/cli\)$/);
    expect((await sb.run(["--help"])).stdout).toContain("@cssert/cli");
  });

  it("exits 2 for unknown commands", async () => {
    const res = await sb.run(["bogus"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('Unknown command "bogus"');
  });

  it("exits 3 for unexpected errors", async () => {
    COMMANDS.__boom = async () => {
      throw new Error("kaboom");
    };
    try {
      const res = await sb.run(["__boom"]);
      expect(res.code).toBe(3);
      expect(res.stderr).toContain("internal error");
      expect(res.stderr).toContain("kaboom");
    } finally {
      delete COMMANDS.__boom;
    }
  });
});

describe("cssert check", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
  });

  it("shows help", async () => {
    const res = await sb.run(["check", "--help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Usage: cssert check");
  });

  it("exits 0 with a success line when nothing is missing", async () => {
    sb.write("templates/ok.html", HTML_OK);
    const res = await sb.run(["check", "--css", "dist/*.css", "--html", "templates/**/*.html"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("✓ no missing classes");
    expect(res.stdout).toContain("scanned 1 document(s) / 1 stylesheet(s)");
  });

  it("exits 1 and lists findings in human format", async () => {
    sb.write("templates/bad.html", HTML_BAD);
    const res = await sb.run(["check", "--css", "dist/app.css", "--html", "templates/bad.html"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe(
      [
        "  ✗ nope              templates/bad.html:1:40",
        "  ⚠ text-{{ color }}  templates/bad.html:2:22   (dynamic class construction suspected)",
        "",
        "  1 missing, 1 dynamic-suspect  ·  scanned 1 document(s) / 1 stylesheet(s)" +
          "  ·  1 document(s) still contain unresolved class expressions",
        "",
      ].join("\n"),
    );
  });

  it("does not fail on dynamic-suspect tokens unless asked", async () => {
    sb.write("templates/dyn.html", `<p class="flex text-{{ c }}">`);
    const args = ["check", "--css", "dist/app.css", "--html", "templates/dyn.html"];
    expect((await sb.run(args)).code).toBe(0);
    expect((await sb.run([...args, "--fail-on-dynamic"])).code).toBe(1);
  });

  it("emits JSON", async () => {
    sb.write("templates/bad.html", HTML_BAD);
    const res = await sb.run([
      "check",
      "--css",
      "dist/app.css",
      "--html",
      "templates/bad.html",
      "--format",
      "json",
    ]);
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({
      version: 1,
      tool: "cssert",
      summary: { missing: 1, dynamicSuspect: 1, warnings: 0, documents: 1, stylesheets: 1 },
    });
    expect(json.findings[0]).toEqual({
      className: "nope",
      kind: "missing",
      occurrences: [{ path: "templates/bad.html", line: 1, column: 40 }],
      sources: ["templates/bad.html"],
    });
    expect(json.errors).toEqual([]);
  });

  it("writes to --output and reports the location on stderr", async () => {
    sb.write("templates/ok.html", HTML_OK);
    const res = await sb.run([
      "check",
      "--css",
      "dist/app.css",
      "--html",
      "templates/ok.html",
      "--format",
      "json",
      "--output",
      "reports/out.json",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("reports/out.json");
    expect(JSON.parse(sb.read("reports/out.json")).summary.missing).toBe(0);
  });

  it("exits 2 when inputs are missing or match nothing", async () => {
    expect((await sb.run(["check", "--html", "x.html"])).code).toBe(2);
    expect((await sb.run(["check", "--css", "dist/app.css"])).code).toBe(2);
    const res = await sb.run(["check", "--css", "nope/*.css", "--html", "templates/*.html"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("No css files matched");
  });

  it("exits 2 for unknown flags and bad values", async () => {
    sb.write("templates/ok.html", HTML_OK);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/ok.html"];
    expect((await sb.run([...base, "--wat"])).code).toBe(2);
    expect((await sb.run([...base, "--format", "xml"])).code).toBe(2);
    expect((await sb.run([...base, "--max-warnings", "abc"])).code).toBe(2);
  });

  it("honours --ignore and --allow with /regex/ syntax", async () => {
    sb.write("templates/bad.html", HTML_BAD);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/bad.html"];
    expect((await sb.run([...base, "--allow", "nope"])).code).toBe(0);
    expect((await sb.run([...base, "--ignore", "/^no/"])).code).toBe(0);
  });

  it("treats parse warnings as errors with --strict-parse and --max-warnings", async () => {
    sb.write("dist/broken.css", ".a { color: ");
    sb.write("templates/ok.html", `<p class="a">`);
    const base = ["check", "--css", "dist/broken.css", "--html", "templates/ok.html"];
    const plain = await sb.run(base);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("1 parse warning(s)");
    expect(plain.stdout).toContain("dist/broken.css:1:");
    expect((await sb.run([...base, "--strict-parse"])).code).toBe(1);
    expect((await sb.run([...base, "--max-warnings", "0"])).code).toBe(1);
    expect((await sb.run([...base, "--max-warnings", "1"])).code).toBe(0);
  });

  it("scans additional attributes", async () => {
    sb.write("templates/alpine.html", `<div :class="{ 'flex nope': x }"></div>`);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/alpine.html"];
    expect((await sb.run(base)).code).toBe(0);
    const res = await sb.run([...base, "--attributes", "class,:class"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("nope");
  });

  it("uses colour only when requested", async () => {
    sb.write("templates/bad.html", HTML_BAD);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/bad.html"];
    expect((await sb.run(base)).stdout).not.toContain("\u001b[");
    expect((await sb.run([...base, "--color"])).stdout).toContain("\u001b[31m");
    expect((await sb.run([...base, "--color", "--no-color"])).stdout).not.toContain("\u001b[");
  });
});

describe("cssert check with config files", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("templates/bad.html", HTML_BAD);
  });

  it("reads cssert.config.json with /regex/ patterns", async () => {
    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["dist/*.css"],
        html: "templates/*.html",
        ignore: ["/^no/"],
        format: "json",
      }),
    );
    const res = await sb.run(["check"]);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).summary.missing).toBe(0);
  });

  it("reads cssert.config.mjs and lets flags override it", async () => {
    sb.write(
      "cssert.config.mjs",
      `export default { css: ["dist/*.css"], html: ["templates/*.html"], allow: [/^no/] };`,
    );
    expect((await sb.run(["check"])).code).toBe(0);
    const res = await sb.run(["check", "--format", "json", "--allow", "text-{{ color }}"]);
    expect(JSON.parse(res.stdout).summary.missing).toBe(0);
  });

  it("accepts --config pointing at a specific file", async () => {
    sb.write(
      "conf/custom.json",
      JSON.stringify({ css: ["../dist/*.css"], html: ["../templates/*.html"] }),
    );
    expect((await sb.run(["check", "--config", "conf/custom.json"])).code).toBe(1);
    expect((await sb.run(["check", "--config", "conf/missing.json"])).code).toBe(2);
  });

  it("rejects malformed configs with exit 2", async () => {
    sb.write("cssert.config.json", "{ not json");
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify([1]));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ css: 1 }));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ ignore: [1] }));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ strictParse: "yes" }));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ baseline: 1 }));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ format: "xml" }));
    expect((await sb.run(["check"])).code).toBe(2);
    sb.write("cssert.config.json", JSON.stringify({ maxWarnings: 1.5 }));
    expect((await sb.run(["check"])).code).toBe(2);
  });

  it("reports a broken .mjs config as a usage error", async () => {
    sb.write("cssert.config.mjs", "export default {");
    const res = await sb.run(["check"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("Failed to load");
  });

  const supportsTypeStripping = (() => {
    const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
    return major >= 23 || (major === 22 && minor >= 18);
  })();

  it.skipIf(!supportsTypeStripping)("reads cssert.config.ts natively", async () => {
    sb.write(
      "cssert.config.ts",
      `const config: { css: string[]; html: string[]; allow: RegExp[] } = { css: ["dist/*.css"], html: ["templates/*.html"], allow: [/^no/] };\nexport default config;\n`,
    );
    expect((await sb.run(["check"])).code).toBe(0);
  });

  it("explains how to load TypeScript configs when native loading fails", async () => {
    sb.write("cssert.config.ts", "export default {"); // syntax error regardless of runtime
    const res = await sb.run(["check"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("cssert.config.mjs");
  });
});

describe("built CLI binary", () => {
  const bin = new URL("../../dist/cli/index.js", import.meta.url);

  it.skipIf(!existsSync(bin))("runs and returns the documented exit codes", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("templates/bad.html", HTML_BAD);
    try {
      await run(
        process.execPath,
        [bin.pathname, "check", "--css", "dist/app.css", "--html", "templates/bad.html"],
        {
          cwd: sb.dir,
        },
      );
      throw new Error("expected non-zero exit");
    } catch (error) {
      const err = error as { code?: number; stdout?: string };
      expect(err.code).toBe(1);
      expect(err.stdout).toContain("✗ nope");
    }
  });
});

describe("cssert check CI formats", () => {
  it("emits github annotations and sarif", async () => {
    const sb = sandbox();
    sb.write("dist/app.css", fixture("tailwind-v4.css"));
    sb.write("templates/bad.html", HTML_BAD);
    const base = ["check", "--css", "dist/app.css", "--html", "templates/bad.html"];

    const gh = await sb.run([...base, "--format", "github"]);
    expect(gh.code).toBe(1);
    expect(gh.stdout).toContain(
      '::error file=templates/bad.html,line=1,col=40,title=cssert%3A missing class::Class "nope"',
    );
    expect(gh.stdout).toContain("::warning file=templates/bad.html,line=2,col=22");

    const sarif = await sb.run([...base, "--format", "sarif"]);
    expect(sarif.code).toBe(1);
    const log = JSON.parse(sarif.stdout);
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].tool.driver.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(log.runs[0].results.map((r: { ruleId: string }) => r.ruleId)).toEqual([
      "cssert/missing-class",
      "cssert/dynamic-class",
    ]);
  });
});
