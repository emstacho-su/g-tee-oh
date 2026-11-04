// The delta between two critic rounds (S48, O-450, R3.23): which screens went from No to Yes
// (fixed), from Yes to No (regressed), stayed No, are new or are gone, and the No count per lane
// before and after. The bridge sprint's exit measure is the per-lane table this prints.
// Usage: node delta.mjs --previous <auto-verdicts.json> --current <auto-verdicts.json> [--out <file.md>]
// Both inputs are what merge-auto-verdicts.mjs writes ({ generated, round, records }). Fails,
// naming the file, when an input has no records or a record lacks a screen, lane or verdict.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { VERDICTS } from "./merge-auto-verdicts.mjs";

export class DeltaError extends Error {}

/** The transition kinds, in the order the digest lists them. */
export const KINDS = ["regressed", "fixed", "new", "gone", "still-no", "still-yes"];

/** An auto-verdicts file, validated at the boundary: round, generated and records with screen, lane and verdict, one record per screen. */
export function readVerdicts(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new DeltaError(`${path} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed?.records) || parsed.records.length === 0) throw new DeltaError(`${path} has no records`);
  const seen = new Set();
  parsed.records.forEach((r, index) => {
    if (typeof r?.screen !== "string" || typeof r?.lane !== "string" || !VERDICTS.has(r?.verdict)) {
      throw new DeltaError(`${path} record ${index} needs screen, lane and a yes or no verdict`);
    }
    // One record per screen, or two verdicts would collapse silently in the transition map (code review round 3, 5).
    if (seen.has(r.screen)) throw new DeltaError(`${path} lists the screen ${r.screen} twice`);
    seen.add(r.screen);
  });
  return { round: String(parsed.round ?? ""), generated: String(parsed.generated ?? ""), records: parsed.records };
}

/** The kind of one screen's transition from the previous verdict (or none) to the current one (or none). */
export function kindOf(previous, current) {
  if (!previous && !current) throw new DeltaError("a transition needs at least one side");
  if (!previous) return "new";
  if (!current) return "gone";
  if (previous === "no" && current === "yes") return "fixed";
  if (previous === "yes" && current === "no") return "regressed";
  return current === "no" ? "still-no" : "still-yes";
}

/** "G3: the text" of a record's first reason, or empty when it has none or its rule or text is not a string (code review round 2, 7). */
const firstReason = (record) => {
  const reason = Array.isArray(record?.reasons) ? record.reasons[0] : undefined;
  return typeof reason?.rule === "string" && typeof reason?.text === "string" ? `${reason.rule}: ${reason.text}` : "";
};

/**
 * One row per screen of either round: screen, its lane now (the previous lane when it is gone) and
 * its lane before (null when new), both verdicts, the kind and the current No's first reason.
 */
export function transitions(previous, current) {
  const before = new Map(previous.records.map((r) => [r.screen, r]));
  const after = new Map(current.records.map((r) => [r.screen, r]));
  const screens = [...new Set([...before.keys(), ...after.keys()])].sort();
  return screens.map((screen) => {
    const p = before.get(screen);
    const c = after.get(screen);
    return {
      screen,
      lane: (c ?? p).lane,
      laneBefore: p?.lane ?? null,
      before: p?.verdict ?? null,
      after: c?.verdict ?? null,
      kind: kindOf(p?.verdict ?? null, c?.verdict ?? null),
      reason: c?.verdict === "no" ? firstReason(c) : "",
    };
  });
}

const emptyTally = (lane) => ({ lane, before_no: 0, after_no: 0, before_screens: 0, after_screens: 0, new_no: 0, new_yes: 0, regressed: 0, fixed: 0, new: 0, gone: 0, "still-no": 0, "still-yes": 0 });

/**
 * The No count per lane before and after, with the transition counts; lanes sorted by name. The
 * before columns are tallied by the lane a screen had in the previous round and the after columns
 * by its lane now, so a screen that moved lanes counts under its old lane before and its new lane
 * after; its transition counts under its lane now (code review round 1, 7).
 */
export function tallyByLane(rows) {
  const lanes = new Map();
  const tallyOf = (lane) => {
    const t = lanes.get(lane) ?? emptyTally(lane);
    lanes.set(lane, t);
    return t;
  };
  for (const row of rows) {
    if (row.before) {
      const t = tallyOf(row.laneBefore ?? row.lane);
      t.before_screens += 1;
      if (row.before === "no") t.before_no += 1;
    }
    if (row.after) {
      const t = tallyOf(row.lane);
      t.after_screens += 1;
      if (row.after === "no") t.after_no += 1;
    }
    const t = tallyOf(row.lane);
    t[row.kind] += 1;
    // New screens split by their verdict in the same pass, so the digest never re-filters the rows (code review round 2, 8).
    if (row.kind === "new") t[row.after === "no" ? "new_no" : "new_yes"] += 1;
  }
  return [...lanes.values()].sort((a, b) => a.lane.localeCompare(b.lane));
}

/** A table cell: pipes escaped and whitespace collapsed, for every column (code review round 2, 7). */
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const TOTAL_KEYS = ["before_screens", "before_no", "after_screens", "after_no", "fixed", "regressed", "new_no", "new_yes", "gone"];

/** The lane table's row from a tally (a lane's, or the All total's). */
const laneLine = (name, t) => `| ${cell(name)} | ${TOTAL_KEYS.map((key) => t[key]).join(" | ")} |`;

/** The Markdown digest: the per-lane table, then the regressed, fixed, new and gone screens with their reasons. */
export function renderDelta(previous, current, rows) {
  const tally = tallyByLane(rows);
  const total = Object.fromEntries(TOTAL_KEYS.map((key) => [key, tally.reduce((sum, t) => sum + t[key], 0)]));
  const lines = [
    `# Critic delta: round ${cell(previous.round)} (${cell(previous.generated)}) to round ${cell(current.round)} (${cell(current.generated)})`,
    "",
    "| Lane | Screens before | No before | Screens after | No after | Fixed | Regressed | New No | New Yes | Gone |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const t of tally) lines.push(laneLine(t.lane, t));
  lines.push(laneLine("All", total));
  for (const kind of ["regressed", "fixed", "new", "gone"]) {
    const list = rows.filter((r) => r.kind === kind);
    if (list.length === 0) continue;
    lines.push("", `## ${kind[0].toUpperCase()}${kind.slice(1)} (${list.length})`, "", "| Screen | Lane | Before | After | Reason now |", "|---|---|---|---|---|");
    for (const r of list) lines.push(`| ${cell(r.screen)} | ${cell(r.lane)} | ${cell(r.before ?? "absent")} | ${cell(r.after ?? "absent")} | ${cell(r.reason)} |`);
  }
  const stillNo = rows.filter((r) => r.kind === "still-no");
  if (stillNo.length > 0) {
    lines.push("", `## Still No (${stillNo.length})`, "", "| Screen | Lane | Reason now |", "|---|---|---|");
    for (const r of stillNo) lines.push(`| ${cell(r.screen)} | ${cell(r.lane)} | ${cell(r.reason)} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { previous: { type: "string" }, current: { type: "string" }, out: { type: "string" } },
    strict: true,
  });
  if (!values.previous || !values.current) throw new DeltaError("--previous and --current are required");
  const previous = readVerdicts(values.previous);
  const current = readVerdicts(values.current);
  const digest = renderDelta(previous, current, transitions(previous, current));
  if (values.out) writeFileSync(values.out, digest);
  process.stdout.write(digest);
}

// Run as a script only when this file is the one node was given (the sibling merge-auto-verdicts.mjs's guard; code review round 1, 8).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`delta: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
