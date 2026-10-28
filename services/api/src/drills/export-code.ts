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
 * 6. structure: no array longer than MAX_PAYLOAD_ARRAY_ITEMS (the largest list a drill may hold)
 *    and no nesting deeper than MAX_PAYLOAD_DEPTH, checked before any schema runs, so a short code
 *    that inflates to tens of thousands of entries is one issue, never one issue per entry
 *    (PR #30 review MEDIUM 1);
 * 7. shape: a strict Zod object (unknown keys rejected at every depth) with the stored shapes and
 *    the write limits on name and tags;
 * 8. write rules: drillCreateBodySchema, the same rules a POST /drills body meets (SpotFilterWrite).
 * Issues are capped at MAX_PROBLEM_ERRORS with the rest counted, and unknown keys are reported as
 * a count at their object's path, never by their text (http/field-error-cap.ts).
 *
 * Export runs step 8 on the stored drill too (exportIssues, MEDIUM 2): a drill written before a
 * write rule existed is refused rather than exported as a code its own import would refuse.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";

import { canonicalJson } from "../http/canonical-json.js";
import { capErrors, safeIssueMessage } from "../http/field-error-cap.js";
import {
  drillCreateBodySchema,
  EXPORT_CODE_PREFIX,
  MAX_DRILL_NAME_LENGTH,
  MAX_EXPORT_CODE_LENGTH,
  MAX_FLOPS,
  MAX_TAGS,
  storedSpotFilterSchema,
  trainerSettingsSchema,
  type DrillCreateBody,
} from "../schemas/drills.js";

export { EXPORT_CODE_PREFIX, MAX_EXPORT_CODE_LENGTH };

/** The most bytes a code may inflate to (64 KiB); a real drill inflates to under 2 KiB. */
export const MAX_INFLATED_BYTES = 64 * 1024;
/** The longest list a drill may hold: the explicit flop subset (schemas/drills.ts MAX_FLOPS). */
export const MAX_PAYLOAD_ARRAY_ITEMS = MAX_FLOPS;
/** The deepest a drill nests (payload, spot_filter, board, flops) with room to spare. */
export const MAX_PAYLOAD_DEPTH = 6;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{2,}$/;

/** The decoded payload's shape: strict at every depth, with the write limits, before the write rules run. */
const exportPayloadShapeSchema = z.strictObject({
  name: z.string().max(MAX_DRILL_NAME_LENGTH),
  tags: z.array(z.string()).max(MAX_TAGS),
  spot_filter: storedSpotFilterSchema,
  trainer: trainerSettingsSchema,
});

export type ExportCodeFailure = "too_long" | "version" | "malformed" | "too_large" | "invalid";

export interface ExportCodeIssue {
  /** Dotted path inside the payload; "" for the payload itself. */
  path: string;
  message: string;
}

/** At most MAX_PROBLEM_ERRORS issues, and how many were left out. */
export interface CappedIssues {
  issues: ExportCodeIssue[];
  omitted: number;
}

const FAILURE_TEXT: Readonly<Record<ExportCodeFailure, string>> = {
  too_long: `The export code is longer than ${MAX_EXPORT_CODE_LENGTH} characters.`,
  version: `The export code does not start with ${EXPORT_CODE_PREFIX}, the export code version this server reads.`,
  malformed: "The export code is damaged: it does not decode to a drill.",
  too_large: `The export code expands to more than ${MAX_INFLATED_BYTES} bytes.`,
  invalid: "The export code decodes to a drill this server does not accept.",
};

const NO_ISSUES: CappedIssues = { issues: [], omitted: 0 };

/** Why an export code was refused; the route answers it as a 400 validation problem. */
export class ExportCodeError extends Error {
  readonly reason: ExportCodeFailure;
  readonly issues: readonly ExportCodeIssue[];
  /** Issues left out past the cap (http/field-error-cap.ts). */
  readonly omitted: number;

  constructor(reason: ExportCodeFailure, capped: CappedIssues = NO_ISSUES) {
    super(FAILURE_TEXT[reason]);
    this.name = "ExportCodeError";
    this.reason = reason;
    this.issues = capped.issues;
    this.omitted = capped.omitted;
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

/**
 * The first structural bound the value breaks, or undefined. The issue's path is the payload's
 * (""), because a deeper path could hold key text the code supplied. Recursion stops at
 * MAX_PAYLOAD_DEPTH, so it is bounded however the JSON nests.
 */
export function structureIssue(value: unknown, depth = 0): ExportCodeIssue | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (depth >= MAX_PAYLOAD_DEPTH) {
    return { path: "", message: `The drill nests deeper than ${MAX_PAYLOAD_DEPTH} levels.` };
  }
  if (Array.isArray(value) && value.length > MAX_PAYLOAD_ARRAY_ITEMS) {
    return { path: "", message: `A list in the drill holds more than ${MAX_PAYLOAD_ARRAY_ITEMS} items.` };
  }
  for (const child of Object.values(value)) {
    const issue = structureIssue(child, depth + 1);
    if (issue !== undefined) {
      return issue;
    }
  }
  return undefined;
}

/** Zod issues as dotted paths with safe messages, capped (http/field-error-cap.ts). */
export function issuesOf(error: z.ZodError): CappedIssues {
  const { kept, omitted } = capErrors(error.issues);
  const issues = kept.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: safeIssueMessage(issue.code, issue.message, "keys" in issue ? issue.keys : undefined),
  }));
  return { issues, omitted };
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
  const structure = structureIssue(json);
  if (structure !== undefined) {
    throw new ExportCodeError("invalid", { issues: [structure], omitted: 0 });
  }
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

/** A stored drill checked against today's write rules before export (MEDIUM 2). */
export type ExportCheck = { ok: true; drill: DrillCreateBody } | ({ ok: false } & CappedIssues);

/** The stored drill as the write rules accept it, or the rules it breaks (capped). */
export function checkExportable(drill: DrillCreateBody): ExportCheck {
  const parsed = drillCreateBodySchema.safeParse(drill);
  return parsed.success ? { ok: true, drill: parsed.data } : { ok: false, ...issuesOf(parsed.error) };
}
