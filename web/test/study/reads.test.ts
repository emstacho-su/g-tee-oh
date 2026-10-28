// Tests for the shared read helpers of the study and library screens (S39 review round 1, R3.12):
// combineReads folds several queries into one loading flag, the first failure and a retry of the
// failed reads only; gatedPairsQuery reads a configuration's pairs only once its id is known.
import { describe, expect, it, vi } from "vitest";

import type { AppApi } from "../../src/api/index.js";
import { combineReads, gatedPairsQuery, type ReadState } from "../../src/study/reads.js";

function read(overrides: Partial<ReadState>): ReadState & { refetch: ReturnType<typeof vi.fn> } {
  return { isFetching: false, isError: false, error: null, refetch: vi.fn(), ...overrides } as ReadState & {
    refetch: ReturnType<typeof vi.fn>;
  };
}

describe("R3.12 combineReads", () => {
  it("R3.12 loading while any read fetches; no error when none failed", () => {
    expect(combineReads([read({}), read({ isFetching: true })])).toMatchObject({ loading: true, error: null });
    expect(combineReads([])).toMatchObject({ loading: false, error: null });
  });

  it("R3.12 reports the first failure and retries the failed reads only", () => {
    const ok = read({});
    const first = read({ isError: true, error: "first" });
    const second = read({ isError: true, error: "second" });
    const combined = combineReads([ok, first, second]);
    expect(combined.error).toBe("first");
    combined.retry();
    expect(ok.refetch).not.toHaveBeenCalled();
    expect(first.refetch).toHaveBeenCalledOnce();
    expect(second.refetch).toHaveBeenCalledOnce();
  });
});

describe("R3.12 gatedPairsQuery", () => {
  const api = {} as AppApi;

  it("R3.12 is disabled until the configuration id is known", () => {
    expect(gatedPairsQuery(api, undefined).enabled).toBe(false);
    const known = gatedPairsQuery(api, "cfg_6_online_100");
    expect(known.enabled).toBe(true);
    expect(known.queryKey).toEqual(["catalog", "pairs", "cfg_6_online_100"]);
  });
});
