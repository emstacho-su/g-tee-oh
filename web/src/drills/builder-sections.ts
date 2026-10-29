/**
 * The pages of the drill builder container (S40, R3.14, O-405, screen review rows 37 and 38). Each
 * page lives at /drills/new/<slug> or /drills/<id>/<slug>; the bare builder URLs and any slug not
 * listed here go to DEFAULT_BUILDER_SECTION. The order is the order of the section list.
 * sectionOfField and errorCountsBySection place a field error on the page that shows it, for the
 * form alert's links and the section list's "needs a fix" marker.
 */
import { fieldKeyOf, type FieldKey, type GroupedErrors } from "./field-errors.js";

export const BUILDER_SECTIONS = [
  { slug: "details", label: "Name and tags" },
  { slug: "game", label: "Game" },
  { slug: "seats", label: "Seats" },
  { slug: "hands", label: "Hands" },
  { slug: "board", label: "Board" },
  { slug: "trainer", label: "Trainer" },
  { slug: "panels", label: "Panels" },
] as const;

export type BuilderSectionSlug = (typeof BUILDER_SECTIONS)[number]["slug"];
export type BuilderSectionEntry = (typeof BUILDER_SECTIONS)[number];

export const DEFAULT_BUILDER_SECTION: BuilderSectionSlug = "details";

const SLUGS: ReadonlySet<string> = new Set(BUILDER_SECTIONS.map((section) => section.slug));

/** True when the path segment names a builder page (the URL is untrusted input). */
export function isBuilderSection(value: unknown): value is BuilderSectionSlug {
  return typeof value === "string" && SLUGS.has(value);
}

/** The page's label in the section list ("Game"). */
export function sectionLabel(slug: BuilderSectionSlug): string {
  return BUILDER_SECTIONS.find((section) => section.slug === slug)?.label ?? slug;
}

/**
 * The page each form field's error line shows on (field-errors.ts FIELD_KEYS). Trainer errors with
 * no field of their own show with the panels, as PanelsSection lists them; "form" (an unknown key,
 * the querystring) has no field and counts on the first page.
 */
const SECTION_OF_KEY: Readonly<Record<FieldKey, BuilderSectionSlug>> = {
  name: "details",
  tags: "details",
  "spot_filter.game_config.format": "game",
  "spot_filter.game_config.table_size": "game",
  "spot_filter.game_config.depths_bb": "game",
  "spot_filter.stake": "game",
  "spot_filter.sizing": "game",
  "spot_filter.sizing.open_bb": "game",
  "spot_filter.sizing.three_bet_bb": "game",
  "spot_filter.start_street": "seats",
  "spot_filter.hero_positions": "seats",
  "spot_filter.villain_positions": "seats",
  "spot_filter.preflop_action": "seats",
  "spot_filter.line": "seats",
  "spot_filter.alternate_seats": "seats",
  "spot_filter.hands": "hands",
  "spot_filter.hands.hands": "hands",
  "spot_filter.board": "board",
  "spot_filter.board.flops": "board",
  "trainer.tables": "trainer",
  "trainer.panels": "panels",
  trainer: "panels",
  form: DEFAULT_BUILDER_SECTION,
};

/** The builder page a client or api field path ("body.spot_filter.stake", "name") shows its error on. */
export function sectionOfField(path: string): BuilderSectionSlug {
  return SECTION_OF_KEY[fieldKeyOf(path)];
}

/**
 * How many field error lines each page holds, from the errors grouped by field. Errors that name
 * no field ("form") are listed in the form alert itself and mark no page.
 */
export function errorCountsBySection(errors: GroupedErrors): Readonly<Partial<Record<BuilderSectionSlug, number>>> {
  const fieldErrors = (Object.entries(errors) as [FieldKey, readonly string[] | undefined][]).filter(([key]) => key !== "form");
  return fieldErrors.reduce<Partial<Record<BuilderSectionSlug, number>>>(
    (counts, [key, messages]) => {
      const section = SECTION_OF_KEY[key];
      return { ...counts, [section]: (counts[section] ?? 0) + (messages?.length ?? 0) };
    },
    {},
  );
}
