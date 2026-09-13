import { parseArgs } from "node:util";
import { applyBaseline } from "../audit/baseline.js";
import { audit } from "../audit/derive.js";
import type { CssertConfig } from "../config.js";
import { toPattern } from "../config.js";
import { formatGithub } from "../report/github.js";
import { formatHuman } from "../report/human.js";
import { formatJson } from "../report/json.js";
import { formatSarif } from "../report/sarif.js";
import type { Report, ReportFormat } from "../report/types.js";
import { DEFAULT_BASELINE_PATH, readBaselineFile } from "./baseline.js";
import { findConfigFile, loadConfigFile, parseFormat } from "./config.js";
import { type CliContext, CliError, EXIT, type ExitCode } from "./context.js";
import { loadFiles, writeOutput } from "./files.js";
import { readVersion } from "./version.js";

export const CHECK_USAGE = `Usage: cssert check [options]

Compare built CSS with HTML and report classes that are missing from the CSS.

Options:
  --css <glob>           Built CSS files (repeatable, comma-separated allowed)
  --html <glob>          HTML documents to check (repeatable)
  --config <path>        Config file (default: cssert.config.{ts,js,mjs,json} in cwd)
  --baseline <path>      Baseline file (default: .cssert/baseline.json when present)
  --format <fmt>         human | json | github | sarif (default: human)
  --output <path>        Write the report to a file instead of stdout
  --attributes <list>    HTML attributes to scan (default: class)
  --ignore <pattern>     Extra class or /regex/ to ignore (repeatable)
  --allow <pattern>      Class or /regex/ that may be absent from the CSS (repeatable)
  --strict-parse         Treat CSS parse warnings as errors
  --max-warnings <n>     Fail when parse warnings exceed <n>
  --fail-on-dynamic      Also fail when dynamic-suspect tokens are found
  --no-color             Disable colours
  -h, --help             Show this help

Exit codes: 0 no violations, 1 violations, 2 usage/config error, 3 internal error.
`;

export interface CheckOptions {
  css: string[];
  html: string[];
  config?: string;
  baseline?: string;
  format: ReportFormat;
  output?: string;
  attributes?: string[];
  ignore: (string | RegExp)[];
  allow: (string | RegExp)[];
  useDefaultIgnore: boolean;
  strictParse: boolean;
  maxWarnings?: number;
  failOnDynamic: boolean;
  color: boolean;
}

/** Split repeatable/comma-separated list flags. */
function splitList(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

export function parseCheckArgs(
  argv: string[],
): { help: true } | { help: false; raw: RawCheckArgs } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        css: { type: "string", multiple: true },
        html: { type: "string", multiple: true },
        config: { type: "string" },
        baseline: { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        attributes: { type: "string", multiple: true },
        ignore: { type: "string", multiple: true },
        allow: { type: "string", multiple: true },
        "strict-parse": { type: "boolean" },
        "max-warnings": { type: "string" },
        "fail-on-dynamic": { type: "boolean" },
        "no-color": { type: "boolean" },
        color: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${CHECK_USAGE}`);
  }
  if (parsed.values.help) return { help: true };
  return { help: false, raw: parsed.values as RawCheckArgs };
}

export interface RawCheckArgs {
  css?: string[];
  html?: string[];
  config?: string;
  baseline?: string;
  format?: string;
  output?: string;
  attributes?: string[];
  ignore?: string[];
  allow?: string[];
  "strict-parse"?: boolean;
  "max-warnings"?: string;
  "fail-on-dynamic"?: boolean;
  "no-color"?: boolean;
  color?: boolean;
}

/** Merge config file values with command-line flags (flags win). */
export async function resolveCheckOptions(
  raw: RawCheckArgs,
  ctx: CliContext,
): Promise<CheckOptions> {
  const configPath = raw.config ?? findConfigFile(ctx.cwd);
  const config: CssertConfig = configPath ? await loadConfigFile(configPath, ctx.cwd) : {};

  const cssFlags = splitList(raw.css);
  const htmlFlags = splitList(raw.html);
  const attributes = splitList(raw.attributes);

  let maxWarnings = config.maxWarnings;
  if (raw["max-warnings"] !== undefined) {
    const n = Number(raw["max-warnings"]);
    if (!Number.isInteger(n) || n < 0) {
      throw new CliError(
        `--max-warnings must be a non-negative integer (got ${raw["max-warnings"]}).`,
      );
    }
    maxWarnings = n;
  }

  const colorFlag = raw["no-color"] ? false : raw.color === true ? true : undefined;
  const color =
    colorFlag ?? (ctx.env.NO_COLOR === undefined && ctx.env.FORCE_COLOR !== "0" && ctx.isTTY);

  const options: CheckOptions = {
    css: cssFlags.length > 0 ? cssFlags : (config.css ?? []),
    html: htmlFlags.length > 0 ? htmlFlags : (config.html ?? []),
    format:
      raw.format !== undefined ? parseFormat(raw.format, "--format") : (config.format ?? "human"),
    ignore: [...(config.ignore ?? []), ...splitList(raw.ignore).map(toPattern)],
    allow: [...(config.allow ?? []), ...splitList(raw.allow).map(toPattern)],
    useDefaultIgnore: config.useDefaultIgnore ?? true,
    strictParse: raw["strict-parse"] ?? config.strictParse ?? false,
    failOnDynamic: raw["fail-on-dynamic"] ?? config.failOnDynamic ?? false,
    color,
  };
  if (configPath !== undefined) options.config = configPath;
  const baseline = raw.baseline ?? config.baseline;
  if (baseline !== undefined) options.baseline = baseline;
  if (raw.output !== undefined) options.output = raw.output;
  const attrs = attributes.length > 0 ? attributes : config.attributes;
  if (attrs !== undefined) options.attributes = attrs;
  if (maxWarnings !== undefined) options.maxWarnings = maxWarnings;
  return options;
}

/**
 * Apply the baseline file to a report. An explicitly configured baseline must
 * exist; the default path is applied only when present.
 */
export function applyBaselineFile(report: Report, options: CheckOptions, ctx: CliContext): Report {
  const path = options.baseline ?? DEFAULT_BASELINE_PATH;
  const baseline = readBaselineFile(path, ctx.cwd);
  if (!baseline) {
    if (options.baseline !== undefined)
      throw new CliError(`Baseline not found: ${options.baseline}`);
    return report;
  }
  const { findings, suppressed } = applyBaseline(report.findings, baseline);
  return { ...report, findings, baseline: { path, suppressed } };
}

/** Run the audit described by `options` and return the report. */
export async function runAudit(options: CheckOptions, ctx: CliContext): Promise<Report> {
  const [stylesheets, documents] = await Promise.all([
    loadFiles(options.css, ctx.cwd, "css"),
    loadFiles(options.html, ctx.cwd, "html"),
  ]);
  const result = audit({
    stylesheets: stylesheets.map((f) => ({ path: f.path, css: f.content })),
    documents: documents.map((f) => ({ path: f.path, html: f.content })),
    ignore: options.ignore,
    allow: options.allow,
    useDefaultIgnore: options.useDefaultIgnore,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  });
  return { findings: result.findings, warnings: result.warnings, stats: result.stats };
}

/** Render a report in the requested format. */
export function renderReport(report: Report, format: ReportFormat, color: boolean): string {
  switch (format) {
    case "human":
      return formatHuman(report, { color });
    case "json":
      return formatJson(report);
    case "github":
      return formatGithub(report);
    case "sarif":
      return formatSarif(report, { version: readVersion() });
    default:
      throw new CliError(`Unknown format "${String(format)}".`);
  }
}

/** Decide the exit code from the report and options. */
export function exitCodeFor(report: Report, options: CheckOptions): ExitCode {
  const hasMissing = report.findings.some((f) => f.kind === "missing");
  const hasDynamic = report.findings.some((f) => f.kind === "dynamic-suspect");
  if (hasMissing) return EXIT.violations;
  if (hasDynamic && options.failOnDynamic) return EXIT.violations;
  if (options.strictParse && report.warnings.length > 0) return EXIT.violations;
  if (options.maxWarnings !== undefined && report.warnings.length > options.maxWarnings) {
    return EXIT.violations;
  }
  return EXIT.ok;
}

export async function checkCommand(argv: string[], ctx: CliContext): Promise<ExitCode> {
  const parsed = parseCheckArgs(argv);
  if (parsed.help) {
    ctx.stdout.write(CHECK_USAGE);
    return EXIT.ok;
  }
  const options = await resolveCheckOptions(parsed.raw, ctx);
  const report = applyBaselineFile(await runAudit(options, ctx), options, ctx);

  const text = renderReport(report, options.format, options.color && options.output === undefined);
  if (options.output !== undefined) {
    writeOutput(options.output, ctx.cwd, text);
    ctx.stderr.write(`Report written to ${options.output}\n`);
  } else {
    ctx.stdout.write(text);
  }
  return exitCodeFor(report, options);
}
