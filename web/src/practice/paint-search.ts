/**
 * The /paint address (S41, R3.17, O-351, O-415, O-416).
 *
 * Mechanism: the router keeps every query value a string, so the painting choice travels as
 * config=<id>&position=<seat>&spot=<type>&vs=<seat> with an optional seed=<16 hex digits>, and an
 * old drill-backed link as drill=<uuid>. Each value is kept only in the shape the api accepts (a
 * configuration id by the contract's pattern, a known seat, one of the offered spot types, an
 * opener other than the hero) and dropped otherwise; the route component re-validates before the
 * screen reads it, as /study does. A table, a seat and a spot make a full choice, which starts
 * painting; the opener is optional (any seat when absent).
 */
import type { Position } from "../contracts.js";
import { CONFIG_ID_PATTERN } from "../store/session-defaults.js";
import { isPosition, isSpotType, type SpotType } from "./catalog-spot.js";
import { validatePracticeSearch, type PracticeSearch } from "./search.js";

export interface PaintSearch extends PracticeSearch {
  config?: string;
  position?: string;
  spot?: string;
  vs?: string;
}

export interface PaintChoice {
  readonly config: string;
  readonly position: Position;
  readonly spot: SpotType;
  /** The opponent; null means any seat. */
  readonly vs: Position | null;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function validatePaintSearch(search: Record<string, unknown>): PaintSearch {
  const config = stringOf(search["config"]);
  const position = stringOf(search["position"]);
  const spot = stringOf(search["spot"]);
  const vs = stringOf(search["vs"]);
  const keptPosition = position !== undefined && isPosition(position) ? position : undefined;
  const entries: [keyof PaintSearch, string | undefined][] = [
    ["config", config !== undefined && CONFIG_ID_PATTERN.test(config) ? config : undefined],
    ["position", keptPosition],
    ["spot", spot !== undefined && isSpotType(spot) ? spot : undefined],
    ["vs", vs !== undefined && isPosition(vs) && vs !== keptPosition ? vs : undefined],
  ];
  const kept = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  return { ...validatePracticeSearch(search), ...kept };
}

/** The painting choice of a validated address, or null while the table, seat or spot is missing. */
export function paintChoiceOf(search: PaintSearch): PaintChoice | null {
  const { config, position, spot, vs } = search;
  if (config === undefined || position === undefined || spot === undefined || !isPosition(position) || !isSpotType(spot)) return null;
  return { config, position, spot, vs: vs !== undefined && isPosition(vs) ? vs : null };
}

/** What a partial address already chose, for the picker to fill in. */
export function partialPaintChoice(search: PaintSearch): Partial<PaintChoice> {
  const { config, position, spot, vs } = search;
  return {
    ...(config === undefined ? {} : { config }),
    ...(position !== undefined && isPosition(position) ? { position } : {}),
    ...(spot !== undefined && isSpotType(spot) ? { spot } : {}),
    ...(vs !== undefined && isPosition(vs) ? { vs } : {}),
  };
}

/** The address of a painting choice, with the seed when there is one. */
export function paintSearchOf(choice: PaintChoice, seed: string | undefined): PaintSearch {
  return {
    config: choice.config,
    position: choice.position,
    spot: choice.spot,
    ...(choice.vs === null ? {} : { vs: choice.vs }),
    ...(seed === undefined ? {} : { seed }),
  };
}
