/**
 * Auto drills (S47 follow-up, O-489): a drill is an auto drill only when it carries the tag the
 * leak opener makes, "auto-" and exactly AUTO_TAG_HASH_CHARS lowercase hex characters, so a user's
 * own tag that happens to start with "auto-" is never hidden (PR #51 review 3).
 */
import { describe, expect, it } from "vitest";

import { AUTO_TAG_HASH_CHARS, isAutoDrill, isAutoTag } from "../../src/drills/auto-drills.js";
import { autoDrillTag } from "../../src/progress/open-drill.js";

const HASH = "0123456789abcdef".repeat(4);

describe("R4.12 the auto drill tag", () => {
  it("R4.12 only the generated shape is an auto tag (PR #51 review 3)", () => {
    expect(AUTO_TAG_HASH_CHARS).toBe(26);
    expect(isAutoTag(autoDrillTag(HASH))).toBe(true);
    expect(isAutoTag("auto-mine")).toBe(false);
    expect(isAutoTag(`auto-${HASH.slice(0, AUTO_TAG_HASH_CHARS - 1)}`)).toBe(false);
    expect(isAutoTag(`auto-${HASH.slice(0, AUTO_TAG_HASH_CHARS + 1)}`)).toBe(false);
    expect(isAutoTag(`auto-${HASH.slice(0, AUTO_TAG_HASH_CHARS).toUpperCase()}`)).toBe(false);
    expect(isAutoDrill({ tags: ["starter", autoDrillTag(HASH)] })).toBe(true);
    expect(isAutoDrill({ tags: ["auto-review"] })).toBe(false);
  });
});
