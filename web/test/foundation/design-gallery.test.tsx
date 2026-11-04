/**
 * The design system gallery's press demo and the light press cue (S48 critic G2 and G10 on
 * design-press, design-press-reduced-motion and gallery-design-buttons, R3.13): the Before, Press
 * and hold, After row wraps at phone width instead of squeezing its held button, and the light
 * theme's pressed inset is deep enough to read on the oxblood primary fill at 1x, as the dark
 * theme's already does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignSystemSections } from "../../src/gallery/design-sections.js";

const STYLES = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

/** The body of the plain `:root {` (light) or `.dark {` block. */
function themeBlock(selector: string): string {
  const match = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(STYLES);
  return match?.[1] ?? "";
}

/** The first inset layer of a theme's --shadow-press-down: its colour and alpha. */
function pressInset(selector: string): { colour: string; alpha: number } | null {
  const match = /--shadow-press-down:\s*inset [^,]*?rgb\(([^/]+)\/\s*([0-9.]+)\)/.exec(themeBlock(selector));
  return match === null || match[1] === undefined || match[2] === undefined ? null : { colour: match[1].trim(), alpha: Number(match[2]) };
}

describe("R3.13 the gallery's press demo", () => {
  it("R3.13 the press row wraps at phone width, so the held button keeps its rest size (S48 critic G2)", () => {
    render(<DesignSystemSections />);
    expect(screen.getByTestId("press-row")).toHaveClass("flex-wrap");
    expect(screen.getByTestId("press-target")).toHaveTextContent("Press and hold");
  });

  it("R3.13 the light pressed inset is a black shade at least half opaque, so it reads on the oxblood fill (S48 critic G10)", () => {
    const light = pressInset(":root");
    const dark = pressInset(".dark");
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light?.colour).toBe("0 0 0");
    expect(light?.alpha ?? 0).toBeGreaterThanOrEqual(0.5);
    // The dark cue already read as a press (2.5:1); the light one is not weaker than it.
    expect(light?.alpha ?? 0).toBeGreaterThanOrEqual((dark?.alpha ?? 1) - 0.1);
  });
});
