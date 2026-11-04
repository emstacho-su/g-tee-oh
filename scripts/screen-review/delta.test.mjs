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

test("R3.23 a screen that moved lanes between rounds counts under its old lane before and its new lane after (code review round 1, 7)", () => {
  const moved = {
    before: { round: "3", generated: "a", records: [record("moved", "S46", "no"), record("stays", "S47", "yes")] },
    after: { round: "4", generated: "b", records: [record("moved", "S47", "no", "still"), record("stays", "S47", "yes")] },
  };
  const rows = transitions(moved.before, moved.after);
  const row = rows.find((r) => r.screen === "moved");
  assert.equal(row.lane, "S47");
  assert.equal(row.laneBefore, "S46");
  assert.equal(row.kind, "still-no");
  const tally = tallyByLane(rows);
  assert.deepEqual(tally.map((t) => [t.lane, t.before_screens, t.before_no, t.after_screens, t.after_no, t["still-no"], t["still-yes"]]), [
    ["S46", 1, 1, 0, 0, 0, 0],
    ["S47", 1, 0, 2, 1, 1, 1],
  ]);
  const digest = renderDelta(moved.before, moved.after, rows);
  assert.match(digest, /\| S46 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(digest, /\| S47 \| 1 \| 0 \| 2 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(digest, /\| All \| 2 \| 1 \| 2 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
});

test("R3.23 every digest column is escaped and a reason missing its rule or text falls back to empty (code review round 2, 7)", () => {
  const odd = {
    before: { round: "3", generated: "a", records: [record("pipe|screen", "S4|5", "no")] },
    after: { round: "4", generated: "b", records: [{ screen: "pipe|screen", family: "f|am", lane: "S4|5", verdict: "no", reasons: [{ rule: "G1" }] }] },
  };
  const rows = transitions(odd.before, odd.after);
  assert.equal(rows[0].reason, "");
  const digest = renderDelta(odd.before, odd.after, rows);
  assert.match(digest, /\| S4\\\|5 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(digest, /\| pipe\\\|screen \| S4\\\|5 \| {2}\|/);
  assert.doesNotMatch(digest, /\| pipe\|screen \|/);
});

test("R3.23 tallyByLane counts new_no and new_yes in its one pass, and the digest reads them from the tally (code review round 2, 8)", () => {
  const tally = tallyByLane(transitions(previous, current));
  assert.deepEqual(tally.map((t) => [t.lane, t.new_no, t.new_yes]), [
    ["S45", 0, 0],
    ["S46", 0, 0],
    ["S47", 1, 1],
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

test("R3.23 readVerdicts: two records for one screen fail naming the file and the screen (code review round 3, 5)", () => {
  const dir = mkdtempSync(join(tmpdir(), "delta-"));
  const twice = join(dir, "twice.json");
  writeFileSync(twice, JSON.stringify({ round: "4", records: [record("study-ev", "S45", "no"), record("study-ev", "S45", "yes")] }));
  assert.throws(() => readVerdicts(twice), (error) => error instanceof DeltaError && error.message.includes("twice.json") && error.message.includes("study-ev"));
});

test("R3.23 transitions rows carry no family field, which nothing reads (code review round 3, 6)", () => {
  const rows = transitions(previous, current);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal("family" in row, false);
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
