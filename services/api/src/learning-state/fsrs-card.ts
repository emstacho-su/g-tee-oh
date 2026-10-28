/**
 * schedule_card.fsrs_state (R4.11, O-272, ADR 0012): learning's SpotClassCard holds a ts-fsrs card
 * whose due and last_review are Dates; the jsonb column stores the same fields with those two as
 * RFC 3339 strings. Reads parse the column with a strict schema, so a malformed row fails loudly
 * instead of scheduling from garbage, and both directions return fresh frozen objects.
 */
import type { SpotClassCard } from "@g-tee-oh/learning";
import { z } from "zod";

type Card = SpotClassCard["card"];

/** ts-fsrs's State enum spans New 0 to Relearning 3. */
const MAX_FSRS_STATE = 3;

const storedCardSchema = z.strictObject({
  due: z.iso.datetime({ offset: true }),
  stability: z.number().finite().min(0),
  difficulty: z.number().finite().min(0),
  elapsed_days: z.number().finite().min(0),
  scheduled_days: z.number().finite().min(0),
  learning_steps: z.number().int().min(0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  state: z.number().int().min(0).max(MAX_FSRS_STATE),
  last_review: z.iso.datetime({ offset: true }).optional(),
});

export type StoredCard = z.infer<typeof storedCardSchema>;

/** The jsonb form of a card. */
export function storedCardOf(spotClassCard: SpotClassCard): StoredCard {
  const { card } = spotClassCard;
  return storedCardSchema.parse({
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    ...(card.last_review === undefined ? {} : { last_review: card.last_review.toISOString() }),
  });
}

/** learning's card from the stored jsonb. */
export function spotClassCardOf(spotClassKey: string, stored: unknown): SpotClassCard {
  const parsed = storedCardSchema.parse(stored);
  const { last_review: lastReview, due, ...rest } = parsed;
  const card = {
    ...rest,
    due: new Date(due),
    ...(lastReview === undefined ? {} : { last_review: new Date(lastReview) }),
  } satisfies Card;
  return Object.freeze({ spotClassKey, card: Object.freeze(card) });
}
