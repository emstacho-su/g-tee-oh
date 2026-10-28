// Tests for e2e/support/mock-progress.ts (S32, R4.12, O-264): the mocked progress routes the
// shots and the mock flows use, called through createMockApi with no browser.
import { describe, expect, it } from "vitest";

import { createAppMockApi } from "../../e2e/support/mock-app.js";
import { createMockApi, type MockApi, type MockRequest } from "../../e2e/support/mock-api.js";
import { PROGRESS_PATH_PREFIX, createMockProgressRoute, type MockProgress } from "../../e2e/support/mock-progress.js";
import { fixtureFreshFrequencies, fixtureFrequencies } from "../../src/fixtures/frequencies.js";
import { FIXTURE_USER_EMAIL } from "../../src/fixtures/index.js";
import { fixtureFreshRating, fixtureLeaks, fixtureRating, fixtureTracks } from "../../src/fixtures/progress.js";

function request(method: string, path: string, init: Partial<MockRequest> = {}): MockRequest {
  return { method, path, query: {}, headers: {}, body: undefined, ...init };
}

function signIn(api: MockApi): void {
  api.handle(request("POST", "/api/v1/auth/login", { body: { email: FIXTURE_USER_EMAIL, password: "x" } }));
}

function signedInApi(progress: MockProgress): MockApi {
  const api = createMockApi({ routes: [progress.route] });
  signIn(api);
  return api;
}

function get(api: MockApi, name: string, query: Record<string, string> = {}) {
  return api.handle(request("GET", `${PROGRESS_PATH_PREFIX}${name}`, { query }));
}

describe("R4.12 mocked progress routes", () => {
  it("R4.12 other paths, unknown progress paths and other methods pass through", () => {
    const { route } = createMockProgressRoute();
    expect(route(request("GET", "/api/v1/stakes"), { signedIn: true })).toBeUndefined();
    expect(route(request("GET", `${PROGRESS_PATH_PREFIX}unknown`), { signedIn: true })).toBeUndefined();
    expect(route(request("POST", `${PROGRESS_PATH_PREFIX}rating`), { signedIn: true })).toBeUndefined();
  });

  it("R4.12 answers 401 when signed out", () => {
    const api = createMockApi({ routes: [createMockProgressRoute().route] });
    expect(get(api, "rating").status).toBe(401);
  });

  it("R4.12 a seasoned learner reads the history fixtures", () => {
    const api = signedInApi(createMockProgressRoute());
    expect(get(api, "rating").body).toEqual(fixtureRating);
    expect(get(api, "tracks").body).toEqual({ items: [...fixtureTracks], next_cursor: null });
    expect(get(api, "leaks", { weeks: "8" }).body).toEqual(fixtureLeaks);
    for (const name of ["heatmap", "holdout", "streak"]) expect(get(api, name).status).toBe(200);
  });

  it("R4.12 the leaks route refuses weeks outside 1 to 52 with 400 validation", () => {
    const api = signedInApi(createMockProgressRoute());
    for (const weeks of ["0", "53", "x", "1.5"]) expect(get(api, "leaks", { weeks }).status).toBe(400);
    expect(get(api, "leaks").status).toBe(200);
  });

  it("R4.10 a fresh learner is unrated until the control moves it to seasoned", () => {
    const progress = createMockProgressRoute("fresh");
    const api = signedInApi(progress);
    expect(get(api, "rating").body).toEqual(fixtureFreshRating);
    progress.setLearner("seasoned");
    expect(progress.learner()).toBe("seasoned");
    expect(get(api, "rating").body).toEqual(fixtureRating);
  });

  it("R4.12 the frequencies read: two spots for a seasoned learner (one above both minimums, one below the spot minimum), none for a fresh one", () => {
    const progress = createMockProgressRoute();
    const api = signedInApi(progress);
    const seasoned = get(api, "frequencies");
    expect(seasoned).toMatchObject({ status: 200, body: fixtureFrequencies });
    const spots = fixtureFrequencies.spots;
    expect(spots.some((spot) => spot.pooled !== null && spot.hands.length > 0)).toBe(true);
    expect(spots.some((spot) => spot.pooled === null && spot.decisions < fixtureFrequencies.min_spot_decisions)).toBe(true);
    // PR #39 review finding 6: every served spot names the solution it was graded on.
    const served = (seasoned.body as typeof fixtureFrequencies).spots;
    expect(served.every((spot) => /^[0-9a-f-]{36}$/.test(spot.solution_id))).toBe(true);
    progress.setLearner("fresh");
    expect(get(api, "frequencies").body).toEqual(fixtureFreshFrequencies);
    expect(get(createMockApi({ routes: [createMockProgressRoute().route] }), "frequencies").status).toBe(401);
  });

  it("R4.12 the app mock serves progress and hands the control to the caller", () => {
    let control: MockProgress | undefined;
    const api = createAppMockApi({ learner: "fresh", onProgress: (progress) => (control = progress) });
    signIn(api);
    expect(control?.learner()).toBe("fresh");
    expect(get(api, "rating").body).toEqual(fixtureFreshRating);
  });
});
