/**
 * Mocked invite routes (S42, R3.13, R3.5, O-349, O-422, O-427) for the mock and shots projects.
 *
 * - The public pair, POST /auth/invites/inspect and POST /auth/join, is answered from
 *   createMockApi's auth block (mock-api.ts), because a join signs the page in. One synthetic
 *   token is valid until it is used; any other token, and the used one, gets the 410
 *   invite-invalid problem. A join with a name and a password of at least 12 characters signs in
 *   as a member with the invite's email and the given name.
 * - The admin trio (list, create, revoke) is a feature route for the app mock: the list starts
 *   with one invite in each state, create answers the same synthetic link (so a second page's mock
 *   accepts it) and adds a pending row, revoke marks a pending row revoked. A member is refused
 *   with 403, like the api.
 * Every value is synthetic (O-26).
 */
import type { CreatedInvite, InviteSummary, SessionInfo } from "../../src/contracts.js";
import { fixtureMemberSession } from "../../src/fixtures/index.js";
import { json, problem, UNAUTHENTICATED, type MockRequest, type MockResponse, type MockRoute, type ProblemSpec } from "./mock-api.js";

export const INSPECT_PATH = "/api/v1/auth/invites/inspect";
export const JOIN_PATH = "/api/v1/auth/join";
export const INVITES_PATH = "/api/v1/admin/invites";
export const MOCK_INVITE_TOKEN = "01890a5d-ac96-774b-bcce-b302099a8057.SyntheticInviteSecretForTheMockOnly_0123456";
export const MOCK_INVITE_EMAIL = "new.member@example.com";
export const MOCK_INVITE_EXPIRES_AT = "2026-11-04T12:00:00Z";
const MIN_PASSWORD_LENGTH = 12;

const INVITE_INVALID: ProblemSpec = { status: 410, slug: "invite-invalid", title: "This invite link is not valid" };
const VALIDATION: ProblemSpec = { status: 400, slug: "validation", title: "Request validation failed" };
const FORBIDDEN: ProblemSpec = { status: 403, slug: "forbidden", title: "Forbidden" };
const NOT_FOUND: ProblemSpec = { status: 404, slug: "not-found", title: "Not found" };

export interface JoinState {
  readonly used: boolean;
}

export interface JoinOutcome {
  readonly response: MockResponse;
  readonly state: JoinState;
  /** The session a successful join signs in with. */
  readonly session?: SessionInfo;
}

function field(body: unknown, name: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function joinedSession(displayName: string): SessionInfo {
  return { ...fixtureMemberSession, user: { ...fixtureMemberSession.user, email: MOCK_INVITE_EMAIL, display_name: displayName } };
}

/** Inspect and join; undefined for any other request. */
export function handleJoinRequest(request: MockRequest, state: JoinState): JoinOutcome | undefined {
  const key = `${request.method.toUpperCase()} ${request.path}`;
  if (key !== `POST ${INSPECT_PATH}` && key !== `POST ${JOIN_PATH}`) return undefined;
  const usable = !state.used && field(request.body, "token") === MOCK_INVITE_TOKEN;
  if (!usable) return { response: problem(INVITE_INVALID, request.path), state };
  if (key === `POST ${INSPECT_PATH}`) {
    return { response: json(200, { email: MOCK_INVITE_EMAIL, expires_at: MOCK_INVITE_EXPIRES_AT }), state };
  }
  const name = field(request.body, "display_name")?.trim() ?? "";
  const password = field(request.body, "password") ?? "";
  if (name === "" || Array.from(password).length < MIN_PASSWORD_LENGTH) return { response: problem(VALIDATION, request.path), state };
  const session = joinedSession(name);
  return { response: json(200, session), state: { used: true }, session };
}

function invite(id: string, email: string, status: InviteSummary["status"]): InviteSummary {
  return {
    id,
    email,
    created_by_email: "owner@example.com",
    created_at: "2026-10-28T12:00:00Z",
    expires_at: MOCK_INVITE_EXPIRES_AT,
    used_at: status === "used" ? "2026-10-29T09:30:00Z" : null,
    revoked_at: status === "revoked" ? "2026-10-29T10:15:00Z" : null,
    status,
  };
}

const SEED: readonly InviteSummary[] = [
  invite("01890a5d-ac96-774b-bcce-b302099a8004", "pending.friend@example.com", "pending"),
  invite("01890a5d-ac96-774b-bcce-b302099a8003", "joined.friend@example.com", "used"),
  invite("01890a5d-ac96-774b-bcce-b302099a8002", "late.friend@example.com", "expired"),
  invite("01890a5d-ac96-774b-bcce-b302099a8001", "withdrawn@example.com", "revoked"),
];

export interface MockInvitesOptions {
  readonly admin?: boolean;
  /** The origin the created link names; the harness preview's by default. */
  readonly origin?: string;
}

/** The admin invite routes, with their own list state. */
export function createMockInvitesRoute(options: MockInvitesOptions = {}): MockRoute {
  const admin = options.admin ?? true;
  const origin = options.origin ?? "http://localhost:4173";
  let invites: readonly InviteSummary[] = SEED;
  let created = 0;
  return (request, context) => {
    if (!request.path.startsWith(INVITES_PATH)) return undefined;
    if (!context.signedIn) return problem(UNAUTHENTICATED, request.path);
    if (!admin) return problem(FORBIDDEN, request.path);
    const method = request.method.toUpperCase();
    if (method === "GET" && request.path === INVITES_PATH) return json(200, { items: invites, next_cursor: null });
    if (method === "POST" && request.path === INVITES_PATH) {
      const email = field(request.body, "email")?.trim().toLowerCase() ?? "";
      created += 1;
      const fresh = invite(`01890a5d-ac96-774b-bcce-${String(created).padStart(12, "0")}`, email, "pending");
      invites = [fresh, ...invites];
      const body: CreatedInvite = { invite: fresh, link: `${origin}/join#${MOCK_INVITE_TOKEN}` };
      return json(201, body);
    }
    const revoke = /^\/api\/v1\/admin\/invites\/([^/]+)\/revoke$/.exec(request.path);
    if (method === "POST" && revoke !== null) {
      const target = invites.find((candidate) => candidate.id === revoke[1]);
      if (target === undefined) return problem(NOT_FOUND, request.path);
      const revoked: InviteSummary = { ...target, status: "revoked", revoked_at: "2026-10-29T11:00:00Z" };
      invites = invites.map((candidate) => (candidate.id === target.id ? revoked : candidate));
      return json(200, revoked);
    }
    return undefined;
  };
}
