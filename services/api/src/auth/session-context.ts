/**
 * What an authenticated request knows about its session (R3.1). The authentication hook sets
 * request.session from the cookie; it stays null on a public route or when no live session
 * matches. Handlers read the user id from here and never from the request body (ADR 0001).
 */
import "fastify";

export interface SessionContext {
  sessionId: string;
  userId: string;
  email: string;
  userCreatedAt: Date;
  csrfToken: string;
  expiresAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    session: SessionContext | null;
  }
}
