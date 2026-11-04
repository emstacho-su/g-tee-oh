/**
 * When the quiz's answer form may submit, and what Enter means on its own answer controls (R3.16,
 * PR #49 review rounds 2 to 4). Pure: these read a key press, an element or a recorded press and
 * return the decision; PromptCard and AnswerInput act on it.
 *
 * The submit gate (round 4) is the root cause fix for implicit submission. The form accepts a
 * submit only when it came from the Submit button (a click, or its own Space or plain Enter) or
 * from a plain Enter in a text entry field (the percent field), recorded by the form's keydown
 * for that same press. Every other submit is rejected: a modified or held Enter anywhere, and Enter
 * on any other control, such as a checkbox, so the browser's implicit submit never sends an answer
 * past these rules and no target needs its default blocked to stop it.
 *
 * On an answer control's own plain Enter (an option button or a region checkbox, AnswerInput):
 * the chosen option or a ticked region submits a complete answer (canSubmit) and holds an
 * incomplete one; an unchosen option or an unticked region is picked, and nothing is sent. A
 * modified or held Enter there keeps its default, so Ctrl, Alt and Meta stay the browser's and
 * assistive technology's; the gate rejects any submit it would cause.
 */
import { isPlainKey } from "../../hotkeys/index.js";
import { SUBMIT_KEY } from "../../prediction/labels.js";

export type AnswerEnterAction = "submit" | "hold" | "pick";

/** The Enter press the form's keydown saw, kept until its keyup, the submit it causes, or the end of its task. */
export interface RecordedEnter {
  target: EventTarget | null;
  plain: boolean;
}

/** The text entry fields whose plain Enter submits the form, as a browser's implicit submit does. */
const TEXT_ENTRY_TYPES: ReadonlySet<string> = new Set(["number", "text"]);

type KeyPress = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat">;

/** Enter with no Shift, Ctrl, Alt or Meta, and not an auto-repeat. */
export function isPlainEnter(event: KeyPress): boolean {
  return event.key === SUBMIT_KEY && isPlainKey(event) && !event.shiftKey;
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(target.type);
}

function isSubmitButton(element: Element | null): boolean {
  return element instanceof HTMLButtonElement && element.type === "submit";
}

/**
 * Whether the form may send this submit. With an Enter press recorded, only a plain Enter on the
 * submitter itself or in a text entry field sends; without one, only the Submit button does.
 */
export function submitAccepted(enter: RecordedEnter | null, submitter: Element | null): boolean {
  if (enter === null) return isSubmitButton(submitter);
  if (!enter.plain) return false;
  return isTextEntry(enter.target) || (isSubmitButton(submitter) && enter.target === submitter);
}

/** What a plain Enter on an answer control does, from whether it is the chosen one. */
export function answerEnterAction(chosen: boolean, canSubmit: boolean): AnswerEnterAction {
  if (!chosen) return "pick";
  return canSubmit ? "submit" : "hold";
}
