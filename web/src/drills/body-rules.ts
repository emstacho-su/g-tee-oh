/**
 * The write rules of a drill body, checked in the browser before a save (S26, R3.14). They
 * mirror drillCreateBodySchema and the SpotFilterWrite cross-field rules (services/api/src/schemas/
 * drills.ts and spot-filter-rules.ts): the field limits, every seat seated at the table size, hero
 * and villain disjoint, the stake label matching the format, no list repeating a value. The mocked
 * api (e2e/support/mock-drills.ts) answers its 400s from the same rules.
 *
 * Mechanism: checkDrillBody is pure. It takes a body already shaped like DrillCreate and returns
 * every violation as a FieldError whose path is the dotted path inside the body (no "body."
 * prefix), pointing at the offending element as the server does, so field-errors.ts places a
 * client error and a server error on the same field. The api remains the authority: it checks
 * every write again.
 */
import {
  FLOP_PATTERN,
  HAND_CLASS_PATTERN,
  LINE_PATTERN,
  LIVE_STAKE_LABEL_PATTERN,
  MAX_DEPTH_BB,
  MAX_DEPTHS,
  MAX_DRILL_NAME_LENGTH,
  MAX_FLOPS,
  MAX_HANDS,
  MAX_POSITIONS,
  MAX_STAKE_LABEL_LENGTH,
  MAX_TABLE_SIZE,
  MAX_TABLES,
  MAX_TAGS,
  MIN_DEPTH_BB,
  MIN_TABLE_SIZE,
  MIN_TABLES,
  ONLINE_STAKE_LABEL,
  TAG_PATTERN,
  seatedPositions,
} from "./limits.js";
import type { DrillCreate, FieldError, SpotFilter } from "./types.js";

const SF = "spot_filter";
const DEPTHS_PATH = `${SF}.game_config.depths_bb`;

function error(path: string, message: string): FieldError {
  return { path, message };
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** One error per element that repeats an earlier one, at the repeat's index. */
export function duplicateErrors(values: readonly unknown[], path: string): FieldError[] {
  return values.flatMap((value, index) =>
    values.indexOf(value) === index ? [] : [error(`${path}.${index}`, `${String(value)} is listed more than once`)],
  );
}

function nameErrors(name: string): FieldError[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [error("name", "Give the drill a name.")];
  if (trimmed.length > MAX_DRILL_NAME_LENGTH) return [error("name", `A name has at most ${MAX_DRILL_NAME_LENGTH} characters.`)];
  return [];
}

function tagErrors(tags: readonly string[]): FieldError[] {
  if (tags.length > MAX_TAGS) return [error("tags", `A drill has at most ${MAX_TAGS} tags.`)];
  return tags.flatMap((tag, index) =>
    TAG_PATTERN.test(tag)
      ? []
      : [error(`tags.${index}`, `${tag} is not a tag: use lower-case letters, digits, - and _, up to 32 characters, starting with a letter or digit.`)],
  );
}

function gameErrors(filter: SpotFilter): FieldError[] {
  const { table_size: size, depths_bb: depths } = filter.game_config;
  const sizeErrors = isIntegerIn(size, MIN_TABLE_SIZE, MAX_TABLE_SIZE)
    ? []
    : [error(`${SF}.game_config.table_size`, `A table seats ${MIN_TABLE_SIZE} to ${MAX_TABLE_SIZE} players.`)];
  if (depths.length === 0 || depths.length > MAX_DEPTHS) {
    return [...sizeErrors, error(DEPTHS_PATH, `List 1 to ${MAX_DEPTHS} depths in big blinds.`)];
  }
  const ranged = depths.flatMap((depth, index) =>
    isIntegerIn(depth, MIN_DEPTH_BB, MAX_DEPTH_BB)
      ? []
      : [error(`${DEPTHS_PATH}.${index}`, `A depth is a whole number of big blinds from ${MIN_DEPTH_BB} to ${MAX_DEPTH_BB}.`)],
  );
  return [...sizeErrors, ...ranged, ...duplicateErrors(depths, DEPTHS_PATH)];
}

function stakeErrors(filter: SpotFilter): FieldError[] {
  const { stake } = filter;
  const online = filter.game_config.format === "online";
  if (stake.length === 0 || stake.length > MAX_STAKE_LABEL_LENGTH) {
    return [error(`${SF}.stake`, online ? `An online drill uses the stake ${ONLINE_STAKE_LABEL}.` : "Choose a live stake.")];
  }
  const matches = online ? stake === ONLINE_STAKE_LABEL : LIVE_STAKE_LABEL_PATTERN.test(stake);
  if (matches) return [];
  return [error(`${SF}.stake`, online ? `An online drill uses the stake ${ONLINE_STAKE_LABEL}.` : "A live drill needs a live stake such as 1/3.")];
}

function sizeError(value: number | undefined, path: string): FieldError[] {
  if (value === undefined || (Number.isFinite(value) && value > 0 && value <= MAX_DEPTH_BB)) return [];
  return [error(path, `A size is a number of big blinds above 0 and at most ${MAX_DEPTH_BB}.`)];
}

function sizingErrors(filter: SpotFilter): FieldError[] {
  if (filter.sizing.mode === "convention") return [];
  return [
    ...sizeError(filter.sizing.open_bb, `${SF}.sizing.open_bb`),
    ...sizeError(filter.sizing.three_bet_bb, `${SF}.sizing.three_bet_bb`),
  ];
}

function seatErrors(filter: SpotFilter): FieldError[] {
  const size = filter.game_config.table_size;
  const seated = seatedPositions(size);
  const heroes = filter.hero_positions;
  const villains = filter.villain_positions;
  const countErrors = [
    ...(heroes.length === 0 ? [error(`${SF}.hero_positions`, "Choose at least one hero position.")] : []),
    ...(heroes.length > MAX_POSITIONS ? [error(`${SF}.hero_positions`, `At most ${MAX_POSITIONS} hero positions.`)] : []),
    ...(villains.length > MAX_POSITIONS ? [error(`${SF}.villain_positions`, `At most ${MAX_POSITIONS} villain positions.`)] : []),
  ];
  const unseated = (["hero_positions", "villain_positions"] as const).flatMap((field) =>
    filter[field].flatMap((position, index) =>
      seated.includes(position) ? [] : [error(`${SF}.${field}.${index}`, `${position} is not seated at a ${size}-handed table.`)],
    ),
  );
  const overlap = villains.flatMap((position, index) =>
    heroes.includes(position) ? [error(`${SF}.villain_positions.${index}`, `${position} is also a hero position.`)] : [],
  );
  return [
    ...countErrors,
    ...unseated,
    ...overlap,
    ...duplicateErrors(heroes, `${SF}.hero_positions`),
    ...duplicateErrors(villains, `${SF}.villain_positions`),
  ];
}

function actionErrors(filter: SpotFilter): FieldError[] {
  const empty = filter.preflop_action.length === 0 ? [error(`${SF}.preflop_action`, "Choose at least one preflop action.")] : [];
  const line = filter.line === undefined || LINE_PATTERN.test(filter.line)
    ? []
    : [error(`${SF}.line`, "A line is dot-separated action tokens, for example r250.c.")];
  return [...empty, ...duplicateErrors(filter.preflop_action, `${SF}.preflop_action`), ...line];
}

function boardErrors(filter: SpotFilter): FieldError[] {
  const flops = filter.board?.flops;
  if (flops === undefined) return [];
  if (flops.length > MAX_FLOPS) return [error(`${SF}.board.flops`, `At most ${MAX_FLOPS} flops.`)];
  return flops.flatMap((flop, index) =>
    FLOP_PATTERN.test(flop) ? [] : [error(`${SF}.board.flops.${index}`, `${flop} is not a flop: write three different cards, for example Kh8d3c.`)],
  );
}

function handErrors(filter: SpotFilter): FieldError[] {
  if (filter.hands.mode !== "manual") return [];
  const { hands } = filter.hands;
  const path = `${SF}.hands.hands`;
  if (hands.length === 0 || hands.length > MAX_HANDS) return [error(path, `Pick 1 to ${MAX_HANDS} hands.`)];
  const malformed = hands.flatMap((hand, index) =>
    HAND_CLASS_PATTERN.test(hand) ? [] : [error(`${path}.${index}`, `${hand} is not a hand class such as AKs.`)],
  );
  return [...duplicateErrors(hands, path), ...malformed].sort((left, right) => left.path.localeCompare(right.path));
}

function trainerErrors(body: DrillCreate): FieldError[] {
  return isIntegerIn(body.trainer.tables, MIN_TABLES, MAX_TABLES)
    ? []
    : [error("trainer.tables", `Play ${MIN_TABLES} to ${MAX_TABLES} tables.`)];
}

/** Every write-rule violation of a drill body, in field order; empty when the api would accept it. */
export function checkDrillBody(body: DrillCreate): FieldError[] {
  const filter = body.spot_filter;
  return [
    ...nameErrors(body.name),
    ...tagErrors(body.tags),
    ...gameErrors(filter),
    ...stakeErrors(filter),
    ...sizingErrors(filter),
    ...seatErrors(filter),
    ...actionErrors(filter),
    ...boardErrors(filter),
    ...handErrors(filter),
    ...trainerErrors(body),
  ];
}
