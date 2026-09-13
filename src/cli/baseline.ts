import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  type Baseline,
  createBaseline,
  parseBaseline,
  pruneBaseline,
  serializeBaseline,
} from "../audit/baseline.js";
import type { Finding } from "../audit/derive.js";
import {
  CHECK_USAGE,
  type CheckOptions,
  parseCheckArgs,
  resolveCheckOptions,
  runAudit,
} from "./check.js";
import { type CliContext, CliError, EXIT, type ExitCode } from "./context.js";
import { writeOutput } from "./files.js";

export const DEFAULT_BASELINE_PATH = ".cssert/baseline.json";

export const BASELINE_USAGE = `Usage: cssert baseline <create|prune> [options]

  create   Freeze the current findings so that only new ones fail "cssert check"
  prune    Remove entries whose finding no longer occurs

Options are the same as for "cssert check" (--css, --html, --config, ...) plus:
  --kind <k>             What to freeze: failing (default) | missing |
                         dynamic-suspect | all. "failing" means the kinds that
                         fail the check with the current options, so
                         dynamic-suspect is included only with --fail-on-dynamic.
  --dry-run              Report what would change without writing the file

The file is written to --baseline (default: ${DEFAULT_BASELINE_PATH}).

${CHECK_USAGE.slice(CHECK_USAGE.indexOf("Options:"))}`;

const BASELINE_OPTIONS = {
  kind: { type: "string" },
  "dry-run": { type: "boolean" },
} as const;

/** Which finding kinds a `baseline create` run should freeze. */
export type KindSelector = "failing" | "missing" | "dynamic-suspect" | "all";

export function parseKind(value: string | undefined): KindSelector {
  if (value === undefined) return "failing";
  if (value === "failing" || value === "missing" || value === "dynamic-suspect" || value === "all")
    return value;
  throw new CliError(
    `--kind must be one of failing, missing, dynamic-suspect, all (got ${value}).`,
  );
}

/**
 * Keep only the findings the selector asks for.
 *
 * The default freezes exactly what would fail the build. Freezing
 * dynamic-suspect findings by default made baselines rot: their key is the
 * whole template expression, so editing a condition changes the key and the
 * entry silently stops matching.
 */
export function selectFindings(
  findings: readonly Finding[],
  selector: KindSelector,
  failOnDynamic: boolean,
): Finding[] {
  if (selector === "all") return [...findings];
  const kinds: Finding["kind"][] =
    selector === "failing"
      ? failOnDynamic
        ? ["missing", "dynamic-suspect"]
        : ["missing"]
      : [selector];
  return findings.filter((f) => kinds.includes(f.kind));
}

/** Read and validate a baseline file. Returns undefined when it does not exist. */
export function readBaselineFile(path: string, base: string): Baseline | undefined {
  const full = isAbsolute(path) ? path : resolve(base, path);
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

/** The file `baseline create|prune` writes, ignoring `--no-baseline`. */
function targetFor(options: CheckOptions): { path: string; base: string } {
  return options.baseline ?? { path: DEFAULT_BASELINE_PATH, base: options.roots.config };
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
  const parsed = parseCheckArgs(rest, BASELINE_OPTIONS, BASELINE_USAGE);
  if (parsed.help) {
    ctx.stdout.write(BASELINE_USAGE);
    return EXIT.ok;
  }
  const kind = parseKind(parsed.raw.kind);
  const dryRun = parsed.raw["dry-run"] === true;
  const options = await resolveCheckOptions(parsed.raw, ctx);
  const { path, base } = targetFor(options);
  const report = await runAudit(options);

  if (sub === "create") {
    const selected = selectFindings(report.findings, kind, options.failOnDynamic);
    const baseline = createBaseline(selected);
    const skipped = report.findings.length - selected.length;
    if (!dryRun) writeOutput(path, base, serializeBaseline(baseline));
    ctx.stdout.write(
      `${dryRun ? "Would write baseline to" : "Baseline written to"} ${path}` +
        ` (${baseline.entries.length} finding(s) frozen` +
        (skipped > 0 ? `, ${skipped} not failing the check left out` : "") +
        `).\n`,
    );
    return EXIT.ok;
  }

  const existing = readBaselineFile(path, base);
  if (!existing) throw new CliError(`Baseline not found: ${path}`);
  const { baseline, removed } = pruneBaseline(existing, report.findings);
  if (!dryRun) writeOutput(path, base, serializeBaseline(baseline));
  ctx.stdout.write(
    `Baseline ${path}${dryRun ? " (dry run):" : " pruned:"}` +
      ` ${removed.length} resolved, ${baseline.entries.length} remaining.\n`,
  );
  for (const entry of removed) ctx.stdout.write(`  - ${entry.className} (${entry.kind})\n`);
  return EXIT.ok;
}
