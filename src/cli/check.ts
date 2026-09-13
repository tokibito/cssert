import { type ParseArgsConfig, parseArgs } from "node:util";
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
import { type PatternSet, type Roots, resolveRoots } from "./roots.js";
import { readVersion } from "./version.js";

export const CHECK_USAGE = `Usage: cssert check [options]

Compare built CSS with HTML and report classes that are missing from the CSS.

Options:
  --css <glob>              Built CSS files (repeatable, comma-separated allowed)
  --html <glob>             HTML documents to check (repeatable)
  --config <path>           Config file (default: cssert.config.{ts,js,mjs,json} in cwd)
  --root <dir>              Base directory for every relative path (default: the
                            config file's directory, or cwd without a config)
  --baseline <path>         Baseline file (default: .cssert/baseline.json when present)
  --no-baseline             Ignore the baseline for this run
  --require-baseline        Fail when the baseline file does not exist
  --format <fmt>            human | json | github | sarif (default: human)
  --annotate-occurrences    github: annotate every usage, not one per class
  --output <path>           Write the report to a file instead of stdout
  --attributes <list>       HTML attributes to scan (default: class)
  --ignore <pattern>        Extra class or /regex/ to ignore (repeatable)
  --allow <pattern>         Class or /regex/ that may be absent from the CSS (repeatable)
  --hook <pattern>          Class that is expected to have no styles (repeatable)
  --strict-parse            Treat CSS parse warnings as errors
  --max-warnings <n>        Fail when parse warnings exceed <n>
  --fail-on-dynamic         Also fail when dynamic-suspect tokens are found
  --min-documents <n>       Fail when fewer than <n> HTML documents were scanned
  --min-stylesheets <n>     Fail when fewer than <n> stylesheets were scanned
  --no-color                Disable colours
  -h, --help                Show this help

Paths written in a config file are relative to that file; paths passed as
flags are relative to the working directory.

Exit codes: 0 no violations, 1 violations, 2 usage/config error, 3 internal error.
`;

/** Where the baseline lives, or `undefined` when baselines are switched off. */
export interface BaselineTarget {
  path: string;
  /** Directory the path is resolved against. */
  base: string;
  /** Whether the user named this path (vs. the implicit default). */
  explicit: boolean;
}

export interface CheckOptions {
  css: PatternSet;
  html: PatternSet;
  roots: Roots;
  config?: string;
  baseline?: BaselineTarget;
  requireBaseline: boolean;
  format: ReportFormat;
  annotateOccurrences: boolean;
  output?: string;
  attributes?: string[];
  ignore: (string | RegExp)[];
  allow: (string | RegExp)[];
  useDefaultIgnore: boolean;
  strictParse: boolean;
  maxWarnings?: number;
  failOnDynamic: boolean;
  minDocuments?: number;
  minStylesheets?: number;
  color: boolean;
}

/** Split repeatable/comma-separated list flags. */
function splitList(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

type OptionConfig = NonNullable<ParseArgsConfig["options"]>;

const CHECK_OPTIONS: OptionConfig = {
  css: { type: "string", multiple: true },
  html: { type: "string", multiple: true },
  config: { type: "string" },
  root: { type: "string" },
  baseline: { type: "string" },
  "no-baseline": { type: "boolean" },
  "require-baseline": { type: "boolean" },
  format: { type: "string" },
  "annotate-occurrences": { type: "boolean" },
  output: { type: "string" },
  attributes: { type: "string", multiple: true },
  ignore: { type: "string", multiple: true },
  allow: { type: "string", multiple: true },
  hook: { type: "string", multiple: true },
  "strict-parse": { type: "boolean" },
  "max-warnings": { type: "string" },
  "fail-on-dynamic": { type: "boolean" },
  "min-documents": { type: "string" },
  "min-stylesheets": { type: "string" },
  "no-color": { type: "boolean" },
  color: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

/**
 * Parse `check`-style arguments. `extra` adds command-specific options
 * (`baseline` has `--kind` and `--dry-run`) without duplicating the list.
 */
export function parseCheckArgs(
  argv: string[],
  extra: OptionConfig = {},
  usage: string = CHECK_USAGE,
): { help: true } | { help: false; raw: RawCheckArgs } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: { ...CHECK_OPTIONS, ...extra },
    });
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${usage}`);
  }
  if (parsed.values.help) return { help: true };
  return { help: false, raw: parsed.values as RawCheckArgs };
}

export interface RawCheckArgs {
  css?: string[];
  html?: string[];
  config?: string;
  root?: string;
  baseline?: string;
  "no-baseline"?: boolean;
  "require-baseline"?: boolean;
  format?: string;
  "annotate-occurrences"?: boolean;
  output?: string;
  attributes?: string[];
  ignore?: string[];
  allow?: string[];
  hook?: string[];
  "strict-parse"?: boolean;
  "max-warnings"?: string;
  "fail-on-dynamic"?: boolean;
  "min-documents"?: string;
  "min-stylesheets"?: string;
  "no-color"?: boolean;
  color?: boolean;
  kind?: string;
  "dry-run"?: boolean;
}

function integerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError(`${flag} must be a non-negative integer (got ${value}).`);
  }
  return n;
}

/** Merge config file values with command-line flags (flags win). */
export async function resolveCheckOptions(
  raw: RawCheckArgs,
  ctx: CliContext,
): Promise<CheckOptions> {
  const configPath = raw.config ?? findConfigFile(ctx.cwd);
  const config: CssertConfig = configPath ? await loadConfigFile(configPath, ctx.cwd) : {};
  const roots = resolveRoots(ctx.cwd, configPath, config, raw.root);

  const cssFlags = splitList(raw.css);
  const htmlFlags = splitList(raw.html);
  const attributes = splitList(raw.attributes);

  const maxWarnings = integerFlag(raw["max-warnings"], "--max-warnings") ?? config.maxWarnings;
  const minDocuments = integerFlag(raw["min-documents"], "--min-documents") ?? config.minDocuments;
  const minStylesheets =
    integerFlag(raw["min-stylesheets"], "--min-stylesheets") ?? config.minStylesheets;

  const colorFlag = raw["no-color"] ? false : raw.color === true ? true : undefined;
  const color =
    colorFlag ?? (ctx.env.NO_COLOR === undefined && ctx.env.FORCE_COLOR !== "0" && ctx.isTTY);

  const options: CheckOptions = {
    css:
      cssFlags.length > 0
        ? { patterns: cssFlags, base: roots.flag }
        : { patterns: config.css ?? [], base: roots.config },
    html:
      htmlFlags.length > 0
        ? { patterns: htmlFlags, base: roots.flag }
        : { patterns: config.html ?? [], base: roots.config },
    roots,
    requireBaseline: raw["require-baseline"] ?? config.requireBaseline ?? false,
    format:
      raw.format !== undefined ? parseFormat(raw.format, "--format") : (config.format ?? "human"),
    annotateOccurrences: raw["annotate-occurrences"] ?? config.annotateOccurrences ?? false,
    ignore: [...(config.ignore ?? []), ...splitList(raw.ignore).map(toPattern)],
    allow: [
      ...(config.allow ?? []),
      ...(config.hooks ?? []),
      ...splitList(raw.allow).map(toPattern),
      ...splitList(raw.hook).map(toPattern),
    ],
    useDefaultIgnore: config.useDefaultIgnore ?? true,
    strictParse: raw["strict-parse"] ?? config.strictParse ?? false,
    failOnDynamic: raw["fail-on-dynamic"] ?? config.failOnDynamic ?? false,
    color,
  };
  if (configPath !== undefined) options.config = configPath;
  const baseline = resolveBaselineTarget(raw, config, roots);
  if (baseline !== undefined) options.baseline = baseline;
  if (options.requireBaseline && baseline === undefined) {
    throw new CliError("--require-baseline cannot be combined with --no-baseline.");
  }
  if (raw.output !== undefined) options.output = raw.output;
  const attrs = attributes.length > 0 ? attributes : config.attributes;
  if (attrs !== undefined) options.attributes = attrs;
  if (maxWarnings !== undefined) options.maxWarnings = maxWarnings;
  if (minDocuments !== undefined) options.minDocuments = minDocuments;
  if (minStylesheets !== undefined) options.minStylesheets = minStylesheets;
  return options;
}

/**
 * Decide which baseline file to use. `--no-baseline` (or an empty path) turns
 * baselines off; a path from the config file is relative to the config, a path
 * from the flag is relative to the working directory.
 */
function resolveBaselineTarget(
  raw: RawCheckArgs,
  config: CssertConfig,
  roots: Roots,
): BaselineTarget | undefined {
  if (raw["no-baseline"] === true) return undefined;
  if (raw.baseline !== undefined) {
    if (raw.baseline === "") return undefined;
    return { path: raw.baseline, base: roots.flag, explicit: true };
  }
  if (config.baseline !== undefined) {
    if (config.baseline === "") return undefined;
    return { path: config.baseline, base: roots.config, explicit: true };
  }
  return { path: DEFAULT_BASELINE_PATH, base: roots.config, explicit: false };
}

/**
 * Apply the baseline file to a report. A baseline that does not exist yet is
 * not an error: writing the config before freezing the findings is the normal
 * order of work. `--require-baseline` makes its absence fatal.
 */
export function applyBaselineFile(report: Report, options: CheckOptions, ctx: CliContext): Report {
  const target = options.baseline;
  if (target === undefined) return report;
  const baseline = readBaselineFile(target.path, target.base);
  if (!baseline) {
    if (options.requireBaseline) throw new CliError(`Baseline not found: ${target.path}`);
    if (target.explicit) {
      ctx.stderr.write(
        `cssert: no baseline at ${target.path}; ` +
          'run "cssert baseline create" to freeze the current findings.\n',
      );
    }
    return report;
  }
  const { findings, suppressed } = applyBaseline(report.findings, baseline);
  return { ...report, findings, baseline: { path: target.path, suppressed } };
}

/** Run the audit described by `options` and return the report. */
export async function runAudit(options: CheckOptions): Promise<Report> {
  const [stylesheets, documents] = await Promise.all([
    loadFiles(options.css, "css"),
    loadFiles(options.html, "html"),
  ]);
  const result = audit({
    stylesheets: stylesheets.map((f) => ({ path: f.path, css: f.content })),
    documents: documents.map((f) => ({ path: f.path, html: f.content, source: f.pattern })),
    ignore: options.ignore,
    allow: options.allow,
    useDefaultIgnore: options.useDefaultIgnore,
    ...(options.attributes ? { attributes: options.attributes } : {}),
  });
  const report: Report = {
    findings: result.findings,
    warnings: result.warnings,
    stats: result.stats,
  };
  const errors = coverageErrors(result.stats, options);
  if (errors.length > 0) report.errors = errors;
  return report;
}

/**
 * Check that enough input actually arrived. A CI job whose artefact download
 * silently produced an empty directory would otherwise report a green run.
 */
export function coverageErrors(
  stats: { documents: number; stylesheets: number },
  options: Pick<CheckOptions, "minDocuments" | "minStylesheets">,
): string[] {
  const errors: string[] = [];
  if (options.minDocuments !== undefined && stats.documents < options.minDocuments) {
    errors.push(
      `Only ${stats.documents} HTML document(s) were scanned; --min-documents requires at least ${options.minDocuments}.`,
    );
  }
  if (options.minStylesheets !== undefined && stats.stylesheets < options.minStylesheets) {
    errors.push(
      `Only ${stats.stylesheets} stylesheet(s) were scanned; --min-stylesheets requires at least ${options.minStylesheets}.`,
    );
  }
  return errors;
}

/** Render a report in the requested format. */
export function renderReport(
  report: Report,
  format: ReportFormat,
  color: boolean,
  annotateOccurrences = false,
): string {
  switch (format) {
    case "human":
      return formatHuman(report, { color });
    case "json":
      return formatJson(report);
    case "github":
      return formatGithub(report, { annotateOccurrences });
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
  if ((report.errors ?? []).length > 0) return EXIT.violations;
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
  const report = applyBaselineFile(await runAudit(options), options, ctx);

  const text = renderReport(
    report,
    options.format,
    options.color && options.output === undefined,
    options.annotateOccurrences,
  );
  if (options.output !== undefined) {
    writeOutput(options.output, options.roots.flag, text);
    ctx.stderr.write(`Report written to ${options.output}\n`);
  } else {
    ctx.stdout.write(text);
  }
  return exitCodeFor(report, options);
}
