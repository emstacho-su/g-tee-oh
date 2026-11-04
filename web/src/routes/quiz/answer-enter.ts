/**
 * What Enter means on the quiz's own answer controls (R3.16, PR #49 review rounds 2 and 3). The
 * shared hotkey dispatch leaves Enter on any focused control to that control, so the answer form
 * decides here. An answer control is an option button (aria-pressed) or a region checkbox inside
 * the prompt's answer area, the element AnswerInput renders into; an aria-pressed button or a
 * checkbox anywhere else in the form is none (round 3). On a plain Enter:
 * - the chosen option or a ticked region submits a complete answer (canSubmit), and holds Enter
 *   while the answer is incomplete;
 * - an unchosen option or an unticked region is picked (clicked), and nothing is sent.
 * Every other element (the reason field, the percent field, the Submit button, End quiz, a link)
 * keeps its own Enter. Pure: these read the elements and return the decision; the form acts on it.
 */
export type AnswerControl = HTMLButtonElement | HTMLInputElement;
export type AnswerEnterAction = "submit" | "hold" | "pick";

export function isCheckbox(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === "checkbox";
}

function isOption(target: EventTarget | null): target is HTMLButtonElement {
  return target instanceof HTMLButtonElement && target.hasAttribute("aria-pressed");
}

/** The focused answer control, or null when the target is not one of the answer area's own controls. */
export function answerControlOf(target: EventTarget | null, answerArea: Element | null): AnswerControl | null {
  if (answerArea === null || !(target instanceof Node) || !answerArea.contains(target)) return null;
  return isOption(target) || isCheckbox(target) ? target : null;
}

/** Whether the answer control is already the chosen one: checked, or aria-pressed. */
function isChosen(control: AnswerControl): boolean {
  return isCheckbox(control) ? control.checked : control.getAttribute("aria-pressed") === "true";
}

export function answerEnterAction(control: AnswerControl, canSubmit: boolean): AnswerEnterAction {
  if (!isChosen(control)) return "pick";
  return canSubmit ? "submit" : "hold";
}
