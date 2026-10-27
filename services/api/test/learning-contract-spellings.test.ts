/**
 * R3.8 spelling pin between the learning policy and the solver-query contract (S22). packages/learning
 * is pure and reads no files (A1 section 2), so it spells the contract's action kinds and buckets as
 * local unions; services/api joins the two packages and grades with solver-query's answers (S23), so
 * this test, here, reads the committed contract and checks that the learning constants still match it.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ACTION_KINDS, BUCKETS } from "@g-tee-oh/learning";

// The committed solver-query document, resolved relative to this test file.
const SOLVER_QUERY_DOCUMENT_URL = new URL("../../../packages/contracts/solver-query.openapi.json", import.meta.url);

interface SchemaShape {
  enum?: unknown[];
  properties?: Record<string, { description?: unknown }>;
}

async function readSchemas(): Promise<Record<string, SchemaShape>> {
  const parsed = JSON.parse(await readFile(SOLVER_QUERY_DOCUMENT_URL, "utf8")) as {
    components?: { schemas?: Record<string, SchemaShape> };
  };
  const schemas = parsed.components?.schemas;
  if (schemas === undefined) {
    throw new Error("solver-query.openapi.json has no components.schemas");
  }
  return schemas;
}

describe("R3.8 learning policy spellings match the solver-query contract", () => {
  it("R3.8 ACTION_KINDS equals the ActionKind enum in contract order", async () => {
    const schemas = await readSchemas();
    expect([...ACTION_KINDS]).toEqual(schemas.ActionKind?.enum);
  });

  it("R3.8 every BUCKETS spelling appears in the contract's ActionView bucket description", async () => {
    const schemas = await readSchemas();
    const description = schemas.ActionView?.properties?.bucket?.description;
    expect(typeof description).toBe("string");
    for (const bucket of BUCKETS) {
      expect(description).toContain(`\`${bucket}\``);
    }
  });
});
