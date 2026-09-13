import { describe, expect, it } from "vitest";
import {
  classNameFromSelector,
  normalizeClassName,
  normalizeCondition,
  splitClassList,
  unescapeCssIdentifier,
} from "../../src/core/normalize.js";

describe("unescapeCssIdentifier", () => {
  it.each([
    ["md\\:p-4", "md:p-4"],
    ["w-1\\/2", "w-1/2"],
    ["bg-\\[\\#fff\\]", "bg-[#fff]"],
    ["p-\\[calc\\(1rem\\+2px\\)\\]", "p-[calc(1rem+2px)]"],
    ["\\32xl\\:flex", "2xl:flex"],
    ["\\32 xl\\:flex", "2xl:flex"],
    ["\\@max-md\\:flex", "@max-md:flex"],
    ["\\!text-red-500", "!text-red-500"],
    ["text-red-500\\!", "text-red-500!"],
    ["data-\\[state\\=open\\]\\:flex", "data-[state=open]:flex"],
    ["md\\:\\[\\&\\>\\*\\]\\:p-2", "md:[&>*]:p-2"],
    ["before\\:content-\\[\\'\\'\\]", "before:content-['']"],
    ["w-\\(--sidebar-width\\)", "w-(--sidebar-width)"],
    ["plain", "plain"],
  ])("decodes %s → %s", (input, expected) => {
    expect(unescapeCssIdentifier(input)).toBe(expected);
  });

  it("consumes at most six hex digits", () => {
    expect(unescapeCssIdentifier("\\0000411")).toBe("A1");
  });

  it("treats a single whitespace after a hex escape as a terminator", () => {
    expect(unescapeCssIdentifier("\\31 0-col")).toBe("10-col");
    expect(unescapeCssIdentifier("\\31\t0")).toBe("10");
    expect(unescapeCssIdentifier("\\31\r\n0")).toBe("10");
    expect(unescapeCssIdentifier("\\31  0")).toBe("1 0");
  });

  it("decodes astral code points and keeps surrogate pairs", () => {
    expect(unescapeCssIdentifier("emoji\\1F600")).toBe("emoji😀");
    expect(unescapeCssIdentifier("a\\😀b")).toBe("a😀b");
  });

  it("replaces invalid code points with U+FFFD", () => {
    expect(unescapeCssIdentifier("\\0")).toBe("\uFFFD");
    expect(unescapeCssIdentifier("\\d800")).toBe("\uFFFD");
    expect(unescapeCssIdentifier("\\110000")).toBe("\uFFFD");
    expect(unescapeCssIdentifier("trailing\\")).toBe("trailing\uFFFD");
  });

  it("drops a backslash before a newline", () => {
    expect(unescapeCssIdentifier("a\\\nb")).toBe("ab");
    expect(unescapeCssIdentifier("a\\\r\nb")).toBe("ab");
    expect(unescapeCssIdentifier("a\\\rb")).toBe("ab");
    expect(unescapeCssIdentifier("a\\\fb")).toBe("ab");
  });

  it("decodes an escaped backslash to a literal backslash", () => {
    expect(unescapeCssIdentifier("a\\\\b")).toBe("a\\b");
  });
});

describe("normalizeClassName / classNameFromSelector", () => {
  it("applies NFC normalisation to both sides", () => {
    const decomposed = "caf\u0065\u0301";
    expect(normalizeClassName(decomposed)).toBe("caf\u00e9");
    expect(classNameFromSelector(decomposed)).toBe("caf\u00e9");
  });

  it("unescapes only on the selector side", () => {
    expect(normalizeClassName("md\\:p-4")).toBe("md\\:p-4");
    expect(classNameFromSelector("md\\:p-4")).toBe("md:p-4");
  });
});

describe("splitClassList", () => {
  it("splits on ASCII whitespace including newlines and form feeds", () => {
    expect(splitClassList("  a\tb\nc\fd\r\ne  ")).toEqual(["a", "b", "c", "d", "e"]);
    expect(splitClassList("")).toEqual([]);
  });
});

describe("normalizeCondition", () => {
  it("equates min-width with range syntax", () => {
    expect(normalizeCondition("(min-width: 48rem)")).toBe(normalizeCondition("(width >= 48rem)"));
    expect(normalizeCondition("(max-width: 48rem)")).toBe(normalizeCondition("(width<=48rem)"));
    expect(normalizeCondition("(48rem <= width)")).toBe(normalizeCondition("(width >= 48rem)"));
    expect(normalizeCondition("(48rem > width)")).toBe(normalizeCondition("(width < 48rem)"));
  });

  it("normalises whitespace, case and a leading @media", () => {
    expect(normalizeCondition("@media   (HOVER:hover)")).toBe("(hover: hover)");
    expect(normalizeCondition("( width >= 48rem )")).toBe("(width >= 48rem)");
  });

  it("keeps different units distinct", () => {
    expect(normalizeCondition("(min-width: 768px)")).not.toBe(
      normalizeCondition("(width >= 48rem)"),
    );
  });

  it("leaves feature-to-feature comparisons alone", () => {
    expect(normalizeCondition("(width > height)")).toBe("(width > height)");
  });
});
