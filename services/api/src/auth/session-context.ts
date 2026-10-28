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
  /**
   * app_user.is_admin, read with the session on every request, so GET /me reports it and the web
   * shows the builder controls from it (O-290). It is display only: the admin routes still check
   * the column themselves (requireAdmin, O-242), and no route can write it.
   */
  isAdmin: boolean;
  csrfToken: string;
  expiresAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    session: SessionContext | null;
  }
}
