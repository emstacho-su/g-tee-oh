/**
 * The reach hook keeps good cached data when a background refetch fails (S47, R3.37; PR #48 review
 * round 3 MEDIUM 3): data is checked before isError, so the badge and the status line do not drop
 * to "failed" over a cached catalog.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createAppApi } from "../../src/api/index.js";
import { ApiProvider, createQueryClient } from "../../src/auth/index.js";
import { useDrillReach } from "../../src/drills/use-drill-reach.js";
import { fixtureConfigs, fixturePairsByConfig } from "../../src/fixtures/study.js";
import { fixtureDrill } from "../../src/fixtures/trainer.js";
import { practicePairsQuery } from "../../src/practice/catalog-spot.js";
import { allConfigsQuery } from "../../src/routes/settings/configs-query.js";
import { createFakeFetch, problemResponse } from "../api/fake-fetch.js";

describe("R3.37 the reach hook over cached reads", () => {
  it("R3.37 a failed refetch of the configuration and pairs reads keeps the cached reach", async () => {
    const fake = createFakeFetch({
      "GET /api/v1/configs": [problemResponse(503, "unavailable")],
      "GET /api/v1/configs/cfg_6_online_100/pairs": [problemResponse(503, "unavailable")],
    });
    const api = createAppApi({ baseUrl: "http://localhost:4173", fetch: fake.fetch });
    const queryClient = createQueryClient();
    queryClient.setQueryData(allConfigsQuery(api).queryKey, [...fixtureConfigs]);
    queryClient.setQueryData(practicePairsQuery(api, "cfg_6_online_100").queryKey, [...(fixturePairsByConfig["cfg_6_online_100"] ?? [])]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>{children}</ApiProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDrillReach(fixtureDrill.spot_filter), { wrapper });
    expect(result.current).toEqual({ reach: { spots: 1, covered: 1, missing: 0, configIds: ["cfg_6_online_100"] } });
    // Force the background refetches; both fail, and the cached reach stands.
    await queryClient.refetchQueries({ queryKey: allConfigsQuery(api).queryKey }).catch(() => undefined);
    await queryClient.refetchQueries({ queryKey: practicePairsQuery(api, "cfg_6_online_100").queryKey }).catch(() => undefined);
    await waitFor(() => expect(fake.calls.length).toBeGreaterThanOrEqual(2));
    expect(result.current).toEqual({ reach: { spots: 1, covered: 1, missing: 0, configIds: ["cfg_6_online_100"] } });
  });
});
