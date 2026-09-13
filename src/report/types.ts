import type { AuditStats, Finding } from "../audit/derive.js";
import type { Warning } from "../core/types.js";

/** Everything a reporter needs to render the result of `cssert check`. */
export interface Report {
  findings: Finding[];
  warnings: Warning[];
  stats: AuditStats;
  /** Present when a baseline file was applied. */
  baseline?: { path: string; suppressed: number };
}

export type ReportFormat = "human" | "json" | "github" | "sarif";

export interface ReportOptions {
  /** Emit ANSI colours (human format only). */
  color?: boolean;
}

/** Count findings by kind. */
export function countFindings(findings: readonly Finding[]): {
  missing: number;
  dynamicSuspect: number;
} {
  let missing = 0;
  let dynamicSuspect = 0;
  for (const f of findings) {
    if (f.kind === "missing") missing++;
    else dynamicSuspect++;
  }
  return { missing, dynamicSuspect };
}
