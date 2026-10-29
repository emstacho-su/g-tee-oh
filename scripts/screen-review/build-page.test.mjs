// Tests for scripts/screen-review/build-page.mjs (S44, O-450, R3.23): the earlier-round lookup
// with renames, grouping by lane, the critic block data, and the rendered page's placeholders.
// node:test, synthetic data only, run by `pnpm run test:scripts`.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildGroups, earlierName, main, previousOf, readAuto, renderHtml, titleOf } from "./build-page.mjs";

const families = JSON.parse(readFileSync(fileURLToPath(new URL("./rubric/families.json", import.meta.url)), "utf8"));
const template = readFileSync(fileURLToPath(new URL("./page-template.html", import.meta.url)), "utf8");

const shot = (screen, theme, width, criterion = "R3.12 a criterion") => ({ screen, theme, width, height: 900, file: `C:\\shots\\${screen}-${theme}-${width === 1440 ? "desktop" : "phone"}.png`, criterion, source: "mock" });
const manifest = {
  sessions: ["S39"],
  generated: "2026-10-29T10:00:00.000Z",
  directory: "C:\\shots",
  shots: ["study-ev", "train-start", "drills-builder-new", "ask-answer"].flatMap((s) => [shot(s, "dark", 1440), shot(s, "light", 1440), shot(s, "dark", 390), shot(s, "light", 390)]),
};

test("R3.23 earlierName and previousOf: renames attach the earlier verdict, new screens are marked new", () => {
  assert.equal(earlierName("quiz-hand-action"), "predict-hand-action");
  assert.equal(earlierName("gallery-roll-scale"), "gallery-roll-badge");
  assert.equal(earlierName("study-ev"), "study-ev");
  const previous = new Map([["study-ev", { verdict: "no", note: " options first " }], ["predict-hand-action", { verdict: null, note: "a note" }]]);
  const screens = new Set(["study-ev", "predict-hand-action", "train-start"]);
  assert.deepEqual(previousOf("study-ev", previous, screens), { kind: "no", note: "options first" });
  assert.deepEqual(previousOf("quiz-hand-action", previous, screens), { kind: "note", note: "a note" });
  assert.deepEqual(previousOf("train-start", previous, screens), { kind: "unanswered" });
  assert.deepEqual(previousOf("brand-new", previous, screens), { kind: "new" });
  assert.deepEqual(previousOf("train-start", previous, new Set()), { kind: "new" });
  assert.equal(titleOf("drills-builder-new"), "Drills builder new");
});

test("R3.23 buildGroups: one group per lane in families order, numbered through, with files per variant and the critic's record", () => {
  const auto = new Map([["study-ev", { verdict: "no", confidence: "high", reasons: [{ rule: "R2", text: "lens unnamed", variants: ["dark-1440"] }], work_items: [6], fix_hint: "", verifier: null, overturned: false }]]);
  const groups = buildGroups(manifest, { families, auto });
  assert.deepEqual(groups.map((g) => g.session), ["S45", "S46", "S47", "S48"]);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.n)), [["01"], ["02"], ["03"], ["04"]]);
  const ev = groups[0].items[0];
  assert.equal(ev.id, "r001");
  assert.deepEqual(ev.files, { "dark-1440": "study-ev-dark-desktop.png", "light-1440": "study-ev-light-desktop.png", "dark-390": "study-ev-dark-phone.png", "light-390": "study-ev-light-phone.png" });
  assert.equal(ev.auto.verdict, "no");
  assert.deepEqual(ev.previous, { kind: "new" });
  assert.equal(groups[1].items[0].auto, null);
});

test("R3.23 renderHtml: every placeholder is filled and the critic sentence counts reviewed screens", () => {
  const auto = new Map([["study-ev", { verdict: "yes", confidence: "medium", reasons: [], work_items: [], fix_hint: "", verifier: null, overturned: false }]]);
  const html = renderHtml(template, buildGroups(manifest, { families, auto }), { round: "3", generated: manifest.generated, title: "Screen Review Three" });
  assert.doesNotMatch(html, /__(GROUPS|TOTAL|ROUND|TITLE|CRITIC|GENERATED)__/);
  assert.match(html, /<title>Screen Review Three<\/title>/);
  assert.match(html, /round 3/);
  assert.match(html, /The critic reviewed 1 of 4 screens/);
  assert.match(html, /2026-10-29 10:00 UTC/);
  assert.match(html, /"screen":"study-ev"/);
});

test("R3.23 main: writes index.html and files.json from a manifest and an auto-verdicts file", () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-review-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "auto.json"), JSON.stringify({ records: [{ screen: "study-ev", verdict: "yes", analyst_verdict: "no", confidence: "low", reasons: [], work_items: [], fix_hint: "", verifier: { upheld: false, note: "mock artefact" } }] }));
  const summary = main(["--manifest", join(dir, "manifest.json"), "--out", join(dir, "out"), "--auto", join(dir, "auto.json"), "--round", "3"]);
  assert.equal(summary, "screens 4, files 16, groups S45:1 S46:1 S47:1 S48:1");
  const files = JSON.parse(readFileSync(join(dir, "out", "files.json"), "utf8"));
  assert.equal(files.length, 16);
  assert.ok(files.includes("ask-answer-light-phone.png"));
  const html = readFileSync(join(dir, "out", "index.html"), "utf8");
  assert.match(html, /"overturned":true/);
  assert.equal(readAuto(join(dir, "auto.json")).get("study-ev").overturned, true);
  assert.throws(() => main(["--manifest", join(dir, "manifest.json")]), /--manifest and --out are required/);
});
