// Tests for scripts/screen-review/delta.mjs (S48, O-450, R3.23): the transition kinds, the per-lane
// tally, the rendered digest and the failures that name their cause. node:test, synthetic data only.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DeltaError, kindOf, readVerdicts, renderDelta, tallyByLane, transitions } from "./delta.mjs";

const record = (screen, lane, verdict, text = "") => ({ screen, family: "f", lane, verdict, reasons: verdict === "no" ? [{ rule: "G3", text: text || `${screen} fails`, variants: ["dark-1440"] }] : [] });

const previous = {
  round: "3",
  generated: "2026-10-29T14:55:44.524Z",
  records: [record("study-ev", "S45", "no"), record("study-weight", "S45", "no"), record("train-start", "S46", "yes"), record("train-recap", "S46", "no"), record("old-screen", "S47", "yes")],
};
const current = {
  round: "4",
  generated: "2026-11-04T22:00:00.000Z",
  records: [record("study-ev", "S45", "yes"), record("study-weight", "S45", "no", "still clipped"), record("train-start", "S46", "no", "a new fault"), record("train-recap", "S46", "no"), record("brand-new", "S47", "no", "fresh"), record("brand-new-ok", "S47", "yes")],
};

test("R3.23 kindOf: the six transitions and the empty pair that cannot exist", () => {
  assert.equal(kindOf("no", "yes"), "fixed");
  assert.equal(kindOf("yes", "no"), "regressed");
  assert.equal(kindOf("no", "no"), "still-no");
  assert.equal(kindOf("yes", "yes"), "still-yes");
  assert.equal(kindOf(null, "no"), "new");
  assert.equal(kindOf("yes", null), "gone");
  assert.throws(() => kindOf(null, null), DeltaError);
});

test("R3.23 transitions: one row per screen of either round, sorted, with the current reason on a No", () => {
  const rows = transitions(previous, current);
  assert.deepEqual(rows.map((r) => r.screen), ["brand-new", "brand-new-ok", "old-screen", "study-ev", "study-weight", "train-recap", "train-start"]);
  const byScreen = Object.fromEntries(rows.map((r) => [r.screen, r]));
  assert.equal(byScreen["study-ev"].kind, "fixed");
  assert.equal(byScreen["study-ev"].reason, "");
  assert.equal(byScreen["train-start"].kind, "regressed");
  assert.equal(byScreen["train-start"].reason, "G3: a new fault");
  assert.equal(byScreen["brand-new"].kind, "new");
  assert.equal(byScreen["old-screen"].kind, "gone");
  assert.equal(byScreen["old-screen"].lane, "S47");
  assert.equal(byScreen["study-weight"].kind, "still-no");
});

test("R3.23 tallyByLane: No before and after per lane with the transition counts", () => {
  const tally = tallyByLane(transitions(previous, current));
  assert.deepEqual(tally.map((t) => [t.lane, t.before_no, t.after_no, t.fixed, t.regressed, t.new, t.gone]), [
    ["S45", 2, 1, 1, 0, 0, 0],
    ["S46", 1, 2, 0, 1, 0, 0],
    ["S47", 0, 1, 0, 0, 2, 1],
  ]);
});

test("R3.23 renderDelta: the lane table carries the totals and every regression is listed with its reason", () => {
  const digest = renderDelta(previous, current, transitions(previous, current));
  assert.match(digest, /^# Critic delta: round 3 \(2026-10-29T14:55:44.524Z\) to round 4/);
  assert.match(digest, /\| S45 \| 2 \| 2 \| 2 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(digest, /\| All \| 5 \| 3 \| 6 \| 4 \| 1 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(digest, /## Regressed \(1\)[\s\S]*\| train-start \| S46 \| yes \| no \| G3: a new fault \|/);
  assert.match(digest, /## Fixed \(1\)[\s\S]*\| study-ev \| S45 \| no \| yes \| {2}\|/);
  assert.match(digest, /## Gone \(1\)[\s\S]*\| old-screen \| S47 \| yes \| absent \|/);
  assert.match(digest, /## Still No \(2\)/);
});

test("R3.23 readVerdicts: a file without records or with a malformed record fails naming the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "delta-"));
  const empty = join(dir, "empty.json");
  writeFileSync(empty, JSON.stringify({ round: "4", records: [] }));
  assert.throws(() => readVerdicts(empty), (error) => error instanceof DeltaError && error.message.includes("empty.json"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ round: "4", records: [{ screen: "x", verdict: "maybe" }] }));
  assert.throws(() => readVerdicts(bad), (error) => error instanceof DeltaError && error.message.includes("record 0"));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify(current));
  assert.equal(readVerdicts(good).records.length, 6);
});
