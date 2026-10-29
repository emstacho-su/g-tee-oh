// Merges the critic's analyst and verifier output into one verdict per screen (S44, O-450).
// Usage: node merge-auto-verdicts.mjs --manifest <manifest.json> --analyst <dir> --verifier <dir> --out <dir> [--families <families.json>]
// Writes <out>/auto-verdicts.json, <out>/digest.md and <out>/db/<screen>.json. Fails, naming the
// screens, when a manifest screen has no analyst record or a record names an unknown screen.
// The rubric and the passes are described in rubric/critic.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const VERDICTS = new Set(["yes", "no"]);
export const CONFIDENCES = new Set(["high", "medium", "low"]);
const DEFAULT_FAMILIES = fileURLToPath(new URL("./rubric/families.json", import.meta.url));

export class MergeError extends Error {}

/** The family and lane of a screen; first matching family wins, else the last lane in the file. */
export function familyOf(screen, families) {
  const hit = families.families.find((f) => new RegExp(f.match).test(screen));
  if (hit) return { family: hit.id, lane: hit.lane };
  const lanes = Object.keys(families.lanes);
  return { family: "other", lane: lanes[lanes.length - 1] };
}

function readJsonDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function checkRecord(record, index) {
  const where = `analyst record ${index} (${record?.screen ?? "no screen"})`;
  if (typeof record?.screen !== "string" || record.screen === "") throw new MergeError(`${where}: screen missing`);
  if (!VERDICTS.has(record.verdict)) throw new MergeError(`${where}: verdict must be yes or no`);
  if (record.confidence !== undefined && !CONFIDENCES.has(record.confidence)) throw new MergeError(`${where}: confidence must be high, medium or low`);
  if (!Array.isArray(record.reasons)) throw new MergeError(`${where}: reasons must be a list`);
  for (const reason of record.reasons) {
    if (typeof reason?.rule !== "string" || typeof reason?.text !== "string") throw new MergeError(`${where}: each reason needs rule and text`);
  }
  if (record.verdict === "no" && record.reasons.length === 0) throw new MergeError(`${where}: a no needs at least one reason`);
}

/**
 * Pure merge. manifestScreens: the screen names of the shot manifest. analystFiles and
 * verifierFiles: the parsed family files. Returns the records in manifest order.
 */
export function mergeVerdicts({ manifestScreens, analystFiles, verifierFiles, families }) {
  const known = new Set(manifestScreens);
  const byScreen = new Map();
  let index = 0;
  for (const file of analystFiles) {
    for (const record of file.screens ?? []) {
      index += 1;
      checkRecord(record, index);
      if (!known.has(record.screen)) throw new MergeError(`analyst names a screen the manifest lacks: ${record.screen}`);
      if (byScreen.has(record.screen)) throw new MergeError(`analyst names a screen twice: ${record.screen}`);
      byScreen.set(record.screen, { ...record, family: file.family });
    }
  }
  const missing = manifestScreens.filter((s) => !byScreen.has(s));
  if (missing.length) throw new MergeError(`no analyst record for ${missing.length} screen(s): ${missing.join(", ")}`);

  const checks = new Map();
  for (const file of verifierFiles) {
    for (const check of file.checks ?? []) {
      if (typeof check?.screen !== "string" || typeof check?.upheld !== "boolean") throw new MergeError(`verifier check for ${check?.screen ?? "?"} needs screen and upheld`);
      checks.set(check.screen, check);
    }
  }

  return manifestScreens.map((screen) => {
    const analyst = byScreen.get(screen);
    const check = checks.get(screen) ?? null;
    const overturned = analyst.verdict === "no" && check !== null && check.upheld === false;
    const { family, lane } = familyOf(screen, families);
    return {
      screen,
      family: analyst.family ?? family,
      lane,
      verdict: overturned ? "yes" : analyst.verdict,
      analyst_verdict: analyst.verdict,
      confidence: analyst.confidence ?? "medium",
      reasons: analyst.reasons,
      work_items: Array.isArray(analyst.work_items) ? analyst.work_items : [],
      fix_hint: typeof analyst.fix_hint === "string" ? analyst.fix_hint : "",
      verifier: check ? { upheld: check.upheld, note: typeof check.note === "string" ? check.note : "" } : null,
    };
  });
}

export function tally(records) {
  const perLane = {};
  for (const r of records) {
    const t = (perLane[r.lane] ??= { yes: 0, no: 0, overturned: 0 });
    t[r.verdict] += 1;
    if (r.analyst_verdict === "no" && r.verdict === "yes") t.overturned += 1;
  }
  return { yes: records.filter((r) => r.verdict === "yes").length, no: records.filter((r) => r.verdict === "no").length, perLane };
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

/** The digest in the format of the owner's round-1 verdict file: one table per lane, a tally first. */
export function renderDigest(records, families, { round = "3", generated = "" } = {}) {
  const t = tally(records);
  const lines = [`# Automated screen review, round ${round}`, ""];
  lines.push(`Critic verdicts over ${records.length} screens (shots generated ${generated}). Tally: ${t.yes} Yes, ${t.no} No. A No the verifier overturned is listed as Yes with the verifier's note.`, "");
  for (const [lane, meta] of Object.entries(families.lanes)) {
    const rows = records.filter((r) => r.lane === lane);
    if (!rows.length) continue;
    const lt = t.perLane[lane];
    lines.push(`## ${lane} ${meta.title}: ${lt.yes} Yes, ${lt.no} No`, "");
    lines.push("| # | Screen | Verdict | Reasons | Work items | Verifier |", "|---|---|---|---|---|---|");
    rows.forEach((r, i) => {
      const reasons = r.reasons.map((x) => `${x.rule}: ${x.text}`).join(" ");
      const verifier = r.verifier ? `${r.verifier.upheld ? "upheld" : "overturned"}${r.verifier.note ? `: ${r.verifier.note}` : ""}` : "";
      lines.push(`| ${String(i + 1).padStart(2, "0")} | ${r.screen} | ${r.verdict === "no" ? "No" : "Yes"} | ${cell(reasons)} | ${r.work_items.join(", ")} | ${cell(verifier)} |`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

/** One document per screen for the page's auto_verdicts collection, keyed by screen name. */
export function dbDocument(record, generated) {
  return {
    screen: record.screen,
    lane: record.lane,
    verdict: record.verdict,
    confidence: record.confidence,
    reasons: record.reasons.map((r) => ({ rule: r.rule, text: r.text, variants: Array.isArray(r.variants) ? r.variants : [] })),
    work_items: record.work_items,
    fix_hint: record.fix_hint,
    verifier_note: record.verifier?.note ?? "",
    overturned: record.analyst_verdict === "no" && record.verdict === "yes",
    generated,
  };
}

export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { manifest: { type: "string" }, analyst: { type: "string" }, verifier: { type: "string" }, out: { type: "string" }, families: { type: "string", default: DEFAULT_FAMILIES }, round: { type: "string", default: "3" } },
  });
  for (const key of ["manifest", "analyst", "verifier", "out"]) {
    if (!values[key]) throw new MergeError(`--${key} is required`);
  }
  const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
  const families = JSON.parse(readFileSync(values.families, "utf8"));
  const manifestScreens = [...new Set(manifest.shots.map((s) => s.screen))].sort();
  const records = mergeVerdicts({ manifestScreens, analystFiles: readJsonDir(values.analyst), verifierFiles: readJsonDir(values.verifier), families });
  const generated = String(manifest.generated ?? "");
  mkdirSync(join(values.out, "db"), { recursive: true });
  writeFileSync(join(values.out, "auto-verdicts.json"), JSON.stringify({ generated, round: values.round, records }, null, 2));
  writeFileSync(join(values.out, "digest.md"), renderDigest(records, families, { round: values.round, generated }));
  for (const r of records) writeFileSync(join(values.out, "db", `${r.screen}.json`), JSON.stringify(dbDocument(r, generated), null, 2));
  const t = tally(records);
  return `screens ${records.length}, yes ${t.yes}, no ${t.no}, lanes ${Object.entries(t.perLane).map(([l, v]) => `${l}:${v.no} no`).join(" ")}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof MergeError ? `merge-auto-verdicts: ${error.message}` : error);
    process.exitCode = 1;
  }
}
