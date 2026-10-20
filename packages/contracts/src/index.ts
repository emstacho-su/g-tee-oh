/**
 * @g-tee-oh/contracts is the contract layer between the Rust services, the api service and the
 * web app. S06 lands the generated OpenAPI (Open Application Programming Interface) TypeScript
 * clients and the JSON (JavaScript Object Notation) schemas here (A1 section 3). It depends on no
 * other workspace package (A1 section 2). Until S06 this module only named the package (R0.1).
 *
 * The two schemas are exported as plain objects so a caller compiles them with its own validator
 * (the tests use Ajv2020 in strict mode); the node dump invariants a schema cannot express live in
 * node-dump.ts (R0.7).
 */
import manifestSchema from "../schemas/manifest.schema.json" with { type: "json" };
import nodeDumpSchema from "../schemas/node-dump.schema.json" with { type: "json" };

export const PACKAGE_NAME = "@g-tee-oh/contracts" as const;

export { manifestSchema, nodeDumpSchema };
export { FREQUENCY_SUM_TOLERANCE, checkNodeDumpInvariants } from "./node-dump.js";
export type {
  DumpAction,
  DumpGameConfig,
  DumpHandStrategy,
  DumpNode,
  HandSpace,
  NodeDump,
  SolutionSource,
  Street,
  TableFormat,
} from "./node-dump.js";
