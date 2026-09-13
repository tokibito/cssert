import { normalizeClassName, normalizeCondition } from "./normalize.js";
import { type ParsedStylesheet, type ParseOptions, parseStylesheet } from "./parse.js";
import type { Declaration, Match, MatchOptions, StylesheetModel, Warning } from "./types.js";
import { createVarResolver } from "./vars.js";

class Model implements StylesheetModel {
  readonly warnings: Warning[];
  private readonly parsed: ParsedStylesheet;
  private readonly resolver;
  private subjectClasses: Set<string> | undefined;

  constructor(parsed: ParsedStylesheet) {
    this.parsed = parsed;
    this.warnings = parsed.warnings;
    this.resolver = createVarResolver(parsed.customProperties, parsed.propertyInitialValues);
  }

  classes(): ReadonlySet<string> {
    return this.parsed.classes;
  }

  hasClass(name: string): boolean {
    if (!this.subjectClasses) {
      this.subjectClasses = new Set();
      for (const [cls, matches] of this.parsed.byClass) {
        if (matches.some((m) => m.subject)) this.subjectClasses.add(cls);
      }
    }
    return this.subjectClasses.has(normalizeClassName(name));
  }

  match(name: string, opts: MatchOptions = {}): Match[] {
    const subjectOnly = opts.subjectOnly ?? true;
    const list = this.parsed.byClass.get(normalizeClassName(name)) ?? [];
    return list.filter((m) => {
      if (subjectOnly && !m.subject) return false;
      if (opts.condition !== undefined && !hasCondition(m, opts.condition)) return false;
      if (opts.pseudo !== undefined && !m.pseudo.includes(opts.pseudo)) return false;
      return true;
    });
  }

  declarationsFor(name: string, opts?: MatchOptions): Declaration[] {
    return this.match(name, opts).flatMap((m) => m.declarations);
  }

  resolveVar(name: string, scope?: string): string | undefined {
    return this.resolver.resolveVar(name, scope);
  }

  resolveValue(value: string, scope?: string): string {
    return this.resolver.resolveValue(value, scope);
  }
}

function hasCondition(match: Match, condition: string | RegExp): boolean {
  if (condition instanceof RegExp) {
    return match.conditions.some((c) => condition.test(c));
  }
  const wanted = normalizeCondition(condition);
  return match.conditions.some((c) => normalizeCondition(c) === wanted);
}

/**
 * Parse built CSS into a queryable {@link StylesheetModel}.
 * Pure and side-effect free; never throws for malformed input.
 *
 * @example
 * ```ts
 * const sheet = loadStylesheet(css);
 * sheet.hasClass("md:flex"); // true when `.md\:flex` is a subject somewhere
 * ```
 */
export function loadStylesheet(css: string, opts?: ParseOptions): StylesheetModel {
  return new Model(parseStylesheet(css, opts));
}

/**
 * Pick the declaration that would win for `prop` among declarations that are
 * known to share the same conditions and specificity: the last `!important`
 * one, else the last one. Returns `undefined` when `prop` is not declared.
 *
 * This deliberately does **not** reason about media queries, layers or
 * specificity; pass declarations from a single {@link Match} (or from matches
 * you have already established to be comparable).
 */
export function pickWinner(decls: readonly Declaration[], prop: string): Declaration | undefined {
  const target = prop.toLowerCase();
  let winner: Declaration | undefined;
  for (const d of decls) {
    if (d.prop.toLowerCase() !== target) continue;
    if (winner === undefined || d.important || !winner.important) winner = d;
  }
  return winner;
}
