import type { AuditStats, Finding } from "../audit/derive.js";
import type { Warning } from "../core/types.js";

/** Everything a reporter needs to render the result of `cssert check`. */
export interface Report {
  findings: Finding[];
  warnings: Warning[];
  stats: AuditStats;
  /** Present when a baseline file was applied. */
  baseline?: { path: string; suppressed: number };
  /**
   * Run-level failures that are not tied to a class, such as "fewer documents
   * were scanned than `--min-documents` requires". Reported by every format
   * and counted towards the exit code.
   */
  errors?: string[];
}

export type ReportFormat = "human" | "json" | "github" | "sarif";

export interface ReportOptions {
  /** Emit ANSI colours (human format only). */
  color?: boolean;
  /** Tool version to embed (SARIF). */
  version?: string;
  /**
   * Emit one annotation per occurrence instead of one per class (github).
   * Default false: GitHub caps how many annotations it displays per run, and
   * one noisy class would otherwise hide every other finding.
   */
  annotateOccurrences?: boolean;
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
