// Tests for the S43 gates of scripts/check-contrast.mjs (R3.13, O-430, O-432 to O-434): the neutral
// gray and black dark base, read colour by colour from every form CSS allows (failing closed on a
// form it cannot read), and the marks drawn over solver fills in both themes: the focus ring (the
// text colour with a halo of the raised ground) and the selection mark (--selected with the same
// halo). node:test, run by `pnpm run test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACTION_STYLE_PATH,
  EV_STEP_COUNT,
  GATING_PAIRS,
  MATRIX_THEME_PATH,
  NEUTRAL_DARK_TOKENS,
  NEUTRAL_MAX_SATURATION,
  STYLES_PATH,
  evaluate,
  evaluateNeutral,
  evaluateSelectionMark,
  hslSaturation,
  parseThemes,
  readActionColours,
  readEvSteps,
  readSizeShades,
  renderReport,
  scanColours,
} from "./check-contrast.mjs";

const NEUTRAL_CSS = `
:root {
  --surface: #ffffff; /* from e7d7c1 cream, lifted */
  --gap: 4px;
  --overlay: rgb(28 18 16 / 0.55);
  --shadow-raised: 0 1px 2px rgb(115 87 81 / 0.16);
}

.dark {
  --surface: #1c1210; /* from 735751 umber, deepened */
  --text: #ececec; /* from no palette hue: a neutral off-white */
  --border: var(--gap);
  --shadow-raised: inset 0 1px 0 rgb(231 215 193 / 0.07), 0 1px 2px rgb(0 0 0 / 0.5);
  --shadow-press-rest: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 1px 2px #000, 0 2px 4px black;
  --shadow-press-down: inset 0 2px 5px var(--surface);
  --shadow-press-hover: 0 1px 2px #735751cc, 0 2px 4px #0008;
  --shadow-hsl: 0 1px 2px hsl(10 18% 38% / 0.4), 0 2px 4px hsl(0 0% 0% / 0.5);
  --shadow-oklch: 0 1px 2px oklch(0.45 0.05 35);
  --shadow-named: 0 1px 2px sienna, 0 0 0 1px transparent;
  --shadow-percent: 0 1px 2px rgb(45% 34% 32% / 0.2), 0 1px 1px rgb(10% 10% 10%);
}
`;

function neutralFailures(tokens) {
  return evaluateNeutral(NEUTRAL_CSS, parseThemes(NEUTRAL_CSS), tokens).failures.join("\n");
}

test("R3.13 O-430 hslSaturation is 0 for grays and high for the old browns", () => {
  assert.equal(hslSaturation("#000000"), 0);
  assert.equal(hslSaturation("#ffffff"), 0);
  assert.equal(hslSaturation("#1e1e1e"), 0);
  assert.equal(hslSaturation("#ff0000"), 1);
  // The old dark ground and the taupe control edge sit well over the threshold.
  assert.ok(hslSaturation("#1c1210") > 0.25, String(hslSaturation("#1c1210")));
  assert.ok(hslSaturation("#a78a7f") > 0.18, String(hslSaturation("#a78a7f")));
  assert.ok(NEUTRAL_MAX_SATURATION > 0 && NEUTRAL_MAX_SATURATION < 0.18);
});

test("R3.13 O-430 evaluateNeutral fails a tinted token, a tinted shadow layer, an inherited light value and a var() it cannot follow", () => {
  const failures = neutralFailures(["surface", "text", "overlay", "shadow-raised", "shadow-press-rest", "shadow-press-down", "border-strong"]);
  assert.match(failures, /--surface #1c1210 is not neutral: HSL saturation 2\d\.\d%/);
  assert.match(failures, /--shadow-raised rgb\(231 215 193\) is not neutral/);
  // The dark theme inherits the light overlay, which is tinted: the effective dark value is checked.
  assert.match(failures, /--overlay rgb\(28 18 16\) is not neutral/);
  assert.match(failures, /--shadow-press-down uses var\(\) inside its value/);
  assert.match(failures, /--border-strong is not declared/);
  assert.doesNotMatch(failures, /--text/);
  // #000, black and rgba() with commas are all read, and all neutral.
  assert.doesNotMatch(failures, /--shadow-press-rest/);
});

test("R3.13 O-430 review finding 3: 8-digit hex and hsl() browns fail, 4-digit hex and neutral hsl() pass", () => {
  const failures = neutralFailures(["shadow-press-hover", "shadow-hsl"]);
  assert.match(failures, /--shadow-press-hover #735751cc is not neutral/);
  assert.doesNotMatch(failures, /#0008/);
  assert.match(failures, /--shadow-hsl hsl\(10 18% 38% \/ 0\.4\) is not neutral/);
  assert.doesNotMatch(failures, /hsl\(0 0% 0%/);
});

test("R3.13 O-430 review finding 3: percentage rgb() is read, and a colour form or name the check cannot read fails closed", () => {
  const failures = neutralFailures(["shadow-percent", "shadow-oklch", "shadow-named"]);
  assert.match(failures, /--shadow-percent rgb\(115 87 82\) is not neutral/);
  assert.doesNotMatch(failures, /rgb\(26 26 26\)/);
  assert.match(failures, /--shadow-oklch holds oklch\(\), which the neutral check cannot read/);
  assert.match(failures, /--shadow-named holds "sienna", which the neutral check cannot read/);
  assert.doesNotMatch(failures, /"transparent"/);
});

test("R3.13 O-430 review round 2 finding 7: none and the CSS-wide keywords are not colours and never fail the neutral gate", () => {
  for (const value of ["none", "initial", "inherit", "unset", "revert", "revert-layer"]) {
    const scan = scanColours(value);
    assert.deepEqual([scan.colours, scan.unreadable], [[], []], value);
  }
  const css = ":root {\n  --shadow-raised: none;\n}\n\n.dark {\n  --shadow-press-rest: none, 0 1px 2px #000;\n}\n";
  const result = evaluateNeutral(css, parseThemes(css), ["shadow-raised", "shadow-press-rest"]);
  // A token that is only "none" holds no colour to check: it passes with an empty colour list.
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.rows.map((row) => `${row.name} ${row.colours.join(" ")}`), ["shadow-raised ", "shadow-press-rest #000"]);
});

test("R3.13 O-430 scanColours gives each colour as #rrggbb, so callers compare copies without their own parser", () => {
  const scan = scanColours("0 1px 2px rgba(30, 30, 30, 0.8), inset 0 1px 0 #fff8, hsl(0 0% 50%)");
  assert.deepEqual(scan.colours.map((colour) => colour.hex), ["#1e1e1e", "#ffffff", "#808080"]);
});

test("R3.13 O-430 review finding 8: a var() that resolves to no colour is a neutral failure, not a thrown error", () => {
  assert.match(neutralFailures(["border"]), /--border is var\(--gap\), which resolves to no colour/);
});

test("R3.13 O-430 renderReport lists the neutral dark base as gating rows", () => {
  const themes = parseThemes(NEUTRAL_CSS);
  const neutral = evaluateNeutral(NEUTRAL_CSS, themes, ["surface", "text"]);
  const report = renderReport(evaluate(themes, []), undefined, [], neutral);
  assert.match(report, /## Neutral dark base \(gating, O-430\)/);
  assert.match(report, /\| surface \| #1c1210 \| 2\d\.\d% \| 10% \| FAIL \|/);
  assert.match(report, /\| text \| #ececec \| 0\.0% \| 10% \| pass \|/);
  assert.match(report, new RegExp(`Neutral failures: ${neutral.failures.length}\\.`));
});

test("R3.13 O-430 the dark grounds, edges, text, inks, focus ring, overlay and shadows of styles.css are neutral gray and black", () => {
  assert.deepEqual(
    [...NEUTRAL_DARK_TOKENS],
    [
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
    ],
  );
  const css = readFileSync(STYLES_PATH, "utf8");
  assert.deepEqual(evaluateNeutral(css, parseThemes(css)).failures, []);
});

// The marks drawn over solver fills (O-432, O-433, O-434; review round 2). The focus ring is the
// text colour with a halo of the raised ground in both themes, gated by one 9:1 pair (WCAG technique
// C40: one of the two then reaches 3:1 on any fill). The selection mark is the --selected red with
// the same halo; its pair does not reach 9:1 in light, so every fill it is drawn over is gated.

const MATRIX_SOURCE = `
const LIGHT: MatrixPalette = {
  evNegative: [
    "#f1cecb", // a
    "#940017", // b
  ],
  evNeutral: "#f1eae3", // c
  evPositive: ["#c6d9f2", "#004b96"],
};

const DARK: MatrixPalette = {
  evNegative: [
    "#593d3a", // a
    "#ffb0a9", // b
  ],
  evNeutral: NEUTRAL, // a constant: not read
  evPositive: ["#37465a", "#a2caff"],
};
`;

const MARK_CSS = `
:root {
  --surface: #ffffff; /* from e7d7c1 cream, lifted */
  --surface-raised: #ffffff; /* from e7d7c1 cream, lifted */
  --focus: #2b1a16; /* from 735751 umber, deepened */
  --focus-halo: var(--surface-raised);
  --selected: #8c1c13; /* from 8c1c13 oxblood */
  --heat-1: #d1a195; /* from 735751 umber hue */
}

.dark {
  --surface: #141414; /* from no palette hue */
  --surface-raised: #1e1e1e; /* from no palette hue */
  --focus: #ececec; /* from no palette hue */
  --selected: #9a9a9a; /* from no palette hue: too dark for a selection mark */
  --heat-1: #7e4739; /* from 735751 umber hue */
}
`;

const ACTIONS = `
export const ACTION_STYLES = {
  fold: { kind: "fold", short: "F", name: "Fold", pattern: "none", color: { light: "#2563eb", dark: "#3b82f6" } },
};
const SIZE_SHADES = {
  light: ["#dc2626"],
  dark: ["#fca5a5"],
};
`;

function sampleMarks() {
  const themes = parseThemes(MARK_CSS);
  return evaluateSelectionMark(themes, {
    actionColours: readActionColours(ACTIONS),
    sizeShades: readSizeShades(ACTIONS),
    evSteps: readEvSteps(MATRIX_SOURCE),
    heatSteps: ["heat-1"],
  });
}

test("R3.13 O-432 readEvSteps reads both themes' EV steps from matrix-theme.ts, negative, neutral, positive", () => {
  const steps = readEvSteps(MATRIX_SOURCE);
  assert.deepEqual(
    steps.light.map((step) => `${step.name} ${step.value}`),
    ["EV step -1 #f1cecb", "EV step -2 #940017", "EV neutral #f1eae3", "EV step +1 #c6d9f2", "EV step +2 #004b96"],
  );
  // The dark neutral is a constant, which the reader skips: the step count check below catches it.
  assert.equal(steps.dark.length, 4);
  assert.deepEqual(readEvSteps("nothing here"), { light: [], dark: [] });
});

test("R3.13 O-434 review round 2 finding 4: the selection gate fails when it reads other than the 11 EV steps per theme", () => {
  assert.equal(EV_STEP_COUNT, 11);
  const failures = sampleMarks().failures.join("\n");
  assert.match(failures, /light: read 5 EV steps from web\/src\/components\/range-matrix\/matrix-theme\.ts, expected 11/);
  assert.match(failures, /dark: read 4 EV steps from web\/src\/components\/range-matrix\/matrix-theme\.ts, expected 11/);
});

test("R3.13 O-434 the selection gate fails a fill where neither the mark nor its halo reaches 3:1, in either theme", () => {
  const result = sampleMarks();
  const failures = result.failures.join("\n");
  // A mid-dark fill: neither the #9a9a9a mark nor the #1e1e1e halo reaches 3:1 on heat step 1.
  assert.match(failures, /dark: selection mark #9a9a9a with halo #1e1e1e on --heat-1 #7e4739 is \d\.\d\d:1, under 3:1/);
  assert.doesNotMatch(failures, /Fold \(action\)/);
  // Light is gated too (O-433): the oxblood mark with the white halo passes on the light fills here.
  assert.doesNotMatch(failures, /light: selection mark/);
  assert.deepEqual([...new Set(result.rows.map((row) => row.theme))], ["light", "dark"]);
});

test("R3.13 O-432 O-434 the focus ring pair is gated at 9:1 in both themes, and the selection mark at 3:1 on every ground", () => {
  const focusPair = GATING_PAIRS.find((pair) => pair.fg === "focus" && pair.bg === "focus-halo");
  assert.equal(focusPair?.min, 9);
  assert.deepEqual(
    GATING_PAIRS.filter((pair) => pair.fg === "selected").map((pair) => `${pair.bg} ${pair.min}`),
    ["surface 3", "surface-raised 3", "surface-sunken 3"],
  );
  const result = evaluate(parseThemes(MARK_CSS), [focusPair]);
  assert.deepEqual(result.rows.map((row) => row.theme), ["light", "dark"]);
  assert.deepEqual(result.failures, []);
});

test("R3.13 O-434 renderReport lists the selection mark rows", () => {
  const themes = parseThemes(MARK_CSS);
  const report = renderReport(evaluate(themes, []), undefined, [], undefined, sampleMarks());
  assert.match(report, /## Selection mark on the solver fills \(gating, O-434\)/);
  assert.match(report, /\| dark \| --heat-1 \| #7e4739 \| mark #9a9a9a, halo #1e1e1e \| \d\.\d\d \| 3 \| FAIL \|/);
  assert.match(report, /\| light \| Fold \(action\) \| #2563eb \| mark #8c1c13, halo #ffffff \| \d\.\d\d \| 3 \| pass \|/);
  // Review round 2 finding 5: the report no longer says focus is one of the reds left out.
  assert.doesNotMatch(report, /accent, focus and danger/);
});

test("R3.13 O-434 the selection mark reaches 3:1 on every action fill, size shade, EV step and heat step in both themes", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const actionSource = readFileSync(ACTION_STYLE_PATH, "utf8");
  const evSteps = readEvSteps(readFileSync(MATRIX_THEME_PATH, "utf8"));
  assert.deepEqual([evSteps.light.length, evSteps.dark.length], [EV_STEP_COUNT, EV_STEP_COUNT]);
  const result = evaluateSelectionMark(parseThemes(css), {
    actionColours: readActionColours(actionSource),
    sizeShades: readSizeShades(actionSource),
    evSteps,
    heatSteps: ["heat-1", "heat-2", "heat-3", "heat-4", "heat-5"],
  });
  assert.deepEqual(result.failures, []);
  // Per theme: 8 actions, 4 size shades, 11 EV steps and 5 heat steps.
  assert.equal(result.rows.length, 2 * 28);
});

test("R3.13 O-432 O-434 the focus ring and the selection mark pass their pairs in styles.css in both themes", () => {
  const pairs = GATING_PAIRS.filter((pair) => pair.fg === "focus" || pair.fg === "selected");
  assert.deepEqual(evaluate(parseThemes(readFileSync(STYLES_PATH, "utf8")), pairs).failures, []);
});
