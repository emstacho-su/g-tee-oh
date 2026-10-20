// Text normalization shared by the root scripts (R0.7): every generated file is committed with
// LF line endings and no byte order mark (BOM), whatever a tool emitted on a Windows checkout,
// so the contracts job compares content and never line endings. scripts/contracts.mjs and
// scripts/codegen.mjs both apply it.

/** The byte order mark some Windows tools write first, as its escape so the source stays ASCII. */
export const BOM = "\uFEFF";

/** CRLF turned into LF. A lone CR is left alone: it is content, not a line ending. */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}

/** One leading byte order mark removed. */
export function stripBom(text) {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}
