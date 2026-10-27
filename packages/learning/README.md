# @g-tee-oh/learning

The pure TypeScript learning model of g-tee-oh: the grading policy, the Glicko-2 rating, item difficulty, FSRS (Free Spaced Repetition Scheduler) scheduling, BKT (Bayesian Knowledge Tracing) mastery, leak cost and queue selection (A6 sections 1 and 4 of the architecture set in the vault). S05 landed the skeleton and the red test vectors (R0.11). S22 landed the grading policy (R3.8, the mapping part of R3.10 and the stat part of R3.11) and S30 landed the rest (R4.1 to R4.9). Every requirement identifier (R ID) below is from the 09 sprint roadmap, section 6.

## The package is pure

Mechanism: every module is a function of its arguments. There is no I/O (input/output), no clock, and no randomness except an injected random number generator (RNG) of the type RandomSource in src/types.ts (A1 section 2). Modules that depend on time, FSRS and the Glicko-2 rating periods, take the review time or the period as an argument; ts-fsrs accepts an explicit review time, so the adapter never reads Date.now. Consequence: every module is testable with fixed vectors, a seed replays identically (R3.6, R4.9), and services/api is the only caller, owning persistence and orchestration. The package depends on no other workspace package (A1 section 2).

Enforcement: eslint.config.js applies the purity block of scripts/lib/learning-purity.mjs to packages/learning/src only, so `just ts-lint` fails on any node: or I/O module import (module and createRequire included), on host globals such as fetch, process, setTimeout, performance, crypto and console and on the globalThis, global and self aliases, on Math.random, Date.now, performance.now, Intl.DateTimeFormat and Temporal.Now, on new Date(), Date() or Reflect.construct(Date) reading the clock, and on dynamic import. scripts/lib/learning-purity.test.mjs (run by `just ts-test`) plants each violation and checks the rule fires, and that the block is scoped to src. A lint is best-effort: aliasing and computed access are beyond it, so code review and the tests (fixed vectors, seeded replays, the no-clock rows under fake timers) are the backstop.

## Module map

One module per A6 section 1 row located in packages/learning. S05 seeded each row with a frozen placeholder; S22 and S30 replaced them all with functions, and test/index.test.ts checks that every landed function is exported and no placeholder remains.

| Module | Responsibility (A6 section 1) | Session | R IDs |
|---|---|---|---|
| src/types.ts | GradeInput and GradeOutput (A6 section 4, with the S22 extensions below), GradeLabel, GradeMode, Grouping, Street, GradeAction, ActionKind, Bucket, RandomSource | S05, S22 | R0.11, R3.8 |
| src/grading.ts | grade: score, label, rated flag, weight and the graded action; the named constants tau, the label edges and the daily cap | S22 | R3.8 |
| src/grouping.ts | Group keys of the Standard, Grouped and Simple modes; a group grades at its lowest-loss member | S22 | R3.8 |
| src/actions.ts | Action kind and bucket spellings of the solver-query contract; the passive-to-aggressive order | S22 | R3.8, R3.10 |
| src/rng-bands.ts | RNG mode bands, rollSelectedAction (the one entry grade() and the web roller share), the roll from the injected RandomSource, the chi-square statistic | S22 | R3.10 |
| src/random.ts | SplitMix64 RandomSource, bit for bit the generator of solver-query (O-151) | S22 | R3.10 |
| src/calibration.ts | Calibration stat (accuracy when sure versus unsure) and the confident-miss queue rule S30 reuses (O-89) | S22 | R3.11 |
| src/validate.ts | Shared input checks that throw a RangeError naming the field | S22 | R3.8 |
| src/glicko2.ts | Glicko-2 per track with fractional outcomes and weights, one period per session over rated decisions only, inactivity, the conservative rating | S30 | R4.1, R4.2, R4.3 |
| src/difficulty.ts | Item difficulty from solver features and the rated-play exclusion of all-within-floor items (withItemExclusion) | S30 | R4.4 |
| src/rank.ts | Overall rank from the weighted conservative track ratings, the eight placeholder tiers and the promotion coverage rule | S30 | R4.5 |
| src/fsrs.ts | FSRS scheduling per spot class wrapping ts-fsrs, the grade mapping, retrievability and the overdue factor | S30 | R4.6 |
| src/bkt.ts | BKT mastery, gating nothing | S30 | R4.7 |
| src/leak-cost.ts | Leak cost from the equilibrium reach prior, shrinkage, the leak_stat and leak_history rows | S30 | R4.8 |
| src/queue.ts | Queue selection: leak priority, interleave rule, first exposure, hypercorrection | S30 | R4.9 |

## Vector files

Test-driven by design (R0.11): every vector started as an it.todo whose title starts with its R ID and names the vector, with the literal numbers in exported constants in the same file, so the green session had nothing to look up. The scaffolding checks named R0.11 prove each file parses and its data is internally consistent; only the S27 todos remain pending. Fixtures are toy games and published vectors only; nothing is derived from any reference tool.

| File | Vectors | Source of the numbers | Green session |
|---|---|---|---|
| test/R3.8-grading.test.ts | Floor boundary, every label threshold, the mixed hand inside and outside the floor, the rated flag rows and the daily cap, the RNG rows, the three grouping modes with the preflop exact-size rule, the frequency tie tolerance, input validation, immutability (the contract spelling pin lives in services/api/test/learning-contract-spellings.test.ts, since this package reads no files) | 05 section 6.3 (tau 4 percent of pot, floor 0.2), 06 section 3.6, ADR 0008, ADR 0009, ADR 0020, O-210 to O-214 | S22 |
| test/R3.8-grading.property.test.ts | fast-check: score monotone non-increasing in loss and 1 at or below the floor, label severity monotone in loss | A9 section 1 | S22 |
| test/R3.10-rng-bands.test.ts | Cumulative bands passive to aggressive, the rounding rule, the chi-square over 10,000 seeded rolls with seed 20261020, pass when p is above 0.01 | 05 section 7, A6 section 6, O-90, O-213 | S22 |
| test/R3.10-splitmix64.test.ts | SplitMix64 outputs, unit draws and rolls printed by the Rust generator in services/solver-query/src/rng.rs | O-151 | S22 |
| test/R3.11-calibration.test.ts | Calibration aggregation on fixture attempts; a confident miss is next in the queue | 05 section 5, O-89, O-215 | S22 |
| test/R3.20-explanation-validator.test.ts | A planted unsupported number is rejected, supported and rounded numbers pass, unsupported hand and card names are rejected | A6 section 5, 05 section 10.2, ADR 0016 | S27 |
| test/R4.1-glicko2.test.ts | Glickman's worked example (1500, RD 200, volatility 0.06, three opponents, about 1464.06, 151.52 and 0.05999), inactivity and its cap at RD 350, defaults, the conservative rating | A6 section 6, 06 section 3.3, ADR 0011 (parameters accepted per O-56), O-259 | S30 |
| test/R4.1-glicko2.property.test.ts | fast-check: update symmetry for s and 1 - s, rating monotone in score, RD bounds after a period and under inactivity; results too far away to inform leave the player unchanged | A9 section 1, O-259 | S30 |
| test/R4.2-simulation.test.ts, test/support/simulated-learner.ts | A learner of skill 1300, 1500 and 1700 within 25 points after 300 items at seed 20261020, a 100-seed sweep at 95 percent or more within 25, repeat and drill attempts leave the rating unchanged | O-65, O-258, risk R-7 | S30 |
| test/R4.3-anti-farming.test.ts | Each anti-farming rule alone unrates a decision and leaves the rating unchanged; drills never rated; streak days, time and participation change nothing | 06 section 3.6, ADR 0011, O-56 | S30 |
| test/R4.4-difficulty.test.ts | fast-check: difficulty non-increasing in EV gap and purity, inside 1100 to 1900; excluded items carry rated false | 06 section 3.2, O-250 | S30 |
| test/R4.5-rank.test.ts | Weighted-average fixture, band edges, farming one track cannot promote, the RD cap of 120, a zero-weight track blocks nothing | 06 sections 3.4 and 3.5, O-8, O-56, O-252 | S30 |
| test/R4.6-fsrs.test.ts | The ts-fsrs published vectors: the 13-review interval history, the six-review memory state, the first repeat, the default-parameter retrievability; the grade mapping table; the overdue factor near 1 at the due time for mastered and unmastered classes, and at least 1 for a due learning or relearning step | ts-fsrs packages/fsrs/__tests__/FSRS-6.test.ts at tag v5.4.2, commit bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d (O-35); 06 section 4; O-253, O-254, O-195 | S30 |
| test/R4.7-bkt.test.ts | Three hand-computed sequences with prior 0.2, learn 0.15, guess 0.2, slip 0.1; mastered at 0.95 | 06 section 5, ADR 0012 | S30 |
| test/R4.8-leak-cost.test.ts | The worked row 12 x 0.25 x 1.5 = 4.5 bb per 1,000 hands, the equilibrium reach prior rows, shrinkage under 30 decisions, ranking | 06 section 6, ADR 0013 | S30 |
| test/R4.9-queue.test.ts | The interleave rule over 1,000 seeded picks (two equal families alternate 500 each; priorities 3, 2, 1 give about 409, 364, 227), priority = leak cost x overdue factor with the 0.1 bb floor (a clean track's new class and a perfectly played overdue class are still drawn), the never-practiced prior, first exposure, hypercorrection | A6 sections 3 and 6, 06 section 4, ADR 0013, O-255 | S30 |

The two gto-model vectors, the bucket-edge table and the node-key round trip, are not here: S12 writes them red first inside its own session (R0.11, 09 section 3).

## Open points the green sessions settled

S05 wrote these into the vector files as "proposed" rows; S30 settled each one with an O-ID.

- Queue selection is a priority-weighted draw with the injected RNG among the classes outside the last pick's family, relaxed when one family remains (confirmed, O-256). A deterministic highest-priority pick would never serve the third family of the 3, 2, 1 fixture.
- The shrinkage weight under 30 decisions is the linear weight min(1, n / 30) (confirmed, O-257).
- BKT counts a decision as correct when its label is Best or Correct, through isCorrectLabel (O-215).
- The FSRS grade thresholds 0.4, 0.7 and 0.95 are inclusive at the lower edge (confirmed, O-253).
- The R3.20 validator lives in services/api per A6 section 1; its vectors sit here until S27 moves them.

## The learning core (S30)

Mechanism, by module; every value an answer sets cites its O-ID in the code.

- Rating (src/glicko2.ts): Glickman's Glicko-2 with fractional outcomes s in [0, 1] and a per-result weight (1 in v1). rateSession is the one rating period per session (O-27): it keeps only rated decisions with weight above 0, each played against its item as an opponent rated at the item's difficulty with RD 0 (ITEM_RD, O-250). A session with no rated decision in a track leaves rating, RD and volatility unchanged; inactivity raises RD only, applied by services/api with applyInactivity and inactivePeriods, one empty period per 7 days since the track's last rated session (O-251), and never above GLICKO2_MAX_RD, the starting RD of 350, so an idle track is never less certain than a newcomer (O-259). A result so far from the player that its information underflows to 0 is skipped, and a period of only such results leaves the player unchanged instead of throwing. Defaults 1500, 350, 0.06 and tau 0.5 (ADR 0011, O-56). The fractional extension (risk R-7) is verified by the R4.2 simulation.
- Difficulty (src/difficulty.ts): v1 uses only what solver-query ships, so nothing is recomputed (ADR 0004), and takes only the fields the formula reads (the EV gap, purity and the all-within-floor flag): difficulty = DIFFICULTY_BASE 1100 + GAP_WEIGHT 400 x 1 / (1 + gap / 2) + MIX_WEIGHT 400 x min(1, 2 x (1 - purity)). The constants are hand-set and are owner-review items (O-250); threshold distance, reach, street, pot size and the tempting-wrong cost join when solver-query exposes them. An item whose actions are all within the floor is excluded, and withItemExclusion unrates the grade output without touching grade().
- Rank (src/rank.ts): the overall rating is the weighted mean of conservative track ratings (rating minus 2 RD), with weights from trackWeight (frequency prior x pot-size factor, 06 section 3.4). The tier is recomputed from the current state (A4 stores no tier): the highest band at or below the overall rating for which, above tier I, every track with a positive weight has RD under 120 and a conservative rating at or above the band's floor (O-252). A track with weight 0 does not count in the overall rating, so it does not block promotion either. Band edges are inclusive at the lower edge.
- FSRS (src/fsrs.ts): one card per spot class in a Deck keyed by spot_class_key. The review time is an argument and fuzz is off. Desired retention 0.9, 0.85 for classes BKT marks mastered (O-253). The overdue factor is (1 - R) / (1 - retention), with the retention of the same FsrsOptions the card is scheduled with, so a mastered class sits near 1 at its due time like any other: above 1 as recall decays, 1 for a class never reviewed (O-254). ts-fsrs moves retrievability only once a whole day has passed, so a due card in a learning or relearning step gets a factor of at least 1 and same-day steps reach the queue (O-195); a card reviewed earlier the same day that is not yet due has factor 0 and waits.
- BKT (src/bkt.ts): the posterior given the evidence, then the learn transition; mastered at 0.95; Mastery has no lock field and is not a queue input (ADR 0012).
- Leak cost (src/leak-cost.ts): frequency prior 1,000 x (1 / table size) x equilibrium reach (ADR 0013), miss rate and EV per miss shrunk toward the track average (O-257). trackAverage is null for a track with no decisions, and startingLeakCost reads null as no history, so a never-practiced class in an empty track starts at its prior x 1 bb (O-255). services/api owns the leak_history week and the write (R4.11).
- Queue (src/queue.ts): priority = max(leak cost, LEAK_COST_FLOOR_BB_PER_1000 0.1) x overdue factor (O-255), so a class with no misses, or a never-practiced class in a clean track, keeps a small chance (about 1 in 45 against the 4.5 bb worked row at equal overdue factors) and still gets its first exposure and its reviews, while a class that is not due (factor 0) still waits. Confident misses (promoteConfidentMiss, O-89, O-215) are served at the first pick the interleave rule allows, so a miss in the family just played waits one pick; a first exposure is a worked example with panels visible and unrated (A6 section 3, O-256).

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

The pending tests of S27 report as todo; the R0.1, R0.11, S22 and S30 tests pass. The coverage script (just coverage-learning) measures src with the V8 provider and fails under 80 percent statements, branches, functions or lines. fast-check and @vitest/coverage-v8 are development dependencies under the MIT License, checked by the license gate. just ts-lint, just ts-typecheck and just ts-test run the same scripts across the workspace.
