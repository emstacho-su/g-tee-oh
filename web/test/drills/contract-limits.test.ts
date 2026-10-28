/**
 * The web's copies of the drill limits match the api contract (S26, R3.14, PR #30 review LOW 12).
 * The generated TypeScript types carry no limits, so src/drills/limits.ts keeps its own constants
 * (it lists them). This test reads the committed OpenAPI document and checks each copy against the
 * document's maxLength, maxItems, minimum, maximum and pattern, so a change on one side without the
 * other fails here instead of showing up as a server field error in the builder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPORT_CODE_PREFIX,
  FLOP_PATTERN,
  HAND_CLASS_PATTERN,
  LINE_PATTERN,
  MAX_DEPTH_BB,
  MAX_DEPTHS,
  MAX_DRILL_NAME_LENGTH,
  MAX_EXPORT_CODE_LENGTH,
  MAX_FLOPS,
  MAX_HANDS,
  MAX_POSITIONS,
  MAX_STAKE_LABEL_LENGTH,
  MAX_TABLE_SIZE,
  MAX_TABLES,
  MAX_TAGS,
  MIN_DEPTH_BB,
  MIN_TABLE_SIZE,
  MIN_TABLES,
  TAG_PATTERN,
} from "../../src/drills/limits.js";
import { MAX_LISTED_FIELD_ERRORS } from "../../src/drills/problem.js";

/** Vitest runs in web/, as test/library/library-units.test.ts relies on too. */
const DOCUMENT_PATH = join(process.cwd(), "..", "packages", "contracts", "api.openapi.json");

type Node = Readonly<Record<string, unknown>>;

const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as Node;

/** The node at a path of keys; throws, naming the path, when the document has no such node. */
function at(root: Node, ...keys: readonly string[]): Node {
  return keys.reduce<Node>((node, key) => {
    const child = node[key];
    if (typeof child !== "object" || child === null) throw new Error(`the contract has no ${keys.join(".")}`);
    return child as Node;
  }, root);
}

const schemas = at(document, "components", "schemas");
const drillCreate = at(schemas, "DrillCreate", "properties");
const spotFilter = at(schemas, "SpotFilterWrite", "properties");
const gameConfig = at(spotFilter, "game_config", "properties");
const manualHands = (at(spotFilter, "hands")["oneOf"] as readonly Node[]).find((branch) => at(branch, "properties", "mode")["const"] === "manual");
if (manualHands === undefined) throw new Error("the contract's hands filter has no manual branch");

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("R3.14 review LOW 12: the web's drill limits match the contract", () => {
  it("R3.14 name, tags and the tag pattern", () => {
    expect(at(drillCreate, "name")["maxLength"]).toBe(MAX_DRILL_NAME_LENGTH);
    expect(at(drillCreate, "tags")["maxItems"]).toBe(MAX_TAGS);
    expect(at(drillCreate, "tags", "items")["pattern"]).toBe(TAG_PATTERN.source);
  });

  it("R3.14 game config: table size and depths", () => {
    expect(at(gameConfig, "table_size")).toMatchObject({ minimum: MIN_TABLE_SIZE, maximum: MAX_TABLE_SIZE });
    expect(at(gameConfig, "depths_bb")["maxItems"]).toBe(MAX_DEPTHS);
    expect(at(gameConfig, "depths_bb", "items")).toMatchObject({ minimum: MIN_DEPTH_BB, maximum: MAX_DEPTH_BB });
  });

  it("R3.14 stake, positions, line, flops and hands", () => {
    expect(at(spotFilter, "stake")["maxLength"]).toBe(MAX_STAKE_LABEL_LENGTH);
    expect(at(spotFilter, "hero_positions")["maxItems"]).toBe(MAX_POSITIONS);
    expect(at(spotFilter, "villain_positions")["maxItems"]).toBe(MAX_POSITIONS);
    expect(at(spotFilter, "line")["pattern"]).toBe(LINE_PATTERN.source);
    expect(at(spotFilter, "board", "properties", "flops")["maxItems"]).toBe(MAX_FLOPS);
    expect(at(manualHands, "properties", "hands")["maxItems"]).toBe(MAX_HANDS);
    expect(at(manualHands, "properties", "hands", "items")["pattern"]).toBe(HAND_CLASS_PATTERN.source);
  });

  it("R3.14 every flop the web accepts the contract's flop pattern accepts too (the web also refuses repeated cards)", () => {
    const contractFlop = new RegExp(String(at(spotFilter, "board", "properties", "flops", "items")["pattern"]));
    for (const flop of ["Kh8d3c", "AsKsQs", "2c2d2h"]) {
      expect(FLOP_PATTERN.test(flop) && contractFlop.test(flop)).toBe(true);
    }
  });

  it("R3.14 trainer tables", () => {
    expect(at(schemas, "TrainerSettings", "properties", "tables")).toMatchObject({ minimum: MIN_TABLES, maximum: MAX_TABLES });
  });

  it("R3.14 the export code: its prefix and the import's length limit", () => {
    const paths = at(document, "paths");
    const exported = at(paths, "/api/v1/drills/{id}/export", "get", "responses", "200", "content", "application/json", "schema", "properties", "export_code");
    expect(exported["pattern"]).toBe(`^${escapeForPattern(EXPORT_CODE_PREFIX)}.*`);
    const imported = at(paths, "/api/v1/drills/import", "post", "requestBody", "content", "application/json", "schema", "properties", "export_code");
    expect(imported["maxLength"]).toBe(MAX_EXPORT_CODE_LENGTH);
  });

  it("R3.14 the field error cap matches Problem.errors", () => {
    expect(at(schemas, "Problem", "properties", "errors")["maxItems"]).toBe(MAX_LISTED_FIELD_ERRORS);
  });
});
