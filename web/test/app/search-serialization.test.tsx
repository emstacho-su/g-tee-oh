// Search serialization (S25, R3.12, R3.13, O-286, O-288): TanStack Router's default parseSearch
// turns numeric-looking values into numbers (its qss decode, then JSON.parse), so ?hand=77 and an
// all-digit seed reached the string-only validators as numbers and were dropped. The router now
// keeps every query value a string, and the validators convert the numeric filters themselves.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSearchAsStrings, stringifySearchAsStrings } from "../../src/app/search-serialization.js";
import { renderApp, SIGNED_IN } from "./render-app.js";

const received = vi.hoisted(() => ({ study: [] as unknown[], drillRun: [] as unknown[] }));

vi.mock("../../src/routes/study/StudyPage.js", () => ({
  StudyPage: (props: unknown) => {
    received.study.push(props);
    return <p>study probe</p>;
  },
}));

vi.mock("../../src/routes/drill-run/DrillRunPage.js", () => ({
  DrillRunPage: (props: unknown) => {
    received.drillRun.push(props);
    return <p>drill run probe</p>;
  },
}));

beforeEach(() => {
  received.study = [];
  received.drillRun = [];
});

describe("R3.12 R3.13 search values stay strings", () => {
  it("R3.12 parses every value as the string in the URL", () => {
    expect(parseSearchAsStrings("?hand=77&table_size=6&flag=true&json=%7B%22a%22%3A1%7D&seed=1e00000000000000")).toEqual({
      hand: "77",
      table_size: "6",
      flag: "true",
      json: '{"a":1}',
      seed: "1e00000000000000",
    });
    expect(parseSearchAsStrings("")).toEqual({});
    expect(parseSearchAsStrings("a=1&a=2")).toEqual({ a: "2" });
  });

  it("R3.12 a __proto__ key is an ordinary key, never the prototype", () => {
    const parsed = parseSearchAsStrings("?__proto__=x");
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
  });

  it("R3.12 stringifies strings as they are, numbers and booleans as text, and skips undefined", () => {
    expect(stringifySearchAsStrings({ hand: "77", table_size: 6, on: true, line: undefined })).toBe(
      "?hand=77&table_size=6&on=true",
    );
    expect(stringifySearchAsStrings({ quoted: '"77"' })).toBe("?quoted=%2277%22");
    expect(stringifySearchAsStrings({ nested: { a: 1 } })).toBe("?nested=%7B%22a%22%3A1%7D");
    expect(stringifySearchAsStrings({})).toBe("");
  });

  it("R3.12 round-trips a study search through stringify and parse", () => {
    const text = stringifySearchAsStrings({ format: "online", table_size: 6, hand: "77", line: "r250.c" });
    expect(parseSearchAsStrings(text)).toEqual({ format: "online", table_size: "6", hand: "77", line: "r250.c" });
  });

  it("R3.12 ?hand=77 reaches the study screen as the hand 77", async () => {
    renderApp("/study?format=online&table_size=6&depth=10000&hand=77", SIGNED_IN);
    await screen.findByText("study probe");
    expect(received.study.at(-1)).toEqual({ search: { format: "online", table_size: 6, depth: 10000, hand: "77" } });
  });

  it("R3.13 an all-digit seed reaches the drill session screen", async () => {
    renderApp("/drills/abc/run?seed=0123456789012345", SIGNED_IN);
    await screen.findByText("drill run probe");
    expect(received.drillRun.at(-1)).toEqual({ drillId: "abc", seed: "0123456789012345" });
  });

  it("R3.13 a seed that reads as a number in exponent form stays a string", async () => {
    renderApp("/drills/abc/run?seed=1e00000000000000", SIGNED_IN);
    await screen.findByText("drill run probe");
    expect(received.drillRun.at(-1)).toEqual({ drillId: "abc", seed: "1e00000000000000" });
  });
});
