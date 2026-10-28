/**
 * Model ids and prices for Ask (R3.20, O-305, O-306, O-5). The ids and prices are the ones the
 * claude-api skill named when S27 was built (its model table cached 2026-10-06): Claude Opus 5.5 is
 * the default, at 4 dollars per million input tokens and 20 per million output tokens. ASK_MODEL
 * may name another current model of the table, and only a priced one, so the monthly cap is always
 * enforceable.
 *
 * Costs are in whole cents rounded up: the reservation before a call (worst case: an input token
 * estimate plus max_tokens of output) and the settlement after it (the usage the API reports), so
 * the cap is never passed by rounding. Integer arithmetic over cents per million tokens keeps the
 * sums exact.
 */

export const ASK_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AskModel = (typeof ASK_MODELS)[number];

export const DEFAULT_ASK_MODEL: AskModel = "claude-opus-5-5";

export interface ModelPrice {
  /** Cents per million input tokens. */
  inputCentsPerMillion: number;
  /** Cents per million output tokens (thinking tokens bill as output). */
  outputCentsPerMillion: number;
}

export const MODEL_PRICES: Readonly<Record<AskModel, ModelPrice>> = {
  "claude-opus-5-5": { inputCentsPerMillion: 400, outputCentsPerMillion: 2000 },
  "claude-sonnet-5-5": { inputCentsPerMillion: 200, outputCentsPerMillion: 1000 },
  "claude-haiku-5-5": { inputCentsPerMillion: 10, outputCentsPerMillion: 50 },
};

const TOKENS_PER_MILLION = 1_000_000;
/**
 * A deliberately low characters-per-token figure so the input estimate is an overestimate for
 * English and JSON text (a token is usually three to four characters).
 */
export const CHARS_PER_TOKEN_ESTIMATE = 2;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The cost of a usage in whole cents, rounded up. */
export function costCents(model: AskModel, usage: TokenUsage): number {
  const price = MODEL_PRICES[model];
  const scaled = usage.inputTokens * price.inputCentsPerMillion + usage.outputTokens * price.outputCentsPerMillion;
  return Math.ceil(scaled / TOKENS_PER_MILLION);
}

/** An overestimate of the tokens in a prompt of `chars` characters. */
export function estimateInputTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/** The most `calls` calls with a `promptChars` prompt and `maxTokens` output can cost, in cents. */
export function worstCaseCents(model: AskModel, promptChars: number, maxTokens: number, calls: number): number {
  return calls * costCents(model, { inputTokens: estimateInputTokens(promptChars), outputTokens: maxTokens });
}
