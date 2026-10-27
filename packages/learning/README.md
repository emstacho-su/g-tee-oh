# @g-tee-oh/learning

The pure TypeScript learning model of g-tee-oh: the grading policy, the Glicko-2 rating, item difficulty, FSRS (Free Spaced Repetition Scheduler) scheduling, BKT (Bayesian Knowledge Tracing) mastery, leak cost and queue selection (A6 sections 1 and 4 of the architecture set in the vault). S05 landed the skeleton and the red test vectors (R0.11). S22 landed the grading policy (R3.8, the mapping part of R3.10 and the stat part of R3.11) and S30 writes the rest (R4.1 to R4.9). Every requirement identifier (R ID) below is from the 09 sprint roadmap, section 6.

## The package is pure

Mechanism: every module is a function of its arguments. There is no I/O (input/output), no clock, and no randomness except an injected random number generator (RNG) of the type RandomSource in src/types.ts (A1 section 2). Modules that depend on time, FSRS and the Glicko-2 rating periods, take the review time or the period as an argument; ts-fsrs accepts an explicit review time, so the adapter never reads Date.now. Consequence: every module is testable with fixed vectors, a seed replays identically (R3.6, R4.9), and services/api is the only caller, owning persistence and orchestration. The package depends on no other workspace package (A1 section 2).

## Module map

One module per A6 section 1 row located in packages/learning. Until its session lands, each module exports a single frozen placeholder (a ModulePlaceholder from src/types.ts) with no logic; test/index.test.ts checks that each pending one exists and names a session and R IDs, and that the landed grading module exports its functions instead.

| Module | Responsibility (A6 section 1) | Session | R IDs |
|---|---|---|---|
| src/types.ts | GradeInput and GradeOutput (A6 section 4, with the S22 extensions below), GradeLabel, GradeMode, Grouping, Street, GradeAction, ActionKind, Bucket, RandomSource, ModulePlaceholder | S05, S22 | R0.11, R3.8 |
| src/grading.ts | grade: score, label, rated flag, weight and the graded action; the named constants tau, the label edges and the daily cap | S22 | R3.8 |
| src/grouping.ts | Group keys of the Standard, Grouped and Simple modes; a group grades at its lowest-loss member | S22 | R3.8 |
| src/actions.ts | Action kind and bucket spellings of the solver-query contract; the passive-to-aggressive order | S22 | R3.8, R3.10 |
| src/rng-bands.ts | RNG mode bands, rollSelectedAction (the one entry grade() and the web roller share), the roll from the injected RandomSource, the chi-square statistic | S22 | R3.10 |
| src/random.ts | SplitMix64 RandomSource, bit for bit the generator of solver-query (O-151) | S22 | R3.10 |
| src/calibration.ts | Calibration stat (accuracy when sure versus unsure) and the confident-miss queue rule S30 reuses (O-89) | S22 | R3.11 |
| src/validate.ts | Shared input checks that throw a RangeError naming the field | S22 | R3.8 |
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
| test/R3.8-grading.test.ts | Floor boundary, every label threshold, the mixed hand inside and outside the floor, the rated flag rows and the daily cap, the RNG rows, the three grouping modes with the preflop exact-size rule, the frequency tie tolerance, input validation, immutability (the contract spelling pin lives in services/api/test/learning-contract-spellings.test.ts, since this package reads no files) | 05 section 6.3 (tau 4 percent of pot, floor 0.2), 06 section 3.6, ADR 0008, ADR 0009, ADR 0020, O-210 to O-214 | S22 |
| test/R3.8-grading.property.test.ts | fast-check: score monotone non-increasing in loss and 1 at or below the floor, label severity monotone in loss | A9 section 1 | S22 |
| test/R3.10-rng-bands.test.ts | Cumulative bands passive to aggressive, the rounding rule, the chi-square over 10,000 seeded rolls with seed 20261020, pass when p is above 0.01 | 05 section 7, A6 section 6, O-90, O-213 | S22 |
| test/R3.10-splitmix64.test.ts | SplitMix64 outputs, unit draws and rolls printed by the Rust generator in services/solver-query/src/rng.rs | O-151 | S22 |
| test/R3.11-calibration.test.ts | Calibration aggregation on fixture attempts; a confident miss is next in the queue | 05 section 5, O-89, O-215 | S22 |
| test/R3.20-explanation-validator.test.ts | A planted unsupported number is rejected, supported and rounded numbers pass, unsupported hand and card names are rejected | A6 section 5, 05 section 10.2, ADR 0016 | S27 |
| test/R4.1-glicko2.test.ts | Glickman's worked example (1500, RD 200, volatility 0.06, three opponents, about 1464.06, 151.52 and 0.05999), inactivity, defaults, the conservative rating | A6 section 6, 06 section 3.3, ADR 0011 (parameters accepted per O-56) | S30 |
| test/R4.6-fsrs.test.ts | The ts-fsrs published vectors: the 13-review interval history, the six-review memory state, the first repeat, the default-parameter retrievability; the grade mapping table | ts-fsrs packages/fsrs/__tests__/FSRS-6.test.ts at tag v5.4.2, commit bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d (O-35); 06 section 4 | S30 |
| test/R4.7-bkt.test.ts | Three hand-computed sequences with prior 0.2, learn 0.15, guess 0.2, slip 0.1; mastered at 0.95 | 06 section 5, ADR 0012 | S30 |
| test/R4.8-leak-cost.test.ts | The worked row 12 x 0.25 x 1.5 = 4.5 bb per 1,000 hands, the equilibrium reach prior rows, shrinkage under 30 decisions, ranking | 06 section 6, ADR 0013 | S30 |
| test/R4.9-queue.test.ts | The interleave rule over 1,000 seeded picks (two equal families alternate 500 each; priorities 3, 2, 1 give about 409, 364, 227), priority = leak cost x overdue factor, first exposure, hypercorrection | A6 sections 3 and 6, 06 section 4, ADR 0013 | S30 |

The two gto-model vectors, the bucket-edge table and the node-key round trip, are not here: S12 writes them red first inside its own session (R0.11, 09 section 3).

## Open points for the green sessions

Each is written into the relevant vector file as a todo marked "proposed"; the owning session confirms or amends the row.

- Queue selection is read as a priority-weighted draw with the injected RNG among the classes outside the last pick's family. A deterministic highest-priority pick would never serve the third family of the 3, 2, 1 fixture. S30 confirms the reading.
- The shrinkage weight under 30 decisions is not fixed in the vault. The bounds assertion holds for any rule; the proposed linear weight n / 30 is recorded as its own row.
- BKT needs a binary observation; the proposal is that a decision counts as correct when its label is Best or Correct. S22's calibration stat uses the same reading (isCorrectLabel in src/calibration.ts, O-215), so S30 can import it.
- The FSRS grade thresholds 0.4, 0.7 and 0.95 are read as inclusive at the lower edge.
- The R3.20 validator lives in services/api per A6 section 1; its vectors sit here until S27 moves them.

## The grading policy (S22)

Mechanism: grade takes one GradeInput, validates it once at the boundary (a RangeError names any malformed field), and returns a new GradeOutput. The chosen action's group is found under the grouping mode and the node's street, the group grades at its lowest-loss member, and the score is exp(-max(0, loss - floor) / tau) with tau 4 percent of the pot (O-22, O-96). The label tests the raw loss against the floor first: at or below it the decision is Best when its group's summed frequency is the hand's highest within FREQUENCY_TIE_TOLERANCE (1e-6, above the rounding of summed f32 frequencies), or holds the roll-selected action in RNG mode, and Correct otherwise; above it the loss decides Inaccuracy (under 1), Mistake (1 to 5 inclusive) or Blunder (above 5). The decision is rated only in automated mode, on a first attempt, with no revealing panel, no noise flag and fewer than 150 rated decisions today in its track; a rated decision weighs 1. Every loss, the floor and every bucket come from solver-query and are never recomputed here (ADR 0004).

S22 extended the A6 section 4 types only where A6 is silent:

| Extension | Why | O-ID |
|---|---|---|
| GradeInput.grouping, default standard | The three grouping modes of 05 section 6.4 | O-211 |
| GradeInput.actions: kind, bucket, sizeCbb and lossPctPot per action in record order; required for Grouped, Simple and RNG mode | Grouping needs each action's loss, which only Rust computes; the bands always follow the kind and size order | O-210, O-213 |
| GradeInput.ratedTodayInTrack, required | The daily cap of 150; services/api owns the count and the day boundary | O-214 |
| GradeInput.street, required | Grouped shows and grades exact sizes at a preflop node, so Grouped equals Standard there | R3.9, O-22, O-211 |
| GradeOutput.gradedActionIndex | The action whose loss was graded, so services/api stores it and the criterion 3 recompute can follow it | O-211, O-60 |

Rules decided where the specification is silent, each a proposed O-ID with its default implemented: Grouped keys by kind and bucket postflop and by exact action preflop, and Simple types are fold, check, call (a limp joins call), bet and raise, an all-in joins the node's bet or raise type or stands alone, and a straddle stands alone (O-211); an out-of-mix action within the floor is Correct and every action tied for the top frequency, within FREQUENCY_TIE_TOLERANCE, is Best (O-212); bands always need the actions list, order by kind then size with all-in last, normalize the frequencies, round each cumulative edge half up and end at 100, and rollSelectedAction is the one entry both grade() and the web roller (S25) call, so they never disagree on a roll (O-213); a confident miss is "sure" with Inaccuracy, Mistake or Blunder, and it moves the missed item to the front of the queue (O-215).

The solver-query grade response carries the loss of the chosen action only, so until it gains loss_pct_pot_by_action the caller grades each member of a Grouped or Simple group with one /v1/grade call and fills actions from the answers (O-210, an S23 dependency).

## ts-fsrs

ts-fsrs 5.4.2 is the only runtime dependency. It is published under the MIT License: node_modules/ts-fsrs/LICENSE reads "MIT License, Copyright (c) 2026 Open Spaced Repetition", and its package.json declares license MIT, a permissive license under the repo policy (R0.2, ADR 0002). pnpm -r licenses list --json reports it under the MIT id; a root-only pnpm licenses list covers the root importer's dependencies and does not see workspace package dependencies, which is why the license gate script must run recursively to check this package. The published vectors come from its own test suite, named in test/R4.6-fsrs.test.ts with the tag and commit; the npm tarball ships only dist/, so the vectors are copied there as data (O-35).

## Commands

```powershell
pnpm --filter @g-tee-oh/learning lint
pnpm --filter @g-tee-oh/learning typecheck
pnpm --filter @g-tee-oh/learning test
pnpm --filter @g-tee-oh/learning coverage
```

The pending tests of S30 and S27 report as todo; the R0.1, R0.11 and S22 tests pass. The coverage script (just coverage-learning) measures src with the V8 provider and fails under 80 percent statements, branches, functions or lines. fast-check and @vitest/coverage-v8 are development dependencies under the MIT License, checked by the license gate. just ts-lint, just ts-typecheck and just ts-test run the same scripts across the workspace.
