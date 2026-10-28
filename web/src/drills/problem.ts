/**
 * The drill screens' api failures (S26, R3.14). ApiProblem (src/api/problem.ts) keeps a problem's
 * status, slug, title and detail; the builder and the import dialog also need the validation
 * problem's field errors (Problem.errors, each a dotted path and a message) to show them next to
 * the field they name. DrillProblem is an ApiProblem with those errors, narrowed from the
 * untrusted body: an entry without a string path and message is dropped, never trusted.
 */
import { ApiProblem, HTTP_STATUS, isApiProblem, problemFromBody } from "../api/index.js";
import type { FieldError } from "./types.js";

export class DrillProblem extends ApiProblem {
  readonly fieldErrors: readonly FieldError[];

  constructor(base: ApiProblem, fieldErrors: readonly FieldError[]) {
    super({ status: base.status, slug: base.slug, title: base.title, ...(base.detail === undefined ? {} : { detail: base.detail }) });
    this.fieldErrors = fieldErrors;
  }
}

function isFieldError(value: unknown): value is FieldError {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry["path"] === "string" && typeof entry["message"] === "string";
}

function fieldErrorsOf(body: unknown): FieldError[] {
  if (typeof body !== "object" || body === null) return [];
  const errors: unknown = (body as Record<string, unknown>)["errors"];
  if (!Array.isArray(errors)) return [];
  return errors.filter(isFieldError).map(({ path, message }) => ({ path, message }));
}

/** An ApiProblem with the body's field errors, from a status and an untrusted parsed body. */
export function drillProblemFromBody(status: number, body: unknown): DrillProblem {
  return new DrillProblem(problemFromBody(status, body), fieldErrorsOf(body));
}

/** The field errors a failure carries; none for anything but a DrillProblem. */
export function fieldErrorsOfFailure(error: unknown): readonly FieldError[] {
  return error instanceof DrillProblem ? error.fieldErrors : [];
}

/** True for the 409 a DELETE answers while a practice session still references the drill. */
export function isDrillInUse(error: unknown): boolean {
  return isApiProblem(error) && error.status === HTTP_STATUS.conflict;
}
