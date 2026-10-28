/**
 * The quiz reason on the web follows the api's one rule (S41, R3.16, O-412, PR #39 review finding 3
 * and security LOW 1): Submit, the Enter hotkey and the ready state read rationaleReady from
 * @g-tee-oh/contracts, so a reason that only looks typed (Hangul fillers, blank braille, variation
 * selectors, bare combining marks) never enables Submit; and a 400 whose problem names
 * body.rationale shows the reason's own sentence next to the field, never the generic answer text.
 */
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import * as draftModule from "../../src/prediction/draft.js";
import { fixturePredictions } from "../../src/fixtures/prediction.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { ANSWER_PATH, NEXT_PATH, pressStart, renderQuiz } from "./render-quiz.js";
import { APP_SUITE } from "./app-suite-timeout.js";

const QUIZ = "/quiz?config=cfg_6_online_100&positions=BB&spots=vs_open&kinds=range,hand&difficulty=easy";
const REASON_LABEL = "Your reason (required)";
const REFUSED_TEXT = "Your reason was not accepted: type at least 3 letters, numbers or punctuation marks.";
const GENERIC_TEXT = "That answer could not be read. Check it and submit again.";
const LOOKS_TYPED = ["ㅤㅤㅤ", "⠀⠀⠀", "a️️b", "́́́", "ab"];
/** Six whole-app passes through one field, each pasted and checked, outgrow vitest's 5 second default. */
const SIX_REASONS_TIMEOUT_MS = 20_000;

function firstPrediction(): (typeof fixturePredictions)[number] {
  const entry = fixturePredictions[0];
  if (entry === undefined) throw new Error("fixture prediction missing");
  return entry;
}

const YES_NO = firstPrediction();

function rationaleRefusal() {
  return jsonResponse(400, {
    type: "urn:g-tee-oh:problem:bad-request",
    title: "Bad request",
    status: 400,
    detail: "server detail text",
    errors: [{ path: "body.rationale", message: "server message text" }],
  });
}

async function openQuestion(script: Parameters<typeof renderQuiz>[1]) {
  const view = renderQuiz(QUIZ, script);
  await pressStart();
  await screen.findByRole("heading", { name: YES_NO.prompt.question });
  await userEvent.click(screen.getByRole("button", { name: "Yes" }));
  return view;
}

async function replaceReason(text: string): Promise<void> {
  const field = screen.getByRole("textbox", { name: REASON_LABEL });
  await userEvent.clear(field);
  await userEvent.click(field);
  await userEvent.paste(text);
}

describe("R3.16 the web reads the shared reason rule (PR #39 review finding 3)", APP_SUITE, () => {
  it("R3.16 the draft module keeps no reason counting of its own", () => {
    expect(Object.keys(draftModule)).not.toContain("reasonReady");
    expect(Object.keys(draftModule)).not.toContain("REASON_MIN_CHARS");
  });

  it(
    "R3.16 Submit stays disabled for reasons that only look typed and enables for abc",
    async () => {
      await openQuestion({ [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)] });
      const submit = screen.getByRole("button", { name: "Submit answer" });
      for (const reason of LOOKS_TYPED) {
        await replaceReason(reason);
        expect(screen.getByRole("textbox", { name: REASON_LABEL })).toHaveValue(reason);
        expect(submit, JSON.stringify(reason)).toBeDisabled();
      }
      await replaceReason("abc");
      expect(submit).toBeEnabled();
    },
    SIX_REASONS_TIMEOUT_MS,
  );

  it("R3.16 the Enter hotkey sends nothing for a reason of Hangul fillers", async () => {
    const view = await openQuestion({ [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)] });
    await replaceReason("ㅤㅤㅤ");
    await userEvent.click(screen.getByRole("button", { name: /Yes/ }));
    await userEvent.keyboard("{Enter}");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(0);
  });

  it("R3.16 the live count shows the raw length out of 1000", async () => {
    await openQuestion({ [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)] });
    await replaceReason("ㅤㅤㅤ");
    expect(screen.getByText("3 / 1000")).toBeInTheDocument();
  });
});

describe("R3.16 a refused reason is named next to the field (PR #39 review finding 3)", APP_SUITE, () => {
  it("R3.16 a 400 naming body.rationale shows the reason's sentence beside the field, not the generic answer text", async () => {
    const view = await openQuestion({ [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)], [ANSWER_PATH]: [rationaleRefusal()] });
    await replaceReason("abc");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    const field = screen.getByTestId("reason-field");
    expect(await within(field).findByText(REFUSED_TEXT)).toBeInTheDocument();
    const textarea = screen.getByRole("textbox", { name: REASON_LABEL });
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription(expect.stringContaining(REFUSED_TEXT));
    expect(screen.queryByText(GENERIC_TEXT)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("server detail text");
    expect(document.body).not.toHaveTextContent("server message text");
    expect(view.sentTo(ANSWER_PATH)).toHaveLength(1);
  });

  it("R3.16 editing the reason clears the refusal", async () => {
    await openQuestion({ [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)], [ANSWER_PATH]: [rationaleRefusal()] });
    await replaceReason("abc");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await screen.findByText(REFUSED_TEXT);
    await userEvent.type(screen.getByRole("textbox", { name: REASON_LABEL }), "d");
    await waitFor(() => expect(screen.queryByText(REFUSED_TEXT)).not.toBeInTheDocument());
  });

  it("R3.16 a 400 without body.rationale keeps the generic answer text", async () => {
    await openQuestion({
      [NEXT_PATH]: [jsonResponse(200, YES_NO.prompt)],
      [ANSWER_PATH]: [jsonResponse(400, { type: "urn:g-tee-oh:problem:validation", title: "t", status: 400, errors: [{ path: "body.answer", message: "m" }] })],
    });
    await replaceReason("abc");
    await userEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByText(GENERIC_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(REFUSED_TEXT)).not.toBeInTheDocument();
  });
});
