import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  type Declaration as PostcssDeclaration,
  type Root,
  type Rule,
} from "postcss";
import safeParser from "postcss-safe-parser";
import selectorParser, { type Selector, type Node as SelectorNode } from "postcss-selector-parser";
import { classNameFromSelector } from "./normalize.js";
import type { Declaration, Match, Warning } from "./types.js";

/** A custom property declaration together with the context it was found in. */
export interface CustomPropertyDeclaration {
  name: string;
  value: string;
  important: boolean;
  /** Resolved selectors of the enclosing rule (one entry per comma-separated selector). */
  selectors: string[];
  conditions: string[];
  layers: string[];
  order: number;
}

/** Raw parse result. Consumers should go through {@link StylesheetModel}. */
export interface ParsedStylesheet {
  matches: Match[];
  /** Matches grouped by normalised class name, in source order. */
  byClass: Map<string, Match[]>;
  /** Every class name appearing in any selector role. */
  classes: Set<string>;
  customProperties: CustomPropertyDeclaration[];
  /** `initial-value` of `@property` rules, by property name. */
  propertyInitialValues: Map<string, string>;
  warnings: Warning[];
}

export interface ParseOptions {
  /** Path used in warnings. */
  path?: string;
}

/** At-rules whose contents never contain class selectors. */
const SKIPPED_AT_RULES = new Set([
  "font-face",
  "keyframes",
  "-webkit-keyframes",
  "-moz-keyframes",
  "page",
  "counter-style",
  "font-feature-values",
  "font-palette-values",
  "view-transition",
  "namespace",
  "import",
  "charset",
]);

/** Pseudo-classes whose arguments are matched against the same element as the outer compound. */
const FORWARDING_PSEUDOS = new Set([":is", ":where", ":matches", ":-webkit-any", ":-moz-any"]);

interface Context {
  layers: string[];
  conditions: string[];
  /** Fully resolved selectors of the enclosing rule, or null at the top level. */
  selectors: string[] | null;
  /** Position of the enclosing rule (for `source`). */
  source: { line: number; column: number } | undefined;
}

interface ClassOccurrence {
  name: string;
  subject: boolean;
  pseudo: string[];
}

class ParserState {
  readonly matches: Match[] = [];
  readonly byClass = new Map<string, Match[]>();
  readonly classes = new Set<string>();
  readonly customProperties: CustomPropertyDeclaration[] = [];
  readonly propertyInitialValues = new Map<string, string>();
  readonly warnings: Warning[] = [];
  private order = 0;

  constructor(private readonly path: string | undefined) {}

  warn(
    code: string,
    message: string,
    node?: { source?: { start?: { line: number; column: number } } },
  ) {
    const warning: Warning = { code, message };
    if (this.path !== undefined) warning.path = this.path;
    const start = node?.source?.start;
    if (start) warning.source = { line: start.line, column: start.column };
    this.warnings.push(warning);
  }

  nextOrder(): number {
    return this.order++;
  }
}

/**
 * Parse CSS text into the raw structures the query layer is built on.
 * Never throws: syntax errors are recorded as warnings and parsing continues
 * with a fault-tolerant parser.
 */
export function parseStylesheet(css: string, opts: ParseOptions = {}): ParsedStylesheet {
  const state = new ParserState(opts.path);
  const root = parseRoot(css, state);
  if (root) {
    walkContainer(root, { layers: [], conditions: [], selectors: null, source: undefined }, state);
  }
  return {
    matches: state.matches,
    byClass: state.byClass,
    classes: state.classes,
    customProperties: state.customProperties,
    propertyInitialValues: state.propertyInitialValues,
    warnings: state.warnings,
  };
}

function parseRoot(css: string, state: ParserState): Root | undefined {
  try {
    return postcss.parse(css);
  } catch (error) {
    const err = error as { reason?: string; message: string; line?: number; column?: number };
    const position =
      err.line !== undefined && err.column !== undefined
        ? { source: { start: { line: err.line, column: err.column } } }
        : undefined;
    state.warn(
      "css-syntax",
      `${err.reason ?? err.message} (continuing with a fault-tolerant parser; some rules may be dropped)`,
      position,
    );
  }
  try {
    return safeParser(css) as Root;
  } catch (error) {
    state.warn("css-syntax", `Unable to parse stylesheet: ${(error as Error).message}`);
    return undefined;
  }
}

function walkContainer(container: Container, ctx: Context, state: ParserState): void {
  const nodes: ChildNode[] = container.nodes ?? [];
  const declarations = nodes.filter((n): n is PostcssDeclaration => n.type === "decl");
  const hasBlockChildren = nodes.some((n) => n.type === "rule" || n.type === "atrule");

  if (ctx.selectors !== null && (declarations.length > 0 || !hasBlockChildren)) {
    emitMatches(ctx, declarations, state);
  }

  for (const node of nodes) {
    if (node.type === "rule") {
      const resolved = resolveSelectors(node, ctx.selectors, state);
      if (resolved === undefined) continue;
      const start = node.source?.start;
      walkContainer(
        node,
        {
          ...ctx,
          selectors: resolved,
          source: start ? { line: start.line, column: start.column } : undefined,
        },
        state,
      );
    } else if (node.type === "atrule") {
      walkAtRule(node, ctx, state);
    }
  }
}

function walkAtRule(node: AtRule, ctx: Context, state: ParserState): void {
  const name = node.name.toLowerCase();
  const params = node.params.replace(/\s+/g, " ").trim();

  if (name === "property") {
    const initial = node.nodes?.find(
      (n): n is PostcssDeclaration => n.type === "decl" && n.prop.toLowerCase() === "initial-value",
    );
    if (initial && params.startsWith("--")) {
      state.propertyInitialValues.set(params, initial.value.trim());
    }
    return;
  }

  if (!node.nodes) return; // statement at-rules: @layer a, b; @import; @charset; ...
  if (SKIPPED_AT_RULES.has(name)) return;

  if (name === "layer") {
    const names = params === "" ? ["<anonymous>"] : params.split(".").map((s) => s.trim());
    walkContainer(node, { ...ctx, layers: [...ctx.layers, ...names] }, state);
    return;
  }

  const condition = name === "media" ? params : params === "" ? `@${name}` : `@${name} ${params}`;
  walkContainer(node, { ...ctx, conditions: [...ctx.conditions, condition] }, state);
}

/**
 * Resolve the selectors of a rule against its parent (CSS nesting).
 * Returns undefined when the selector cannot be parsed (a warning is recorded).
 */
function resolveSelectors(
  rule: Rule,
  parents: string[] | null,
  state: ParserState,
): string[] | undefined {
  let root: ReturnType<ReturnType<typeof selectorParser>["astSync"]>;
  try {
    root = selectorParser().astSync(rule.selector, { lossless: false });
  } catch (error) {
    state.warn(
      "selector-parse",
      `Unable to parse selector "${rule.selector}": ${(error as Error).message}`,
      rule,
    );
    return undefined;
  }

  const children = root.nodes.map((sel) => serializeSelector(sel)).filter((s) => s !== "");
  if (parents === null) return children;

  const resolved: string[] = [];
  for (const child of root.nodes) {
    const hasNesting = containsNesting(child);
    for (const parent of parents) {
      if (hasNesting) {
        const clone = child.clone() as Selector;
        replaceNesting(clone, parent, state, rule);
        resolved.push(serializeSelector(clone));
      } else {
        resolved.push(`${parent} ${serializeSelector(child)}`);
      }
    }
  }
  return resolved;
}

/**
 * Serialise a selector with canonical combinator spacing (`.a > .b`, `.a .b`)
 * so that equivalent selectors from different generators compare equal.
 */
function serializeSelector(selector: Selector): string {
  selector.walk((node) => {
    if (node.type === "combinator") {
      const trimmed = node.value.trim();
      node.value = trimmed === "" ? " " : ` ${trimmed} `;
      node.spaces = { before: "", after: "" };
    }
    return undefined;
  });
  return selector.toString().replace(/\s+/g, " ").trim();
}

function containsNesting(selector: Selector): boolean {
  let found = false;
  selector.walk((node) => {
    if (node.type === "nesting") {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function replaceNesting(selector: Selector, parent: string, state: ParserState, rule: Rule): void {
  let parentRoot: ReturnType<ReturnType<typeof selectorParser>["astSync"]>;
  try {
    parentRoot = selectorParser().astSync(parent, { lossless: false });
  } catch {
    state.warn("selector-parse", `Unable to re-parse parent selector "${parent}"`, rule);
    return;
  }
  const parentNodes = parentRoot.nodes[0]?.nodes ?? [];
  const nestingNodes: SelectorNode[] = [];
  selector.walk((node) => {
    if (node.type === "nesting") nestingNodes.push(node);
    return undefined;
  });
  for (const nesting of nestingNodes) {
    const replacement = parentNodes.map((n) => n.clone() as SelectorNode);
    if (replacement.length === 0) {
      nesting.remove();
      continue;
    }
    nesting.replaceWith(...replacement);
  }
}

function emitMatches(ctx: Context, decls: PostcssDeclaration[], state: ParserState): void {
  const selectors = ctx.selectors ?? [];
  const declarations: Declaration[] = decls.map((d) => ({
    prop: d.prop,
    value: d.value,
    important: d.important === true,
  }));

  for (const selector of selectors) {
    const occurrences = analyzeSelector(selector, state);
    if (occurrences === undefined) continue;
    const perClass = new Map<string, ClassOccurrence>();
    for (const occ of occurrences) {
      const existing = perClass.get(occ.name);
      if (!existing) {
        perClass.set(occ.name, { ...occ, pseudo: [...occ.pseudo] });
      } else if (occ.subject && !existing.subject) {
        existing.subject = true;
        existing.pseudo = [...occ.pseudo];
      }
    }
    for (const occ of perClass.values()) {
      const match: Match = {
        selector,
        subject: occ.subject,
        layers: [...ctx.layers],
        conditions: [...ctx.conditions],
        pseudo: occ.pseudo,
        declarations,
        order: state.nextOrder(),
      };
      if (ctx.source) match.source = ctx.source;
      state.matches.push(match);
      state.classes.add(occ.name);
      const list = state.byClass.get(occ.name);
      if (list) list.push(match);
      else state.byClass.set(occ.name, [match]);
    }
  }

  for (const decl of declarations) {
    if (decl.prop.startsWith("--")) {
      state.customProperties.push({
        name: decl.prop,
        value: decl.value.trim(),
        important: decl.important,
        selectors: [...selectors],
        conditions: [...ctx.conditions],
        layers: [...ctx.layers],
        order: state.customProperties.length,
      });
    }
  }
}

/**
 * Find every class occurrence in a (single, resolved) selector, deciding for
 * each whether it is the subject and which pseudos are attached to its compound.
 */
function analyzeSelector(selector: string, state: ParserState): ClassOccurrence[] | undefined {
  let root: ReturnType<ReturnType<typeof selectorParser>["astSync"]>;
  try {
    root = selectorParser().astSync(selector, { lossless: false });
  } catch (error) {
    state.warn(
      "selector-parse",
      `Unable to analyse selector "${selector}": ${(error as Error).message}`,
    );
    return undefined;
  }
  const out: ClassOccurrence[] = [];
  for (const sel of root.nodes) {
    analyzeComplexSelector(sel, true, [], out);
  }
  return out;
}

function analyzeComplexSelector(
  selector: Selector,
  subjectContext: boolean,
  inheritedPseudo: string[],
  out: ClassOccurrence[],
): void {
  const compounds = splitCompounds(selector);
  compounds.forEach((compound, index) => {
    const isLast = index === compounds.length - 1;
    const subject = subjectContext && isLast;
    const pseudoStrings = compound
      .filter((n) => n.type === "pseudo")
      .map((n) => n.toString().trim());
    const pseudo = isLast ? [...inheritedPseudo, ...pseudoStrings] : pseudoStrings;

    for (const node of compound) {
      if (node.type === "class") {
        const raw = (node as unknown as { raws?: { value?: string } }).raws?.value ?? node.value;
        out.push({ name: classNameFromSelector(raw), subject, pseudo });
      } else if (node.type === "pseudo" && node.nodes && node.nodes.length > 0) {
        const value = node.value.toLowerCase();
        const forwards = FORWARDING_PSEUDOS.has(value);
        const siblingPseudo = pseudo.filter((p) => p !== node.toString().trim());
        for (const inner of node.nodes) {
          analyzeComplexSelector(inner, subject && forwards, forwards ? siblingPseudo : [], out);
        }
      }
    }
  });
}

function splitCompounds(selector: Selector): SelectorNode[][] {
  const compounds: SelectorNode[][] = [[]];
  for (const node of selector.nodes) {
    if (node.type === "combinator") {
      compounds.push([]);
    } else if (node.type !== "comment") {
      (compounds[compounds.length - 1] as SelectorNode[]).push(node);
    }
  }
  return compounds.filter((c) => c.length > 0);
}
