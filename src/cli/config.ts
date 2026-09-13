import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CssertConfig, toPattern } from "../config.js";
import { CliError } from "./context.js";

export const CONFIG_FILES = [
  "cssert.config.ts",
  "cssert.config.mts",
  "cssert.config.js",
  "cssert.config.mjs",
  "cssert.config.json",
] as const;

/** Find the first config file in `cwd`, or undefined. */
export function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_FILES) {
    const full = resolve(cwd, name);
    if (existsSync(full)) return full;
  }
  return undefined;
}

/**
 * Load a config file. `.json` is parsed directly; `.js`/`.mjs` are imported;
 * `.ts` is imported natively when the Node runtime strips types (22.18+, 24+)
 * and otherwise through `jiti` when it is installed.
 */
export async function loadConfigFile(path: string, cwd: string): Promise<CssertConfig> {
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  if (!existsSync(full)) throw new CliError(`Config file not found: ${path}`);

  let raw: unknown;
  if (full.endsWith(".json")) {
    try {
      raw = JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      throw new CliError(`Invalid JSON in ${path}: ${(error as Error).message}`);
    }
  } else {
    raw = await importModule(full, path);
  }
  return normalizeConfig(raw, path);
}

async function importModule(full: string, display: string): Promise<unknown> {
  const url = pathToFileURL(full).href;
  try {
    const mod = (await import(url)) as { default?: unknown };
    return mod.default ?? mod;
  } catch (error) {
    if (!/\.[mc]?ts$/.test(full)) {
      throw new CliError(`Failed to load ${display}: ${(error as Error).message}`);
    }
    // Native TypeScript loading failed; try jiti if the project has it.
    try {
      const jitiModule = (await import("jiti" as string)) as {
        createJiti?: (id: string) => {
          import(id: string, opts: { default: true }): Promise<unknown>;
        };
      };
      if (jitiModule.createJiti) {
        const jiti = jitiModule.createJiti(pathToFileURL(`${full}/..`).href);
        return await jiti.import(full, { default: true });
      }
    } catch {
      // fall through to the explanatory error below
    }
    throw new CliError(
      `Failed to load ${display}: ${(error as Error).message}\n` +
        "TypeScript config files need Node.js 22.18+/24+ (native type stripping) or the optional `jiti` package. " +
        "Alternatively rename the file to cssert.config.mjs or cssert.config.json.",
    );
  }
}

function normalizeConfig(raw: unknown, display: string): CssertConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError(`Config ${display} must export an object.`);
  }
  const input = raw as Record<string, unknown>;
  const config: CssertConfig = {};

  const list = (key: string): string[] | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v === "string") return [v];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    throw new CliError(`Config ${display}: "${key}" must be a string or an array of strings.`);
  };
  const patterns = (key: string): (string | RegExp)[] | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" || x instanceof RegExp)) {
      throw new CliError(`Config ${display}: "${key}" must be an array of strings or RegExps.`);
    }
    return (v as (string | RegExp)[]).map(toPattern);
  };
  const bool = (key: string): boolean | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean")
      throw new CliError(`Config ${display}: "${key}" must be a boolean.`);
    return v;
  };

  const str = (key: string): string | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new CliError(`Config ${display}: "${key}" must be a string.`);
    return v;
  };
  const integer = (key: string): number | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new CliError(`Config ${display}: "${key}" must be a non-negative integer.`);
    }
    return v;
  };

  const css = list("css");
  if (css) config.css = css;
  const html = list("html");
  if (html) config.html = html;
  const attributes = list("attributes");
  if (attributes) config.attributes = attributes;
  const ignore = patterns("ignore");
  if (ignore) config.ignore = ignore;
  const allow = patterns("allow");
  if (allow) config.allow = allow;
  const hooks = patterns("hooks");
  if (hooks) config.hooks = hooks;
  const useDefaultIgnore = bool("useDefaultIgnore");
  if (useDefaultIgnore !== undefined) config.useDefaultIgnore = useDefaultIgnore;
  const strictParse = bool("strictParse");
  if (strictParse !== undefined) config.strictParse = strictParse;
  const failOnDynamic = bool("failOnDynamic");
  if (failOnDynamic !== undefined) config.failOnDynamic = failOnDynamic;
  const requireBaseline = bool("requireBaseline");
  if (requireBaseline !== undefined) config.requireBaseline = requireBaseline;
  const annotateOccurrences = bool("annotateOccurrences");
  if (annotateOccurrences !== undefined) config.annotateOccurrences = annotateOccurrences;

  const root = str("root");
  if (root !== undefined) config.root = root;
  if (input.resolveFrom !== undefined) {
    if (input.resolveFrom !== "config" && input.resolveFrom !== "cwd") {
      throw new CliError(
        `Config ${display}: "resolveFrom" must be "config" or "cwd" (got ${String(input.resolveFrom)}).`,
      );
    }
    config.resolveFrom = input.resolveFrom;
  }
  const minDocuments = integer("minDocuments");
  if (minDocuments !== undefined) config.minDocuments = minDocuments;
  const minStylesheets = integer("minStylesheets");
  if (minStylesheets !== undefined) config.minStylesheets = minStylesheets;

  const baseline = str("baseline");
  if (baseline !== undefined) config.baseline = baseline;
  if (input.format !== undefined) {
    config.format = parseFormat(input.format, display);
  }
  if (input.budget !== undefined) {
    const b = input.budget;
    if (b === null || typeof b !== "object" || Array.isArray(b)) {
      throw new CliError(`Config ${display}: "budget" must be an object.`);
    }
    const budget: NonNullable<CssertConfig["budget"]> = {};
    const { snapshot, maxDrop } = b as Record<string, unknown>;
    if (snapshot !== undefined) {
      if (typeof snapshot !== "string") {
        throw new CliError(`Config ${display}: "budget.snapshot" must be a string.`);
      }
      budget.snapshot = snapshot;
    }
    if (maxDrop !== undefined) {
      if (typeof maxDrop !== "string" && typeof maxDrop !== "number") {
        throw new CliError(`Config ${display}: "budget.maxDrop" must be a string like "10%".`);
      }
      budget.maxDrop = String(maxDrop);
    }
    config.budget = budget;
  }
  if (input.maxWarnings !== undefined) {
    if (typeof input.maxWarnings !== "number" || !Number.isInteger(input.maxWarnings)) {
      throw new CliError(`Config ${display}: "maxWarnings" must be an integer.`);
    }
    config.maxWarnings = input.maxWarnings;
  }
  return config;
}

export function parseFormat(value: unknown, source: string): CssertConfig["format"] & string {
  if (value === "human" || value === "json" || value === "github" || value === "sarif")
    return value;
  throw new CliError(
    `${source}: format must be one of human, json, github, sarif (got ${String(value)}).`,
  );
}
