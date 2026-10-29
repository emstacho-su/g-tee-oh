/**
 * The design system in the harness gallery (S36, R3.13, O-346): the owner's five palette colours,
 * the semantic tokens (built from them in light, a neutral gray base in dark, O-430), every Button
 * variant and size, the segmented control, the native controls on the accent and a Card, so the
 * shots show the system itself in both themes.
 * The press row has a target between two neighbours; the design-system shots hold the pointer down
 * on it and measure that the neighbours do not move (the squish is transform only, O-364).
 */
import { useState } from "react";

import { Button, Card, ToggleGroup, type ButtonSize, type ButtonVariant } from "../components/ui/index.js";
import { GallerySection } from "./sections.js";

const PRIMITIVE_PREFIX = "--p-";

/** Every rule of a sheet or grouping rule, nested ones included (layers, media). */
function rulesOf(container: { cssRules: CSSRuleList }): CSSRule[] {
  return Array.from(container.cssRules).flatMap((rule) => ("cssRules" in rule ? [rule, ...rulesOf(rule as CSSGroupingRule)] : [rule]));
}

function readableRules(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return rulesOf(sheet);
  } catch (error: unknown) {
    // A sheet from another origin cannot be read; the palette lives in the app's own styles.css.
    console.warn(`design gallery: skipped an unreadable stylesheet (${String(error)})`);
    return [];
  }
}

/**
 * The palette primitives as the loaded styles.css declares them (S36 review): the gallery keeps no
 * copy of the owner's colours, so it always shows what the app uses.
 */
function paletteNames(): string[] {
  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of readableRules(sheet)) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
      for (const property of Array.from(rule.style)) if (property.startsWith(PRIMITIVE_PREFIX)) names.add(property);
    }
  }
  return [...names];
}

function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SEMANTIC = [
  "--surface",
  "--surface-raised",
  "--surface-sunken",
  "--border",
  "--border-strong",
  "--text",
  "--text-muted",
  "--accent",
  "--accent-soft",
  "--danger",
  "--success",
  "--warning",
  "--focus",
] as const;

const VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const SIZES: readonly ButtonSize[] = ["sm", "md", "lg"];
const MODE_OPTIONS = [
  { value: "frequency", label: "Frequency" },
  { value: "ev", label: "EV" },
  { value: "weight", label: "Range weight" },
] as const;

function Swatch({ name, caption }: { name: string; caption: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-lg border border-border/60" style={{ background: `var(${name})` }} />
      <span className="flex flex-col">
        <code className="font-mono text-xs">{name}</code>
        <span className="text-xs text-muted">{caption}</span>
      </span>
    </li>
  );
}

function TokenSection() {
  return (
    <GallerySection name="design-tokens" title="Palette and tokens" note="The owner's five colours as primitives, and the semantic tokens of this theme: built from them in light (O-346), a neutral gray and black base with the palette reds as accent and danger and a neutral focus ring in dark (O-430, O-432).">
      <div className="flex flex-col gap-4">
        <ul aria-label="Palette" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {paletteNames().map((name) => (
            <Swatch key={name} name={name} caption={tokenValue(name)} />
          ))}
        </ul>
        <ul aria-label="Semantic tokens" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {SEMANTIC.map((name) => (
            <Swatch key={name} name={name} caption={tokenValue(name)} />
          ))}
        </ul>
      </div>
    </GallerySection>
  );
}

function ButtonSection() {
  return (
    <GallerySection name="design-buttons" title="Buttons" note="Every variant and size on the shared tactile press: soft depth at rest, a lift on hover, a squish while pressed.">
      <div className="flex flex-col gap-4">
        {VARIANTS.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {`${variant} ${size}`}
              </Button>
            ))}
            <Button variant={variant} disabled>
              {`${variant} disabled`}
            </Button>
          </div>
        ))}
        <div data-testid="press-row" className="flex items-center gap-3">
          <Button data-testid="press-neighbour-before">Before</Button>
          <Button data-testid="press-target" variant="primary" size="lg">
            Press and hold
          </Button>
          <Button data-testid="press-neighbour-after">After</Button>
        </div>
      </div>
    </GallerySection>
  );
}

function ControlSection() {
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]["value"]>("frequency");
  return (
    <GallerySection name="design-controls" title="Controls and cards" note="The segmented control, native controls on the accent, and a raised card.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <ToggleGroup label="Matrix mode" value={mode} options={MODE_OPTIONS} onValueChange={setMode} />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked className="h-4 w-4" />
            Mixed-frequency mode
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="design-radio" defaultChecked className="h-4 w-4" />
            All covered configurations
          </label>
        </div>
        <Card title="A card" description="Raised on layered soft shadows." actions={<Button size="sm">Action</Button>}>
          <p className="text-sm">
            Body text, <span className="text-muted">muted text</span>, <span className="text-accent">accent text</span>,{" "}
            <span className="text-danger">danger</span>, <span className="text-success">success</span> and{" "}
            <span className="text-warning">warning</span>.
          </p>
        </Card>
      </div>
    </GallerySection>
  );
}

export function DesignSystemSections() {
  return (
    <>
      <TokenSection />
      <ButtonSection />
      <ControlSection />
    </>
  );
}
