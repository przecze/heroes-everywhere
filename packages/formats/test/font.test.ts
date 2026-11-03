import assert from "node:assert/strict";
import { test } from "node:test";
import { type BitmapFont, breakText, formatMetric, measureText } from "../src/font.ts";

// Every glyph 1 pixel before, 4 wide, 1 after: 6 pixels a character.
const font: BitmapFont = { height: 8, glyphs: Array.from({ length: 256 }, () => ({ left: 1, width: 4, right: 1, pixels: new Uint8Array(32) })) };

test("glyph advance is left + width + right, braces take no room", () => {
  assert.equal(measureText(font, "abc"), 18);
  assert.equal(measureText(font, "{abc}"), 18);
});

test("lines break at spaces, never inside a word", () => {
  assert.deepEqual(breakText(font, "aa bb cc", 30), ["aa bb", "cc"]);
  assert.deepEqual(breakText(font, "aa bb cc", 29), ["aa", "bb", "cc"]);
  assert.deepEqual(breakText(font, "averyverylongword x", 30), ["averyverylongword", "x"]);
  assert.deepEqual(breakText(font, "{aa bb} cc", 30), ["{aa bb}", "cc"]);
});

test("counts in small boxes: k past four digits, M past four thousands (VCMI's formatMetric)", () => {
  assert.equal(formatMetric(9999), "9999");
  assert.equal(formatMetric(10000), "10k");
  assert.equal(formatMetric(123456), "123k");
  assert.equal(formatMetric(9999999), "9999k");
  assert.equal(formatMetric(12345678), "12M");
  assert.equal(formatMetric(0), "0");
});
