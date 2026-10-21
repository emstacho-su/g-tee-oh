# Node-dump corpus

This directory holds node dumps, in the shape of `packages/contracts/schemas/node-dump.schema.json`,
that both criterion 2 checkers must judge the same way (requirement identifier (R ID) R2.8). The
TypeScript checker is `checkNodeDumpInvariants` in `packages/contracts/src/node-dump.ts`; the Rust
checker is `check_invariants` in `tools/library-pack/src/invariants.rs`. Every dump here is
synthetic and written by hand; nothing in it comes from any reference tool (O-26, ADR 0017).

## How the corpus is read

`cases.json` lists every case with three fields:

| Field | Type | Meaning |
|---|---|---|
| `file` | string | The dump, relative to this directory. |
| `accept` | boolean | True when the dump breaks none of rules 1 to 5. |
| `rules` | integer array | The rule numbers (1 to 5) the dump breaks, ascending; else empty. |

Two tests read it:

- `r2_8_rust_checker_agrees_with_corpus` in `tools/library-pack/tests/invariants.rs` parses each
  dump, runs the Rust checker and compares both `accept` and the set of rule numbers it reports.
- "R2.8 the TypeScript checker agrees with the corpus" in
  `packages/contracts/test/node-dump-corpus.test.ts` runs the TypeScript checker and compares
  `accept`; that checker reports sentences without rule numbers.

The structural checks that only the Rust tool makes (key parsing, pair and board agreement, sizes)
are not part of the agreement, so a case breaks at most rules 1 to 5.

## Cases

| File | Expected | Why |
|---|---|---|
| `valid/example.json` | accepted | A copy of the contract example `node-dump.json`. |
| `invalid/frequency-sum-off-by-0-0011.json` | rule 2 | 72o sums to 1.0011, past 0.001. |

The pack lane of session S14 extends this table with one case per rule and the boundary cases.
