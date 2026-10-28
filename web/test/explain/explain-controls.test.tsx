/**
 * Tests for the More info and Ask controls in the feedback panel (S27 lane D, R3.19, R3.20, O-305
 * to O-308). The controls read GET /explain/status, GET /explain/{attempt_id}/more-info and POST
 * /explain/{attempt_id}/ask from an injected fake fetch; the Idempotency-Key factory is injected
 * through the trainer deps, so the keys are exact.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider } from "../../src/auth/index.js";
import { ExplainControls } from "../../src/components/explain/ExplainControls.js";
import type { AskResult } from "../../src/contracts.js";
import { EXPLAIN_TEXT } from "../../src/explain/texts.js";
import { fixtureFeedback } from "../../src/fixtures/index.js";
import {
  ASK_UNVALIDATED_WARNING,
  fixtureAskAnswer,
  fixtureAskStatus,
  fixtureAskStatusCapReached,
  fixtureAskStatusFlagOff,
  fixtureAskWarning,
  fixtureMoreInfo,
} from "../../src/fixtures/explain.js";
import { TrainerDepsProvider } from "../../src/trainer/trainer-deps.js";
import { createFakeFetch, jsonResponse, networkFailure, problemResponse, sessionResponse } from "../api/fake-fetch.js";
import type { FetchScript } from "../api/fake-fetch.js";

const ORIGIN = "http://localhost:4173";
const ATTEMPT = fixtureFeedback.attempt_id;
const STATUS_PATH = "GET /api/v1/explain/status";
const MORE_INFO_PATH = `GET /api/v1/explain/${ATTEMPT}/more-info`;
const ASK_PATH = `POST /api/v1/explain/${ATTEMPT}/ask`;
const ME_PATH = "GET /api/v1/me";
const QUESTION = "Why is raising better than calling?";

function setup(script: FetchScript, onDialogOpenChange?: (open: boolean) => void) {
  const fake = createFakeFetch(script);
  const idempotencyKeys: (string | null)[] = [];
  const api = createAppApi({
    baseUrl: ORIGIN,
    fetch: (request) => {
      if (request.method === "POST") idempotencyKeys.push(request.headers.get("idempotency-key"));
      return fake.fetch(request);
    },
  });
  let counter = 0;
  const deps = {
    now: () => 0,
    newKey: () => {
      counter += 1;
      return `key-${counter}`;
    },
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <TrainerDepsProvider deps={deps}>
          <ExplainControls feedback={fixtureFeedback} {...(onDialogOpenChange === undefined ? {} : { onDialogOpenChange })} />
        </TrainerDepsProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { fake, idempotencyKeys };
}

function askScript(answers: readonly AskResult[], extra: FetchScript = {}): FetchScript {
  return {
    [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)],
    [ME_PATH]: [sessionResponse()],
    [ASK_PATH]: answers.map((answer) => jsonResponse(200, answer)),
    ...extra,
  };
}

async function openAsk() {
  const button = await screen.findByRole("button", { name: EXPLAIN_TEXT.ask });
  await screen.findByTestId("ask-available");
  await userEvent.click(button);
  return screen.findByRole("dialog", { name: EXPLAIN_TEXT.askTitle });
}

async function send(dialog: HTMLElement, question: string) {
  const box = within(dialog).getByRole("textbox", { name: EXPLAIN_TEXT.questionLabel });
  await userEvent.clear(box);
  await userEvent.type(box, question);
  await userEvent.click(within(dialog).getByRole("button", { name: EXPLAIN_TEXT.send }));
}

describe("R3.19 More info dialog", () => {
  it("R3.19 opens a dialog listing every template section with its title and plain text", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = () => gate.then(() => jsonResponse(200, fixtureMoreInfo)());
    const { fake } = setup({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)], [MORE_INFO_PATH]: [held] });
    expect(fake.keys()).not.toContain(MORE_INFO_PATH);
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }));
    const dialog = await screen.findByRole("dialog", { name: EXPLAIN_TEXT.moreInfoTitle });
    expect(within(dialog).getByRole("status")).toHaveTextContent(EXPLAIN_TEXT.moreInfoLoading);
    release();
    for (const section of fixtureMoreInfo.sections) {
      const region = await within(dialog).findByRole("region", { name: section.title });
      const text = within(region).getByTestId(`more-info-${section.template}`);
      expect(text.textContent).toBe(section.text);
      expect(text).toHaveClass("whitespace-pre-line");
    }
  });

  it("R3.19 says so when there is no section", async () => {
    setup({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)], [MORE_INFO_PATH]: [jsonResponse(200, { ...fixtureMoreInfo, sections: [] })] });
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }));
    expect(await screen.findByText(EXPLAIN_TEXT.moreInfoEmpty)).toBeInTheDocument();
  });

  it("R3.19 a failure is an explicit alert with the status, and Retry reads again", async () => {
    const { fake } = setup({
      [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)],
      [MORE_INFO_PATH]: [problemResponse(502, "upstream"), jsonResponse(200, fixtureMoreInfo)],
    });
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not load (status 502)");
    expect(alert).not.toHaveTextContent("server detail text");
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.moreInfoRetry }));
    expect(await screen.findByRole("region", { name: fixtureMoreInfo.sections[0]?.title ?? "" })).toBeInTheDocument();
    expect(fake.keys().filter((key) => key === MORE_INFO_PATH)).toHaveLength(2);
  });
});

describe("R3.19 R3.20 dialog open state", () => {
  it("R3.19 R3.20 tells the screen when More info or Ask opens and closes, so it can pause its hotkeys", async () => {
    const onDialogOpenChange = vi.fn();
    setup(askScript([fixtureAskAnswer], { [MORE_INFO_PATH]: [jsonResponse(200, fixtureMoreInfo)] }), onDialogOpenChange);
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.moreInfo }));
    await screen.findByRole("dialog", { name: EXPLAIN_TEXT.moreInfoTitle });
    await userEvent.keyboard("{Escape}");
    await openAsk();
    await userEvent.keyboard("{Escape}");
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });
});

describe("R3.20 Ask button state", () => {
  it("R3.20 is disabled with the visible flag_off reason", async () => {
    setup({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatusFlagOff)] });
    const reason = await screen.findByTestId("ask-unavailable-reason");
    expect(reason).toHaveTextContent("Ask is off until a model key is configured");
    const button = screen.getByRole("button", { name: EXPLAIN_TEXT.ask });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Ask is off until a model key is configured");
  });

  it("R3.20 is disabled with the visible cap_reached reason", async () => {
    setup({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatusCapReached)] });
    expect(await screen.findByTestId("ask-unavailable-reason")).toHaveTextContent("This month's Ask budget is used");
    expect(screen.getByRole("button", { name: EXPLAIN_TEXT.ask })).toBeDisabled();
  });

  it("R3.20 is disabled while the status loads and enabled when Ask is available", async () => {
    setup({ [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus)] });
    expect(screen.getByRole("button", { name: EXPLAIN_TEXT.ask })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(EXPLAIN_TEXT.statusLoading);
    await screen.findByTestId("ask-available");
    expect(screen.getByRole("button", { name: EXPLAIN_TEXT.ask })).toBeEnabled();
    expect(screen.queryByTestId("ask-unavailable-reason")).not.toBeInTheDocument();
  });

  it("R3.20 a status failure keeps Ask disabled with an alert and a retry", async () => {
    const { fake } = setup({ [STATUS_PATH]: [networkFailure(), jsonResponse(200, fixtureAskStatus)] });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not load (network error)");
    expect(screen.getByRole("button", { name: EXPLAIN_TEXT.ask })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: EXPLAIN_TEXT.statusRetry }));
    await screen.findByTestId("ask-available");
    expect(fake.keys().filter((key) => key === STATUS_PATH)).toHaveLength(2);
  });
});

describe("R3.20 Ask dialog", () => {
  it("R3.20 posts the question with CSRF and an Idempotency-Key and shows the answer as plain text", async () => {
    const { fake, idempotencyKeys } = setup(askScript([fixtureAskAnswer]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    const answer = await within(dialog).findByTestId("ask-answer-text");
    expect(answer.textContent).toBe(fixtureAskAnswer.text);
    expect(answer).toHaveClass("whitespace-pre-line");
    expect(within(dialog).queryByTestId("ask-cached")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("ask-warning")).not.toBeInTheDocument();
    const post = fake.calls.find((call) => call.method === "POST");
    expect(post?.csrf).toBe("fixture-csrf-token-0001");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ question: QUESTION });
    expect(idempotencyKeys).toEqual(["key-1"]);
  });

  it("R3.20 a second question uses a fresh Idempotency-Key and the status is read again after each answer", async () => {
    const { fake, idempotencyKeys } = setup(askScript([fixtureAskAnswer, fixtureAskWarning]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    await within(dialog).findByTestId("ask-answer-text");
    await send(dialog, "And calling?");
    await within(dialog).findByTestId("ask-warning");
    expect(idempotencyKeys).toEqual(["key-1", "key-2"]);
    expect(fake.keys().filter((key) => key === STATUS_PATH).length).toBeGreaterThanOrEqual(2);
  });

  it("R3.20 a cached answer shows the From the cache note", async () => {
    setup(askScript([{ ...fixtureAskAnswer, cached: true, cost_cents: 0 }]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    expect(await within(dialog).findByTestId("ask-cached")).toHaveTextContent("From the cache");
  });

  it("R3.20 an unvalidated answer shows the warning in text, not by color alone", async () => {
    setup(askScript([fixtureAskWarning]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    const warning = await within(dialog).findByTestId("ask-warning");
    expect(warning).toHaveTextContent(`Warning: ${ASK_UNVALIDATED_WARNING}`);
    expect(within(dialog).getByTestId("ask-answer-text").textContent).toBe(fixtureAskWarning.text);
  });

  it("R3.20 an unvalidated answer without a warning text still shows the fixed warning", async () => {
    setup(askScript([{ ...fixtureAskWarning, warning: null }]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    expect(await within(dialog).findByTestId("ask-warning")).toHaveTextContent(ASK_UNVALIDATED_WARNING);
  });

  it("R3.20 HTML-like characters in an answer render literally, never as markup", async () => {
    const html = "<b>bold</b> & <script>alert(1)</script>\n<img src=x onerror=alert(2)> **not markdown**";
    setup(askScript([{ ...fixtureAskAnswer, text: html }]));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    const answer = await within(dialog).findByTestId("ask-answer-text");
    expect(answer.textContent).toBe(html);
    expect(answer.querySelector("b, script, img, strong")).toBeNull();
    expect(answer.children).toHaveLength(0);
  });

  it("R3.20 the question box is labelled, capped at 500 characters with a counter, and Send needs text", async () => {
    setup(askScript([fixtureAskAnswer]));
    const dialog = await openAsk();
    const box = within(dialog).getByRole("textbox", { name: EXPLAIN_TEXT.questionLabel });
    expect(box).toHaveAttribute("maxLength", "500");
    expect(within(dialog).getByRole("button", { name: EXPLAIN_TEXT.send })).toBeDisabled();
    await userEvent.type(box, "   ");
    expect(within(dialog).getByRole("button", { name: EXPLAIN_TEXT.send })).toBeDisabled();
    await userEvent.type(box, "Why?");
    expect(within(dialog).getByTestId("ask-counter")).toHaveTextContent("7 of 500 characters");
    expect(box).toHaveAccessibleDescription("7 of 500 characters");
    expect(within(dialog).getByRole("button", { name: EXPLAIN_TEXT.send })).toBeEnabled();
  });

  it.each([
    ["ask-disabled", 503, "Ask is off until a model key is configured", fixtureAskStatusFlagOff],
    ["ask-cap-reached", 429, "This month's Ask budget is used", fixtureAskStatusCapReached],
  ] as const)("R3.20 a %s problem shows the fixed text and refetches the status", async (slug, status, text, after) => {
    const { fake } = setup(
      askScript([], {
        [STATUS_PATH]: [jsonResponse(200, fixtureAskStatus), jsonResponse(200, after)],
        [ASK_PATH]: [problemResponse(status, slug)],
      }),
    );
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(text);
    expect(fake.keys().filter((key) => key === STATUS_PATH)).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByTestId("ask-unavailable-reason")).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: EXPLAIN_TEXT.ask })).toBeDisabled();
  });

  it("R3.20 any other failure is an alert with the status and no server detail", async () => {
    setup(askScript([], { [ASK_PATH]: [problemResponse(502, "upstream")] }));
    const dialog = await openAsk();
    await send(dialog, QUESTION);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The answer could not load (status 502).");
    expect(alert).not.toHaveTextContent("server detail text");
  });
});
