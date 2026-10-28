/**
 * The replay pauses the response timer synchronously (S38 review round 1, finding 10; O-284,
 * O-381). useSpotSession owns the replay, so the render that shows a prompt with a line to replay
 * already counts as paused: the driver receives a pause and never a resume first, which would let
 * the response time run for a moment during the replay. The driver is wrapped to record every
 * event the screen sends it.
 */
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fixtureDrill, fixturePlainFeedback, fixturePlainPrompt } from "../../src/fixtures/trainer.js";
import type { SpotEvent } from "../../src/trainer/spot-machine.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { DECIDE_PATH, NEXT_PATH, renderRun } from "./render-run.js";

const sent = vi.hoisted((): SpotEvent[] => []);

vi.mock("../../src/trainer/spot-driver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/trainer/spot-driver.js")>();
  return {
    ...actual,
    createSpotDriver: (...args: Parameters<typeof actual.createSpotDriver>) => {
      const driver = actual.createSpotDriver(...args);
      return {
        ...driver,
        send: (event: SpotEvent) => {
          sent.push(event);
          driver.send(event);
        },
      };
    },
  };
});

const TIMER_EVENTS: ReadonlySet<SpotEvent["type"]> = new Set(["pause", "resume"]);

describe("R3.13 the replay pauses the response timer in the render that shows the prompt", () => {
  it("R3.13 no resume is sent at the start of a replay: the first timer event after Start is a pause", async () => {
    expect(fixturePlainPrompt.history.length).toBeGreaterThan(0);
    renderRun({ script: { [NEXT_PATH]: [jsonResponse(200, fixturePlainPrompt)], [DECIDE_PATH]: [jsonResponse(200, fixturePlainFeedback)] }, motion: true });
    await screen.findByRole("heading", { name: fixtureDrill.name });
    await userEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("group", { name: "Actions" });
    const afterStart = sent.slice(sent.findIndex((event) => event.type === "start") + 1);
    const timerEvents = afterStart.filter((event) => TIMER_EVENTS.has(event.type)).map((event) => event.type);
    expect(timerEvents[0]).toBe("pause");
    // Finishing the replay resumes the timer once.
    await userEvent.click(screen.getByTestId("poker-table"));
    const after = sent.slice(sent.findIndex((event) => event.type === "start") + 1).filter((event) => TIMER_EVENTS.has(event.type));
    expect(after.map((event) => event.type)).toEqual(["pause", "resume"]);
  });
});
