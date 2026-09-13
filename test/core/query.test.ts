import { describe, expect, it } from "vitest";
import { loadStylesheet, pickWinner } from "../../src/core/query.js";

describe("StylesheetModel queries", () => {
  const sheet = loadStylesheet(`
    .btn { color: red; padding: 1rem }
    .btn:hover { color: blue }
    @media (min-width: 48rem) { .btn { padding: 2rem } }
    .card .btn { margin: 0 }
    .caf\\e9  { color: green }
  `);

  it("returns subject matches by default and all matches on request", () => {
    expect(sheet.match("btn")).toHaveLength(4);
    expect(sheet.match("btn", { subjectOnly: false })).toHaveLength(4);
    expect(sheet.match("card")).toHaveLength(0);
    expect(sheet.match("card", { subjectOnly: false })).toHaveLength(1);
  });

  it("filters by pseudo and condition", () => {
    expect(sheet.match("btn", { pseudo: ":hover" }).map((m) => m.selector)).toEqual([".btn:hover"]);
    expect(sheet.match("btn", { condition: "(width >= 48rem)" }).map((m) => m.order)).toEqual([2]);
    expect(sheet.match("btn", { pseudo: ":focus" })).toEqual([]);
  });

  it("flattens declarations in source order", () => {
    expect(sheet.declarationsFor("btn").map((d) => `${d.prop}:${d.value}`)).toEqual([
      "color:red",
      "padding:1rem",
      "color:blue",
      "padding:2rem",
      "margin:0",
    ]);
    expect(sheet.declarationsFor("nope")).toEqual([]);
  });

  it("normalises the queried class name like the selector side", () => {
    expect(sheet.hasClass("caf\u00e9")).toBe(true);
    expect(sheet.hasClass("cafe\u0301")).toBe(true);
    expect(sheet.match("cafe\u0301")).toHaveLength(1);
  });

  it("exposes warnings", () => {
    expect(sheet.warnings).toEqual([]);
  });
});

describe("pickWinner", () => {
  it("returns the last declaration for the property", () => {
    const decls = [
      { prop: "color", value: "red", important: false },
      { prop: "padding", value: "1rem", important: false },
      { prop: "color", value: "blue", important: false },
    ];
    expect(pickWinner(decls, "color")?.value).toBe("blue");
    expect(pickWinner(decls, "Padding")?.value).toBe("1rem");
    expect(pickWinner(decls, "margin")).toBeUndefined();
  });

  it("lets !important beat later normal declarations", () => {
    const decls = [
      { prop: "color", value: "red", important: true },
      { prop: "color", value: "blue", important: false },
      { prop: "color", value: "green", important: true },
      { prop: "color", value: "pink", important: false },
    ];
    expect(pickWinner(decls, "color")?.value).toBe("green");
  });
});
