import { baselineCommand } from "./baseline.js";
import { budgetCommand } from "./budget.js";
import { checkCommand } from "./check.js";
import { type CliContext, CliError, defaultContext, EXIT, type ExitCode } from "./context.js";

export const USAGE = `Usage: cssert <command> [options]

Commands:
  check      Compare built CSS with HTML and report missing classes
  baseline   Create or prune a baseline of known findings
  budget     Guard against a stylesheet that shrank unexpectedly

Run "cssert <command> --help" for command options.
`;

type Command = (argv: string[], ctx: CliContext) => Promise<ExitCode>;

export const COMMANDS: Record<string, Command> = {
  check: (argv, ctx) => checkCommand(argv, ctx),
  baseline: (argv, ctx) => baselineCommand(argv, ctx),
  budget: (argv, ctx) => budgetCommand(argv, ctx),
};

/**
 * CLI entry point. Never throws: usage errors map to exit code 2 and
 * unexpected errors to 3, with a message on stderr.
 */
export async function runCli(
  argv: string[],
  ctx: CliContext = defaultContext(),
): Promise<ExitCode> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "-h" || command === "--help") {
    ctx.stdout.write(USAGE);
    return EXIT.ok;
  }
  if (command === "-v" || command === "--version") {
    ctx.stdout.write(`${await readVersion()}\n`);
    return EXIT.ok;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    ctx.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
    return EXIT.usage;
  }
  try {
    return await handler(rest, ctx);
  } catch (error) {
    if (error instanceof CliError) {
      ctx.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    const err = error as Error;
    ctx.stderr.write(`cssert: internal error: ${err?.stack ?? String(error)}\n`);
    return EXIT.internal;
  }
}

async function readVersion(): Promise<string> {
  try {
    const { readFileSync } = await import("node:fs");
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
