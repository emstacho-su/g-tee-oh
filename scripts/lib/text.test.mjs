// Tests for scripts/lib/text.mjs (R0.7): the line ending and byte order mark normalization every
// committed generated file goes through. node:test, run by `pnpm run test:scripts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BOM, normalizeLineEndings, stripBom } from "./text.mjs";

test("r0_7 normalizeLineEndings turns CRLF into LF and leaves LF alone", () => {
  assert.equal(normalizeLineEndings("a\r\nb\r\n"), "a\nb\n");
  assert.equal(normalizeLineEndings("a\nb\n"), "a\nb\n");
  assert.equal(normalizeLineEndings("a\rb"), "a\rb");
  assert.equal(normalizeLineEndings(""), "");
});

test("r0_7 stripBom removes one leading byte order mark and nothing else", () => {
  assert.equal(BOM, "\uFEFF");
  assert.equal(BOM.length, 1);
  assert.equal(stripBom(`${BOM}text`), "text");
  assert.equal(stripBom(`${BOM}${BOM}text`), `${BOM}text`);
  assert.equal(stripBom(`text${BOM}`), `text${BOM}`);
  assert.equal(stripBom("text"), "text");
});
