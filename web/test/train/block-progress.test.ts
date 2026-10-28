/**
 * The block banner's model (S32, R4.10, O-272, O-325, O-328): which block a prompt belongs to and
 * which hand of it, counted from the session's first block and the prompts shown; the holdout
 * round's answered count; the family of a class from the heat map read.
 */
import { describe, expect, it } from "vitest";

import {
  FIXTURE_AUTOMATED_SESSION_ID,
  FIXTURE_BLOCK_SIZE,
  fixtureBlockPrompt,
  fixtureHoldoutProgress,
  fixtureHoldoutPrompt,
  fixtureRatedBlock,
  fixtureWorkedBlock,
} from "../../src/fixtures/automated.js";
import { fixtureHeatmap } from "../../src/fixtures/progress.js";
import { blockView, familyLookup, holdoutView, latestPromptDecided, withMark, type PromptMark } from "../../src/routes/train/block-progress.js";
import type { SessionContext } from "../../src/trainer/spot-machine.js";
import type { TrainerPrompt } from "../../src/contracts.js";

const NO_FAMILY = (): undefined => undefined;

function marksOf(prompts: readonly TrainerPrompt[]): readonly PromptMark[] {
  return prompts.reduce<readonly PromptMark[]>((marks, prompt) => withMark(marks, prompt), []);
}

function served(count: number, offset = 0, block = fixtureRatedBlock): TrainerPrompt[] {
  return Array.from({ length: count }, (_, index) => fixtureBlockPrompt(block, index, FIXTURE_AUTOMATED_SESSION_ID, offset + index + 1));
}

describe("R4.10 block progress", () => {
  it("R4.10 before any prompt the banner shows the session's first block at hand served plus one", () => {
    expect(blockView({ ...fixtureRatedBlock, served: 1 }, [], NO_FAMILY)).toEqual({
      classKey: fixtureRatedBlock.spot_class_key,
      trackKey: "opens",
      family: fixtureRatedBlock.family,
      hand: 2,
      size: FIXTURE_BLOCK_SIZE,
      workedExample: false,
    });
  });

  it("R4.10 no block at all (not an automated session) gives null", () => {
    expect(blockView(null, marksOf(served(1)), NO_FAMILY)).toBeNull();
  });

  it("R4.10 the hands of one block count 1, 2 and 3 of its size", () => {
    const prompts = served(FIXTURE_BLOCK_SIZE);
    const hands = prompts.map((_, index) => blockView(fixtureRatedBlock, marksOf(prompts.slice(0, index + 1)), NO_FAMILY)?.hand);
    expect(hands).toEqual([1, 2, 3]);
  });

  it("R4.10 a new class starts a new block at hand 1 with its family from the heat map and its worked-example flag", () => {
    const prompts = [...served(FIXTURE_BLOCK_SIZE), ...served(1, FIXTURE_BLOCK_SIZE, fixtureWorkedBlock)];
    const view = blockView(fixtureRatedBlock, marksOf(prompts), familyLookup(fixtureHeatmap));
    expect(view).toEqual({
      classKey: fixtureWorkedBlock.spot_class_key,
      trackKey: fixtureWorkedBlock.track_key,
      family: fixtureWorkedBlock.family,
      hand: 1,
      size: FIXTURE_BLOCK_SIZE,
      workedExample: true,
    });
  });

  it("R4.10 the same class picked again after a full block starts over at hand 1", () => {
    const prompts = served(FIXTURE_BLOCK_SIZE + 1);
    expect(blockView(fixtureRatedBlock, marksOf(prompts), NO_FAMILY)?.hand).toBe(1);
  });

  it("R4.10 a class the heat map does not hold has no family; the first block's class keeps its own", () => {
    const view = blockView(fixtureRatedBlock, marksOf(served(1, 0, fixtureWorkedBlock)), NO_FAMILY);
    expect(view?.family).toBeNull();
    expect(familyLookup(undefined)("anything")).toBeUndefined();
  });

  it("R4.10 the same prompt shown twice counts once; a new session starts the marks over", () => {
    const first = fixtureBlockPrompt(fixtureRatedBlock, 0, FIXTURE_AUTOMATED_SESSION_ID, 1);
    const once = withMark([], first);
    expect(withMark(once, first)).toBe(once);
    const other = { ...first, session_id: "00000000-0000-4000-8000-000000000099", state_version: 7 };
    expect(withMark(once, other)).toEqual([{ sessionId: other.session_id, version: 7, classKey: first.spot_class_key, trackKey: "opens", workedExample: false }]);
  });

  it("R4.10 holdout progress adds the decisions of this session to the round's answered count, at most the total (O-328)", () => {
    const prompts = [fixtureHoldoutPrompt(0, 1), fixtureHoldoutPrompt(1, 2)];
    expect(holdoutView(fixtureHoldoutProgress, [], false)).toEqual({ answered: 12, total: 30 });
    expect(holdoutView(fixtureHoldoutProgress, marksOf(prompts), false)).toEqual({ answered: 13, total: 30 });
    expect(holdoutView(fixtureHoldoutProgress, marksOf(prompts), true)).toEqual({ answered: 14, total: 30 });
    expect(holdoutView({ ...fixtureHoldoutProgress, answered: 30 }, marksOf(prompts), true)).toEqual({ answered: 30, total: 30 });
    expect(holdoutView(null, [], false)).toBeNull();
  });

  it("R4.10 the latest prompt counts as decided on its reveal and while Next loads, not on the first load (O-328)", () => {
    const context = { session: {}, rng: false } as unknown as SessionContext;
    expect(latestPromptDecided({ kind: "loading_prompt", context, version: 1 }, 0)).toBe(false);
    expect(latestPromptDecided({ kind: "loading_prompt", context, version: 2 }, 1)).toBe(true);
    expect(latestPromptDecided({ kind: "loading_prompt", context, version: null }, 1)).toBe(false);
    expect(latestPromptDecided({ kind: "stale", context }, 1)).toBe(false);
    expect(latestPromptDecided({ kind: "idle" }, 1)).toBe(false);
  });
});
