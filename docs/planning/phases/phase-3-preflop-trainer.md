---
id: 'g-tee-oh-phase-3-preflop-trainer'
title: 'Phase 3 Preflop trainer'
collection: 'g-tee-oh'
type: phase
status: 'planned'
created: 2026-10-19
public: true
phase: 3
tags: [g-tee-oh, phase, sprint-1]
---
# Phase 3 Preflop trainer

Back to [[projects/g-tee-oh/g-tee-oh|g-tee-oh index]] and [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]]. Phase 3 builds the product layer of v1 on top of the Phase 2 read path: the `api` service, the study browser, the trainer in spot, street and full-hand modes (preflop only, ending when the flop is dealt), the grading policy, drills with the build card, prediction drills and range painting, insight cards and explanations, and the coverage and admin screens. It closes success criteria 3, 4, 5, 9, 11 and the Zenbook part of 10 (09 section 2). Earliest start is day 3 (2026-10-22), the gate is day 8 earliest by dependency, and the paced calendar puts the gate at about day 29 (2026-11-17), with the sessions spread over weeks 2 to 5 (09 sections 4 and 5). Usage is 25 units: seven high sessions and two medium ones. An architecture decision record is cited as ADR nnnn; requirements carry requirement identifiers (R IDs); answered questions are cited by O-ID from [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]].

## MVP

The minimum viable product (MVP) is the smallest set of outcomes that lets Phase 4 start, in the order the dependency graph needs them (09 section 3):

1. The grading policy types and functions in `packages/learning` (S22), because the Phase 4 learning core (S30) builds on the policy types.
2. The `api` foundation with authentication, the catalog and the committed OpenAPI contract (S21), because every later handler and screen is generated from it (O-38).
3. The persisted session state machine and the grading orchestration (S23), because the Phase 4 learning updates (S31) hang off the session machine.
4. The web foundation and the trainer screen in spot mode (S24, S25), because automated training (S32) reuses the trainer screen.
5. The Phase 3 gate (S29), because the v1 gate (S34) takes criteria 3, 4, 5, 9, 10 and 11 from it.

Success criteria ([[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] section 6) this phase closes: 3 (displayed expected value (EV) loss equals an independent recomputation), 4 (bucket edges and the random number generator (RNG) chi-square test), 5 (every build-card drill expressed and run), 9 (templates and the validator show only grounded numbers) and 11 (live rake follows the stake). It partly closes 10: the no-solve dependency and request-path tests and the Zenbook 95th percentile latency (p95) guard close here; the Mac p95 number waits for Deploy 2 (S34, O-21).

## Scope

In scope: the `api` service per [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5]] section 3 (auth, catalog, study, coverage, training sessions, prediction and painting, drills, explanations, events, admin); the grading policy, grouping modes, RNG band mapping and calibration stat in `packages/learning`; the web app per [[projects/g-tee-oh/planning/architecture/A7-web-app|A7]] for the login, home shell, study, trainer, drills, prediction, painting, library and admin routes; insight cards; More info templates; the Ask path behind a feature flag with a mocked model (O-54); the coverage view, gap requests and admin builder screen (O-36); end-to-end flows 2 to 5 in the continuous integration (CI) `e2e` job; the Phase 3 gate.

Out of scope: the progress screen, automated training loop, rating, scheduling, holdout and streaks (Phase 4); any postflop serving (v1.5, ADR 0023); any deploy (Phase 3 never touches the Mac, O-20); anything GTO Wizard-specific (GTO, game theory optimal), which stays in the vault and the private repo (O-26).

Sessions (09 section 5):

| Session | Handoff | Branch | Group and day | Workflow or single | Visibility | Usage |
|---|---|---|---|---|---|---|
| S21 | [[projects/g-tee-oh/handoffs/S21-api-foundation|S21 api foundation]] | `p3/api-foundation` | D, day 4 (paced week 2) | Workflow | public | high |
| S22 | [[projects/g-tee-oh/handoffs/S22-grading-policy|S22 grading policy]] | `p3/grading-policy` | C, day 3 (paced week 2) | Single | public | medium |
| S23 | [[projects/g-tee-oh/handoffs/S23-api-trainer|S23 api trainer]] | `p3/api-trainer` | D, day 5 (paced week 3) | Workflow | public | high |
| S24 | [[projects/g-tee-oh/handoffs/S24-web-foundation|S24 web foundation]] | `p3/web-foundation` | D, day 5 (paced week 3) | Workflow | public | high |
| S25 | [[projects/g-tee-oh/handoffs/S25-web-study-trainer|S25 web study and trainer]] | `p3/web-study-trainer` | E, day 6 (paced week 4) | Workflow | public | high |
| S26 | [[projects/g-tee-oh/handoffs/S26-drills|S26 drills]] | `p3/drills` | E, day 7 (paced week 4) | Workflow | public | high |
| S27 | [[projects/g-tee-oh/handoffs/S27-insights-explanations|S27 insights and explanations]] | `p3/insights-explanations` | E, day 7 (paced week 4) | Workflow | public | high |
| S28 | [[projects/g-tee-oh/handoffs/S28-coverage-admin|S28 coverage and admin]] | `p3/coverage-admin` | E, day 6 (paced week 4) | Single | public | medium |
| S29 | [[projects/g-tee-oh/handoffs/S29-phase-3-gate|S29 Phase 3 gate]] | `p3/gate` | F, day 8 (paced week 5) | Workflow | public | high |

Deferred to v1.5 where it touches this phase (09 section 9): serving scenarios, postflop trainer modes, postflop prediction drills and postflop tracks (the builder writes scenarios in v1 per O-17, but no v1 criterion is postflop); turn roots for every turn card and `/study/turn-roots` (O-15); serving ante variants (O-33) and 6 to 8 handed live configurations (O-10); connecting a real model key for the Ask path (the path, validator and cap ship with a mock, O-54); range drift beyond preflop families; the reference-to-own source switch for preflop solutions. Usage trims that touch this phase, applied only on a shortfall and never to a gate (09 section 4, O-39): fold S28 into S25; ship the Ask path flag-only and move prediction and painting (R3.16, R3.17) into S26, which turns S27 into a medium session.

## Blockers/Constraints

Dependencies (09 section 3):

- Phase 0: S02 blocks S21 (migrations, roles, the `query` role, the `build_job` tables, Kysely types; O-28); S06 blocks S21 and S24 (the contracts pipeline, the Fastify and Vite skeletons, the generated clients); S05 blocks S22 (the `packages/learning` skeleton and the R0.11 vectors).
- Phase 2: S16 blocks S23, S27 and S29 (the `solver-query` contract, its insights endpoint, and the real service for the p95 guard and dependency tests; the committed contract lifts the S23 block a day early, O-38); S19 blocks S23 and S29 (the fixture library, O-30, O-53).
- Phase 1, softly: S07 names the component library for S24 (with the A7 fallback, Tailwind with Radix primitives, if it has not, O-44) and confirms the drill schema for S26 (fallback: [[projects/g-tee-oh/planning/05-training-and-grading|05 Training and grading]] section 4 as written); S11 gives criterion 11 captured live data (the synthetic live sets stand in, O-57); S10's first pack lets S26 run the acceptance file against the reference library locally.
- Inside the phase: S21 blocks S23 and S24; S22 blocks S23 and S25; S23 blocks S25, S27 and S28; S24 blocks S25 and S28; S25 blocks S26 and S27; S26, S27 and S28 block S29; S29 blocks S34.

Owner tasks: export the 15-drill build card into `research/` as a private note before S26 (O-24, O-64); if it is missing, S26 runs the drills named in 05 section 4 and S29 blocks on the card (O-67); verify the 2/5 live rake cap before S11 (O-66; R3.21 passes either way because the caps differ in big blinds (bb) at the two stakes); review screenshots from a local port at S25 and S29, which is a gate condition (09 section 2); answer O-64 after reading the translated card, or leave the acceptance file private.

Machine limits: every session runs on the Zenbook in PowerShell at `C:\Users\stack\projects\g-tee-oh` with the native Windows Rust toolchain; Windows Subsystem for Linux 2 (WSL2) is used only for Linux container builds and the compose stack (O-23, O-48); no session in this phase deploys to the Mac or runs the builder (O-20); the Zenbook p95 guard runs at twice the Mac budgets (O-21, O-40).

Privacy boundary: every Phase 3 file is `public: true`. The drill schema uses the g-tee-oh field names from 05 section 4 only; the reference tool's parameter names, routes, payload shapes and game type codes stay in the vault (O-26, ADR 0017, ADR 0021). The build-card acceptance file stays under `research/` and runs locally until the owner answers O-64; CI runs a synthetic drill set. Capture detail is linked, never restated: [[projects/g-tee-oh/planning/03-phase-1-data-acquisition|03 Phase 1 data acquisition]] and [[projects/g-tee-oh/planning/architecture/A8-capture-system|A8]], per O-19.

Binding ADRs: 0001 (multi-user schema), 0004 (poker math in Rust, product logic in TypeScript; Accepted per O-25), 0005 (dbmate and Kysely built on per O-56), 0006 (React, TypeScript, Vite), 0008 (EV loss, floor, buckets), 0009 (indifference and optional RNG mode), 0010 (v1 opponents play equilibrium; `reference_strategy` stored), 0013 (reach prior; Accepted per O-25), 0014 (rake by stake), 0016 (explanations), 0017 and 0021 (privacy), 0018 (library-first, no request path starts a solve), 0020 (the tree decides the buttons).

Binding answers: O-5, O-18, O-21, O-22, O-23, O-24, O-25, O-26, O-28, O-29, O-30, O-36, O-38, O-39, O-40, O-44, O-53, O-54, O-56, O-57, O-60, O-62, O-64, O-66, O-67.

## Inputs

- Documents: [[projects/g-tee-oh/planning/01-product-spec|01 Product spec]] sections 3, 4 and 6; [[projects/g-tee-oh/planning/05-training-and-grading|05 Training and grading]] (whole); [[projects/g-tee-oh/planning/09-v1-sprint-roadmap|09 v1 sprint roadmap]] sections 3 to 7; [[projects/g-tee-oh/planning/00-open-questions-and-risks|00 Open questions and risks]]; [[projects/g-tee-oh/planning/architecture/A1-repo-and-conventions|A1]] sections 2 to 4; [[projects/g-tee-oh/planning/architecture/A4-data-model|A4]] (schema and roles); [[projects/g-tee-oh/planning/architecture/A5-services-and-interfaces|A5]] (service map and both contracts); [[projects/g-tee-oh/planning/architecture/A6-trainer-and-learning-engine|A6]] (state machine, policy types, LLM path, where LLM is a large language model); [[projects/g-tee-oh/planning/architecture/A7-web-app|A7]] (routes, components, budgets, flows); [[projects/g-tee-oh/planning/architecture/A9-quality-security-ops|A9]] (tests, CI jobs, security model, budgets); the ADRs listed above from [[projects/g-tee-oh/decisions/_README|ADR index]].
- Fixtures: the G6a heads-up push/fold solution in library format (R2.19); the labeled synthetic 6-max preflop set and the synthetic live 9-handed sets at 1/3 and 2/5 with the `synthetic: true` banner flag (R2.20, O-57); the 169 by 169 equity table (O-32); the R0.11 bucket-edge table and the `packages/learning` skeleton with the A6 section 4 types; the `FIXTURE_LIBRARY_PATH` variable on the `dev` profile (O-62).
- Data: the seeded catalog from R0.6 (stakes with the 1/3 and 2/5 caps, one online profile, every v1 configuration with a placeholder sizing convention); `sizing_convention` rows from R1.6 when they land; packed reference configurations from R1.5 and R1.7 for local runs only.
- Prior outputs: S02 migrations, roles and Kysely types; S06 contracts pipeline, Fastify and Vite skeletons, Playwright smoke flow; S16 `solver-query.openapi.json`, its TypeScript client and binary; S19 fixture library; S07's sanitized feature map, drill schema confirmation and frontend stack note in the vault (R1.1, O-44).
- Owner-provided: the build card export under `research/` (O-24); the 2/5 cap verification (O-66); screenshot reviews.

## Instruments

| Instrument | Pass rule | Set by |
|---|---|---|
| `contracts` CI job on `api.openapi.json` and the generated client | Regeneration produces no diff | R3.1, A1 section 3, O-38 |
| Auth and security integration tests in a Postgres test container | Rate limit trips, CSRF (cross-site request forgery) rejected, cookie flags present, a double-submitted decision graded once | R3.1, A9 section 3 |
| Catalog integration and contract tests against the R0.6 seed | Every v1 configuration listed; a 1/3 and a 2/5 spot resolve to different `config_id` values | R3.2, R2.2 |
| Study integration test with the fixture `solver-query` | Node and insights served from the fixture library; the next likely node prefetched | R3.3, O-53 |
| `just perf` on the Zenbook, JSON report under `validation/reports/` (file name open, see problems list) | p95 under 300 ms node read, 60 ms grade, 500 ms decision to feedback; hosted CI checks the committed report; the `e2e` job repeats the timing as an advisory check that never fails the build | R3.3, O-21, O-40, A9 section 6 |
| Request-path test | A gap request raises priority, creates no `solution` row, and the builder process is never invoked | R3.4, R2.15, ADR 0018 |
| `cargo tree -p solver-query` and `pnpm why` for `api` | No `gto-solve` dependency anywhere | R2.15 |
| Transition table test and replay-from-seed golden | Every A6 section 2 transition covered; a session replays identically from its seed | R3.6 |
| `tools/validate recompute` report | 200 seeded attempts recomputed through `gto-library` without calling `solver-query` equal `attempt.ev_loss_bb` and the feedback payload; the seed is in the report | R3.7, O-60 |
| Grading policy unit tests and fast-check property | Every label threshold, the floor boundary, a mixed hand inside and outside the floor; score monotone in loss | R3.8, 05 section 6, A6 section 4 |
| `ActionBar` component test | Buttons equal the node's actions; a missing bucket has no button; a preflop node in Grouped mode shows the exact size | R3.9, ADR 0020, O-22 |
| Chi-square over 10,000 seeded rolls per tested hand | Selected-action counts match the frequencies (significance level open, see problems list); explainer snapshot | R3.10, 05 section 7 |
| Calibration aggregation and queue-rule tests on fixture attempts | Accuracy when sure versus unsure computed; a confident miss is next | R3.11, 05 section 5 |
| Component tests, flow 3, the matrix frame bench | Flow 3 green; matrix frame under 16 ms; node switch time logged | R3.12, A7 section 4 |
| Flow 4 and the state machine tests | Flow 4 green in CI | R3.13 |
| Drill schema tests, export and import round trip, flow 2 | A drill round-trips through its export code; flow 2 green | R3.14 |
| Build-card acceptance file (local, private until O-64) and the synthetic drill set in CI | Each card drill parses and produces at least one prompt; the synthetic set passes in CI | R3.15, O-24, O-64 |
| Prediction level, painting and insight tests | Next level after 90 percent; painting total equals the `solver-query` sum; noise-flagged attempt unrated; drift hidden below 30 | R3.16 to R3.18 |
| Template number-membership test and snapshots | Every number in the output exists in the node or insights JSON | R3.19, ADR 0016 |
| Validator and Ask path tests with a mocked model | A planted unsupported number is rejected; above the $15 cap the button is disabled; a cache hit spends nothing; flag off returns a problem response | R3.20, O-5, O-54 |
| Keying test over two live configurations | A 1/3 spot and a 2/5 spot with the same action resolve to different solutions with caps of 1.67 and 1.0 bb; in CI on the synthetic sets, locally on captured data when R1.8 says it exists | R3.21, O-18, O-57 |
| CI `e2e` job, flows 2 to 5 | Green against the fixture library | R3.22, O-30, O-62 |
| Owner screenshot review from a local port | The owner has reviewed the S25 and S29 screenshots | 09 section 2 |
| Phase 3 gate report (file name open, see problems list) | Lists every R3 requirement with its test command and result, and criteria 3, 4, 5, 9, 10 (Zenbook) and 11 with report paths | 09 section 7 |

## Requirements

| ID | Requirement | Test or gate artifact | Success criterion | Session |
|---|---|---|---|---|
| R3.1 | `api` foundation: Fastify, Zod on every input, argon2id, HTTP-only Secure SameSite cookies, login rate limit, CSRF protection, Request for Comments (RFC) 9457 errors, `Idempotency-Key`, cursor pagination, Kysely, OpenAPI committed first (O-38) and generated client (A5 section 3, A9 section 3) | Contract diff job; auth and security integration tests in a Postgres test container (rate limit trips, CSRF rejected, cookie flags); a double-submitted decision is graded once | 10 | S21 |
| R3.2 | Catalog endpoints `/stakes`, `/configs`, `/configs/{id}/pairs` over the seeded catalog, stake keying by `config_id` | Integration tests against the R0.6 seed; contract tests against the OpenAPI schema | 11 | S21 |
| R3.3 | Study endpoints over `solver-query`: `/study/node`, `/study/insights`, next likely node prefetched | Integration test with the fixture `solver-query` (O-53); the Zenbook p95 regression guard at twice the budget (O-21, O-40) | 10 | S23 (endpoints and `just perf`), S29 (guard run) |
| R3.4 | Coverage view and gap requests (O-36): `/coverage`, `/coverage/requests` raises priority, server-sent events (SSE) `coverage_added`, `/library` screen with `CoverageGrid` | Request-path test: a gap request raises priority, creates no `solution` row, and the builder process is never invoked; end-to-end flow 5 | 10 | S23 (endpoints, request-path test), S28 (screen, flow 5), S29 (flow 5 in CI) |
| R3.5 | Admin builder screen and endpoints (O-36): queue, throughput, storage, settings, pause and resume | Integration tests; settings PATCH round trip; pause and resume; component test | none | S23 (endpoints; the `app` role grant for admin writes is open, see problems list), S28 (screen) |
| R3.6 | Session state machine persisted with `state_version`; opponent actions from `sample-action` with the seeded RNG carried in the session; spot, street and full hand (ending at the flop in v1); identical replay from a seed | Transition table test; replay-from-seed golden | 3 | S23 |
| R3.7 | Grading orchestration: `solver-query` grade, the learning policy (R3.8), attempt row and feedback payload in one transaction | Criterion 3 recomputation (O-60): `tools/validate recompute` reads a seeded random sample of 200 attempts and recomputes EV loss through `gto-library` directly, never calling `solver-query`, equal to `attempt.ev_loss_bb` and the feedback payload | 3 | S23 (orchestration), S29 (recompute report) |
| R3.8 | Grading policy as a pure function in `packages/learning` over `solver-query` output: score exp(-max(0, loss - floor) / tau), labels per 05 section 6.3, rated flag and weight per A6 section 4, grouping modes Standard, Grouped and Simple (Simple grades the action type by its best size). Bucket mapping and the floor come from Rust (R2.3, R2.13) and are never recomputed here (ADR 0004) | Unit tests at every label threshold, the floor boundary, a mixed hand inside and outside the floor; fast-check: score monotone in loss | 3, 4 | S22 |
| R3.9 | Buttons generated from the node's tree actions (ADR 0020): Grouped shows the bucket label with the size underneath, except at preflop nodes where the exact size is shown (O-22); Standard shows the exact size; a bucket missing from the tree has no button | Component test: buttons equal the node's actions; a missing bucket has no button; a preflop node in Grouped shows the exact size | 4 | S25 |
| R3.10 | RNG mode: cumulative bands from passive to aggressive, roll-selected action labeled Best, explainer on first use and from the icon | Chi-square over 10,000 seeded rolls per tested hand; explainer snapshot | 4 | S22 (band mapping, chi-square), S25 (roller, explainer), S29 (closing run) |
| R3.11 | Confidence tap before any reveal; calibration stat; a confident miss moves to the front of the automated queue | Calibration aggregation test on fixture attempts; queue test that a confident miss is next | none | S22 (calibration stat and queue rule as pure functions, open, see problems list), S25 (tap) |
| R3.12 | Study browser for preflop nodes: 13 by 13 matrix with frequency, EV and range-weight modes, actions table, threshold card, filters | Component tests; end-to-end flow 3; node switch time logged for the latency report; matrix frame under 16 ms in the component bench (A7 section 4) | 10 | S24 (matrix canvas, frame bench), S25 (study screen, flow 3) |
| R3.13 | Trainer screen: `PokerTable`, `ActionBar`, `ConfidenceTap`, `RngRoller`, `FeedbackPanel`, hotkeys; spot mode, then street and full hand to the flop | End-to-end flow 4; state machine tests | 3, 4 | S24 (core components), S25 (spot mode, flow 4), S26 (street and full hand) |
| R3.14 | Drill schema from 05 section 4 as Zod; drill library, builder, duplicate, tags, import and export code; a drill runs on the covered part and files a gap request | Schema tests; export and import round trip; end-to-end flow 2 | 5 | S21 (CRUD, create, read, update, delete), S26 (schema, screens, round trip, flow 2) |
| R3.15 | Every preflop drill on the 15-drill build card (O-24) expressed in the schema and run | Acceptance file with one case per drill: each parses (expressed) and produces at least one prompt (run), against the reference library locally; CI runs a synthetic drill set until O-64 is answered | 5 | S26 (acceptance file), S29 (build-card run) |
| R3.16 | Prediction drills at increasing precision, next level after 90 percent accuracy, unrated | Unit tests on level unlock; no rating side effect | none (spec item 6) | S27 |
| R3.17 | Range painting graded by reach-weighted EV loss summed over hands, unrated | Unit test on a fixture node: a near-indifferent hand painted wrong costs little, a clear fold painted as a raise costs a lot; the total equals the `solver-query` sum | none (spec item 6) | S27 |
| R3.18 | Insight cards: threshold card, noise flags, range drift shown only after 30 decisions per node family, never graded | Noise-flagged attempt is `rated = false`; drift hidden below 30; drift changes no score | none (feeds 6) | S27 |
| R3.19 | More info templates render only numbers present in the node data | Template test: every number in the output exists in the node or insights JSON; snapshot per template | 9 | S27, S29 (closing run) |
| R3.20 | Ask path behind a feature flag until a key is configured: grounding JSON, validator, one regeneration then a warning, cache, monthly cap of $15 (O-5); mocked model in CI (O-54) | Validator rejects a planted unsupported number and passes supported ones; above the cap the button is disabled; a cache hit spends nothing; flag off returns a problem response | 9 | S27, S29 (closing run) |
| R3.21 | Live rake keying (criterion 11): a 1/3 spot and a 2/5 spot with the same action resolve to different solutions with different bb caps (1.67 versus 1.0), over captured live data or the labeled synthetic live sets (O-18, O-57) | Keying test over two live configurations in CI on the synthetic sets, and locally on captured data when R1.8 says it exists | 11 | S29 |
| R3.22 | End-to-end flows 2 to 5 run in CI against the fixture library (O-30, O-62); flow 1 belongs to Phase 4 (R4.10) | CI `e2e` job green | 4, 5, 10 | S29 |

## Definition of Done

- [ ] Criteria 3, 4, 5, 9, 10 (Zenbook part) and 11 pass with their named tests or reports (09 section 2): the recompute report (3), the bucket-edge table rerun and the chi-square test (4), the build-card run (5), the template and validator tests (9), the dependency and request-path tests and the Zenbook p95 guard report (10), the keying test (11).
- [ ] End-to-end flows 2 to 5 green in the CI `e2e` job against the fixture library (R3.22).
- [ ] The owner has reviewed screenshots from a local port at S25 and at the S29 visual pass.
- [ ] Every R3.1 to R3.22 test or gate artifact in the Requirements table is green or present; the build-card run against the reference library stays private until O-64 (09 section 7).
- [ ] The `just perf` JSON report is committed under `validation/reports/` and hosted CI checks it against the O-40 thresholds.
- [ ] `cargo tree -p solver-query` contains no `gto-solve`; `pnpm why` shows `api` never depends on the builder (R2.15, closing at S29).
- [ ] Every session S21 to S29 merged into `sprint/1-v1` by pull request, and `sprint/1-v1` green on all seven CI jobs after the last merge.
- [ ] The Phase 3 gate report lists every R3 requirement with its test command and result, and every criterion with its report path, as the input to the v1 gate report (R4.17).
- [ ] No Phase 3 file in the public repo carries a GTO Wizard specific (O-26); the guard passes on every p3 branch.
- [ ] Any new question raised during the phase is appended to planning/00 as a proposed O-ID with a default, under a dated subsection.
