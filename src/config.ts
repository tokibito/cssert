/**
 * Configuration accepted by `cssert.config.{ts,js,mjs,json}` and by the CLI.
 * Every field is optional; command-line flags take precedence.
 *
 * Relative paths in a config file are resolved against the directory that
 * contains the config file, not against the working directory. Set
 * {@link CssertConfig.root} to override that base, or
 * `resolveFrom: "cwd"` to restore the pre-0.2 behaviour.
 */
export interface CssertConfig {
  /** Globs for built CSS files. */
  css?: string[];
  /** Globs for HTML documents to check. */
  html?: string[];
  /**
   * Base directory for the relative paths in this file. Relative to the
   * config file's own directory. Default: the config file's directory.
   */
  root?: string;
  /**
   * Where relative paths in this file are resolved from when `root` is unset.
   * `"config"` (default) uses the config file's directory; `"cwd"` restores
   * the 0.1 behaviour of resolving against the working directory.
   */
  resolveFrom?: "config" | "cwd";
  /**
   * Classes to skip entirely, in addition to the default ignore list.
   * Strings match exactly; a string of the form `/pattern/flags` is treated as
   * a regular expression so JSON configs can express patterns too.
   */
  ignore?: (string | RegExp)[];
  /** Classes that are not reported as missing even when absent from the CSS. */
  allow?: (string | RegExp)[];
  /**
   * Classes that exist only as script/test hooks and are *expected* to have no
   * styles. Behaves like {@link CssertConfig.allow}; the separate key records
   * the intent ("correct that the CSS does not define this") rather than
   * "not checked".
   */
  hooks?: (string | RegExp)[];
  /** Set to false to disable the built-in ignore list. */
  useDefaultIgnore?: boolean;
  /** HTML attributes to scan. Default `["class"]`. */
  attributes?: string[];
  /** Baseline file. Default `.cssert/baseline.json`, applied when present. */
  baseline?: string;
  /** Fail when the baseline file is absent instead of continuing without one. */
  requireBaseline?: boolean;
  /** Report format. Default `human`. */
  format?: "human" | "json" | "github" | "sarif";
  /**
   * Emit one `--format github` annotation per occurrence instead of one per
   * class. Default false; GitHub caps the annotations it displays per run.
   */
  annotateOccurrences?: boolean;
  /** Treat parse warnings as errors. */
  strictParse?: boolean;
  /** Fail when the number of parse warnings exceeds this value. */
  maxWarnings?: number;
  /** Also fail (exit 1) when dynamic-suspect tokens are found. Default false. */
  failOnDynamic?: boolean;
  /** Fail when fewer than this many HTML documents were scanned. */
  minDocuments?: number;
  /** Fail when fewer than this many stylesheets were scanned. */
  minStylesheets?: number;
  /** Settings for `cssert budget`. */
  budget?: {
    /** Snapshot file. Default `.cssert/budget.json`. */
    snapshot?: string;
    /** Allowed drop, e.g. `"10%"` or `"25"` (classes). Default `"10%"`. */
    maxDrop?: string;
  };
}

/**
 * Identity helper that gives config files type checking and completion.
 *
 * @example
 * ```ts
 * import { defineConfig } from "@cssert/cli";
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
