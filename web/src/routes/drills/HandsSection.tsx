/**
 * The builder's hands section (S26, R3.14): every hand, the close decisions only, or a manual
 * list picked on the 13 by 13 hand picker. The manual list is kept while another mode is chosen,
 * so switching back restores it; it is sent only in manual mode (draft.ts).
 */
import { useId } from "react";

import { toggleHand, withManualHands } from "../../drills/draft-edits.js";
import { HANDS_MODE_LABELS } from "../../drills/labels.js";
import type { HandsMode } from "../../drills/types.js";
import { ErrorText, FormSection, RadioField, type Choice } from "./form-parts.js";
import type { SectionProps } from "./GameSection.js";
import { HandPicker } from "./HandPicker.js";

const MODE_CHOICES: readonly Choice<HandsMode>[] = [
  { value: "all", label: HANDS_MODE_LABELS.all },
  { value: "close_decisions", label: HANDS_MODE_LABELS.close_decisions, hint: "where the best actions are near in value" },
  { value: "manual", label: HANDS_MODE_LABELS.manual },
];

function ManualHands({ draft, onChange, errors }: SectionProps) {
  const errorId = useId();
  const messages = errors["spot_filter.hands.hands"];
  return (
    <div className="flex flex-col gap-2">
      <HandPicker
        selected={draft.manualHands}
        onToggle={(hand) => onChange(toggleHand(draft, hand))}
        onSetAll={(hands) => onChange(withManualHands(draft, hands))}
        describedBy={messages === undefined ? undefined : errorId}
      />
      <ErrorText id={errorId} messages={messages} />
    </div>
  );
}

export function HandsSection({ draft, onChange, errors }: SectionProps) {
  return (
    <FormSection title="Hands">
      <RadioField
        legend="Hands to train"
        value={draft.handsMode}
        options={MODE_CHOICES}
        onChange={(handsMode) => onChange({ ...draft, handsMode })}
        errors={errors["spot_filter.hands"]}
      />
      {draft.handsMode === "manual" ? <ManualHands draft={draft} onChange={onChange} errors={errors} /> : null}
    </FormSection>
  );
}
