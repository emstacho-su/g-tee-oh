/**
 * The shared drill-list read of the /paint and /predict pickers (S27, R3.16, R3.17, PR #29 review
 * L11): one query factory and one key for GET /drills, so moving between the two screens reads the
 * list once and both pickers show the same drills.
 */
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { fixturePaintDrills } from "../../src/fixtures/paint.js";
import { DRILL_LIST_LIMIT, DRILL_LIST_STALE_MS, drillListQuery, drillListQueryKey } from "../../src/practice/drill-list-query.js";
import { jsonResponse } from "../api/fake-fetch.js";
import { SIGNED_IN, TEST_ORIGIN, renderApp } from "../app/render-app.js";

const DRILLS = "GET /api/v1/drills";

describe("R3.16 R3.17 shared drill-list query (PR #29 review L11)", () => {
  it("R3.16 R3.17 reads the first page of GET /drills under one named key, limit and fresh time", async () => {
    const urls: string[] = [];
    const api = createAppApi({
      baseUrl: TEST_ORIGIN,
      fetch: (request) => {
        urls.push(request.url);
        return Promise.resolve(jsonResponse(200, { items: fixturePaintDrills, next_cursor: null })());
      },
    });
    const options = drillListQuery(api);
    expect(options.queryKey).toEqual(drillListQueryKey());
    expect(options.queryKey).toEqual(["practice", "drills", DRILL_LIST_LIMIT]);
    expect(DRILL_LIST_LIMIT).toBe(100);
    expect(DRILL_LIST_STALE_MS).toBe(60_000);
    expect(options.staleTime).toBe(DRILL_LIST_STALE_MS);
    expect(await new QueryClient().fetchQuery(options)).toEqual(fixturePaintDrills);
    expect(new URL(urls[0] ?? "").searchParams.get("limit")).toBe(String(DRILL_LIST_LIMIT));
  });

  it("R3.16 R3.17 /paint then /predict read the drill list once", async () => {
    const app = renderApp("/paint", { ...SIGNED_IN, [DRILLS]: [jsonResponse(200, { items: fixturePaintDrills, next_cursor: null })] });
    const name = fixturePaintDrills[0]?.name ?? "";
    expect(await screen.findByRole("radio", { name })).toBeInTheDocument();
    await app.router.navigate({ to: "/predict" });
    expect(await screen.findByRole("link", { name })).toBeInTheDocument();
    expect(app.fake.keys().filter((key) => key === DRILLS)).toHaveLength(1);
  });
});
