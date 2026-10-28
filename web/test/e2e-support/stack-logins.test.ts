// @vitest-environment node
// The stack project stays under the api's login limit (R3.13, R4.10, R4.12). The api allows
// LOGIN_RATE_LIMIT_MAX logins per client address per minute (services/api/src/http/rate-limits.ts)
// and the stack project runs every flow from one address in well under a minute, so each flow
// that called the full signIn used one login; at seven flows the sixth and seventh were refused
// and stayed on /login. Only sign-in.e2e.ts proves the login itself; the flows share one session
// through signInOnce (support/sign-in-flow.ts), which logs in once per worker.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const STACK_DIR = join(HERE, "..", "..", "e2e", "stack");
const RATE_LIMITS = join(HERE, "..", "..", "..", "services", "api", "src", "http", "rate-limits.ts");
const FULL_SIGN_IN = /\bsignIn\(/g;
const HAS_FULL_SIGN_IN = /\bsignIn\(/;
const SHARED_SIGN_IN = /\bsignInOnce\(/;

function loginLimit(): number {
  const match = /export const LOGIN_RATE_LIMIT_MAX = (\d+);/.exec(readFileSync(RATE_LIMITS, "utf8"));
  if (match?.[1] === undefined) throw new Error("LOGIN_RATE_LIMIT_MAX not found in the api's rate-limits.ts");
  return Number(match[1]);
}

function stackSources(): ReadonlyMap<string, string> {
  const files = readdirSync(STACK_DIR).filter((name) => name.endsWith(".e2e.ts"));
  return new Map(files.map((name) => [name, readFileSync(join(STACK_DIR, name), "utf8")]));
}

describe("R3.13 stack logins under the api's login limit", () => {
  it("R3.13 password logins per run: one per full signIn call, plus one for the shared session", () => {
    const sources = stackSources();
    const fullLogins = [...sources.values()].reduce((total, source) => total + (source.match(FULL_SIGN_IN)?.length ?? 0), 0);
    const sharedLogin = [...sources.values()].some((source) => SHARED_SIGN_IN.test(source)) ? 1 : 0;
    expect(fullLogins + sharedLogin).toBeLessThan(loginLimit());
  });

  it("R3.13 only the sign-in test logs in on its own; every flow shares the session", () => {
    const ownLogins = [...stackSources()].filter(([, source]) => HAS_FULL_SIGN_IN.test(source)).map(([name]) => name);
    expect(ownLogins).toEqual(["sign-in.e2e.ts"]);
  });
});
