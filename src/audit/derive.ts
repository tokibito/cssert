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
  /**
   * Documents to check. `source` labels where the document came from (the
   * input glob that matched it, say `templates/**\/*.html`); findings carry
   * the distinct labels of the documents they occur in, which separates
   * "only appears in unrendered templates" from "appears in rendered output".
   */
  documents: { path: string; html: string; source?: string }[];
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
  /**
   * Distinct `source` labels of the documents this finding occurs in, sorted.
   * Present only when the caller labelled its documents.
   */
  sources?: string[];
}

export interface AuditStats {
  documents: number;
  stylesheets: number;
  /** Distinct classes defined across all stylesheets (any selector role). */
  cssClasses: number;
  /** Distinct literal classes used across all documents (after ignore). */
  htmlClasses: number;
  /**
   * Documents that still contain at least one unresolved class expression.
   * A green run over these files proves less than over fully rendered ones.
   */
  documentsWithDynamic: number;
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

  const missing = new Map<string, Accumulator>();
  const dynamic = new Map<string, Accumulator>();
  const used = new Set<string>();
  let documentsWithDynamic = 0;

  for (const doc of input.documents) {
    const extraction = extractClasses(doc.html, {
      ignore,
      ...(input.attributes ? { attributes: input.attributes } : {}),
    });
    for (const [cls, occurrences] of extraction.classes) {
      used.add(cls);
      if (defined.has(cls) || matchesAny(cls, allow)) continue;
      append(missing, cls, doc, occurrences);
    }
    if (extraction.dynamic.size > 0) documentsWithDynamic++;
    for (const [token, occurrences] of extraction.dynamic) {
      append(dynamic, token, doc, occurrences);
    }
  }

  const findings: Finding[] = [
    ...[...missing].map(([className, acc]) => toFinding(className, "missing", acc)),
    ...[...dynamic].map(([className, acc]) => toFinding(className, "dynamic-suspect", acc)),
  ];

  return {
    findings,
    warnings,
    stats: {
      documents: input.documents.length,
      stylesheets: input.stylesheets.length,
      cssClasses: defined.size,
      htmlClasses: used.size,
      documentsWithDynamic,
    },
  };
}

interface Accumulator {
  occurrences: FindingOccurrence[];
  sources: Set<string>;
}

function append(
  target: Map<string, Accumulator>,
  key: string,
  doc: { path: string; source?: string },
  occurrences: { line: number; column: number }[],
): void {
  const acc = target.get(key) ?? { occurrences: [], sources: new Set<string>() };
  const { path } = doc;
  for (const o of occurrences) {
    if (
      !acc.occurrences.some((e) => e.path === path && e.line === o.line && e.column === o.column)
    ) {
      acc.occurrences.push({ path, line: o.line, column: o.column });
    }
  }
  if (doc.source !== undefined) acc.sources.add(doc.source);
  target.set(key, acc);
}

function toFinding(className: string, kind: Finding["kind"], acc: Accumulator): Finding {
  const finding: Finding = { className, kind, occurrences: acc.occurrences };
  if (acc.sources.size > 0) finding.sources = [...acc.sources].sort();
  return finding;
}
