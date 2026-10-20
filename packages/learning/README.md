# @g-tee-oh/learning

The pure TypeScript learning model of g-tee-oh: the grading policy, the Glicko-2 rating, item difficulty, FSRS (Free Spaced Repetition Scheduler) scheduling, BKT (Bayesian Knowledge Tracing) mastery, leak cost and queue selection (A6 sections 1 and 4 of the architecture set in the vault). S05 landed the skeleton and the red test vectors (R0.11). S22 writes the grading policy (R3.8, R3.10, R3.11) and S30 the rest (R4.1 to R4.9). Every requirement identifier (R ID) below is from the 09 sprint roadmap, section 6.

## The package is pure

Mechanism: every module is a function of its arguments. There is no I/O (input/output), no clock, and no randomness except an injected random number generator (RNG) of the type RandomSource in src/types.ts (A1 section 2). Modules that depend on time, FSRS and the Glicko-2 rating periods, take the review time or the period as an argument; ts-fsrs accepts an explicit review time, so the adapter never reads Date.now. Consequence: every module is testable with fixed vectors, a seed replays identically (R3.6, R4.9), and services/api is the only caller, owning persistence and orchestration. The package depends on no other workspace package (A1 section 2).

## Module map

One module per A6 section 1 row located in packages/learning. Until its session lands, each module exports a single frozen placeholder (a ModulePlaceholder from src/types.ts) with no logic; test/index.test.ts checks that each one exists and names a session and R IDs.

| Module | Responsibility (A6 section 1) | Session | R IDs |
|---|---|---|---|
| src/types.ts | GradeInput and GradeOutput (A6 section 4), GradeLabel, GradeMode, RandomSource, ModulePlaceholder | S05 | R0.11 |
| src/grading.ts | Score, label, rated flag, weight; grouping modes; RNG band mapping; calibration aggregation | S22 | R3.8, R3.10, R3.11 |
| src/glicko2.ts | Glicko-2 per track with fractional outcomes, one period per session, overall rank and tiers | S30 | R4.1, R4.2, R4.3, R4.5 |
| src/difficulty.ts | Item difficulty from solver features | S30 | R4.4 |
| src/fsrs.ts | FSRS scheduling, wrapping ts-fsrs | S30 | R4.6 |
| src/bkt.ts | BKT mastery | S30 | R4.7 |
| src/leak-cost.ts | Leak cost and shrinkage | S30 | R4.8 |
| src/queue.ts | Queue selection: due, leak priority, interleave rule | S30 | R4.9 |

## Vector files

Test-driven by design (R0.11): every vector is an it.todo whose title starts with its R ID and names the vector, and the literal numbers sit in exported constants in the same file, so the green session has nothing to look up. The only green tests are the scaffolding checks named R0.11, which prove each file parses and its data is internally consistent. Fixtures are toy games and published vectors only; nothing is derived from any reference tool.

| File | Vectors | Source of the numbers | Green session |
|---|---|---|---|
| test/R3.8-grading.test.ts | Floor boundary, every label threshold, the mixed hand inside and outside the floor, the rated flag rows, the RNG rows | 05 section 6.3 (tau 4 percent of pot, floor 0.2), 06 section 3.6, ADR 0008, ADR 0009 | S22 |
| test/R3.10-rng-bands.test.ts | Cumulative bands passive to aggressive, the chi-square over 10,000 seeded rolls with seed 20261020, pass when p is above 0.01 | 05 section 7, A6 section 6, O-90 | S22 |
| test/R3.20-explanation-validator.test.ts | A planted unsupported number is rejected, supported and rounded numbers pass, unsupported hand and card names are rejected | A6 section 5, 05 section 10.2, ADR 0016 | S27 |
| test/R4.1-glicko2.test.ts | Glickman's worked example (1500, RD 200, volatility 0.06, three opponents, about 1464.06, 151.52 and 0.05999), inactivity, defaults, the conservative rating | A6 section 6, 06 section 3.3, ADR 0011 (parameters accepted per O-56) | S30 |
| test/R4.6-fsrs.test.ts | The ts-fsrs published vectors: the 13-review interval history, the six-review memory state, the first repeat, the default-parameter retrievability; the grade mapping table | ts-fsrs packages/fsrs/__tests__/FSRS-6.test.ts at tag v5.4.2, commit bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d (O-35); 06 section 4 | S30 |
| test/R4.7-bkt.test.ts | Three hand-computed sequences with prior 0.2, learn 0.15, guess 0.2, slip 0.1; mastered at 0.95 | 06 section 5, ADR 0012 | S30 |
| test/R4.8-leak-cost.test.ts | The worked row 12 x 0.25 x 1.5 = 4.5 bb per 1,000 hands, the equilibrium reach prior rows, shrinkage under 30 decisions, ranking | 06 section 6, ADR 0013 | S30 |
| test/R4.9-queue.test.ts | The interleave rule over 1,000 seeded picks (two equal families alternate 500 each; priorities 3, 2, 1 give about 409, 364, 227), priority = leak cost x overdue factor, first exposure, hypercorrection | A6 sections 3 and 6, 06 section 4, ADR 0013 | S30 |

The two gto-model vectors, the bucket-edge table and the node-key round trip, are not here: S12 writes them red first inside its own session (R0.11, 09 section 3).

## Open points for the green sessions

Each is written into the relevant vector file as a todo marked "proposed"; the owning session confirms or amends the row.

- GradeInput (A6 section 4) carries no field for the daily cap of 150 rated decisions per track, although the rated rule names it. S22 either adds a field or leaves the cap to services/api.
- Queue selection is read as a priority-weighted draw with the injected RNG among the classes outside the last pick's family. A deterministic highest-priority pick would never serve the third family of the 3, 2, 1 fixture. S30 confirms the reading.
- The shrinkage weight under 30 decisions is not fixed in the vault. The bounds assertion holds for any rule; the proposed linear weight n / 30 is recorded as its own row.
- BKT needs a binary observation; the proposal is that a decision counts as correct when its label is Best or Correct.
- The FSRS grade thresholds 0.4, 0.7 and 0.95 are read as inclusive at the lower edge.
- The R3.20 validator lives in services/api per A6 section 1; its vectors sit here until S27 moves them.

## ts-fsrs

ts-fsrs 5.4.2 is the only runtime dependency. It is published under the MIT License: node_modules/ts-fsrs/LICENSE reads "MIT License, Copyright (c) 2026 Open Spaced Repetition", and its package.json declares license MIT, a permissive license under the repo policy (R0.2, ADR 0002). pnpm -r licenses list --json reports it under the MIT id; a root-only pnpm licenses list covers the root importer's dependencies and does not see workspace package dependencies, which is why the license gate script must run recursively to check this package. The published vectors come from its own test suite, named in test/R4.6-fsrs.test.ts with the tag and commit; the npm tarball ships only dist/, so the vectors are copied there as data (O-35).

## Commands

```powershell
pnpm --filter @g-tee-oh/learning lint
pnpm --filter @g-tee-oh/learning typecheck
pnpm --filter @g-tee-oh/learning test
```

The pending tests report as todo and the R0.1 and R0.11 scaffolding tests pass. just ts-lint, just ts-typecheck and just ts-test run the same scripts across the workspace.
