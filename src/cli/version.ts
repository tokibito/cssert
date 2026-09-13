import { readFileSync } from "node:fs";

/** The npm package this binary was installed from. The binary is `cssert`. */
export const PACKAGE_NAME = "@cssert/cli";

/** Read the package version from the nearest package.json (dist/cli → root). */
export function readVersion(): string {
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string") return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}

/**
 * The `--version` line. It names the package as well as the binary: the two
 * differ (npm rejects the bare name `cssert`), and "is this really the thing I
 * installed?" should be answerable without opening the README.
 */
export function versionLine(): string {
  return `cssert ${readVersion()} (${PACKAGE_NAME})`;
}
