import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Baseline,
  createBaseline,
  parseBaseline,
  pruneBaseline,
  serializeBaseline,
} from "../audit/baseline.js";
import { CHECK_USAGE, parseCheckArgs, resolveCheckOptions, runAudit } from "./check.js";
import { type CliContext, CliError, EXIT, type ExitCode } from "./context.js";
import { writeOutput } from "./files.js";

export const DEFAULT_BASELINE_PATH = ".cssert/baseline.json";

export const BASELINE_USAGE = `Usage: cssert baseline <create|prune> [options]

  create   Freeze the current findings so that only new ones fail "cssert check"
  prune    Remove entries whose finding no longer occurs

Options are the same as for "cssert check" (--css, --html, --config, ...).
The file is written to --baseline (default: ${DEFAULT_BASELINE_PATH}).

${CHECK_USAGE.slice(CHECK_USAGE.indexOf("Options:"))}`;

/** Read and validate a baseline file. Returns undefined when it does not exist. */
export function readBaselineFile(path: string, cwd: string): Baseline | undefined {
  const full = resolve(cwd, path);
  if (!existsSync(full)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new CliError(`Invalid JSON in baseline ${path}: ${(error as Error).message}`);
  }
  const parsed = parseBaseline(json);
  if ("error" in parsed) throw new CliError(`Invalid baseline ${path}: ${parsed.error}`);
  return parsed.baseline;
}

export async function baselineCommand(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "-h" || sub === "--help") {
    ctx.stdout.write(BASELINE_USAGE);
    return EXIT.ok;
  }
  if (sub !== "create" && sub !== "prune") {
    throw new CliError(`Unknown baseline subcommand "${sub}".\n\n${BASELINE_USAGE}`);
  }
  const parsed = parseCheckArgs(rest);
  if (parsed.help) {
    ctx.stdout.write(BASELINE_USAGE);
    return EXIT.ok;
  }
  const options = await resolveCheckOptions(parsed.raw, ctx);
  const path = options.baseline ?? DEFAULT_BASELINE_PATH;
  const report = await runAudit(options, ctx);

  if (sub === "create") {
    const baseline = createBaseline(report.findings);
    writeOutput(path, ctx.cwd, serializeBaseline(baseline));
    ctx.stdout.write(
      `Baseline written to ${path} (${baseline.entries.length} finding(s) frozen).\n`,
    );
    return EXIT.ok;
  }

  const existing = readBaselineFile(path, ctx.cwd);
  if (!existing) throw new CliError(`Baseline not found: ${path}`);
  const { baseline, removed } = pruneBaseline(existing, report.findings);
  writeOutput(path, ctx.cwd, serializeBaseline(baseline));
  ctx.stdout.write(
    `Baseline ${path} pruned: ${removed.length} resolved, ${baseline.entries.length} remaining.\n`,
  );
  for (const entry of removed) ctx.stdout.write(`  - ${entry.className} (${entry.kind})\n`);
  return EXIT.ok;
}
