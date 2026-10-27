/**
 * Canonical JSON and the Idempotency-Key request hash (R3.1, A5 section 3, O-232).
 *
 * Mechanism: two requests are "the same request" when their method, route pattern, path
 * parameters and parsed body are equal as JSON values, whatever order the client wrote the object
 * keys in. canonicalJson sorts object keys recursively (arrays keep their order, which carries
 * meaning) and then serialises, so equal values give equal text; requestHash is the sha256 of the
 * canonical text of the four parts, stored as idempotency_key.request_hash. The input is never
 * mutated: sorting builds new objects.
 */
import { createHash } from "node:crypto";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return Object.fromEntries(keys.map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

/** JSON text with object keys sorted at every depth; undefined becomes null. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value ?? null));
}

export interface HashedRequest {
  method: string;
  route: string;
  params: unknown;
  body: unknown;
}

/** sha256 over the canonical JSON of method, route pattern, params and body. */
export function requestHash(request: HashedRequest): Buffer {
  const canonical = canonicalJson([request.method.toUpperCase(), request.route, request.params, request.body]);
  return createHash("sha256").update(canonical, "utf8").digest();
}
