// Tests for scripts/check-contrast.mjs (R3.13, O-346, O-365): the WCAG 2 math on known pairs,
// the token parser on a synthetic stylesheet, and the committed web/src/styles.css, which must
// carry the owner's five palette primitives, name the source hue of every checked colour and pass
// every gating pair in both themes; and, since O-389 (S38), the solver surface colours (the action
// colours, their size shades and every felt) as gating pairs too. The neutral dark base and the
// focus ring on the solver fills (S43, O-430, O-432) are in check-contrast-dark.test.mjs. node:test, run by
// `pnpm run test:scripts` (just ts-test).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACTION_STYLE_PATH,
  ContrastError,
  GATING_PAIRS,
  PRIMITIVE_PREFIX,
  STYLES_PATH,
  TABLE_INK,
  contrastRatio,
  evaluate,
  evaluateSolver,
  parseThemes,
  readActionColours,
  readFelts,
  readSizeShades,
  renderReport,
} from "./check-contrast.mjs";

const SAMPLE_CSS = `
:root {
  --p-cream: #e7d7c1;
  --surface: #ffffff; /* from e7d7c1 cream, lifted */
  --text: #000000; /* from 735751 umber, deepened */
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.dark {
  --surface: #000000; /* from 735751 umber, deepened */
  --text: #ffffff; /* from e7d7c1 cream, lifted */
}

:root,
[data-card-back="none"] {
  --surface: #123456;
}
`;

test("R3.13 contrastRatio matches the WCAG 2 reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(2), "1.00");
  // #767676 on white is the classic 4.54:1 grey.
  assert.equal(contrastRatio("#767676", "#ffffff").toFixed(2), "4.54");
  // The order of the two colours does not matter.
  assert.equal(contrastRatio("#ffffff", "#767676"), contrastRatio("#767676", "#ffffff"));
});

test("R3.13 parseThemes reads only the plain :root and .dark blocks, with each source note", () => {
  const themes = parseThemes(SAMPLE_CSS);
  assert.deepEqual(themes.light.get("surface"), { value: "#ffffff", source: "e7d7c1 cream, lifted" });
  assert.deepEqual(themes.dark.get("text"), { value: "#ffffff", source: "e7d7c1 cream, lifted" });
  assert.deepEqual(themes.light.get("p-cream"), { value: "#e7d7c1", source: null });
  // Non-colour values are skipped; the later ":root, [data-card-back]" block is not the theme.
  assert.equal(themes.light.has("shadow"), false);
});

test("R3.13 evaluate fails a pair under its minimum and a checked colour without a source", () => {
  const themes = parseThemes(SAMPLE_CSS);
  const pairs = [{ fg: "text", bg: "surface", min: 4.5, use: "body text" }];
  const result = evaluate(themes, pairs);
  assert.equal(result.failures.length, 0);
  const strict = evaluate(themes, [{ fg: "text", bg: "surface", min: 22, use: "impossible" }]);
  assert.equal(strict.failures.length, 2);
  const unsourced = evaluate(parseThemes(":root { --text: #000; --surface: #fff; }\n.dark { --text: #fff; --surface: #000; }"), pairs);
  assert.match(unsourced.failures.join("\n"), /no source hue/);
});

test("R3.13 renderReport names the theme, both tokens, the ratio, the minimum and the source hues", () => {
  const themes = parseThemes(SAMPLE_CSS);
  const report = renderReport(evaluate(themes, [{ fg: "text", bg: "surface", min: 4.5, use: "body text" }]));
  assert.match(report, /\| light \| text \| surface \| 21\.00 \| 4\.5 \| pass \|/);
  assert.match(report, /735751 umber, deepened/);
});

/** The owner's palette as O-346 states it: the expectation, not a copy the app or the checker reads. */
const OWNER_PALETTE = ["#8c1c13", "#bf4342", "#e7d7c1", "#a78a7f", "#735751"];

test("R3.13 O-346 styles.css carries the owner's five palette colours as primitives", () => {
  const themes = parseThemes(readFileSync(STYLES_PATH, "utf8"));
  const primitives = [...themes.light].filter(([name]) => name.startsWith(PRIMITIVE_PREFIX)).map(([, token]) => token.value);
  assert.deepEqual(primitives.sort(), [...OWNER_PALETTE].sort());
});

test("R3.13 parseThemes resolves var() through the theme and then the light primitives", () => {
  const css = `
:root {
  --p-oxblood: #8c1c13;
  --accent: var(--p-oxblood);
  --ring: var(--accent);
}

.dark {
  --accent: var(--p-oxblood); /* from 8c1c13 oxblood, kept */
}
`;
  const themes = parseThemes(css);
  assert.deepEqual(themes.light.get("accent"), { value: "#8c1c13", source: "--p-oxblood, the palette value" });
  assert.equal(themes.light.get("ring")?.value, "#8c1c13");
  assert.deepEqual(themes.dark.get("accent"), { value: "#8c1c13", source: "8c1c13 oxblood, kept" });
});

const PRIMITIVES = ":root {\n  --p-cream: #e7d7c1;\n  --p-umber: #735751;\n";

test("R3.13 a var() to an undeclared token is an error naming the token and the reference", () => {
  const css = `${PRIMITIVES}  --focus: var(--p-umber);\n}\n\n.dark {\n  --focus: var(--p-creme);\n}\n`;
  assert.throws(() => parseThemes(css), (error) => error instanceof ContrastError && /dark: --focus references --p-creme, which is not declared/.test(error.message));
});

/** The fault lines of the ContrastError parseThemes throws for this stylesheet. */
function faultsOf(css) {
  try {
    parseThemes(css);
  } catch (error) {
    if (error instanceof ContrastError) return error.message.split("\n");
    throw error;
  }
  return [];
}

test("R3.13 a var() cycle is reported once, naming only the tokens in it", () => {
  // --entry only points into the cycle; it is not part of it and is not named.
  const css = `${PRIMITIVES}  --entry: var(--a);\n  --a: var(--b);\n  --b: var(--a);\n}\n\n.dark {\n}\n`;
  assert.deepEqual(faultsOf(css), ["light: var() cycle: --a -> --b -> --a"]);
});

test("R3.13 a fault in a light-only token is reported once, not again for the dark theme", () => {
  const css = `${PRIMITIVES}  --ring: var(--p-creme);\n}\n\n.dark {\n}\n`;
  assert.deepEqual(faultsOf(css), ["light: --ring references --p-creme, which is not declared"]);
});

test("R3.13 a var() inside a larger value (calc, a shadow list) is not a colour token and never fails the run", () => {
  const css = `${PRIMITIVES}  --layer-tooltip: 30;\n  --layer-popover: calc(var(--layer-tooltip) + 1);\n  --shadow-raised: 0 1px 2px var(--p-umber);\n  --mix: color-mix(in srgb, var(--p-umber) 50%, white);\n}\n\n.dark {\n}\n`;
  assert.deepEqual(faultsOf(css), []);
  const themes = parseThemes(css);
  for (const name of ["layer-popover", "shadow-raised", "mix"]) assert.equal(themes.light.has(name), false, `--${name} is not a colour token`);
});

test("R3.13 a fallback on a token that is not a colour is left alone", () => {
  const css = `${PRIMITIVES}  --layer-tooltip: 30;\n  --layer-popover: var(--layer-tooltip, 31);\n}\n\n.dark {\n}\n`;
  assert.deepEqual(faultsOf(css), []);
});

test("R3.13 a var() the checker cannot follow (a fallback) is an error, never silently dropped", () => {
  const css = `${PRIMITIVES}  --focus: var(--p-umber, #000000);\n}\n\n.dark {\n}\n`;
  assert.throws(() => parseThemes(css), /light: --focus uses var\(--p-umber, #000000\), which the checker cannot resolve/);
});

test("R3.13 spaces inside var() are allowed, as in CSS", () => {
  const css = `${PRIMITIVES}  --focus: var( --p-umber );\n}\n\n.dark {\n}\n`;
  assert.equal(parseThemes(css).light.get("focus")?.value, "#735751");
});

test("R3.13 a light-only alias resolves again in the dark theme instead of keeping its light value", () => {
  const css = `${PRIMITIVES}  --surface: var(--p-cream);\n  --ring: var(--surface);\n}\n\n.dark {\n  --surface: var(--p-umber);\n}\n`;
  const themes = parseThemes(css);
  assert.equal(themes.light.get("ring")?.value, "#e7d7c1");
  assert.equal(themes.dark.get("ring")?.value, "#735751");
});

test("R3.13 O-346 the palette lives in one place: no token repeats a primitive's hex", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const palette = new Set([...parseThemes(css).light].filter(([name]) => name.startsWith(PRIMITIVE_PREFIX)).map(([, token]) => token.value));
  const repeats = [...css.matchAll(/--(?!p-)([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].filter(([, , hex]) => palette.has(hex.toLowerCase()));
  assert.deepEqual(repeats.map(([declaration]) => declaration), []);
});

test("R3.13 O-365 every gating text and control pair passes WCAG AA in both themes", () => {
  const result = evaluate(parseThemes(readFileSync(STYLES_PATH, "utf8")), GATING_PAIRS);
  assert.deepEqual(result.failures, []);
});

const SAMPLE_ACTION_STYLE = `
export const ACTION_STYLES = {
  fold: { kind: "fold", short: "F", name: "Fold", pattern: "none", color: { light: "#1d4ed8", dark: "#60a5fa" } },
  call: { kind: "call", short: "C", name: "Call", pattern: "dots", color: { light: "#eeeeee", dark: "#4ade80" } },
};
const SIZE_SHADES = {
  light: ["#b91c1c", "#991b1b"],
  dark: ["#f87171", "#202020"],
};
`;

const FELT_CSS = `${SAMPLE_CSS.replace("--text: #000000;", "--text: #000000;\n  --felt: #166534;").replace("--text: #ffffff;", "--text: #ffffff;\n  --felt: #15803d;")}
[data-felt="none"] {
  --felt: #166534;
  --felt-edge: #14532d;
}

[data-felt="felt-tier-III"] {
  --felt: #93c5fd;
}

.dark[data-felt="felt-tier-III"],
.dark [data-felt="felt-tier-III"] {
  --felt: #1d4ed8;
}
`;

function sampleSolver() {
  const themes = parseThemes(FELT_CSS);
  return { themes, result: evaluateSolver(themes, readActionColours(SAMPLE_ACTION_STYLE), readSizeShades(SAMPLE_ACTION_STYLE), readFelts(FELT_CSS, themes)) };
}

test("R3.13 O-389 readSizeShades reads the bet and raise size shades of both themes", () => {
  assert.deepEqual(readSizeShades(SAMPLE_ACTION_STYLE), { light: ["#b91c1c", "#991b1b"], dark: ["#f87171", "#202020"] });
  assert.deepEqual(readSizeShades("no shades here"), { light: [], dark: [] });
});

test("R3.13 O-389 readFelts reads the theme felt and every cosmetic felt in both themes", () => {
  const felts = readFelts(FELT_CSS, parseThemes(FELT_CSS));
  assert.deepEqual(
    felts.map((felt) => `${felt.theme} ${felt.name} ${felt.value}`),
    ["light felt #166534", "light felt none #166534", "light felt felt-tier-III #93c5fd", "dark felt #15803d", "dark felt felt-tier-III #1d4ed8"],
  );
});

test("R3.13 O-389 evaluateSolver fails an action colour, a size shade or a felt under 3:1 and table ink under 4.5:1", () => {
  const { result } = sampleSolver();
  const failures = result.failures.join("\n");
  // The light Call colour on the white sample ground, and the dark second size shade on black.
  assert.match(failures, /light: Call \(action\) #eeeeee on --surface is 1\.\d\d:1, under 3:1/);
  assert.match(failures, /dark: raise and bet size shade 2 #202020 on --surface is 1\.\d\d:1, under 3:1/);
  // The pale cosmetic felt fails the table's white ink.
  assert.ok(failures.includes(`light: table ink ${TABLE_INK} on felt felt-tier-III #93c5fd`), failures);
  assert.doesNotMatch(failures, /Fold \(action\)/);
  assert.ok(result.rows.some((row) => row.name === "Fold (action)" && row.pass));
});

test("R3.13 O-389 renderReport lists the solver colours as gating rows with their minimum", () => {
  const { themes, result } = sampleSolver();
  const report = renderReport(evaluate(themes, []), result);
  assert.match(report, /## Solver surface colours \(gating, O-389\)/);
  assert.match(report, /\| light \| Call \(action\) \| #eeeeee \| surface \| 1\.\d\d \| 3 \| FAIL \|/);
  assert.match(report, new RegExp(`Solver failures: ${result.failures.length}\\.`));
});

test("R3.13 O-389 every action colour, size shade and felt passes in both themes", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const source = readFileSync(ACTION_STYLE_PATH, "utf8");
  const themes = parseThemes(css);
  const actions = readActionColours(source);
  const shades = readSizeShades(source);
  const felts = readFelts(css, themes);
  // Review round 1: the gate must have read what it checks. Eight action kinds, four size shades and
  // five felts (the theme's and four cosmetic) per theme; a parser that silently reads nothing fails here.
  assert.deepEqual(
    actions.map((colour) => colour.name),
    ["Fold", "Check", "Call", "Limp", "Straddle", "Bet", "Raise", "All-in"],
  );
  assert.deepEqual([shades.light.length, shades.dark.length], [4, 4]);
  assert.deepEqual(["light", "dark"].map((theme) => felts.filter((felt) => felt.theme === theme).length), [5, 5]);
  const result = evaluateSolver(themes, actions, shades, felts);
  assert.deepEqual(result.failures, []);
});

test("R3.13 O-389 the solver gate fails loudly when it reads no action colours, no size shades or no felt for a theme", () => {
  const themes = parseThemes(FELT_CSS);
  const result = evaluateSolver(themes, [], { light: [], dark: ["#f87171"] }, readFelts(FELT_CSS, themes).filter((felt) => felt.theme === "light"));
  const failures = result.failures.join("\n");
  assert.match(failures, /no action colours read from web\/src\/theme\/action-style\.ts/);
  assert.match(failures, /light: no bet and raise size shades read/);
  assert.doesNotMatch(failures, /dark: no bet and raise size shades read/);
  assert.match(failures, /dark: no felt read/);
  assert.doesNotMatch(failures, /light: no felt read/);
});
