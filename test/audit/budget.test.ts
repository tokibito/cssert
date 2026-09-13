import { describe, expect, it } from "vitest";
import {
  compareBudget,
  measureStylesheets,
  parseBudgetSnapshot,
  parseMaxDrop,
  serializeBudgetSnapshot,
} from "../../src/audit/budget.js";

const now = new Date("2026-09-13T00:00:00.000Z");

describe("measureStylesheets", () => {
  it("counts distinct classes across files and records sizes", () => {
    const snapshot = measureStylesheets(
      [
        { path: "b.css", css: ".a {} .b {} .c:hover .a {}" },
        { path: "a.css", css: ".a {} .d {}" },
      ],
      now,
    );
    expect(Object.keys(snapshot.files)).toEqual(["a.css", "b.css"]);
    expect(snapshot.files["a.css"]?.classes).toBe(2);
    expect(snapshot.files["b.css"]?.classes).toBe(3);
    expect(snapshot.total.classes).toBe(4);
    expect(snapshot.total.bytes).toBe(
      Buffer.byteLength(".a {} .b {} .c:hover .a {}") + Buffer.byteLength(".a {} .d {}"),
    );
    expect(snapshot.total.gzipBytes).toBeGreaterThan(0);
    expect(snapshot.createdAt).toBe(now.toISOString());
  });
});

describe("compareBudget", () => {
  const previous = measureStylesheets(
    [{ path: "a.css", css: ".a {} .b {} .c {} .d {} .e {} .f {} .g {} .h {} .i {} .j {}" }],
    now,
  );

  it("passes when nothing shrank beyond the allowed percentage", () => {
    const same = compareBudget(previous, previous);
    expect(same.ok).toBe(true);
    expect(same.deltas.map((d) => d.violation)).toEqual([false, false, false]);

    const grown = measureStylesheets(
      [
        {
          path: "a.css",
          css: ".a {} .b {} .c {} .d {} .e {} .f {} .g {} .h {} .i {} .j {} .k {} .l {}",
        },
      ],
      now,
    );
    expect(compareBudget(previous, grown).ok).toBe(true);
  });

  it("fails when the class count drops more than allowed", () => {
    const shrunk = measureStylesheets([{ path: "a.css", css: ".a {} .b {}" }], now);
    const result = compareBudget(previous, shrunk, { percent: 10 });
    expect(result.ok).toBe(false);
    const classes = result.deltas.find((d) => d.metric === "classes");
    expect(classes).toMatchObject({
      previous: 10,
      current: 2,
      drop: 8,
      dropPercent: 80,
      violation: true,
    });
    expect(compareBudget(previous, shrunk, { percent: 90 }).deltas[0]?.violation).toBe(false);
    expect(compareBudget(previous, shrunk, { absolute: 7 }).deltas[0]?.violation).toBe(true);
    expect(compareBudget(previous, shrunk, { absolute: 8 }).deltas[0]?.violation).toBe(false);
  });

  it("never flags the raw byte size and reports file changes", () => {
    const moved = measureStylesheets(
      [{ path: "b.css", css: ".a {} .b {} .c {} .d {} .e {} .f {} .g {} .h {} .i {} .j {}" }],
      now,
    );
    const result = compareBudget(previous, moved);
    expect(result.removedFiles).toEqual(["a.css"]);
    expect(result.addedFiles).toEqual(["b.css"]);
    expect(result.deltas.find((d) => d.metric === "bytes")?.violation).toBe(false);
  });

  it("handles an empty previous snapshot", () => {
    const empty = measureStylesheets([], now);
    const result = compareBudget(empty, previous);
    expect(result.ok).toBe(true);
    expect(result.deltas[0]?.dropPercent).toBe(0);
  });
});

describe("parseMaxDrop / parseBudgetSnapshot", () => {
  it("parses percentages and absolute counts", () => {
    expect(parseMaxDrop("10%")).toEqual({ percent: 10 });
    expect(parseMaxDrop(" 2.5 % ")).toEqual({ percent: 2.5 });
    expect(parseMaxDrop("25")).toEqual({ absolute: 25 });
    expect(parseMaxDrop("abc")).toBeUndefined();
    expect(parseMaxDrop("-5%")).toBeUndefined();
  });

  it("validates snapshots", () => {
    const snapshot = measureStylesheets([{ path: "a.css", css: ".a {}" }], now);
    expect(parseBudgetSnapshot(JSON.parse(serializeBudgetSnapshot(snapshot)))).toEqual({
      snapshot,
    });
    expect(parseBudgetSnapshot(null)).toHaveProperty("error");
    expect(parseBudgetSnapshot({ version: 2 })).toHaveProperty("error");
    expect(parseBudgetSnapshot({ version: 1, total: {} })).toHaveProperty("error");
    expect(parseBudgetSnapshot({ version: 1, total: snapshot.total, files: [] })).toHaveProperty(
      "error",
    );
    expect(
      parseBudgetSnapshot({ version: 1, total: snapshot.total, files: { x: {} } }),
    ).toHaveProperty("error");
    expect(parseBudgetSnapshot({ version: 1, total: snapshot.total })).toEqual({
      snapshot: {
        version: 1,
        createdAt: "1970-01-01T00:00:00.000Z",
        total: snapshot.total,
        files: {},
      },
    });
  });
});
