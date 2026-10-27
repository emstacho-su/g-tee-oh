/**
 * Maps the api's NodeAction rows to packages/learning's GradeAction, so the web roller can call
 * rngBands and rollSelectedAction, the one RNG entry that grade() also uses (O-213, O-262). The
 * bucket arrives as a string from the api and is checked against learning's BUCKETS; the web
 * never derives a bucket itself (ADR 0004). lossPctPot is not needed for band order and is 0.
 */
import { BUCKETS, type Bucket, type GradeAction } from "@g-tee-oh/learning";

import type { NodeAction } from "../contracts.js";

const NO_LOSS = 0;

function toBucket(bucket: string | null): Bucket | null {
  if (bucket === null) return null;
  const known = BUCKETS.find((candidate) => candidate === bucket);
  if (known === undefined) throw new RangeError(`unknown bucket from the api: ${JSON.stringify(bucket)}`);
  return known;
}

export function toGradeActions(actions: readonly NodeAction[]): GradeAction[] {
  return actions.map((action) => ({
    kind: action.kind,
    bucket: toBucket(action.bucket),
    sizeCbb: action.size_cbb ?? 0,
    lossPctPot: NO_LOSS,
  }));
}
