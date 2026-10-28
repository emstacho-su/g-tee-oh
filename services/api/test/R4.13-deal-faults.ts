/**
 * A fixture solver-query fetch that misbehaves on demand for one holdout item's deal (R4.13, PR #27
 * review HIGH 4, O-334), for R4.13-holdout-integrity.test.ts: a test registers a fault under the
 * item's deal seed and every POST /v1/deal with that seed then answers a problem status, hangs until
 * its signal aborts, or returns the real deal moved to another node (a mismatch). Every other call
 * reaches the fixture solver-query unchanged.
 */

/** Appended to a real deal's start node, so the replay no longer matches the item. */
const MISMATCH_SUFFIX = "-moved";
/** A hanging deal gives up after this long even when no signal aborts it, so a missing deadline fails the test instead of hanging it. */
const HANG_CAP_MS = 30_000;

/** How POST /v1/deal misbehaves for one deal seed: a problem status, a hang until its signal aborts, or a deal at another node. */
export type DealFault = { kind: "status"; status: number } | { kind: "hang" } | { kind: "mismatch" };

/** The active faults by deal seed; a test sets one and deletes it in a finally. */
export const faults = new Map<string, DealFault>();

async function dealSeedOf(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): Promise<string | undefined> {
  const request = input instanceof Request ? input : new Request(input, init);
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/v1/deal")) {
    return undefined;
  }
  const body = (await request.clone().json()) as { seed?: string };
  return body.seed;
}

function problemResponse(status: number): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "boom", status }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

/** The real deal with its start node renamed, so the stored item no longer replays. */
async function mismatchedDeal(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): Promise<Response> {
  const real = await fetch(input, init);
  const body = (await real.json()) as { start_node_key: string };
  return new Response(JSON.stringify({ ...body, start_node_key: `${body.start_node_key}${MISMATCH_SUFFIX}` }), {
    status: real.status,
    headers: { "content-type": "application/json" },
  });
}

/** The fixture solver-query's fetch, with the deal faults above. */
export const faultyFetch: typeof fetch = async (input, init) => {
  const seed = await dealSeedOf(input, init);
  const fault = seed === undefined ? undefined : faults.get(seed);
  if (fault?.kind === "status") {
    return problemResponse(fault.status);
  }
  if (fault?.kind === "mismatch") {
    return mismatchedDeal(input, init);
  }
  if (fault?.kind === "hang") {
    const signal = input instanceof Request ? input.signal : init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      const cap = setTimeout(() => reject(new Error("hanging deal capped: no deadline aborted it")), HANG_CAP_MS);
      signal?.addEventListener("abort", () => {
        clearTimeout(cap);
        reject(signal.reason as Error);
      });
    });
  }
  return fetch(input, init);
};
