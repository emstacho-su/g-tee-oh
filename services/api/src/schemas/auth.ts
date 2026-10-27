/**
 * Auth schemas (R3.1, A5 section 3, A9 section 3). Login answers the user and the per-session
 * CSRF (cross-site request forgery) token; GET /me answers the same, so a browser refresh
 * recovers the token without logging in again (O-230). The session itself travels only in the
 * HTTP-only cookie (O-231) and never appears in a body.
 */
import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 1024;

export const loginBodySchema = z.strictObject({
  email: z.email().max(MAX_EMAIL_LENGTH),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  created_at: timestampSchema,
});

export const sessionInfoSchema = z
  .object({
    user: sessionUserSchema,
    csrf_token: z.string().describe("Send as x-csrf-token on every mutating request (O-230)"),
    expires_at: timestampSchema.describe("When the session cookie stops being accepted (O-231)"),
  })
  .meta({ id: "SessionInfo" });

export type LoginBody = z.infer<typeof loginBodySchema>;
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
