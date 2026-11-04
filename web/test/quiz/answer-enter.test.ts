/**
 * What Enter means on the quiz's answer controls (R3.16, PR #49 review rounds 2 and 3): only an
 * option button (aria-pressed) or a checkbox inside the answer area is an answer control, and it is
 * read from the element alone, aria-pressed on an option and checked on a region checkbox.
 */
import { afterEach, describe, expect, it } from "vitest";

import { answerControlOf, answerEnterAction, isCheckbox } from "../../src/routes/quiz/answer-enter.js";

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

/** An answer area holding the given elements, beside a form area outside it. */
function areas(...inside: Element[]): { answerArea: HTMLDivElement; outside: HTMLDivElement } {
  const answerArea = document.createElement("div");
  const outside = document.createElement("div");
  answerArea.append(...inside);
  document.body.append(answerArea, outside);
  return { answerArea, outside };
}

afterEach(() => document.body.replaceChildren());

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

  it("R3.16 an option or a region checkbox inside the answer area is an answer control", () => {
    const chosen = option(true);
    const unticked = region(false);
    const { answerArea } = areas(chosen, unticked);
    expect(answerControlOf(chosen, answerArea)).toBe(chosen);
    expect(answerControlOf(unticked, answerArea)).toBe(unticked);
  });

  it("R3.16 an aria-pressed button or a checkbox outside the answer area is none (PR #49 round 3)", () => {
    const { answerArea, outside } = areas();
    const toggle = option(false);
    const stray = region(false);
    outside.append(toggle, stray);
    expect(answerControlOf(toggle, answerArea)).toBeNull();
    expect(answerControlOf(stray, answerArea)).toBeNull();
    expect(answerControlOf(option(true), null), "no answer area, no answer control").toBeNull();
  });

  it("R3.16 every other element in the answer area keeps its own Enter: a plain button, the percent field, a link, nothing", () => {
    const plain = document.createElement("button");
    const percent = document.createElement("input");
    percent.type = "number";
    const link = document.createElement("a");
    link.href = "#home";
    const { answerArea } = areas(plain, percent, link);
    for (const other of [plain, percent, link, null, answerArea]) expect(answerControlOf(other, answerArea)).toBeNull();
  });

  it("R3.16 isCheckbox names a checkbox input only", () => {
    expect(isCheckbox(region(false))).toBe(true);
    const radio = document.createElement("input");
    radio.type = "radio";
    for (const other of [radio, option(false), null]) expect(isCheckbox(other)).toBe(false);
  });
});
