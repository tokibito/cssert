import { gzipSync } from "node:zlib";
import { loadStylesheet } from "../core/query.js";

export interface BudgetMetrics {
  /** Distinct class names (any selector role). */
  classes: number;
  /** Size in bytes (UTF-8). */
  bytes: number;
  /** Size in bytes after gzip (default level). */
  gzipBytes: number;
}

/** Snapshot of stylesheet metrics used as a regression guard. */
export interface BudgetSnapshot {
  version: 1;
  createdAt: string;
  total: BudgetMetrics;
  files: Record<string, BudgetMetrics>;
}

/** Allowed shrinkage before the budget fails. Either a percentage or an absolute count. */
export interface MaxDrop {
  percent?: number;
  absolute?: number;
}

export interface BudgetDelta {
  metric: keyof BudgetMetrics;
  previous: number;
  current: number;
  /** Positive when the value shrank. */
  drop: number;
  /** Percentage of `previous` that was lost; 0 when previous is 0. */
  dropPercent: number;
  /** Whether this delta exceeds the allowed drop. */
  violation: boolean;
}

export interface BudgetComparison {
  ok: boolean;
  deltas: BudgetDelta[];
  /** Files present in the snapshot but not in the current build. */
  removedFiles: string[];
  /** Files present now but not in the snapshot. */
  addedFiles: string[];
}

/** Measure built stylesheets. Class counts use the same parser as `check`. */
export function measureStylesheets(
  stylesheets: readonly { path: string; css: string }[],
  now: Date = new Date(),
): BudgetSnapshot {
  const files: Record<string, BudgetMetrics> = {};
  const allClasses = new Set<string>();
  let bytes = 0;
  let gzipBytes = 0;
  for (const sheet of [...stylesheets].sort((a, b) => a.path.localeCompare(b.path))) {
    const model = loadStylesheet(sheet.css, { path: sheet.path });
    const buf = Buffer.from(sheet.css, "utf8");
    const metrics: BudgetMetrics = {
      classes: model.classes().size,
      bytes: buf.byteLength,
      gzipBytes: gzipSync(buf).byteLength,
    };
    for (const c of model.classes()) allClasses.add(c);
    bytes += metrics.bytes;
    gzipBytes += metrics.gzipBytes;
    files[sheet.path] = metrics;
  }
  return {
    version: 1,
    createdAt: now.toISOString(),
    total: { classes: allClasses.size, bytes, gzipBytes },
    files,
  };
}

/**
 * Compare a current measurement against a snapshot. Only shrinkage counts;
 * growth never fails. `classes` and `gzipBytes` are checked against
 * `maxDrop` (`absolute` applies to classes only).
 */
export function compareBudget(
  previous: BudgetSnapshot,
  current: BudgetSnapshot,
  maxDrop: MaxDrop = { percent: 10 },
): BudgetComparison {
  const deltas: BudgetDelta[] = (["classes", "gzipBytes", "bytes"] as const).map((metric) => {
    const prev = previous.total[metric];
    const cur = current.total[metric];
    const drop = Math.max(0, prev - cur);
    const dropPercent = prev === 0 ? 0 : (drop / prev) * 100;
    let violation = false;
    if (metric !== "bytes" && drop > 0) {
      if (maxDrop.percent !== undefined && dropPercent > maxDrop.percent) violation = true;
      if (metric === "classes" && maxDrop.absolute !== undefined && drop > maxDrop.absolute) {
        violation = true;
      }
    }
    return { metric, previous: prev, current: cur, drop, dropPercent, violation };
  });
  const prevFiles = Object.keys(previous.files);
  const curFiles = Object.keys(current.files);
  return {
    ok: deltas.every((d) => !d.violation),
    deltas,
    removedFiles: prevFiles.filter((f) => !(f in current.files)).sort(),
    addedFiles: curFiles.filter((f) => !(f in previous.files)).sort(),
  };
}

/** Parse `10%` or `25` into a {@link MaxDrop}. Returns undefined for invalid input. */
export function parseMaxDrop(value: string): MaxDrop | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(%?)\s*$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === "%" ? { percent: n } : { absolute: n };
}

/** Validate a parsed JSON value as a snapshot. */
export function parseBudgetSnapshot(
  value: unknown,
): { snapshot: BudgetSnapshot } | { error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "snapshot must be an object" };
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1) return { error: `unsupported snapshot version ${String(obj.version)}` };
  const total = readMetrics(obj.total);
  if (!total) return { error: '"total" must contain numeric classes, bytes and gzipBytes' };
  const files: Record<string, BudgetMetrics> = {};
  if (obj.files !== undefined) {
    if (obj.files === null || typeof obj.files !== "object" || Array.isArray(obj.files)) {
      return { error: '"files" must be an object' };
    }
    for (const [path, raw] of Object.entries(obj.files as Record<string, unknown>)) {
      const metrics = readMetrics(raw);
      if (!metrics) return { error: `"files.${path}" must contain numeric metrics` };
      files[path] = metrics;
    }
  }
  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt : new Date(0).toISOString();
  return { snapshot: { version: 1, createdAt, total, files } };
}

function readMetrics(value: unknown): BudgetMetrics | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const m = value as Record<string, unknown>;
  if (
    typeof m.classes !== "number" ||
    typeof m.bytes !== "number" ||
    typeof m.gzipBytes !== "number"
  ) {
    return undefined;
  }
  return { classes: m.classes, bytes: m.bytes, gzipBytes: m.gzipBytes };
}

export function serializeBudgetSnapshot(snapshot: BudgetSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
