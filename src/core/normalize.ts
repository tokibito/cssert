/**
 * Class-name normalisation shared by the CSS side and the HTML side.
 *
 * CSS selectors escape characters such as `:`, `/`, `[` and leading digits;
 * HTML class attributes contain the raw name. Both sides must end up as the
 * same string for comparison to be meaningful.
 */

const REPLACEMENT = "�";
const MAX_CODE_POINT = 0x10ffff;

function isHexDigit(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * Decode CSS escape sequences in an identifier, following the
 * "consume an escaped code point" algorithm of CSS Syntax Level 3.
 *
 * - `\:` → `:` (any non-hex character is taken literally)
 * - `\32 ` → `2` (1–6 hex digits, optionally followed by one whitespace)
 * - `\32xl` → `2xl` (`x` is not a hex digit, so the escape ends there)
 * - a trailing lone backslash, `\0`, surrogates and out-of-range code points
 *   become U+FFFD as the spec requires
 *
 * The input is expected without the leading `.` of a class selector.
 */
export function unescapeCssIdentifier(input: string): string {
  if (!input.includes("\\")) return input;
  let out = "";
  let i = 0;
  const len = input.length;
  while (i < len) {
    const ch = input.charAt(i);
    if (ch !== "\\") {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (i >= len) {
      out += REPLACEMENT;
      break;
    }
    let hex = "";
    while (i < len && hex.length < 6 && isHexDigit(input.charAt(i))) {
      hex += input.charAt(i);
      i++;
    }
    if (hex.length > 0) {
      if (i < len && isWhitespace(input.charAt(i))) {
        // A single whitespace terminates the escape; CRLF counts as one.
        if (input.charAt(i) === "\r" && input.charAt(i + 1) === "\n") i++;
        i++;
      }
      const cp = Number.parseInt(hex, 16);
      if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > MAX_CODE_POINT) {
        out += REPLACEMENT;
      } else {
        out += String.fromCodePoint(cp);
      }
      continue;
    }
    const next = input.charAt(i);
    if (next === "\n" || next === "\f" || (next === "\r" && input.charAt(i + 1) !== "\n")) {
      // Backslash + newline is not a valid escape inside an identifier. Drop the
      // backslash and keep going; postcss would already have flagged this.
      i++;
      continue;
    }
    if (next === "\r") {
      i += 2;
      continue;
    }
    // Surrogate pairs: copy both halves.
    const cp = input.codePointAt(i) as number;
    const str = String.fromCodePoint(cp);
    out += str;
    i += str.length;
  }
  return out;
}

/**
 * Normalise a class name for comparison. Applied to **both** the CSS side and
 * the HTML side. Currently: Unicode NFC normalisation. Escapes are not handled
 * here because HTML class names are literal; use {@link classNameFromSelector}
 * for the CSS side.
 */
export function normalizeClassName(name: string): string {
  return name.normalize("NFC");
}

/**
 * Turn the escaped identifier of a class selector (without the leading `.`)
 * into a normalised class name: `md\:p-4` → `md:p-4`.
 */
export function classNameFromSelector(escaped: string): string {
  return normalizeClassName(unescapeCssIdentifier(escaped));
}

/**
 * Split an HTML `class` attribute value into tokens using ASCII whitespace,
 * as the HTML specification does for space-separated tokens.
 */
export function splitClassList(value: string): string[] {
  return value.split(/[ \t\n\f\r]+/).filter((token) => token.length > 0);
}

/**
 * Normalise a media query (or other at-rule condition) so that equivalent
 * spellings compare equal:
 *
 * - `(min-width: 48rem)` → `(width >= 48rem)`
 * - `(max-width: 48rem)` → `(width <= 48rem)`
 * - `(48rem <= width)` → `(width >= 48rem)`
 * - whitespace and case are normalised, a leading `@media` is dropped
 *
 * Units are not converted; `48rem` and `768px` remain different.
 */
export function normalizeCondition(condition: string): string {
  let s = condition.trim().replace(/\s+/g, " ").toLowerCase();
  s = s.replace(/^@media\s+/, "");
  // Normalise spacing around comparison operators inside parentheses.
  s = s.replace(/\s*(<=|>=|<|>|=)\s*/g, " $1 ");
  s = s.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  s = s.replace(/\s*:\s*/g, ": ");
  // min-/max- prefixes → range syntax.
  s = s.replace(
    /\(\s*(min|max)-([a-z-]+): ([^()]+?)\)/g,
    (_m, kind: string, feature: string, value: string) =>
      `(${feature} ${kind === "min" ? ">=" : "<="} ${value.trim()})`,
  );
  // Reversed range comparisons `(value <= feature)` → `(feature >= value)`.
  s = s.replace(
    /\(([^()<>=]+?) (<=|>=|<|>) ([a-z][a-z-]*)\)/g,
    (m, left: string, op: string, right: string) => {
      if (/^[a-z][a-z-]*$/.test(left.trim())) return m; // both sides look like features
      const flipped = { "<=": ">=", ">=": "<=", "<": ">", ">": "<" }[op] ?? op;
      return `(${right} ${flipped} ${left.trim()})`;
    },
  );
  return s;
}
