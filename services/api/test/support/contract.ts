/**
 * Contract tests against the committed OpenAPI document (R3.2, R3.14, O-38). A response body is
 * checked against packages/contracts/api.openapi.json, the file clients are generated from, not
 * against the Zod schema the route was built with, so a route that drifts from the committed
 * contract fails here even when Fastify's own serializer accepts it.
 *
 * Mechanism: OpenAPI 3.1 schemas are JSON Schema 2020-12, so the whole document is added to one
 * Ajv2020 instance under an $id, and each response schema is compiled by a JSON pointer reference
 * into that document; the $ref values inside it (#/components/schemas/...) then resolve against
 * the same document. strict is off because an OpenAPI document carries keywords Ajv does not know
 * (openapi, info, paths, example), and formats are not validated because the generated schemas
 * already carry an equivalent pattern next to every format.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The named import: under NodeNext the default import of this CommonJS module types as a namespace.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

const DOCUMENT_PATH = fileURLToPath(new URL("../../../../packages/contracts/api.openapi.json", import.meta.url));
const DOCUMENT_ID = "urn:g-tee-oh:api-openapi";
const JSON_CONTENT_TYPE = "application/json";

type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

function loadDocument(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${DOCUMENT_PATH} is not a JSON object`);
  }
  return { ...(parsed as Record<string, unknown>), $id: DOCUMENT_ID };
}

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(loadDocument());

/** Escapes one JSON pointer segment (RFC 6901). */
function pointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** The validator of one operation's response schema, e.g. ("get", "/api/v1/drills/{id}", 200). */
export function responseValidator(method: HttpMethod, path: string, status: number): ValidateFunction {
  const pointer = ["paths", path, method, "responses", String(status), "content", JSON_CONTENT_TYPE, "schema"]
    .map(pointerSegment)
    .join("/");
  // Ajv compiles a reference once and caches it, so repeated calls are cheap.
  const validate = ajv.getSchema(`${DOCUMENT_ID}#/${pointer}`);
  if (validate === undefined) {
    throw new Error(`the committed contract has no ${method.toUpperCase()} ${path} ${status} JSON response`);
  }
  return validate;
}

/** The contract errors of a response body; an empty list means it matches the committed schema. */
export function contractErrors(method: HttpMethod, path: string, status: number, body: unknown): string[] {
  const validate = responseValidator(method, path, status);
  if (validate(body)) {
    return [];
  }
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);
}
