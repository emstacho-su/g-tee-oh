// Tests for the dark theme gates of scripts/check-contrast.mjs (S43, R3.13, O-430, O-432): the
// neutral gray and black dark base, read colour by colour from every form CSS allows (failing
// closed on a form it cannot read), and the dark focus ring, a neutral near-white with a halo of
// the ground, against every solver fill it is drawn over. node:test, run by `pnpm run test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACTION_STYLE_PATH,
  GATING_PAIRS,
  MATRIX_THEME_PATH,
  NEUTRAL_DARK_TOKENS,
  NEUTRAL_MAX_SATURATION,
  STYLES_PATH,
  evaluate,
  evaluateFocusRing,
  evaluateNeutral,
  hslSaturation,
  parseThemes,
  readActionColours,
  readEvSteps,
  readFelts,
  readSizeShades,
  renderReport,
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

// The dark focus ring (O-432 rejected by the PM's ruling): a neutral near-white with a halo of the
// ground inside it, so one of the two reaches 3:1 on any fill it is drawn over.

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
  evNeutral: "#333333", // c
  evPositive: ["#37465a", "#a2caff"],
};
`;

const FOCUS_CSS = `
:root {
  --surface: #ffffff; /* from e7d7c1 cream, lifted */
  --surface-raised: #ffffff; /* from e7d7c1 cream, lifted */
  --focus: #bf4342; /* from bf4342 brick */
  --focus-halo: var(--surface-raised);
  --heat-1: #7e4739; /* from 735751 umber hue */
  --felt: #166534;
}

.dark {
  --surface: #141414; /* from no palette hue */
  --surface-raised: #1e1e1e; /* from no palette hue */
  --focus: #9a9a9a; /* from no palette hue: too dark for a two-colour ring */
  --heat-1: #7e4739; /* from 735751 umber hue */
  --felt: #15803d;
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

function sampleFocus(css = FOCUS_CSS) {
  const themes = parseThemes(css);
  return evaluateFocusRing(themes, {
    actionColours: readActionColours(ACTIONS),
    sizeShades: readSizeShades(ACTIONS),
    evSteps: readEvSteps(MATRIX_SOURCE),
    heatSteps: ["heat-1"],
    felts: readFelts(css, themes),
  });
}

test("R3.13 O-432 readEvSteps reads both themes' EV steps from matrix-theme.ts, negative, neutral, positive", () => {
  const steps = readEvSteps(MATRIX_SOURCE);
  assert.deepEqual(
    steps.dark.map((step) => `${step.name} ${step.value}`),
    ["EV step -1 #593d3a", "EV step -2 #ffb0a9", "EV neutral #333333", "EV step +1 #37465a", "EV step +2 #a2caff"],
  );
  assert.equal(steps.light.length, 5);
  assert.deepEqual(readEvSteps("nothing here"), { light: [], dark: [] });
});

test("R3.13 O-432 the focus gate fails a fill where neither the ring nor its halo reaches 3:1, and a felt under 3:1 to the ring", () => {
  const result = sampleFocus();
  const failures = result.failures.join("\n");
  // A mid-dark fill: neither the #9a9a9a ring nor the #1e1e1e halo reaches 3:1 on heat step 1.
  assert.match(failures, /dark: focus ring #9a9a9a with halo #1e1e1e on --heat-1 #7e4739 is \d\.\d\d:1, under 3:1/);
  assert.doesNotMatch(failures, /Fold \(action\)/);
  assert.match(failures, /dark: focus ring #9a9a9a on felt #15803d is \d\.\d\d:1, under 3:1 \(the active seat ring\)/);
  // The light pale size shade is not gated: the dark theme is the ruling's scope (O-432).
  assert.ok(result.rows.every((row) => row.theme === "dark"));
  assert.ok(result.rows.some((row) => row.name === "raise and bet size shade 1" && row.pass));
});

test("R3.13 O-432 the focus gate fails loudly when it reads no EV steps", () => {
  const themes = parseThemes(FOCUS_CSS);
  const result = evaluateFocusRing(themes, {
    actionColours: readActionColours(ACTIONS),
    sizeShades: readSizeShades(ACTIONS),
    evSteps: { light: [], dark: [] },
    heatSteps: ["heat-1"],
    felts: readFelts(FOCUS_CSS, themes),
  });
  assert.match(result.failures.join("\n"), /dark: no EV steps read from web\/src\/components\/range-matrix\/matrix-theme\.ts/);
});

test("R3.13 O-432 the two-colour ring pair is gated at 9:1 in dark only, and a pair limited to one theme is skipped in the other", () => {
  const pair = GATING_PAIRS.find((candidate) => candidate.fg === "focus" && candidate.bg === "focus-halo");
  assert.deepEqual(pair && { min: pair.min, themes: pair.themes }, { min: 9, themes: ["dark"] });
  const result = evaluate(parseThemes(FOCUS_CSS), [pair]);
  assert.deepEqual(result.rows.map((row) => row.theme), ["dark"]);
  assert.match(result.failures.join("\n"), /dark: --focus on --focus-halo is \d\.\d\d:1, under 9:1/);
});

test("R3.13 O-432 renderReport lists the focus ring rows", () => {
  const themes = parseThemes(FOCUS_CSS);
  const report = renderReport(evaluate(themes, []), undefined, [], undefined, sampleFocus());
  assert.match(report, /## Focus ring on the solver fills \(gating, O-432\)/);
  assert.match(report, /\| dark \| --heat-1 \| #7e4739 \| ring #9a9a9a, halo #1e1e1e \| \d\.\d\d \| 3 \| FAIL \|/);
  assert.match(report, /\| dark \| Fold \(action\) \| #3b82f6 \| ring #9a9a9a, halo #1e1e1e \| \d\.\d\d \| 3 \| pass \|/);
});

test("R3.13 O-432 the dark focus ring reaches 3:1 on every action fill, size shade, EV step, heat step and felt it is drawn over", () => {
  const css = readFileSync(STYLES_PATH, "utf8");
  const actionSource = readFileSync(ACTION_STYLE_PATH, "utf8");
  const themes = parseThemes(css);
  const evSteps = readEvSteps(readFileSync(MATRIX_THEME_PATH, "utf8"));
  // Five negative steps, the neutral and five positive steps per theme.
  assert.deepEqual([evSteps.light.length, evSteps.dark.length], [11, 11]);
  const result = evaluateFocusRing(themes, {
    actionColours: readActionColours(actionSource),
    sizeShades: readSizeShades(actionSource),
    evSteps,
    heatSteps: ["heat-1", "heat-2", "heat-3", "heat-4", "heat-5"],
    felts: readFelts(css, themes),
  });
  assert.deepEqual(result.failures, []);
  // 8 actions, 4 size shades, 11 EV steps, 5 heat steps and 5 felts.
  assert.equal(result.rows.length, 33);
});
