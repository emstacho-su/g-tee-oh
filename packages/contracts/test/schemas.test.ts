// Contract schema tests (R0.7, A1 section 3): the manifest and node dump JSON (JavaScript Object
// Notation) schemas compile under Ajv2020 strict mode, the hand-written examples validate, the
// shape rules reject the documented bad inputs, and the invariant checker in src/node-dump.ts
// rejects what a schema cannot express (criterion 2: R1.5, R2.8).
// The named import, not the default one: under NodeNext resolution the default import of this
// CommonJS module types as the module namespace, while Node exposes the class under both names.
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import flopBuildManifest from "../schemas/examples/manifest.flop-build.json" with { type: "json" };
import preflopManifest from "../schemas/examples/manifest.preflop.json" with { type: "json" };
import nodeDump from "../schemas/examples/node-dump.json" with { type: "json" };
import { FREQUENCY_SUM_TOLERANCE, checkNodeDumpInvariants, manifestSchema, nodeDumpSchema } from "../src/index.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateManifest = ajv.compile(manifestSchema);
const validateNodeDump = ajv.compile(nodeDumpSchema);

/** The ajv error messages for one input, empty when it validates. */
function errorsOf(validate: ValidateFunction, data: unknown): readonly string[] {
  const valid = validate(data);
  if (valid) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ""}`.trim());
}

/** The first item of a non-empty example list; the examples are hand-written, so an empty list is a bug. */
function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error("the example list is empty");
  return item;
}

/** A copy of a JSON object without one key, the immutable way to drop a field. */
function withoutKey(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

const exampleNode = first(nodeDump.nodes);
const exampleHand = first(exampleNode.hands);

/** The node dump example with its first hand replaced by a changed copy. */
function withFirstHand(hand: Readonly<Record<string, unknown>>): unknown {
  return { ...nodeDump, nodes: [{ ...exampleNode, hands: [hand, ...exampleNode.hands.slice(1)] }] };
}

/** The example rewritten to one node holding `labels` as its hands, in the given hand space. */
function withHands(handSpace: string, labels: readonly string[]): unknown {
  const hands = labels.map((hand) => ({ ...exampleHand, hand }));
  return { ...nodeDump, hand_space: handSpace, nodes: [{ ...exampleNode, hands }] };
}

// gto-model's canonical spellings (HandClass and ComboId Display): the higher rank first, and for
// two cards of one rank the lower suit first in the order cdhs. Each rejected label is a different
// spelling of the accepted one at the same index.
const CANONICAL_169 = ["AKs", "AA", "72o", "T9s", "KQo"];
const NON_CANONICAL_169 = ["KAs", "AAs", "27o", "9Ts", "QKo"];
const CANONICAL_1326 = ["AsKc", "AcAd", "7h2c", "Td9d", "2c2s"];
const NON_CANONICAL_1326 = ["KcAs", "AdAc", "2c7h", "9dTd", "2s2c"];

describe("R0.7 contract schemas", () => {
  it("R0.7 both schemas compile under Ajv2020 strict mode", () => {
    const strictAjv = new Ajv2020({ strict: true, allErrors: true });
    expect(() => strictAjv.compile(manifestSchema)).not.toThrow();
    expect(() => strictAjv.compile(nodeDumpSchema)).not.toThrow();
  });

  it("R0.7 the flop build manifest example validates", () => {
    expect(errorsOf(validateManifest, flopBuildManifest)).toEqual([]);
  });

  it("R0.7 the preflop manifest example validates", () => {
    expect(errorsOf(validateManifest, preflopManifest)).toEqual([]);
  });

  it("R0.7 the node dump example validates", () => {
    expect(errorsOf(validateNodeDump, nodeDump)).toEqual([]);
  });

  it("R0.7 a manifest with format_version 2 is rejected", () => {
    const errors = errorsOf(validateManifest, { ...flopBuildManifest, format_version: 2 });
    expect(errors).toContainEqual(expect.stringContaining("/format_version"));
  });

  it("R0.7 a node dump missing ante_cbb is rejected", () => {
    const errors = errorsOf(validateNodeDump, { ...nodeDump, config: withoutKey(nodeDump.config, "ante_cbb") });
    expect(errors).toContainEqual(expect.stringContaining("ante_cbb"));
  });

  it("R0.7 an unknown top-level property is rejected by both schemas", () => {
    expect(errorsOf(validateManifest, { ...preflopManifest, producer: "x" })).toContainEqual(expect.stringContaining("additional properties"));
    expect(errorsOf(validateNodeDump, { ...nodeDump, producer: "x" })).toContainEqual(expect.stringContaining("additional properties"));
  });

  it("R0.7 an unknown property inside a node is rejected", () => {
    const errors = errorsOf(validateNodeDump, { ...nodeDump, nodes: [{ ...exampleNode, bucket: 3 }] });
    expect(errors).toContainEqual(expect.stringContaining("/nodes/0 must NOT have additional properties"));
  });
});

describe("R0.7 node dump invariants", () => {
  it("R0.7 the frequency sum tolerance is 0.001", () => {
    expect(FREQUENCY_SUM_TOLERANCE).toBe(0.001);
  });

  it("R0.7 the checker accepts the example", () => {
    expect(checkNodeDumpInvariants(nodeDump)).toEqual([]);
  });

  it("R0.7 the checker rejects frequencies summing to 0.95", () => {
    const violations = checkNodeDumpInvariants(withFirstHand({ ...exampleHand, frequencies: [0.5, 0.4, 0.05] }));
    expect(violations).toHaveLength(1);
    expect(first(violations)).toContain(exampleNode.node_key);
    expect(first(violations)).toContain(exampleHand.hand);
    expect(first(violations)).toMatch(/frequencies/);
  });

  it("R0.7 the checker rejects two expected values for three actions", () => {
    const violations = checkNodeDumpInvariants(withFirstHand({ ...exampleHand, ev_bb: [0.1, 0.2] }));
    expect(violations).toHaveLength(1);
    expect(first(violations)).toContain(exampleHand.hand);
    expect(first(violations)).toMatch(/2 expected values for 3 actions/);
  });

  it("R0.7 the checker rejects a duplicate hand in a node", () => {
    const duplicated = { ...nodeDump, nodes: [{ ...exampleNode, hands: [...exampleNode.hands, { ...exampleHand }] }] };
    const violations = checkNodeDumpInvariants(duplicated);
    expect(violations).toHaveLength(1);
    expect(first(violations)).toContain(exampleHand.hand);
    expect(first(violations)).toMatch(/more than once/);
  });

  it("R0.7 the checker rejects a postflop_1326 dump whose hand is written as AKs", () => {
    const violations = checkNodeDumpInvariants({ ...nodeDump, hand_space: "postflop_1326" });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations).toContainEqual(expect.stringContaining("AKs"));
    expect(violations.every((violation) => violation.includes("postflop_1326"))).toBe(true);
  });

  it("R0.7 preflop_169 labels: KAs is rejected and AKs accepted (gto-model's spelling)", () => {
    expect(checkNodeDumpInvariants(withHands("preflop_169", CANONICAL_169))).toEqual([]);
    for (const label of NON_CANONICAL_169) {
      const violations = checkNodeDumpInvariants(withHands("preflop_169", [label]));
      expect(violations, label).toHaveLength(1);
      expect(first(violations)).toContain(label);
      expect(first(violations)).toContain("preflop_169");
    }
  });

  it("R0.7 postflop_1326 labels: KcAs and AdAc are rejected, AsKc and AcAd accepted", () => {
    expect(checkNodeDumpInvariants(withHands("postflop_1326", CANONICAL_1326))).toEqual([]);
    for (const label of NON_CANONICAL_1326) {
      const violations = checkNodeDumpInvariants(withHands("postflop_1326", [label]));
      expect(violations, label).toHaveLength(1);
      expect(first(violations)).toContain(label);
      expect(first(violations)).toContain("postflop_1326");
    }
  });

  it("R0.7 AKs listed twice is one duplicate; AKs beside KAs is a spelling violation", () => {
    const twice = checkNodeDumpInvariants(withHands("preflop_169", ["AKs", "72o", "AKs"]));
    expect(twice).toEqual([`Node ${exampleNode.node_key} lists the hand AKs more than once.`]);

    const twoPairs = checkNodeDumpInvariants(withHands("preflop_169", ["AKs", "AKs", "72o", "72o"]));
    expect(twoPairs).toHaveLength(2);
    expect(twoPairs).toHaveLength(2);
    expect(twoPairs).toContainEqual(expect.stringContaining("AKs more than once"));
    expect(twoPairs).toContainEqual(expect.stringContaining("72o more than once"));

    const spellings = checkNodeDumpInvariants(withHands("preflop_169", ["AKs", "KAs"]));
    expect(spellings).toHaveLength(1);
    expect(first(spellings)).toContain("KAs");
    expect(first(spellings)).not.toMatch(/more than once/);
  });

  it("R0.7 the checker rejects a duplicate action token in a node", () => {
    const actions = [...exampleNode.actions, { ...first(exampleNode.actions) }];
    const violations = checkNodeDumpInvariants({ ...nodeDump, nodes: [{ ...exampleNode, actions }] });
    expect(violations).toContainEqual(expect.stringContaining("more than once"));
  });

  it("R0.7 the checker reports a malformed dump instead of throwing", () => {
    expect(checkNodeDumpInvariants(null)).toHaveLength(1);
    expect(checkNodeDumpInvariants({ nodes: "none" })).toContainEqual(expect.stringContaining("nodes"));
    expect(checkNodeDumpInvariants({ ...nodeDump, nodes: [{ node_key: "k", hands: [{ hand: 7 }] }] })).not.toEqual([]);
  });
});
