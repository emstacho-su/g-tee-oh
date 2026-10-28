/**
 * Places field errors next to the builder field they name (S26, R3.14). The client rules
 * (body-rules.ts) and the api's 400 validation problem (Problem.errors) both name a field by its
 * dotted path; the api prefixes the request location ("body.spot_filter.hero_positions.0"), the
 * client does not. fieldKeyOf strips that prefix and maps the path to the longest form field it
 * falls under, so an element error (a single seat, a single depth) shows on its list's field. A
 * path that names no form field (an unknown key, the querystring) belongs to the form as a whole.
 */
import type { FieldError } from "./types.js";

/** The form fields that carry their own error line, longest match first. */
export const FIELD_KEYS = [
  "spot_filter.game_config.format",
  "spot_filter.game_config.table_size",
  "spot_filter.game_config.depths_bb",
  "spot_filter.sizing.open_bb",
  "spot_filter.sizing.three_bet_bb",
  "spot_filter.board.flops",
  "spot_filter.hands.hands",
  "trainer.panels",
  "trainer.tables",
  "spot_filter.stake",
  "spot_filter.sizing",
  "spot_filter.start_street",
  "spot_filter.hero_positions",
  "spot_filter.villain_positions",
  "spot_filter.preflop_action",
  "spot_filter.line",
  "spot_filter.board",
  "spot_filter.hands",
  "spot_filter.alternate_seats",
  "trainer",
  "name",
  "tags",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number] | "form";
export type GroupedErrors = Readonly<Partial<Record<FieldKey, readonly string[]>>>;

const BODY_PREFIX = "body.";
const BODY = "body";

function withoutLocation(path: string): string {
  if (path === BODY) return "";
  return path.startsWith(BODY_PREFIX) ? path.slice(BODY_PREFIX.length) : path;
}

/** The form field a dotted path belongs to, or "form" when it names none. */
export function fieldKeyOf(path: string): FieldKey {
  const inner = withoutLocation(path);
  const sorted = [...FIELD_KEYS].sort((left, right) => right.length - left.length);
  return sorted.find((key) => inner === key || inner.startsWith(`${key}.`)) ?? "form";
}

/** Every error's message grouped under its field, in the order given. */
export function groupFieldErrors(errors: readonly FieldError[]): GroupedErrors {
  return errors.reduce<GroupedErrors>((grouped, { path, message }) => {
    const key = fieldKeyOf(path);
    return { ...grouped, [key]: [...(grouped[key] ?? []), message] };
  }, {});
}
