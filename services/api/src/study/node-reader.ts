/**
 * Read-through node reads with background prefetch (R3.3, S23 plan decision 6).
 *
 * read() serves a node from the per-app cache (node-cache.ts) when it holds it, joins a read of
 * the same node already in flight, and otherwise fetches it and caches the result. prefetch()
 * starts the same fetch without anyone waiting on it: the next likely node is in the cache (or in
 * flight) by the time the user asks for it, so that request reads no node from solver-query.
 *
 * Failure rules: a failed fetch is never cached and leaves nothing in flight. A prefetch failure is
 * logged through the warn callback and never thrown, so it cannot surface in any response; a read
 * that joined a prefetch which then failed fetches again on its own account, so the prefetch error
 * never reaches that request either. A read's own failure propagates to its caller.
 */
import type { SqNode } from "../solver-query/client.js";
import { nodeCacheKey, type NodeCache, type NodeCacheKeyParts } from "./node-cache.js";

export type NodeRequest = NodeCacheKeyParts;
export type FetchNode = (request: NodeRequest) => Promise<SqNode>;
export type WarnLog = (context: Record<string, unknown>, message: string) => void;

export interface NodeReader {
  read(request: NodeRequest, fetchNode: FetchNode): Promise<Readonly<SqNode>>;
  /** Resolves when the prefetch settles; it never rejects. */
  prefetch(request: NodeRequest, fetchNode: FetchNode, warn: WarnLog): Promise<void>;
}

interface InFlight {
  promise: Promise<Readonly<SqNode>>;
  fromPrefetch: boolean;
}

export function createNodeReader(cache: NodeCache<SqNode>): NodeReader {
  const inFlight = new Map<string, InFlight>();

  function start(key: string, request: NodeRequest, fetchNode: FetchNode, fromPrefetch: boolean): InFlight {
    const promise = fetchNode(request).then(
      (node) => {
        cache.set(key, node);
        inFlight.delete(key);
        return cache.get(key) ?? node;
      },
      (error: unknown) => {
        inFlight.delete(key);
        throw error;
      },
    );
    const entry = { promise, fromPrefetch };
    inFlight.set(key, entry);
    return entry;
  }

  async function read(request: NodeRequest, fetchNode: FetchNode): Promise<Readonly<SqNode>> {
    const key = nodeCacheKey(request);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = inFlight.get(key);
    if (pending === undefined) {
      return start(key, request, fetchNode, false).promise;
    }
    if (!pending.fromPrefetch) {
      return pending.promise;
    }
    try {
      return await pending.promise;
    } catch {
      // The prefetch logged its own failure; this request reads the node itself.
      return start(key, request, fetchNode, false).promise;
    }
  }

  async function prefetch(request: NodeRequest, fetchNode: FetchNode, warn: WarnLog): Promise<void> {
    const key = nodeCacheKey(request);
    if (cache.get(key) !== undefined || inFlight.has(key)) {
      return;
    }
    try {
      await start(key, request, fetchNode, true).promise;
    } catch (error: unknown) {
      warn({ err: error, solutionId: request.solutionId, nodeKey: request.nodeKey }, "study prefetch failed");
    }
  }

  return { read, prefetch };
}
