/**
 * Typed api errors (R3.13, A5 section 3). The api answers every failure as an RFC 9457
 * application/problem+json body whose type is "urn:g-tee-oh:problem:<slug>". The body is
 * untrusted JSON, so each field is narrowed here before use: a body that is not a problem keeps
 * its HTTP status and gets the "unknown" slug and a fixed title. Callers branch on status and
 * slug only; detail is kept for logs and is never shown to the user by the screens in this lane.
 */

const PROBLEM_TYPE_PREFIX = "urn:g-tee-oh:problem:";
const UNKNOWN_SLUG = "unknown";
const FALLBACK_TITLE = "Request failed";

/** The slugs the web branches on; the api may send others, which pass through as strings. */
export const PROBLEM_SLUG = {
  unauthenticated: "unauthenticated",
  csrf: "csrf",
  forbiddenOrigin: "forbidden-origin",
  /** An admin route refused a member (O-242, S28). */
  forbidden: "forbidden",
  rateLimited: "rate-limited",
  validation: "validation",
  notImplemented: "not-implemented",
  /** Every bad invite token (S42, O-422). */
  inviteInvalid: "invite-invalid",
  unknown: UNKNOWN_SLUG,
} as const;

export interface ApiProblemInit {
  status: number;
  slug: string;
  title: string;
  detail?: string;
}

/** An api failure: the HTTP status plus the problem slug, title and optional detail. */
export class ApiProblem extends Error {
  override readonly name = "ApiProblem";
  readonly status: number;
  readonly slug: string;
  readonly title: string;
  readonly detail: string | undefined;

  constructor(init: ApiProblemInit) {
    super(`${init.status} ${init.slug}: ${init.title}`);
    this.status = init.status;
    this.slug = init.slug;
    this.title = init.title;
    this.detail = init.detail;
  }
}

export function isApiProblem(value: unknown): value is ApiProblem {
  return value instanceof ApiProblem;
}

function stringField(body: object, key: string): string | undefined {
  const value: unknown = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function slugOf(type: string | undefined): string {
  if (type === undefined || !type.startsWith(PROBLEM_TYPE_PREFIX)) return UNKNOWN_SLUG;
  const slug = type.slice(PROBLEM_TYPE_PREFIX.length);
  return slug === "" ? UNKNOWN_SLUG : slug;
}

/** Builds an ApiProblem from a status and an untrusted parsed body. */
export function problemFromBody(status: number, body: unknown): ApiProblem {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return new ApiProblem({ status, slug: UNKNOWN_SLUG, title: FALLBACK_TITLE });
  }
  const slug = slugOf(stringField(body, "type"));
  if (slug === UNKNOWN_SLUG) {
    return new ApiProblem({ status, slug, title: FALLBACK_TITLE });
  }
  const detail = stringField(body, "detail");
  return new ApiProblem({
    status,
    slug,
    title: stringField(body, "title") ?? FALLBACK_TITLE,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** Reads a failed response into an ApiProblem from a clone, so the original body stays unread. */
export async function problemFromResponse(response: Response): Promise<ApiProblem> {
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // A body that is not JSON (a proxy error page, an empty body) is still a failure with a status.
    body = null;
  }
  return problemFromBody(response.status, body);
}
