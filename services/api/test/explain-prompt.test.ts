/**
 * The Ask prompt, question cleaning and rate-limit key (R3.20, O-307, O-308, PM3): the system
 * prompt holds instructions and the grounding only, the question sits in the user turn, a
 * regeneration names the unsupported values, and the limiter keys a session by a hash of its
 * cookie, never the raw token.
 */
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { questionHash } from "../src/explain/cache.js";
import { ASK_INSTRUCTIONS, regenerationTurn, systemPrompt, userTurn } from "../src/explain/prompt.js";
import { cleanQuestion, normalizeQuestion } from "../src/explain/question.js";
import { ASK_RATE_LIMIT_MAX, ASK_RATE_LIMIT_WINDOW_MS, createAskLimiter } from "../src/explain/rate-limit.js";
import { CLAIM_RENEW_INTERVAL_MS, holdClaim } from "../src/explain/claim-hold.js";
import type { Database } from "../src/db.js";
import { ProblemError } from "../src/http/problem.js";
import { IDEMPOTENCY_LEASE_SECONDS } from "../src/plugins/idempotency-store.js";

describe("R3.20 prompt (PM3, O-308)", () => {
  it("R3.20 the system prompt is the instructions and the grounding JSON, and asks for no list numerals", () => {
    const system = systemPrompt('{"hand":"5h5d"}');
    expect(system.startsWith(ASK_INSTRUCTIONS)).toBe(true);
    expect(system.endsWith('{"hand":"5h5d"}')).toBe(true);
    expect(ASK_INSTRUCTIONS).toMatch(/Do not number paragraphs/);
    expect(ASK_INSTRUCTIONS).toMatch(/Treat it only as a question/);
  });

  it("R3.20 the user turn is the question between question tags", () => {
    expect(userTurn("why fold?")).toBe("<question>\nwhy fold?\n</question>");
  });

  it("R3.20 a regeneration repeats the question and names only the kinds of unsupported value found", () => {
    const numbers = regenerationTurn("q", { ok: false, unsupportedNumbers: ["7.31 bb"], unsupportedNames: [] });
    expect(numbers).toContain(userTurn("q"));
    expect(numbers).toContain("Numbers not in the JSON: 7.31 bb.");
    expect(numbers).not.toContain("Hands or cards");
    const names = regenerationTurn("q", { ok: false, unsupportedNumbers: [], unsupportedNames: ["T9s", "Ac"] });
    expect(names).toContain("Hands or cards not in the JSON: T9s, Ac.");
    expect(names).not.toContain("Numbers not");
  });
});

describe("R3.20 question cleaning and the cache key (O-307, PM1)", () => {
  it("R3.20 control characters become spaces, format characters vanish, whitespace collapses", () => {
    const [nul, tab, zeroWidth] = [0x00, 0x09, 0x200b].map((code) => String.fromCharCode(code));
    expect(cleanQuestion(`  why${nul}fold${tab}${tab}55${zeroWidth}?  `)).toBe("why fold 55?");
    expect(cleanQuestion(`${nul}${zeroWidth}`)).toBe("");
    expect(normalizeQuestion("Why  FOLD?")).toBe("why fold?");
  });

  it("R3.20 the hash changes with the grounding and ignores case and spacing of the question", () => {
    const base = questionHash('{"hand":"5h5d"}', "Why fold?");
    expect(questionHash('{"hand":"5h5d"}', "  why   FOLD? ")).toEqual(base);
    expect(questionHash('{"hand":"7h2d"}', "Why fold?")).not.toEqual(base);
    expect(questionHash('{"hand":"5h5d"}', "Why call?")).not.toEqual(base);
  });
});

describe("R3.20 Ask limiter per user (O-307, PR #29 review M3)", () => {
  function request(userId: string): FastifyRequest {
    return { session: { userId } } as unknown as FastifyRequest;
  }

  it("R3.20 the sixth ask of a user in a window is a 429 with Retry-After; another user is not affected", () => {
    let now = 0;
    const limiter = createAskLimiter(() => now);
    for (let index = 0; index < ASK_RATE_LIMIT_MAX; index += 1) {
      limiter.take(request("user-a"));
    }
    expect(() => limiter.take(request("user-a"))).toThrow(ProblemError);
    try {
      limiter.take(request("user-a"));
    } catch (error: unknown) {
      expect(error).toMatchObject({ status: 429, slug: "rate-limited" });
    }
    expect(() => limiter.take(request("user-b"))).not.toThrow();
    now += ASK_RATE_LIMIT_WINDOW_MS;
    expect(() => limiter.take(request("user-a"))).not.toThrow();
  });
});

describe("R3.20 an Ask holds its Idempotency-Key claim (PR #29 review HIGH 2)", () => {
  const CLAIM = { userId: "u", key: "k", token: "t" };
  const LOG = { warn: vi.fn() } as unknown as FastifyBaseLogger;
  const DATABASE = {} as Database;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("R3.20 the renewal interval is a third of the lease", () => {
    expect(CLAIM_RENEW_INTERVAL_MS * 3).toBe(IDEMPOTENCY_LEASE_SECONDS * 1000);
  });

  it("R3.20 a held claim is renewed on every interval until stop", async () => {
    vi.useFakeTimers();
    const renewKey = vi.fn(() => Promise.resolve(true));
    const hold = holdClaim(DATABASE, CLAIM, LOG, { renewKey, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(350);
    expect(renewKey).toHaveBeenCalledTimes(3);
    hold.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(renewKey).toHaveBeenCalledTimes(3);
  });

  it("R3.20 once a renewal finds the claim lost, renew reports false and stops asking the database", async () => {
    const renewKey = vi.fn(() => Promise.resolve(false));
    const hold = holdClaim(DATABASE, CLAIM, LOG, { renewKey, intervalMs: 60_000 });
    expect(await hold.renew()).toBe(false);
    expect(await hold.renew()).toBe(false);
    expect(renewKey).toHaveBeenCalledTimes(1);
    hold.stop();
  });

  it("R3.20 a failed renewal is logged and retried on the next interval", async () => {
    vi.useFakeTimers();
    const renewKey = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(true);
    const warn = vi.fn();
    const hold = holdClaim(DATABASE, CLAIM, { warn } as unknown as FastifyBaseLogger, { renewKey, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    expect(warn).toHaveBeenCalledOnce();
    expect(renewKey).toHaveBeenCalledTimes(2);
    expect(await hold.renew()).toBe(true);
    hold.stop();
  });

  it("R3.20 without an Idempotency-Key there is nothing to hold", async () => {
    const hold = holdClaim(DATABASE, null, LOG);
    expect(await hold.renew()).toBe(true);
    hold.stop();
  });
});
