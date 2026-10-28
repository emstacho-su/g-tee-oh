/**
 * Password strength for the join form (S42, R3.13, O-424). The meter is advisory: only the
 * server's rule, at least MIN_PASSWORD_LENGTH characters (A9 section 3), blocks the button.
 *
 * Mechanism: @zxcvbn-ts/core with the common dictionary estimates a 0 to 4 score. Both packages
 * are reached only through the dynamic import() in loadStrengthEstimator, so Vite puts them in
 * their own chunk that only /join loads, and the main bundle does not grow (a source scan test
 * holds every other file to that). The estimator is built once per page and cached. Until it has
 * loaded, or if loading fails, the meter falls back to the length alone. The email and the name
 * are passed as user inputs, so a password made of them scores low. Counting is by characters
 * (code points), the same count the server uses.
 */
import { STRENGTH_LABELS, type StrengthLabel } from "./onboarding-text.js";

export const MIN_PASSWORD_LENGTH = 12;
/** From this many characters the length-only fallback calls a password Good rather than Fair. */
const LONG_PASSWORD_LENGTH = 16;

export type StrengthScore = 0 | 1 | 2 | 3 | 4;
export type StrengthEstimator = (password: string, userInputs: readonly string[]) => StrengthScore;

export interface Strength {
  score: StrengthScore;
  label: StrengthLabel;
}

export function characterCount(text: string): number {
  return Array.from(text).length;
}

export function meetsMinimum(password: string): boolean {
  return characterCount(password) >= MIN_PASSWORD_LENGTH;
}

function clampScore(value: number): StrengthScore {
  if (value <= 0) return 0;
  if (value >= 4) return 4;
  return Math.round(value) as StrengthScore;
}

/**
 * The meter's reading: Too short under the minimum; else the estimator's score, at least Weak; or,
 * without an estimator, Fair or Good by length alone.
 */
export function strengthOf(password: string, estimate: StrengthScore | null): Strength {
  const length = characterCount(password);
  const score: StrengthScore =
    length < MIN_PASSWORD_LENGTH
      ? 0
      : estimate === null
        ? length >= LONG_PASSWORD_LENGTH
          ? 3
          : 2
        : clampScore(Math.max(1, estimate));
  return { score, label: STRENGTH_LABELS[score] };
}

/**
 * The words a password should not lean on: the email, its local part, and the name both joined and
 * word by word, lowercased. The estimator matches whole dictionary words, so each form is listed.
 */
export function strengthInputs(email: string, name: string): string[] {
  const words = name.toLowerCase().split(/\s+/).filter((word) => word !== "");
  const localPart = email.toLowerCase().split("@")[0] ?? "";
  const candidates = [email.toLowerCase(), localPart, words.join(""), ...words];
  return [...new Set(candidates.filter((candidate) => candidate !== ""))];
}

let estimatorPromise: Promise<StrengthEstimator> | null = null;

async function buildEstimator(): Promise<StrengthEstimator> {
  const [core, common] = await Promise.all([import("@zxcvbn-ts/core"), import("@zxcvbn-ts/language-common")]);
  const factory = new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary },
    graphs: common.adjacencyGraphs,
  });
  return (password, userInputs) => clampScore(factory.check(password, [...userInputs]).score);
}

/** The estimator, loaded on first use; a failed load is forgotten so a later call may retry. */
export function loadStrengthEstimator(): Promise<StrengthEstimator> {
  if (estimatorPromise === null) {
    estimatorPromise = buildEstimator().catch((error: unknown) => {
      estimatorPromise = null;
      throw error;
    });
  }
  return estimatorPromise;
}
