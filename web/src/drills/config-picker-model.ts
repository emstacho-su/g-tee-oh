/**
 * The builder's configuration picker model (S47, R3.37, design rule 8): the game page picks the
 * game from the catalog first, through Study's own facet fields (study/settings-fields.ts, reused
 * and never edited), so a drill names a game a configuration covers and the reasons a choice is
 * unavailable are the words Study uses.
 *
 * Mechanism: a DrillDraft becomes a SettingsDraft of the four upper facets (format, table size,
 * stake, depth) and fieldStates answers each facet's choices or why it waits. Two translations:
 * a drill stores its stake by label (schemas/drills.ts) while Study's facet names it by id, so the
 * label maps to the id through the stakes read and back; a drill holds one to eight depths while
 * Study's facet holds one, so the first depth stands for the draft in the facet chain and the depth
 * choices render as a multiple choice over depthsText. Pure; every function returns a new draft.
 */
import { CBB_PER_BB, formatCbb } from "../poker/format.js";
import type { GameConfig, PositionPairEntry, Stake } from "../study/queries.js";
import { fieldStates, type FieldState, type SettingsCatalog, type SettingsDraft } from "../study/settings-fields.js";
import { listOf, type DrillDraft } from "./draft.js";

const DEPTH_SEPARATOR = ", ";
const NO_PAIRS = (): readonly PositionPairEntry[] | undefined => undefined;

export type PickerKey = "format" | "table_size" | "stake" | "depth";
export type PickerChoices = Readonly<Record<PickerKey, FieldState>>;

/** Study's catalog over the two reads the picker makes; it never needs a configuration's seats. */
export function pickerCatalog(stakes: readonly Stake[], configs: readonly GameConfig[]): SettingsCatalog {
  return { stakes, configs, pairsOf: NO_PAIRS };
}

/** The whole-number depths typed in the draft, in the order typed; anything else is dropped. */
export function pickedDepths(draft: Pick<DrillDraft, "depthsText">): number[] {
  return listOf(draft.depthsText)
    .map(Number)
    .filter((depth) => Number.isInteger(depth) && depth > 0);
}

function stakeIdOf(draft: Pick<DrillDraft, "format" | "stake">, stakes: readonly Stake[]): string | undefined {
  return stakes.find((stake) => stake.format === draft.format && stake.label === draft.stake)?.id;
}

/** The facet draft: format, table size, the stake's id and the first depth in centi-big-blinds. */
export function pickerDraft(draft: DrillDraft, stakes: readonly Stake[]): SettingsDraft {
  const stakeId = stakeIdOf(draft, stakes);
  const [firstDepth] = pickedDepths(draft);
  return {
    format: draft.format,
    table_size: draft.tableSize,
    ...(stakeId === undefined ? {} : { stake: stakeId }),
    ...(firstDepth === undefined ? {} : { depth: firstDepth * CBB_PER_BB }),
  };
}

/** Each facet's choices or why it waits, from Study's field states. */
export function pickerChoices(catalog: SettingsCatalog, draft: SettingsDraft): PickerChoices {
  const states = fieldStates(catalog, draft);
  return { format: states.format, table_size: states.table_size, stake: states.stake, depth: states.depth };
}

/** The depths picked by value (centi-big-blind strings from the facet) written back as the draft's text, ascending. */
export function withPickedDepths(draft: DrillDraft, depthsBb: readonly number[]): DrillDraft {
  const ordered = [...new Set(depthsBb)].sort((left, right) => left - right);
  return { ...draft, depthsText: ordered.join(DEPTH_SEPARATOR) };
}

/** The facet's depth value (centi-big-blinds as text) as big blinds. */
export function depthBbOf(value: string): number {
  return Number(value) / CBB_PER_BB;
}

/** The facet's depth label for a drill depth, for a depth the catalog does not list. */
export function depthLabelOf(depthBb: number): string {
  return formatCbb(depthBb * CBB_PER_BB);
}

/** The draft with the stake the id names (stored by label); an unknown id leaves the draft as it is. */
export function withPickedStake(draft: DrillDraft, stakeId: string, stakes: readonly Stake[]): DrillDraft {
  const stake = stakes.find((entry) => entry.id === stakeId);
  return stake === undefined ? draft : { ...draft, stake: stake.label };
}
