export type {
  AuditInput,
  AuditResult,
  AuditStats,
  Finding,
  FindingOccurrence,
} from "./audit/derive.js";
export { audit, DEFAULT_IGNORE, matchesAny } from "./audit/derive.js";
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
