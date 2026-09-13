import { countFindings, type Report } from "./types.js";

/** Shape of the JSON report. `version` is bumped on breaking changes. */
export interface JsonReport {
  version: 1;
  tool: "cssert";
  summary: {
    missing: number;
    dynamicSuspect: number;
    warnings: number;
    documents: number;
    stylesheets: number;
    suppressedByBaseline: number;
  };
  findings: Report["findings"];
  warnings: Report["warnings"];
}

/** Build the JSON report object. */
export function toJsonReport(report: Report): JsonReport {
  const counts = countFindings(report.findings);
  return {
    version: 1,
    tool: "cssert",
    summary: {
      missing: counts.missing,
      dynamicSuspect: counts.dynamicSuspect,
      warnings: report.warnings.length,
      documents: report.stats.documents,
      stylesheets: report.stats.stylesheets,
      suppressedByBaseline: report.baseline?.suppressed ?? 0,
    },
    findings: report.findings,
    warnings: report.warnings,
  };
}

/** Render the report as pretty-printed JSON. */
export function formatJson(report: Report): string {
  return `${JSON.stringify(toJsonReport(report), null, 2)}\n`;
}
