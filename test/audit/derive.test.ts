import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit, DEFAULT_IGNORE } from "../../src/audit/derive.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("audit", () => {
  it("reports classes used in HTML but absent from every stylesheet", () => {
    const result = audit({
      stylesheets: [
        { path: "a.css", css: ".flex { display: flex } .group:hover .x { color: red }" },
        { path: "b.css", css: "@media (min-width: 48rem) { .md\\:p-4 { padding: 1rem } }" },
      ],
      documents: [
        {
          path: "one.html",
          html: `<div class="flex md:p-4 lg:my-10 group">\n<p class="lg:my-10 js-x">`,
        },
        { path: "two.html", html: `<i class="bg-brand-500 text-{{ color }}">` },
      ],
    });
    expect(result.findings).toEqual([
      {
        className: "lg:my-10",
        kind: "missing",
        occurrences: [
          { path: "one.html", line: 1, column: 25 },
          { path: "one.html", line: 2, column: 11 },
        ],
      },
      {
        className: "bg-brand-500",
        kind: "missing",
        occurrences: [{ path: "two.html", line: 1, column: 11 }],
      },
      {
        className: "text-{{ color }}",
        kind: "dynamic-suspect",
        occurrences: [{ path: "two.html", line: 1, column: 24 }],
      },
    ]);
    expect(result.stats).toEqual({ documents: 2, stylesheets: 2, cssClasses: 4, htmlClasses: 5 });
    expect(result.warnings).toEqual([]);
  });

  it("honours allow, extra ignore and disabling the default ignore list", () => {
    const base = {
      stylesheets: [{ path: "a.css", css: ".a {}" }],
      documents: [{ path: "d.html", html: `<p class="a js-x custom nope">` }],
    };
    expect(audit(base).findings.map((f) => f.className)).toEqual(["custom", "nope"]);
    expect(audit({ ...base, allow: ["custom"] }).findings.map((f) => f.className)).toEqual([
      "nope",
    ]);
    expect(audit({ ...base, ignore: [/^no/] }).findings.map((f) => f.className)).toEqual([
      "custom",
    ]);
    expect(audit({ ...base, useDefaultIgnore: false }).findings.map((f) => f.className)).toEqual([
      "js-x",
      "custom",
      "nope",
    ]);
    expect(DEFAULT_IGNORE.some((p) => p.test("js-x"))).toBe(true);
  });

  it("collects parse warnings with the stylesheet path", () => {
    const result = audit({
      stylesheets: [{ path: "broken.css", css: ".a { color: " }],
      documents: [],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "css-syntax", path: "broken.css" });
    expect(result.findings).toEqual([]);
  });

  it("scans configured attributes", () => {
    const result = audit({
      stylesheets: [{ path: "a.css", css: ".a {}" }],
      documents: [{ path: "d.html", html: `<p :class="{ 'a b': x }">` }],
      attributes: ["class", ":class"],
    });
    expect(result.findings.map((f) => f.className)).toEqual(["b"]);
  });

  it("de-duplicates identical occurrences across repeated documents", () => {
    const doc = { path: "d.html", html: `<p class="nope">` };
    const result = audit({ stylesheets: [], documents: [doc, doc] });
    expect(result.findings[0]?.occurrences).toHaveLength(1);
  });

  it("finds nothing missing when the fixture HTML is audited against its own build", () => {
    for (const [css, html] of [
      ["tailwind-v4.css", "src/tailwind-v4/index.html"],
      ["tailwind-v4.0-nested.css", "src/tailwind-v4/index.html"],
      ["tailwind-v3.css", "src/tailwind-v3/index.html"],
      ["unocss.css", "src/unocss/index.html"],
    ] as const) {
      const result = audit({
        stylesheets: [{ path: css, css: fixture(css) }],
        documents: [{ path: html, html: fixture(html) }],
      });
      expect(result.findings, css).toEqual([]);
      expect(result.warnings, css).toEqual([]);
    }
  });

  it("detects a class dropped from the build", () => {
    const css = fixture("tailwind-v4.css").replace(/\.lg\\:my-10 \{[^}]*\}/, "");
    const result = audit({
      stylesheets: [{ path: "tailwind-v4.css", css }],
      documents: [{ path: "index.html", html: fixture("src/tailwind-v4/index.html") }],
    });
    expect(result.findings.map((f) => f.className)).toEqual(["lg:my-10"]);
  });
});
