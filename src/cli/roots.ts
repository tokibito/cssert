import { dirname, resolve } from "node:path";
import type { CssertConfig } from "../config.js";

/**
 * The directories that relative paths are resolved against.
 *
 * Paths written in a config file are relative to that file (`config`), the way
 * eslint, vitest and tsc treat their own configs. Paths typed on the command
 * line stay relative to the working directory (`flag`), which is what "I
 * pointed at a file here" means. `root` in the config file rebases the config
 * side only; `--root`, given at invocation time, collapses both onto the same
 * directory.
 */
export interface Roots {
  /** Base for values that came from the config file. */
  config: string;
  /** Base for values that came from command-line flags. */
  flag: string;
}

/** Where a path or glob came from, which decides its base directory. */
export type Origin = keyof Roots;

/** A set of globs together with the directory they are resolved against. */
export interface PatternSet {
  patterns: string[];
  base: string;
}

/**
 * Work out the base directories for one CLI run.
 *
 * @param cwd       Working directory of the process.
 * @param configPath Absolute path of the loaded config file, if any.
 * @param config    The loaded config (for `root` / `resolveFrom`).
 * @param rootFlag  Value of `--root`, relative to `cwd`.
 */
export function resolveRoots(
  cwd: string,
  configPath: string | undefined,
  config: Pick<CssertConfig, "root" | "resolveFrom">,
  rootFlag: string | undefined,
): Roots {
  if (rootFlag !== undefined && rootFlag !== "") {
    const root = resolve(cwd, rootFlag);
    return { config: root, flag: root };
  }
  const configDir = configPath === undefined ? undefined : dirname(resolve(cwd, configPath));
  if (config.root !== undefined && config.root !== "") {
    // `root` in a config file rebases that file's own paths; it does not move
    // command-line globs, which keep meaning "relative to where I am".
    return { config: resolve(configDir ?? cwd, config.root), flag: cwd };
  }
  const useConfigDir = configDir !== undefined && (config.resolveFrom ?? "config") === "config";
  return { config: useConfigDir ? configDir : cwd, flag: cwd };
}
