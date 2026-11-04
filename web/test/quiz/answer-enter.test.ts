/**
 * What Enter means on the quiz's answer controls (R3.16, PR #49 review round 2): read from the
 * element alone, aria-pressed on an option button and checked on a region checkbox.
 */
import { describe, expect, it } from "vitest";

import { answerEnterAction } from "../../src/routes/quiz/answer-enter.js";

function option(pressed: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

function region(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}

describe("R3.16 Enter on the quiz's answer controls", () => {
  it("R3.16 the chosen option or a ticked region submits a complete answer and holds an incomplete one", () => {
    for (const chosen of [option(true), region(true)]) {
      expect(answerEnterAction(chosen, true)).toBe("submit");
      expect(answerEnterAction(chosen, false)).toBe("hold");
    }
  });

  it("R3.16 an unchosen option or an unticked region is picked, complete answer or not", () => {
    for (const unchosen of [option(false), region(false)]) {
      expect(answerEnterAction(unchosen, true)).toBe("pick");
      expect(answerEnterAction(unchosen, false)).toBe("pick");
    }
  });

  it("R3.16 every other element keeps its own Enter: a plain button, the reason field, the percent field, a link, nothing", () => {
    const submit = document.createElement("button");
    const reason = document.createElement("textarea");
    const percent = document.createElement("input");
    percent.type = "number";
    const link = document.createElement("a");
    link.href = "#home";
    for (const other of [submit, reason, percent, link, null]) expect(answerEnterAction(other, true)).toBe("pass");
  });
});
