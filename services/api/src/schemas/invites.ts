/**
 * Invite and join schemas (S42, R3.1, R3.5, O-349, O-420 to O-429).
 *
 * - The admin's create body is one email, normalized the way login normalizes it.
 * - Inspect and join take the token as plain text up to MAX_INVITE_TOKEN_LENGTH; its shape is
 *   checked in the handler, so a malformed token gets the same 410 invite-invalid problem as an
 *   unknown, wrong, expired, used or revoked one (O-422).
 * - display_name (O-426) is trimmed and must then hold 1 to 60 characters (code points, the same
 *   count Postgres' char_length uses) with no control or invisible formatting character: Unicode
 *   categories Cc and Cf, which include the bidirectional overrides, plus the line and paragraph
 *   separators. A name is shown to other people later, so text that reorders or hides itself is
 *   refused at the boundary rather than cleaned.
 * - The password follows the existing new-account rule (users.ts): 12 to 1024 characters.
 */
import { z } from "zod";

import { MAX_INVITE_TOKEN_LENGTH } from "../auth/invite-token.js";
import { MIN_NEW_PASSWORD_LENGTH } from "../auth/users.js";
import { loginEmailSchema, MAX_PASSWORD_LENGTH } from "./auth.js";
import { timestampSchema, uuidSchema } from "./common.js";

export const MAX_DISPLAY_NAME_LENGTH = 60;
/** The raw length accepted before trimming, so a huge padded value is refused before any work. */
const MAX_RAW_DISPLAY_NAME_LENGTH = 240;
/** Control (Cc), invisible formatting (Cf, bidi overrides included), line and paragraph separators. */
export const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function characterCount(text: string): number {
  return Array.from(text).length;
}

export const displayNameSchema = z
  .string()
  .max(MAX_RAW_DISPLAY_NAME_LENGTH)
  .trim()
  .min(1, "Enter a name.")
  .refine((name) => characterCount(name) <= MAX_DISPLAY_NAME_LENGTH, `At most ${MAX_DISPLAY_NAME_LENGTH} characters.`)
  .refine((name) => !FORBIDDEN_NAME_CHARACTERS.test(name), "Control and invisible formatting characters are not allowed.")
  .describe(
    `1 to ${MAX_DISPLAY_NAME_LENGTH} characters after trimming; no control or invisible formatting characters (O-426)`,
  );

export const inviteTokenSchema = z
  .string()
  .min(1)
  .max(MAX_INVITE_TOKEN_LENGTH)
  .describe("The token from the invite link, the text after /join#");

export const createInviteBodySchema = z.strictObject({ email: loginEmailSchema });

export const inspectInviteBodySchema = z.strictObject({ token: inviteTokenSchema });

export const joinBodySchema = z.strictObject({
  token: inviteTokenSchema,
  display_name: displayNameSchema,
  password: z
    .string()
    .refine((password) => characterCount(password) >= MIN_NEW_PASSWORD_LENGTH, `At least ${MIN_NEW_PASSWORD_LENGTH} characters.`)
    .refine((password) => password.length <= MAX_PASSWORD_LENGTH, `At most ${MAX_PASSWORD_LENGTH} characters.`)
    .describe(`At least ${MIN_NEW_PASSWORD_LENGTH} characters (A9 section 3)`),
});

export const INVITE_STATUSES = ["pending", "used", "expired", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const inviteSummarySchema = z
  .object({
    id: uuidSchema,
    email: z.string(),
    created_by_email: z.string(),
    created_at: timestampSchema,
    expires_at: timestampSchema,
    used_at: timestampSchema.nullable(),
    revoked_at: timestampSchema.nullable(),
    status: z.enum(INVITE_STATUSES).describe("Computed on read from the clock (O-420); never stored"),
  })
  .meta({ id: "InviteSummary" });

export const createdInviteSchema = z
  .object({
    invite: inviteSummarySchema,
    link: z.string().describe("The join link; shown once, never stored or listed again (O-427)"),
  })
  .meta({ id: "CreatedInvite" });

export const invitePreviewSchema = z
  .object({ email: z.string(), expires_at: timestampSchema })
  .meta({ id: "InvitePreview" });

export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;
export type JoinBody = z.infer<typeof joinBodySchema>;
export type InviteSummary = z.infer<typeof inviteSummarySchema>;
export type CreatedInvite = z.infer<typeof createdInviteSchema>;
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
