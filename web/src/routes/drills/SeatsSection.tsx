/**
 * The builder's seats and action section (S26, R3.14, O-317): the start street, the hero and
 * villain positions seated at the chosen table size (no villain means any opponent), the preflop
 * action families, an optional line and alternate seats. A start street other than preflop stays
 * selectable and carries the v1 note, because v1 serves preflop spots only.
 */
import { toggleAction, toggleHero, toggleVillain } from "../../drills/draft-edits.js";
import { PREFLOP_ACTION_LABELS, STREET_LABELS, V1_NOTES } from "../../drills/labels.js";
import { PREFLOP_ACTIONS, STREETS, seatedPositions } from "../../drills/limits.js";
import type { Position, PreflopAction, StartStreet } from "../../drills/types.js";
import { CheckboxField, CheckboxGroup, FormSection, SelectField, TextField, V1Note, type Choice } from "./form-parts.js";
import type { SectionProps } from "./GameSection.js";

const STREET_CHOICES: readonly Choice<StartStreet>[] = STREETS.map((street) => ({ value: street, label: STREET_LABELS[street] }));
const ACTION_CHOICES: readonly Choice<PreflopAction>[] = PREFLOP_ACTIONS.map((action) => ({ value: action, label: PREFLOP_ACTION_LABELS[action] }));

function positionChoices(tableSize: number): Choice<Position>[] {
  return seatedPositions(tableSize).map((position) => ({ value: position, label: position }));
}

export function SeatsSection({ draft, onChange, errors }: SectionProps) {
  const seats = positionChoices(draft.tableSize);
  return (
    <FormSection title="Seats and action">
      <SelectField
        label="Start street"
        value={draft.startStreet}
        options={STREET_CHOICES}
        onChange={(startStreet) => onChange({ ...draft, startStreet })}
        errors={errors["spot_filter.start_street"]}
      />
      {draft.startStreet === "preflop" ? null : <V1Note text={V1_NOTES.street} />}
      <CheckboxGroup
        legend="Hero positions"
        options={seats}
        selected={draft.heroPositions}
        onToggle={(position) => onChange(toggleHero(draft, position))}
        errors={errors["spot_filter.hero_positions"]}
      />
      <CheckboxGroup
        legend="Villain positions"
        hint="Choose none to face any opponent. A hero position is never a villain."
        options={seats.filter((seat) => !draft.heroPositions.includes(seat.value))}
        selected={draft.villainPositions}
        onToggle={(position) => onChange(toggleVillain(draft, position))}
        errors={errors["spot_filter.villain_positions"]}
      />
      <CheckboxGroup
        legend="Preflop action"
        options={ACTION_CHOICES}
        selected={draft.preflopAction}
        onToggle={(action) => onChange(toggleAction(draft, action))}
        errors={errors["spot_filter.preflop_action"]}
      />
      <TextField
        label="Line (optional)"
        hint="Dot-separated action tokens from the pair's root, for example r250.c."
        value={draft.lineText}
        onChange={(lineText) => onChange({ ...draft, lineText })}
        errors={errors["spot_filter.line"]}
      />
      <CheckboxField
        label="Alternate seats"
        hint="Swap hero and villain seats between spots."
        checked={draft.alternateSeats}
        onChange={(alternateSeats) => onChange({ ...draft, alternateSeats })}
      />
    </FormSection>
  );
}
