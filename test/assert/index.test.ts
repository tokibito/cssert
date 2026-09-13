import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CssertAssertionError, expectClass, similarClasses } from "../../src/assert/index.js";
import { loadStylesheet } from "../../src/core/query.js";

const css = readFileSync(new URL("../fixtures/tailwind-v4.css", import.meta.url), "utf8");
const sheet = loadStylesheet(css);

describe("expectClass", () => {
  it("passes for existing classes and fails with suggestions for missing ones", () => {
    expect(() => expectClass(sheet, "bg-brand-500").toExist()).not.toThrow();
    expect(() => expectClass(sheet, "group").toExist()).not.toThrow();
    let error: unknown;
    try {
      expectClass(sheet, "bg-brand-400").toExist();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CssertAssertionError);
    const err = error as CssertAssertionError;
    expect(err.name).toBe("CssertAssertionError");
    expect(err.className).toBe("bg-brand-400");
    expect(err.matches).toEqual([]);
    expect(err.message).toContain('Expected class "bg-brand-400" to exist.');
    expect(err.message).toContain("No matching selector found.");
    expect(err.message).toContain("Similar classes: bg-brand-500");
  });

  it("restricts to subjects with asSubject()", () => {
    expect(() => expectClass(sheet, "group").asSubject().toExist()).toThrow(/as subject/);
    expect(() => expectClass(sheet, "flex").asSubject().toExist()).not.toThrow();
  });

  it("checks declarations", () => {
    expect(() => expectClass(sheet, "bg-brand-500").toDeclare("background-color")).not.toThrow();
    expect(() => expectClass(sheet, "bg-brand-500").toDeclare("Background-Color")).not.toThrow();
    expect(() => expectClass(sheet, "bg-brand-500").toDeclare("color")).toThrow(
      /to declare "color"\.\n {2}Considered 1 match\(es\):\n {4}\.bg-brand-500 {2}\[@layer utilities\] {2}\{ background-color: var\(--color-brand-500\) \}/,
    );
  });

  it("resolves var() chains for toResolveTo", () => {
    expect(() =>
      expectClass(sheet, "bg-brand-500").toResolveTo("background-color", "#0f62fe"),
    ).not.toThrow();
    expect(() =>
      expectClass(sheet, "text-brand-fg").toResolveTo("color", "oklch(98%   0 0)"),
    ).not.toThrow();
    expect(() => expectClass(sheet, "bg-brand-500").toResolveTo("background-color", "red")).toThrow(
      /resolved "background-color" to #0f62fe/,
    );
    expect(() => expectClass(sheet, "bg-brand-500").toResolveTo("color", "red")).toThrow(
      /"color" is not declared/,
    );
  });

  it("filters by condition and pseudo", () => {
    expect(() =>
      expectClass(sheet, "md:p-4").under("(min-width: 48rem)").toDeclare("padding"),
    ).not.toThrow();
    expect(() => expectClass(sheet, "md:p-4").under("(width >= 64rem)").toExist()).toThrow(
      /under \(width >= 64rem\)/,
    );
    expect(() => expectClass(sheet, "md:p-4").under(/48rem/).toExist()).not.toThrow();
    expect(() =>
      expectClass(sheet, "hover:underline").withPseudo(":hover").toExist(),
    ).not.toThrow();
    expect(() => expectClass(sheet, "hover:underline").withPseudo(":focus").toExist()).toThrow(
      /with pseudo :focus/,
    );
    expect(() =>
      expectClass(sheet, "sm:hover:underline")
        .under("(width >= 40rem)")
        .withPseudo(":hover")
        .toDeclare("text-decoration-line"),
    ).not.toThrow();
  });

  it("supports negation", () => {
    expect(() => expectClass(sheet, "debug-outline").not.toExist()).not.toThrow();
    expect(() => expectClass(sheet, "flex").not.toExist()).toThrow(/not to exist/);
    expect(() => expectClass(sheet, "flex").not.toDeclare("color")).not.toThrow();
    expect(() => expectClass(sheet, "flex").not.toResolveTo("display", "grid")).not.toThrow();
  });

  it("describes conditions and truncates long match lists", () => {
    const many = loadStylesheet(
      Array.from({ length: 12 }, (_, i) => `@media (min-width: ${i}px) { .x { color: red } }`).join(
        "\n",
      ),
    );
    let message = "";
    try {
      expectClass(many, "x").toDeclare("padding");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Considered 12 match(es)");
    expect(message).toContain("… 2 more");
    expect(message).toContain("@media (width >= 0px)");

    const supports = loadStylesheet(
      `@supports (display: grid) { .g { display: grid !important } }`,
    );
    expect(() => expectClass(supports, "g").toDeclare("color")).toThrow(
      /\[@supports \(display: grid\)\] {2}\{ display: grid !important \}/,
    );
  });
});

describe("similarClasses", () => {
  it("suggests classes sharing a long prefix, best first", () => {
    const s = loadStylesheet(
      ".bg-red-500 {} .bg-red-600 {} .bg-blue-500 {} .text-red-500 {} .b {}",
    );
    expect(similarClasses(s, "bg-red-400")).toEqual(["bg-red-500", "bg-red-600"]);
    expect(similarClasses(s, "bg-red-400", 1)).toEqual(["bg-red-500"]);
    expect(similarClasses(s, "zzz")).toEqual([]);
  });
});
