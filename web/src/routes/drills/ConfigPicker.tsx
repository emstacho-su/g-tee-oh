/**
 * The builder's configuration picker (S47, R3.37, design rule 8): the game page picks the game from
 * the catalog first, format, table size, stake and depths as segmented choices, with Study's own
 * reasons for what is unavailable (study/settings-fields.ts through config-picker-model.ts). Depths
 * take any number (a drill holds one to eight), the stake is offered by its catalog entry and stored
 * by its label, and a depth the draft holds that the catalog lacks stays listed as chosen so an
 * imported drill still round-trips. The typed fields live under "Advanced: custom game"
 * (GameSection).
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import { LoadingNote, MultiToggleGroup, ToggleGroup } from "../../components/ui/index.js";
import {
  depthBbOf,
  depthLabelOf,
  pickedDepths,
  pickerCatalog,
  pickerChoices,
  pickerDraft,
  withPickedDepths,
  withPickedStake,
  type PickerKey,
} from "../../drills/config-picker-model.js";
import type { DrillDraft } from "../../drills/draft.js";
import { withFormat, withTableSize } from "../../drills/draft-edits.js";
import type { GameFormat } from "../../drills/types.js";
import { CBB_PER_BB } from "../../poker/format.js";
import { stakesQuery } from "../../study/queries.js";
import { SETTING_LABELS, type FieldState, type SettingChoice } from "../../study/settings-fields.js";
import { allConfigsQuery } from "../settings/configs-query.js";

export const PICKER_TEXT = {
  loading: "Loading the catalog.",
  failed: "The catalog could not be loaded; the typed fields below still work.",
  depths: "Depths",
} as const;


export interface ConfigPickerProps {
  draft: DrillDraft;
  onChange: (draft: DrillDraft) => void;
}

function toOptions(choices: readonly SettingChoice[]) {
  return choices.map((choice) => ({
    value: choice.value,
    label: choice.label,
    ...(choice.detail === undefined ? {} : { detail: choice.detail }),
    ...(choice.disabled ? { disabled: true, ...(choice.reason === undefined ? {} : { reason: choice.reason }) } : {}),
  }));
}

function Facet({ label, state, children }: { label: string; state: FieldState; children: (choices: readonly SettingChoice[]) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1" data-testid={`picker-${label.toLowerCase().replace(/ /g, "-")}`}>
      <span className="text-sm font-medium" aria-hidden="true">
        {label}
      </span>
      {state.kind === "waiting" ? <p className="text-sm text-muted">{state.reason}</p> : children(state.choices)}
    </div>
  );
}

export function ConfigPicker({ draft, onChange }: ConfigPickerProps) {
  const api = useAppApi();
  const stakes = useQuery(stakesQuery(api));
  const configs = useQuery(allConfigsQuery(api));
  if (stakes.isError || configs.isError) return <p className="text-sm text-muted">{PICKER_TEXT.failed}</p>;
  if (stakes.data === undefined || configs.data === undefined) return <LoadingNote text={PICKER_TEXT.loading} />;
  const catalog = pickerCatalog(stakes.data, configs.data);
  const facet = pickerDraft(draft, stakes.data);
  const choices = pickerChoices(catalog, facet);
  const chosenDepths = pickedDepths(draft);
  const depthValues = chosenDepths.map((depth) => String(depth * CBB_PER_BB));
  const labelOf = (key: PickerKey) => SETTING_LABELS[key];
  return (
    <div className="flex flex-col gap-4" data-testid="config-picker">
      <Facet label={labelOf("format")} state={choices.format}>
        {(list) => <ToggleGroup label={labelOf("format")} value={draft.format} options={toOptions(list)} onValueChange={(format) => onChange(withFormat(draft, format as GameFormat))} />}
      </Facet>
      <Facet label={labelOf("table_size")} state={choices.table_size}>
        {(list) => <ToggleGroup wrap label={labelOf("table_size")} value={String(draft.tableSize)} options={toOptions(list)} onValueChange={(size) => onChange(withTableSize(draft, Number(size)))} />}
      </Facet>
      <Facet label={labelOf("stake")} state={choices.stake}>
        {(list) => <ToggleGroup wrap label={labelOf("stake")} value={facet.stake} options={toOptions(list)} onValueChange={(stakeId) => onChange(withPickedStake(draft, stakeId, stakes.data))} />}
      </Facet>
      <Facet label={PICKER_TEXT.depths} state={choices.depth}>
        {(list) => {
          const listed = new Set(list.map((choice) => choice.value));
          // A depth the draft holds that the catalog does not list stays chosen (an imported drill round-trips).
          const extra = depthValues.filter((value) => !listed.has(value)).map((value) => ({ value, label: depthLabelOf(depthBbOf(value)) }));
          return (
            <MultiToggleGroup
              label={PICKER_TEXT.depths}
              value={depthValues}
              options={[...toOptions(list), ...extra]}
              onValueChange={(values) => onChange(withPickedDepths(draft, values.map(depthBbOf)))}
            />
          );
        }}
      </Facet>
    </div>
  );
}
