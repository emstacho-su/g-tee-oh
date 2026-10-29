/**
 * The builder's game, stake and sizing section (S26, R3.14, 05 section 4; S47, R3.37, design rule
 * 8): the configuration picker first (ConfigPicker: format, table size, stake and depths from the
 * catalog with the reasons a choice is unavailable), then "Advanced: custom game" with the typed
 * fields (table size including sizes the catalog lacks, depths as text, the stake label, the sizing),
 * so a drill can still name a game the catalog does not hold and an imported drill round-trips.
 * The stake choices are the catalog's stakes of the chosen format (GET /stakes), named by their
 * display words (stakeWords) and stored by label because a drill names its stake by label
 * (schemas/drills.ts); a stored label the catalog lacks stays offered. Fixed sizing shows the open
 * and three-bet sizes in big blinds.
 */
import { useQuery } from "@tanstack/react-query";

import { useAppApi } from "../../auth/index.js";
import { Disclosure } from "../../components/ui/index.js";
import type { DrillDraft } from "../../drills/draft.js";
import { withFormat, withTableSize } from "../../drills/draft-edits.js";
import type { GroupedErrors } from "../../drills/field-errors.js";
import { FORMAT_LABELS, stakeWords } from "../../drills/labels.js";
import { OFFERED_TABLE_SIZES } from "../../drills/limits.js";
import type { GameFormat, Sizing } from "../../drills/types.js";
import { stakesQuery } from "../../study/queries.js";
import { ConfigPicker } from "./ConfigPicker.js";
import { FormSection, RadioField, SelectField, TextField, type Choice } from "./form-parts.js";

export interface SectionProps {
  draft: DrillDraft;
  onChange: (draft: DrillDraft) => void;
  errors: GroupedErrors;
}

export const GAME_TEXT = {
  title: "Game and stake",
  advanced: "Advanced: custom game",
  advancedHint: "Type a game the catalog does not list; it runs once the library builds it.",
} as const;

const FORMAT_CHOICES: readonly Choice<GameFormat>[] = [
  { value: "online", label: FORMAT_LABELS.online },
  { value: "live", label: FORMAT_LABELS.live },
];

const SIZING_CHOICES: readonly Choice<Sizing["mode"]>[] = [
  { value: "convention", label: "The configuration's sizes" },
  { value: "fixed", label: "Fixed sizes" },
];

const NO_STAKE = "";

/** The typed fields' labels, distinct from the picker's facets so each control has one name. */
export const CUSTOM_LABELS = {
  format: "Custom format",
  tableSize: "Custom table size",
  depths: "Custom depths (bb)",
  stake: "Custom stake",
} as const;

function tableSizeChoices(current: number): Choice<string>[] {
  const sizes = OFFERED_TABLE_SIZES.includes(current) ? OFFERED_TABLE_SIZES : [current, ...OFFERED_TABLE_SIZES];
  return sizes.map((size) => ({ value: String(size), label: `${size}-handed` }));
}

function useStakeChoices(format: GameFormat, current: string): { choices: Choice<string>[]; failed: boolean } {
  const api = useAppApi();
  const stakes = useQuery(stakesQuery(api));
  const labels = (stakes.data ?? []).filter((stake) => stake.format === format).map((stake) => stake.label);
  const withCurrent = current === NO_STAKE || labels.includes(current) ? labels : [current, ...labels];
  const choices = withCurrent.map((label) => ({ value: label, label: stakeWords(label) }));
  return { choices: [{ value: NO_STAKE, label: "Choose a stake" }, ...choices], failed: stakes.isError };
}

/** The typed fields: the game as text, for a configuration the catalog does not list (O-317). */
function CustomGameFields({ draft, onChange, errors }: SectionProps) {
  const stakes = useStakeChoices(draft.format, draft.stake);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{GAME_TEXT.advancedHint}</p>
      <div className="flex flex-wrap gap-6">
        <RadioField
          legend={CUSTOM_LABELS.format}
          value={draft.format}
          options={FORMAT_CHOICES}
          onChange={(format) => onChange(withFormat(draft, format))}
          errors={errors["spot_filter.game_config.format"]}
        />
        <SelectField
          label={CUSTOM_LABELS.tableSize}
          value={String(draft.tableSize)}
          options={tableSizeChoices(draft.tableSize)}
          onChange={(size) => onChange(withTableSize(draft, Number(size)))}
          errors={errors["spot_filter.game_config.table_size"]}
        />
        <TextField
          label={CUSTOM_LABELS.depths}
          hint="Effective stacks in big blinds, separated by commas, for example 100, 150."
          inputMode="numeric"
          value={draft.depthsText}
          onChange={(depthsText) => onChange({ ...draft, depthsText })}
          errors={errors["spot_filter.game_config.depths_bb"]}
        />
        <SelectField
          label={CUSTOM_LABELS.stake}
          value={draft.stake}
          options={stakes.choices}
          onChange={(stake) => onChange({ ...draft, stake })}
          errors={errors["spot_filter.stake"]}
          {...(stakes.failed ? { hint: "The stake list could not be loaded; the drill keeps its stake." } : {})}
        />
      </div>
    </div>
  );
}

export function GameSection({ draft, onChange, errors }: SectionProps) {
  const gameErrors = ["spot_filter.game_config.format", "spot_filter.game_config.table_size", "spot_filter.game_config.depths_bb", "spot_filter.stake"] as const;
  const hasGameError = gameErrors.some((key) => (errors[key]?.length ?? 0) > 0);
  return (
    <FormSection title={GAME_TEXT.title}>
      <ConfigPicker draft={draft} onChange={onChange} />
      {/* Open when a typed field holds an error, so the error is never behind a closed disclosure. */}
      <Disclosure title={GAME_TEXT.advanced} headingLevel={3} testId="custom-game" {...(hasGameError ? { open: true } : {})}>
        <CustomGameFields draft={draft} onChange={onChange} errors={errors} />
      </Disclosure>
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
