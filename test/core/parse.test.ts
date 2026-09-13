import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../../src/core/parse.js";
import { loadStylesheet } from "../../src/core/query.js";

describe("nesting", () => {
  it("expands &:hover into pseudo and stacks nested @media into conditions", () => {
    const sheet = loadStylesheet(`
      .hover\\:bg-red-500 {
        &:hover {
          @media (hover: hover) {
            background-color: var(--color-red-500);
          }
        }
      }`);
    const [m] = sheet.match("hover:bg-red-500");
    expect(m).toMatchObject({
      selector: ".hover\\:bg-red-500:hover",
      subject: true,
      pseudo: [":hover"],
      conditions: ["(hover: hover)"],
      declarations: [{ prop: "background-color", value: "var(--color-red-500)", important: false }],
    });
  });

  it("keeps declarations at different nesting levels as separate matches", () => {
    const sheet = loadStylesheet(
      `.a { color: red; &:hover { color: blue } .b & { color: green } }`,
    );
    const matches = sheet.match("a");
    expect(matches.map((m) => [m.selector, m.pseudo, m.declarations[0]?.value])).toEqual([
      [".a", [], "red"],
      [".a:hover", [":hover"], "blue"],
      [".b .a", [], "green"],
    ]);
    expect(matches.map((m) => m.order)).toEqual([0, 1, 3]);
  });

  it("treats a nested selector without & as a descendant", () => {
    const sheet = loadStylesheet(`.card { .title { font-weight: 700 } > .x { color: red } }`);
    expect(sheet.match("title")[0]?.selector).toBe(".card .title");
    expect(sheet.match("x")[0]?.selector).toBe(".card > .x");
    expect(sheet.match("card", { subjectOnly: false }).map((m) => m.subject)).toEqual([
      false,
      false,
    ]);
  });

  it("expands nesting against a selector list", () => {
    const sheet = loadStylesheet(`.a, .b { &:hover { color: red } }`);
    expect(sheet.match("a")[0]?.selector).toBe(".a:hover");
    expect(sheet.match("b")[0]?.selector).toBe(".b:hover");
  });

  it("handles & > * inside @media (Tailwind arbitrary variant)", () => {
    const sheet = loadStylesheet(`
      .md\\:\\[\\&\\>\\*\\]\\:p-2 { @media (width >= 48rem) { &>* { padding: 1rem } } }`);
    const [m] = sheet.match("md:[&>*]:p-2", { subjectOnly: false });
    expect(m?.selector).toBe(".md\\:\\[\\&\\>\\*\\]\\:p-2 > *");
    expect(m?.subject).toBe(false);
    expect(m?.conditions).toEqual(["(width >= 48rem)"]);
    expect(sheet.classes().has("md:[&>*]:p-2")).toBe(true);
  });
});

describe("conditions", () => {
  it("stacks nested @media outermost first", () => {
    const sheet = loadStylesheet(`
      @media (width >= 40rem) { @media (hover: hover) { .sm\\:hover\\:underline:hover { text-decoration-line: underline } } }`);
    const [m] = sheet.match("sm:hover:underline");
    expect(m?.conditions).toEqual(["(width >= 40rem)", "(hover: hover)"]);
    expect(m?.pseudo).toEqual([":hover"]);
  });

  it("prefixes non-media at-rules with their name", () => {
    const sheet = loadStylesheet(`
      @supports (display: grid) { .g { display: grid } }
      @container sidebar (min-width: 400px) { .c { display: flex } }
      .s { @starting-style { opacity: 0 } }`);
    expect(sheet.match("g")[0]?.conditions).toEqual(["@supports (display: grid)"]);
    expect(sheet.match("c")[0]?.conditions).toEqual(["@container sidebar (min-width: 400px)"]);
    expect(sheet.match("s")[0]?.conditions).toEqual(["@starting-style"]);
  });

  it("filters by condition with min-width/range equivalence", () => {
    const sheet = loadStylesheet(`@media (min-width: 48rem) { .md\\:p-4 { padding: 1rem } }`);
    expect(sheet.match("md:p-4", { condition: "(width >= 48rem)" })).toHaveLength(1);
    expect(sheet.match("md:p-4", { condition: /48rem/ })).toHaveLength(1);
    expect(sheet.match("md:p-4", { condition: "(width >= 64rem)" })).toHaveLength(0);
  });
});

describe("layers", () => {
  it("records nested and dotted layer names outermost first", () => {
    const sheet = loadStylesheet(`
      @layer theme, base, utilities;
      @layer utilities { .u { color: red } @layer inner.deep { .d { color: blue } } }
      @layer { .anon { color: green } }`);
    expect(sheet.match("u")[0]?.layers).toEqual(["utilities"]);
    expect(sheet.match("d")[0]?.layers).toEqual(["utilities", "inner", "deep"]);
    expect(sheet.match("anon")[0]?.layers).toEqual(["<anonymous>"]);
  });
});

describe("subject detection", () => {
  it("marks .group in .group:hover .foo as non-subject with its own pseudo", () => {
    const sheet = loadStylesheet(`.group:hover .foo { color: red }`);
    expect(sheet.hasClass("foo")).toBe(true);
    expect(sheet.hasClass("group")).toBe(false);
    expect(sheet.match("group")).toEqual([]);
    const [g] = sheet.match("group", { subjectOnly: false });
    expect(g).toMatchObject({ subject: false, pseudo: [":hover"], selector: ".group:hover .foo" });
    expect(sheet.match("foo")[0]?.pseudo).toEqual([]);
  });

  it("looks inside :is()/:where() and treats their inner subjects correctly", () => {
    const sheet = loadStylesheet(
      `.group-hover\\:underline:is(:where(.group):hover *) { text-decoration-line: underline }`,
    );
    expect(sheet.hasClass("group-hover:underline")).toBe(true);
    expect(sheet.hasClass("group")).toBe(false);
    expect(sheet.classes()).toEqual(new Set(["group-hover:underline", "group"]));
    const [g] = sheet.match("group", { subjectOnly: false });
    expect(g?.pseudo).toEqual([":hover"]);
    expect(sheet.match("group-hover:underline")[0]?.pseudo).toEqual([
      ":is(:where(.group):hover *)",
    ]);
  });

  it("includes classes wrapped in :where()/:is() in classes() and as subjects", () => {
    const sheet = loadStylesheet(
      `:where(.bar) { color: blue } :is(.baz, .qux) .end { color: red }`,
    );
    expect(sheet.classes()).toEqual(new Set(["bar", "baz", "qux", "end"]));
    expect(sheet.hasClass("bar")).toBe(true);
    expect(sheet.hasClass("baz")).toBe(false);
    expect(sheet.hasClass("end")).toBe(true);
  });

  it("never treats classes inside :not()/:has() as subjects", () => {
    const sheet = loadStylesheet(`.a:not(.b) { color: red } .c:has(.d) { color: red }`);
    expect(sheet.hasClass("a")).toBe(true);
    expect(sheet.hasClass("b")).toBe(false);
    expect(sheet.hasClass("d")).toBe(false);
    expect(sheet.classes().has("b")).toBe(true);
    expect(sheet.match("a")[0]?.pseudo).toEqual([":not(.b)"]);
  });

  it("de-duplicates repeated classes in one selector, preferring the subject role", () => {
    const sheet = loadStylesheet(`.a .a:hover { color: red }`);
    const matches = sheet.match("a", { subjectOnly: false });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ subject: true, pseudo: [":hover"] });
  });

  it("attaches pseudo-elements and inherited pseudos", () => {
    const sheet = loadStylesheet(`.before\\:content-\\[\\'\\'\\]::before { content: '' }`);
    expect(sheet.match("before:content-['']")[0]?.pseudo).toEqual(["::before"]);
  });
});

describe("robustness", () => {
  it("does not throw on broken CSS and records a warning", () => {
    const parsed = parseStylesheet(`.ok { color: red } .broken { color: `, { path: "x.css" });
    expect(parsed.classes.has("ok")).toBe(true);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toMatchObject({ code: "css-syntax", path: "x.css" });
    expect(parsed.warnings[0]?.source).toBeDefined();
  });

  it("records a warning for unparsable selectors and skips them", () => {
    const sheet = loadStylesheet(`.a:: { color: red } .fine { color: blue }`);
    expect(sheet.warnings.map((w) => w.code)).toEqual(["selector-parse"]);
    expect(sheet.hasClass("fine")).toBe(true);
    expect(sheet.classes().has("a")).toBe(false);
  });

  it("returns an empty model for empty input", () => {
    const sheet = loadStylesheet("");
    expect(sheet.classes().size).toBe(0);
    expect(sheet.warnings).toEqual([]);
  });

  it("skips @keyframes, @font-face and statement at-rules", () => {
    const sheet = loadStylesheet(`
      @charset "utf-8";
      @import url(x.css);
      @keyframes spin { to { transform: rotate(360deg) } }
      @font-face { font-family: X; src: url(x.woff2) }
      .spin { animation: spin 1s }`);
    expect(sheet.classes()).toEqual(new Set(["spin"]));
    expect(sheet.warnings).toEqual([]);
  });

  it("emits a declaration-less match for empty rules but not for pure containers", () => {
    const sheet = loadStylesheet(`.empty {} .outer { &:hover { color: red } }`);
    expect(sheet.match("empty")).toHaveLength(1);
    expect(sheet.match("empty")[0]?.declarations).toEqual([]);
    expect(sheet.match("outer").map((m) => m.selector)).toEqual([".outer:hover"]);
  });

  it("records !important and source positions", () => {
    const sheet = loadStylesheet(`\n\n  .x { color: red !important }`);
    const [m] = sheet.match("x");
    expect(m?.declarations).toEqual([{ prop: "color", value: "red", important: true }]);
    expect(m?.source).toEqual({ line: 3, column: 3 });
  });

  it("ignores attribute selectors on class and comments inside selectors", () => {
    const sheet = loadStylesheet(`[class~="fake"] /* c */ .real { color: red }`);
    expect(sheet.classes()).toEqual(new Set(["real"]));
  });
});
