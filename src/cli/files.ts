import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { glob } from "tinyglobby";
import { CliError } from "./context.js";

export interface LoadedFile {
  /** Path relative to cwd, with forward slashes, for reporting. */
  path: string;
  content: string;
}

/**
 * Expand globs relative to `cwd` and read every match. Throws a usage error
 * when nothing matches so a misconfigured path fails loudly instead of
 * producing an empty (and therefore always passing) check.
 */
export async function loadFiles(
  patterns: string[],
  cwd: string,
  label: string,
): Promise<LoadedFile[]> {
  if (patterns.length === 0) {
    throw new CliError(`No ${label} files specified. Use --${label} <glob> or a config file.`);
  }
  const matches = await glob(patterns, { cwd, onlyFiles: true, expandDirectories: false });
  if (matches.length === 0) {
    throw new CliError(`No ${label} files matched: ${patterns.join(", ")}`);
  }
  matches.sort();
  return matches.map((match) => {
    const full = resolve(cwd, match);
    return {
      path: toPosix(relative(cwd, full)) || match,
      content: readFileSync(full, "utf8"),
    };
  });
}

/** Write text to `path` (relative to cwd), creating parent directories. */
export function writeOutput(path: string, cwd: string, text: string): void {
  const full = resolve(cwd, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}

export function toPosix(path: string): string {
  return path.split("\\").join("/");
}
