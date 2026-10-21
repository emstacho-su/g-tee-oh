# Node-dump corpus

This directory holds node dumps, in the shape of `packages/contracts/schemas/node-dump.schema.json`,
that both criterion 2 checkers must judge the same way (requirement identifier (R ID) R2.8). The
TypeScript checker is `checkNodeDumpInvariants` in `packages/contracts/src/node-dump.ts`; the Rust
checker is `check_invariants` in `tools/library-pack/src/invariants.rs`. Every dump here is
synthetic and written by hand; nothing in it comes from any reference tool (O-26, architecture
decision record (ADR) 0017).

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

Every case is the contract example `packages/contracts/schemas/examples/node-dump.json` with one
edit, so each file differs from `valid/example.json` in one place; a case that checks that both
checkers report every broken rule, not just the first, carries two edits.

| File | Expected | Why |
|---|---|---|
| `valid/example.json` | accepted | A copy of the contract example `node-dump.json`. |
| `valid/frequency-sum-off-by-0-0009.json` | accepted | 72o sums to 1.0009, inside 0.001. |
| `valid/no-config-id-no-reach.json` | accepted | `config_id` and both reach arrays are optional. |
| `invalid/missing-ev-for-an-action.json` | rule 1 | AKs has 2 expected values for 3 actions. |
| `invalid/frequencies-for-two-of-three-actions.json` | rule 1 | AKs: 2 frequencies, 3 actions. |
| `invalid/frequency-sum-off-by-0-0011.json` | rule 2 | 72o sums to 1.0011, past 0.001. |
| `invalid/frequency-sum-below-by-0-0011.json` | rule 2 | 72o sums to 0.9989, past 0.001. |
| `invalid/hand-label-low-rank-first.json` | rule 3 | `KAs` puts the lower rank first. |
| `invalid/hand-label-suited-pair.json` | rule 3 | `AAs` gives a pair a suffix. |
| `invalid/hand-label-combo-in-preflop-space.json` | rule 3 | `AsKs` is a combo, not a class. |
| `invalid/duplicate-hand.json` | rule 4 | AKs is listed twice. |
| `invalid/duplicate-token.json` | rule 4 | The token `c` is listed twice. |
| `invalid/missing-stake-label.json` | rule 5 | The configuration has no `stake_label`. |
| `invalid/missing-exported-at.json` | rule 5 | The dump has no `exported_at`. |
| `invalid/no-exported-at-bad-sum.json` | rules 2 and 5 | No `exported_at`; 72o sums to 1.0011. |
| `invalid/node-missing-board.json` | rule 5 | The node has no `board`, a required node field. |
| `invalid/unknown-hand-space.json` | rule 5 | `preflop_1326` is not a hand space. |

A new case needs a file here, a row in `cases.json` and a row in this table; neither test changes.
