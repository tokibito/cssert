import { loadStylesheet } from "../core/query.js";
import type { Warning } from "../core/types.js";
import { extractClasses } from "../extract/html.js";

/**
 * Classes ignored by default: state hooks that are toggled by scripts and
 * class families owned by third-party libraries. Deliberately short; large
 * initial reports are meant to be absorbed with a baseline.
 */
export const DEFAULT_IGNORE: readonly RegExp[] = [
  /^js-/,
  /^is-/,
  /^has-/,
  /^active$/,
  /^disabled$/,
  /^wp-/,
  /^woocommerce-/,
  /^swiper-/,
  /^leaflet-/,
];

export interface AuditInput {
  stylesheets: { path: string; css: string }[];
  documents: { path: string; html: string }[];
  /** Additional classes/patterns to skip. Appended to {@link DEFAULT_IGNORE}. */
  ignore?: (string | RegExp)[];
  /** Classes/patterns that are not reported even when absent from the CSS. */
  allow?: (string | RegExp)[];
  /** HTML attributes to scan. Default `["class"]`. */
  attributes?: string[];
  /** Set to false to drop {@link DEFAULT_IGNORE}. Default true. */
  useDefaultIgnore?: boolean;
}

export interface FindingOccurrence {
  path: string;
  line: number;
  column: number;
}

export interface Finding {
  className: string;
  /**
   * `missing`: used in HTML, defined in no stylesheet.
   * `dynamic-suspect`: token contains template syntax and cannot be checked.
   */
  kind: "missing" | "dynamic-suspect";
  occurrences: FindingOccurrence[];
}

export interface AuditStats {
  documents: number;
  stylesheets: number;
  /** Distinct classes defined across all stylesheets (any selector role). */
  cssClasses: number;
  /** Distinct literal classes used across all documents (after ignore). */
  htmlClasses: number;
}

export interface AuditResult {
  findings: Finding[];
  warnings: Warning[];
  stats: AuditStats;
}

/** Whether `value` equals one of the strings or matches one of the patterns. */
export function matchesAny(value: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((p) => (typeof p === "string" ? p === value : p.test(value)));
}

/**
 * Derive findings from built CSS and HTML: every literal class used in a
 * document that is defined in none of the stylesheets is `missing`; tokens
 * with template syntax are reported as `dynamic-suspect`.
 *
 * A class counts as defined when it appears in any selector role (subject or
 * not), so marker classes such as `group` or `peer` are not false positives.
 *
 * Pure: no I/O, never throws.
 */
export function audit(input: AuditInput): AuditResult {
  const ignore = [
    ...(input.useDefaultIgnore === false ? [] : DEFAULT_IGNORE),
    ...(input.ignore ?? []),
  ];
  const allow = input.allow ?? [];
  const warnings: Warning[] = [];

  const defined = new Set<string>();
  for (const sheet of input.stylesheets) {
    const model = loadStylesheet(sheet.css, { path: sheet.path });
    for (const cls of model.classes()) defined.add(cls);
    warnings.push(...model.warnings);
  }

  const missing = new Map<string, FindingOccurrence[]>();
  const dynamic = new Map<string, FindingOccurrence[]>();
  const used = new Set<string>();

  for (const doc of input.documents) {
    const extraction = extractClasses(doc.html, {
      ignore,
      ...(input.attributes ? { attributes: input.attributes } : {}),
    });
    for (const [cls, occurrences] of extraction.classes) {
      used.add(cls);
      if (defined.has(cls) || matchesAny(cls, allow)) continue;
      append(missing, cls, doc.path, occurrences);
    }
    for (const [token, occurrences] of extraction.dynamic) {
      append(dynamic, token, doc.path, occurrences);
    }
  }

  const findings: Finding[] = [
    ...[...missing].map(([className, occurrences]) => ({
      className,
      kind: "missing" as const,
      occurrences,
    })),
    ...[...dynamic].map(([className, occurrences]) => ({
      className,
      kind: "dynamic-suspect" as const,
      occurrences,
    })),
  ];

  return {
    findings,
    warnings,
    stats: {
      documents: input.documents.length,
      stylesheets: input.stylesheets.length,
      cssClasses: defined.size,
      htmlClasses: used.size,
    },
  };
}

function append(
  target: Map<string, FindingOccurrence[]>,
  key: string,
  path: string,
  occurrences: { line: number; column: number }[],
): void {
  const list = target.get(key) ?? [];
  for (const o of occurrences) {
    if (!list.some((e) => e.path === path && e.line === o.line && e.column === o.column)) {
      list.push({ path, line: o.line, column: o.column });
    }
  }
  target.set(key, list);
}
