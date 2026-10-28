/**
 * The builder's game, stake and sizing section (S26, R3.14, 05 section 4): format, table size and
 * depths (spot_filter.game_config), the stake label and the sizing. The stake choices are the
 * catalog's stakes of the chosen format (GET /stakes), named by label because a drill names its
 * stake by label (schemas/drills.ts); a stored label the catalog lacks stays offered, so an
 * imported drill still round-trips. Fixed sizing shows the open and three-bet sizes in big blinds.
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import type { DrillDraft } from "../../drills/draft.js";
import { withFormat, withTableSize } from "../../drills/draft-edits.js";
import type { GroupedErrors } from "../../drills/field-errors.js";
import { FORMAT_LABELS } from "../../drills/labels.js";
import { OFFERED_TABLE_SIZES } from "../../drills/limits.js";
import type { GameFormat, Sizing } from "../../drills/types.js";
import { stakesQuery } from "../../study/queries.js";
import { FormSection, RadioField, SelectField, TextField, type Choice } from "./form-parts.js";

export interface SectionProps {
  draft: DrillDraft;
  onChange: (draft: DrillDraft) => void;
  errors: GroupedErrors;
}

const FORMAT_CHOICES: readonly Choice<GameFormat>[] = [
  { value: "online", label: FORMAT_LABELS.online },
  { value: "live", label: FORMAT_LABELS.live },
];

const SIZING_CHOICES: readonly Choice<Sizing["mode"]>[] = [
  { value: "convention", label: "The configuration's sizes" },
  { value: "fixed", label: "Fixed sizes" },
];

const NO_STAKE = "";

function tableSizeChoices(current: number): Choice<string>[] {
  const sizes = OFFERED_TABLE_SIZES.includes(current) ? OFFERED_TABLE_SIZES : [current, ...OFFERED_TABLE_SIZES];
  return sizes.map((size) => ({ value: String(size), label: `${size}-handed` }));
}

function useStakeChoices(format: GameFormat, current: string): { choices: Choice<string>[]; failed: boolean } {
  const api = useAppApi();
  const stakes = useQuery(stakesQuery(api));
  const labels = (stakes.data ?? []).filter((stake) => stake.format === format).map((stake) => stake.label);
  const withCurrent = current === NO_STAKE || labels.includes(current) ? labels : [current, ...labels];
  const choices = withCurrent.map((label) => ({ value: label, label }));
  return { choices: [{ value: NO_STAKE, label: "Choose a stake" }, ...choices], failed: stakes.isError };
}

export function GameSection({ draft, onChange, errors }: SectionProps) {
  const stakes = useStakeChoices(draft.format, draft.stake);
  return (
    <FormSection title="Game and stake">
      <div className="flex flex-wrap gap-6">
        <RadioField
          legend="Format"
          value={draft.format}
          options={FORMAT_CHOICES}
          onChange={(format) => onChange(withFormat(draft, format))}
          errors={errors["spot_filter.game_config.format"]}
        />
        <SelectField
          label="Table size"
          value={String(draft.tableSize)}
          options={tableSizeChoices(draft.tableSize)}
          onChange={(size) => onChange(withTableSize(draft, Number(size)))}
          errors={errors["spot_filter.game_config.table_size"]}
        />
        <TextField
          label="Depths (bb)"
          hint="Effective stacks in big blinds, separated by commas, for example 100, 150."
          inputMode="numeric"
          value={draft.depthsText}
          onChange={(depthsText) => onChange({ ...draft, depthsText })}
          errors={errors["spot_filter.game_config.depths_bb"]}
        />
        <SelectField
          label="Stake"
          value={draft.stake}
          options={stakes.choices}
          onChange={(stake) => onChange({ ...draft, stake })}
          errors={errors["spot_filter.stake"]}
          {...(stakes.failed ? { hint: "The stake list could not be loaded; the drill keeps its stake." } : {})}
        />
      </div>
      <RadioField
        legend="Sizing"
        value={draft.sizingMode}
        options={SIZING_CHOICES}
        onChange={(sizingMode) => onChange({ ...draft, sizingMode })}
        errors={errors["spot_filter.sizing"]}
      />
      {draft.sizingMode === "fixed" ? (
        <div className="flex flex-wrap gap-6">
          <TextField
            label="Open size (bb)"
            hint="Leave empty to keep the configuration's."
            inputMode="decimal"
            value={draft.openBbText}
            onChange={(openBbText) => onChange({ ...draft, openBbText })}
            errors={errors["spot_filter.sizing.open_bb"]}
          />
          <TextField
            label="Three-bet size (bb)"
            hint="Leave empty to keep the configuration's."
            inputMode="decimal"
            value={draft.threeBetBbText}
            onChange={(threeBetBbText) => onChange({ ...draft, threeBetBbText })}
            errors={errors["spot_filter.sizing.three_bet_bb"]}
          />
        </div>
      ) : null}
    </FormSection>
  );
}
