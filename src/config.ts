/**
 * Configuration accepted by `cssert.config.{ts,js,mjs,json}` and by the CLI.
 * Every field is optional; command-line flags take precedence.
 */
export interface CssertConfig {
  /** Globs for built CSS files. */
  css?: string[];
  /** Globs for HTML documents to check. */
  html?: string[];
  /**
   * Classes to skip entirely, in addition to the default ignore list.
   * Strings match exactly; a string of the form `/pattern/flags` is treated as
   * a regular expression so JSON configs can express patterns too.
   */
  ignore?: (string | RegExp)[];
  /** Classes that are not reported as missing even when absent from the CSS. */
  allow?: (string | RegExp)[];
  /** Set to false to disable the built-in ignore list. */
  useDefaultIgnore?: boolean;
  /** HTML attributes to scan. Default `["class"]`. */
  attributes?: string[];
  /** Baseline file. Default `.cssert/baseline.json`, applied when present. */
  baseline?: string;
  /** Report format. Default `human`. */
  format?: "human" | "json" | "github" | "sarif";
  /** Treat parse warnings as errors. */
  strictParse?: boolean;
  /** Fail when the number of parse warnings exceeds this value. */
  maxWarnings?: number;
  /** Also fail (exit 1) when dynamic-suspect tokens are found. Default false. */
  failOnDynamic?: boolean;
}

/**
 * Identity helper that gives config files type checking and completion.
 *
 * @example
 * ```ts
 * import { defineConfig } from "cssert";
 * export default defineConfig({ css: ["dist/**\/*.css"], html: ["build/**\/*.html"] });
 * ```
 */
export function defineConfig(config: CssertConfig): CssertConfig {
  return config;
}

/**
 * Convert `/pattern/flags` strings to RegExp; leave other values untouched.
 * Applied to `ignore` and `allow` so JSON configs and CLI flags can carry
 * patterns.
 */
export function toPattern(value: string | RegExp): string | RegExp {
  if (value instanceof RegExp) return value;
  const m = /^\/(.+)\/([a-z]*)$/s.exec(value);
  if (!m) return value;
  try {
    return new RegExp(m[1] as string, m[2]);
  } catch {
    return value;
  }
}
