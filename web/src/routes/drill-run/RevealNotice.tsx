/**
 * The reveal notice above the action bar, before the decision (S46, R3.33, item 14, O-471).
 *
 * Mechanism: every panel is off by default; a panel shows before the decision only when the drill
 * turned it on, and the api names it in the prompt's visible_panels. When one of them reveals the
 * answer (trainer/revealing-panels.ts, the api's own list), or the prompt is a worked example, the
 * api grades the decision unrated, and this notice says so in one line. The panels themselves need
 * the decision node's identity, which the prompt does not carry yet (O-471), so the eye button,
 * closed by default, names the drill's pre-decision panels and says they show here in a later
 * version, rather than pretending to show them; on the reveal they open in the feedback panel
 * (feedback-sections.ts sectionsFromPanels). The web only names the fact, it never grades
 * (ADR 0004).
 */
import { useId, useState } from "react";

import { Button, EyeIcon } from "../../components/ui/index.js";
import type { PanelKey, TrainerPrompt } from "../../contracts.js";
import { PANEL_LABELS } from "../../drills/labels.js";
import { revealsAnswer } from "../../trainer/revealing-panels.js";
import { REVEAL_TEXT } from "./labels.js";

/** The panels a drill can show before the decision, in the order the eye names them. */
const PRE_DECISION_PANELS: readonly PanelKey[] = ["hero_strategy_matrix", "action_frequency_table", "threshold_card", "hero_range_matrix"];

type RevealFacts = Pick<TrainerPrompt, "visible_panels" | "worked_example">;

/** Whether the prompt's panels or its worked-example flag leave the decision unrated. */
export function showsRevealNotice(prompt: RevealFacts): boolean {
  return prompt.worked_example || revealsAnswer(prompt.visible_panels);
}

export interface RevealNoticeProps {
  prompt: RevealFacts;
}

export function RevealNotice({ prompt }: RevealNoticeProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!showsRevealNotice(prompt)) return null;
  const panels = PRE_DECISION_PANELS.filter((panel) => prompt.visible_panels.includes(panel));
  return (
    <div role="note" data-testid="reveal-notice" className="flex flex-col gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{REVEAL_TEXT.notRated}</p>
        {panels.length === 0 ? null : (
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
            <EyeIcon className="size-4" />
            {open ? REVEAL_TEXT.hide : REVEAL_TEXT.show}
          </Button>
        )}
      </div>
      {prompt.worked_example ? <p>{REVEAL_TEXT.workedExample}</p> : null}
      {open ? (
        <div id={listId} data-testid="reveal-panels" className="flex flex-col gap-1">
          <ul className="flex flex-wrap gap-2">
            {panels.map((panel) => (
              <li key={panel} className="rounded-full bg-surface-raised px-2 py-0.5 font-medium">
                {PANEL_LABELS[panel]}
              </li>
            ))}
          </ul>
          <p className="text-muted">{REVEAL_TEXT.later}</p>
        </div>
      ) : null}
    </div>
  );
}
