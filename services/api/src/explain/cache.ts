/**
 * The shared explanation cache (R3.20, O-306, PM1, ADR 0016): an answer is stored once per
 * (solution_id, node_key, hand, question_hash), the explanation table's unique key, and served to
 * any user who asks the same question about the same grounding, spending nothing.
 *
 * question_hash is the sha256 of the canonical JSON of three parts: the grounding's canonical text
 * (every number and name the model is given, keys sorted), the normalized question (question.ts)
 * and PROMPT_VERSION. So the same question about two spots, or about the same hand after a
 * different chosen action, misses; and a change to the prompt retires every older entry. The
 * table stores the hash and never the question text. A second store of the same key does nothing.
 */
import { createHash } from "node:crypto";

import type { Database } from "../db.js";
import { canonicalJson } from "../http/canonical-json.js";
import { normalizeQuestion } from "./question.js";

/** Bump when the system prompt or the grounding shape changes, so old answers stop matching. */
export const PROMPT_VERSION = "s27-ask-2";

export interface CacheKey {
  solutionId: string;
  nodeKey: string;
  hand: string;
  questionHash: Buffer;
}

export interface CachedAnswer {
  text: string;
  validated: boolean;
}

export interface StoredAnswer extends CachedAnswer {
  model: string;
  costCents: number;
}

/** sha256 over the canonical grounding, the normalized question and the prompt version (PM1). */
export function questionHash(canonicalGrounding: string, question: string): Buffer {
  const parts = canonicalJson([canonicalGrounding, normalizeQuestion(question), PROMPT_VERSION]);
  return createHash("sha256").update(parts, "utf8").digest();
}

export async function findCached(database: Database, key: CacheKey): Promise<CachedAnswer | undefined> {
  return database
    .selectFrom("explanation")
    .select(["text", "validated"])
    .where("solution_id", "=", key.solutionId)
    .where("node_key", "=", key.nodeKey)
    .where("hand", "=", key.hand)
    .where("question_hash", "=", key.questionHash)
    .executeTakeFirst();
}

export async function storeAnswer(database: Database, key: CacheKey, answer: StoredAnswer): Promise<void> {
  await database
    .insertInto("explanation")
    .values({
      solution_id: key.solutionId,
      node_key: key.nodeKey,
      hand: key.hand,
      question_hash: key.questionHash,
      model: answer.model,
      text: answer.text,
      validated: answer.validated,
      cost_cents: answer.costCents,
    })
    .onConflict((conflict) => conflict.columns(["solution_id", "node_key", "hand", "question_hash"]).doNothing())
    .execute();
}
