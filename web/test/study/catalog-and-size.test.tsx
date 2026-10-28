// Tests for the catalog query factories the study filters read (S25, R3.12, A5 section 3) and the
// matrix edge that keeps the canvas inside a narrow screen (A7 section 4).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProblem, createAppApi } from "../../src/api/index.js";
import { fixtureConfigs } from "../../src/fixtures/study.js";
import { MATRIX_GUTTER_PX, MIN_MATRIX_SIZE_PX, matrixSizeFor, useMatrixSize } from "../../src/routes/study/use-matrix-size.js";
import { configsQuery, formatConfigsQuery } from "../../src/study/queries.js";
import { createFakeFetch, jsonResponse, problemResponse, type ResponseFactory } from "../api/fake-fetch.js";
import { TEST_ORIGIN } from "../app/render-app.js";

const CONFIGS_KEY = "GET /api/v1/configs";
const JSDOM_WIDTH = 1024;

function apiAnswering(...responses: ResponseFactory[]) {
  const fake = createFakeFetch({ [CONFIGS_KEY]: responses });
  return createAppApi({ baseUrl: TEST_ORIGIN, fetch: fake.fetch });
}

function run<T>(options: { queryFn?: unknown }): Promise<T> {
  return (options.queryFn as () => Promise<T>)();
}

describe("R3.12 catalog queries", () => {
  it("R3.12 formatConfigsQuery lists the format's configurations under its own key", async () => {
    const api = apiAnswering(jsonResponse(200, { items: fixtureConfigs, next_cursor: null }));
    const options = formatConfigsQuery(api, "online");
    expect(options.queryKey).toEqual(["catalog", "configs-of-format", "online"]);
    await expect(run(options)).resolves.toEqual(fixtureConfigs);
  });

  it("R3.12 configsQuery lists the configurations of one format, table size and stake", async () => {
    const api = apiAnswering(jsonResponse(200, { items: fixtureConfigs.slice(0, 1), next_cursor: null }));
    const options = configsQuery(api, { format: "online", tableSize: 6, stakeId: "s" });
    await expect(run(options)).resolves.toEqual(fixtureConfigs.slice(0, 1));
  });

  it("R3.12 a failed catalog read becomes an ApiProblem", async () => {
    const api = apiAnswering(problemResponse(500, "internal"));
    await expect(run(formatConfigsQuery(api, "live"))).rejects.toBeInstanceOf(ApiProblem);
    await expect(run(configsQuery(api, { format: "live", tableSize: 9, stakeId: "s" }))).rejects.toMatchObject({ status: 500 });
  });
});

describe("R3.12 study matrix size", () => {
  it("R3.12 the matrix keeps the desktop edge, shrinks on a phone and never goes below the minimum", () => {
    expect(matrixSizeFor(1440)).toBe(520);
    expect(matrixSizeFor(390)).toBe(390 - MATRIX_GUTTER_PX);
    expect(matrixSizeFor(200)).toBe(MIN_MATRIX_SIZE_PX);
  });

  it("R3.12 the matrix follows a window resize", () => {
    const { result, unmount } = renderHook(() => useMatrixSize());
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(400 - MATRIX_GUTTER_PX);
    unmount();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: JSDOM_WIDTH });
  });
});
