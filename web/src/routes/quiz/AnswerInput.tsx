/**
 * The answer input of a quiz prompt, by answer kind (S27 lane A, S41, R3.16, O-301, ADR 0020, A7
 * section 4): yes and no buttons; a number input from 0 to 100 in steps of 5; one checkbox per
 * hand region; the node's actions as buttons with their swatch (the tree's actions, ADR 0020); the
 * four frequency bands; and the node's aggressive actions for the size question. Every choice is a
 * real button or checkbox with a visible text label inside a named group, and a chosen button says
 * so through aria-pressed and a check mark, so color is never the only signal. The input only
 * edits the draft; submitting is the screen's (Enter or the Submit button).
 */
import type { ReactNode } from "react";

import { ActionSwatch } from "../../components/trainer/ActionSwatch.js";
import { Button, FIELD_CLASS, cn } from "../../components/ui/index.js";
import type { NodeAction, PredictionPrompt } from "../../contracts.js";
import { PERCENT_MAX, PERCENT_MIN, PERCENT_STEP, aggressiveActions, toggleRegion, type AnswerDraft } from "../../prediction/draft.js";
import { BAND_LABELS, PREDICTION_TEXT, REGION_LABELS } from "../../prediction/labels.js";

export interface AnswerInputProps {
  prompt: PredictionPrompt;
  draft: AnswerDraft;
  disabled: boolean;
  onChange: (draft: AnswerDraft) => void;
}

const CHOSEN_MARK = "✓";
const GROUP_CLASSES = "flex flex-wrap gap-2";

interface ChoiceProps {
  label: string;
  chosen: boolean;
  disabled: boolean;
  onChoose: () => void;
  action?: NodeAction;
  actions?: readonly NodeAction[];
}

function Choice({ label, chosen, disabled, onChoose, action, actions }: ChoiceProps) {
  return (
    <Button variant={chosen ? "primary" : "secondary"} aria-pressed={chosen} disabled={disabled} onClick={onChoose}>
      {action === undefined ? null : <ActionSwatch action={action} actions={actions ?? [action]} />}
      <span>{label}</span>
      {chosen ? <span aria-hidden="true">{CHOSEN_MARK}</span> : null}
    </Button>
  );
}

interface GroupProps {
  legend: string;
  children: ReactNode;
}

function Group({ legend, children }: GroupProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className={GROUP_CLASSES}>{children}</div>
    </fieldset>
  );
}

function ActionChoices({ prompt, draft, disabled, onChange }: AnswerInputProps) {
  if (draft.kind !== "action" && draft.kind !== "size") return null;
  const actions = draft.kind === "size" ? aggressiveActions(prompt) : prompt.actions;
  return (
    <Group legend={draft.kind === "size" ? PREDICTION_TEXT.sizeLegend : PREDICTION_TEXT.actionLegend}>
      {actions.map((action) => (
        <Choice
          key={action.index}
          label={action.label}
          action={action}
          actions={prompt.actions}
          chosen={draft.actionIndex === action.index}
          disabled={disabled}
          onChoose={() => onChange({ kind: draft.kind, actionIndex: action.index })}
        />
      ))}
    </Group>
  );
}

function RegionChoices({ prompt, draft, disabled, onChange }: AnswerInputProps) {
  if (draft.kind !== "regions") return null;
  const offered = prompt.regions ?? [];
  return (
    <Group legend={PREDICTION_TEXT.regionsLegend}>
      {offered.map((region) => (
        <label key={region} className="inline-flex items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={draft.value.includes(region)}
            disabled={disabled}
            onChange={() => onChange(toggleRegion(draft, region, offered))}
          />
          {REGION_LABELS[region]}
        </label>
      ))}
    </Group>
  );
}

function PercentInput({ draft, disabled, onChange }: AnswerInputProps) {
  if (draft.kind !== "percent") return null;
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {PREDICTION_TEXT.percentLabel}
      <input
        type="number"
        inputMode="numeric"
        min={PERCENT_MIN}
        max={PERCENT_MAX}
        step={PERCENT_STEP}
        value={draft.text}
        disabled={disabled}
        onChange={(event) => onChange({ kind: "percent", text: event.target.value })}
        className={cn(FIELD_CLASS, "h-10 w-32 px-2 text-base")}
      />
    </label>
  );
}

function YesNoChoices({ draft, disabled, onChange }: AnswerInputProps) {
  if (draft.kind !== "yes_no") return null;
  return (
    <Group legend={PREDICTION_TEXT.answerLegend}>
      <Choice label={PREDICTION_TEXT.yes} chosen={draft.value === true} disabled={disabled} onChoose={() => onChange({ kind: "yes_no", value: true })} />
      <Choice label={PREDICTION_TEXT.no} chosen={draft.value === false} disabled={disabled} onChoose={() => onChange({ kind: "yes_no", value: false })} />
    </Group>
  );
}

function BandChoices({ prompt, draft, disabled, onChange }: AnswerInputProps) {
  if (draft.kind !== "band") return null;
  return (
    <Group legend={PREDICTION_TEXT.bandLegend}>
      {(prompt.bands ?? []).map((band) => (
        <Choice key={band} label={BAND_LABELS[band]} chosen={draft.band === band} disabled={disabled} onChoose={() => onChange({ kind: "band", band })} />
      ))}
    </Group>
  );
}

export function AnswerInput(props: AnswerInputProps) {
  return (
    <>
      <YesNoChoices {...props} />
      <PercentInput {...props} />
      <RegionChoices {...props} />
      <ActionChoices {...props} />
      <BandChoices {...props} />
    </>
  );
}
