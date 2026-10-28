// Tests for scripts/check-contrast.mjs (R3.13, O-346, O-365): the WCAG 2 math on known pairs,
// the token parser on a synthetic stylesheet, and the committed web/src/styles.css, which must
// carry the owner's five palette primitives, name the source hue of every checked colour and pass
// every gating pair in both themes. node:test, run by `pnpm run test:scripts` (just ts-test).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  GATING_PAIRS,
  PRIMITIVE_PREFIX,
  STYLES_PATH,
  contrastRatio,
  evaluate,
  parseThemes,
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
  const report = renderReport(evaluate(themes, [{ fg: "text", bg: "surface", min: 4.5, use: "body text" }]), []);
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
