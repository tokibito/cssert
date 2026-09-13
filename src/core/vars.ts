import type { CustomPropertyDeclaration } from "./parse.js";

/** Selectors treated as the root scope for custom property lookup. */
const ROOT_SELECTORS = new Set([":root", ":host", "html"]);

export interface VarResolver {
  resolveVar(name: string, scope?: string): string | undefined;
  resolveValue(value: string, scope?: string): string;
}

interface Resolution {
  value: string;
  cyclic: boolean;
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim().toLowerCase();
}

function scopeMatches(selectors: string[], scope: string): boolean {
  const target = normalizeSelector(scope);
  const asClass = target.startsWith(".") ? target : `.${target}`;
  return selectors.some((sel) => {
    const n = normalizeSelector(sel);
    return n === target || n === asClass;
  });
}

function isRootSelector(selectors: string[]): boolean {
  return selectors.some((sel) => ROOT_SELECTORS.has(normalizeSelector(sel)));
}

function isUniversalSelector(selectors: string[]): boolean {
  return selectors.some((sel) => normalizeSelector(sel) === "*");
}

/**
 * Build a resolver for custom properties from the declarations collected
 * during parsing. Lookup order: the requested scope, then `:root`/`:host`/`html`,
 * then `*`, then `@property` initial values. Only unconditional declarations
 * (not inside `@media` etc.) are considered, so the answer is never a guess
 * about which media query is active.
 */
export function createVarResolver(
  declarations: readonly CustomPropertyDeclaration[],
  propertyInitialValues: ReadonlyMap<string, string>,
): VarResolver {
  const unconditional = declarations.filter((d) => d.conditions.length === 0);
  const byName = new Map<string, CustomPropertyDeclaration[]>();
  for (const decl of unconditional) {
    const list = byName.get(decl.name);
    if (list) list.push(decl);
    else byName.set(decl.name, [decl]);
  }

  function lookupRaw(name: string, scope: string | undefined): string | undefined {
    const candidates = byName.get(name) ?? [];
    const pick = (pred: (d: CustomPropertyDeclaration) => boolean): string | undefined => {
      const filtered = candidates.filter(pred);
      const important = filtered.filter((d) => d.important);
      const pool = important.length > 0 ? important : filtered;
      return pool.length > 0 ? pool[pool.length - 1]?.value : undefined;
    };
    if (scope !== undefined) {
      const scoped = pick((d) => scopeMatches(d.selectors, scope));
      if (scoped !== undefined) return scoped;
    }
    const root = pick((d) => isRootSelector(d.selectors));
    if (root !== undefined) return root;
    const universal = pick((d) => isUniversalSelector(d.selectors));
    if (universal !== undefined) return universal;
    return propertyInitialValues.get(name);
  }

  function resolveVarInternal(
    name: string,
    scope: string | undefined,
    visiting: Set<string>,
  ): Resolution | undefined {
    if (visiting.has(name)) return { value: "", cyclic: true };
    const raw = lookupRaw(name, scope);
    if (raw === undefined) return undefined;
    const next = new Set(visiting);
    next.add(name);
    return resolveValueInternal(raw, scope, next);
  }

  function resolveValueInternal(
    value: string,
    scope: string | undefined,
    visiting: Set<string>,
  ): Resolution {
    let out = "";
    let cyclic = false;
    let i = 0;
    while (i < value.length) {
      const idx = findVarStart(value, i);
      if (idx === -1) {
        out += value.slice(i);
        break;
      }
      out += value.slice(i, idx);
      const close = findClosingParen(value, idx + 4);
      if (close === -1) {
        out += value.slice(idx);
        break;
      }
      const inner = value.slice(idx + 4, close);
      const { name, fallback } = splitVarArguments(inner);
      const resolved = name.startsWith("--")
        ? resolveVarInternal(name, scope, visiting)
        : undefined;
      if (resolved?.cyclic) cyclic = true;
      if (resolved && !resolved.cyclic) {
        out += resolved.value;
      } else if (fallback !== undefined) {
        const fb = resolveValueInternal(fallback, scope, visiting);
        if (fb.cyclic) cyclic = true;
        out += fb.value;
      } else {
        out += value.slice(idx, close + 1);
      }
      i = close + 1;
    }
    return { value: out, cyclic };
  }

  return {
    resolveVar(name, scope) {
      const result = resolveVarInternal(name, scope, new Set());
      if (!result || result.cyclic) return undefined;
      return result.value.trim();
    },
    resolveValue(value, scope) {
      return resolveValueInternal(value, scope, new Set()).value;
    },
  };
}

/** Find the next `var(` that is not part of a longer identifier. */
function findVarStart(value: string, from: number): number {
  const lower = value.toLowerCase();
  let idx = lower.indexOf("var(", from);
  while (idx !== -1) {
    const prev = idx > 0 ? (lower.charAt(idx - 1) as string) : "";
    if (prev === "" || !/[a-z0-9_-]/.test(prev)) return idx;
    idx = lower.indexOf("var(", idx + 1);
  }
  return -1;
}

/** Given the index just after an opening paren, return the index of its match. */
function findClosingParen(value: string, from: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = from; i < value.length; i++) {
    const ch = value.charAt(i);
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `--name, fallback` at the first top-level comma. */
export function splitVarArguments(inner: string): { name: string; fallback: string | undefined } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner.charAt(i);
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      return { name: inner.slice(0, i).trim(), fallback: inner.slice(i + 1).trim() };
    }
  }
  return { name: inner.trim(), fallback: undefined };
}
