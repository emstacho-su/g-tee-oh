// Builds the owner's screenshot review page (S44, O-450; the round-2 builder moved into the repo).
// Usage: node build-page.mjs --manifest <manifest.json> --out <dir> [--round 3] [--auto <auto-verdicts.json> | --auto-if-present <path>]
//        [--previous-verdicts <dir of {screen, verdict, note} json>] [--previous-index <earlier index.html>]
//        [--families <families.json>] [--title "..."]
// Groups screens by the lane that owns them (rubric/families.json), shows the earlier verdict and
// note and the critic's verdict beside each screen. Writes <out>/index.html and <out>/files.json
// (the picture names the publish step attaches under shots/). Verdict documents on the page are
// keyed by screen name, so a republish with a different screen order keeps every answer attached.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { MergeError, familyOf, isOverturned, readFamilies, readManifest, shotFileName } from "./merge-auto-verdicts.mjs";

const DEFAULT_FAMILIES = fileURLToPath(new URL("./rubric/families.json", import.meta.url));
const TEMPLATE = fileURLToPath(new URL("./page-template.html", import.meta.url));

/** Screens renamed since round 1, so the earlier verdict still attaches. */
export const RENAMED = { "gallery-roll-scale": "gallery-roll-badge", "gallery-range-matrix-popout": "gallery-range-matrix-table" };
export const earlierName = (screen) => RENAMED[screen] ?? (screen.startsWith("quiz-") ? screen.replace(/^quiz-/, "predict-") : screen);

export function readPreviousVerdicts(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (typeof d.screen === "string") map.set(d.screen, { verdict: d.verdict ?? null, note: typeof d.note === "string" ? d.note : "" });
  }
  return map;
}

export function readPreviousScreens(indexPath) {
  if (!indexPath || !existsSync(indexPath)) return new Set();
  return new Set([...readFileSync(indexPath, "utf8").matchAll(/"screen":"([^"]+)"/g)].map((m) => m[1]));
}

/** What the earlier round said about a screen: a verdict, a note only, unanswered, or new. */
export function previousOf(screen, previousVerdicts, previousScreens) {
  const name = earlierName(screen);
  if (previousScreens.size && !previousScreens.has(name)) return { kind: "new" };
  const v = previousVerdicts.get(name);
  if (!v) return previousScreens.size ? { kind: "unanswered" } : { kind: "new" };
  const note = v.note.trim();
  if (v.verdict === "yes" || v.verdict === "no") return { kind: v.verdict, note };
  return note ? { kind: "note", note } : { kind: "unanswered" };
}

export const titleOf = (screen) => screen.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Screens grouped by lane, numbered in display order; the shape the template renders. */
export function buildGroups(manifest, { families, previousVerdicts = new Map(), previousScreens = new Set(), auto = new Map() }) {
  const byScreen = new Map();
  for (const e of manifest.shots) {
    const entry = byScreen.get(e.screen) ?? { screen: e.screen, criterion: String(e.criterion ?? ""), files: {}, lane: familyOf(e.screen, families).lane };
    entry.files[`${e.theme}-${e.width}`] = shotFileName(e.file);
    byScreen.set(e.screen, entry);
  }
  let n = 0;
  return Object.entries(families.lanes)
    .map(([lane, meta]) => {
      const items = [...byScreen.values()]
        .filter((e) => e.lane === lane)
        .sort((a, b) => a.screen.localeCompare(b.screen))
        .map((e) => {
          n += 1;
          return { id: e.screen, n: String(n).padStart(2, "0"), screen: e.screen, title: titleOf(e.screen), criterion: e.criterion, files: e.files, previous: previousOf(e.screen, previousVerdicts, previousScreens), auto: auto.get(e.screen) ?? null };
        });
      return { session: lane, title: meta.title, items };
    })
    .filter((g) => g.items.length);
}

export function readAuto(path) {
  const map = new Map();
  if (!path) return map;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed?.records)) throw new MergeError(`${path} has no records list`);
  for (const r of parsed.records) {
    if (typeof r?.screen !== "string" || (r.verdict !== "yes" && r.verdict !== "no")) throw new MergeError(`${path}: a record needs screen and a yes or no verdict`);
    map.set(r.screen, { verdict: r.verdict, confidence: r.confidence, reasons: Array.isArray(r.reasons) ? r.reasons : [], work_items: Array.isArray(r.work_items) ? r.work_items : [], fix_hint: r.fix_hint ?? "", verifier: r.verifier ?? null, overturned: isOverturned(r) });
  }
  return map;
}

/** JSON safe to inline in a script element: no closing tag or line terminators can escape it. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const unicodeEscape = (hex) => `${String.fromCharCode(92)}u${hex}`;
export const scriptJson = (value) => JSON.stringify(value).split("<").join(unicodeEscape("003c")).split(LINE_SEPARATOR).join(unicodeEscape("2028")).split(PARAGRAPH_SEPARATOR).join(unicodeEscape("2029"));
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHtml(template, groups, { round, generated, title }) {
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const critic = groups.flatMap((g) => g.items).filter((i) => i.auto).length;
  const fills = {
    __GROUPS__: scriptJson(groups),
    __TOTAL__: String(total),
    __ROUND__: escapeHtml(round),
    __TITLE__: escapeHtml(title),
    __CRITIC__: critic ? `The critic reviewed ${critic} of ${total} screens against the rubric; its verdict and reasons sit under each screen, and "Agree with the critic" copies it into your answer.` : "No automated verdicts were attached to this round.",
    __GENERATED__: `${(generated || new Date().toISOString()).slice(0, 16).replace("T", " ")} UTC`,
  };
  return template.replace(/__(GROUPS|TOTAL|ROUND|TITLE|CRITIC|GENERATED)__/g, (token) => fills[token]);
}

export function main(argv, log = console.error) {
  const { values } = parseArgs({
    args: argv,
    options: {
      manifest: { type: "string" }, out: { type: "string" }, round: { type: "string", default: "3" }, auto: { type: "string" }, "auto-if-present": { type: "string" },
      "previous-verdicts": { type: "string" }, "previous-index": { type: "string" }, families: { type: "string", default: DEFAULT_FAMILIES }, title: { type: "string", default: "Screen Review" },
    },
  });
  if (!values.manifest || !values.out) throw new MergeError("--manifest and --out are required");
  const optional = values["auto-if-present"];
  const autoPath = values.auto ?? (optional && existsSync(optional) ? optional : undefined);
  if (optional && !autoPath) log(`build-page: no critic verdicts at ${optional}; the page shows none`);
  const manifest = readManifest(values.manifest);
  const families = readFamilies(values.families);
  const groups = buildGroups(manifest, {
    families,
    previousVerdicts: readPreviousVerdicts(values["previous-verdicts"]),
    previousScreens: readPreviousScreens(values["previous-index"]),
    auto: readAuto(autoPath),
  });
  mkdirSync(values.out, { recursive: true });
  const html = renderHtml(readFileSync(TEMPLATE, "utf8"), groups, { round: values.round, generated: manifest.generated, title: values.title });
  writeFileSync(join(values.out, "index.html"), html);
  const files = [...new Set(manifest.shots.map((e) => shotFileName(e.file)))];
  writeFileSync(join(values.out, "files.json"), JSON.stringify(files));
  const counts = groups.map((g) => `${g.session}:${g.items.length}`).join(" ");
  return `screens ${groups.reduce((s, g) => s + g.items.length, 0)}, files ${files.length}, groups ${counts}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`build-page: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
