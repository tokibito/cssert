import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type BudgetComparison,
  type BudgetSnapshot,
  compareBudget,
  type MaxDrop,
  measureStylesheets,
  parseBudgetSnapshot,
  parseMaxDrop,
  serializeBudgetSnapshot,
} from "../audit/budget.js";
import { findConfigFile, loadConfigFile } from "./config.js";
import { type CliContext, CliError, EXIT, type ExitCode } from "./context.js";
import { loadFiles, writeOutput } from "./files.js";

export const DEFAULT_SNAPSHOT_PATH = ".cssert/budget.json";
export const DEFAULT_MAX_DROP: MaxDrop = { percent: 10 };

export const BUDGET_USAGE = `Usage: cssert budget [options]

Fail when the built CSS lost more classes (or gzip bytes) than allowed since
the last snapshot. Catches a scan-path misconfiguration that empties the build.

Options:
  --css <glob>          Built CSS files (repeatable, comma-separated allowed)
  --snapshot <path>     Snapshot file (default: ${DEFAULT_SNAPSHOT_PATH})
  --max-drop <n|n%>     Allowed drop in classes/gzip size (default: 10%)
  --update              Write the current measurement as the new snapshot
  --config <path>       Config file (default: cssert.config.{ts,js,mjs,json} in cwd)
  --format <fmt>        human | json (default: human)
  -h, --help            Show this help

When no snapshot exists one is created and the command exits 0.
Exit codes: 0 within budget, 1 over budget, 2 usage/config error, 3 internal error.
`;

interface BudgetArgs {
  css?: string[];
  snapshot?: string;
  "max-drop"?: string;
  update?: boolean;
  config?: string;
  format?: string;
  help?: boolean;
}

export async function budgetCommand(argv: string[], ctx: CliContext): Promise<ExitCode> {
  let values: BudgetArgs;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        css: { type: "string", multiple: true },
        snapshot: { type: "string" },
        "max-drop": { type: "string" },
        update: { type: "boolean" },
        config: { type: "string" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }).values as BudgetArgs;
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${BUDGET_USAGE}`);
  }
  if (values.help) {
    ctx.stdout.write(BUDGET_USAGE);
    return EXIT.ok;
  }
  if (values.format !== undefined && values.format !== "human" && values.format !== "json") {
    throw new CliError(`--format: budget supports human or json (got ${values.format}).`);
  }

  const configPath = values.config ?? findConfigFile(ctx.cwd);
  const config = configPath ? await loadConfigFile(configPath, ctx.cwd) : {};
  const css = (values.css ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v !== "");
  const patterns = css.length > 0 ? css : (config.css ?? []);
  const snapshotPath = values.snapshot ?? config.budget?.snapshot ?? DEFAULT_SNAPSHOT_PATH;
  const maxDropText = values["max-drop"] ?? config.budget?.maxDrop;
  let maxDrop: MaxDrop = DEFAULT_MAX_DROP;
  if (maxDropText !== undefined) {
    const parsed = parseMaxDrop(maxDropText);
    if (!parsed)
      throw new CliError(`--max-drop must look like "10%" or "25" (got ${maxDropText}).`);
    maxDrop = parsed;
  }

  const stylesheets = await loadFiles(patterns, ctx.cwd, "css");
  const current = measureStylesheets(stylesheets.map((f) => ({ path: f.path, css: f.content })));
  const previous = readSnapshotFile(snapshotPath, ctx.cwd);
  const json = values.format === "json";

  if (!previous) {
    writeOutput(snapshotPath, ctx.cwd, serializeBudgetSnapshot(current));
    if (json) {
      ctx.stdout.write(
        `${JSON.stringify({ version: 1, tool: "cssert", created: true, snapshot: current }, null, 2)}\n`,
      );
    } else {
      ctx.stdout.write(
        `No snapshot found; created ${snapshotPath} (${current.total.classes} classes, ${formatBytes(current.total.gzipBytes)} gzipped).\n`,
      );
    }
    return EXIT.ok;
  }

  const comparison = compareBudget(previous, current, maxDrop);
  if (values.update) {
    writeOutput(snapshotPath, ctx.cwd, serializeBudgetSnapshot(current));
  }
  if (json) {
    ctx.stdout.write(
      `${JSON.stringify(
        {
          version: 1,
          tool: "cssert",
          ok: comparison.ok,
          updated: values.update === true,
          comparison,
          snapshot: current,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    ctx.stdout.write(formatBudget(comparison, previous, maxDrop));
    if (values.update) ctx.stdout.write(`Snapshot updated: ${snapshotPath}\n`);
  }
  return values.update || comparison.ok ? EXIT.ok : EXIT.violations;
}

export function readSnapshotFile(path: string, cwd: string): BudgetSnapshot | undefined {
  const full = resolve(cwd, path);
  if (!existsSync(full)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new CliError(`Invalid JSON in snapshot ${path}: ${(error as Error).message}`);
  }
  const parsed = parseBudgetSnapshot(json);
  if ("error" in parsed) throw new CliError(`Invalid snapshot ${path}: ${parsed.error}`);
  return parsed.snapshot;
}

export function formatBudget(
  comparison: BudgetComparison,
  previous: BudgetSnapshot,
  maxDrop: MaxDrop,
): string {
  const lines: string[] = [];
  const label: Record<string, string> = {
    classes: "classes",
    gzipBytes: "gzip size",
    bytes: "raw size",
  };
  for (const d of comparison.deltas) {
    const fmt = d.metric === "classes" ? String : formatBytes;
    const change = d.current - d.previous;
    const sign = change > 0 ? "+" : "";
    const pct = d.previous === 0 ? "" : ` (${sign}${((change / d.previous) * 100).toFixed(1)}%)`;
    const mark = d.violation ? "✗" : "✓";
    lines.push(
      `  ${mark} ${label[d.metric]?.padEnd(9)} ${fmt(d.previous)} → ${fmt(d.current)}${pct}`,
    );
  }
  for (const f of comparison.removedFiles) lines.push(`  - removed: ${f}`);
  for (const f of comparison.addedFiles) lines.push(`  + added:   ${f}`);
  const allowed =
    maxDrop.percent !== undefined ? `${maxDrop.percent}%` : `${maxDrop.absolute ?? 0} classes`;
  lines.push("");
  lines.push(
    comparison.ok
      ? `  within budget (allowed drop: ${allowed}; snapshot from ${previous.createdAt})`
      : `  over budget: the build lost more than the allowed ${allowed} since ${previous.createdAt}. ` +
          "If this is intended, re-run with --update.",
  );
  return `${lines.join("\n")}\n`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KiB`;
}
