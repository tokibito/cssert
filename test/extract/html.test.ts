import { describe, expect, it } from "vitest";
import { extractClasses, extractClassesFromHtml, isDynamicToken } from "../../src/extract/html.js";

const occ = (m: Map<string, { line: number; column: number }[]>, key: string) => m.get(key);

describe("extractClassesFromHtml", () => {
  it("handles > inside values, single quotes, extra whitespace and newlines", () => {
    const html = `<div class="a  >  b\n\tc"><span class='d'>x</span><p class=e></p></div>`;
    const classes = extractClassesFromHtml(html);
    expect([...classes.keys()]).toEqual(["a", ">", "b", "c", "d", "e"]);
    expect(occ(classes, "a")).toEqual([{ line: 1, column: 13 }]);
    expect(occ(classes, "b")).toEqual([{ line: 1, column: 19 }]);
    expect(occ(classes, "c")).toEqual([{ line: 2, column: 2 }]);
    expect(occ(classes, "d")).toEqual([{ line: 2, column: 18 }]);
    expect(occ(classes, "e")).toEqual([{ line: 2, column: 38 }]);
  });

  it("is case-insensitive for the attribute name and records every occurrence", () => {
    const html = `<a CLASS="x"></a>\n<b Class="x y"></b>`;
    const classes = extractClassesFromHtml(html);
    expect(occ(classes, "x")).toEqual([
      { line: 1, column: 11 },
      { line: 2, column: 11 },
    ]);
    expect(occ(classes, "y")).toEqual([{ line: 2, column: 13 }]);
  });

  it("reads classes on html/body, inside <template> and on SVG", () => {
    const html = `<html class="h"><body class="b"><template><i class="t"></i></template><svg class="s"></svg></body></html>`;
    expect([...extractClassesFromHtml(html).keys()].sort()).toEqual(["b", "h", "s", "t"]);
  });

  it("decodes entities and falls back to the attribute position for offsets", () => {
    const html = `<p class="a &amp; b">`;
    const classes = extractClassesFromHtml(html);
    expect([...classes.keys()]).toEqual(["a", "&", "b"]);
    expect(occ(classes, "b")).toEqual([{ line: 1, column: 4 }]);
  });

  it("ignores other attributes by default and scans configured ones", () => {
    const html = `<p class="a" data-class="b" className="c">`;
    expect([...extractClassesFromHtml(html).keys()]).toEqual(["a"]);
    expect([
      ...extractClassesFromHtml(html, {
        attributes: ["class", "className", "data-class"],
      }).keys(),
    ]).toEqual(["a", "b", "c"]);
  });

  it("reads string literals from expression attributes such as :class", () => {
    const html = `<div :class="{ 'bg-red-500 text-white': isError, &quot;p-2&quot;: true }" x-bind:class="cond ? 'a' : 'b c'"></div>`;
    const classes = extractClassesFromHtml(html, { attributes: [":class", "x-bind:class"] });
    expect([...classes.keys()]).toEqual(["bg-red-500", "text-white", "p-2", "a", "b", "c"]);
    expect(occ(classes, "a")).toEqual([{ line: 1, column: 97 }]);
  });

  it("keeps offsets for literal-only expression values", () => {
    const html = `<div :class="{ 'bg-red-500 text-white': isError }"></div>`;
    const classes = extractClassesFromHtml(html, { attributes: [":class"] });
    expect(occ(classes, "text-white")).toEqual([{ line: 1, column: 28 }]);
  });

  it("falls back to plain splitting for expression attributes without literals", () => {
    const html = `<div :class="foo bar"></div>`;
    expect([...extractClassesFromHtml(html, { attributes: [":class"] }).keys()]).toEqual([
      "foo",
      "bar",
    ]);
  });

  it("ignores unterminated string literals", () => {
    const html = `<div :class="'a' + 'b"></div>`;
    expect([...extractClassesFromHtml(html, { attributes: [":class"] }).keys()]).toEqual(["a"]);
  });

  it("applies ignore patterns and strings", () => {
    const html = `<p class="js-toggle keep legacy">`;
    expect([...extractClassesFromHtml(html, { ignore: [/^js-/, "legacy"] }).keys()]).toEqual([
      "keep",
    ]);
  });

  it("NFC-normalises class names", () => {
    const classes = extractClassesFromHtml(`<p class="cafe\u0301">`);
    expect(classes.has("caf\u00e9")).toBe(true);
  });

  it("returns an empty map for markup without classes", () => {
    expect(extractClassesFromHtml("<p>hello</p>").size).toBe(0);
    expect(extractClassesFromHtml("").size).toBe(0);
    expect(extractClassesFromHtml(`<p class="">`).size).toBe(0);
    expect(extractClassesFromHtml(`<p class>`).size).toBe(0);
  });
});

describe("dynamic token detection", () => {
  it("separates template-syntax tokens and keeps them whole", () => {
    const html = `<p class="btn text-{{ color }} {% if x %}active{% endif %} \${size} <%= cls %> {!! raw !!} <?php echo $c ?> {# c #}">`;
    const { classes, dynamic } = extractClasses(html);
    expect([...classes.keys()]).toEqual(["btn"]);
    expect([...dynamic.keys()]).toEqual([
      "text-{{ color }}",
      "{% if x %}active{% endif %}",
      "${size}",
      "<%= cls %>",
      "{!! raw !!}",
      "<?php echo $c ?>",
      "{# c #}",
    ]);
    expect(dynamic.get("text-{{ color }}")).toEqual([{ line: 1, column: 15 }]);
  });

  it("handles template syntax inside expression attributes", () => {
    const html = "<p :class=\"cond ? `x-${y}` : 'a'\">";
    const { classes, dynamic } = extractClasses(html, { attributes: [":class"] });
    expect([...classes.keys()]).toEqual(["a"]);
    expect([...dynamic.keys()]).toEqual(["x-${y}"]);
  });

  it("applies ignore patterns to dynamic tokens too", () => {
    const { dynamic } = extractClasses(`<p class="{{ a }} {{ b }}">`, { ignore: [/a/] });
    expect([...dynamic.keys()]).toEqual(["{{ b }}"]);
  });

  it("exposes isDynamicToken", () => {
    expect(isDynamicToken("text-{{ c }}")).toBe(true);
    expect(isDynamicToken("plain")).toBe(false);
    expect(isDynamicToken("{{")).toBe(false);
  });
});
