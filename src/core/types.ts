/**
 * A single CSS declaration as it appears in the source.
 */
export interface Declaration {
  /** Property name, e.g. `background-color` or `--tw-border-style`. */
  prop: string;
  /** Raw value. `var()` references are **not** resolved; see {@link StylesheetModel.resolveValue}. */
  value: string;
  /** Whether the declaration carries `!important`. */
  important: boolean;
}

/**
 * One occurrence of a class inside a selector, together with the declarations
 * that apply when that selector matches.
 */
export interface Match {
  /**
   * The selector as written in the stylesheet, with nesting (`&`) expanded and
   * escapes left intact. `.hover\:underline { &:hover { ... } }` yields
   * `.hover\:underline:hover`.
   */
  selector: string;
  /**
   * Whether the class is the subject of the selector (part of the rightmost
   * compound selector). In `.group:hover .foo`, `group` is not the subject.
   */
  subject: boolean;
  /** `@layer` names, outermost first. `@layer a.b {}` yields `["a", "b"]`. */
  layers: string[];
  /**
   * Conditional at-rule contexts, outermost first. `@media` queries are stored
   * as their bare query (`(width >= 48rem)`); other at-rules keep their name
   * (`@supports (display: grid)`, `@container (min-width: 20rem)`).
   */
  conditions: string[];
  /** Pseudo-classes and pseudo-elements attached to the compound containing the class. */
  pseudo: string[];
  /** Declarations directly inside the matched block, in source order. */
  declarations: Declaration[];
  /** Source order index, starting at 0 and strictly increasing within a stylesheet. */
  order: number;
  /** Position of the block in the original CSS, for reporting. */
  source?: { line: number; column: number };
}

/** A non-fatal problem encountered while parsing. */
export interface Warning {
  /** Machine-readable category, e.g. `css-syntax` or `selector-parse`. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** File path, when the caller provided one. */
  path?: string;
  /** Position in the CSS, when known. */
  source?: { line: number; column: number };
}

export interface MatchOptions {
  /** When true (default), only matches where the class is the subject are returned. */
  subjectOnly?: boolean;
  /**
   * When set, only matches whose `conditions` include this condition.
   * Strings are compared after media-query normalisation so that
   * `(min-width: 48rem)` and `(width >= 48rem)` are equivalent.
   */
  condition?: string | RegExp;
  /** When set, only matches whose `pseudo` list includes this entry, e.g. `:hover`. */
  pseudo?: string;
}

/**
 * Read-only, query-oriented view of a parsed stylesheet.
 *
 * All methods are pure and never throw. Anything that could not be parsed is
 * reported through {@link StylesheetModel.warnings}.
 */
export interface StylesheetModel {
  /** Every class name that appears anywhere in a selector, in any role, normalised. */
  classes(): ReadonlySet<string>;
  /** Whether the class appears at least once as the subject of a selector. */
  hasClass(name: string): boolean;
  /** All matches for the class, in source order. */
  match(name: string, opts?: MatchOptions): Match[];
  /** Declarations of all matches for the class, flattened, in source order. */
  declarationsFor(name: string, opts?: MatchOptions): Declaration[];
  /**
   * Resolve a custom property to its value, following `var()` references.
   * Returns `undefined` when the property is not defined unconditionally or
   * when resolution hits a cycle. `scope` is a selector (or bare class name)
   * consulted before the root scope.
   */
  resolveVar(name: string, scope?: string): string | undefined;
  /**
   * Expand `var()` references inside a value recursively. Unresolvable
   * references are left as written.
   */
  resolveValue(value: string, scope?: string): string;
  /** Problems encountered while parsing. */
  readonly warnings: Warning[];
}
