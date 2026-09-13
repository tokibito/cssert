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
    /** Documents that still contain unresolved class expressions. */
    documentsWithDynamic: number;
    suppressedByBaseline: number;
  };
  findings: Report["findings"];
  warnings: Report["warnings"];
  /** Run-level failures not tied to a class (input coverage). */
  errors: string[];
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
      documentsWithDynamic: report.stats.documentsWithDynamic,
      suppressedByBaseline: report.baseline?.suppressed ?? 0,
    },
    findings: report.findings,
    warnings: report.warnings,
    errors: report.errors ?? [],
  };
}

/** Render the report as pretty-printed JSON. */
export function formatJson(report: Report): string {
  return `${JSON.stringify(toJsonReport(report), null, 2)}\n`;
}
