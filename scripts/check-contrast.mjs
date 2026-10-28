#!/usr/bin/env node
// Colour contrast check (R3.13, O-346, O-365): every text and control colour pair of the web
// app's semantic tokens meets WCAG 2 level AA in both themes, and the report that proves it is
// current. `just contrast` runs it in check mode locally and in the CI ts job;
// `just contrast-write` rewrites validation/reports/contrast.md after a token change;
// scripts/check-contrast.test.mjs covers it under `pnpm run test:scripts`.
//
// Mechanism: web/src/styles.css declares the light tokens in the plain `:root {` block and the
// dark ones in the plain `.dark {` block (later blocks such as `:root, [data-card-back]` are
// cosmetics, not themes, and are skipped). Each colour token used by a pair carries a trailing
// comment `/* from <hex> <name>, <how> */` naming the palette hue it was derived from (or why it
// sits outside the palette); a checked colour without one fails, so the report always says where
// every colour came from. The ratio is the WCAG 2 relative luminance formula. GATING_PAIRS are
// the pairs the app paints: text at 4.5:1 (1.4.3) and control edges and the focus ring at 3:1
// (1.4.11). The solver surface colours (web/src/theme/action-style.ts and the felt) are owned by
// S38; they are listed against the grounds at 3:1 for information only and never fail the run.
//
// Command line:
//   node scripts/check-contrast.mjs           check: exit 1 on a failing pair or a stale report
//   node scripts/check-contrast.mjs --write   write the report, exit 1 on a failing pair
// No npm packages.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STYLES_PATH = join(ROOT, "web", "src", "styles.css");
export const ACTION_STYLE_PATH = join(ROOT, "web", "src", "theme", "action-style.ts");
export const REPORT_PATH = join(ROOT, "validation", "reports", "contrast.md");

/** The owner's five colours (O-346), declared as primitives in the light :root block. */
export const PALETTE = Object.freeze({
  "p-oxblood": "#8c1c13",
  "p-brick": "#bf4342",
  "p-cream": "#e7d7c1",
  "p-taupe": "#a78a7f",
  "p-umber": "#735751",
});

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3;
const GROUNDS = ["surface", "surface-raised", "surface-sunken"];
const TEXT_ROLES = [
  ["text", "body text"],
  ["text-muted", "secondary text"],
  ["accent", "links and accent text"],
  ["danger", "error text"],
  ["success", "success text"],
  ["warning", "warning text"],
];

/** Every pair the app paints, with the WCAG minimum it must meet in both themes. */
export const GATING_PAIRS = Object.freeze([
  ...TEXT_ROLES.flatMap(([fg, use]) => GROUNDS.map((bg) => ({ fg, bg, min: TEXT_AA, use }))),
  { fg: "accent-text", bg: "accent", min: TEXT_AA, use: "primary button label" },
  { fg: "accent-text", bg: "danger", min: TEXT_AA, use: "danger button label" },
  ...GROUNDS.map((bg) => ({ fg: "border-strong", bg, min: NON_TEXT_AA, use: "control edge" })),
  // The ring is drawn 2 px outside the control (outline-offset in styles.css), so it sits on a ground.
  ...GROUNDS.map((bg) => ({ fg: "focus", bg, min: NON_TEXT_AA, use: "focus ring" })),
  ...["heat-1", "heat-2"].map((bg) => ({ fg: "heat-ink-low", bg, min: TEXT_AA, use: "heat map cell label" })),
  ...["heat-3", "heat-4", "heat-5"].map((bg) => ({ fg: "heat-ink-high", bg, min: TEXT_AA, use: "heat map cell label" })),
]);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DECLARATION = /--([a-z0-9-]+)\s*:\s*([^;]+);[ \t]*(?:\/\*\s*from\s+([^*]+?)\s*\*\/)?/gi;

function expandHex(hex) {
  const body = hex.slice(1).toLowerCase();
  return body.length === 3 ? `#${[...body].map((digit) => digit + digit).join("")}` : `#${body}`;
}

function channel(byte) {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a #rgb or #rrggbb colour. */
export function luminance(hex) {
  if (!HEX.test(hex)) throw new Error(`not a hex colour: ${hex}`);
  const full = expandHex(hex);
  const [red, green, blue] = [1, 3, 5].map((start) => channel(Number.parseInt(full.slice(start, start + 2), 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG 2 contrast ratio of two colours, from 1 to 21, in either order. */
export function contrastRatio(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

/** The body of the first block whose selector is exactly `selector` (no selector list). */
function blockBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match === null ? "" : match[1];
}

function colourTokens(body) {
  const tokens = new Map();
  for (const [, name, rawValue, source] of body.matchAll(DECLARATION)) {
    const value = rawValue.trim();
    if (HEX.test(value)) tokens.set(name, { value: expandHex(value), source: source ?? null });
  }
  return tokens;
}

/** The light (:root) and dark (.dark) colour tokens, each with its source note or null. */
export function parseThemes(css) {
  return { light: colourTokens(blockBody(css, ":root")), dark: colourTokens(blockBody(css, ".dark")) };
}

function resolveToken(themes, theme, name) {
  // The dark block only overrides; a token it does not set keeps its light value.
  return themes[theme].get(name) ?? themes.light.get(name);
}

/** Every pair in both themes with its ratio, and a list of failure lines (empty when all pass). */
export function evaluate(themes, pairs) {
  const rows = [];
  const failures = [];
  for (const theme of ["light", "dark"]) {
    for (const pair of pairs) {
      const fg = resolveToken(themes, theme, pair.fg);
      const bg = resolveToken(themes, theme, pair.bg);
      if (fg === undefined || bg === undefined) {
        failures.push(`${theme}: --${fg === undefined ? pair.fg : pair.bg} is not a hex colour token`);
        continue;
      }
      for (const [name, token] of [[pair.fg, fg], [pair.bg, bg]]) {
        if (token.source === null) failures.push(`${theme}: --${name} has no source hue note (/* from <hex> ... */)`);
      }
      const ratio = contrastRatio(fg.value, bg.value);
      const pass = ratio >= pair.min;
      if (!pass) failures.push(`${theme}: --${pair.fg} on --${pair.bg} is ${ratio.toFixed(2)}:1, under ${pair.min}:1 (${pair.use})`);
      rows.push({ theme, ...pair, fgToken: fg, bgToken: bg, ratio, pass });
    }
  }
  return { rows, failures: [...new Set(failures)] };
}

/** The solver surface colours from action-style.ts, light and dark, for the information table. */
export function readActionColours(source) {
  const colours = [];
  const entry = /(\w+):\s*\{[^}]*?name:\s*"([^"]+)"[^}]*?color:\s*\{\s*light:\s*"(#[0-9a-f]{6})",\s*dark:\s*"(#[0-9a-f]{6})"/gi;
  for (const [, , name, light, dark] of source.matchAll(entry)) colours.push({ name, light, dark });
  return colours;
}

function solverRows(themes, actionColours) {
  const rows = [];
  for (const theme of ["light", "dark"]) {
    const felt = resolveToken(themes, theme, "felt");
    const surfaces = [...actionColours.map((colour) => ({ name: `${colour.name} (action)`, value: colour[theme] }))];
    if (felt !== undefined) surfaces.push({ name: "felt", value: felt.value });
    for (const surface of surfaces) {
      for (const ground of ["surface", "surface-raised"]) {
        const bg = resolveToken(themes, theme, ground);
        if (bg === undefined) continue;
        const ratio = contrastRatio(surface.value, bg.value);
        rows.push({ theme, name: surface.name, value: surface.value, ground, ratio, meets: ratio >= NON_TEXT_AA });
      }
    }
  }
  return rows;
}

function sourceText(token) {
  return token.source ?? "none";
}

/** The Markdown report: gating pairs, then the solver surface colours for information. */
export function renderReport(result, solver) {
  const lines = [
    "# Colour contrast report (R3.13, O-346, O-365)",
    "",
    "Written by `node scripts/check-contrast.mjs --write` (`just contrast-write`) from web/src/styles.css; `just contrast` checks that every pair passes and that this file is current. Do not edit by hand.",
    "",
    "Minimums are WCAG 2 level AA: 4.5:1 for text (1.4.3), 3:1 for control edges and the focus ring (1.4.11). The source column names the palette hue each colour was derived from (owner palette 8c1c13, bf4342, e7d7c1, a78a7f, 735751).",
    "",
    "## Gating pairs",
    "",
    "| Theme | Foreground | Background | Ratio | Minimum | Result | Use | Foreground value and source | Background value and source |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of result.rows) {
    lines.push(
      `| ${row.theme} | ${row.fg} | ${row.bg} | ${row.ratio.toFixed(2)} | ${row.min} | ${row.pass ? "pass" : "FAIL"} | ${row.use} | ${row.fgToken.value} (${sourceText(row.fgToken)}) | ${row.bgToken.value} (${sourceText(row.bgToken)}) |`,
    );
  }
  lines.push("", `Failures: ${result.failures.length === 0 ? "none" : result.failures.length}.`);
  if (solver.length > 0) {
    lines.push(
      "",
      "## Solver surface colours (information for S38, not gating)",
      "",
      "Action colours (web/src/theme/action-style.ts) and the table felt against the grounds, at the 3:1 non-text guide. Every action also carries a pattern or a printed label (A7 section 4), so colour is never the only signal.",
      "",
      "| Theme | Colour | Value | Ground | Ratio | At least 3:1 |",
      "|---|---|---|---|---|---|",
    );
    for (const row of solver) {
      lines.push(`| ${row.theme} | ${row.name} | ${row.value} | ${row.ground} | ${row.ratio.toFixed(2)} | ${row.meets ? "yes" : "no"} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const write = argv.includes("--write");
  const themes = parseThemes(readFileSync(STYLES_PATH, "utf8"));
  const result = evaluate(themes, GATING_PAIRS);
  const report = renderReport(result, solverRows(themes, readActionColours(readFileSync(ACTION_STYLE_PATH, "utf8"))));
  for (const failure of result.failures) console.error(`check-contrast: ${failure}`);
  if (write) {
    writeFileSync(REPORT_PATH, report);
    console.log(`check-contrast: wrote ${REPORT_PATH}`);
  } else {
    let committed = null;
    try {
      committed = readFileSync(REPORT_PATH, "utf8");
    } catch (error) {
      console.error(`check-contrast: cannot read ${REPORT_PATH}: ${String(error)}`);
    }
    if (committed?.replace(/\r\n/g, "\n") !== report) {
      console.error("check-contrast: validation/reports/contrast.md is stale; run just contrast-write and commit it");
      return 1;
    }
  }
  if (result.failures.length > 0) return 1;
  console.log(`check-contrast: ${GATING_PAIRS.length} pairs pass WCAG AA in both themes, ${result.rows.length} checks (R3.13, O-365)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
