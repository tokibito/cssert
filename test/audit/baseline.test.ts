import { describe, expect, it } from "vitest";
import {
  applyBaseline,
  createBaseline,
  parseBaseline,
  pruneBaseline,
  serializeBaseline,
} from "../../src/audit/baseline.js";
import type { Finding } from "../../src/audit/derive.js";

const finding = (
  className: string,
  kind: Finding["kind"] = "missing",
  path = "a.html",
): Finding => ({
  className,
  kind,
  occurrences: [{ path, line: 1, column: 1 }],
});

const now = new Date("2026-09-13T00:00:00.000Z");

describe("baseline", () => {
  it("freezes findings by class and kind, sorted and de-duplicated", () => {
    const baseline = createBaseline(
      [
        finding("z"),
        finding("a"),
        finding("z", "missing", "b.html"),
        finding("{{ x }}", "dynamic-suspect"),
      ],
      now,
    );
    expect(baseline).toEqual({
      version: 1,
      createdAt: "2026-09-13T00:00:00.000Z",
      entries: [
        { className: "a", kind: "missing" },
        { className: "z", kind: "missing" },
        { className: "{{ x }}", kind: "dynamic-suspect" },
      ],
    });
  });

  it("suppresses known findings regardless of where they occur", () => {
    const baseline = createBaseline([finding("a")], now);
    const { findings, suppressed } = applyBaseline(
      [finding("a", "missing", "elsewhere.html"), finding("b"), finding("a", "dynamic-suspect")],
      baseline,
    );
    expect(findings.map((f) => `${f.className}/${f.kind}`)).toEqual([
      "b/missing",
      "a/dynamic-suspect",
    ]);
    expect(suppressed).toBe(1);
  });

  it("prunes entries that no longer occur", () => {
    const baseline = createBaseline([finding("a"), finding("b"), finding("c")], now);
    const later = new Date("2026-10-01T00:00:00.000Z");
    const { baseline: pruned, removed } = pruneBaseline(baseline, [finding("b")], later);
    expect(pruned.entries).toEqual([{ className: "b", kind: "missing" }]);
    expect(pruned.createdAt).toBe(later.toISOString());
    expect(removed.map((e) => e.className)).toEqual(["a", "c"]);
  });

  it("round-trips through JSON and validates input", () => {
    const baseline = createBaseline([finding("a")], now);
    const text = serializeBaseline(baseline);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseBaseline(JSON.parse(text))).toEqual({ baseline });

    expect(parseBaseline(null)).toEqual({ error: "baseline must be an object" });
    expect(parseBaseline([])).toHaveProperty("error");
    expect(parseBaseline({ version: 2, entries: [] })).toHaveProperty("error");
    expect(parseBaseline({ version: 1 })).toHaveProperty("error");
    expect(parseBaseline({ version: 1, entries: [null] })).toHaveProperty("error");
    expect(
      parseBaseline({ version: 1, entries: [{ className: 1, kind: "missing" }] }),
    ).toHaveProperty("error");
    expect(
      parseBaseline({ version: 1, entries: [{ className: "a", kind: "nope" }] }),
    ).toHaveProperty("error");
    const noDate = parseBaseline({ version: 1, entries: [{ className: "a", kind: "missing" }] });
    expect(noDate).toMatchObject({ baseline: { createdAt: "1970-01-01T00:00:00.000Z" } });
  });
});
