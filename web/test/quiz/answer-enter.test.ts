/**
 * The quiz answer form's submit gate and the meaning of Enter on its answer controls (R3.16, PR #49
 * review rounds 2 to 4): the form sends only from the Submit button or a plain Enter in a text
 * entry field, and a plain Enter on an option or region submits the chosen one or picks it.
 */
import { describe, expect, it } from "vitest";

import { answerEnterAction, isPlainEnter, submitAccepted } from "../../src/routes/quiz/answer-enter.js";

const BARE_ENTER = { key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false };

function submitButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "submit";
  return button;
}

function input(type: string): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

describe("R3.16 Enter on the quiz's answer controls", () => {
  it("R3.16 the chosen option or a ticked region submits a complete answer and holds an incomplete one", () => {
    expect(answerEnterAction(true, true)).toBe("submit");
    expect(answerEnterAction(true, false)).toBe("hold");
  });

  it("R3.16 an unchosen option or an unticked region is picked, complete answer or not", () => {
    expect(answerEnterAction(false, true)).toBe("pick");
    expect(answerEnterAction(false, false)).toBe("pick");
  });

  it("R3.16 only Enter with no Shift, Ctrl, Alt or Meta and no auto-repeat is a plain Enter", () => {
    expect(isPlainEnter(BARE_ENTER)).toBe(true);
    expect(isPlainEnter({ ...BARE_ENTER, key: "n" })).toBe(false);
    for (const flag of ["shiftKey", "ctrlKey", "altKey", "metaKey", "repeat"] as const) expect(isPlainEnter({ ...BARE_ENTER, [flag]: true }), flag).toBe(false);
  });
});

describe("R3.16 the answer form's submit gate (PR #49 review round 4)", () => {
  it("R3.16 with no Enter under way, only the Submit button sends", () => {
    expect(submitAccepted(null, submitButton())).toBe(true);
    const plain = document.createElement("button");
    plain.type = "button";
    for (const other of [plain, input("checkbox"), null]) expect(submitAccepted(null, other)).toBe(false);
  });

  it("R3.16 a plain Enter in a text entry field or on the Submit button itself sends", () => {
    const submit = submitButton();
    for (const field of [input("number"), input("text")]) expect(submitAccepted({ target: field, plain: true }, submit)).toBe(true);
    expect(submitAccepted({ target: submit, plain: true }, submit)).toBe(true);
  });

  it("R3.16 a modified or held Enter never sends, wherever it is", () => {
    const submit = submitButton();
    for (const target of [input("number"), submit, input("checkbox")]) expect(submitAccepted({ target, plain: false }, submit)).toBe(false);
  });

  it("R3.16 a plain Enter on any other control never sends: a checkbox, a radio, an option button", () => {
    const option = document.createElement("button");
    option.setAttribute("aria-pressed", "true");
    for (const target of [input("checkbox"), input("radio"), option, null]) expect(submitAccepted({ target, plain: true }, submitButton())).toBe(false);
  });
});
