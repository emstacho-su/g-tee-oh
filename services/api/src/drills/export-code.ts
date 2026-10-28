/**
 * The drill export code (R3.14, 05 section 4, O-310): g-tee-oh's own encoding of a drill, so a
 * drill can be copied as one line of text and imported again. It copies no other tool's share
 * code format or field names (O-26, O-235): the payload is the DrillCreate body, whose field
 * names are g-tee-oh's (schemas/drills.ts).
 *
 * Format: EXPORT_CODE_PREFIX ("gteeoh1.", the format version 1) followed by base64url (RFC 4648
 * section 5, no padding) of zlib deflate of the canonical JSON (http/canonical-json.ts) of
 * {name, tags, spot_filter, trainer}. Canonical JSON sorts keys, so one drill always gives one
 * code. The code is derived when a drill is exported and never stored: 05 section 4's
 * drill.export_code is this derived value. Zlib's Adler-32 checksum catches a mistyped code.
 *
 * Decoding is user input, so it is guarded in this order, each failure an ExportCodeError:
 * 1. length: a code longer than MAX_EXPORT_CODE_LENGTH is refused before anything is decoded;
 * 2. version: the prefix must be EXPORT_CODE_PREFIX;
 * 3. base64url: only the base64url alphabet, and at least two characters;
 * 4. inflate: zlib inflateSync with maxOutputLength MAX_INFLATED_BYTES, so a compression bomb is
 *    stopped by zlib itself before more than the cap is ever produced (RangeError ERR_BUFFER_TOO_LARGE);
 * 5. JSON: the inflated bytes must be UTF-8 JSON;
 * 6. shape: a strict Zod object (unknown keys rejected at every depth) with the stored shapes;
 * 7. write rules: drillCreateBodySchema, the same rules a POST /drills body meets (SpotFilterWrite).
 */
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";

import { canonicalJson } from "../http/canonical-json.js";
import {
  drillCreateBodySchema,
  MAX_EXPORT_CODE_LENGTH,
  storedSpotFilterSchema,
  trainerSettingsSchema,
  type DrillCreateBody,
} from "../schemas/drills.js";

export { MAX_EXPORT_CODE_LENGTH };

/** Format version 1 of g-tee-oh's export code (O-310). */
export const EXPORT_CODE_PREFIX = "gteeoh1.";
/** The most bytes a code may inflate to (64 KiB); a real drill inflates to under 2 KiB. */
export const MAX_INFLATED_BYTES = 64 * 1024;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{2,}$/;

/** The decoded payload's shape: strict at every depth, before the write rules run. */
const exportPayloadShapeSchema = z.strictObject({
  name: z.string(),
  tags: z.array(z.string()),
  spot_filter: storedSpotFilterSchema,
  trainer: trainerSettingsSchema,
});

export type ExportCodeFailure = "too_long" | "version" | "malformed" | "too_large" | "invalid";

export interface ExportCodeIssue {
  /** Dotted path inside the payload; "" for the payload itself. */
  path: string;
  message: string;
}

const FAILURE_TEXT: Readonly<Record<ExportCodeFailure, string>> = {
  too_long: `The export code is longer than ${MAX_EXPORT_CODE_LENGTH} characters.`,
  version: `The export code does not start with ${EXPORT_CODE_PREFIX}, the export code version this server reads.`,
  malformed: "The export code is damaged: it does not decode to a drill.",
  too_large: `The export code expands to more than ${MAX_INFLATED_BYTES} bytes.`,
  invalid: "The export code decodes to a drill this server does not accept.",
};

/** Why an export code was refused; the route answers it as a 400 validation problem. */
export class ExportCodeError extends Error {
  readonly reason: ExportCodeFailure;
  readonly issues: readonly ExportCodeIssue[];

  constructor(reason: ExportCodeFailure, issues: readonly ExportCodeIssue[] = []) {
    super(FAILURE_TEXT[reason]);
    this.name = "ExportCodeError";
    this.reason = reason;
    this.issues = issues;
  }
}

/** The export code of a drill's name, tags, spot filter and trainer settings. */
export function encodeExportCode(drill: DrillCreateBody): string {
  const payload = { name: drill.name, tags: drill.tags, spot_filter: drill.spot_filter, trainer: drill.trainer };
  return `${EXPORT_CODE_PREFIX}${deflateSync(Buffer.from(canonicalJson(payload), "utf8")).toString("base64url")}`;
}

function isBufferTooLarge(error: unknown): boolean {
  return error instanceof RangeError && (error as RangeError & { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
}

function inflate(body: string): Buffer {
  try {
    return inflateSync(Buffer.from(body, "base64url"), { maxOutputLength: MAX_INFLATED_BYTES });
  } catch (error: unknown) {
    throw new ExportCodeError(isBufferTooLarge(error) ? "too_large" : "malformed");
  }
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ExportCodeError("malformed");
  }
}

function issuesOf(error: z.ZodError): ExportCodeIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

/** The DrillCreate body an export code holds; throws ExportCodeError on any failed guard. */
export function decodeExportCode(code: string): DrillCreateBody {
  if (code.length > MAX_EXPORT_CODE_LENGTH) {
    throw new ExportCodeError("too_long");
  }
  if (!code.startsWith(EXPORT_CODE_PREFIX)) {
    throw new ExportCodeError("version");
  }
  const body = code.slice(EXPORT_CODE_PREFIX.length);
  if (!BASE64URL_PATTERN.test(body)) {
    throw new ExportCodeError("malformed");
  }
  const json = parseJson(inflate(body));
  const shape = exportPayloadShapeSchema.safeParse(json);
  if (!shape.success) {
    throw new ExportCodeError("invalid", issuesOf(shape.error));
  }
  const drill = drillCreateBodySchema.safeParse(shape.data);
  if (!drill.success) {
    throw new ExportCodeError("invalid", issuesOf(drill.error));
  }
  return drill.data;
}
