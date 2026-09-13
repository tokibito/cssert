import { describe, expect, it } from "vitest";
import { formatGithub } from "../../src/report/github.js";
import { formatSarif, SARIF_RULES, toSarif } from "../../src/report/sarif.js";
import type { Report } from "../../src/report/types.js";

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
      className: "text-{{ color,x }}",
      kind: "dynamic-suspect",
      occurrences: [{ path: "templates/card.html", line: 7, column: 22 }],
    },
    { className: "orphan", kind: "missing", occurrences: [] },
  ],
  warnings: [
    {
      code: "css-syntax",
      message: "Unclosed block\nsecond line 100%",
      path: "dist/a.css",
      source: { line: 3, column: 1 },
    },
    { code: "selector-parse", message: "bad selector" },
  ],
  stats: {
    documents: 128,
    stylesheets: 3,
    cssClasses: 400,
    htmlClasses: 120,
    documentsWithDynamic: 0,
  },
  baseline: { path: ".cssert/baseline.json", suppressed: 4 },
};

describe("formatGithub", () => {
  it("emits one annotation per class, anchored at the first occurrence", () => {
    const out = formatGithub(report).split("\n");
    expect(out[0]).toBe(
      '::error file=templates/pricing.html,line=42,col=18,title=cssert%3A missing class::Class "lg:my-10" is used here but is not defined in any stylesheet (and 1 other place).',
    );
    expect(out[1]).toBe(
      '::warning file=templates/card.html,line=7,col=22,title=cssert%3A dynamic class::Token "text-{{ color,x }}" contains template syntax and cannot be checked; the class name is probably built dynamically.',
    );
    expect(out[2]).toBe(
      '::error title=cssert%3A missing class::Class "orphan" is used here but is not defined in any stylesheet.',
    );
    expect(out[3]).toBe(
      "::warning file=dist/a.css,line=3,col=1,title=cssert%3A parse warning (css-syntax)::Unclosed block%0Asecond line 100%25",
    );
    expect(out[4]).toBe("::warning title=cssert%3A parse warning (selector-parse)::bad selector");
    expect(out[5]).toBe(
      "cssert: 2 missing, 1 dynamic-suspect, 2 warning(s) · scanned 128 document(s) / 3 stylesheet(s) · 4 suppressed by baseline",
    );
    expect(out[6]).toBe("");
  });

  it("emits one annotation per class regardless of how many occurrences it has", () => {
    const many = formatGithub({
      ...report,
      findings: [
        {
          className: "form-control",
          kind: "missing",
          occurrences: Array.from({ length: 66 }, (_, i) => ({
            path: `templates/p${i}.html`,
            line: i + 1,
            column: 1,
          })),
        },
      ],
      warnings: [],
    }).split("\n");
    expect(many).toHaveLength(3); // one annotation, one summary, trailing ""
    expect(many[0]).toContain("file=templates/p0.html,line=1,col=1");
    expect(many[0]).toContain("(and 65 other places).");
  });

  it("annotates every occurrence with annotateOccurrences", () => {
    const out = formatGithub(report, { annotateOccurrences: true }).split("\n");
    expect(out[0]).toBe(
      '::error file=templates/pricing.html,line=42,col=18,title=cssert%3A missing class::Class "lg:my-10" is used here but is not defined in any stylesheet.',
    );
    expect(out[1]).toContain("line=88,col=10");
    expect(out[1]).not.toContain("other place");
  });

  it("reports run-level errors and unresolved expressions", () => {
    const out = formatGithub({
      findings: [],
      warnings: [],
      stats: {
        documents: 3,
        stylesheets: 1,
        cssClasses: 1,
        htmlClasses: 1,
        documentsWithDynamic: 2,
      },
      errors: ["Only 3 HTML document(s) were scanned; --min-documents requires at least 20."],
    }).split("\n");
    expect(out[0]).toBe(
      "::error title=cssert%3A input coverage::Only 3 HTML document(s) were scanned; --min-documents requires at least 20.",
    );
    expect(out[1]).toContain("2 document(s) still contain unresolved class expressions");
  });

  it("prints only the summary for a clean report", () => {
    const clean = formatGithub({
      findings: [],
      warnings: [],
      stats: {
        documents: 1,
        stylesheets: 1,
        cssClasses: 1,
        htmlClasses: 1,
        documentsWithDynamic: 0,
      },
    });
    expect(clean).toBe(
      "cssert: 0 missing, 0 dynamic-suspect, 0 warning(s) · scanned 1 document(s) / 1 stylesheet(s)\n",
    );
  });
});

describe("formatSarif", () => {
  it("produces a SARIF 2.1.0 log with one result per occurrence", () => {
    const log = toSarif(report, { version: "1.2.3" });
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    const driver = log.runs[0]?.tool.driver;
    expect(driver?.name).toBe("cssert");
    expect(driver?.version).toBe("1.2.3");
    expect(driver?.rules.map((r) => r.id)).toEqual([
      SARIF_RULES.missing,
      SARIF_RULES.dynamic,
      SARIF_RULES.coverage,
      SARIF_RULES.parse,
    ]);
    const results = log.runs[0]?.results ?? [];
    expect(results).toHaveLength(6);
    expect(results[0]).toEqual({
      ruleId: "cssert/missing-class",
      level: "error",
      message: { text: 'Class "lg:my-10" is used but not defined in any stylesheet.' },
      partialFingerprints: { "cssert/className": "lg:my-10" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "templates/pricing.html", uriBaseId: "%SRCROOT%" },
            region: { startLine: 42, startColumn: 18 },
          },
        },
      ],
    });
    expect(results[2]?.ruleId).toBe("cssert/dynamic-class");
    expect(results[2]?.level).toBe("warning");
    expect(results[3]?.locations).toBeUndefined();
    expect(results[4]).toMatchObject({
      ruleId: "cssert/parse-warning",
      message: { text: "Unclosed block\nsecond line 100% (css-syntax)" },
      locations: [{ physicalLocation: { region: { startLine: 3, startColumn: 1 } } }],
    });
    expect(results[5]?.locations).toBeUndefined();
  });

  it("omits the version and regions when unknown", () => {
    const log = toSarif({
      findings: [
        { className: "x", kind: "missing", occurrences: [{ path: "a.html", line: 0, column: 0 }] },
      ],
      warnings: [{ code: "w", message: "m", path: "b.css" }],
      stats: {
        documents: 1,
        stylesheets: 1,
        cssClasses: 1,
        htmlClasses: 1,
        documentsWithDynamic: 0,
      },
    });
    expect(log.runs[0]?.tool.driver.version).toBeUndefined();
    expect(log.runs[0]?.results[0]?.locations?.[0]?.physicalLocation.region).toBeUndefined();
    expect(log.runs[0]?.results[1]?.locations?.[0]?.physicalLocation.region).toBeUndefined();
  });

  it("serialises to JSON with a trailing newline", () => {
    const text = formatSarif(report);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text).runs[0].results).toHaveLength(6);
  });
});
