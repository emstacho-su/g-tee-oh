/**
 * Tests for the feedback panel's insight cards (S27 lane C, R3.18, O-304, 05 section 9): the noise
 * flags card renders only when the decision carries flags and says the decision is graded for
 * feedback but excluded from the rating; the drift card reads GET /insights/drift for the
 * decision's spot class from an injected fake fetch and shows the hidden state, the shown state
 * (distance and interval formatted, a per-kind table, "Insight only, never graded") and an error
 * with a retry. The drift read is keyed by the decision's attempt and kept fresh for a named time
 * (PR #29 review M9): remounting the same decision's panel reads nothing new, the next decision does.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider } from "../../src/auth/index.js";
import { DriftCard, FeedbackInsights, NoiseFlagsCard } from "../../src/components/insights/index.js";
import { DRIFT_STALE_MS, driftQuery, driftQueryKey } from "../../src/components/insights/queries.js";
import { NOISE_FLAG_TEXT, NoiseFlags } from "../../src/components/panels/NoiseFlags.js";
import type { DecisionFeedback } from "../../src/contracts.js";
import { FIXTURE_SPOT_CLASS_KEY, fixtureFeedback } from "../../src/fixtures/index.js";
import { fixtureDriftHiddenFor, fixtureDriftShown } from "../../src/fixtures/insights.js";
import { createFakeFetch, jsonResponse, networkFailure, problemResponse, type FetchScript } from "../api/fake-fetch.js";

const ORIGIN = "http://localhost:4173";
const DRIFT_PATH = "GET /api/v1/insights/drift";

const ATTEMPT_ID = fixtureFeedback.attempt_id;

function setup(script: FetchScript, ui: ReactNode) {
  const fake = createFakeFetch(script);
  const api = createAppApi({ baseUrl: ORIGIN, fetch: fake.fetch });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>{node}</ApiProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { fake, view, wrap };
}

const UNFLAGGED: DecisionFeedback = { ...fixtureFeedback, noise_flags: [], rated: true };
const FLAGGED: DecisionFeedback = { ...fixtureFeedback, noise_flags: ["close_ev_mix", "rare_line"], rated: false };

describe("R3.18 NoiseFlags chips (components/panels)", () => {
  it("R3.18 renders one text chip per flag and nothing without flags", () => {
    const { rerender } = render(<NoiseFlags flags={["close_ev_mix", "suit_mixing"]} />);
    const list = screen.getByRole("list", { name: "Noise flags" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      NOISE_FLAG_TEXT.close_ev_mix,
      NOISE_FLAG_TEXT.suit_mixing,
    ]);
    rerender(<NoiseFlags flags={[]} />);
    expect(screen.queryByRole("list", { name: "Noise flags" })).toBeNull();
  });
});

describe("R3.18 NoiseFlagsCard", () => {
  it("R3.18 renders the chips only when the decision has flags; the why-unrated sentence moved beside the Unrated chip (S46)", () => {
    const { rerender } = render(<NoiseFlagsCard flags={FLAGGED.noise_flags} />);
    const card = screen.getByRole("region", { name: "Noise flags" });
    expect(within(card).getByText("Close EV mix")).toBeTruthy();
    expect(within(card).getByText("Rare line")).toBeTruthy();
    expect(card.textContent).not.toContain("left out of your rating");
    rerender(<NoiseFlagsCard flags={[]} />);
    expect(screen.queryByRole("region", { name: "Noise flags" })).toBeNull();
  });
});

describe("R3.18 driftQuery", () => {
  it("R3.18 reads GET /insights/drift with the spot class, keyed by spot class and attempt, fresh for a named time", async () => {
    const urls: string[] = [];
    const api = createAppApi({
      baseUrl: ORIGIN,
      fetch: (request) => {
        urls.push(request.url);
        return Promise.resolve(jsonResponse(200, fixtureDriftShown)());
      },
    });
    const options = driftQuery(api, FIXTURE_SPOT_CLASS_KEY, ATTEMPT_ID);
    expect(options.queryKey).toEqual(driftQueryKey(FIXTURE_SPOT_CLASS_KEY, ATTEMPT_ID));
    expect(options.queryKey).toEqual(["insights", "drift", FIXTURE_SPOT_CLASS_KEY, ATTEMPT_ID]);
    expect(DRIFT_STALE_MS).toBe(300_000);
    expect(options.staleTime).toBe(DRIFT_STALE_MS);
    const drift = await new QueryClient().fetchQuery(options);
    expect(drift).toEqual(fixtureDriftShown);
    expect(new URL(urls[0] ?? "").searchParams.get("spot_class_key")).toBe(FIXTURE_SPOT_CLASS_KEY);
  });
});

describe("R3.18 DriftCard", () => {
  it("R3.18 says drift appears after the minimum, with the count so far, while hidden", async () => {
    setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftHiddenFor(FIXTURE_SPOT_CLASS_KEY, 12))] }, <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />);
    expect(await screen.findByText("Range drift appears after 30 decisions in this spot family (12 so far).")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("R3.18 shows the distance and interval as percentages and a per-kind table when shown", async () => {
    setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftShown)] }, <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />);
    const card = await screen.findByRole("region", { name: "Range drift" });
    await within(card).findByRole("table");
    expect(card.textContent).toContain("12.4%");
    expect(card.textContent).toContain("95% interval 7.1% to 18.9%");
    expect(card.textContent).toContain("42 decisions");
    expect(card.textContent).toContain("Insight only, never graded.");
    const table = within(card).getByRole("table");
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent));
    expect(rows).toEqual([
      ["Action", "You", "Solver"],
      ["Fold", "43.0%", "55.0%"],
      ["Call", "7.0%", "5.0%"],
      ["Raise", "50.0%", "38.0%"],
    ]);
  });

  it.each([
    ["distance", { distance: null }],
    ["ci_low", { ci_low: null }],
    ["ci_high", { ci_high: null }],
  ])("R3.18 a shown drift missing its %s shows the hidden text instead of a made-up number", async (_field, patch) => {
    setup({ [DRIFT_PATH]: [jsonResponse(200, { ...fixtureDriftShown, ...patch })] }, <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />);
    expect(await screen.findByText("Range drift appears after 30 decisions in this spot family (42 so far).")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("R3.18 a failed read is an alert with a status and a retry that reloads", async () => {
    const { fake } = setup(
      { [DRIFT_PATH]: [problemResponse(503, "unavailable"), jsonResponse(200, fixtureDriftShown)] },
      <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Range drift could not load (status 503).");
    expect(alert.textContent).not.toContain("server detail text");
    await userEvent.click(screen.getByRole("button", { name: "Retry range drift" }));
    await screen.findByRole("table");
    expect(fake.calls).toHaveLength(2);
  });

  it("R3.18 a network failure names no status", async () => {
    setup({ [DRIFT_PATH]: [networkFailure()] }, <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Range drift could not load (network error).");
  });

  it("R3.18 shows a loading note first", () => {
    setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftShown)] }, <DriftCard spotClassKey={FIXTURE_SPOT_CLASS_KEY} attemptId={ATTEMPT_ID} />);
    expect(screen.getByText(/Loading range drift/)).toBeTruthy();
  });
});

describe("R3.18 FeedbackInsights", () => {
  it("R3.18 a flagged decision shows the noise flags card and the drift card", async () => {
    const { fake } = setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftShown)] }, <FeedbackInsights feedback={FLAGGED} />);
    expect(screen.getByRole("region", { name: "Noise flags" })).toBeTruthy();
    await screen.findByRole("table");
    await waitFor(() => expect(fake.calls).toHaveLength(1));
  });

  it("R3.18 an unflagged decision shows the drift card without the noise flags card", async () => {
    setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftHiddenFor(FIXTURE_SPOT_CLASS_KEY, 3))] }, <FeedbackInsights feedback={UNFLAGGED} />);
    expect(screen.queryByRole("region", { name: "Noise flags" })).toBeNull();
    expect(await screen.findByText(/\(3 so far\)/)).toBeTruthy();
    expect(screen.getByTestId("feedback-insights")).toBeTruthy();
  });
});

describe("R3.18 drift read reuse (PR #29 review M9)", () => {
  it("R3.18 remounting the same decision's insights reads drift once, and the next decision reads it again", async () => {
    const next: DecisionFeedback = { ...UNFLAGGED, attempt_id: "01890000-0000-7000-8000-00000000beef" };
    const { fake, view, wrap } = setup({ [DRIFT_PATH]: [jsonResponse(200, fixtureDriftShown), jsonResponse(200, fixtureDriftShown)] }, <FeedbackInsights feedback={UNFLAGGED} />);
    await screen.findByRole("table");
    view.rerender(wrap(<p>Next hand</p>));
    view.rerender(wrap(<FeedbackInsights feedback={UNFLAGGED} />));
    await screen.findByRole("table");
    expect(fake.calls).toHaveLength(1);
    view.rerender(wrap(<FeedbackInsights feedback={next} />));
    await waitFor(() => expect(fake.calls).toHaveLength(2));
  });
});
