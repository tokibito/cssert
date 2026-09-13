import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveRoots } from "../../src/cli/roots.js";
import { fixture, type Sandbox, sandbox } from "./helpers.js";

const HTML_BAD = `<div class="flex nope">\n  <p class="text-{{ color }}">x</p>\n</div>\n`;

describe("resolveRoots", () => {
  it("prefers --root, then config.root, then the config directory", () => {
    const cwd = "/repo";
    expect(resolveRoots(cwd, "/repo/frontend/cssert.config.mjs", {}, "build")).toEqual({
      config: "/repo/build",
      flag: "/repo/build",
    });
    expect(
      resolveRoots(cwd, "/repo/frontend/cssert.config.mjs", { root: ".." }, undefined),
    ).toEqual(
      { config: "/repo", flag: "/repo" }, // cwd is /repo here, so both agree
    );
    expect(
      resolveRoots("/repo/frontend", "/repo/frontend/cssert.config.mjs", { root: ".." }, undefined),
    ).toEqual({ config: "/repo", flag: "/repo/frontend" });
    expect(resolveRoots(cwd, "/repo/frontend/cssert.config.mjs", {}, undefined)).toEqual({
      config: "/repo/frontend",
      flag: "/repo",
    });
  });

  it("falls back to cwd without a config file or with resolveFrom: cwd", () => {
    expect(resolveRoots("/repo", undefined, {}, undefined)).toEqual({
      config: "/repo",
      flag: "/repo",
    });
    expect(
      resolveRoots("/repo", "/repo/frontend/cssert.config.mjs", { resolveFrom: "cwd" }, undefined),
    ).toEqual({ config: "/repo", flag: "/repo" });
  });
});

describe("config-relative path resolution", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = sandbox();
    sb.write("frontend/dist/assets/app.css", fixture("tailwind-v4.css"));
    sb.write("build/rendered/page.html", HTML_BAD);
    mkdirSync(join(sb.dir, "frontend/sub"), { recursive: true });
  });

  it("gives the same result from any working directory", async () => {
    sb.write(
      "cssert.config.json",
      JSON.stringify({
        css: ["frontend/dist/assets/*.css"],
        html: ["build/rendered/**/*.html"],
        format: "json",
      }),
    );
    const fromRoot = await sb.run(["check"]);
    const fromSub = await sb.runIn("frontend", ["check", "--config", "../cssert.config.json"]);
    const fromDeep = await sb.runIn("frontend/sub", [
      "check",
      "--config",
      "../../cssert.config.json",
    ]);

    expect(fromRoot.code).toBe(1);
    expect(fromSub.stdout).toBe(fromRoot.stdout);
    expect(fromDeep.stdout).toBe(fromRoot.stdout);
    expect(JSON.parse(fromRoot.stdout).findings[0].occurrences[0].path).toBe(
      "build/rendered/page.html",
    );
  });

  it("resolves config paths against root, and flag globs against cwd", async () => {
    sb.write(
      "frontend/cssert.config.json",
      JSON.stringify({
        root: "..",
        css: ["frontend/dist/assets/*.css"],
        html: ["build/**/*.html"],
      }),
    );
    expect((await sb.runIn("frontend", ["check"])).code).toBe(1);

    // A glob typed on the command line still means "relative to where I am".
    const flags = await sb.runIn("frontend", [
      "check",
      "--css",
      "dist/assets/*.css",
      "--html",
      "../build/rendered/*.html",
    ]);
    expect(flags.code).toBe(1);
    expect(flags.stdout).toContain("../build/rendered/page.html");
  });

  it("restores cwd-relative resolution with resolveFrom: cwd", async () => {
    sb.write(
      "frontend/cssert.config.json",
      JSON.stringify({
        resolveFrom: "cwd",
        css: ["frontend/dist/assets/*.css"],
        html: ["build/**/*.html"],
      }),
    );
    expect((await sb.run(["check", "--config", "frontend/cssert.config.json"])).code).toBe(1);
    expect((await sb.runIn("frontend", ["check", "--config", "cssert.config.json"])).code).toBe(2);
    expect(
      (await sb.run(["check", "--config", "frontend/cssert.config.json", "--root", "."])).code,
    ).toBe(1);
  });

  it("writes the baseline next to the config and the budget snapshot too", async () => {
    sb.write(
      "frontend/cssert.config.json",
      JSON.stringify({
        root: "..",
        css: ["frontend/dist/assets/*.css"],
        html: ["build/**/*.html"],
      }),
    );
    expect((await sb.runIn("frontend", ["baseline", "create"])).code).toBe(0);
    expect(() => sb.read(".cssert/baseline.json")).not.toThrow();
    expect((await sb.runIn("frontend", ["check"])).code).toBe(0);

    expect((await sb.runIn("frontend", ["budget"])).code).toBe(0);
    expect(() => sb.read(".cssert/budget.json")).not.toThrow();
  });

  it("rejects a config whose resolveFrom is not config or cwd", async () => {
    sb.write("cssert.config.json", JSON.stringify({ resolveFrom: "nowhere" }));
    const res = await sb.run(["check"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("resolveFrom");
  });
});
