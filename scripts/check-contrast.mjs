#!/usr/bin/env node
// Colour contrast check (R3.13, O-346, O-365): every text and control colour pair of the web
// app's semantic tokens meets WCAG 2 level AA in both themes, and the report that proves it is
// current. `just contrast` runs it in check mode locally and in the CI ts job;
// `just contrast-write` rewrites validation/reports/contrast.md after a token change;
// scripts/check-contrast.test.mjs covers it under `pnpm run test:scripts`.
//
// Mechanism: web/src/styles.css declares the light tokens in the plain `:root {` block and the
// dark ones in the plain `.dark {` block (later blocks such as `:root, [data-card-back]` are
// cosmetics, not themes, and are skipped). The owner's palette is the --p-* primitives of the
// light block, and a token that uses a palette colour as it is says var(--p-*). The parser
// resolves aliases, tokens whose whole value is one var() (same theme first, then the light
// block), and names the primitive as the source; a var() inside a larger value (calc(), a shadow)
// is not a colour token and is left alone. An alias the browser would drop (an undeclared target,
// a cycle, a fallback on a colour) is a fault, reported once, and fails the run before any ratio.
// A derived colour is a hex value with a trailing comment `/* from <hex> <name>, <how> */` naming
// the hue it came from (or why it sits outside the palette); a checked colour with neither fails,
// so the report always says where every colour came from, and the palette itself is written only
// once, in styles.css. The ratio is the WCAG 2 relative luminance formula. GATING_PAIRS are
// the pairs the app paints: text at 4.5:1 (1.4.3) and control edges and the focus ring at 3:1
// (1.4.11). The solver surface colours (S38, O-389) gate too: every action colour and every bet and
// raise size shade of web/src/theme/action-style.ts, the theme felt and every cosmetic felt
// ([data-felt] blocks, light and .dark) at 3:1 against surface and surface-raised (1.4.11, the
// table and the matrix sit on those grounds), and the table's white text (TABLE_INK, PokerTable's
// text-white) at 4.5:1 on every felt (1.4.3). The dark base is neutral (S43, O-430): every colour in
// the dark grounds, edges, text, heat inks, overlay and shadow layers (NEUTRAL_DARK_TOKENS) sits at
// NEUTRAL_MAX_SATURATION or less, so the old brown base cannot come back unnoticed. The marks drawn
// over solver fills (S43 review rounds 1 and 2, O-432 to O-434), in both themes: the focus ring and
// its halo at 9:1 (WCAG technique C40, which covers every fill), and the selection mark or its halo
// at 3:1 on every action colour, size shade, EV step of matrix-theme.ts and heat step.
//
// Command line:
//   node scripts/check-contrast.mjs           check: exit 1 on a failing pair or a stale report
//   node scripts/check-contrast.mjs --write   write the report, exit 1 on a failing pair
// No npm packages.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { saturationOf, scanColours } from "./lib/css-colours.mjs";

// The colour scanner is part of this module's surface, so the web tests read copies with it too.
export { scanColours };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STYLES_PATH = join(ROOT, "web", "src", "styles.css");
export const ACTION_STYLE_PATH = join(ROOT, "web", "src", "theme", "action-style.ts");
export const MATRIX_THEME_PATH = join(ROOT, "web", "src", "components", "range-matrix", "matrix-theme.ts");
export const REPORT_PATH = join(ROOT, "validation", "reports", "contrast.md");

/**
 * The owner's palette (O-346) lives only in styles.css, as the --p-* primitives of the light :root
 * block; semantic tokens reference them with var(), which parseThemes resolves.
 */
export const PRIMITIVE_PREFIX = "p-";

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3;
/** Two colours this far apart guarantee one of them 3:1 on any ground (WCAG technique C40). */
const TWO_COLOUR_RING = 9;
const GROUNDS = ["surface", "surface-raised", "surface-sunken"];
/** The heat map steps, which the range matrix's weight mode also paints. */
const HEAT_STEPS = Object.freeze(["heat-1", "heat-2", "heat-3", "heat-4", "heat-5"]);
/** The grounds the solver surfaces (table, matrix, action bars and swatches) are painted on. */
const SOLVER_GROUNDS = ["surface", "surface-raised"];
/** The text colour PokerTable prints on the felt (Tailwind text-white): pot, board and chips. */
export const TABLE_INK = "#ffffff";
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
  // The ring is drawn 2 px outside the control (outline-offset in styles.css), so it sits on a ground;
  // so do the seat marks (outline-offset-2, and no seat card overlaps the felt: seat-layout.ts).
  ...GROUNDS.map((bg) => ({ fg: "focus", bg, min: NON_TEXT_AA, use: "focus ring and the acting seat mark" })),
  ...GROUNDS.map((bg) => ({ fg: "selected", bg, min: NON_TEXT_AA, use: "selection mark" })),
  ...["heat-1", "heat-2"].map((bg) => ({ fg: "heat-ink-low", bg, min: TEXT_AA, use: "heat map cell label" })),
  ...["heat-3", "heat-4", "heat-5"].map((bg) => ({ fg: "heat-ink-high", bg, min: TEXT_AA, use: "heat map cell label" })),
  // Over a fill, the focus ring has a halo of the ground inside it (O-432, O-433). At 9:1 apart, one of
  // the two reaches 3:1 on any fill (WCAG technique C40), so this pair alone gates the ring on every
  // solver fill; the selection mark, whose light pair is under 9:1, is gated fill by fill instead.
  { fg: "focus", bg: "focus-halo", min: TWO_COLOUR_RING, use: "two-colour focus ring over a fill (C40)" },
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

/**
 * A token whose whole value is one var(), with the spaces CSS allows and an optional fallback. A
 * var() inside a larger value (calc(), color-mix(), a shadow list) is not an alias and is left out.
 */
const WHOLE_VAR = /^var\(\s*--([a-z0-9-]+)\s*(,[\s\S]*)?\)$/i;
/** A token whose resolution failed; the fault is recorded once where it happened. */
const FAILED = Symbol("failed");

/** A token the checker cannot resolve: a typo, a cycle or a var() form it does not follow. */
export class ContrastError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContrastError";
  }
}

function rawTokens(body) {
  const tokens = new Map();
  for (const [, name, rawValue, source] of body.matchAll(DECLARATION)) {
    tokens.set(name, { raw: rawValue.trim(), source: source ?? null });
  }
  return tokens;
}

/**
 * A memoised resolver for one theme. A token resolves to { value, source } when it is a hex colour
 * or an alias (a whole-value var()) that ends in one, to null when it is not a colour (a number, a
 * shadow, a calc() or any var() inside a larger value), or to FAILED. A reference is looked up in
 * the same theme and then in the light block (the dark block only overrides, and the --p-*
 * primitives live in the light block), so a light-only alias such as var(--surface) follows the
 * dark --surface in the dark theme. An alias that takes a primitive as it is names that primitive
 * as its source unless it carries its own note.
 *
 * Faults, each added once to `faults` and named by the block that declares the faulty token (so a
 * light-only fault seen again from the dark theme is the same line): an alias to an undeclared
 * token; a cycle, naming only the tokens in it (a token that merely points into a cycle fails
 * quietly); and an alias with a fallback that would otherwise be a colour, which the checker
 * cannot follow. A fallback on a token that is not a colour is left alone.
 */
function themeResolver(raws, theme, faults) {
  const memo = new Map();
  const stack = [];
  const homeOf = (name) => (raws[theme].has(name) ? theme : "light");

  const evaluateToken = (name) => {
    const entry = raws[theme].get(name) ?? raws.light.get(name);
    if (HEX.test(entry.raw)) return { value: expandHex(entry.raw), source: entry.source };
    const alias = WHOLE_VAR.exec(entry.raw);
    if (alias === null) return null;
    const [, target, fallback] = alias;
    if (!raws[theme].has(target) && !raws.light.has(target)) {
      faults.add(`${homeOf(name)}: --${name} references --${target}, which is not declared`);
      return FAILED;
    }
    const resolved = resolve(target);
    if (resolved === FAILED || resolved === null) return resolved;
    if (fallback !== undefined) {
      faults.add(`${homeOf(name)}: --${name} uses ${entry.raw}, which the checker cannot resolve (write a plain var(--token) for a colour)`);
      return FAILED;
    }
    const inherited = target.startsWith(PRIMITIVE_PREFIX) ? `--${target}, the palette value` : resolved.source;
    return { value: resolved.value, source: entry.source ?? inherited };
  };

  const resolve = (name) => {
    if (memo.has(name)) return memo.get(name);
    const at = stack.indexOf(name);
    if (at >= 0) {
      const members = stack.slice(at);
      const home = members.every((member) => homeOf(member) === "light") ? "light" : theme;
      faults.add(`${home}: var() cycle: ${[...members, name].map((member) => `--${member}`).join(" -> ")}`);
      return FAILED;
    }
    stack.push(name);
    const result = evaluateToken(name);
    stack.pop();
    memo.set(name, result);
    return result;
  };
  return resolve;
}

/** Every colour token the theme sees (the light block's, overridden by the dark block's), resolved in it. */
function resolvedTheme(raws, theme, faults) {
  const resolve = themeResolver(raws, theme, faults);
  const tokens = new Map();
  for (const name of new Set([...raws.light.keys(), ...raws[theme].keys()])) {
    const token = resolve(name);
    if (token !== null && token !== FAILED) tokens.set(name, token);
  }
  return tokens;
}

/**
 * The light (:root) and dark (.dark) colour tokens, var() resolved, each with its source note or
 * null. Throws one ContrastError listing every fault once, in the order found.
 */
export function parseThemes(css) {
  const raws = { light: rawTokens(blockBody(css, ":root")), dark: rawTokens(blockBody(css, ".dark")) };
  const faults = new Set();
  const themes = { light: resolvedTheme(raws, "light", faults), dark: resolvedTheme(raws, "dark", faults) };
  if (faults.size > 0) throw new ContrastError([...faults].join("\n"));
  return themes;
}

/** The --p-* primitives as "#hex" strings, in declaration order. */
export function paletteOf(themes) {
  return [...themes.light].filter(([name]) => name.startsWith(PRIMITIVE_PREFIX)).map(([, token]) => token.value);
}

/** Every pair in both themes with its ratio, and a list of failure lines (empty when all pass). */
export function evaluate(themes, pairs) {
  const rows = [];
  const failures = [];
  for (const theme of ["light", "dark"]) {
    for (const pair of pairs) {
      const fg = themes[theme].get(pair.fg);
      const bg = themes[theme].get(pair.bg);
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

/**
 * The neutral dark base (S43, O-430): the owner's call that the dark theme is a traditional gray and
 * black, not the palette's reddish brown. These dark tokens (the grounds, the edges, the text, the
 * focus ring and its halo (O-432), the inks printed on the heat steps, the overlay and every shadow
 * layer of the tactile depth) must be neutral; the palette reds stay as accent and danger.
 */
export const NEUTRAL_DARK_TOKENS = Object.freeze([
  "surface",
  "surface-raised",
  "surface-sunken",
  "border",
  "border-strong",
  "text",
  "text-muted",
  "accent-text",
  "focus",
  "focus-halo",
  "heat-ink-low",
  "heat-ink-high",
  "overlay",
  "shadow-raised",
  "shadow-press-rest",
  "shadow-press-hover",
  "shadow-press-down",
]);

/**
 * The most HSL saturation a neutral colour may carry: 10 percent. A pure gray is 0; every brown of
 * the old dark base was 18 percent or more (the taupe edge 18.5, the grounds 27 to 33, the cream
 * text and highlight 44). HSL inflates saturation near black and white, so the margin also lets a
 * one-step rounding tint through there without letting a visible hue back in.
 */
export const NEUTRAL_MAX_SATURATION = 0.1;

/** HSL saturation, 0 to 1, of a #rgb or #rrggbb colour. */
export function hslSaturation(hex) {
  if (!HEX.test(hex)) throw new Error(`not a hex colour: ${hex}`);
  const full = expandHex(hex);
  return saturationOf([1, 3, 5].map((start) => Number.parseInt(full.slice(start, start + 2), 16)));
}

/** The colours of one neutral token in the dark theme, or the failure that stops the check reading them. */
function neutralColours(name, entry, resolved) {
  if (resolved !== undefined) return { colours: [{ text: resolved.value, saturation: hslSaturation(resolved.value) }] };
  if (WHOLE_VAR.test(entry.raw)) return { fault: `dark: --${name} is ${entry.raw}, which resolves to no colour the neutral check can read` };
  const scan = scanColours(entry.raw);
  if (scan.usesVar) return { fault: `dark: --${name} uses var() inside its value, which the neutral check cannot follow` };
  if (scan.unreadable.length > 0) {
    return { fault: `dark: --${name} holds ${scan.unreadable.join(", ")}, which the neutral check cannot read (write hex, rgb() or hsl())` };
  }
  // A value of keywords and lengths only (none, a CSS-wide keyword) holds no colour, so no tint: it passes.
  return { colours: scan.colours };
}

/**
 * The neutral check of the dark theme: each token's effective dark value (the .dark block's, else
 * the light block's it inherits) and every colour in it at NEUTRAL_MAX_SATURATION or less. A colour
 * token (hex or a whole-value var()) is checked as `themes` resolved it; a larger value (a shadow
 * list, an rgb() overlay) colour by colour through scanColours, failing closed: a token that is not
 * declared, resolves to no colour, holds a colour form or word the scanner cannot read, or uses var()
 * inside a larger value fails, each as a neutral failure line. A value with no colour at all (none,
 * a CSS-wide keyword) carries no tint and passes (review round 2 finding 7).
 */
export function evaluateNeutral(css, themes, tokens = NEUTRAL_DARK_TOKENS) {
  const raws = { light: rawTokens(blockBody(css, ":root")), dark: rawTokens(blockBody(css, ".dark")) };
  const rows = [];
  const failures = [];
  for (const name of tokens) {
    const entry = raws.dark.get(name) ?? raws.light.get(name);
    if (entry === undefined) {
      failures.push(`dark: --${name} is not declared`);
      continue;
    }
    const { colours, fault } = neutralColours(name, entry, themes.dark.get(name));
    if (fault !== undefined) {
      failures.push(fault);
      continue;
    }
    const tinted = colours.filter((colour) => colour.saturation > NEUTRAL_MAX_SATURATION);
    for (const colour of tinted) {
      failures.push(`dark: --${name} ${colour.text} is not neutral: HSL saturation ${(colour.saturation * 100).toFixed(1)}%, over ${NEUTRAL_MAX_SATURATION * 100}% (O-430)`);
    }
    const highest = Math.max(0, ...colours.map((colour) => colour.saturation));
    rows.push({ name, colours: colours.map((colour) => colour.text), saturation: highest, pass: tinted.length === 0 });
  }
  return { rows, failures };
}

/** The solver surface colours from action-style.ts, light and dark, for the information table. */
export function readActionColours(source) {
  const colours = [];
  const entry = /(\w+):\s*\{[^}]*?name:\s*"([^"]+)"[^}]*?color:\s*\{\s*light:\s*"(#[0-9a-f]{6})",\s*dark:\s*"(#[0-9a-f]{6})"/gi;
  for (const [, , name, light, dark] of source.matchAll(entry)) colours.push({ name, light, dark });
  return colours;
}

const HEX_LIST = /#[0-9a-f]{6}/gi;

/** The bet and raise size shades of action-style.ts (SIZE_SHADES), light and dark, in order. */
export function readSizeShades(source) {
  const block = /SIZE_SHADES[^=]*=\s*\{([\s\S]*?)\};/.exec(source);
  const shades = { light: [], dark: [] };
  if (block === null) return shades;
  for (const theme of ["light", "dark"]) {
    const list = new RegExp(`${theme}:\\s*\\[([^\\]]*)\\]`).exec(block[1]);
    shades[theme] = list === null ? [] : [...list[1].matchAll(HEX_LIST)].map(([hex]) => hex.toLowerCase());
  }
  return shades;
}

/** The --felt value of a block body, or null. */
function feltOf(body) {
  const match = /--felt\s*:\s*(#[0-9a-f]{3,6})\s*;/i.exec(body);
  return match === null ? null : expandHex(match[1]);
}

/**
 * Every felt the table can wear, per theme: the theme's --felt, then each cosmetic felt in file
 * order. A light cosmetic is a block opened by [data-felt="name"]; a dark one by a selector list
 * starting .dark[data-felt="name"].
 */
export function readFelts(css, themes) {
  const cosmetic = { light: [], dark: [] };
  for (const [, dark, name, body] of css.matchAll(/(?:^|\n)(\.dark)?\[data-felt="([^"]+)"\][^{]*\{([^}]*)\}/g)) {
    const value = feltOf(body);
    if (value !== null) cosmetic[dark === undefined ? "light" : "dark"].push({ name: `felt ${name}`, value });
  }
  return ["light", "dark"].flatMap((theme) => {
    const base = themes[theme].get("felt");
    const own = base === undefined ? [] : [{ name: "felt", value: base.value }];
    return [...own, ...cosmetic[theme]].map((felt) => ({ theme, ...felt }));
  });
}

/** One gating check: a colour against a ground, recorded as a row and, under its minimum, a failure. */
function check(rows, failures, row) {
  const ratio = contrastRatio(row.value, row.groundValue);
  const pass = ratio >= row.min;
  if (!pass) failures.push(`${row.theme}: ${row.name} ${row.value} on ${row.groundLabel} is ${ratio.toFixed(2)}:1, under ${row.min}:1`);
  rows.push({ theme: row.theme, name: row.name, value: row.value, ground: row.ground, ratio, min: row.min, pass });
}

/**
 * The solver surface colours as gating pairs (O-389): each action colour and size shade and each
 * felt at 3:1 on surface and surface-raised, and TABLE_INK at 4.5:1 on each felt.
 */
export function evaluateSolver(themes, actionColours, sizeShades, felts) {
  const rows = [];
  const failures = [];
  // A parser that reads nothing would pass everything, so an empty read fails the gate (review round 1).
  if (actionColours.length === 0) {
    failures.push("no action colours read from web/src/theme/action-style.ts (ACTION_STYLES); the solver gate would check nothing");
  }
  for (const theme of ["light", "dark"]) {
    const shades = (sizeShades[theme] ?? []).map((value, rank) => ({ name: `raise and bet size shade ${rank + 1}`, value }));
    const actions = actionColours.map((colour) => ({ name: `${colour.name} (action)`, value: colour[theme] }));
    const themeFelts = felts.filter((felt) => felt.theme === theme);
    if (shades.length === 0) failures.push(`${theme}: no bet and raise size shades read from web/src/theme/action-style.ts (SIZE_SHADES)`);
    if (themeFelts.length === 0) failures.push(`${theme}: no felt read from web/src/styles.css (--felt)`);
    for (const colour of [...actions, ...shades, ...themeFelts]) {
      for (const ground of SOLVER_GROUNDS) {
        const bg = themes[theme].get(ground);
        if (bg === undefined) {
          failures.push(`${theme}: --${ground} is not a hex colour token`);
          continue;
        }
        check(rows, failures, { theme, ...colour, ground, groundValue: bg.value, groundLabel: `--${ground}`, min: NON_TEXT_AA });
      }
    }
    for (const felt of themeFelts) {
      const where = `${felt.name} ${felt.value}`;
      check(rows, failures, { theme, name: "table ink", value: TABLE_INK, ground: where, groundValue: felt.value, groundLabel: where, min: TEXT_AA });
    }
  }
  return { rows, failures: [...new Set(failures)] };
}

/**
 * The EV steps per theme: five negative, the neutral middle and five positive (scales.ts EV_STEPS).
 * The reader takes only hex literals, so a step written as a constant would drop out silently; the
 * selection gate fails on any other count (review round 2 finding 4).
 */
export const EV_STEP_COUNT = 11;

/**
 * The range matrix's expected value (EV) steps per theme, from the LIGHT and DARK palettes of
 * matrix-theme.ts: the negative steps, the neutral middle, then the positive steps, each named.
 */
export function readEvSteps(source) {
  const steps = { light: [], dark: [] };
  for (const theme of ["light", "dark"]) {
    const block = new RegExp(`const ${theme.toUpperCase()}: MatrixPalette = \\{([\\s\\S]*?)\\n\\};`).exec(source);
    if (block === null) continue;
    const list = (key) => {
      const match = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(block[1]);
      return match === null ? [] : [...match[1].matchAll(HEX_LIST)].map(([hex]) => hex.toLowerCase());
    };
    const neutral = /evNeutral:\s*"(#[0-9a-f]{6})"/i.exec(block[1]);
    steps[theme] = [
      ...list("evNegative").map((value, rank) => ({ name: `EV step -${rank + 1}`, value })),
      ...(neutral === null ? [] : [{ name: "EV neutral", value: neutral[1].toLowerCase() }]),
      ...list("evPositive").map((value, rank) => ({ name: `EV step +${rank + 1}`, value })),
    ];
  }
  return steps;
}

/** The fills a mark is drawn over in one theme: action colours, size shades, EV steps and heat steps. */
function markFills(themes, theme, fills) {
  const heat = fills.heatSteps.flatMap((name) => {
    const token = themes[theme].get(name);
    return token === undefined ? [] : [{ name: `--${name}`, value: token.value }];
  });
  return [
    ...fills.actionColours.map((colour) => ({ name: `${colour.name} (action)`, value: colour[theme] })),
    ...(fills.sizeShades[theme] ?? []).map((value, rank) => ({ name: `raise and bet size shade ${rank + 1}`, value })),
    ...(fills.evSteps[theme] ?? []),
    ...heat,
  ];
}

/**
 * The selection mark on the solver fills (O-434), both themes: the range matrix draws the selected
 * hand's outline in --selected with a line of --focus-halo inside it, so on every fill the mark or
 * its halo must reach 3:1. The light pair (oxblood and the cream ground) is 8.59:1, under the 9:1
 * that would cover every fill at once, so each fill is a real check here. The focus ring needs no
 * rows of its own: its pair with the halo is 9:1 or more in both themes (a gating pair), which
 * covers every fill (WCAG technique C40). Any EV step count but EV_STEP_COUNT fails.
 */
export function evaluateSelectionMark(themes, fills) {
  const rows = [];
  const failures = [];
  for (const theme of ["light", "dark"]) {
    const mark = themes[theme].get("selected");
    const halo = themes[theme].get("focus-halo");
    if (mark === undefined || halo === undefined) {
      failures.push(`${theme}: --selected and --focus-halo must both be colour tokens`);
      continue;
    }
    const read = (fills.evSteps[theme] ?? []).length;
    if (read !== EV_STEP_COUNT) {
      failures.push(
        `${theme}: read ${read} EV steps from web/src/components/range-matrix/matrix-theme.ts, expected ${EV_STEP_COUNT} (a step written as a constant is not read)`,
      );
    }
    for (const fill of markFills(themes, theme, fills)) {
      const ratio = Math.max(contrastRatio(mark.value, fill.value), contrastRatio(halo.value, fill.value));
      const pass = ratio >= NON_TEXT_AA;
      if (!pass) {
        failures.push(`${theme}: selection mark ${mark.value} with halo ${halo.value} on ${fill.name} ${fill.value} is ${ratio.toFixed(2)}:1, under ${NON_TEXT_AA}:1`);
      }
      rows.push({ theme, ...fill, mark: `mark ${mark.value}, halo ${halo.value}`, ratio, min: NON_TEXT_AA, pass });
    }
  }
  return { rows, failures: [...new Set(failures)] };
}

function sourceText(token) {
  return token.source ?? "none";
}

const NO_SOLVER = Object.freeze({ rows: [], failures: [] });
const NO_NEUTRAL = Object.freeze({ rows: [], failures: [] });
const NO_MARKS = Object.freeze({ rows: [], failures: [] });

/**
 * The Markdown report: gating pairs, the solver surface colours (O-389), the neutral dark base
 * (O-430), then the selection mark on the solver fills (O-434).
 */
export function renderReport(result, solver = NO_SOLVER, palette = [], neutral = NO_NEUTRAL, marks = NO_MARKS) {
  const lines = [
    "# Colour contrast report (R3.13, O-346, O-365)",
    "",
    "Written by `node scripts/check-contrast.mjs --write` (`just contrast-write`) from web/src/styles.css; `just contrast` checks that every pair passes and that this file is current. Do not edit by hand.",
    "",
    `Minimums are WCAG 2 level AA: 4.5:1 for text (1.4.3), 3:1 for control edges and the focus ring (1.4.11). The source column names the palette hue each colour was derived from (owner palette, the --p-* primitives of styles.css: ${palette.join(", ") || "none declared"}).`,
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
  if (solver.rows.length > 0) {
    lines.push(
      "",
      "## Solver surface colours (gating, O-389)",
      "",
      "Action colours and the bet and raise size shades (web/src/theme/action-style.ts), the theme felt and every cosmetic felt (styles.css) at 3:1 on the grounds the table and the matrix sit on (1.4.11), and the table's white text at 4.5:1 on every felt (1.4.3). Every action also carries a pattern or a printed label (A7 section 4), so colour is never the only signal.",
      "",
      "| Theme | Colour | Value | Ground | Ratio | Minimum | Result |",
      "|---|---|---|---|---|---|---|",
    );
    for (const row of solver.rows) {
      lines.push(`| ${row.theme} | ${row.name} | ${row.value} | ${row.ground} | ${row.ratio.toFixed(2)} | ${row.min} | ${row.pass ? "pass" : "FAIL"} |`);
    }
    lines.push("", `Solver failures: ${solver.failures.length === 0 ? "none" : solver.failures.length}.`);
  }
  if (neutral.rows.length > 0 || neutral.failures.length > 0) {
    const maximum = `${NEUTRAL_MAX_SATURATION * 100}%`;
    lines.push(
      "",
      "## Neutral dark base (gating, O-430)",
      "",
      `The dark grounds, edges, text, focus ring and its halo, heat inks, overlay and every shadow layer are gray and black: each colour they hold, resolved, at ${maximum} HSL saturation or less. The palette reds stay as the accent, danger and the selection mark and are not listed.`,
      "",
      "| Token | Colours | Highest HSL saturation | Maximum | Result |",
      "|---|---|---|---|---|",
    );
    for (const row of neutral.rows) {
      lines.push(`| ${row.name} | ${row.colours.join(", ") || "no colour"} | ${(row.saturation * 100).toFixed(1)}% | ${maximum} | ${row.pass ? "pass" : "FAIL"} |`);
    }
    lines.push("", `Neutral failures: ${neutral.failures.length === 0 ? "none" : neutral.failures.length}.`);
  }
  if (marks.rows.length > 0 || marks.failures.length > 0) {
    lines.push(
      "",
      "## Selection mark on the solver fills (gating, O-434)",
      "",
      "Both themes. The range matrix's selected hand is outlined in --selected with a line of --focus-halo inside it: on every action fill, size shade, EV step and heat step, the mark or its halo reaches 3:1 (1.4.11). The focus ring has no rows here: its pair with the same halo is gated at 9:1 above, which covers every fill (WCAG technique C40). Seat marks sit on the ground, never on a felt, so the focus and accent pairs on the grounds cover them.",
      "",
      "| Theme | Fill | Value | Mark | Ratio | Minimum | Result |",
      "|---|---|---|---|---|---|---|",
    );
    for (const row of marks.rows) {
      lines.push(`| ${row.theme} | ${row.name} | ${row.value} | ${row.mark} | ${row.ratio.toFixed(2)} | ${row.min} | ${row.pass ? "pass" : "FAIL"} |`);
    }
    lines.push("", `Selection mark failures: ${marks.failures.length === 0 ? "none" : marks.failures.length}.`);
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const write = argv.includes("--write");
  let themes;
  try {
    themes = parseThemes(readFileSync(STYLES_PATH, "utf8"));
  } catch (error) {
    if (!(error instanceof ContrastError)) throw error;
    // A token the browser would drop fails the run before any ratio is computed.
    for (const line of error.message.split("\n")) console.error(`check-contrast: ${line}`);
    return 1;
  }
  const result = evaluate(themes, GATING_PAIRS);
  const css = readFileSync(STYLES_PATH, "utf8");
  const actionSource = readFileSync(ACTION_STYLE_PATH, "utf8");
  // Each source is read once and shared by the gates that need it (review round 2 finding 9).
  const actionColours = readActionColours(actionSource);
  const sizeShades = readSizeShades(actionSource);
  const felts = readFelts(css, themes);
  const solver = evaluateSolver(themes, actionColours, sizeShades, felts);
  const neutral = evaluateNeutral(css, themes);
  const marks = evaluateSelectionMark(themes, {
    actionColours,
    sizeShades,
    evSteps: readEvSteps(readFileSync(MATRIX_THEME_PATH, "utf8")),
    heatSteps: HEAT_STEPS,
  });
  const report = renderReport(result, solver, paletteOf(themes), neutral, marks);
  const failures = [...result.failures, ...solver.failures, ...neutral.failures, ...marks.failures];
  for (const failure of failures) console.error(`check-contrast: ${failure}`);
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
  if (failures.length > 0) return 1;
  console.log(
    `check-contrast: ${GATING_PAIRS.length} pairs pass in both themes (${result.rows.length} checks), with ${solver.rows.length} solver surface checks, ${neutral.rows.length} neutral dark tokens and ${marks.rows.length} selection mark checks (R3.13, O-365, O-389, O-430, O-432 to O-434)`,
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
