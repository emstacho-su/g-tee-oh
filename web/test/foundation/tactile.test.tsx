/**
 * Tactile Digital primitives (S36, R3.13, O-346, O-364): every pressable primitive carries the one
 * shared press implementation (the tactile utility), every card the raised one, and the press in
 * styles.css is transform only (no layout shift), springs back and stops moving under reduced
 * motion. jsdom has no layout or :active, so the CSS contract is read from the stylesheet itself;
 * the design-system shots measure the real press in Chromium.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, Card, ToggleGroup, type ButtonVariant } from "../../src/components/ui/index.js";
import { TACTILE_CLASS } from "../../src/components/ui/tactile.js";

// vitest runs from web/ (the package root), as the other source-reading tests assume.
const STYLES = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];

/** The text of the `@utility <name> { ... }` block, nested braces included. */
function utilityBlock(name: string): string {
  const start = STYLES.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  let depth = 0;
  for (let index = STYLES.indexOf("{", start); index < STYLES.length; index += 1) {
    if (STYLES[index] === "{") depth += 1;
    if (STYLES[index] === "}") depth -= 1;
    if (depth === 0) return STYLES.slice(start, index + 1);
  }
  return "";
}

/** The declarations directly inside the first nested rule whose selector contains `selector`. */
function ruleBody(block: string, selector: string): string {
  const at = block.indexOf(selector);
  if (at < 0) return "";
  const open = block.indexOf("{", at);
  return block.slice(open + 1, block.indexOf("}", open));
}

function propertiesOf(body: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.split(":")[0]?.trim() ?? "")
    .filter((property) => property !== "");
}

describe("R3.13 tactile primitives (O-346)", () => {
  it.each(VARIANTS)("R3.13 Button variant %s carries the shared tactile press", (variant) => {
    render(<Button variant={variant}>Press</Button>);
    expect(screen.getByRole("button", { name: "Press" })).toHaveClass(TACTILE_CLASS);
  });

  it("R3.13 Button rendered as a link through asChild keeps the tactile press", () => {
    render(
      <Button asChild variant="primary">
        <a href="/train">Start</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Start" })).toHaveClass(TACTILE_CLASS);
  });

  it("R3.13 the ghost Button drops only the resting shadow, not the press", () => {
    render(<Button variant="ghost">Flat</Button>);
    const button = screen.getByRole("button", { name: "Flat" });
    expect(button).toHaveClass(TACTILE_CLASS);
    expect(button.className).toContain("[--tactile-rest:none]");
  });

  it("R3.13 every ToggleGroup item carries the tactile press", () => {
    const options = [
      { value: "a", label: "First" },
      { value: "b", label: "Second" },
    ] as const;
    render(<ToggleGroup label="Choice" value="a" options={options} onValueChange={() => undefined} />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveClass(TACTILE_CLASS);
  });

  it("R3.13 Card is a labelled region on the raised surface with optional description and actions", () => {
    render(
      <Card title="Streak" description="Days in a row" actions={<button type="button">Act</button>} testId="streak">
        <p>body</p>
      </Card>,
    );
    const region = screen.getByRole("region", { name: "Streak" });
    expect(region).toHaveClass("raised");
    expect(region).toHaveClass("bg-surface-raised");
    expect(region).toHaveAttribute("data-testid", "streak");
    expect(screen.getByRole("heading", { level: 2, name: "Streak" })).toBeInTheDocument();
    expect(screen.getByText("Days in a row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
  });

  it("R3.13 Card takes a heading level for cards nested under a section heading", () => {
    render(
      <Card title="Top leaks" headingLevel={3}>
        <p>body</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Top leaks" })).toBeInTheDocument();
  });
});

describe("R3.13 the press in styles.css (O-364)", () => {
  const tactile = utilityBlock("tactile");

  it("R3.13 the tactile and raised utilities exist and read the depth tokens", () => {
    expect(tactile).not.toBe("");
    expect(tactile).toContain("var(--shadow-press-rest)");
    expect(utilityBlock("raised")).toContain("var(--shadow-raised)");
  });

  it("R3.13 pressing squishes wider and shorter and sinks, through transform only", () => {
    const pressed = ruleBody(tactile, "&:active:not(:disabled)");
    expect(pressed).toMatch(/transform:\s*translateY\(1px\)\s*scale\(1\.0\d+,\s*0\.9\d*\)/);
    // Transform only: no property that changes the box's layout size or position in the flow.
    expect(propertiesOf(pressed).sort()).toEqual(["box-shadow", "transform", "transition-duration"]);
    expect(propertiesOf(ruleBody(tactile, "&:hover:not(:disabled)")).sort()).toEqual(["box-shadow", "transform"]);
  });

  it("R3.13 the release springs back on the overshoot curve", () => {
    expect(tactile).toMatch(/transform \d+ms var\(--ease-spring\)/);
    expect(STYLES).toMatch(/--ease-spring:\s*cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
  });

  it("R3.13 reduced motion removes every transform while the shadow still shows the press", () => {
    const reduced = tactile.slice(tactile.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("&:active:not(:disabled)");
    expect(reduced).toMatch(/transform:\s*none/);
    expect(reduced).not.toContain("box-shadow");
  });
});
