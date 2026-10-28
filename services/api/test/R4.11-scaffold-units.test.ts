/**
 * Pure parts of the S31 scaffold (R4.11, R4.10, R4.13, O-272, O-276): the hook composition rules
 * (overrides and patches merge in order, a later part sees the earlier patches, recap extras
 * concatenate, guards combine), the session state's learning field (rows written before S31 parse
 * with learning null; automated and holdout states round-trip), and the session view.
 */
import type { GradeOutput } from "@g-tee-oh/learning";
import { describe, expect, it } from "vitest";

import type { FeedbackRow } from "../src/grading/feedback.js";
import {
  NO_LEARNING_HOOKS,
  composeLearningHooks,
  type AfterInsertContext,
  type DecisionContext,
  type HoldoutGuardContext,
  type SessionEndContext,
} from "../src/learning/effects.js";
import { DEFAULT_LEARNING_HOOKS, LEARNING_HOOK_PARTS } from "../src/learning/hooks.js";
import { EMPTY_HOLDOUT_GUARD } from "../src/sessions/holdout-guard.js";
import type { SessionRow } from "../src/sessions/repository.js";
import { toSession } from "../src/sessions/session-view.js";
import { learningOf, persistedStateSchema, type LearningState, type PersistedState } from "../src/sessions/state.js";
import type { Recap } from "../src/sessions/service.js";
import { TRAINER } from "./sessions-test-kit.js";

type RecapTier = NonNullable<Recap["tier"]>;

const ROUND_ID = "0190f000-0000-7000-8000-0000000000d1";
const ITEM_ID = "0190f000-0000-7000-8000-0000000000d2";
const SESSION_ID = "0190f000-0000-7000-8000-0000000000d3";

const S23_STATE: PersistedState = {
  phase: "dealing",
  seed: "00000000deadbeef",
  hand_no: 0,
  spots: [{ config_id: "cfg_6_online_100", pair: "BB-BTN", line: null, hero_seat: "BTN", history: [] }],
  spot: { preflop_action: ["rfi"], hands: { mode: "all" }, alternate_seats: false },
  hand: null,
  previous_board: null,
  last_attempt_id: null,
};

const AUTOMATED: LearningState = {
  kind: "automated",
  seeded: false,
  config_ids: ["cfg_6_online_100"],
  pick_no: 1,
  queue: { last_family: "rfi", hypercorrection: [] },
  block: {
    spot_class_key: "preflop/online/100/rfi/BB-BTN",
    family: "rfi",
    track_key: "opens",
    worked_example: true,
    served: 0,
    size: 3,
  },
};

const HOLDOUT: LearningState = {
  kind: "holdout",
  round_id: ROUND_ID,
  round_month: "2026-11-01",
  track_key: null,
  remaining: [ITEM_ID],
  answered: 2,
  total: 3,
  current_item: ITEM_ID,
};

function row(state: PersistedState, mode: SessionRow["mode"] = "automated"): SessionRow {
  return {
    id: SESSION_ID,
    userId: SESSION_ID,
    mode,
    drillId: null,
    settings: TRAINER,
    state,
    stateVersion: 0,
    startedAt: new Date("2026-11-02T00:00:00Z"),
    endedAt: null,
  };
}

const DECISION = {} as DecisionContext;
const NEXT: PersistedState = { ...S23_STATE };

describe("R4.11 hook composition", () => {
  it("R4.11 no parts change nothing", async () => {
    const hooks = NO_LEARNING_HOOKS;
    expect(await hooks.beforeGrade(DECISION)).toEqual({});
    expect(await hooks.afterInsert({ next: NEXT } as AfterInsertContext)).toEqual({ statePatch: {}, feedbackExtras: {} });
    expect(await hooks.onSessionEnd({} as SessionEndContext)).toEqual({});
    expect(await hooks.loadHoldoutGuard({} as HoldoutGuardContext)).toBe(EMPTY_HOLDOUT_GUARD);
  });

  it("R4.11 the production list runs the shared effects, then automated, then holdout", () => {
    expect(LEARNING_HOOK_PARTS.map((part) => part.name)).toEqual(["shared-effects", "automated", "holdout"]);
    expect(Object.keys(DEFAULT_LEARNING_HOOKS).sort()).toEqual(["afterInsert", "beforeGrade", "loadHoldoutGuard", "needsCatalog", "onSessionEnd", "prepareParts"]);
  });

  it("R4.11 later parts win per key, and each afterInsert sees the earlier patches", async () => {
    const seenLearning: (LearningState | null)[] = [];
    const hooks = composeLearningHooks([
      {
        name: "shared",
        beforeGrade: () => Promise.resolve({ trackIds: ["a"], itemDifficulty: 1 }),
        afterInsert: () => Promise.resolve({ statePatch: { learning: AUTOMATED } }),
      },
      {
        name: "automated",
        beforeGrade: () => Promise.resolve({ itemDifficulty: 2, mode: "automated" }),
        afterInsert: ({ next }) => {
          seenLearning.push(learningOf(next));
          return Promise.resolve({ feedbackExtras: { review_block: null } });
        },
      },
    ]);
    expect(await hooks.beforeGrade(DECISION)).toEqual({ trackIds: ["a"], itemDifficulty: 2, mode: "automated" });
    const context = { next: NEXT, attempt: {} as FeedbackRow, outcome: {} as GradeOutput, overrides: {} } as AfterInsertContext;
    expect(await hooks.afterInsert(context)).toEqual({ statePatch: { learning: AUTOMATED }, feedbackExtras: { review_block: null } });
    expect(seenLearning).toEqual([AUTOMATED]);
  });

  it("R4.11 recap extras concatenate, the last tier wins, and any guard holds a hand back", async () => {
    const tier: RecapTier = { overall: 1500, tier: "II", band_tier: "III", blocked_by: [] };
    const hooks = composeLearningHooks([
      {
        name: "rating",
        onSessionEnd: () => Promise.resolve({ rating_changes: [{ track_key: "opens", before: null, after: { mu: 1, rd: 2 } }], tier: null }),
        loadHoldoutGuard: () => Promise.resolve({ isHeldOut: (_s, _n, hand) => hand === "AA" }),
      },
      {
        name: "streaks",
        onSessionEnd: () => Promise.resolve({ unlocks: ["badge"], tier }),
        loadHoldoutGuard: () => Promise.resolve({ isHeldOut: (_s, _n, hand) => hand === "KK" }),
      },
    ]);
    expect(await hooks.onSessionEnd({} as SessionEndContext)).toEqual({
      rating_changes: [{ track_key: "opens", before: null, after: { mu: 1, rd: 2 } }],
      unlocks: ["badge"],
      tier,
    });
    const guard = await hooks.loadHoldoutGuard({} as HoldoutGuardContext);
    expect(["AA", "KK", "QQ"].map((hand) => guard.isHeldOut("s", "n", hand))).toEqual([true, true, false]);
  });
});

describe("R4.11 session state learning field", () => {
  it("R4.11 a row written before S31 parses with learning null", () => {
    const parsed = persistedStateSchema.parse(S23_STATE);
    expect(parsed.learning).toBeNull();
    expect(learningOf(S23_STATE)).toBeNull();
  });

  it("R4.11 automated and holdout learning states round-trip and malformed ones fail", () => {
    for (const learning of [AUTOMATED, HOLDOUT]) {
      expect(persistedStateSchema.parse({ ...S23_STATE, learning }).learning).toEqual(learning);
    }
    expect(() => persistedStateSchema.parse({ ...S23_STATE, learning: { ...HOLDOUT, kind: "drill" } })).toThrow();
    expect(() => persistedStateSchema.parse({ ...S23_STATE, learning: { ...AUTOMATED, extra: 1 } })).toThrow();
  });
});

describe("R4.10 R4.13 session view", () => {
  it("R4.10 an automated session shows its block and is rated unless seeded", () => {
    expect(toSession(row({ ...S23_STATE, learning: AUTOMATED }))).toMatchObject({
      rated_eligible: true,
      automated: { spot_class_key: AUTOMATED.block.spot_class_key, track_key: "opens", served: 0, size: 3, worked_example: true },
      holdout: null,
    });
    const seeded = { ...AUTOMATED, seeded: true };
    expect(toSession(row({ ...S23_STATE, learning: seeded })).rated_eligible).toBe(false);
  });

  it("R4.13 a holdout session shows its round progress and is never rated; a drill shows neither", () => {
    expect(toSession(row({ ...S23_STATE, learning: HOLDOUT }, "holdout"))).toMatchObject({
      rated_eligible: false,
      automated: null,
      holdout: { round_month: "2026-11-01", answered: 2, total: 3 },
    });
    expect(toSession(row(S23_STATE, "drill"))).toMatchObject({ rated_eligible: false, automated: null, holdout: null });
  });
});
