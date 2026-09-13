import type { Warning } from "../core/types.js";
import { countFindings, type Report, type ReportOptions } from "./types.js";

const ANSI = {
  reset: "\u001b[0m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
};

type Paint = (text: string, ...codes: string[]) => string;

function painter(color: boolean): Paint {
  return (text, ...codes) => (color ? `${codes.join("")}${text}${ANSI.reset}` : text);
}

const MAX_NAME_WIDTH = 40;

/**
 * Render a report for humans:
 *
 * ```
 *   ✗ lg:my-10          templates/pricing.html:42:18
 *                       templates/pricing.html:88:10
 *   ⚠ text-{{ color }}  templates/card.html:7:22   (dynamic class construction suspected)
 *
 *   2 missing, 1 dynamic-suspect  ·  scanned 128 documents / 3 stylesheets
 * ```
 */
export function formatHuman(report: Report, opts: ReportOptions = {}): string {
  const paint = painter(opts.color ?? false);
  const lines: string[] = [];
  const width = Math.min(
    MAX_NAME_WIDTH,
    report.findings.reduce((w, f) => Math.max(w, f.className.length), 0),
  );

  for (const finding of report.findings) {
    const isMissing = finding.kind === "missing";
    const mark = isMissing ? paint("✗", ANSI.red) : paint("⚠", ANSI.yellow);
    const name = finding.className.padEnd(width);
    const note = isMissing ? "" : paint("   (dynamic class construction suspected)", ANSI.dim);
    const [first, ...rest] = finding.occurrences;
    const firstLoc = first ? location(first) : "";
    lines.push(`  ${mark} ${paint(name, ANSI.bold)}  ${paint(firstLoc, ANSI.dim)}${note}`);
    for (const occ of rest) {
      lines.push(`  ${" ".repeat(1 + 1 + width + 1)} ${paint(location(occ), ANSI.dim)}`);
    }
  }

  if (report.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`  ${paint(`${report.warnings.length} parse warning(s):`, ANSI.yellow)}`);
    for (const w of report.warnings) {
      lines.push(`    ${paint(warningLocation(w), ANSI.dim)} ${w.message}`);
    }
  }

  lines.push("");
  const counts = countFindings(report.findings);
  const scanned = `scanned ${report.stats.documents} document(s) / ${report.stats.stylesheets} stylesheet(s)`;
  const baseline =
    report.baseline && report.baseline.suppressed > 0
      ? `  ·  ${report.baseline.suppressed} suppressed by baseline`
      : "";
  if (report.findings.length === 0) {
    lines.push(`  ${paint("✓", ANSI.green)} no missing classes  ·  ${scanned}${baseline}`);
  } else {
    const summary = `${counts.missing} missing, ${counts.dynamicSuspect} dynamic-suspect`;
    lines.push(
      `  ${paint(summary, counts.missing > 0 ? ANSI.red : ANSI.yellow)}  ·  ${scanned}${baseline}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function location(occ: { path: string; line: number; column: number }): string {
  return `${occ.path}:${occ.line}:${occ.column}`;
}

function warningLocation(w: Warning): string {
  const path = w.path ?? "<input>";
  return w.source ? `${path}:${w.source.line}:${w.source.column}` : path;
}
