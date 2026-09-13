import type { Warning } from "../core/types.js";
import { countFindings, type Report } from "./types.js";

/**
 * Escape text for a GitHub Actions workflow command message.
 * See https://docs.github.com/actions/reference/workflow-commands-for-github-actions
 */
function escapeData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function command(
  level: "error" | "warning" | "notice",
  props: Record<string, string | number | undefined>,
  message: string,
): string {
  const parts = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${escapeProperty(String(v))}`);
  return `::${level}${parts.length > 0 ? ` ${parts.join(",")}` : ""}::${escapeData(message)}`;
}

/**
 * Render the report as GitHub Actions workflow commands so findings show up
 * as inline annotations on the pull request, followed by a plain summary line.
 */
export function formatGithub(report: Report): string {
  const lines: string[] = [];
  for (const finding of report.findings) {
    const isMissing = finding.kind === "missing";
    const level = isMissing ? "error" : "warning";
    const title = isMissing ? "cssert: missing class" : "cssert: dynamic class";
    const message = isMissing
      ? `Class "${finding.className}" is used here but is not defined in any stylesheet.`
      : `Token "${finding.className}" contains template syntax and cannot be checked; the class name is probably built dynamically.`;
    if (finding.occurrences.length === 0) {
      lines.push(command(level, { title }, message));
    }
    for (const occ of finding.occurrences) {
      lines.push(
        command(level, { file: occ.path, line: occ.line, col: occ.column, title }, message),
      );
    }
  }
  for (const warning of report.warnings) {
    lines.push(command("warning", warningProps(warning), warning.message));
  }
  const counts = countFindings(report.findings);
  lines.push(
    `cssert: ${counts.missing} missing, ${counts.dynamicSuspect} dynamic-suspect, ${report.warnings.length} warning(s)` +
      ` · scanned ${report.stats.documents} document(s) / ${report.stats.stylesheets} stylesheet(s)` +
      (report.baseline && report.baseline.suppressed > 0
        ? ` · ${report.baseline.suppressed} suppressed by baseline`
        : ""),
  );
  return `${lines.join("\n")}\n`;
}

function warningProps(w: Warning): Record<string, string | number | undefined> {
  return {
    file: w.path,
    line: w.source?.line,
    col: w.source?.column,
    title: `cssert: parse warning (${w.code})`,
  };
}
