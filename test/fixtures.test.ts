import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadStylesheet } from "../src/index.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("Tailwind v4 (flat output)", () => {
  const sheet = loadStylesheet(fixture("tailwind-v4.css"));

  it("parses without warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });

  it.each([
    "flex",
    "md:p-4",
    "lg:my-10",
    "2xl:flex",
    "@max-md:flex",
    "@container",
    "w-1/2",
    "bg-[#fff]",
    "p-[calc(1rem+2px)]",
    "hover:bg-red-500",
    "sm:hover:underline",
    "text-red-500!",
    "group-hover:underline",
    "peer-checked:block",
    "before:content-['']",
    "data-[state=open]:flex",
    "supports-[display:grid]:grid",
    "bg-brand-500",
    "md:grid-cols-[1fr_2fr]",
    "w-(--sidebar-width)",
  ])("has %s as a subject", (cls) => {
    expect(sheet.hasClass(cls)).toBe(true);
  });

  it("keeps marker classes and ancestor-only classes in classes()", () => {
    expect(sheet.classes().has("group")).toBe(true);
    expect(sheet.classes().has("peer")).toBe(true);
    expect(sheet.classes().has("md:[&>*]:p-2")).toBe(true);
    expect(sheet.hasClass("group")).toBe(false);
    expect(sheet.hasClass("md:[&>*]:p-2")).toBe(false);
  });

  it("distinguishes md:p-4 from p-4 by condition", () => {
    const [m] = sheet.match("md:p-4");
    expect(m?.conditions).toEqual(["(width >= 48rem)"]);
    expect(m?.layers).toEqual(["utilities"]);
    expect(sheet.hasClass("p-4")).toBe(false);
  });

  it("stacks sm:hover conditions and pseudo", () => {
    const [m] = sheet.match("sm:hover:underline");
    expect(m?.conditions).toEqual(["(width >= 40rem)", "(hover: hover)"]);
    expect(m?.pseudo).toEqual([":hover"]);
  });

  it("records container queries and supports as prefixed conditions", () => {
    expect(sheet.match("@max-md:flex")[0]?.conditions).toEqual(["@container (width < 28rem)"]);
    expect(sheet.match("supports-[display:grid]:grid")[0]?.conditions).toEqual([
      "@supports (display:grid)",
    ]);
  });

  it("resolves theme variables down to colour values", () => {
    expect(sheet.resolveVar("--color-red-500")).toBe("oklch(63.7% 0.237 25.331)");
    expect(sheet.resolveVar("--color-brand-500")).toBe("#0f62fe");
    const [decl] = sheet.declarationsFor("bg-brand-500");
    expect(sheet.resolveValue(decl?.value ?? "")).toBe("#0f62fe");
    expect(sheet.resolveValue(sheet.declarationsFor("md:p-4")[0]?.value ?? "")).toBe(
      "calc(0.25rem * 4)",
    );
  });

  it("uses @property initial values for --tw-* registered properties", () => {
    expect(sheet.resolveVar("--tw-outline-style")).toBe("solid");
    expect(
      sheet.resolveValue(sheet.declarationsFor("focus-visible:outline-2")[0]?.value ?? ""),
    ).toBe("solid");
  });

  it("captures !important", () => {
    expect(sheet.declarationsFor("text-red-500!")[0]?.important).toBe(true);
  });
});

describe("Tailwind v4.0 (nested output)", () => {
  const sheet = loadStylesheet(fixture("tailwind-v4.0-nested.css"));

  it("parses without warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });

  it("expands nested variants", () => {
    const [m] = sheet.match("hover:bg-red-500");
    expect(m).toMatchObject({
      selector: ".hover\\:bg-red-500:hover",
      pseudo: [":hover"],
      conditions: ["(hover: hover)"],
      layers: ["utilities"],
    });
    expect(sheet.match("sm:hover:underline")[0]?.conditions).toEqual([
      "(width >= 40rem)",
      "(hover: hover)",
    ]);
    expect(sheet.match("2xl:flex")[0]?.conditions).toEqual(["(width >= 96rem)"]);
    expect(sheet.match("before:content-['']")[0]?.pseudo).toEqual(["::before"]);
    expect(sheet.match("group-hover:underline")[0]?.selector).toBe(
      ".group-hover\\:underline:is(:where(.group):hover *)",
    );
    expect(sheet.match("md:[&>*]:p-2", { subjectOnly: false })[0]?.selector).toBe(
      ".md\\:\\[\\&\\>\\*\\]\\:p-2 > *",
    );
  });

  it("resolves variables identically to the flat output", () => {
    expect(sheet.resolveValue(sheet.declarationsFor("bg-brand-500")[0]?.value ?? "")).toBe(
      "#0f62fe",
    );
  });
});

describe("Tailwind v3", () => {
  const sheet = loadStylesheet(fixture("tailwind-v3.css"));

  it("parses without warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });

  it("finds variants with direct values and min-width media queries", () => {
    expect(sheet.hasClass("!text-red-500")).toBe(true);
    expect(sheet.hasClass("2xl:flex")).toBe(true);
    expect(sheet.match("md:p-4")[0]?.conditions).toEqual(["(min-width: 768px)"]);
    expect(sheet.match("md:p-4", { condition: "(width >= 768px)" })).toHaveLength(1);
    expect(sheet.match("md:p-4")[0]?.layers).toEqual([]);
    expect(sheet.declarationsFor("md:p-4")).toEqual([
      { prop: "padding", value: "1rem", important: false },
    ]);
  });

  it("treats .group in .group:hover .group-hover\\:underline as non-subject", () => {
    expect(sheet.hasClass("group-hover:underline")).toBe(true);
    expect(sheet.hasClass("group")).toBe(false);
    expect(sheet.classes().has("group")).toBe(true);
    expect(sheet.hasClass("dark:bg-black")).toBe(true);
    expect(sheet.hasClass("dark")).toBe(false);
  });
});

describe("UnoCSS", () => {
  const sheet = loadStylesheet(fixture("unocss.css"));

  it("parses without warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });

  it("handles grouped selectors and minified output", () => {
    expect(sheet.hasClass("data-[state=open]:flex")).toBe(true);
    expect(sheet.hasClass("flex")).toBe(true);
    expect(sheet.hasClass("2xl:flex")).toBe(true);
    expect(sheet.hasClass("!text-red-500")).toBe(true);
    expect(sheet.match("dark:bg-black")[0]?.selector).toBe(".dark .dark\\:bg-black");
    expect(sheet.hasClass("dark")).toBe(false);
    expect(sheet.resolveVar("--un-ring-offset-width")).toBe("0px");
  });
});

describe("plain CSS with hashed class names", () => {
  const sheet = loadStylesheet(fixture("plain/styles.css"));

  it("parses without warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });

  it("finds hashed and escaped class names", () => {
    expect(sheet.hasClass("button_a1B2c3")).toBe(true);
    expect(sheet.hasClass("title_q1W2e3")).toBe(true);
    expect(sheet.hasClass("card_x9Y8z7")).toBe(true);
    expect(sheet.hasClass("10-col")).toBe(true);
    expect(sheet.hasClass("icon.svg")).toBe(true);
    expect(sheet.hasClass("emoji😀")).toBe(true);
  });

  it("resolves color-mix through var() and detects self reference", () => {
    expect(sheet.resolveVar("--brand-hover")).toBe("color-mix(in oklab, #0f62fe, black 10%)");
    expect(sheet.resolveVar("--self")).toBeUndefined();
  });

  it("reports the hover and focus-visible matches separately from the base", () => {
    const matches = sheet.match("button_a1B2c3");
    expect(matches.map((m) => m.pseudo)).toEqual([[], [":hover"], [":focus-visible"]]);
  });
});
