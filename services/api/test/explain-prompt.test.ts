/**
 * The Ask prompt, question cleaning and rate-limit key (R3.20, O-307, O-308, PM3): the system
 * prompt holds instructions and the grounding only, the question sits in the user turn, a
 * regeneration names the unsupported values, and the limiter keys a session by a hash of its
 * cookie, never the raw token.
 */
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { questionHash } from "../src/explain/cache.js";
import { ASK_INSTRUCTIONS, regenerationTurn, systemPrompt, userTurn } from "../src/explain/prompt.js";
import { cleanQuestion, normalizeQuestion } from "../src/explain/question.js";
import { askRateLimitKey, sessionCookieValue } from "../src/explain/rate-limit.js";
import { SESSION_COOKIE_NAME } from "../src/http/openapi.js";

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

describe("R3.20 Ask rate-limit key (O-307)", () => {
  const TOKEN = "a".repeat(43);

  function request(cookie: string | undefined, ip = "203.0.113.9"): FastifyRequest {
    return { headers: cookie === undefined ? {} : { cookie }, ip } as unknown as FastifyRequest;
  }

  it("R3.20 the session cookie is found among others", () => {
    expect(sessionCookieValue(`theme=dark; ${SESSION_COOKIE_NAME}=${TOKEN}; other=1`)).toBe(TOKEN);
    expect(sessionCookieValue("theme=dark")).toBeUndefined();
    expect(sessionCookieValue(undefined)).toBeUndefined();
    expect(sessionCookieValue(`${SESSION_COOKIE_NAME}`)).toBeUndefined();
  });

  it("R3.20 a session is keyed by a hash of its token, never the token; no cookie falls back to the address", () => {
    const key = askRateLimitKey(request(`${SESSION_COOKIE_NAME}=${TOKEN}`));
    expect(key).toMatch(/^ask-session:[0-9a-f]{64}$/);
    expect(key).not.toContain(TOKEN);
    expect(askRateLimitKey(request(undefined))).toBe("ask-address:203.0.113.9");
    expect(askRateLimitKey(request(`${SESSION_COOKIE_NAME}=`))).toBe("ask-address:203.0.113.9");
  });
});
