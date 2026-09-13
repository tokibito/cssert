import type { Report, ReportOptions } from "./types.js";

export const SARIF_RULES = {
  missing: "cssert/missing-class",
  dynamic: "cssert/dynamic-class",
  parse: "cssert/parse-warning",
  coverage: "cssert/input-coverage",
} as const;

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId: string };
    region?: { startLine: number; startColumn: number };
  };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: SarifLocation[];
  partialFingerprints?: Record<string, string>;
}

/** Minimal SARIF 2.1.0 log accepted by GitHub code scanning and most viewers. */
export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: {
      driver: {
        name: "cssert";
        version?: string;
        informationUri: string;
        rules: {
          id: string;
          name: string;
          shortDescription: { text: string };
          fullDescription: { text: string };
          helpUri: string;
          defaultConfiguration: { level: "error" | "warning" | "note" };
        }[];
      };
    };
    results: SarifResult[];
  }[];
}

const HOMEPAGE = "https://github.com/tokibito/cssert";

function location(path: string, line: number, column: number): SarifLocation {
  const loc: SarifLocation = {
    physicalLocation: { artifactLocation: { uri: path, uriBaseId: "%SRCROOT%" } },
  };
  if (line > 0) {
    loc.physicalLocation.region = { startLine: line, startColumn: Math.max(1, column) };
  }
  return loc;
}

/** Build the SARIF log. One result per occurrence so every usage is annotated. */
export function toSarif(report: Report, opts: ReportOptions = {}): SarifLog {
  const results: SarifResult[] = [];
  for (const finding of report.findings) {
    const isMissing = finding.kind === "missing";
    const base: Omit<SarifResult, "locations"> = {
      ruleId: isMissing ? SARIF_RULES.missing : SARIF_RULES.dynamic,
      level: isMissing ? "error" : "warning",
      message: {
        text: isMissing
          ? `Class "${finding.className}" is used but not defined in any stylesheet.`
          : `Token "${finding.className}" contains template syntax and cannot be checked.`,
      },
      partialFingerprints: { "cssert/className": finding.className },
    };
    if (finding.occurrences.length === 0) {
      results.push({ ...base });
      continue;
    }
    for (const occ of finding.occurrences) {
      results.push({ ...base, locations: [location(occ.path, occ.line, occ.column)] });
    }
  }
  for (const error of report.errors ?? []) {
    results.push({
      ruleId: SARIF_RULES.coverage,
      level: "error",
      message: { text: error },
    });
  }
  for (const w of report.warnings) {
    const result: SarifResult = {
      ruleId: SARIF_RULES.parse,
      level: "warning",
      message: { text: `${w.message} (${w.code})` },
    };
    if (w.path !== undefined) {
      result.locations = [location(w.path, w.source?.line ?? 0, w.source?.column ?? 1)];
    }
    results.push(result);
  }

  const driver: SarifLog["runs"][number]["tool"]["driver"] = {
    name: "cssert",
    informationUri: HOMEPAGE,
    rules: [
      {
        id: SARIF_RULES.missing,
        name: "MissingClass",
        shortDescription: { text: "Class used in HTML is missing from the built CSS" },
        fullDescription: {
          text: "The class appears in a document but no stylesheet defines it in any selector. Typical causes: a content/scan path missing from the CSS framework configuration, or a class name assembled dynamically.",
        },
        helpUri: `${HOMEPAGE}#readme`,
        defaultConfiguration: { level: "error" },
      },
      {
        id: SARIF_RULES.dynamic,
        name: "DynamicClass",
        shortDescription: { text: "Class token contains template syntax" },
        fullDescription: {
          text: "The token contains template-language syntax and cannot be compared with the stylesheet. Utility frameworks only emit classes they can see in source, so dynamically built names are frequently missing at runtime.",
        },
        helpUri: `${HOMEPAGE}#readme`,
        defaultConfiguration: { level: "warning" },
      },
      {
        id: SARIF_RULES.coverage,
        name: "InputCoverage",
        shortDescription: { text: "Fewer inputs were checked than required" },
        fullDescription: {
          text: "The run scanned fewer documents or stylesheets than --min-documents/--min-stylesheets requires. A check over an empty or truncated input set passes without proving anything.",
        },
        helpUri: `${HOMEPAGE}#readme`,
        defaultConfiguration: { level: "error" },
      },
      {
        id: SARIF_RULES.parse,
        name: "ParseWarning",
        shortDescription: { text: "Stylesheet could not be fully parsed" },
        fullDescription: {
          text: "Part of a stylesheet was skipped because it could not be parsed. Classes inside the skipped part may be reported as missing.",
        },
        helpUri: `${HOMEPAGE}#readme`,
        defaultConfiguration: { level: "warning" },
      },
    ],
  };
  if (opts.version !== undefined) driver.version = opts.version;

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver }, results }],
  };
}

export function formatSarif(report: Report, opts?: ReportOptions): string {
  return `${JSON.stringify(toSarif(report, opts), null, 2)}\n`;
}
