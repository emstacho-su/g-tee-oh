/**
 * The drill acceptance file (R3.15, O-315, O-67): a JSON file naming the drills a build card asks
 * for, one case per drill, which drill-acceptance.test.ts expresses and runs against a library.
 *
 * Format, version 1: {version: 1, source, library_note, cases: [{name, drill, note?}]}, 1 to
 * MAX_CASES cases with unique names. source says where the drills come from (the owner's card, the
 * 05 section 4 fallback under O-67, or "synthetic"); library_note names the library the file is
 * meant to run against. Every object is strict, so a misspelled key is an error, never ignored.
 *
 * Mechanism: the loader checks the envelope only. A case's drill must be a JSON object, but it is
 * expressed separately by expressDrill, the api's own DrillCreate schema (src/schemas/drills.ts,
 * including the SpotFilterWrite cross-field rules), so a drill that does not express fails its own
 * case and the other cases still run. A missing file, bad JSON and an envelope failure each throw
 * an AcceptanceFileError whose message names the file and the cause (Zod issue paths and messages,
 * never the file's values). A relative path is read from the repository root, wherever vitest runs.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { drillCreateBodySchema, type DrillCreateBody } from "../../src/schemas/drills.js";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
/** The file the runner reads when DRILL_ACCEPTANCE_FILE is unset: the synthetic set CI runs (O-64). */
export const DEFAULT_ACCEPTANCE_FILE = join("validation", "fixtures", "drills", "synthetic-drill-set.json");
export const ACCEPTANCE_FILE_VERSION = 1;
export const MAX_CASES = 64;
export const MAX_CASE_NAME_LENGTH = 120;
export const MAX_TEXT_LENGTH = 2000;

const caseSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_CASE_NAME_LENGTH),
  drill: z.record(z.string(), z.unknown()).describe("A DrillCreate body, expressed per case"),
  note: z.string().max(MAX_TEXT_LENGTH).optional(),
});

export const acceptanceFileSchema = z
  .strictObject({
    version: z.literal(ACCEPTANCE_FILE_VERSION),
    source: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    library_note: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    cases: z.array(caseSchema).min(1).max(MAX_CASES),
  })
  .superRefine((file, context) => {
    const names = file.cases.map((entry) => entry.name);
    names.forEach((name, index) => {
      if (names.indexOf(name) !== index) {
        context.addIssue({ code: "custom", path: ["cases", index, "name"], message: "this case name is used more than once" });
      }
    });
  });

export type AcceptanceFile = z.infer<typeof acceptanceFileSchema>;
export type AcceptanceCase = AcceptanceFile["cases"][number];

export class AcceptanceFileError extends Error {
  override readonly name = "AcceptanceFileError";
}

/** The path to read: the given one (absolute, or relative to the repository root), else the default. */
export function resolveAcceptancePath(given: string | undefined): string {
  const trimmed = given?.trim() ?? "";
  const path = trimmed === "" ? DEFAULT_ACCEPTANCE_FILE : trimmed;
  return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Zod issues as "path: message" lines; values are never echoed. */
export function issueLines(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const keys = issue.code === "unrecognized_keys" ? ` (${issue.keys.join(", ")})` : "";
      const path = issue.path.length === 0 ? "(file)" : issue.path.join(".");
      return `${path}: ${issue.message}${keys}`;
    })
    .join("; ");
}

/** Reads and checks an acceptance file; throws AcceptanceFileError naming the path and the cause. */
export function loadAcceptanceFile(path: string): AcceptanceFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    throw new AcceptanceFileError(`the acceptance file ${path} cannot be read: ${describeError(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    throw new AcceptanceFileError(`the acceptance file ${path} is not valid JSON: ${describeError(error)}`);
  }
  const parsed = acceptanceFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new AcceptanceFileError(`the acceptance file ${path} does not match version ${ACCEPTANCE_FILE_VERSION}: ${issueLines(parsed.error)}`);
  }
  return parsed.data;
}

export type Expressed = { success: true; drill: DrillCreateBody } | { success: false; issues: string };

/** A case's drill expressed in the drill schema: DrillCreate, with its cross-field rules. */
export function expressDrill(drill: unknown): Expressed {
  const parsed = drillCreateBodySchema.safeParse(drill);
  return parsed.success ? { success: true, drill: parsed.data } : { success: false, issues: issueLines(parsed.error) };
}
