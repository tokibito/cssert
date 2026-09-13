import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CliContext } from "../../src/cli/context.js";
import { runCli } from "../../src/cli/main.js";

export interface Sandbox {
  dir: string;
  write(relative: string, content: string): string;
  read(relative: string): string;
  run(argv: string[], env?: Record<string, string>): Promise<RunResult>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

/** Create an isolated working directory with helpers for CLI tests. */
export function sandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "cssert-"));
  return {
    dir,
    write(relative, content) {
      const full = join(dir, relative);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
      return full;
    },
    read(relative) {
      return readFileSync(join(dir, relative), "utf8");
    },
    async run(argv, env = {}) {
      let stdout = "";
      let stderr = "";
      const ctx: CliContext = {
        cwd: dir,
        stdout: {
          write(t: string) {
            stdout += t;
          },
        },
        stderr: {
          write(t: string) {
            stderr += t;
          },
        },
        env: { ...env },
        isTTY: false,
      };
      const code = await runCli(argv, ctx);
      return { code, stdout, stderr };
    },
  };
}
