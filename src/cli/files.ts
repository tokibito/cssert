import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { glob } from "tinyglobby";
import { CliError } from "./context.js";
import type { PatternSet } from "./roots.js";

export interface LoadedFile {
  /** Path relative to the base directory, with forward slashes, for reporting. */
  path: string;
  /** The input glob that matched this file, for provenance in reports. */
  pattern: string;
  content: string;
}

/**
 * Expand globs relative to `set.base` and read every match. Throws a usage
 * error when nothing matches so a misconfigured path fails loudly instead of
 * producing an empty (and therefore always passing) check.
 *
 * Each positive pattern is expanded separately (with the negative patterns of
 * the set applied to all of them) so every file can name the glob it came
 * from; the resulting set is the same as a single combined expansion.
 */
export async function loadFiles(set: PatternSet, label: string): Promise<LoadedFile[]> {
  if (set.patterns.length === 0) {
    throw new CliError(`No ${label} files specified. Use --${label} <glob> or a config file.`);
  }
  const negative = set.patterns.filter((p) => p.startsWith("!"));
  const positive = set.patterns.filter((p) => !p.startsWith("!"));

  const attribution = new Map<string, string>();
  for (const pattern of positive) {
    const matches = await glob([pattern, ...negative], {
      cwd: set.base,
      onlyFiles: true,
      expandDirectories: false,
    });
    for (const match of matches) {
      if (!attribution.has(match)) attribution.set(match, pattern);
    }
  }
  if (attribution.size === 0) {
    throw new CliError(`No ${label} files matched: ${set.patterns.join(", ")}`);
  }

  return [...attribution.keys()].sort().map((match) => {
    const full = resolve(set.base, match);
    return {
      path: toPosix(relative(set.base, full)) || match,
      pattern: attribution.get(match) as string,
      content: readFileSync(full, "utf8"),
    };
  });
}

/** Write text to `path` (relative to `base`), creating parent directories. */
export function writeOutput(path: string, base: string, text: string): void {
  const full = isAbsolute(path) ? path : resolve(base, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}

export function toPosix(path: string): string {
  return path.split("\\").join("/");
}
