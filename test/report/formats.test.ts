import { describe, expect, it } from "vitest";
import { formatHuman } from "../../src/report/human.js";
import { formatJson, toJsonReport } from "../../src/report/json.js";
import { countFindings, type Report } from "../../src/report/types.js";

const report: Report = {
  findings: [
    {
      className: "lg:my-10",
      kind: "missing",
      occurrences: [
        { path: "templates/pricing.html", line: 42, column: 18 },
        { path: "templates/pricing.html", line: 88, column: 10 },
      ],
    },
    {
      className: "bg-brand-500",
      kind: "missing",
      occurrences: [{ path: "templates/base.html", line: 12, column: 6 }],
    },
    {
      className: "text-{{ color }}",
      kind: "dynamic-suspect",
      occurrences: [{ path: "templates/card.html", line: 7, column: 22 }],
    },
  ],
  warnings: [
    {
      code: "css-syntax",
      message: "Unclosed block",
      path: "dist/a.css",
      source: { line: 3, column: 1 },
    },
    { code: "selector-parse", message: "bad selector" },
  ],
  stats: { documents: 128, stylesheets: 3, cssClasses: 400, htmlClasses: 120 },
  baseline: { path: ".cssert/baseline.json", suppressed: 4 },
};

describe("formatHuman", () => {
  it("aligns findings, continues occurrences on following lines and lists warnings", () => {
    expect(formatHuman(report)).toBe(
      [
        "  ✗ lg:my-10          templates/pricing.html:42:18",
        "                      templates/pricing.html:88:10",
        "  ✗ bg-brand-500      templates/base.html:12:6",
        "  ⚠ text-{{ color }}  templates/card.html:7:22   (dynamic class construction suspected)",
        "",
        "  2 parse warning(s):",
        "    dist/a.css:3:1 Unclosed block",
        "    <input> bad selector",
        "",
        "  2 missing, 1 dynamic-suspect  ·  scanned 128 document(s) / 3 stylesheet(s)  ·  4 suppressed by baseline",
        "",
      ].join("\n"),
    );
  });

  it("wraps marks and names in ANSI codes when colour is on", () => {
    const out = formatHuman(report, { color: true });
    expect(out).toContain("\u001b[31m✗\u001b[0m");
    expect(out).toContain("\u001b[33m⚠\u001b[0m");
    expect(out).toContain("\u001b[1mlg:my-10");
  });

  it("prints a success line for empty reports", () => {
    const empty: Report = {
      findings: [],
      warnings: [],
      stats: { documents: 2, stylesheets: 1, cssClasses: 10, htmlClasses: 5 },
    };
    expect(formatHuman(empty)).toBe(
      "\n  ✓ no missing classes  ·  scanned 2 document(s) / 1 stylesheet(s)\n",
    );
    expect(formatHuman(empty, { color: true })).toContain("\u001b[32m✓");
  });

  it("colours the summary yellow when only dynamic suspects remain", () => {
    const dyn: Report = {
      findings: [{ className: "{{ x }}", kind: "dynamic-suspect", occurrences: [] }],
      warnings: [],
      stats: { documents: 1, stylesheets: 1, cssClasses: 1, htmlClasses: 1 },
    };
    const out = formatHuman(dyn, { color: true });
    expect(out).toContain("\u001b[33m0 missing, 1 dynamic-suspect");
  });
});

describe("formatJson", () => {
  it("produces a stable versioned document", () => {
    const json = toJsonReport(report);
    expect(json.version).toBe(1);
    expect(json.summary).toEqual({
      missing: 2,
      dynamicSuspect: 1,
      warnings: 2,
      documents: 128,
      stylesheets: 3,
      suppressedByBaseline: 4,
    });
    expect(JSON.parse(formatJson(report))).toEqual(json);
    expect(formatJson(report).endsWith("\n")).toBe(true);
  });
});

describe("countFindings", () => {
  it("counts by kind", () => {
    expect(countFindings(report.findings)).toEqual({ missing: 2, dynamicSuspect: 1 });
    expect(countFindings([])).toEqual({ missing: 0, dynamicSuspect: 0 });
  });
});
