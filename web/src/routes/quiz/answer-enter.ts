/**
 * What Enter means on the quiz's own answer controls (R3.16, PR #49 review round 2). The shared
 * hotkey dispatch leaves Enter on any focused control to that control, so the answer form decides
 * here, from the element itself and nothing else:
 * - a chosen option (a button with aria-pressed="true") or a ticked region checkbox submits a
 *   complete answer (canSubmit), and holds Enter while the answer is incomplete;
 * - an unchosen option (aria-pressed="false") or an unticked region checkbox is picked (clicked),
 *   and nothing is sent;
 * - anything else (the reason field, the Submit button, End quiz, Previous, a link) keeps its own
 *   Enter, so the form's submit, the button's click and the link's navigation run as usual.
 * Pure: it reads the target and returns the action; the form performs it.
 */
export type AnswerEnterAction = "submit" | "hold" | "pick" | "pass";

function isOption(target: EventTarget | null): target is HTMLButtonElement {
  return target instanceof HTMLButtonElement && target.hasAttribute("aria-pressed");
}

function isRegionCheckbox(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === "checkbox";
}

/** Whether the focused answer control is already the chosen one: aria-pressed or checked. */
function isChosen(target: HTMLButtonElement | HTMLInputElement): boolean {
  return target instanceof HTMLInputElement ? target.checked : target.getAttribute("aria-pressed") === "true";
}

export function answerEnterAction(target: EventTarget | null, canSubmit: boolean): AnswerEnterAction {
  if (!isOption(target) && !isRegionCheckbox(target)) return "pass";
  if (!isChosen(target)) return "pick";
  return canSubmit ? "submit" : "hold";
}
