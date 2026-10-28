/**
 * The drill screens' api failures (S26, R3.14). ApiProblem (src/api/problem.ts) keeps a problem's
 * status, slug, title and detail; the builder, the import dialog and the export dialog also need
 * the validation problem's field errors (Problem.errors, each a dotted path and a message) to show
 * them next to the field they name or in a list. DrillProblem is an ApiProblem with those errors,
 * narrowed from the untrusted body: an entry without a string path and message is dropped, never
 * trusted.
 *
 * Bounds (PR #30 review MEDIUM 1): the body is untrusted, so however many errors it sends, at most
 * MAX_LISTED_FIELD_ERRORS are kept and each path and message is clipped to MAX_FIELD_ERROR_TEXT
 * characters. omittedErrors counts the rest: the entries past the cap plus the api's own
 * errors_omitted member (the count of issues the api cut before answering), when that member is a
 * whole number of at least 0. The screens say "and N more" for them instead of listing them.
 */
import { ApiProblem, HTTP_STATUS, isApiProblem, problemFromBody } from "../api/index.js";
import type { Problem } from "../contracts.js";
import type { FieldError } from "./types.js";

/** The most field errors a screen lists; the api cuts its own list at the same count. */
export const MAX_LISTED_FIELD_ERRORS = 20;
/** The longest path or message kept from one error; a longer one ends in an ellipsis. */
export const MAX_FIELD_ERROR_TEXT = 200;
const ELLIPSIS = "…";
/** The contract's name for the api's count of cut errors (Problem.errors_omitted). */
const OMITTED_MEMBER: keyof Problem = "errors_omitted";

export interface CappedFieldErrors {
  readonly listed: readonly FieldError[];
  /** How many errors were not kept: past the cap here, plus the api's errors_omitted. */
  readonly omitted: number;
}

export class DrillProblem extends ApiProblem {
  readonly fieldErrors: readonly FieldError[];
  readonly omittedErrors: number;

  constructor(base: ApiProblem, errors: CappedFieldErrors) {
    super({ status: base.status, slug: base.slug, title: base.title, ...(base.detail === undefined ? {} : { detail: base.detail }) });
    this.fieldErrors = errors.listed;
    this.omittedErrors = errors.omitted;
  }
}

function isFieldError(value: unknown): value is FieldError {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry["path"] === "string" && typeof entry["message"] === "string";
}

function clip(text: string): string {
  return text.length > MAX_FIELD_ERROR_TEXT ? `${text.slice(0, MAX_FIELD_ERROR_TEXT - ELLIPSIS.length)}${ELLIPSIS}` : text;
}

function omittedMember(body: Readonly<Record<string, unknown>>): number {
  const value = body[OMITTED_MEMBER];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The body's field errors, at most MAX_LISTED_FIELD_ERRORS of them, and the count left out. */
export function cappedFieldErrorsOf(body: unknown): CappedFieldErrors {
  if (typeof body !== "object" || body === null) return { listed: [], omitted: 0 };
  const record = body as Readonly<Record<string, unknown>>;
  const errors: unknown = record["errors"];
  const entries: readonly unknown[] = Array.isArray(errors) ? errors : [];
  const listed = entries
    .slice(0, MAX_LISTED_FIELD_ERRORS)
    .filter(isFieldError)
    .map(({ path, message }) => ({ path: clip(path), message: clip(message) }));
  const pastCap = Math.max(0, entries.length - MAX_LISTED_FIELD_ERRORS);
  return { listed, omitted: pastCap + omittedMember(record) };
}

/** An ApiProblem with the body's field errors, from a status and an untrusted parsed body. */
export function drillProblemFromBody(status: number, body: unknown): DrillProblem {
  return new DrillProblem(problemFromBody(status, body), cappedFieldErrorsOf(body));
}

/** The field errors a failure carries; none for anything but a DrillProblem. */
export function fieldErrorsOfFailure(error: unknown): readonly FieldError[] {
  return error instanceof DrillProblem ? error.fieldErrors : [];
}

/** How many of a failure's field errors were left out of fieldErrorsOfFailure. */
export function omittedErrorsOfFailure(error: unknown): number {
  return error instanceof DrillProblem ? error.omittedErrors : 0;
}

/** True for the 409 a DELETE answers while a practice session still references the drill. */
export function isDrillInUse(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.conflict;
}
