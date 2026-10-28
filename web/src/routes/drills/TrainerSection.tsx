/**
 * The builder's trainer and panels sections (S26, R3.14, O-314, O-317): how the trainer runs the
 * drill (stop rule in plain words "Spot", "Street", "Full hand"; input; grouping; Mixed-frequency mode; pause
 * rule; speed; quick result; tables; timebank off, 7, 15 or 25 seconds) and which panels show
 * (trainer.panels, one checkbox per PANEL_KEYS entry with a plain label). Frequency input and more
 * than one table stay selectable and carry the v1 note: v1 takes action input on one table.
 */
import type { DrillDraft } from "../../drills/draft.js";
import { togglePanel, withTrainer } from "../../drills/draft-edits.js";
import {
  GROUPING_LABELS,
  INPUT_LABELS,
  PANEL_LABELS,
  PAUSE_LABELS,
  SPEED_LABELS,
  STOP_RULE_HINTS,
  STOP_RULE_LABELS,
  V1_NOTES,
  timebankLabel,
} from "../../drills/labels.js";
import { MAX_TABLES, MIN_TABLES, PANEL_KEYS, TIMEBANK_CHOICES } from "../../drills/limits.js";
import type { Grouping, PanelKey, PauseRule, Speed, StopRule, Timebank, TrainerInput } from "../../drills/types.js";
import { CheckboxField, CheckboxGroup, FormSection, RadioField, SelectField, V1Note, type Choice } from "./form-parts.js";
import type { SectionProps } from "./GameSection.js";

function choicesOf<T extends string>(labels: Readonly<Record<T, string>>, hints?: Readonly<Record<T, string>>): Choice<T>[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value], ...(hints === undefined ? {} : { hint: hints[value] }) }));
}

const STOP_CHOICES = choicesOf<StopRule>(STOP_RULE_LABELS, STOP_RULE_HINTS);
const INPUT_CHOICES = choicesOf<TrainerInput>(INPUT_LABELS);
const GROUPING_CHOICES = choicesOf<Grouping>(GROUPING_LABELS);
const PAUSE_CHOICES = choicesOf<PauseRule>(PAUSE_LABELS);
const SPEED_CHOICES = choicesOf<Speed>(SPEED_LABELS);
const TABLE_CHOICES: readonly Choice<string>[] = Array.from({ length: MAX_TABLES - MIN_TABLES + 1 }, (_, index) => {
  const count = String(MIN_TABLES + index);
  return { value: count, label: count };
});
const TIMEBANK_OFF = "off";
const TIMEBANK_OPTIONS: readonly Choice<string>[] = TIMEBANK_CHOICES.map((seconds) => ({
  value: seconds === null ? TIMEBANK_OFF : String(seconds),
  label: timebankLabel(seconds),
}));
const PANEL_CHOICES: readonly Choice<PanelKey>[] = PANEL_KEYS.map((key) => ({ value: key, label: PANEL_LABELS[key] }));

function timebankOf(value: string): Timebank {
  return TIMEBANK_CHOICES.find((seconds) => String(seconds) === value) ?? null;
}

export function TrainerSection({ draft, onChange, errors }: SectionProps) {
  const trainer = draft.trainer;
  const set = (change: Partial<DrillDraft["trainer"]>) => onChange(withTrainer(draft, change));
  return (
    <FormSection title="Trainer">
      <RadioField legend="Stop rule" value={trainer.stop_rule} options={STOP_CHOICES} onChange={(stop_rule) => set({ stop_rule })} />
      <RadioField legend="Input" value={trainer.input} options={INPUT_CHOICES} onChange={(input) => set({ input })} />
      {trainer.input === "actions" ? null : <V1Note text={V1_NOTES.input} />}
      <div className="flex flex-wrap gap-6">
        <SelectField label="Grouping" value={trainer.grouping} options={GROUPING_CHOICES} onChange={(grouping) => set({ grouping })} />
        <SelectField label="Pause" value={trainer.pause} options={PAUSE_CHOICES} onChange={(pause) => set({ pause })} />
        <SelectField label="Speed" value={trainer.speed} options={SPEED_CHOICES} onChange={(speed) => set({ speed })} />
        <SelectField
          label="Tables"
          value={String(trainer.tables)}
          options={TABLE_CHOICES}
          onChange={(tables) => set({ tables: Number(tables) })}
          errors={errors["trainer.tables"]}
        />
        <SelectField
          label="Timebank"
          value={trainer.timebank_s === null ? TIMEBANK_OFF : String(trainer.timebank_s)}
          options={TIMEBANK_OPTIONS}
          onChange={(value) => set({ timebank_s: timebankOf(value) })}
        />
      </div>
      {trainer.tables > MIN_TABLES ? <V1Note text={V1_NOTES.tables} /> : null}
      <div className="flex flex-wrap gap-6">
        <CheckboxField
          label="Mixed-frequency mode"
          hint="A roll from 1 to 100 before each decision, to practise mixing; it never changes the grade."
          checked={trainer.rng}
          onChange={(rng) => set({ rng })}
        />
        <CheckboxField label="Quick result" hint="A shorter result between decisions." checked={trainer.quick_result} onChange={(quick_result) => set({ quick_result })} />
      </div>
    </FormSection>
  );
}

export function PanelsSection({ draft, onChange, errors }: SectionProps) {
  const selected = PANEL_KEYS.filter((key) => draft.trainer.panels[key] === true);
  return (
    <FormSection title="Panels">
      <CheckboxGroup
        legend="Panels shown after a decision"
        options={PANEL_CHOICES}
        selected={selected}
        onToggle={(key) => onChange(togglePanel(draft, key))}
        errors={[...(errors["trainer.panels"] ?? []), ...(errors.trainer ?? [])]}
      />
    </FormSection>
  );
}
