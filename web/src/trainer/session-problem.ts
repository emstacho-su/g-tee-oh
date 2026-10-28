/**
 * The problem POST /sessions answers, with the no-coverage counts kept (S26, R3.14, O-312, PR #30
 * review MEDIUM 3, closes O-318). Pure.
 *
 * A fully uncovered drill is refused with the 422 no-coverage problem, which carries two RFC 9457
 * extension members: pairs_total (the (configuration, pair) candidates the drill reaches) and
 * pairs_queued (the uncovered pairs queued for the builder). ApiProblem (src/api/problem.ts) keeps
 * only the standard members, so NoCoverageProblem is an ApiProblem with those two counts, read
 * from the untrusted body: each must be a whole number of at least 0, and pairs_queued may not
 * exceed pairs_total; otherwise the counts are dropped and the screen names none. The detail text
 * is never parsed for them.
 */
import { ApiProblem, HTTP_STATUS, problemFromBody } from "../api/index.js";
import type { NoCoverageProblemBody } from "../contracts.js";

export const NO_COVERAGE_SLUG = "no-coverage";

/** The queued and total spot counts a 422 no-coverage carries (O-312). */
export interface QueuedCount {
  readonly queued: number;
  readonly total: number;
}

export class NoCoverageProblem extends ApiProblem {
  readonly counts: QueuedCount;

  constructor(base: ApiProblem, counts: QueuedCount) {
    super({ status: base.status, slug: base.slug, title: base.title, ...(base.detail === undefined ? {} : { detail: base.detail }) });
    this.counts = counts;
  }
}

/** The contract's names for the two counts, so a rename in the contract fails the typecheck here. */
type CountMember = keyof Pick<NoCoverageProblemBody, "pairs_total" | "pairs_queued">;

function countMember(body: Readonly<Record<string, unknown>>, key: CountMember): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function countsOf(body: unknown): QueuedCount | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Readonly<Record<string, unknown>>;
  const total = countMember(record, "pairs_total");
  const queued = countMember(record, "pairs_queued");
  if (total === null || queued === null || queued > total) return null;
  return { queued, total };
}

/** An ApiProblem from a POST /sessions failure; a 422 no-coverage with valid counts keeps them. */
export function sessionProblemFromBody(status: number, body: unknown): ApiProblem {
  const base = problemFromBody(status, body);
  if (status !== HTTP_STATUS.unprocessable || base.slug !== NO_COVERAGE_SLUG) return base;
  const counts = countsOf(body);
  return counts === null ? base : new NoCoverageProblem(base, counts);
}
