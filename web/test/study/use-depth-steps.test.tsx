/**
 * Tests for useDepthSteps (S45, R3.12, O-467, code review): the neighbouring covered depths follow
 * the sibling configurations' pairs as they load and change, including a refetch that flips a pair's
 * availability without changing how many pairs the list holds.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { pairsQuery, type PositionPairEntry } from "../../src/study/queries.js";
import { useDepthSteps } from "../../src/study/use-depth-steps.js";
import { TEST_ORIGIN } from "../app/render-app.js";
import { fixtureConfigs, fixtureOnlineStake } from "./depth-fixtures.js";

const SEARCH = { format: "online", table_size: 6, stake: fixtureOnlineStake, depth: 10000, pair: "BB-BTN" } as const;

function pairs(available: boolean): PositionPairEntry[] {
  return [
    { pair: "BB-BTN", oop: "BB", ip: "BTN", preflop_available: available },
    { pair: "SB-BB", oop: "SB", ip: "BB", preflop_available: true },
  ];
}

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
    expect(result.current).toEqual({ deeper: 20000, shallower: undefined });
    act(() => {
      client.setQueryData(key("cfg_6_online_200"), pairs(false));
    });
    // React Query notifies observers on a later tick, so the new neighbours arrive asynchronously.
    await waitFor(() => expect(result.current).toEqual({ deeper: 30000, shallower: undefined }));
  });
});
