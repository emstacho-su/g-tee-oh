/**
 * S36 review round 1 on the design system (R3.13, O-346): one layer scale so dialogs stack above
 * the sticky header; control edges on the token the contrast gate checks (WCAG 1.4.11), enforced
 * for the primitives and, by a source scan, for every text field, select and textarea in web/src;
 * Dialog built from the shared class constants and an overlay token for both themes; and the one
 * nav pill list that the Main navigation and the settings section list share.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Button,
  CONTROL_EDGE_CLASS,
  Dialog,
  DIALOG_LAYER_CLASS,
  FIELD_CLASS,
  FLAT_REST_CLASS,
  NAV_PILL_LINK_PROPS,
  OVERLAY_LAYER_CLASS,
  PillNav,
  RAISED_CLASS,
  TACTILE_CLASS,
  ToggleGroup,
} from "../../src/components/ui/index.js";

// vitest runs from web/ (the package root), as the other source-reading tests assume.
const SRC = join(process.cwd(), "src");
const STYLES = readFileSync(join(SRC, "styles.css"), "utf8");
/** A border on the decorative token, or any opacity on the strong one: not a checked control edge. */
const UNCHECKED_EDGE = /border-border(?!-strong)|border-border-strong\//;
const CONTROL_TAG = /<(input|select|textarea)\b/g;

function blockOf(selector: string): string {
  const match = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(STYLES);
  return match?.[1] ?? "";
}

function layer(name: string): number {
  const match = new RegExp(`--layer-${name}:\\s*(\\d+);`).exec(blockOf(":root"));
  return match === null ? Number.NaN : Number(match[1]);
}

function sourceFiles(directory: string, extensions: readonly string[] = [".tsx"]): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

/** The two homes of the layer scale: the tokens in styles.css and the classes in layers.ts. */
const LAYER_TOKENS_HOME = "styles.css";
const LAYER_CLASSES_HOME = "layers.ts";
const LAYER_RULES: readonly { pattern: RegExp; what: string; allowedIn?: string; only?: RegExp }[] = [
  { pattern: /(?<![\w-])-?z-(\d+|\[[^\]]+\]|auto)(?![\w-])/, what: "a Tailwind z-index class off the scale" },
  { pattern: /\bzIndex\s*[:=]/, what: "an inline zIndex style", only: /\.tsx?$/ },
  { pattern: /(?<![\w-])z-index\s*:/, what: "a raw z-index declaration", only: /\.css$/ },
  { pattern: /z-\(--layer-/, what: "a layer class outside layers.ts", allowedIn: LAYER_CLASSES_HOME },
  { pattern: /--layer-[a-z]+\s*:/, what: "a layer token outside styles.css", allowedIn: LAYER_TOKENS_HOME },
];

/** Every way a file under web/src picks a z-index off the one scale (S36 follow-up). */
function layerFaults(path: string, text: string): string[] {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return LAYER_RULES.filter((rule) => (rule.only === undefined || rule.only.test(path)) && rule.allowedIn !== name && rule.pattern.test(text)).map(
    (rule) => `${path}: ${rule.what}`,
  );
}

/** The opening tag starting at `start`, ending at the first > outside braces and quotes. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0 && source[index - 1] !== "=") return source.slice(start, index + 1);
  }
  return source.slice(start);
}

/** The tag plus the definitions of the same-file constants it names (INPUT_CLASSES and the like). */
function withLocalConstants(source: string, tag: string): string {
  const names = tag.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [];
  const definitions = names.map((name) => new RegExp(`const ${name}\\s*=\\s*([^;]+);`).exec(source)?.[1] ?? "");
  return [tag, ...definitions].join("\n");
}

describe("R3.13 one layer scale: dialogs above the sticky header", () => {
  it("R3.13 styles.css orders sticky < header < tooltip < overlay < dialog", () => {
    expect(layer("sticky")).toBeLessThan(layer("header"));
    expect(layer("header")).toBeLessThan(layer("tooltip"));
    expect(layer("tooltip")).toBeLessThan(layer("overlay"));
    expect(layer("overlay")).toBeLessThan(layer("dialog"));
  });

  it("R3.13 the layer scan catches every way to pick a z-index off the scale", () => {
    expect(layerFaults("a/Card.tsx", 'className="sticky z-10"')).toEqual(["a/Card.tsx: a Tailwind z-index class off the scale"]);
    expect(layerFaults("a/Pop.tsx", "style={{ zIndex: 5 }}")).toEqual(["a/Pop.tsx: an inline zIndex style"]);
    expect(layerFaults("a/pop.ts", "el.style.zIndex = '5';")).toEqual(["a/pop.ts: an inline zIndex style"]);
    expect(layerFaults("a/extra.css", ".pop { z-index: 5; }")).toEqual(["a/extra.css: a raw z-index declaration"]);
    expect(layerFaults("a/Pop.tsx", 'className="z-(--layer-dialog)"')).toEqual(["a/Pop.tsx: a layer class outside layers.ts"]);
    expect(layerFaults("a/extra.css", ":root { --layer-popover: 45; }")).toEqual(["a/extra.css: a layer token outside styles.css"]);
    // The two homes are allowed their own part of the scale.
    expect(layerFaults("components/ui/layers.ts", 'export const X = "z-(--layer-dialog)";')).toEqual([]);
    expect(layerFaults("styles.css", ":root { --layer-dialog: 50; }")).toEqual([]);
  });

  it("R3.13 nothing under web/src (.ts, .tsx, .css) picks its own z-index: every layer comes from the scale (S36 follow-up)", () => {
    const offenders = sourceFiles(SRC, [".ts", ".tsx", ".css"]).flatMap((file) => layerFaults(relative(SRC, file), readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("R3.13 an open Dialog's overlay and content take the overlay and dialog layers", () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Keyboard shortcuts">
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveClass(DIALOG_LAYER_CLASS);
    expect(screen.getByTestId("dialog-overlay")).toHaveClass(OVERLAY_LAYER_CLASS);
  });
});

describe("R3.13 Dialog uses the shared constants and the overlay token", () => {
  it("R3.13 raised content, a tactile flat close button and the overlay token", () => {
    render(
      <Dialog open onOpenChange={() => undefined} title="Shortcuts">
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass(RAISED_CLASS);
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(TACTILE_CLASS, FLAT_REST_CLASS);
    expect(screen.getByTestId("dialog-overlay")).toHaveClass("bg-overlay");
    expect(blockOf(":root")).toMatch(/--overlay:\s*rgb\(/);
    expect(blockOf(".dark")).toMatch(/--overlay:\s*rgb\(/);
  });
});

describe("R3.13 control edges use the checked token (WCAG 1.4.11)", () => {
  it("R3.13 the control edge and field classes are the strong token at full opacity", () => {
    expect(CONTROL_EDGE_CLASS).toContain("border-border-strong");
    expect(CONTROL_EDGE_CLASS).not.toMatch(UNCHECKED_EDGE);
    expect(FIELD_CLASS).toContain(CONTROL_EDGE_CLASS);
    expect(FIELD_CLASS).not.toMatch(UNCHECKED_EDGE);
  });

  it("R3.13 the secondary Button and the ToggleGroup track draw the checked edge", () => {
    render(
      <>
        <Button variant="secondary">Edge</Button>
        <ToggleGroup label="Mode" value="a" options={[{ value: "a", label: "A" }]} onValueChange={() => undefined} />
      </>,
    );
    const button = screen.getByRole("button", { name: "Edge" });
    expect(button.className).toContain("border-border-strong");
    expect(button.className).not.toMatch(UNCHECKED_EDGE);
    const track = screen.getByRole("radiogroup", { name: "Mode" });
    expect(track.className).toContain("border-border-strong");
    expect(track.className).not.toMatch(UNCHECKED_EDGE);
  });

  it("R3.13 no text field, select or textarea in web/src draws an unchecked edge", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(CONTROL_TAG)) {
        const tag = openingTag(source, match.index);
        if (UNCHECKED_EDGE.test(withLocalConstants(source, tag))) offenders.push(`${relative(SRC, file)}: ${tag.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("R3.13 the shared nav pill list", () => {
  it("R3.13 PillNav is a labelled nav over one scrolling row that becomes a column from md", () => {
    render(
      <PillNav label="Sections">
        <li>
          <a href="/a">A</a>
        </li>
      </PillNav>,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(screen.getByRole("list")).toHaveClass("flex-nowrap", "overflow-x-auto", "md:flex-col");
    expect(nav).toContainElement(screen.getByRole("link", { name: "A" }));
  });

  it("R3.13 the pill link props carry the press, with active and inactive classes that never overlap", () => {
    expect(NAV_PILL_LINK_PROPS.className).toContain(TACTILE_CLASS);
    const active = NAV_PILL_LINK_PROPS.activeProps.className.split(" ");
    const inactive = NAV_PILL_LINK_PROPS.inactiveProps.className.split(" ");
    expect(active.filter((name) => inactive.includes(name))).toEqual([]);
    expect(active).toContain("font-semibold");
  });
});
