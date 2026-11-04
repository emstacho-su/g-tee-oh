/**
 * The remembered configuration labels (S47, R4.12, O-486; PR #48 review round 2 LOW 8): a refreshed
 * label counts as the newest entry, so at the cap the oldest untouched label is the one dropped.
 */
import { describe, expect, it } from "vitest";

import { MAX_SCOPE_CONFIGS, parseConfigLabels, withConfigLabels } from "../../src/store/index.js";

const ids = Array.from({ length: MAX_SCOPE_CONFIGS }, (_, index) => `cfg_6_online_${index + 1}`);
const full = Object.fromEntries(ids.map((id) => [id, `label ${id}`]));

describe("R4.12 the config label map at its cap", () => {
  it("R4.12 a refreshed label moves to the newest place, so the oldest untouched label is dropped", () => {
    const first = ids[0] as string;
    const refreshed = withConfigLabels(full, { [first]: "label refreshed" });
    const added = withConfigLabels(refreshed, { cfg_9_live_13_100: "a new one" });
    expect(Object.keys(added)).toHaveLength(MAX_SCOPE_CONFIGS);
    expect(added[first]).toBe("label refreshed");
    expect(added[ids[1] as string]).toBeUndefined();
    expect(Object.keys(added).at(-1)).toBe("cfg_9_live_13_100");
  });

  it("R4.12 the input map is never changed", () => {
    const before = { ...full };
    withConfigLabels(full, { cfg_9_live_13_100: "x" });
    expect(full).toEqual(before);
  });

  it("R4.12 a stored map over the cap keeps its newest entries, as withConfigLabels does (PR #48 review round 3 LOW 8)", () => {
    const over = Object.fromEntries([...ids, "cfg_9_live_13_100"].map((id) => [id, `label ${id}`]));
    const parsed = parseConfigLabels(over);
    expect(Object.keys(parsed)).toHaveLength(MAX_SCOPE_CONFIGS);
    expect(parsed["cfg_9_live_13_100"]).toBe("label cfg_9_live_13_100");
    expect(parsed[ids[0] as string]).toBeUndefined();
  });
});
