// The S32 foundation (R4.12, R4.14): the progress reads, the fixtures' shape, the text helpers,
// and the two stat tiles both /progress and the home screen use (RatingCard, StreakBadge).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppApi, ApiProblem } from "../../src/api/index.js";
import { RatingCard, StreakBadge, UNRATED_HINT, UNRATED_TEXT } from "../../src/components/progress/index.js";
import {
  fixtureFreshHeatmap,
  fixtureFreshRating,
  fixtureFreshStreak,
  fixtureHeatmap,
  fixtureLeaks,
  fixtureRating,
  fixtureRepairableStreak,
  fixtureStreak,
  fixtureTracks,
  FIXTURE_HEATMAP_COLUMNS,
  FIXTURE_HEATMAP_ROWS,
} from "../../src/fixtures/progress.js";
import { formatDeviation, formatMonth, formatPercent, formatShortDate, tierLabel, trackName } from "../../src/progress/format.js";
import { fetchAllTracks, holdoutQuery, leaksQuery, MAX_TRACK_PAGES, progressKeys, ratingQuery } from "../../src/progress/queries.js";
import { createFakeFetch, jsonResponse, problemResponse } from "../api/fake-fetch.js";
import { TEST_ORIGIN } from "../app/render-app.js";

/** An api over the fake fetch that also records each request's full URL (the fake keeps the path only). */
function apiWith(script: Parameters<typeof createFakeFetch>[0]) {
  const fake = createFakeFetch(script);
  const urls: string[] = [];
  const fetch = (input: Request): Promise<Response> => {
    urls.push(input.url);
    return fake.fetch(input);
  };
  return { urls, api: createAppApi({ baseUrl: TEST_ORIGIN, fetch }) };
}

async function run<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

describe("R4.12 progress fixtures", () => {
  it("R4.12 the heat map has one cell per row and column, some never practiced", () => {
    expect(fixtureHeatmap.cells).toHaveLength(FIXTURE_HEATMAP_ROWS.length * FIXTURE_HEATMAP_COLUMNS.length);
    expect(fixtureHeatmap.cells.some((cell) => cell.p_known === null)).toBe(true);
    expect(fixtureHeatmap.cells.some((cell) => cell.mastered)).toBe(true);
    expect(fixtureFreshHeatmap.cells.every((cell) => cell.p_known === null && cell.n === 0)).toBe(true);
  });

  it("R4.12 the leak trend holds ten classes ranked by cost over eight weeks, the last partial", () => {
    expect(fixtureLeaks.items).toHaveLength(10);
    const costs = fixtureLeaks.items.map((item) => item.leak_cost_bb_per_1k);
    expect([...costs].sort((a, b) => b - a)).toEqual(costs);
    for (const item of fixtureLeaks.items) {
      expect(item.series.map((point) => point.week)).toEqual(fixtureLeaks.weeks);
      expect(item.series.at(-1)?.partial).toBe(true);
      expect(fixtureHeatmap.cells.some((cell) => cell.spot_class_key === item.spot_class_key)).toBe(true);
    }
    expect(fixtureLeaks.items.some((item) => item.series.some((point) => point.leak_cost_bb_per_1k === null))).toBe(true);
  });
});

describe("R4.12 progress text", () => {
  it("R4.12 formats tiers, deviations, percents, dates and track names", () => {
    expect(tierLabel("III")).toBe("Tier III");
    expect(formatDeviation(74.2)).toBe("± 74");
    expect(formatPercent(0.814)).toBe("81%");
    expect(formatShortDate("2026-10-26")).toBe("Oct 26");
    expect(formatShortDate("2026-10-28T23:00:00Z")).toBe("Oct 28");
    expect(formatShortDate("not a date")).toBe("not a date");
    expect(formatShortDate("2026-13-01")).toBe("2026-13-01");
    expect(formatMonth("2026-09-01")).toBe("September 2026");
    expect(formatMonth("soon")).toBe("soon");
    expect(trackName("opens", { opens: "Opens" })).toBe("Opens");
    expect(trackName("opens", undefined)).toBe("opens");
  });
});

describe("R4.12 progress reads", () => {
  it("R4.12 the rating read answers the body and keys under the progress root", async () => {
    const { api } = apiWith({ "GET /api/v1/progress/rating": [jsonResponse(200, fixtureRating)] });
    const options = ratingQuery(api);
    expect(options.queryKey).toEqual(progressKeys.rating);
    expect(options.queryKey[0]).toBe(progressKeys.all[0]);
    await expect(run(options)).resolves.toEqual(fixtureRating);
  });

  it("R4.12 a failed read becomes an ApiProblem with the status and slug", async () => {
    const { api } = apiWith({ "GET /api/v1/progress/rating": [problemResponse(503, "unavailable")] });
    const failure = await run(ratingQuery(api)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).status).toBe(503);
  });

  it("R4.12 the leaks read sends weeks and the holdout read a page limit", async () => {
    const { api, urls } = apiWith({
      "GET /api/v1/progress/leaks": [jsonResponse(200, fixtureLeaks)],
      "GET /api/v1/progress/holdout": [jsonResponse(200, { items: [], next_cursor: null, open: null })],
    });
    await run(leaksQuery(api, 26));
    await run(holdoutQuery(api));
    expect(urls).toEqual([
      `${TEST_ORIGIN}/api/v1/progress/leaks?weeks=26`,
      `${TEST_ORIGIN}/api/v1/progress/holdout?limit=12`,
    ]);
  });

  it("R4.12 the tracks read follows next_cursor to the last page", async () => {
    const [first, ...rest] = fixtureTracks;
    const { api, urls } = apiWith({
      "GET /api/v1/progress/tracks": [
        jsonResponse(200, { items: [first], next_cursor: "c1" }),
        jsonResponse(200, { items: rest, next_cursor: null }),
      ],
    });
    await expect(fetchAllTracks(api)).resolves.toEqual(fixtureTracks);
    expect(urls[1]).toContain("cursor=c1");
  });

  it("R4.12 the tracks read fails loudly when the cursor never ends", async () => {
    const page = jsonResponse(200, { items: [], next_cursor: "again" });
    const { api } = apiWith({ "GET /api/v1/progress/tracks": Array.from({ length: MAX_TRACK_PAGES }, () => page) });
    await expect(fetchAllTracks(api)).rejects.toThrow(RangeError);
  });
});

describe("R4.12 RatingCard", () => {
  it("R4.12 shows the rating with its deviation, the tier and the conservative figure", () => {
    render(<RatingCard rating={fixtureRating} trackNames={{ "live-limped-straddled": "Live limped and straddled pots" }} />);
    expect(screen.getByTestId("rating-value")).toHaveTextContent("1612");
    expect(screen.getByLabelText("plus or minus 74")).toHaveTextContent("± 74");
    expect(screen.getByTestId("rating-tier")).toHaveTextContent("Tier III");
    expect(screen.getByText("Conservative rating 1464")).toBeInTheDocument();
    expect(screen.getByTestId("rating-blocked")).toHaveTextContent("reaches Tier IV");
    expect(screen.getByTestId("rating-blocked")).toHaveTextContent("Live limped and straddled pots");
    expect(screen.getByText("Updated Oct 27")).toBeInTheDocument();
  });

  it("R4.12 says unrated with the way to get a rating before any rated session", () => {
    render(<RatingCard rating={fixtureFreshRating} footer={<a href="/progress">Open progress</a>} badge={<span>badge</span>} />);
    expect(screen.getByTestId("rating-value")).toHaveTextContent(UNRATED_TEXT);
    expect(screen.getByText(UNRATED_HINT)).toBeInTheDocument();
    expect(screen.queryByTestId("rating-tier")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open progress" })).toBeInTheDocument();
    expect(screen.getByText("badge")).toBeInTheDocument();
  });

  it("R4.12 shows no blocked note when the tier equals its band", () => {
    const overall = { ...fixtureRating.overall!, band_tier: "III" as const };
    render(<RatingCard rating={{ ...fixtureRating, overall }} />);
    expect(screen.queryByTestId("rating-blocked")).not.toBeInTheDocument();
  });
});

describe("R4.14 StreakBadge", () => {
  it("R4.14 shows the streak, today's count in text, freezes and the next milestone", () => {
    render(<StreakBadge streak={fixtureStreak} describeCosmetic={(key) => `the ${key} badge`} />);
    expect(screen.getByTestId("streak-current")).toHaveTextContent("9 days");
    expect(screen.getByText("Longest 15 days")).toBeInTheDocument();
    expect(screen.getByTestId("streak-today")).toHaveTextContent("3 of 5 rated decisions");
    expect(screen.getByTestId("streak-today")).not.toHaveTextContent("day counted");
    expect(screen.getByText("Freezes left this week: 1")).toBeInTheDocument();
    expect(screen.getByTestId("streak-next")).toHaveTextContent("Next: 30 days unlocks the badge-streak-30 badge.");
    expect(screen.queryByTestId("streak-repair")).not.toBeInTheDocument();
  });

  it("R4.14 states a repairable day neutrally with its deadline", () => {
    render(<StreakBadge streak={fixtureRepairableStreak} />);
    expect(screen.getByTestId("streak-repair")).toHaveTextContent("The day Oct 26 can still count: 4 of 10 rated decisions by Oct 28.");
  });

  it("R4.14 marks a counted day and reads singular days", () => {
    render(<StreakBadge streak={{ ...fixtureFreshStreak, current_days: 1, today_rated: 5, next_milestone: null }} />);
    expect(screen.getByTestId("streak-current")).toHaveTextContent("1 day");
    expect(screen.getByTestId("streak-today")).toHaveTextContent("(day counted)");
    expect(screen.queryByTestId("streak-next")).not.toBeInTheDocument();
  });
});
