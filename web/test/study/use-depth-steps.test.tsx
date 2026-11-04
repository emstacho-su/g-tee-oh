/**
 * Tests for useDepthSteps (S45, R3.12, O-467, code review): the neighbouring covered depths follow
 * the sibling configurations' pairs as they load and change, including a refetch that flips a pair's
 * availability without changing how many pairs the list holds.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { pairsQuery, type PositionPairEntry } from "../../src/study/queries.js";
import { useDepthSteps } from "../../src/study/use-depth-steps.js";
import { TEST_ORIGIN } from "../app/render-app.js";
import { fixtureConfigs, fixtureOnlineStake } from "./depth-fixtures.js";

const SEARCH = { format: "online", table_size: 6, stake: fixtureOnlineStake, depth: 10000, pair: "BB-BTN" } as const;

const PROBLEM_500 = JSON.stringify({ type: "urn:g-tee-oh:problem:internal", title: "t", status: 500 });

/** A fetch that fails every read of the named configs' pairs with a 500 and never answers any other. */
function failingFor(...configIds: string[]): (input: Request) => Promise<Response> {
  return (input) =>
    configIds.some((configId) => input.url.includes(`/configs/${configId}/pairs`))
      ? Promise.resolve(new Response(PROBLEM_500, { status: 500, headers: { "content-type": "application/problem+json" } }))
      : new Promise<Response>(() => undefined);
}

function depthLogs(errors: { mock: { calls: unknown[][] } }): unknown[][] {
  return errors.mock.calls.filter((call) => String(call[0]).includes("could not be read for the depth keys"));
}

function pairs(available: boolean): PositionPairEntry[] {
  return [
    { pair: "BB-BTN", oop: "BB", ip: "BTN", preflop_available: available },
    { pair: "SB-BB", oop: "SB", ip: "BB", preflop_available: true },
  ];
}

describe("R3.12 useDepthSteps reports a failed sibling read (code review 3)", () => {
  it("R3.12 a sibling depth whose seats fail to load is logged once and listed as unchecked, never silently dropped", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = (input: Request): Promise<Response> =>
      Promise.resolve(
        input.url.includes("/configs/cfg_6_online_200/pairs")
          ? new Response(JSON.stringify({ type: "urn:g-tee-oh:problem:internal", title: "t", status: 500 }), { status: 500, headers: { "content-type": "application/problem+json" } })
          : new Response(null, { status: 599 }),
      );
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
    const client = new QueryClient();
    const key = (configId: string) => pairsQuery(api, configId).queryKey;
    client.setQueryData(key("cfg_6_online_100"), pairs(true));
    client.setQueryData(key("cfg_6_online_300"), pairs(true));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(() => useDepthSteps(api, fixtureConfigs, SEARCH), { wrapper });
    await waitFor(() => expect(result.current.unchecked).toEqual([20000]));
    expect(result.current).toMatchObject({ deeper: 30000, shallower: undefined });
    rerender();
    const logged = errors.mock.calls.filter((call) => String(call[0]).includes("could not be read for the depth keys"));
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain("cfg_6_online_200");
    errors.mockRestore();
  });
});

describe("R3.12 useDepthSteps lists only depths it truly could not check (PR 52 review 1)", () => {
  function setUp(fetch: (input: Request) => Promise<Response>, seeded: readonly string[]) {
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch });
    const client = new QueryClient();
    const key = (configId: string) => pairsQuery(api, configId).queryKey;
    for (const configId of seeded) client.setQueryData(key(configId), pairs(true));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, key, ...renderHook(() => useDepthSteps(api, fixtureConfigs, SEARCH), { wrapper }) };
  }

  it("R3.12 the current depth is never listed as unchecked, even when its read fails", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = setUp(failingFor("cfg_6_online_100"), ["cfg_6_online_200", "cfg_6_online_300"]);
    await waitFor(() => expect(depthLogs(errors)).toHaveLength(1));
    expect(result.current).toEqual({ deeper: 20000, shallower: undefined, unchecked: [] });
    errors.mockRestore();
  });

  it("R3.12 a failed refetch that keeps its cached seats still counts as checked", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, client, key } = setUp(failingFor("cfg_6_online_200"), ["cfg_6_online_100", "cfg_6_online_200", "cfg_6_online_300"]);
    await act(async () => {
      await client.refetchQueries({ queryKey: key("cfg_6_online_200") });
    });
    await waitFor(() => expect(depthLogs(errors)).toHaveLength(1));
    expect(result.current).toEqual({ deeper: 20000, shallower: undefined, unchecked: [] });
    errors.mockRestore();
  });

  it("R3.12 each distinct failure is logged, not only the first per configuration", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result, client, key, rerender } = setUp(failingFor("cfg_6_online_200"), ["cfg_6_online_100", "cfg_6_online_300"]);
    await waitFor(() => expect(result.current.unchecked).toEqual([20000]));
    await act(async () => {
      await client.refetchQueries({ queryKey: key("cfg_6_online_200") });
    });
    await waitFor(() => expect(depthLogs(errors)).toHaveLength(2));
    rerender();
    expect(depthLogs(errors)).toHaveLength(2);
    errors.mockRestore();
  });
});

describe("R3.12 useDepthSteps (O-467)", () => {
  it("R3.12 a refetch that flips a pair's availability, same list length, moves the neighbours (code review)", async () => {
    // A fetch that never answers: every read here comes from the seeded cache.
    const api = createAppApi({ baseUrl: TEST_ORIGIN, fetch: () => new Promise<Response>(() => undefined) });
    const client = new QueryClient();
    const key = (configId: string) => pairsQuery(api, configId).queryKey;
    client.setQueryData(key("cfg_6_online_100"), pairs(true));
    client.setQueryData(key("cfg_6_online_200"), pairs(true));
    client.setQueryData(key("cfg_6_online_300"), pairs(true));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDepthSteps(api, fixtureConfigs, SEARCH), { wrapper });
    expect(result.current).toEqual({ deeper: 20000, shallower: undefined, unchecked: [] });
    act(() => {
      client.setQueryData(key("cfg_6_online_200"), pairs(false));
    });
    // React Query notifies observers on a later tick, so the new neighbours arrive asynchronously.
    await waitFor(() => expect(result.current).toEqual({ deeper: 30000, shallower: undefined, unchecked: [] }));
  });
});
