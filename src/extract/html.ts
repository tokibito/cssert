import type { DefaultTreeAdapterTypes as T } from "parse5";
import * as parse5 from "parse5";
import { normalizeClassName } from "../core/normalize.js";

/** Position of a class token in the HTML source (1-based). */
export interface Occurrence {
  line: number;
  column: number;
}

export interface ExtractOptions {
  /** Attributes to scan. Compared case-insensitively. Default `["class"]`. */
  attributes?: string[];
  /** Exact strings or patterns to drop from the result. */
  ignore?: (string | RegExp)[];
}

/** Result of {@link extractClasses}. */
export interface Extraction {
  /** Literal class names → where they occur. */
  classes: Map<string, Occurrence[]>;
  /**
   * Tokens that contain template syntax (`{{ }}`, `{% %}`, `${ }`, `<% %>`, …).
   * They cannot be checked against the stylesheet and usually point at
   * dynamically built class names.
   */
  dynamic: Map<string, Occurrence[]>;
}

/** Attributes whose value is a plain space-separated class list. */
const PLAIN_LIST_ATTRIBUTES = new Set(["class", "classname"]);

/** Template-language regions. */
const TEMPLATE_PATTERNS: RegExp[] = [
  /\{\{[\s\S]*?\}\}/g, // Jinja/Django/Twig/Blade/Handlebars output
  /\{%[\s\S]*?%\}/g, // Jinja/Django/Twig tags
  /\{#[\s\S]*?#\}/g, // Jinja comments
  /\{!![\s\S]*?!!\}/g, // Blade unescaped output
  /\$\{[\s\S]*?\}/g, // JS template literals
  /<%[\s\S]*?%>/g, // ERB/EJS/ASP
  /<\?(?:php|=)?[\s\S]*?\?>/g, // PHP
];

/** Placeholder used to mask template regions before splitting. */
const MASK = "\u0000";

/**
 * Extract class names from an HTML document (or fragment) using a real HTML
 * parser, so quoting, unquoted values, `>` inside attribute values and
 * `<template>` contents are handled correctly.
 *
 * Attributes other than `class`/`className` (e.g. Alpine's `:class`) are
 * treated as expressions: class names are read from the string literals they
 * contain. Values without any string literal fall back to plain splitting.
 */
export function extractClasses(html: string, opts: ExtractOptions = {}): Extraction {
  const attributes = new Set((opts.attributes ?? ["class"]).map((a) => a.toLowerCase()));
  const ignore = opts.ignore ?? [];
  const lineIndex = buildLineIndex(html);
  const result: Extraction = { classes: new Map(), dynamic: new Map() };

  const document = parse5.parse(html, { sourceCodeLocationInfo: true });
  walk(document, (element) => {
    const locations = element.sourceCodeLocation?.attrs;
    for (const attr of element.attrs) {
      const name = attr.name.toLowerCase();
      if (!attributes.has(name)) continue;
      const location = locations?.[attr.name];
      const rawValue = location
        ? readRawValue(html, location.startOffset, location.endOffset)
        : undefined;
      const tokens = tokenizeAttribute(name, attr.value, rawValue);
      for (const token of tokens) {
        const value = normalizeClassName(token.value);
        if (isIgnored(value, ignore)) continue;
        let occurrence: Occurrence = { line: 0, column: 0 };
        if (location) {
          const offset =
            rawValue !== undefined && token.offset !== undefined
              ? location.startOffset + rawValue.valueOffset + token.offset
              : location.startOffset;
          occurrence = offsetToPosition(lineIndex, offset);
        }
        const target = token.dynamic ? result.dynamic : result.classes;
        const list = target.get(value);
        if (list) list.push(occurrence);
        else target.set(value, [occurrence]);
      }
    }
  });

  return result;
}

/**
 * Convenience wrapper returning only literal class names.
 * Dynamic (template-syntax) tokens are dropped; use {@link extractClasses}
 * to see them.
 */
export function extractClassesFromHtml(
  html: string,
  opts?: ExtractOptions,
): Map<string, Occurrence[]> {
  return extractClasses(html, opts).classes;
}

/** Whether a token contains template-language syntax. */
export function isDynamicToken(token: string): boolean {
  return TEMPLATE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(token);
  });
}

function isIgnored(value: string, ignore: (string | RegExp)[]): boolean {
  return ignore.some((p) => (typeof p === "string" ? p === value : p.test(value)));
}

function walk(node: T.ParentNode | T.Node, visit: (element: T.Element) => void): void {
  if ("tagName" in node && node.tagName) visit(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) walk(child, visit);
  }
  if ("content" in node && node.content) walk(node.content, visit);
}

interface RawValue {
  /** Raw (undecoded) attribute value text as it appears in the source. */
  text: string;
  /** Offset of the value's first character relative to the attribute start. */
  valueOffset: number;
}

/** Locate the value inside `name="value"` source text. */
function readRawValue(html: string, start: number, end: number): RawValue | undefined {
  const source = html.slice(start, end);
  const eq = source.indexOf("=");
  if (eq === -1) return undefined; // valueless attribute
  let i = eq + 1;
  while (i < source.length && /\s/.test(source.charAt(i))) i++;
  const quote = source.charAt(i);
  if (quote === '"' || quote === "'") {
    const close = source.lastIndexOf(quote);
    const text = close > i ? source.slice(i + 1, close) : source.slice(i + 1);
    return { text, valueOffset: i + 1 };
  }
  return { text: source.slice(i), valueOffset: i };
}

interface Token {
  value: string;
  dynamic: boolean;
  /** Offset within the raw value, when it could be determined. */
  offset: number | undefined;
}

function tokenizeAttribute(name: string, decoded: string, raw: RawValue | undefined): Token[] {
  // Offsets are only reliable when the source text needs no entity decoding.
  const exact = raw !== undefined && raw.text === decoded;
  if (PLAIN_LIST_ATTRIBUTES.has(name)) {
    return splitWithTemplates(decoded, exact ? 0 : undefined);
  }
  const literals = findStringLiterals(decoded);
  if (literals.length === 0) return splitWithTemplates(decoded, exact ? 0 : undefined);
  const tokens: Token[] = [];
  for (const literal of literals) {
    tokens.push(...splitWithTemplates(literal.text, exact ? literal.offset : undefined));
  }
  return tokens;
}

/**
 * Split on ASCII whitespace while keeping template regions intact, so that
 * `text-{{ color }}` stays a single (dynamic) token.
 */
function splitWithTemplates(text: string, baseOffset: number | undefined): Token[] {
  const masked = maskTemplates(text);
  const tokens: Token[] = [];
  const re = /[^ \t\n\f\r]+/g;
  for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
    const value = text.slice(m.index, m.index + m[0].length);
    tokens.push({
      value,
      dynamic: m[0].includes(MASK),
      offset: baseOffset === undefined ? undefined : baseOffset + m.index,
    });
  }
  return tokens;
}

/** Replace template regions with placeholder characters of equal length. */
function maskTemplates(text: string): string {
  let out = text;
  for (const pattern of TEMPLATE_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (m) => MASK.repeat(m.length));
  }
  return out;
}

interface Literal {
  text: string;
  offset: number;
}

/** Find `'…'`, `"…"` and `` `…` `` literals outside template regions. */
function findStringLiterals(text: string): Literal[] {
  const masked = maskTemplates(text);
  const literals: Literal[] = [];
  let i = 0;
  while (i < masked.length) {
    const ch = masked.charAt(i);
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < masked.length && masked.charAt(j) !== ch) {
        if (masked.charAt(j) === "\\") j++;
        j++;
      }
      if (j >= masked.length) break; // unterminated
      literals.push({ text: text.slice(i + 1, j), offset: i + 1 });
      i = j + 1;
    } else {
      i++;
    }
  }
  return literals;
}

function buildLineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToPosition(lineStarts: number[], offset: number): Occurrence {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (lineStarts[lo] as number) + 1 };
}
