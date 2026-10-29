// Tests for scripts/screen-review/merge-auto-verdicts.mjs (S44, O-450, R3.23): family and lane
// mapping, the analyst plus verifier merge, the digest, the database documents and the failures
// that name their cause. node:test, synthetic data only, run by `pnpm run test:scripts`.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MergeError, dbDocument, familyOf, mergeVerdicts, readFamilies, readManifest, renderDigest, tally } from "./merge-auto-verdicts.mjs";

const families = readFamilies(fileURLToPath(new URL("./rubric/families.json", import.meta.url)));

const analyst = (screen, verdict, extra = {}) => ({ screen, verdict, confidence: "high", reasons: verdict === "no" ? [{ rule: "G3", text: "wall of text", variants: ["dark-390"] }] : [], ...extra });

test("R3.23 familyOf: first matching family wins and every lane in families.json is real", () => {
  assert.deepEqual(familyOf("gallery-range-matrix-ev", families), { family: "range-matrix", lane: "S45" });
  assert.deepEqual(familyOf("gallery-feedback-panel", families), { family: "trainer-feedback", lane: "S46" });
  assert.deepEqual(familyOf("gallery-poker-table-6", families), { family: "gallery-table", lane: "S46" });
  assert.deepEqual(familyOf("home-queue", families), { family: "home-settings", lane: "S47" });
  assert.deepEqual(familyOf("settings-hotkeys", families), { family: "home-settings", lane: "S47" });
  assert.deepEqual(familyOf("placeholder-library", families), { family: "library", lane: "S47" });
  assert.deepEqual(familyOf("ask-answer", families), { family: "ask", lane: "S48" });
  assert.equal(familyOf("something-unmatched", families).lane, "S48");
  for (const f of families.families) assert.ok(families.lanes[f.lane], `${f.id} names lane ${f.lane}`);
});

test("R3.23 mergeVerdicts: a No the verifier upholds stays No, an overturned No becomes Yes with the note", () => {
  const records = mergeVerdicts({
    manifestScreens: ["study-ev", "study-weight", "train-start"],
    analystFiles: [
      { family: "study", lane: "S45", screens: [analyst("study-ev", "no"), analyst("study-weight", "no", { work_items: [6] })] },
      { family: "train", lane: "S46", screens: [analyst("train-start", "yes")] },
    ],
    verifierFiles: [{ family: "study", checks: [{ screen: "study-ev", upheld: true, note: "confirmed in NodeView.tsx" }, { screen: "study-weight", upheld: false, note: "the legend names the lens" }] }],
    families,
  });
  assert.equal(records.length, 3);
  const [ev, weight, train] = records;
  assert.equal(ev.verdict, "no");
  assert.equal(ev.verifier.note, "confirmed in NodeView.tsx");
  assert.equal(weight.verdict, "yes");
  assert.equal(weight.analyst_verdict, "no");
  assert.deepEqual(weight.work_items, [6]);
  assert.equal(train.verdict, "yes");
  assert.equal(train.verifier, null);
  assert.equal(train.lane, "S46");
  const t = tally(records);
  assert.deepEqual(t, { yes: 2, no: 1, perLane: { S45: { yes: 1, no: 1, overturned: 1 }, S46: { yes: 1, no: 0, overturned: 0 } } });
});

test("R3.23 mergeVerdicts: failures name the screen", () => {
  const base = { manifestScreens: ["study-ev", "study-weight"], verifierFiles: [], families };
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [analyst("study-ev", "yes")] }] }), (e) => e instanceof MergeError && /study-weight/.test(e.message));
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [analyst("study-ev", "yes"), analyst("study-weight", "yes"), analyst("nope", "yes")] }] }), /manifest lacks: nope/);
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [analyst("study-ev", "maybe"), analyst("study-weight", "yes")] }] }), /verdict must be yes or no/);
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [{ screen: "study-ev", verdict: "no", reasons: [] }, analyst("study-weight", "yes")] }] }), /a no needs at least one reason/);
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [analyst("study-ev", "yes"), analyst("study-ev", "yes")] }] }), /twice/);
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: [{ family: "study", screens: [analyst("study-ev", "yes", { work_items: ["6 | matrix"] }), analyst("study-weight", "yes")] }] }), /work_items must be whole numbers/);
  const both = [{ family: "study", screens: [analyst("study-ev", "no"), analyst("study-weight", "yes")] }];
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: both, verifierFiles: [{ checks: [{ screen: "study-ev", upheld: true }] }, { checks: [{ screen: "study-ev", upheld: false }] }] }), /verifier checks a screen twice/);
  assert.throws(() => mergeVerdicts({ ...base, analystFiles: both, verifierFiles: [{ checks: [{ screen: "study-evv", upheld: false }] }] }), /verifier names a screen the manifest lacks/);
  const noted = mergeVerdicts({ ...base, analystFiles: both, verifierFiles: [{ checks: [{ screen: "study-weight", upheld: false, note: "nothing to overturn" }] }] });
  assert.equal(noted[1].verdict, "yes");
  assert.equal(noted[1].analyst_verdict, "yes");
  assert.match(renderDigest(noted, families), /| noted: nothing to overturn |/);
});

test("R3.23 readManifest and readFamilies: boundary files are validated with named errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "screen-review-"));
  writeFileSync(join(dir, "empty.json"), JSON.stringify({ shots: [] }));
  writeFileSync(join(dir, "bad-shot.json"), JSON.stringify({ shots: [{ screen: "Study EV", file: "x.png" }] }));
  writeFileSync(join(dir, "no-file.json"), JSON.stringify({ shots: [{ screen: "study-ev" }] }));
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ generated: "2026-10-29T10:00:00.000Z", shots: [{ screen: "study-ev", file: "C:\\s\\study-ev-dark-desktop.png" }] }));
  writeFileSync(join(dir, "fam.json"), JSON.stringify({ lanes: { S1: { title: "one" } }, families: [{ id: "a", match: "^a", lane: "S9" }] }));
  assert.throws(() => readManifest(join(dir, "empty.json")), (e) => e instanceof MergeError && /no shots list/.test(e.message));
  assert.throws(() => readManifest(join(dir, "bad-shot.json")), /no valid screen name/);
  assert.throws(() => readManifest(join(dir, "no-file.json")), /has no file/);
  assert.throws(() => readManifest(join(dir, "nope.json")), /not readable JSON/);
  assert.equal(readManifest(join(dir, "ok.json")).generated, "2026-10-29T10:00:00.000Z");
  assert.throws(() => readFamilies(join(dir, "fam.json")), /a lane listed under lanes/);
});

test("R3.23 renderDigest and dbDocument: a table per lane with a tally, and one document per screen", () => {
  const records = mergeVerdicts({
    manifestScreens: ["drills-builder-new", "study-ev"],
    analystFiles: [{ family: "drills", screens: [analyst("drills-builder-new", "no", { fix_hint: "one page per section | keep the save bar" })] }, { family: "study", screens: [analyst("study-ev", "yes")] }],
    verifierFiles: [],
    families,
  });
  const digest = renderDigest(records, families, { round: "3", generated: "2026-10-29T10:00:00.000Z" });
  assert.match(digest, /^# Automated screen review, round 3/);
  assert.match(digest, /Tally: 1 Yes, 1 No/);
  assert.match(digest, /## S45 Study browser: 1 Yes, 0 No/);
  assert.match(digest, /## S47 Drills, progress and shell: 0 Yes, 1 No/);
  assert.match(digest, /\| 01 \| drills-builder-new \| No \| G3: wall of text \|/);
  assert.doesNotMatch(digest, /## S46/);
  const doc = dbDocument(records[0], "2026-10-29T10:00:00.000Z");
  assert.equal(doc.screen, "drills-builder-new");
  assert.equal(doc.verdict, "no");
  assert.equal(doc.lane, "S47");
  assert.deepEqual(doc.reasons, [{ rule: "G3", text: "wall of text", variants: ["dark-390"] }]);
  assert.equal(doc.overturned, false);
  assert.equal(doc.fix_hint, "one page per section | keep the save bar");
});
