/**
 * The pure helpers behind the trainer screen (S25, R3.13): failure classification (spot-problem.ts)
 * and the table seats derived from a prompt (prompt-seats.ts).
 */
import { describe, expect, it } from "vitest";

import { ApiProblem } from "../../src/api/index.js";
import { fixturePlainPrompt, fixtureTrainerHands } from "../../src/fixtures/trainer.js";
import { seatsOfPrompt } from "../../src/trainer/prompt-seats.js";
import { isRetryable, problemMessage, problemOf } from "../../src/trainer/spot-problem.js";

function apiProblem(status: number, slug: string): ApiProblem {
  return new ApiProblem({ status, slug, title: "t", detail: "server detail" });
}

describe("R3.13 spot problem classification", () => {
  it.each([
    [apiProblem(409, "stale-state"), "stale", 409],
    [apiProblem(409, "session-ended"), "session_ended", 409],
    [apiProblem(422, "no-coverage"), "no_coverage", 422],
    [apiProblem(503, "unavailable"), "unavailable", 503],
    [apiProblem(502, "upstream"), "unavailable", 502],
    [apiProblem(401, "unauthenticated"), "signed_out", 401],
    [apiProblem(400, "validation"), "other", 400],
    [apiProblem(409, "idempotency-in-flight"), "in_flight", 409],
    [apiProblem(409, "conflict"), "other", 409],
    [new TypeError("Failed to fetch"), "network", null],
    [new DOMException("timed out", "TimeoutError"), "network", null],
    [new DOMException("aborted", "AbortError"), "network", null],
    [new Error("boom"), "other", null],
    ["not an error", "other", null],
  ] as const)("R3.13 %s is %s", (error, kind, status) => {
    expect(problemOf(error)).toEqual({ kind, status });
  });

  it("R3.13 only transient problems are retryable: network, timeouts, 502, 503, 409 in flight, a stale end", () => {
    const retryable = (["network", "unavailable", "in_flight", "stale"] as const).map((kind) => isRetryable({ kind, status: null }));
    expect(retryable).toEqual([true, true, true, true]);
    const fixed = (["no_coverage", "session_ended", "signed_out", "other"] as const).map((kind) => isRetryable({ kind, status: 400 }));
    expect(fixed).toEqual([false, false, false, false]);
  });

  it("R3.13 messages are fixed safe text and never the server detail", () => {
    expect(problemMessage({ kind: "in_flight", status: 409 })).toMatch(/still being processed/);
    expect(problemMessage({ kind: "no_coverage", status: 422 })).toMatch(/no covered spot.*queued for the library builder/);
    expect(problemMessage({ kind: "network", status: null })).toMatch(/did not reach the server/);
    expect(problemMessage({ kind: "unavailable", status: 503 })).toMatch(/did not answer in time/);
    expect(problemMessage({ kind: "session_ended", status: 409 })).toMatch(/has ended/);
    expect(problemMessage({ kind: "signed_out", status: 401 })).toMatch(/signed out/);
    expect(problemMessage({ kind: "stale", status: 409 })).toMatch(/moved on/);
    expect(problemMessage({ kind: "other", status: 400 })).toBe("The request failed (status 400).");
    expect(problemMessage({ kind: "other", status: null })).toBe("The request failed.");
  });
});

describe("R3.13 seats of a prompt", () => {
  it("R3.13 six seats in table order with stacks, the hero's cards, the button and the folds", () => {
    const seats = seatsOfPrompt(fixturePlainPrompt);
    expect(seats.map((seat) => seat.position)).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(seats.map((seat) => seat.stackCbb)).toEqual(fixturePlainPrompt.stacks_cbb);
    const hero = seats.find((seat) => seat.isHero);
    expect(hero).toMatchObject({ position: "BTN", isButton: true, cards: ["Ah", "Jd"] });
    expect(seats.filter((seat) => seat.hasFolded).map((seat) => seat.position)).toEqual(["UTG", "HJ", "CO"]);
    expect(seats.filter((seat) => seat.cards !== undefined)).toHaveLength(1);
  });

  it("R3.13 a seat that raised is not folded", () => {
    const prompt = fixtureTrainerHands[2]?.prompt ?? fixturePlainPrompt;
    const seats = seatsOfPrompt(prompt);
    expect(seats.find((seat) => seat.position === "BTN")?.hasFolded).toBe(false);
    expect(seats.find((seat) => seat.position === "SB")?.hasFolded).toBe(true);
  });

  it("R3.13 a stack count with no known seat list yields no seats, so the table renders its alert", () => {
    expect(seatsOfPrompt({ ...fixturePlainPrompt, stacks_cbb: [] })).toEqual([]);
    expect(seatsOfPrompt({ ...fixturePlainPrompt, stacks_cbb: Array.from({ length: 10 }, () => 100) })).toEqual([]);
  });
});
