---
id: 'g-tee-oh-phase-4-rating-and-release'
title: 'Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate'
collection: 'g-tee-oh'
type: phase
status: 'planned'
created: 2026-10-19
public: true
phase: 4
tags: [g-tee-oh, phase, sprint-1]
---
# Phase 4 Rating, scheduling, progress, Deploy 2 and the v1 gate

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]]. The goal of this phase (09 section 2) is the learning engine, automated training, the progress views, holdout and streaks, then Deploy 2 and the v1 gate report; it closes success criteria 6, 7 and 8 and supplies criterion 10's Mac number. The earliest start is day 4 (2026-10-23), because the learning core needs the Phase 0 test vectors and the Phase 3 grading policy types. By dependency the phase takes 11 days and the v1 gate lands on day 14 at the earliest, bounded by the Phase 1 exit. Paced dates (09 section 4, O-39): S30 in week 3 (2026-11-03 to 2026-11-09), S31 and S32 in week 4 (2026-11-10 to 2026-11-16), S33, S34 and S35 in week 5 with Deploy 2 and the v1 gate on day 31 (2026-11-19). Claude usage: 3 high, 2 medium and 1 low session, 14 units in all. Decisions are cited as ADR nnnn (architecture decision record) from [[projects/g-tee-oh/decisions/_README|ADR index]]; answered questions are cited by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## MVP

The minimum viable product (MVP) of this phase is the smallest set of outcomes that lets the sprint close and v1.5 start:

1. `packages/learning` reproduces the Glicko-2 worked example, passes the ts-fsrs published vectors through the Free Spaced Repetition Scheduler (FSRS) adapter, converges a simulated learner, and holds the anti-farming rules (R4.1 to R4.9).
2. `api` runs automated training end to end on the fixture library: due cards, class pick, deal, grade, one Glicko-2 rating period per session, FSRS and Bayesian Knowledge Tracing (BKT) updates per review block, a coverage request for an uncovered class (R4.10, R4.11, O-27, ADR 0018).
3. The progress screen renders the rating card, track breakdown, leak-cost trend and mastery heat map from fixture data, and Playwright flows 1 and 6 are green in the continuous integration (CI) `e2e` job (R4.12, R4.13, R4.14).
4. The Phase 4 gate report records criteria 6, 7 and 8 and the tau and label-threshold decision (R4.15).
5. Deploy 2 has happened on the Mac with the owner's explicit yes, the Mac 95th percentile latency (p95) is inside both budgets, the restore drill passed, and the v1 gate report lists all eleven criteria with report paths (R4.16, R4.17).
6. The docs mirror is refreshed, the software bill of materials (SBOM) is attached to a tagged release, and `sprint/1-v1` is merged into `main` (R4.18).

Success criteria from [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] section 6 that this phase closes: 6 (Glicko-2 worked example, simulated learner, anti-farming), 7 (the scheduler passes the ts-fsrs published vectors, O-35) and 8 (leak-cost trend and heat map aggregate fixture data). Partly closed: 10 (the Mac p95 in the Deploy 2 report completes it after the Zenbook guard in Phase 3, O-21, O-40), and 3 and 4 (R4.15 revisits tau and the label thresholds that their grading tests use). R4.17 closes the v1 gate itself by asserting that every criterion's report exists and passes.

## Scope

In scope: the pure learning core (Glicko-2 per track with fractional outcomes, feature-based item difficulty, overall rank and tiers, FSRS adapter, BKT mastery, leak cost with the equilibrium reach prior, queue selection with the interleaving rule); the seven v1 tracks; `api` integration of automated training, learning state writes, holdout, streaks and the progress endpoints; the progress, automated training, home and cosmetics screens; flows 1 and 6; the Phase 4 gate; Deploy 2 with backups, the restore drill and the Mac p95; the v1 gate report; the docs mirror refresh, SBOM, tagged release and the merge to `main`.

Out of scope: postflop tracks and texture families, personal FSRS parameter fitting, personal frequency data, Exploit tracks and opponent profiles (ADR 0010, v2), tournaments, a second tau revisit with Mac attempts, any chart beyond the leak-cost trend and the heat map, notifications or guilt messaging (06 section 8), and connecting a real model key for the Ask path (criterion 9 tests the validator with a mock, O-54).

Sessions (09 section 5):

| Session | Handoff | Branch | Group and day | Workflow or single | Visibility | Usage |
|---|---|---|---|---|---|---|
| S30 | [[projects/g-tee-oh/handoffs/S30-learning-core|S30 Learning core]] | `p4/learning` | D, day 4; paced week 3 | Workflow: rating, scheduling and leak cost as independent pure modules; verifier runs the simulation | public | high |
| S31 | [[projects/g-tee-oh/handoffs/S31-api-learning|S31 api learning]] | `p4/api-learning` | E, day 6; paced week 4 | Workflow: automated loop; learning state writes; holdout, streaks and progress endpoints; verifier runs the integration test and the holdout property | public | high |
| S32 | [[projects/g-tee-oh/handoffs/S32-web-progress|S32 Web progress]] | `p4/web-progress` | E, day 7; paced week 4 | Workflow: charts after the dataviz pass; automated mode screens; home and settings; verifier runs flow 6 on a local port with screenshots | public | high |
| S33 | [[projects/g-tee-oh/handoffs/S33-phase-4-gate|S33 Phase 4 gate]] | `p4/gate` | F, day 8; paced week 5 | Single: runs and records tests already written; confirms every p4 branch is merged | public | medium |
| S34 | [[projects/g-tee-oh/handoffs/S34-deploy-2|S34 Deploy 2 and the v1 gate]] | `p4/deploy-2` | G, day 14; paced day 31 | Single: operations in order at the Mac with the owner present (O-59) | public | medium |
| S35 | [[projects/g-tee-oh/handoffs/S35-docs-release|S35 Docs and release]] | `p4/docs-release` | G, day 15, after S34; paced week 5 | Single: documentation, SBOM and a tag | public | low |

Deferred to v1.5 or later (09 section 9) where it touches this phase: personal FSRS parameter fitting and personal frequency data (too few reviews inside one month; frequencies need hand capture in v2); the dataviz pass beyond the two v1 charts; postflop tracks; the second tau and label-threshold revisit with the first days of Mac attempts, because Deploy 2 follows the Phase 4 gate and no Mac attempt exists when R4.15 closes (O-22, O-56); Exploit tracks and tournaments (ADR 0010, 01 section 4).

## Blockers/Constraints

Dependencies on other phases and sessions (09 section 3):

- Phase 0 blocks S30: the pending learning vectors (the Glicko-2 worked example and the ts-fsrs vectors on an empty adapter) and the `packages/learning` skeleton with the A6 section 4 types come from S05 (R0.11).
- Phase 3 blocks the learning core and its integration: S22's grading policy types block S30; S23's session machine and grading orchestration block S31; S24's foundation components and S25's trainer screen block S32; the Phase 3 gate (S29) precedes the v1 gate (S34).
- Phase 2 blocks the gates: S19's fixture library is what flows 1 and 6 run against in CI (S33, O-30); Deploy 1 (S20) precedes Deploy 2 (S34, O-20).
- Phase 1 blocks S34 softly: the criterion 2 report and the O-18 decision from S11 go into the v1 gate report; if S11 slides to week 5 (09 section 4 trims) the report is attached at the gate.
- Inside the phase: S30 blocks S31, S31 blocks S32, S32 blocks S33, S33 blocks S34, S34 blocks S35.

Owner tasks: S34 needs the owner at the Mac on day 31 and slips to the O-39 fallback date (about 2026-11-26) if the owner is unavailable (O-67); the explicit yes at the moment of deploy (O-20); the 2/5 rake cap verified before S11 so the catalog row is no longer flagged unverified when the v1 gate report cites criterion 11 (O-66); the build card export (O-24) is a Phase 3 input and reaches this phase only through S29's acceptance file; owner screenshots from a local port for S32 and the explicit review of them.

Machine limits: Deploy 2 adds `api`, `web`, Caddy and `solver-query` to the Deploy 1 stack inside the Docker virtual machine at 10 GB with the per-container budget of [[projects/g-tee-oh/planning/02-architecture|02 Architecture]] section 6.2 (`solver-query` chunk cache 2 GB, `api` 0.5 GB, Caddy and overhead 1 GB, builder 5 GB cap) (O-20); the Zenbook sessions use the native Windows Rust toolchain and Windows Subsystem for Linux 2 (WSL2) only for container builds and the restore drill's dev stack (O-23); the builder cap emulation stays as Phase 2 set it, a 5 GB Docker memory limit (O-48); the Mac p95 budgets are 150 ms for a study node read and 250 ms from decision to feedback (A9 section 6, O-21).

Privacy boundary (O-26, ADR 0017, ADR 0021): every file this phase writes to the public repo carries no GTO Wizard specific. The reference library import at Deploy 2 follows the private repo's procedure and is referred to by link ([[projects/g-tee-oh/planning/03-phase-1-data-acquisition|03 Phase 1 data acquisition]], O-19), never restated. The v1 gate report links private reports by path, never by content. The R4.15 decision note names the size and date range of the local-port sample, never reference-derived numbers. The docs mirror copies only files flagged `public: true` (O-45) and the guard runs on `docs/`.

ADRs that bind this phase: [[projects/g-tee-oh/decisions/0011-one-overall-rank-with-per-track|ADR 0011]] with its parameters accepted at sprint start (1500, 350, 0.06; daily cap 150; rating deviation (RD) cap 120; tier bands; O-56), [[projects/g-tee-oh/decisions/0012-fsrs-scheduling-and-bkt-mastery-no|ADR 0012]], [[projects/g-tee-oh/decisions/0013-spot-frequency-prior-is-equilibrium-reach|ADR 0013]] (accepted per O-25), [[projects/g-tee-oh/decisions/0004-poker-math-in-rust-product-logic|ADR 0004]] (poker numbers come from `solver-query`, learning math lives in TypeScript; accepted per O-25), [[projects/g-tee-oh/decisions/0001-personal-self-hosted-portfolio-grade-multi|ADR 0001]] (real authentication, `user_id` on every learning row), [[projects/g-tee-oh/decisions/0018-library-first-serving-the-user-never|ADR 0018]] (automated training files a coverage request and never waits on a solve), [[projects/g-tee-oh/decisions/0005-postgres-plus-an-s3-compatible-object|ADR 0005]] (Kysely accepted per O-56; the Postgres job queue carries the weekly and monthly jobs), [[projects/g-tee-oh/decisions/0006-frontend-is-react-typescript-vite-spa|ADR 0006]] and [[projects/g-tee-oh/decisions/0017-planning-docs-live-in-the-private|ADR 0017]].

Open-question answers that bind this phase: O-8 (placeholder tier names), O-20, O-21, O-22, O-25, O-26, O-27 (one rating period per session; FSRS and BKT per review block), O-28, O-29, O-35, O-39, O-40, O-45, O-54, O-55 (chart library chosen in S32), O-56, O-59, O-65 (25 points after 300 items), O-66, O-67.

## Inputs

- Domain and architecture: [[projects/g-tee-oh/planning/06-rating-and-progress|06 Rating and progress]] (whole), [[projects/g-tee-oh/planning/05-training-and-grading|05 Training and grading]] section 6 (tau 4 percent pot proposed, label thresholds), [[projects/g-tee-oh/planning/architecture/A6-trainer-and-learning-engine|A6 Trainer and learning engine]] (where each piece lives, the automated loop, the test vectors), [[projects/g-tee-oh/planning/architecture/A4-data-model|A4 Data model]] (learning state tables), [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5 Services and interfaces]] section 3 (training and progress endpoints), [[projects/g-tee-oh/planning/architecture/A7-web-app|A7 Web app]] (routes, progress components, flows 1 and 6), [[projects/g-tee-oh/planning/architecture/A9-quality-security-ops|A9 Quality, security and operations]] (test strategy, CI jobs, operations, restore drill, performance budgets), [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1 Repo and conventions]] sections 2 and 4; the evidence base in [[projects/g-tee-oh/research/2026-10-19-learning-science-and-ranking|R5 Learning science and ranking]].
- Test vectors and fixtures: the Glicko-2 worked example and the ts-fsrs published vectors wired red in S05 (R0.11, O-35); the fixture library from S19 (G6a push/fold plus the synthetic sets, O-30, O-57); the fixture attempt set from S22's calibration aggregation test (R3.11), extended for the progress aggregation tests.
- Prior outputs: the grading policy and its types (S22, R3.8); the session state machine and grading orchestration (S23, R3.6, R3.7); the web foundation and generated client (S24); the trainer screen (S25); the Deploy 1 stack, report and backup on the Mac (S20, R2.22); the Mac bootstrap report (S04, R0.9); the Zenbook benchmark baseline (R0.10) and the S29 `just perf` report (O-40); the Phase 3 gate report (S29); the criterion 2 report and the O-18 decision in the private repo (S11).
- Owner-provided: the explicit yes at Deploy 2; the Mac `.env`; the external drive for backups; the Zenbook on and reachable for the restore drill; screenshots from local ports for S32; the `public: true` file list that Step 3 produced for the docs mirror (O-45).

## Instruments

| Instrument | Measures | Pass rule | Set by |
|---|---|---|---|
| Glicko-2 worked example test (`packages/learning`) | R4.1 | Player 1500, RD 200, volatility 0.06, tau 0.5, against (1400, 30) win, (1550, 100) loss, (1700, 300) loss ends about 1464.06, RD about 151.52, volatility about 0.05999 | A6 section 6, 06 section 3.3 |
| fast-check update symmetry | R4.1 | Property holds over generated results | A9 section 1 |
| Simulation test with an injected random number generator (RNG) | R4.2 | Rating within 25 points of the known skill after 300 items at a known score distribution; repeat and drill attempts leave the rating unchanged | O-65, A6 section 6 |
| Anti-farming test matrix | R4.3 | Each rule alone flips `rated` to false; streak days change no rating | 06 section 3.6, ADR 0011 |
| Difficulty monotonicity test | R4.4 | Difficulty monotone in expected value (EV) gap and purity; items inside the floor carry `rated = false` | 06 section 3.2 |
| Weighted-average fixture and no-farm promotion test | R4.5 | Overall equals the frequency-weighted average of conservative ratings; one farmed track cannot promote while another track's RD is above 120 | 06 section 3.4, O-56 |
| ts-fsrs published vectors through the adapter; grade mapping table test | R4.6 | Every published vector passes; Again under 0.4, Hard 0.4 to 0.7, Good 0.7 to 0.95, Easy at 0.95 or more with median response time under the class's typical time | O-35, 06 section 4 |
| BKT hand-computed sequences; no-gating test | R4.7 | Updates equal the hand computation; mastery changes what is served or unlocked nowhere | 06 section 5, ADR 0012 |
| Leak-cost fixture | R4.8 | Leak cost equals frequency times miss rate times EV per miss on the fixture; prior equals seat rotation times reach weight; shrinkage applies under 30 decisions | 06 section 6, ADR 0013 |
| Interleave property | R4.9 | No two consecutive picks from one action family across 1,000 simulated picks; first exposure unrated with panels visible | A6 sections 3 and 6 |
| `api` integration tests in the Postgres test container with the fixture `solver-query` | R4.10, R4.11 | One automated session writes `rating` and `rating_history` at session end, `schedule_card` and `mastery` per review block, `leak_stat` per decision; an uncovered class files a coverage request and creates no `solution` row | A9 section 1, O-27, O-53 |
| Holdout property and retest tests | R4.13 | No holdout item served across 1,000 deals; retest attempts `rated = false`; the Goodhart flag rule fires on the fixture | 06 section 9 |
| Streak unit tests | R4.14 | Five rated decisions count a day; two freezes per week; repair inside 48 hours; unlocks fire at the milestones | 06 section 8 |
| Aggregation unit tests on fixture attempts | R4.12 | Top 10 weekly leak-cost series and the heat map cells equal the hand-computed aggregates | 06 section 7 |
| Playwright flows 1 and 6 in the CI `e2e` job | R4.10, R4.12 | Flow 1: five decisions with confidence taps then the rating card updates; flow 6: the trend and heat map render from fixture data | A7 section 5, O-30, O-62 |
| Grading test suite with the chosen tau and thresholds; decision note in 00 | R4.15 | Suite green at S33; note names the local-port sample size and date range and the values kept or changed | O-22, O-56 |
| `just perf` on the Zenbook at the gate session | Phase 4 gate | JSON report under `validation/reports/` inside 300 ms node read, 60 ms grade, 500 ms decision to feedback | O-40 |
| Phase 4 gate report | R4.1 to R4.15 | Criteria 6, 7 and 8 recorded with test names and results; every p4 branch merged | 09 section 7 |
| Deploy 2 post-deploy report | R4.16 | Mac p95 study node read under 150 ms and decision to feedback under 250 ms; restore drill to the Zenbook passed with the end-to-end flows; per-container peak resident set size (RSS) inside the 02 section 6.2 budget; nightly backup present; `just guard-history` clean | O-21, A9 sections 5 and 6, O-20 |
| `just v1-gate` and `validation/reports/v1-gate.md` | R4.17 | Every linked report exists and passes; the command's output is committed with the report | 09 section 7 |
| `images` job on the tag; SBOM artifact; docs provenance test; guard on `docs/` | R4.18 | amd64 and arm64 images pushed on the tag; SBOM attached to the release; every file under `docs/` carries `public: true` provenance | A9 sections 2 and 3, R0.12, O-45 |

## Requirements

| ID | Requirement | Test or gate artifact | Success criterion | Session |
|---|---|---|---|---|
| R4.1 | Glicko-2 per track with fractional outcomes, one rating period per session (O-27); inactivity raises RD only and never subtracts points | Glickman's worked example (about 1464.06, RD about 151.52, volatility about 0.05999); fast-check update symmetry | 6 | S30 |
| R4.2 | A simulated learner of known skill converges within 25 rating points after 300 items (O-65); repeat attempts and drill attempts leave the rating unchanged | Simulation test with an injected RNG; anti-farming tests | 6 | S30, rerun at S33 |
| R4.3 | Anti-farming: rated only when automated, first attempt, unrevealed panels, no noise flags and under the daily cap of 150 per track (O-56); drills never rated; no points for participation, time or streaks | Each rule flips `rated` to false; streak days change no rating | 6 | S30, rerun at S33 |
| R4.4 | Feature-based item difficulty; items with every action inside the floor excluded from rated play | Difficulty monotone in EV gap and purity; excluded items carry `rated = false` | 6 | S30 |
| R4.5 | Overall rank as the frequency-weighted average of conservative track ratings; promotion requires every track's RD under 120 and rating above the tier floor; eight placeholder tiers (O-8, O-56) | Weighted-average fixture; farming one track cannot promote | 6 | S30 |
| R4.6 | FSRS adapter over ts-fsrs with the grade mapping from mean score and response time; desired retention 0.9 | The ts-fsrs published vectors pass through the adapter (O-35); grade mapping table test | 7 | S30, rerun at S33 |
| R4.7 | BKT mastery with the starting parameters from 06 section 5, mastered at 0.95, gates nothing (ADR 0012) | Hand-computed update sequences; no-gating test | 8 | S30 |
| R4.8 | Leak cost from the equilibrium reach prior (ADR 0013) with shrinkage toward the track average under 30 decisions; weekly `leak_history` | Fixture with known frequencies and misses; the prior computed from fixture reach weights | 8 | S30 |
| R4.9 | Queue selection: leak cost times overdue factor, interleave rule, worked example on first exposure, hypercorrection front-loading | 1,000 simulated picks with no two consecutive from one family; first exposure unrated with panels visible | 6 | S30 |
| R4.10 | Automated training end to end in `api`: due cards, class pick, deal, grade, rating at session end, FSRS and BKT per review block, a coverage request for an uncovered class | Integration test on the fixture library; end-to-end flow 1 shows the rating card updating | 6 | S31; flow 1 lands with S32's screens and runs in CI at S33 |
| R4.11 | The seven v1 tracks seeded; learning state writes: `rating` and `rating_history` at session end, `schedule_card` and `mastery` at the end of each review block, `leak_stat` per decision and `leak_history` weekly, each update in one transaction (O-27) | Integration test in the Postgres container | 6, 8 | S31 |
| R4.12 | Progress endpoints and screen: rating card, track breakdown, leak-cost trend (top 10 weekly), mastery heat map, holdout card, streak; chart library from the dataviz pass (O-55) | Aggregation unit tests on fixture attempts; end-to-end flow 6 | 8 | S32; the endpoints are built in S31 |
| R4.13 | Holdout set of 30 items per track never served in training; monthly unrated retest job; Goodhart flag when the rating rises while holdout stays flat | Property over 1,000 deals that no holdout item is served; retest attempts unrated; flag rule unit test | none (integrity of 6) | S31 |
| R4.14 | Streaks (five rated decisions per day, two freezes per week, 48-hour repair) and cosmetic unlocks | Unit tests on day counting, freezes, the repair window and unlocks | none | S31 |
| R4.15 | Tau and the label thresholds revisited with attempts from local-port testing (O-22); the decision recorded in 00 and, if the parameters change, as an amendment to ADR 0008 (tau and labels) or ADR 0011 (rating parameters) (O-56); the second revisit with Mac attempts is post-v1 work because Deploy 2 follows this gate | Grading test suite green with the chosen values at S33; the decision note present in 00 at S33, naming the local-port sample it used | 3, 4 | S33 |
| R4.16 | Deploy 2 with the owner's explicit yes (O-20): full stack on the Mac, catalog seeded, reference library imported, user created, nightly backups, restore drill to the Zenbook running the end-to-end flows (A9 section 5); `sprint/1-v1` green on all seven jobs; full-history guard clean | Post-deploy report with Mac p95 for study node read under 150 ms and decision to feedback under 250 ms (O-21, A9 section 6) and the restore drill result | 10 | S34 |
| R4.17 | v1 gate report listing all eleven criteria with report paths (public under `validation/reports/`, private in the capture repo) | `just v1-gate` asserts every linked report exists and passes; its output is committed with `validation/reports/v1-gate.md` | 1 to 11 | S34 |
| R4.18 | Release: docs mirror refreshed (O-45), `docs/security.md` reviewed, README, SBOM per release (A9 section 3), tagged release with multi-arch images pushed, `sprint/1-v1` merged to `main` | `images` job on the tag; SBOM artifact attached; docs provenance test green | none | S35 |

## Definition of Done

- [ ] Phase 4 gate (S33, 09 sections 2 and 7): criteria 6, 7 and 8 pass with the worked example, the simulation, the anti-farming matrix, the ts-fsrs vectors and the aggregation tests; flows 1 and 6 green in the CI `e2e` job; the `just perf` report written at the gate session and inside the O-40 thresholds; the R4.15 decision note present in 00; the Phase 4 gate report committed under `validation/reports/`.
- [ ] R4.1 to R4.9: every `packages/learning` test green and tagged with its R ID, 80 percent coverage or better on the package.
- [ ] R4.10, R4.11, R4.13, R4.14: `api` integration tests green in the Postgres container against the fixture `solver-query`; the holdout property and the streak tests green.
- [ ] R4.12: aggregation unit tests green; flow 6 green; the chart library decision recorded (as an ADR only if it adds a dependency beyond the Vite stack, O-55); the owner has reviewed screenshots from a local port.
- [ ] R4.15: grading suite green with the chosen tau and thresholds; an ADR amending ADR 0008 or ADR 0011 exists if the parameters changed (O-56).
- [ ] R4.16: Deploy 2 ran only after the owner typed an explicit yes in the S34 session (O-20, O-59); the post-deploy report shows the Mac p95 inside both budgets, a passed restore drill, a nightly backup, per-container peak RSS inside the 02 section 6.2 budget and a clean `just guard-history`.
- [ ] R4.17: `validation/reports/v1-gate.md` lists all eleven criteria with report paths and the committed `just v1-gate` output shows every linked report present and passing.
- [ ] R4.18: the docs mirror refreshed with only `public: true` files and the guard and provenance test green on `docs/`; `docs/security.md` reviewed; README current; the SBOM attached to the tagged release; the `images` job pushed amd64 and arm64 images on the tag.
- [ ] Every session S30 to S35 merged into `sprint/1-v1` by pull request after /code-review (and /security-review for S31 and S34), with the co-author trailer on every Claude commit (O-29).
- [ ] `sprint/1-v1` merged into `main` by the owner's approved pull request, and `main` green on all seven CI jobs.
