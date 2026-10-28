/**
 * Invite and join schemas (S42, R3.1, R3.5, O-349, O-420 to O-429).
 *
 * - The admin's create body is one email, normalized the way login normalizes it.
 * - Inspect and join take the token as plain text up to MAX_INVITE_TOKEN_LENGTH; its shape is
 *   checked in the handler, so a malformed token gets the same 410 invite-invalid problem as an
 *   unknown, wrong, expired, used or revoked one (O-422).
 * - display_name (O-426) and the password follow the rules in auth/account-rules.ts, the one
 *   source the create-user command and the join route share: the name is trimmed, then holds 1 to
 *   60 characters with at least one letter or digit and no control, invisible or default-ignorable
 *   character; the password holds 12 to 1024 characters. Each failure carries a fixed message and
 *   never echoes the value.
 */
import { z } from "zod";

import {
  displayNameFailure,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_RAW_DISPLAY_NAME_LENGTH,
  MIN_NEW_PASSWORD_LENGTH,
  NAME_FAILURE_TEXT,
  newPasswordFailure,
  PASSWORD_FAILURE_TEXT,
} from "../auth/account-rules.js";
import { MAX_INVITE_TOKEN_LENGTH } from "../auth/invite-token.js";
import { loginEmailSchema } from "./auth.js";
import { timestampSchema, uuidSchema } from "./common.js";

export const displayNameSchema = z
  .string()
  .max(MAX_RAW_DISPLAY_NAME_LENGTH)
  .trim()
  .superRefine((name, context) => {
    const failure = displayNameFailure(name);
    if (failure !== null) context.addIssue({ code: "custom", message: NAME_FAILURE_TEXT[failure] });
  })
  .describe(
    `1 to ${MAX_DISPLAY_NAME_LENGTH} characters after trimming, at least one letter or digit; no control, invisible or default-ignorable characters (O-426)`,
  );

export const newPasswordSchema = z
  .string()
  .superRefine((password, context) => {
    const failure = newPasswordFailure(password);
    if (failure !== null) context.addIssue({ code: "custom", message: PASSWORD_FAILURE_TEXT[failure] });
  })
  .describe(`At least ${MIN_NEW_PASSWORD_LENGTH} characters (A9 section 3)`);

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
  password: newPasswordSchema,
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
