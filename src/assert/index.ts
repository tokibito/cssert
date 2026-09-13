import { normalizeCondition } from "../core/normalize.js";
import { pickWinner } from "../core/query.js";
import type { Declaration, Match, MatchOptions, StylesheetModel } from "../core/types.js";

/**
 * Thrown by {@link expectClass} assertions. The message contains the failing
 * expectation, the selectors that were considered and, for missing classes,
 * similarly named classes that do exist.
 */
export class CssertAssertionError extends Error {
  readonly className: string;
  readonly matches: Match[];

  constructor(message: string, className: string, matches: Match[]) {
    super(message);
    this.name = "CssertAssertionError";
    this.className = className;
    this.matches = matches;
  }
}

interface Filters {
  subjectOnly: boolean;
  condition?: string | RegExp;
  pseudo?: string;
}

/**
 * Fluent assertions over a {@link StylesheetModel}.
 *
 * Intended for classes that cannot be derived from HTML: safelisted or
 * dynamically generated utilities and your own design-token classes.
 * Asserting framework utility values (`p-4` → `1rem`) is an anti-pattern; the
 * framework already tests that.
 */
export class ClassExpectation {
  private readonly sheet: StylesheetModel;
  private readonly className: string;
  private readonly filters: Filters;
  private readonly negated: boolean;

  constructor(
    sheet: StylesheetModel,
    className: string,
    filters: Filters = { subjectOnly: false },
    negated = false,
  ) {
    this.sheet = sheet;
    this.className = className;
    this.filters = filters;
    this.negated = negated;
  }

  /** Invert the following assertion. */
  get not(): ClassExpectation {
    return new ClassExpectation(this.sheet, this.className, this.filters, !this.negated);
  }

  /** Only consider matches inside this `@media`/`@supports`/`@container` condition. */
  under(condition: string | RegExp): ClassExpectation {
    return new ClassExpectation(
      this.sheet,
      this.className,
      { ...this.filters, condition },
      this.negated,
    );
  }

  /** Only consider matches with this pseudo-class or pseudo-element (e.g. `:hover`). */
  withPseudo(pseudo: string): ClassExpectation {
    return new ClassExpectation(
      this.sheet,
      this.className,
      { ...this.filters, pseudo },
      this.negated,
    );
  }

  /** Only consider matches where the class is the subject of the selector. */
  asSubject(): ClassExpectation {
    return new ClassExpectation(
      this.sheet,
      this.className,
      { ...this.filters, subjectOnly: true },
      this.negated,
    );
  }

  /** The class appears in at least one selector (respecting `under`/`withPseudo`/`asSubject`). */
  toExist(): void {
    const matches = this.matches();
    this.check(matches.length > 0, "exist", matches);
  }

  /** At least one considered match declares `prop`. */
  toDeclare(prop: string): void {
    const matches = this.matches();
    const found = matches.some((m) => m.declarations.some((d) => sameProp(d.prop, prop)));
    this.check(found, `declare "${prop}"`, matches);
  }

  /**
   * The winning declaration for `prop`, after `var()` resolution, equals
   * `expected`. Whitespace is collapsed; colours are compared as text.
   */
  toResolveTo(prop: string, expected: string): void {
    const matches = this.matches();
    const decls = matches.flatMap((m) => m.declarations);
    const winner = pickWinner(decls, prop);
    const actual = winner ? normalizeValue(this.sheet.resolveValue(winner.value)) : undefined;
    const ok = actual !== undefined && actual === normalizeValue(expected);
    const detail =
      actual === undefined ? `"${prop}" is not declared` : `resolved "${prop}" to ${actual}`;
    this.check(ok, `resolve "${prop}" to ${normalizeValue(expected)}`, matches, detail);
  }

  private matches(): Match[] {
    const opts: MatchOptions = { subjectOnly: this.filters.subjectOnly };
    if (this.filters.condition !== undefined) opts.condition = this.filters.condition;
    if (this.filters.pseudo !== undefined) opts.pseudo = this.filters.pseudo;
    return this.sheet.match(this.className, opts);
  }

  private check(ok: boolean, what: string, matches: Match[], detail?: string): void {
    if (ok !== this.negated) return;
    const lines = [
      `Expected class "${this.className}" ${this.negated ? "not " : ""}to ${what}${this.scope()}.`,
    ];
    if (detail) lines.push(`  ${detail}`);
    if (matches.length === 0) {
      lines.push(`  No matching selector found.`);
      const similar = similarClasses(this.sheet, this.className);
      if (similar.length > 0) lines.push(`  Similar classes: ${similar.join(", ")}`);
    } else {
      lines.push(`  Considered ${matches.length} match(es):`);
      for (const m of matches.slice(0, 10)) lines.push(`    ${describeMatch(m)}`);
      if (matches.length > 10) lines.push(`    … ${matches.length - 10} more`);
    }
    throw new CssertAssertionError(lines.join("\n"), this.className, matches);
  }

  private scope(): string {
    const parts: string[] = [];
    if (this.filters.condition !== undefined) parts.push(`under ${String(this.filters.condition)}`);
    if (this.filters.pseudo !== undefined) parts.push(`with pseudo ${this.filters.pseudo}`);
    if (this.filters.subjectOnly) parts.push("as subject");
    return parts.length > 0 ? ` ${parts.join(" ")}` : "";
  }
}

/**
 * Start an assertion chain for a class.
 *
 * @example
 * ```ts
 * const sheet = loadStylesheet(css);
 * expectClass(sheet, "bg-brand-500").toExist();
 * expectClass(sheet, "bg-brand-500").toResolveTo("background-color", "#0f62fe");
 * expectClass(sheet, "md:flex").under("(width >= 48rem)").toDeclare("display");
 * expectClass(sheet, "hover:underline").withPseudo(":hover").toExist();
 * ```
 */
export function expectClass(sheet: StylesheetModel, className: string): ClassExpectation {
  return new ClassExpectation(sheet, className);
}

function sameProp(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function describeMatch(m: Match): string {
  const ctx: string[] = [];
  if (m.layers.length > 0) ctx.push(`@layer ${m.layers.join(".")}`);
  for (const c of m.conditions) ctx.push(c.startsWith("@") ? c : `@media ${normalizeCondition(c)}`);
  const decls = m.declarations.map(describeDeclaration).join("; ");
  const where = ctx.length > 0 ? `  [${ctx.join(" › ")}]` : "";
  return `${m.selector}${where}  { ${decls} }`;
}

function describeDeclaration(d: Declaration): string {
  return `${d.prop}: ${d.value}${d.important ? " !important" : ""}`;
}

/** Up to five existing classes that share a long prefix with `name`. */
export function similarClasses(sheet: StylesheetModel, name: string, limit = 5): string[] {
  const scored: { cls: string; score: number }[] = [];
  for (const cls of sheet.classes()) {
    const score = commonPrefix(cls, name);
    if (score >= 3 && score >= Math.ceil(name.length / 2)) scored.push({ cls, score });
  }
  scored.sort((a, b) => b.score - a.score || a.cls.localeCompare(b.cls));
  return scored.slice(0, limit).map((s) => s.cls);
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
  return i;
}
