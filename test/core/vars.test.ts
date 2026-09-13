import { describe, expect, it } from "vitest";
import { loadStylesheet } from "../../src/core/query.js";
import { splitVarArguments } from "../../src/core/vars.js";

const theme = `
  @layer theme { :root, :host { --color-red-500: oklch(63.7% 0.237 25.331); --spacing: 0.25rem;
    --alias: var(--color-red-500); --deep: var(--alias);
    --a: var(--b); --b: var(--a); --self: var(--self);
    --with-fallback: var(--missing, 1rem); --nested-fallback: var(--missing, var(--spacing));
    --font: "Segoe UI", var(--missing, Roboto), sans-serif; } }
  @property --tw-border-style { syntax: "*"; inherits: false; initial-value: solid; }
  *, ::before, ::after { --tw-shadow: 0 0 #0000; }
  @media (prefers-color-scheme: dark) { :root { --color-red-500: red } }
  .scoped { --spacing: 1rem; --local-only: 2rem }
  .bg-red-500 { background-color: var(--color-red-500) }
`;

describe("resolveVar", () => {
  const sheet = loadStylesheet(theme);

  it("reads root-scoped values through @layer", () => {
    expect(sheet.resolveVar("--color-red-500")).toBe("oklch(63.7% 0.237 25.331)");
  });

  it("follows chains of var() references", () => {
    expect(sheet.resolveVar("--alias")).toBe("oklch(63.7% 0.237 25.331)");
    expect(sheet.resolveVar("--deep")).toBe("oklch(63.7% 0.237 25.331)");
  });

  it("returns undefined for cycles and self references", () => {
    expect(sheet.resolveVar("--a")).toBeUndefined();
    expect(sheet.resolveVar("--b")).toBeUndefined();
    expect(sheet.resolveVar("--self")).toBeUndefined();
  });

  it("applies fallbacks, including nested var() fallbacks", () => {
    expect(sheet.resolveVar("--with-fallback")).toBe("1rem");
    expect(sheet.resolveVar("--nested-fallback")).toBe("0.25rem");
    expect(sheet.resolveVar("--font")).toBe('"Segoe UI", Roboto, sans-serif');
  });

  it("falls back to universal selectors and @property initial values", () => {
    expect(sheet.resolveVar("--tw-shadow")).toBe("0 0 #0000");
    expect(sheet.resolveVar("--tw-border-style")).toBe("solid");
  });

  it("ignores declarations inside conditional at-rules", () => {
    expect(sheet.resolveVar("--color-red-500")).not.toBe("red");
  });

  it("returns undefined for unknown properties", () => {
    expect(sheet.resolveVar("--nope")).toBeUndefined();
    expect(sheet.resolveVar("--local-only")).toBeUndefined();
  });

  it("consults a scope before the root", () => {
    expect(sheet.resolveVar("--spacing", ".scoped")).toBe("1rem");
    expect(sheet.resolveVar("--spacing", "scoped")).toBe("1rem");
    expect(sheet.resolveVar("--local-only", ".scoped")).toBe("2rem");
    expect(sheet.resolveVar("--color-red-500", ".scoped")).toBe("oklch(63.7% 0.237 25.331)");
  });

  it("prefers !important declarations and later declarations otherwise", () => {
    const s = loadStylesheet(`:root { --x: 1; --x: 2 } html { --y: 1 !important; --y: 2 }`);
    expect(s.resolveVar("--x")).toBe("2");
    expect(s.resolveVar("--y")).toBe("1");
  });
});

describe("resolveValue", () => {
  const sheet = loadStylesheet(theme);

  it("expands var() inside larger expressions", () => {
    expect(sheet.resolveValue("calc(var(--spacing) * 4)")).toBe("calc(0.25rem * 4)");
    expect(sheet.resolveValue("var(--color-red-500)")).toBe("oklch(63.7% 0.237 25.331)");
  });

  it("leaves unresolvable references as written", () => {
    expect(sheet.resolveValue("var(--nope)")).toBe("var(--nope)");
    expect(sheet.resolveValue("1px solid var(--nope)")).toBe("1px solid var(--nope)");
    expect(sheet.resolveValue("var(--a)")).toBe("var(--a)");
  });

  it("uses fallbacks and resolves inside them", () => {
    expect(sheet.resolveValue("var(--nope, var(--spacing))")).toBe("0.25rem");
    expect(sheet.resolveValue("var(--nope, 1px, 2px)")).toBe("1px, 2px");
  });

  it("does not treat identifiers ending in var( as references and tolerates unbalanced input", () => {
    expect(sheet.resolveValue("myvar(--spacing)")).toBe("myvar(--spacing)");
    expect(sheet.resolveValue("var(--spacing")).toBe("var(--spacing");
    expect(sheet.resolveValue("var(spacing)")).toBe("var(spacing)");
  });

  it("is case-insensitive for the function name and honours scope", () => {
    expect(sheet.resolveValue("VAR(--spacing)")).toBe("0.25rem");
    expect(sheet.resolveValue("var(--spacing)", ".scoped")).toBe("1rem");
  });

  it("ignores commas and parens inside quoted strings", () => {
    const s = loadStylesheet(`:root { --q: "a,b)" }`);
    expect(s.resolveValue('var(--q, "x,y")')).toBe('"a,b)"');
    expect(s.resolveValue('var(--nope, "x,(y")')).toBe('"x,(y"');
    expect(s.resolveValue("var(--nope, 'x\\')')")).toBe("'x\\')'");
  });
});

describe("splitVarArguments", () => {
  it("splits at the first top-level comma only", () => {
    expect(splitVarArguments("--a, rgb(1, 2, 3), x")).toEqual({
      name: "--a",
      fallback: "rgb(1, 2, 3), x",
    });
    expect(splitVarArguments(" --a ")).toEqual({ name: "--a", fallback: undefined });
  });
});
