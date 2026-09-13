/** Exit codes used by every command. */
export const EXIT = {
  ok: 0,
  violations: 1,
  usage: 2,
  internal: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Raised for argument/configuration problems. Mapped to exit code 2. */
export class CliError extends Error {
  readonly exitCode: ExitCode;
  constructor(message: string, exitCode: ExitCode = EXIT.usage) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Injected I/O so commands can be tested without touching the real process. */
export interface CliContext {
  cwd: string;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  env: Record<string, string | undefined>;
  /** Whether stdout is a terminal (drives colour defaults). */
  isTTY: boolean;
}

export function defaultContext(): CliContext {
  return {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    isTTY: process.stdout.isTTY === true,
  };
}
