export type { Baseline, BaselineEntry } from "./audit/baseline.js";
export {
  applyBaseline,
  createBaseline,
  parseBaseline,
  pruneBaseline,
  serializeBaseline,
} from "./audit/baseline.js";
export type {
  BudgetComparison,
  BudgetDelta,
  BudgetMetrics,
  BudgetSnapshot,
  MaxDrop,
} from "./audit/budget.js";
export {
  compareBudget,
  measureStylesheets,
  parseBudgetSnapshot,
  parseMaxDrop,
  serializeBudgetSnapshot,
} from "./audit/budget.js";
export type {
  AuditInput,
  AuditResult,
  AuditStats,
  Finding,
  FindingOccurrence,
} from "./audit/derive.js";
export { audit, DEFAULT_IGNORE, matchesAny } from "./audit/derive.js";
export type { CssertConfig } from "./config.js";
export { defineConfig, toPattern } from "./config.js";
export {
  classNameFromSelector,
  normalizeClassName,
  normalizeCondition,
  splitClassList,
  unescapeCssIdentifier,
} from "./core/normalize.js";
export type { CustomPropertyDeclaration, ParsedStylesheet, ParseOptions } from "./core/parse.js";
export { parseStylesheet } from "./core/parse.js";
export { loadStylesheet, pickWinner } from "./core/query.js";
export type { Declaration, Match, MatchOptions, StylesheetModel, Warning } from "./core/types.js";
export type { Extraction, ExtractOptions, Occurrence } from "./extract/html.js";
export { extractClasses, extractClassesFromHtml, isDynamicToken } from "./extract/html.js";
export { formatHuman } from "./report/human.js";
export type { JsonReport } from "./report/json.js";
export { formatJson, toJsonReport } from "./report/json.js";
export type { Report, ReportFormat, ReportOptions } from "./report/types.js";
export { countFindings } from "./report/types.js";
