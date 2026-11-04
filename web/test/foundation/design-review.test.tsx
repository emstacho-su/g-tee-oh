/**
 * S36 review round 1 on the design system (R3.13, O-346): one layer scale so dialogs stack above
 * the sticky header; control edges on the token the contrast gate checks (WCAG 1.4.11), enforced
 * for the primitives and, by a source scan, for every text field, select and textarea in web/src;
 * Dialog built from the shared class constants and an overlay token for both themes; and the one
 * nav pill list that the Main navigation and the settings section list share.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { overflowOf } from "../../src/components/ui/PillNav.js";

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

  /** jsdom lays nothing out, so the row's and the pills' measures are set by hand. */
  function measure(element: Element, values: Readonly<Record<string, number>>): void {
    for (const [name, value] of Object.entries(values)) Object.defineProperty(element, name, { value, configurable: true });
  }

  interface Pill {
    readonly name: string;
    /** The link text, the name unless a marker is appended (BuilderNav's ", needs a fix"). */
    readonly label?: string;
  }

  function rowOf(current: string, pills: readonly Pill[] = [{ name: "A" }, { name: "B" }, { name: "C" }]) {
    return (
      <PillNav label="Sections">
        {pills.map((pill) => (
          <li key={pill.name}>
            <a href={`/${pill.name}`} {...(pill.name === current ? { "aria-current": "page" as const } : {})}>
              {pill.label ?? pill.name}
            </a>
          </li>
        ))}
      </PillNav>
    );
  }

  /** Lays the pills out 250 px apart, 80 px wide, in a 300 px row with 600 px of content. */
  function layOut(list: Element, names: readonly string[], width = 80): void {
    measure(list, { clientWidth: 300, scrollWidth: 600, offsetLeft: 0 });
    for (const [index, name] of names.entries()) measure(screen.getByRole("link", { name: new RegExp(`^${name}`) }), { offsetLeft: index * 250, offsetWidth: width });
  }

  function renderRow(current: string) {
    const view = render(rowOf(current));
    const list = screen.getByRole("list");
    layOut(list, ["A", "B", "C"]);
    // The measures landed after the mount, so the row is told to look again.
    fireEvent.scroll(list);
    return { ...view, list };
  }

  it("R3.13 the row's edge cues show only toward the pills beyond the edge, and follow the scroll (S48 critic G2)", () => {
    const { list } = renderRow("A");
    const cue = (side: "start" | "end") => screen.getByTestId(`nav-${side}-fade`);
    expect(cue("start")).toHaveAttribute("aria-hidden", "true");
    expect(cue("end")).toHaveAttribute("aria-hidden", "true");
    // Nothing is scrolled: pills lie beyond the end only.
    expect(cue("start")).toHaveAttribute("data-shown", "false");
    expect(cue("end")).toHaveAttribute("data-shown", "true");
    list.scrollLeft = 300;
    fireEvent.scroll(list);
    expect(cue("start")).toHaveAttribute("data-shown", "true");
    expect(cue("end")).toHaveAttribute("data-shown", "false");
  });

  it("R3.13 the aria-current pill is scrolled into the row when the page changes, by the row's own scroll (S48 critic G10)", async () => {
    const { list, rerender } = renderRow("A");
    expect(list.scrollLeft).toBe(0);
    rerender(rowOf("C"));
    // C sits at 500 to 580 in a 300 px row: scrolled so its right edge plus the pad is in view.
    await waitFor(() => expect(list.scrollLeft).toBe(296));
    rerender(rowOf("A"));
    await waitFor(() => expect(list.scrollLeft).toBe(0));
  });

  it("R3.13 the cues and the reveal follow a change of the pills themselves: one added, one widened (code review round 1, 1)", async () => {
    const { rerender } = render(rowOf("B", [{ name: "A" }, { name: "B" }]));
    const list = screen.getByRole("list");
    // Two pills fit the row: no cue either way.
    measure(list, { clientWidth: 300, scrollWidth: 300, offsetLeft: 0 });
    fireEvent.scroll(list);
    expect(screen.getByTestId("nav-end-fade")).toHaveAttribute("data-shown", "false");
    // A third pill arrives (the admin pills once the session resolves) and is the current one, beyond the edge.
    rerender(rowOf("C", [{ name: "A" }, { name: "B" }, { name: "C" }]));
    layOut(list, ["A", "B", "C"]);
    await waitFor(() => expect(list.scrollLeft).toBe(296));
    expect(screen.getByTestId("nav-start-fade")).toHaveAttribute("data-shown", "true");
    // The current pill widens (", needs a fix"): the reveal follows its new right edge.
    rerender(rowOf("C", [{ name: "A" }, { name: "B" }, { name: "C", label: "C, needs a fix" }]));
    layOut(list, ["A", "B", "C"], 160);
    await waitFor(() => expect(list.scrollLeft).toBe(376));
  });

  it("R3.13 overflowOf ignores a sub-pixel scroll at either edge, so a fractional reveal shows no start chevron at rest (code review round 1, 2)", () => {
    expect(overflowOf({ scrollLeft: 0.5, clientWidth: 300, scrollWidth: 600 })).toEqual({ start: false, end: true });
    expect(overflowOf({ scrollLeft: 2, clientWidth: 300, scrollWidth: 600 })).toEqual({ start: true, end: true });
    expect(overflowOf({ scrollLeft: 299.5, clientWidth: 300, scrollWidth: 600 })).toEqual({ start: true, end: false });
    expect(overflowOf({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toEqual({ start: false, end: false });
  });
});
